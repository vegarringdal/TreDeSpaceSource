//! Triangle mesh container, md5-based deduplication and meshoptimizer pass.

use std::collections::HashMap;

use crate::geom::{v3, M4, V3};

#[derive(Default, Clone)]
pub struct TriMesh {
    /// xyz interleaved. Kept in f64 through the whole pipeline (transforms,
    /// weld, cleanup, recentring) and cast to f32 only at GLB emission, so a
    /// part authored far from the origin doesn't burn its precision before
    /// recentring can move the offset onto the node transform.
    pub positions: Vec<f64>,
    pub normals: Vec<f32>,
    pub indices: Vec<u32>,
    /// when true the indices are line segments (pairs), not triangles — wireframe
    /// geometry from a GEOMETRIC_CURVE_SET. The triangle-only passes
    /// (meshoptimizer, simplification) are skipped and it emits glTF mode 1.
    pub lines: bool,
}

impl TriMesh {
    pub fn vertex_count(&self) -> usize {
        self.positions.len() / 3
    }
    pub fn triangle_count(&self) -> usize {
        // line meshes carry segment pairs, not triangles
        if self.lines {
            0
        } else {
            self.indices.len() / 3
        }
    }
    pub fn is_empty(&self) -> bool {
        self.indices.is_empty()
    }

    /// Append a polyline as glTF LINE segments (consecutive index pairs). No
    /// normals — line meshes are position-only.
    pub fn push_polyline(&mut self, pts: &[V3]) {
        if pts.len() < 2 {
            return;
        }
        self.lines = true;
        let base = self.vertex_count() as u32;
        for p in pts {
            self.positions.extend_from_slice(&[p.x, p.y, p.z]);
        }
        for i in 0..pts.len() as u32 - 1 {
            self.indices.push(base + i);
            self.indices.push(base + i + 1);
        }
    }

    pub fn push_vertex(&mut self, p: V3, n: V3) {
        self.positions.extend_from_slice(&[p.x, p.y, p.z]);
        self.normals
            .extend_from_slice(&[n.x as f32, n.y as f32, n.z as f32]);
    }

    /// Snapshot the buffer lengths so a partial, failed face emission can be
    /// rolled back and retried (e.g. at a finer tessellation) without leaving
    /// stray vertices behind.
    pub fn checkpoint(&self) -> (usize, usize, usize) {
        (self.positions.len(), self.normals.len(), self.indices.len())
    }

    pub fn rollback(&mut self, cp: (usize, usize, usize)) {
        self.positions.truncate(cp.0);
        self.normals.truncate(cp.1);
        self.indices.truncate(cp.2);
    }

    pub fn append(&mut self, o: &TriMesh) {
        let base = self.vertex_count() as u32;
        self.positions.extend_from_slice(&o.positions);
        self.normals.extend_from_slice(&o.normals);
        self.indices.extend(o.indices.iter().map(|i| i + base));
    }

    pub fn transform(&mut self, m: &M4) {
        // rigid-ish transform; normals use the rotation part only
        let has_normals = !self.normals.is_empty();
        for i in 0..self.vertex_count() {
            let p = v3(
                self.positions[i * 3],
                self.positions[i * 3 + 1],
                self.positions[i * 3 + 2],
            );
            let q = m.xform_point(p);
            self.positions[i * 3] = q.x;
            self.positions[i * 3 + 1] = q.y;
            self.positions[i * 3 + 2] = q.z;

            if !has_normals {
                continue;
            }
            let n = v3(
                self.normals[i * 3] as f64,
                self.normals[i * 3 + 1] as f64,
                self.normals[i * 3 + 2] as f64,
            );
            let r = &m.0;
            let nn = v3(
                r[0] * n.x + r[4] * n.y + r[8] * n.z,
                r[1] * n.x + r[5] * n.y + r[9] * n.z,
                r[2] * n.x + r[6] * n.y + r[10] * n.z,
            )
            .norm();
            self.normals[i * 3] = nn.x as f32;
            self.normals[i * 3 + 1] = nn.y as f32;
            self.normals[i * 3 + 2] = nn.z as f32;
        }
    }

    /// Area-weighted face normals for vertices [vbase..] whose normal is zero,
    /// using triangles starting at index offset `istart`.
    pub fn compute_missing_normals(&mut self, vbase: usize, istart: usize) {
        let idx = &self.indices[istart..];
        let mut acc = vec![V3::ZERO; self.vertex_count() - vbase];
        for t in idx.chunks(3) {
            if t.len() < 3 {
                continue;
            }
            let g = |i: u32| {
                v3(
                    self.positions[i as usize * 3],
                    self.positions[i as usize * 3 + 1],
                    self.positions[i as usize * 3 + 2],
                )
            };
            let n = g(t[1]).sub(g(t[0])).cross(g(t[2]).sub(g(t[0])));
            for &i in t {
                let li = i as usize;
                if li >= vbase {
                    acc[li - vbase] = acc[li - vbase].add(n);
                }
            }
        }
        for (k, n) in acc.iter().enumerate() {
            let li = vbase + k;
            let cur = v3(
                self.normals[li * 3] as f64,
                self.normals[li * 3 + 1] as f64,
                self.normals[li * 3 + 2] as f64,
            );
            if cur.len() < 0.5 {
                let n = n.norm();
                self.normals[li * 3] = n.x as f32;
                self.normals[li * 3 + 1] = n.y as f32;
                self.normals[li * 3 + 2] = n.z as f32;
            }
        }
    }

    /// md5 over geometry bytes — used as a dedup/instancing key, exactly like
    /// rvm_parser_glb does for repeated primitives.
    pub fn content_hash(&self) -> [u8; 16] {
        let mut ctx = md5::Context::new();
        ctx.consume(as_bytes_f64(&self.positions));
        ctx.consume(as_bytes(&self.normals));
        ctx.consume(as_bytes_u32(&self.indices));
        ctx.compute().0
    }

    /// Drop vertex normals: smaller output, position-only welding in
    /// [`TriMesh::optimize`], flat shading in the viewer.
    pub fn drop_normals(&mut self) {
        self.normals.clear();
    }

    /// meshoptimizer pipeline: weld duplicate vertices, vertex-cache and
    /// vertex-fetch optimization. Without normals, welding is by position
    /// alone (face-boundary vertices merge too).
    pub fn optimize(&mut self) {
        // meshoptimizer's vertex-cache / fetch passes assume triangle indices.
        // Without the `optimize` feature this is a no-op — the mesh stays valid,
        // just un-welded (larger). Lets the wasm / capi builds drop the C++ dep.
        #[cfg(feature = "optimize")]
        self.optimize_meshopt();
    }

    #[cfg(feature = "optimize")]
    fn optimize_meshopt(&mut self) {
        if self.is_empty() || self.lines {
            return;
        }

        if self.normals.is_empty() {
            let verts: Vec<[f64; 3]> = self
                .positions
                .chunks(3)
                .map(|c| [c[0], c[1], c[2]])
                .collect();
            let (verts, indices) = meshopt_pipeline(&verts, &self.indices);
            self.positions.clear();
            for v in &verts {
                self.positions.extend_from_slice(v);
            }
            self.indices = indices;
            return;
        }

        // explicit `_pad` keeps the repr(C) layout free of hidden padding
        // bytes — the meshopt weld hashes vertices by their raw bytes
        #[repr(C)]
        #[derive(Clone, Copy, Default, PartialEq)]
        struct Vtx {
            p: [f64; 3],
            n: [f32; 3],
            _pad: f32,
        }

        let vcount = self.vertex_count();
        let mut verts: Vec<Vtx> = Vec::with_capacity(vcount);
        for i in 0..vcount {
            verts.push(Vtx {
                p: [
                    self.positions[i * 3],
                    self.positions[i * 3 + 1],
                    self.positions[i * 3 + 2],
                ],
                n: [
                    self.normals[i * 3],
                    self.normals[i * 3 + 1],
                    self.normals[i * 3 + 2],
                ],
                _pad: 0.0,
            });
        }
        let (verts, indices) = meshopt_pipeline(&verts, &self.indices);
        self.positions.clear();
        self.normals.clear();
        for vtx in &verts {
            self.positions.extend_from_slice(&vtx.p);
            self.normals.extend_from_slice(&vtx.n);
        }
        self.indices = indices;
    }

    /// meshopt_simplify toward `threshold * index_count` within
    /// `target_error` (border locked so shared seams keep their shape).
    /// Unlike [`TriMesh::cleanup_positions`] this keeps normals: surviving
    /// vertices are untouched, collapsed-away ones are removed.
    pub fn simplify(&mut self, threshold: f32, target_error: f32) {
        // no simplification without the meshoptimizer dependency
        #[cfg(not(feature = "optimize"))]
        let _ = (threshold, target_error);
        #[cfg(feature = "optimize")]
        self.simplify_meshopt(threshold, target_error);
    }

    #[cfg(feature = "optimize")]
    fn simplify_meshopt(&mut self, threshold: f32, target_error: f32) {
        if self.is_empty() || self.lines {
            return;
        }
        let target = (self.indices.len() as f32 * threshold) as usize;
        // meshopt's FFI wants f32 positions; decisions on the f32 copy are fine
        let pos32: Vec<f32> = self.positions.iter().map(|&v| v as f32).collect();
        let adapter =
            meshopt::VertexDataAdapter::new(as_bytes(&pos32), 12, 0).expect("vertex adapter");
        let idx = meshopt::simplify(
            &self.indices,
            &adapter,
            target,
            target_error,
            meshopt::SimplifyOptions::LockBorder,
            None,
        );

        // compact to the surviving vertices, preserving their normals
        let has_normals = !self.normals.is_empty();
        let mut remap: HashMap<u32, u32> = HashMap::new();
        let mut out_pos: Vec<f64> = Vec::new();
        let mut out_nrm: Vec<f32> = Vec::new();
        let mut out_idx: Vec<u32> = Vec::with_capacity(idx.len());
        for t in idx.chunks(3) {
            if t.len() < 3 || t[0] == t[1] || t[1] == t[2] || t[0] == t[2] {
                continue;
            }
            for &i in t {
                let next = (out_pos.len() / 3) as u32;
                let ni = *remap.entry(i).or_insert_with(|| {
                    let s = i as usize * 3;
                    out_pos.extend_from_slice(&self.positions[s..s + 3]);
                    if has_normals {
                        out_nrm.extend_from_slice(&self.normals[s..s + 3]);
                    }
                    next
                });
                out_idx.push(ni);
            }
        }
        self.positions = out_pos;
        self.normals = out_nrm;
        self.indices = out_idx;
    }

    /// rvm_parser_glb-style `--cleanup-position` pass: weld vertices on a
    /// quantized grid (`precision` decimals, file units), simplify with
    /// meshoptimizer (border locked so part seams stay put), drop degenerate
    /// triangles and compact the vertex pool. Normals are dropped — a vertex
    /// welded across faces no longer has a single valid normal; viewers
    /// compute their own (flat shading / derivatives), exactly as with
    /// rvm_parser_glb output.
    pub fn cleanup_positions(&mut self, precision: u32, threshold: f32, target_error: f32) {
        if self.is_empty() || self.lines {
            return;
        }
        self.normals.clear();

        let scale = 10f64.powi(precision as i32);
        let qkey = |p: [f64; 3]| {
            [
                (p[0] * scale).round() as i64,
                (p[1] * scale).round() as i64,
                (p[2] * scale).round() as i64,
            ]
        };
        let pos3 = |positions: &[f64], i: u32| -> [f64; 3] {
            let i = i as usize * 3;
            [positions[i], positions[i + 1], positions[i + 2]]
        };

        // 1) weld duplicate positions on the quantized grid
        let mut seen: HashMap<[i64; 3], u32> = HashMap::new();
        let mut pos: Vec<f64> = Vec::new();
        let mut idx: Vec<u32> = Vec::with_capacity(self.indices.len());
        for &i in &self.indices {
            let p = pos3(&self.positions, i);
            let next = (pos.len() / 3) as u32;
            let ni = *seen.entry(qkey(p)).or_insert_with(|| {
                pos.extend_from_slice(&p);
                next
            });
            idx.push(ni);
        }

        // 2) meshopt simplification toward threshold * index_count (skipped
        //    without the `optimize` feature; the weld + degenerate drop remain)
        #[cfg(feature = "optimize")]
        let idx = {
            let target = (idx.len() as f32 * threshold) as usize;
            let pos32: Vec<f32> = pos.iter().map(|&v| v as f32).collect();
            let adapter =
                meshopt::VertexDataAdapter::new(as_bytes(&pos32), 12, 0).expect("vertex adapter");
            meshopt::simplify(
                &idx,
                &adapter,
                target,
                target_error,
                meshopt::SimplifyOptions::LockBorder,
                None,
            )
        };
        #[cfg(not(feature = "optimize"))]
        let _ = (threshold, target_error);

        // 3) drop degenerate triangles (repeated index, coincident positions,
        //    near-zero area) and 4) compact the pool to first-use order
        let mut remap: HashMap<u32, u32> = HashMap::new();
        let mut out_pos: Vec<f64> = Vec::new();
        let mut out_idx: Vec<u32> = Vec::with_capacity(idx.len());
        for t in idx.chunks(3) {
            if t.len() < 3 || t[0] == t[1] || t[1] == t[2] || t[0] == t[2] {
                continue;
            }
            let (a, b, c) = (pos3(&pos, t[0]), pos3(&pos, t[1]), pos3(&pos, t[2]));
            if a == b || b == c || c == a {
                continue;
            }
            let ab = v3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
            let ac = v3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
            if ab.cross(ac).len() * 0.5 < 1e-8 {
                continue;
            }
            for &i in t {
                let next = (out_pos.len() / 3) as u32;
                let ni = *remap.entry(i).or_insert_with(|| {
                    out_pos.extend_from_slice(&pos3(&pos, i));
                    next
                });
                out_idx.push(ni);
            }
        }
        self.positions = out_pos;
        self.indices = out_idx;
    }

    pub fn bounds(&self) -> ([f64; 3], [f64; 3]) {
        let mut mn = [f64::MAX; 3];
        let mut mx = [f64::MIN; 3];
        for c in self.positions.chunks(3) {
            for k in 0..3 {
                mn[k] = mn[k].min(c[k]);
                mx[k] = mx[k].max(c[k]);
            }
        }
        if self.positions.is_empty() {
            (mn, mx) = ([0.0; 3], [0.0; 3]);
        }
        (mn, mx)
    }

    /// Translate every position by `-c` (f64 math per component). Normals are
    /// direction vectors and are unaffected.
    pub fn translate_by_neg(&mut self, c: V3) {
        for p in self.positions.chunks_mut(3) {
            p[0] -= c.x;
            p[1] -= c.y;
            p[2] -= c.z;
        }
    }
}

/// Shared meshoptimizer pass: weld identical vertices, drop the degenerate
/// triangles welding produces, then vertex-cache and vertex-fetch optimize.
#[cfg(feature = "optimize")]
fn meshopt_pipeline<T: Clone + Copy + Default>(verts: &[T], indices: &[u32]) -> (Vec<T>, Vec<u32>) {
    // 1) weld identical vertices
    let (unique, remap) = meshopt::generate_vertex_remap(verts, Some(indices));
    let indices = meshopt::remap_index_buffer(Some(indices), indices.len(), &remap);
    let verts = meshopt::remap_vertex_buffer(verts, unique, &remap);

    // 1b) welding collapses zero-area slivers into degenerate triangles
    // (repeated indices) — drop them
    let mut compact: Vec<u32> = Vec::with_capacity(indices.len());
    for t in indices.chunks(3) {
        if t.len() == 3 && t[0] != t[1] && t[1] != t[2] && t[0] != t[2] {
            compact.extend_from_slice(t);
        }
    }

    // 2) vertex cache locality
    let mut indices = meshopt::optimize_vertex_cache(&compact, unique);

    // 3) vertex fetch locality (reorders vertex buffer, rewrites indices)
    let verts = meshopt::optimize_vertex_fetch(&mut indices, &verts);
    (verts, indices)
}

pub fn as_bytes_f64(v: &[f64]) -> &[u8] {
    unsafe { std::slice::from_raw_parts(v.as_ptr().cast::<u8>(), v.len() * 8) }
}
pub fn as_bytes(v: &[f32]) -> &[u8] {
    unsafe { std::slice::from_raw_parts(v.as_ptr().cast::<u8>(), v.len() * 4) }
}
pub fn as_bytes_u32(v: &[u32]) -> &[u8] {
    unsafe { std::slice::from_raw_parts(v.as_ptr().cast::<u8>(), v.len() * 4) }
}

// ----------------------------------------------------------------- mesh set

/// Geometry of one part, bucketed by color (from STYLED_ITEM presentation).
/// Each bucket becomes one glTF primitive with its own material.
#[derive(Default, Clone)]
pub struct MeshSet {
    pub parts: Vec<(Option<[f32; 4]>, TriMesh)>,
}

impl MeshSet {
    pub fn bucket(&mut self, color: Option<[f32; 4]>) -> &mut TriMesh {
        let key = color.map(quantize_color);
        if let Some(i) = self
            .parts
            .iter()
            .position(|(c, m)| !m.lines && c.map(quantize_color) == key)
        {
            return &mut self.parts[i].1;
        }
        self.parts.push((color, TriMesh::default()));
        &mut self.parts.last_mut().unwrap().1
    }

    /// A wireframe (line-topology) bucket for `color`, kept separate from the
    /// triangle bucket of the same colour so the two are never merged.
    pub fn line_bucket(&mut self, color: Option<[f32; 4]>) -> &mut TriMesh {
        let key = color.map(quantize_color);
        if let Some(i) = self
            .parts
            .iter()
            .position(|(c, m)| m.lines && c.map(quantize_color) == key)
        {
            return &mut self.parts[i].1;
        }
        self.parts.push((
            color,
            TriMesh {
                lines: true,
                ..Default::default()
            },
        ));
        &mut self.parts.last_mut().unwrap().1
    }

    pub fn is_empty(&self) -> bool {
        self.parts.iter().all(|(_, m)| m.is_empty())
    }

    pub fn vertex_count(&self) -> usize {
        self.parts.iter().map(|(_, m)| m.vertex_count()).sum()
    }

    pub fn triangle_count(&self) -> usize {
        self.parts.iter().map(|(_, m)| m.triangle_count()).sum()
    }

    pub fn transform(&mut self, m: &M4) {
        for (_, t) in &mut self.parts {
            t.transform(m);
        }
    }

    /// Translate the whole set so its bounding-box centre lands at the origin
    /// and return the removed centre. Keeping vertex coordinates near the
    /// origin preserves f32 precision in the GLB (glTF positions are f32; a
    /// part authored ~1e6 units from origin quantizes at ~0.06 units) — the
    /// centre goes back on the part's node as a translation, where it lives in
    /// full precision. Also makes translated duplicates byte-identical, so
    /// they dedup into one instanced mesh.
    pub fn recenter(&mut self) -> V3 {
        let mut mn = [f64::MAX; 3];
        let mut mx = [f64::MIN; 3];
        for (_, m) in &self.parts {
            if m.positions.is_empty() {
                continue;
            }
            let (lo, hi) = m.bounds();
            for k in 0..3 {
                mn[k] = mn[k].min(lo[k]);
                mx[k] = mx[k].max(hi[k]);
            }
        }
        if mn[0] > mx[0] {
            return V3::ZERO;
        }
        let c = v3(
            (mn[0] + mx[0]) * 0.5,
            (mn[1] + mx[1]) * 0.5,
            (mn[2] + mx[2]) * 0.5,
        );
        for (_, m) in &mut self.parts {
            m.translate_by_neg(c);
        }
        c
    }

    pub fn append(&mut self, o: &MeshSet) {
        for (c, m) in &o.parts {
            if m.lines {
                self.line_bucket(*c).append(m);
            } else {
                self.bucket(*c).append(m);
            }
        }
    }

    pub fn optimize(&mut self) {
        self.parts.retain(|(_, m)| !m.is_empty());
        for (_, m) in &mut self.parts {
            m.optimize();
        }
    }

    pub fn drop_normals(&mut self) {
        for (_, m) in &mut self.parts {
            m.drop_normals();
        }
    }

    /// Simplify every color bucket, keeping normals; buckets emptied by the
    /// degenerate filter are dropped.
    pub fn simplify(&mut self, threshold: f32, target_error: f32) {
        for (_, m) in &mut self.parts {
            m.simplify(threshold, target_error);
        }
        self.parts.retain(|(_, m)| !m.is_empty());
    }

    /// rvm-style position cleanup on every color bucket; buckets emptied by
    /// the degenerate sweep are dropped.
    pub fn cleanup_positions(&mut self, precision: u32, threshold: f32, target_error: f32) {
        for (_, m) in &mut self.parts {
            m.cleanup_positions(precision, threshold, target_error);
        }
        self.parts.retain(|(_, m)| !m.is_empty());
    }

    /// md5 over all buckets (colors + geometry) — the dedup/instancing key.
    pub fn content_hash(&self) -> [u8; 16] {
        let mut ctx = md5::Context::new();
        for (c, m) in &self.parts {
            match c {
                Some(c) => {
                    ctx.consume([1u8]);
                    ctx.consume(quantize_color(*c));
                }
                None => ctx.consume([0u8; 5]),
            }
            ctx.consume(m.content_hash());
        }
        ctx.compute().0
    }

    /// Flatten into one TriMesh (used by tests/measurements).
    /// Flatten the triangle buckets into one mesh. Line (wireframe) buckets are
    /// skipped — a single `TriMesh` is triangle topology and can't carry both.
    pub fn merged(&self) -> TriMesh {
        let mut out = TriMesh::default();
        for (_, m) in &self.parts {
            if !m.lines {
                out.append(m);
            }
        }
        out
    }
}

pub(crate) fn quantize_color(c: [f32; 4]) -> [u8; 4] {
    [
        (c[0].clamp(0.0, 1.0) * 255.0).round() as u8,
        (c[1].clamp(0.0, 1.0) * 255.0).round() as u8,
        (c[2].clamp(0.0, 1.0) * 255.0).round() as u8,
        (c[3].clamp(0.0, 1.0) * 255.0).round() as u8,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn quad() -> TriMesh {
        let mut m = TriMesh::default();
        // two triangles sharing an edge, with duplicated shared vertices
        let n = v3(0.0, 0.0, 1.0);
        m.push_vertex(v3(0.0, 0.0, 0.0), n);
        m.push_vertex(v3(1.0, 0.0, 0.0), n);
        m.push_vertex(v3(1.0, 1.0, 0.0), n);
        m.push_vertex(v3(0.0, 0.0, 0.0), n); // dup of 0
        m.push_vertex(v3(1.0, 1.0, 0.0), n); // dup of 2
        m.push_vertex(v3(0.0, 1.0, 0.0), n);
        m.indices.extend_from_slice(&[0, 1, 2, 3, 4, 5]);
        m
    }

    #[test]
    fn optimize_welds_duplicate_vertices() {
        let mut m = quad();
        m.optimize();
        assert_eq!(m.vertex_count(), 4);
        assert_eq!(m.triangle_count(), 2);
    }

    #[test]
    fn optimize_drops_degenerate_triangles() {
        let mut m = quad();
        // a sliver: all three vertices coincide after welding
        m.indices.extend_from_slice(&[0, 3, 0]);
        m.optimize();
        assert_eq!(m.triangle_count(), 2);
    }

    #[test]
    fn optimize_without_normals_welds_by_position() {
        let mut m = quad();
        // give the duplicated corners different normals: with normals they
        // cannot weld, without them they must
        m.normals[10] = 1.0; // dup of v0, normal now (0,1,1)
        let mut with_normals = m.clone();
        with_normals.optimize();
        assert_eq!(with_normals.vertex_count(), 5);

        m.drop_normals();
        m.optimize();
        assert!(m.normals.is_empty());
        assert_eq!(m.vertex_count(), 4, "position-only weld merges corners");
        assert_eq!(m.triangle_count(), 2);
        assert!(m.indices.iter().all(|&i| (i as usize) < m.vertex_count()));
    }

    #[test]
    fn cleanup_positions_welds_quantized_drops_normals_and_degenerates() {
        let mut m = quad();
        // perturb the duplicated vertices by less than the precision-3 grid
        // (10^-3): bit-exact welding misses them, quantized welding must not
        m.positions[9] += 2e-4; // dup of v0
        m.positions[13] += 2e-4; // dup of v2
                                 // a sliver that collapses to zero area on the grid
        m.indices.extend_from_slice(&[0, 3, 0]);

        m.cleanup_positions(3, 1.0, 0.0);

        assert!(m.normals.is_empty(), "cleanup drops normals");
        assert_eq!(m.vertex_count(), 4, "near-duplicates weld on the grid");
        assert_eq!(m.triangle_count(), 2, "degenerate sliver dropped");
        assert!(m.indices.iter().all(|&i| (i as usize) < m.vertex_count()));
    }

    /// A dense flat grid: simplification can collapse interior vertices
    /// without any shape error.
    fn flat_grid(dim: u32) -> TriMesh {
        let mut m = TriMesh::default();
        let n = v3(0.0, 0.0, 1.0);
        for y in 0..dim {
            for x in 0..dim {
                m.push_vertex(v3(x as f64, y as f64, 0.0), n);
            }
        }
        for y in 0..dim - 1 {
            for x in 0..dim - 1 {
                let a = y * dim + x;
                m.indices
                    .extend_from_slice(&[a, a + 1, a + dim, a + 1, a + dim + 1, a + dim]);
            }
        }
        m
    }

    #[test]
    fn cleanup_positions_simplify_reduces_dense_planar_mesh() {
        let mut m = flat_grid(11);
        let before = m.triangle_count();
        m.cleanup_positions(3, 0.5, 0.01);
        assert!(m.triangle_count() < before, "flat grid must simplify");
        assert_eq!(m.indices.len() % 3, 0);
        assert!(m.indices.iter().all(|&i| (i as usize) < m.vertex_count()));
    }

    #[test]
    fn standalone_simplify_reduces_and_keeps_normals() {
        let mut m = flat_grid(11);
        let before = m.triangle_count();
        m.simplify(0.5, 0.01);
        assert!(m.triangle_count() < before, "flat grid must simplify");
        assert_eq!(
            m.normals.len(),
            m.positions.len(),
            "normals must survive simplification"
        );
        for n in m.normals.chunks(3) {
            assert!((n[2] - 1.0).abs() < 1e-6, "normal {:?}", n);
        }
        assert!(m.indices.iter().all(|&i| (i as usize) < m.vertex_count()));
    }

    #[test]
    fn content_hash_distinguishes_geometry() {
        let a = quad();
        let b = quad();
        assert_eq!(a.content_hash(), b.content_hash());
        let mut c = quad();
        c.positions[0] += 0.5;
        assert_ne!(a.content_hash(), c.content_hash());
    }

    #[test]
    fn transform_moves_points_and_rotates_normals() {
        use crate::geom::Frame;
        let mut m = quad();
        // rotate 90° about x: z normal -> y... build frame with z = (0,1,0)
        let f = Frame::new(
            v3(0.0, 0.0, 10.0),
            Some(v3(0.0, -1.0, 0.0)),
            Some(v3(1.0, 0.0, 0.0)),
        );
        m.transform(&f.to_m4());
        assert!((m.positions[2] - 10.0).abs() < 1e-6); // translated
        assert!((m.normals[1] - -1.0).abs() < 1e-6); // normal now -y
    }

    #[test]
    fn missing_normals_get_area_weighted_face_normals() {
        let mut m = TriMesh::default();
        m.push_vertex(v3(0.0, 0.0, 0.0), V3::ZERO);
        m.push_vertex(v3(1.0, 0.0, 0.0), V3::ZERO);
        m.push_vertex(v3(0.0, 1.0, 0.0), V3::ZERO);
        m.indices.extend_from_slice(&[0, 1, 2]);
        m.compute_missing_normals(0, 0);
        assert!((m.normals[2] - 1.0).abs() < 1e-6); // +z
    }
}
