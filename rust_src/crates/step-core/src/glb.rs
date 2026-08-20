//! Minimal GLB (binary glTF 2.0) writer — no serde, JSON is emitted by hand.
//!
//! One buffer; per primitive: a POSITION view, a NORMAL view and an index
//! view. A mesh holds one primitive per color bucket; materials are deduped
//! across the file with material 0 as the uncolored default.

use crate::geom::{v3, M4, V3};
use crate::io::{MemSink, MemTemp, OutputHandle, TempHandle};
use crate::mesh::{as_bytes, as_bytes_u32, quantize_color, MeshSet, TriMesh};

/// Appends the GLB binary chunk to a [`TempHandle`] (spillable to disk under a
/// memory threshold), tracking the running offset. Every payload here is f32 /
/// u32, so the chunk is naturally 4-byte aligned.
struct Bin<'a> {
    tmp: &'a mut dyn TempHandle,
    off: usize,
}

impl<'a> Bin<'a> {
    /// Append bytes, returning their start offset within the buffer.
    fn append(&mut self, bytes: &[u8]) -> usize {
        let at = self.off;
        self.tmp.write_at(at as u64, bytes).expect("temp write");
        self.off += bytes.len();
        at
    }
    fn align(&mut self, to: usize) {
        while !self.off.is_multiple_of(to) {
            self.tmp
                .write_at(self.off as u64, &[0])
                .expect("temp write");
            self.off += 1;
        }
    }
    fn len(&self) -> usize {
        self.off
    }
}

/// Stream the GLB container to `out`: the 12-byte header, the padded JSON chunk,
/// then the BIN chunk copied back from `tmp`. Nothing larger than the JSON
/// metadata is held in RAM here — the geometry lives in `tmp`.
fn finish_glb(
    out: &mut dyn OutputHandle,
    json: String,
    tmp: &dyn TempHandle,
) -> std::io::Result<()> {
    let mut json_bytes = json.into_bytes();
    while !json_bytes.len().is_multiple_of(4) {
        json_bytes.push(b' ');
    }
    let bin_len = tmp.len() as usize;
    let bin_pad = (4 - bin_len % 4) % 4;
    let total = 12 + 8 + json_bytes.len() + 8 + bin_len + bin_pad;

    let mut header = Vec::with_capacity(20);
    header.extend_from_slice(b"glTF");
    header.extend_from_slice(&2u32.to_le_bytes());
    header.extend_from_slice(&(total as u32).to_le_bytes());
    header.extend_from_slice(&(json_bytes.len() as u32).to_le_bytes());
    header.extend_from_slice(b"JSON");
    out.write(&header)?;
    out.write(&json_bytes)?;

    let mut bin_header = Vec::with_capacity(8);
    bin_header.extend_from_slice(&((bin_len + bin_pad) as u32).to_le_bytes());
    bin_header.extend_from_slice(b"BIN\0");
    out.write(&bin_header)?;

    // copy the binary chunk out of the spill in 1 MiB strides
    let mut buf = vec![0u8; 1 << 20];
    let mut off = 0u64;
    while (off as usize) < bin_len {
        let n = tmp.read_at(off, &mut buf)?;
        if n == 0 {
            break;
        }
        out.write(&buf[..n])?;
        off += n as u64;
    }
    if bin_pad > 0 {
        out.write(&[0u8; 4][..bin_pad])?;
    }
    Ok(())
}

pub struct GlbNode {
    pub name: String,
    pub matrix: Option<M4>,
    pub mesh: Option<usize>,
    pub children: Vec<usize>,
}

/// The default (uncolored) material — material index 0. Seeded into every
/// builder so colored materials dedup against indices ≥ 1.
const DEFAULT_MATERIAL: &str = "{\"name\":\"default\",\"pbrMetallicRoughness\":{\
     \"baseColorFactor\":[0.72,0.72,0.75,1.0],\
     \"metallicFactor\":0.1,\"roughnessFactor\":0.7},\"doubleSided\":true}";

/// One emitted primitive's accessor indices — all that survives in RAM after
/// the geometry bytes have been spilled to the temp handle.
struct PrimMeta {
    material: usize,
    pos_acc: usize,
    nrm_acc: Option<usize>,
    idx_acc: usize,
    lines: bool,
}

/// A mesh reduced to its name + per-primitive accessor metadata. The vertex /
/// index data itself lives in the temp handle (see [`GlbBuilder::add_mesh`]).
struct MeshMeta {
    name: String,
    prims: Vec<PrimMeta>,
}

/// Streaming hierarchical-GLB builder. Geometry is **not** held in RAM: each
/// [`add_mesh`](GlbBuilder::add_mesh) serialises its primitives straight into
/// the temp handle and keeps only small metadata, so peak resident geometry is
/// one mesh, not the whole model. The same temp handle must be passed to
/// [`finish`](GlbBuilder::finish) — it already holds the binary chunk.
pub struct GlbBuilder {
    pub nodes: Vec<GlbNode>,
    pub root_nodes: Vec<usize>,
    meshes: Vec<MeshMeta>,
    // JSON fragments accumulated eagerly as meshes are added (metadata-sized,
    // grows with the primitive *count*, not vertex count)
    views: String,
    accessors: String,
    materials_json: String,
    /// colored materials deduped by RGBA bits → material index
    mat_index: std::collections::HashMap<[u32; 4], usize>,
    n_views: usize,
    n_acc: usize,
    n_materials: usize,
    /// running offset into the binary chunk (the temp handle)
    bin_off: usize,
    total_vertices: usize,
    total_triangles: usize,
}

impl Default for GlbBuilder {
    fn default() -> Self {
        GlbBuilder {
            nodes: Vec::new(),
            root_nodes: Vec::new(),
            meshes: Vec::new(),
            views: String::new(),
            accessors: String::new(),
            materials_json: String::from(DEFAULT_MATERIAL),
            mat_index: std::collections::HashMap::new(),
            n_views: 0,
            n_acc: 0,
            n_materials: 1, // 0 = default
            bin_off: 0,
            total_vertices: 0,
            total_triangles: 0,
        }
    }
}

impl GlbBuilder {
    pub fn add_node(&mut self, name: String, matrix: Option<M4>, mesh: Option<usize>) -> usize {
        self.nodes.push(GlbNode {
            name,
            matrix: matrix.filter(|m| !m.is_identity(1e-12)),
            mesh,
            children: Vec::new(),
        });
        self.nodes.len() - 1
    }

    /// Add a mesh, **spilling its geometry to `tmp` immediately** and retaining
    /// only accessor/material metadata. `tmp` accumulates the binary chunk
    /// across calls; the *same* handle must later be given to [`finish`]. The
    /// emission order (mesh order, then `set.parts` order, position → normal →
    /// index) matches the old single-pass writer, so output stays byte-exact.
    pub fn add_mesh(&mut self, set: MeshSet, name: String, tmp: &mut dyn TempHandle) -> usize {
        let mut bin = Bin {
            tmp,
            off: self.bin_off,
        };
        let mut prims = Vec::new();
        for (color, m) in &set.parts {
            if m.is_empty() {
                continue;
            }
            let material = match color {
                None => 0,
                Some(c) => {
                    let key = [
                        c[0].to_bits(),
                        c[1].to_bits(),
                        c[2].to_bits(),
                        c[3].to_bits(),
                    ];
                    if let Some(&i) = self.mat_index.get(&key) {
                        i
                    } else {
                        self.materials_json.push_str(&format!(
                            ",{{\"name\":\"color_{}\",\"pbrMetallicRoughness\":{{\
                             \"baseColorFactor\":[{},{},{},{}],\
                             \"metallicFactor\":0.1,\"roughnessFactor\":0.7}},\
                             \"doubleSided\":true}}",
                            self.n_materials,
                            fmt_f32(c[0]),
                            fmt_f32(c[1]),
                            fmt_f32(c[2]),
                            fmt_f32(c[3]),
                        ));
                        let i = self.n_materials;
                        self.mat_index.insert(key, i);
                        self.n_materials += 1;
                        i
                    }
                }
            };
            let (pos_acc, nrm_acc, idx_acc) = write_primitive(
                m,
                &mut bin,
                &mut self.views,
                &mut self.accessors,
                &mut self.n_views,
                &mut self.n_acc,
            );
            self.total_vertices += m.vertex_count();
            self.total_triangles += m.triangle_count();
            prims.push(PrimMeta {
                material,
                pos_acc,
                nrm_acc,
                idx_acc,
                lines: m.lines,
            });
        }
        self.bin_off = bin.off;
        self.meshes.push(MeshMeta { name, prims });
        self.meshes.len() - 1
    }

    pub fn mesh_count(&self) -> usize {
        self.meshes.len()
    }

    pub fn total_vertices(&self) -> usize {
        self.total_vertices
    }

    pub fn total_triangles(&self) -> usize {
        self.total_triangles
    }

    /// Finish the GLB: assemble the JSON from the retained metadata and stream
    /// the container to `out`. `tmp` must be the handle the geometry was spilled
    /// into via [`add_mesh`] — it already holds the binary chunk.
    pub fn finish(
        &self,
        generator: &str,
        out: &mut dyn OutputHandle,
        tmp: &mut dyn TempHandle,
    ) -> std::io::Result<()> {
        // meshes: rebuild the per-mesh primitive JSON from the saved accessors
        let mut meshes_json = String::new();
        for mm in &self.meshes {
            let mut prims = String::new();
            for p in &mm.prims {
                if !prims.is_empty() {
                    prims.push(',');
                }
                prims.push_str(&format!(
                    "{{\"attributes\":{{{}}},\
                     \"indices\":{},\"mode\":{},\"material\":{}}}",
                    attributes_json(p.pos_acc, p.nrm_acc),
                    p.idx_acc,
                    if p.lines { 1 } else { 4 }, // glTF LINES vs TRIANGLES
                    p.material
                ));
            }
            if !meshes_json.is_empty() {
                meshes_json.push(',');
            }
            meshes_json.push_str(&format!(
                "{{\"name\":{},\"primitives\":[{}]}}",
                json_str(&mm.name),
                prims
            ));
        }

        // nodes
        let mut nodes_json = String::new();
        for n in &self.nodes {
            if !nodes_json.is_empty() {
                nodes_json.push(',');
            }
            nodes_json.push('{');
            nodes_json.push_str(&format!("\"name\":{}", json_str(&n.name)));
            if let Some(m) = &n.matrix {
                nodes_json.push_str(",\"matrix\":[");
                for (i, v) in m.0.iter().enumerate() {
                    if i > 0 {
                        nodes_json.push(',');
                    }
                    nodes_json.push_str(&fmt_f64(*v));
                }
                nodes_json.push(']');
            }
            if let Some(mi) = n.mesh {
                nodes_json.push_str(&format!(",\"mesh\":{}", mi));
            }
            if !n.children.is_empty() {
                nodes_json.push_str(",\"children\":[");
                for (i, c) in n.children.iter().enumerate() {
                    if i > 0 {
                        nodes_json.push(',');
                    }
                    nodes_json.push_str(&c.to_string());
                }
                nodes_json.push(']');
            }
            nodes_json.push('}');
        }

        let scene_nodes = self
            .root_nodes
            .iter()
            .map(|n| n.to_string())
            .collect::<Vec<_>>()
            .join(",");

        // pad the (already-written) binary chunk to a 4-byte boundary
        let blen = {
            let mut bin = Bin {
                tmp,
                off: self.bin_off,
            };
            bin.align(4);
            bin.len()
        };
        let json = format!(
            concat!(
                "{{\"asset\":{{\"version\":\"2.0\",\"generator\":{gen}}},",
                "\"scene\":0,\"scenes\":[{{\"nodes\":[{scene}]}}],",
                "\"nodes\":[{nodes}],",
                "\"meshes\":[{meshes}],",
                "\"materials\":[{materials}],",
                "\"accessors\":[{acc}],",
                "\"bufferViews\":[{views}],",
                "\"buffers\":[{{\"byteLength\":{blen}}}]}}"
            ),
            gen = json_str(generator),
            scene = scene_nodes,
            nodes = nodes_json,
            meshes = meshes_json,
            materials = self.materials_json,
            acc = self.accessors,
            views = self.views,
            blen = blen,
        );

        finish_glb(out, json, tmp)
    }
}

// -------------------------------------------------------------- merged output

/// rvm_parser_glb-compatible layout: one node + one mesh + one material per
/// distinct color, geometry already baked to world space, and per-part
/// drawcall metadata in the scene `extras`:
///
/// ```json
/// "scenes": [{
///   "extras": {
///     "draw_ranges_node0": { "<partId>": [firstIndex, indexCount], ... },
///     "id_hierarchy":      { "<id>": ["<name>", "<parentId or '*'>"], ... }
///   }
/// }]
/// ```
///
/// Nodes are named `node<N>` and reference mesh `N` / material `N`, so the
/// `draw_ranges_node<N>` key is resolvable from the node name. Ranges are
/// offsets into that mesh's index accessor (element counts, not bytes).
///
/// One id per draw call: a part's first color reuses the part's id, and each
/// further color of the same part is added to `id_hierarchy` as its own
/// numbered child node. So every id appears in exactly one `draw_ranges_node`
/// (never shared across color meshes), and a part that spans several colors is
/// the set of its own id plus those child ids.
/// One merged, single-colour node captured out of [`MergedBuilder`] — the same
/// buffers the GLB would have carried, without the glTF wrapper.
///
/// `positions` are glTF space (**Y-up**, xyz f32 triples) when the conversion
/// ran with `y_up` (what the viewer uses); the cooker bridge rotates back with
/// the same `[x, -z, y]` it applies when reading a GLB, so the direct path and
/// the GLB path cook identical bytes. The recentre offset stays dropped, exactly
/// as it is today: it lives on the glTF node `translation`, which the cooker's
/// GLB reader ignores.
pub struct MergedNodeData {
    pub base_color: [f32; 4],
    pub positions: Vec<f32>,
    pub indices: Vec<u32>,
    /// `(id, index_start, index_count)` per item inside this node.
    pub draw_ranges: Vec<(u32, u32, u32)>,
}

/// A whole merged export in memory — what [`MergedBuilder::write`] would have
/// serialised.
pub struct MergedData {
    pub nodes: Vec<MergedNodeData>,
    /// `(id, name, parent_id)`; parent `0` marks a root (as in the JSON's `"*"`).
    pub hierarchy: Vec<(u32, String, u32)>,
}

#[derive(Default)]
pub struct MergedBuilder {
    buckets: Vec<MergedBucket>,
    /// (id, name, parent id); parent 0 means root (`"*"` in the JSON)
    hierarchy: Vec<(u32, String, u32)>,
    /// global bbox centre removed from all buckets by [`Self::recenter`];
    /// emitted as each bucket node's `translation`
    translation: Option<V3>,
}

struct MergedBucket {
    color: Option<[f32; 4]>,
    mesh: TriMesh,
    /// (part id, first index, index count) in emission order
    ranges: Vec<(u32, u32, u32)>,
}

impl MergedBuilder {
    pub fn add_hierarchy(&mut self, id: u32, name: &str, parent: u32) {
        self.hierarchy.push((id, name.to_string(), parent));
    }

    /// Append one draw call: a single color slice of a part, merged into its
    /// color mesh under `id`. Each `id` lands in exactly one color mesh — the
    /// caller mints a fresh id per color slice (see [`crate::merge`]), so a
    /// draw-range id is never shared across color meshes.
    pub fn add_bucket(&mut self, id: u32, color: Option<[f32; 4]>, m: &TriMesh) {
        // wireframe (line) geometry has no place in the merged triangle layout
        if m.is_empty() || m.lines {
            return;
        }
        let key = color.map(quantize_color);
        let bi = self
            .buckets
            .iter()
            .position(|b| b.color.map(quantize_color) == key)
            .unwrap_or_else(|| {
                self.buckets.push(MergedBucket {
                    color,
                    mesh: TriMesh::default(),
                    ranges: Vec::new(),
                });
                self.buckets.len() - 1
            });
        let b = &mut self.buckets[bi];
        let start = b.mesh.indices.len() as u32;
        b.mesh.append(m);
        b.ranges.push((id, start, m.indices.len() as u32));
    }

    pub fn bucket_count(&self) -> usize {
        self.buckets.len()
    }

    /// Translate all buckets so the scene's bounding-box centre lands at the
    /// origin; the centre is emitted as each bucket node's `translation`.
    /// Merged geometry is world-baked, so a model sited far from the origin
    /// (plant/site coordinates) would otherwise burn its f32 mantissa on the
    /// offset — and viewers jitter at such magnitudes. Call once, after all
    /// buckets are added.
    pub fn recenter(&mut self) {
        let mut mn = [f64::MAX; 3];
        let mut mx = [f64::MIN; 3];
        for b in &self.buckets {
            if b.mesh.positions.is_empty() {
                continue;
            }
            let (lo, hi) = b.mesh.bounds();
            for k in 0..3 {
                mn[k] = mn[k].min(lo[k]);
                mx[k] = mx[k].max(hi[k]);
            }
        }
        if mn[0] > mx[0] {
            return;
        }
        let c = v3(
            (mn[0] + mx[0]) * 0.5,
            (mn[1] + mx[1]) * 0.5,
            (mn[2] + mx[2]) * 0.5,
        );
        if c.len() == 0.0 {
            return;
        }
        for b in &mut self.buckets {
            b.mesh.translate_by_neg(c);
        }
        self.translation = Some(c);
    }

    /// Distinct draw-call ids that own geometry (one per part color slice).
    pub fn part_count(&self) -> usize {
        let mut ids = std::collections::HashSet::new();
        for b in &self.buckets {
            for (id, _, _) in &b.ranges {
                ids.insert(*id);
            }
        }
        ids.len()
    }

    pub fn total_vertices(&self) -> usize {
        self.buckets.iter().map(|b| b.mesh.vertex_count()).sum()
    }

    pub fn total_triangles(&self) -> usize {
        self.buckets.iter().map(|b| b.mesh.triangle_count()).sum()
    }

    /// Hand the merged buckets over for a direct cook — no GLB is built.
    /// Colours default exactly as the material writer does for an uncoloured
    /// bucket, and positions are cast f64 → f32 the same way the accessors are.
    pub fn into_merged(self) -> MergedData {
        let nodes = self
            .buckets
            .into_iter()
            .map(|b| MergedNodeData {
                base_color: b.color.unwrap_or([0.72, 0.72, 0.75, 1.0]),
                positions: b.mesh.positions.iter().map(|&v| v as f32).collect(),
                indices: b.mesh.indices,
                draw_ranges: b.ranges,
            })
            .collect();
        MergedData {
            nodes,
            hierarchy: self.hierarchy,
        }
    }

    /// Convenience all-in-RAM write (used by tests and callers that want bytes).
    pub fn write(&self, generator: &str) -> Vec<u8> {
        let mut out = MemSink::default();
        let mut tmp = MemTemp::default();
        self.write_stream(generator, &mut out, &mut tmp)
            .expect("in-memory GLB write is infallible");
        out.0
    }

    /// Stream the merged GLB to `out`, spilling the binary chunk through `tmp`.
    pub fn write_stream(
        &self,
        generator: &str,
        out: &mut dyn OutputHandle,
        tmp: &mut dyn TempHandle,
    ) -> std::io::Result<()> {
        let mut bin = Bin { tmp, off: 0 };
        let mut views = String::new();
        let mut accessors = String::new();
        let mut meshes_json = String::new();
        let mut materials_json = String::new();
        let mut nodes_json = String::new();
        let mut extras = String::new();
        let mut n_views = 0usize;
        let mut n_acc = 0usize;

        for (i, b) in self.buckets.iter().enumerate() {
            let (pos_acc, nrm_acc, idx_acc) = write_primitive(
                &b.mesh,
                &mut bin,
                &mut views,
                &mut accessors,
                &mut n_views,
                &mut n_acc,
            );
            if i > 0 {
                meshes_json.push(',');
                materials_json.push(',');
                nodes_json.push(',');
            }
            let c = b.color.unwrap_or([0.72, 0.72, 0.75, 1.0]);
            let alpha_mode = if c[3] < 1.0 {
                ",\"alphaMode\":\"BLEND\""
            } else {
                ""
            };
            materials_json.push_str(&format!(
                "{{\"name\":\"color_{}\",\"pbrMetallicRoughness\":{{\
                 \"baseColorFactor\":[{},{},{},{}],\
                 \"metallicFactor\":0.1,\"roughnessFactor\":0.7}}{},\
                 \"doubleSided\":true}}",
                i,
                fmt_f32(c[0]),
                fmt_f32(c[1]),
                fmt_f32(c[2]),
                fmt_f32(c[3]),
                alpha_mode,
            ));
            meshes_json.push_str(&format!(
                "{{\"name\":\"node{}\",\"primitives\":[{{\
                 \"attributes\":{{{}}},\
                 \"indices\":{},\"mode\":4,\"material\":{}}}]}}",
                i,
                attributes_json(pos_acc, nrm_acc),
                idx_acc,
                i
            ));
            let translation = match self.translation {
                Some(c) => format!(
                    ",\"translation\":[{},{},{}]",
                    fmt_f64(c.x),
                    fmt_f64(c.y),
                    fmt_f64(c.z)
                ),
                None => String::new(),
            };
            nodes_json.push_str(&format!(
                "{{\"name\":\"node{}\",\"mesh\":{}{}}}",
                i, i, translation
            ));

            let mut rec = String::new();
            for (id, start, count) in &b.ranges {
                if !rec.is_empty() {
                    rec.push(',');
                }
                rec.push_str(&format!("\"{}\":[{},{}]", id, start, count));
            }
            extras.push_str(&format!("\"draw_ranges_node{}\":{{{}}},", i, rec));
        }

        let mut id_h = String::new();
        for (id, name, parent) in &self.hierarchy {
            if !id_h.is_empty() {
                id_h.push(',');
            }
            let parent = match parent {
                0 => "\"*\"".to_string(),
                p => format!("\"{}\"", p),
            };
            id_h.push_str(&format!("\"{}\":[{},{}]", id, json_str(name), parent));
        }
        extras.push_str(&format!("\"id_hierarchy\":{{{}}}", id_h));

        let scene_nodes = (0..self.buckets.len())
            .map(|n| n.to_string())
            .collect::<Vec<_>>()
            .join(",");

        bin.align(4);
        let blen = bin.len();
        let json = format!(
            concat!(
                "{{\"asset\":{{\"version\":\"2.0\",\"generator\":{gen},",
                "\"extras\":{{\"web3dversion\":2}}}},",
                "\"scene\":0,\"scenes\":[{{\"nodes\":[{scene}],\"extras\":{{{extras}}}}}],",
                "\"nodes\":[{nodes}],",
                "\"meshes\":[{meshes}],",
                "\"materials\":[{materials}],",
                "\"accessors\":[{acc}],",
                "\"bufferViews\":[{views}],",
                "\"buffers\":[{{\"byteLength\":{blen}}}]}}"
            ),
            gen = json_str(generator),
            scene = scene_nodes,
            extras = extras,
            nodes = nodes_json,
            meshes = meshes_json,
            materials = materials_json,
            acc = accessors,
            views = views,
            blen = blen,
        );
        finish_glb(out, json, tmp)
    }
}

fn write_primitive(
    m: &TriMesh,
    bin: &mut Bin,
    views: &mut String,
    accessors: &mut String,
    n_views: &mut usize,
    n_acc: &mut usize,
) -> (usize, Option<usize>, usize) {
    let vcount = m.vertex_count();

    bin.align(4);
    // positions live in f64 through the pipeline; glTF stores f32 — cast here,
    // and take the accessor min/max from the *cast* values so they match the
    // stored data exactly
    let pos32: Vec<f32> = m.positions.iter().map(|&v| v as f32).collect();
    let mut mn = [f32::MAX; 3];
    let mut mx = [f32::MIN; 3];
    for c in pos32.chunks(3) {
        for k in 0..3 {
            mn[k] = mn[k].min(c[k]);
            mx[k] = mx[k].max(c[k]);
        }
    }
    if pos32.is_empty() {
        (mn, mx) = ([0.0; 3], [0.0; 3]);
    }
    let pos_off = bin.append(as_bytes(&pos32));
    push_view(views, n_views, pos_off, pos32.len() * 4, Some(34962));
    let pos_acc = push_accessor(
        accessors,
        n_acc,
        *n_views - 1,
        5126,
        vcount,
        "VEC3",
        Some((mn, mx)),
    );

    // normals are absent after the rvm-style position cleanup pass
    let nrm_acc = if m.normals.is_empty() {
        None
    } else {
        bin.align(4);
        let nrm_off = bin.append(as_bytes(&m.normals));
        push_view(views, n_views, nrm_off, m.normals.len() * 4, Some(34962));
        Some(push_accessor(
            accessors,
            n_acc,
            *n_views - 1,
            5126,
            vcount,
            "VEC3",
            None,
        ))
    };

    bin.align(4);
    let idx_off = bin.append(as_bytes_u32(&m.indices));
    push_view(views, n_views, idx_off, m.indices.len() * 4, Some(34963));
    let idx_acc = push_accessor(
        accessors,
        n_acc,
        *n_views - 1,
        5125,
        m.indices.len(),
        "SCALAR",
        None,
    );

    (pos_acc, nrm_acc, idx_acc)
}

fn attributes_json(pos_acc: usize, nrm_acc: Option<usize>) -> String {
    match nrm_acc {
        Some(n) => format!("\"POSITION\":{},\"NORMAL\":{}", pos_acc, n),
        None => format!("\"POSITION\":{}", pos_acc),
    }
}

fn push_view(views: &mut String, n: &mut usize, offset: usize, len: usize, target: Option<u32>) {
    if !views.is_empty() {
        views.push(',');
    }
    views.push_str(&format!(
        "{{\"buffer\":0,\"byteOffset\":{},\"byteLength\":{}",
        offset, len
    ));
    if let Some(t) = target {
        views.push_str(&format!(",\"target\":{}", t));
    }
    views.push('}');
    *n += 1;
}

fn push_accessor(
    acc: &mut String,
    n: &mut usize,
    view: usize,
    comp: u32,
    count: usize,
    ty: &str,
    minmax: Option<([f32; 3], [f32; 3])>,
) -> usize {
    if !acc.is_empty() {
        acc.push(',');
    }
    acc.push_str(&format!(
        "{{\"bufferView\":{},\"componentType\":{},\"count\":{},\"type\":\"{}\"",
        view, comp, count, ty
    ));
    if let Some((mn, mx)) = minmax {
        acc.push_str(&format!(
            ",\"min\":[{},{},{}],\"max\":[{},{},{}]",
            fmt_f32(mn[0]),
            fmt_f32(mn[1]),
            fmt_f32(mn[2]),
            fmt_f32(mx[0]),
            fmt_f32(mx[1]),
            fmt_f32(mx[2])
        ));
    }
    acc.push('}');
    let id = *n;
    *n += 1;
    id
}

fn fmt_f32(v: f32) -> String {
    if v.is_finite() {
        let s = format!("{}", v);
        if s.contains('.') || s.contains('e') {
            s
        } else {
            format!("{}.0", s)
        }
    } else {
        "0.0".into()
    }
}

fn fmt_f64(v: f64) -> String {
    if v.is_finite() {
        format!("{}", v)
    } else {
        "0".into()
    }
}

/// JSON string escaping for entity names.
fn json_str(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geom::v3;
    use crate::mesh::TriMesh;

    fn tri_mesh() -> TriMesh {
        let mut m = TriMesh::default();
        let n = v3(0.0, 0.0, 1.0);
        m.push_vertex(v3(0.0, 0.0, 0.0), n);
        m.push_vertex(v3(1.0, 0.0, 0.0), n);
        m.push_vertex(v3(0.0, 1.0, 0.0), n);
        m.indices.extend_from_slice(&[0, 1, 2]);
        m
    }

    /// Build a fixed scene, spilling geometry into `tmp` as meshes are added.
    fn scene(tmp: &mut dyn TempHandle) -> GlbBuilder {
        let mut set = MeshSet::default();
        set.bucket(None).append(&tri_mesh());
        set.bucket(Some([1.0, 0.0, 0.0, 1.0])).append(&tri_mesh());
        set.bucket(Some([1.0, 0.0, 0.0, 1.0])).append(&tri_mesh()); // same bucket

        let mut b = GlbBuilder::default();
        let mi = b.add_mesh(set, "tri \"quoted\" name".into(), tmp);
        let child = b.add_node("child".into(), Some(M4::scale_uniform(2.0)), Some(mi));
        let root = b.add_node("root".into(), None, None);
        b.nodes[root].children = vec![child];
        b.root_nodes = vec![root];
        b
    }

    fn build() -> Vec<u8> {
        let mut tmp = MemTemp::default();
        let mut out = MemSink::default();
        scene(&mut tmp).finish("test", &mut out, &mut tmp).unwrap();
        out.0
    }

    #[test]
    fn geometry_is_spilled_to_temp_and_output_is_deterministic() {
        // add_mesh spills the binary chunk into the TempHandle as it goes (a
        // file under --memory-threshold), holding only metadata; finish reads
        // it back. The result must be independent of the temp backing — two
        // independent builds produce byte-identical GLBs.
        let mut tmp_a = MemTemp::default();
        let mut out_a = MemSink::default();
        scene(&mut tmp_a)
            .finish("test", &mut out_a, &mut tmp_a)
            .unwrap();

        let mut tmp_b = MemTemp::default();
        let mut out_b = MemSink::default();
        scene(&mut tmp_b)
            .finish("test", &mut out_b, &mut tmp_b)
            .unwrap();

        assert_eq!(out_a.0, out_b.0, "output must be deterministic");
        assert!(
            tmp_a.len() > 0,
            "binary chunk was routed through the temp spill, not held in RAM"
        );
    }

    #[test]
    fn glb_container_layout_is_valid() {
        let g = build();
        assert_eq!(&g[0..4], b"glTF");
        assert_eq!(u32::from_le_bytes(g[4..8].try_into().unwrap()), 2);
        let total = u32::from_le_bytes(g[8..12].try_into().unwrap()) as usize;
        assert_eq!(total, g.len());
        let jlen = u32::from_le_bytes(g[12..16].try_into().unwrap()) as usize;
        assert_eq!(&g[16..20], b"JSON");
        assert_eq!(jlen % 4, 0, "JSON chunk must be 4-byte aligned");
        let bin_hdr = 20 + jlen;
        let blen = u32::from_le_bytes(g[bin_hdr..bin_hdr + 4].try_into().unwrap()) as usize;
        assert_eq!(&g[bin_hdr + 4..bin_hdr + 8], b"BIN\0");
        assert_eq!(bin_hdr + 8 + blen, g.len());
    }

    #[test]
    fn glb_json_materials_and_primitives() {
        let g = build();
        let jlen = u32::from_le_bytes(g[12..16].try_into().unwrap()) as usize;
        let json: serde_json::Value =
            serde_json::from_slice(&g[20..20 + jlen]).expect("valid JSON");
        assert_eq!(json["asset"]["version"], "2.0");
        assert_eq!(json["nodes"].as_array().unwrap().len(), 2);
        assert_eq!(json["meshes"][0]["name"], "tri \"quoted\" name");

        // two primitives: uncolored (material 0) + red (material 1)
        let prims = json["meshes"][0]["primitives"].as_array().unwrap();
        assert_eq!(prims.len(), 2);
        assert_eq!(prims[0]["material"], 0);
        assert_eq!(prims[1]["material"], 1);
        let mats = json["materials"].as_array().unwrap();
        assert_eq!(mats.len(), 2, "red bucket dedupes to one material");
        assert_eq!(mats[1]["pbrMetallicRoughness"]["baseColorFactor"][0], 1.0);

        // POSITION accessor carries min/max; identity matrices omitted
        assert!(json["accessors"][0]["min"].is_array());
        assert!(json["nodes"][1].get("matrix").is_none());
        assert_eq!(json["nodes"][0]["matrix"][0], 2.0);
    }

    #[test]
    fn merged_builder_one_id_per_drawcall_and_id_hierarchy() {
        let mut mb = MergedBuilder::default();
        mb.add_hierarchy(1, "root", 0);
        // element "a" (id 2): red slice keeps id 2; its uncolored slice is its
        // own numbered child node (id 4)
        mb.add_hierarchy(2, "a", 1);
        mb.add_bucket(2, Some([1.0, 0.0, 0.0, 1.0]), &tri_mesh());
        mb.add_hierarchy(4, "a", 2);
        mb.add_bucket(4, None, &tri_mesh());
        // element "b" (id 3): red slice keeps id 3; its translucent green slice
        // is its own numbered child node (id 5)
        mb.add_hierarchy(3, "b", 1);
        mb.add_bucket(3, Some([1.0, 0.0, 0.0, 1.0]), &tri_mesh());
        mb.add_hierarchy(5, "b", 3);
        mb.add_bucket(5, Some([0.0, 1.0, 0.0, 0.5]), &tri_mesh());

        assert_eq!(mb.bucket_count(), 3, "red, uncolored, green");
        assert_eq!(mb.part_count(), 4, "four draw calls -> four ids");

        let g = mb.write("test");
        let jlen = u32::from_le_bytes(g[12..16].try_into().unwrap()) as usize;
        let json: serde_json::Value =
            serde_json::from_slice(&g[20..20 + jlen]).expect("valid JSON");

        // one node + mesh + material per color, node<N> -> mesh N -> material N
        for k in ["nodes", "meshes", "materials"] {
            assert_eq!(json[k].as_array().unwrap().len(), 3, "{}", k);
        }
        for i in 0..3 {
            assert_eq!(json["nodes"][i]["name"], format!("node{}", i));
            assert_eq!(json["nodes"][i]["mesh"], i);
            assert_eq!(json["meshes"][i]["primitives"][0]["material"], i);
        }
        assert_eq!(
            json["materials"][0]["pbrMetallicRoughness"]["baseColorFactor"][0],
            1.0
        );
        assert!(json["materials"][0].get("alphaMode").is_none());
        assert_eq!(json["materials"][2]["alphaMode"], "BLEND");

        // every draw call is one id in exactly one color mesh (never shared)
        let extras = &json["scenes"][0]["extras"];
        assert_eq!(extras["draw_ranges_node0"]["2"], serde_json::json!([0, 3]));
        assert_eq!(extras["draw_ranges_node0"]["3"], serde_json::json!([3, 3]));
        assert_eq!(extras["draw_ranges_node1"]["4"], serde_json::json!([0, 3]));
        assert_eq!(extras["draw_ranges_node2"]["5"], serde_json::json!([0, 3]));
        let mut seen = std::collections::HashSet::new();
        for i in 0..3 {
            for k in extras[&format!("draw_ranges_node{}", i)]
                .as_object()
                .unwrap()
                .keys()
            {
                assert!(seen.insert(k.clone()), "id {k} appears in >1 mesh");
            }
        }

        // id_hierarchy: [name, parent]; the extra-color slices are child nodes
        assert_eq!(
            extras["id_hierarchy"]["1"],
            serde_json::json!(["root", "*"])
        );
        assert_eq!(extras["id_hierarchy"]["2"], serde_json::json!(["a", "1"]));
        assert_eq!(extras["id_hierarchy"]["4"], serde_json::json!(["a", "2"]));
        assert_eq!(extras["id_hierarchy"]["5"], serde_json::json!(["b", "3"]));

        assert_eq!(json["asset"]["extras"]["web3dversion"], 2);
    }
}
