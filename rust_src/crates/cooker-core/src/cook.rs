//! Single-pass GLB → packed `.model` (CADM v7) conversion.
//!
//! Port of the reference cooker (vulkan_reference/crates/cad-cooker/cook.rs),
//! byte-compatible with its output. Differences: sequential instead of rayon
//! (wasm is single-threaded), our own light GLB reader (glb.rs) instead of the
//! `gltf` crate, and normals are OPT-IN (`CookOptions::compute_normals`) — the
//! web viewer never reads them, so the default skips the work and the bytes.

use anyhow::{anyhow, Context, Result};
use bytemuck::Zeroable;
use cad_format::{
    CellEntry, ColorGroupHeader, HierarchyEntry as FmtHierEntry, HierarchySectionHeader,
    IdItemEntry, ItemsSectionHeader, MeshletBounds, MeshletDesc, ModelFileHeader, CELL_COUNT,
    FORMAT_VERSION, MAGIC,
};

use crate::glb;

// Meshlet build parameters — identical to the reference cooker.
const MAX_VERTICES: usize = 64;
const MAX_TRIANGLES: usize = 124;
const CONE_WEIGHT: f32 = 0.5;

#[derive(Clone, Copy)]
pub struct CookOptions {
    /// Compute smooth vertex normals and write the octahedral normal stream.
    /// Off by default: the web renderer is flat-shaded from positions only.
    pub compute_normals: bool,
    /// Write FORMAT v8: the 10th–90th percentile "dense bounds" appended to
    /// the header (+24 bytes), so load can frame "where 80% of the mesh is"
    /// for free. Off = byte-identical v7 (the reference cooker's output).
    pub dense_bounds: bool,
    /// Produce a COARSE variant: aggressive per-item simplification + tiny-item
    /// culling for the VRAM-budget residency swap. The item table, hierarchy,
    /// and draw-range order stay identical to the full cook by construction —
    /// only index/meshlet data shrinks. None = normal full-detail cook.
    pub coarsen: Option<CoarsenOptions>,
    /// Order the DENSE item indices spatially (2-level octree, ≤73 cells) so
    /// each cell owns a contiguous id range — the basis for range-based
    /// partial residency (DESIGN.md "Cooked format"). Source ids and the id→item
    /// table are unaffected, so hierarchy/selection/colour semantics do not
    /// change; only the packing order does.
    pub spatial_order: bool,
}

// 2-level octree: root (everything that spans the model), 2×2×2, then 4×4×4.
// Only two levels on purpose — cells stay large, so per-cell colour-merge
// pools stay big and meshlet fill barely moves.
const L1_DIM: usize = 2;
const L2_DIM: usize = 4;
const CELL_ROOT: u32 = 0;
const CELL_L1_BASE: u32 = 1; // 1..=8
const CELL_L2_BASE: u32 = CELL_L1_BASE + (L1_DIM * L1_DIM * L1_DIM) as u32; // 9..=72

/// Grid coordinate of `v` along one axis, clamped into `0..dim`.
fn axis_cell(v: f32, min: f32, extent: f32, dim: usize) -> usize {
    if extent <= 0.0 {
        return 0;
    }
    (((v - min) / extent * dim as f32) as isize).clamp(0, dim as isize - 1) as usize
}

/// The deepest cell that FULLY contains this box: level 2 when the box does
/// not straddle a level-2 boundary, else level 1, else the root. Zone-spanning
/// outliers therefore land at the root instead of inflating a leaf.
fn cell_of(bx: &([f32; 3], [f32; 3]), min: [f32; 3], extent: [f32; 3]) -> u32 {
    let (bmin, bmax) = bx;
    if !bmin[0].is_finite() || !bmax[0].is_finite() {
        return CELL_ROOT; // item without geometry
    }
    for (dim, base) in [(L2_DIM, CELL_L2_BASE), (L1_DIM, CELL_L1_BASE)] {
        let lo: Vec<usize> = (0..3)
            .map(|k| axis_cell(bmin[k], min[k], extent[k], dim))
            .collect();
        let hi: Vec<usize> = (0..3)
            .map(|k| axis_cell(bmax[k], min[k], extent[k], dim))
            .collect();
        if lo == hi {
            return base + (lo[0] + lo[1] * dim + lo[2] * dim * dim) as u32;
        }
    }
    CELL_ROOT
}

/// Per-draw-range world AABBs, computed from the FULL geometry BEFORE any
/// coarsening — both variants must bin items identically or their item tables
/// would diverge, which the viewer's in-place variant swap forbids.
fn item_boxes_of(color_groups: &[ColorGroup]) -> Vec<Vec<([f32; 3], [f32; 3])>> {
    color_groups
        .iter()
        .map(|cg| {
            (0..cg.dr_ids.len())
                .map(|d| {
                    let s = cg.dr_starts[d] as usize;
                    let n = cg.dr_counts[d] as usize;
                    let mut mn = [f32::INFINITY; 3];
                    let mut mx = [f32::NEG_INFINITY; 3];
                    for &i in &cg.indices[s..s + n] {
                        let p = cg.positions[i as usize];
                        for k in 0..3 {
                            mn[k] = mn[k].min(p[k]);
                            mx[k] = mx[k].max(p[k]);
                        }
                    }
                    (mn, mx)
                })
                .collect()
        })
        .collect()
}

impl Default for CookOptions {
    fn default() -> Self {
        Self {
            compute_normals: false,
            dense_bounds: true,
            coarsen: None,
            spatial_order: true,
        }
    }
}

#[derive(Clone, Copy)]
pub struct CoarsenOptions {
    /// Target index-count ratio per draw range (0..1).
    pub ratio: f32,
    /// ABSOLUTE simplification error budget in world units (meters): every
    /// item may deviate by at most this much, regardless of its size — a long
    /// pipe run is not allowed proportionally more error than a small plate,
    /// so the outer figure survives uniformly while curved detail collapses.
    pub target_error_abs: f32,
    /// Items whose AABB diagonal is below this fraction of the model diagonal
    /// are cut entirely (zero triangles) — invisible at the distances where
    /// the coarse variant is shown.
    pub min_item_diag_frac: f32,
}

impl Default for CoarsenOptions {
    fn default() -> Self {
        Self {
            ratio: 0.05,
            target_error_abs: 0.03,
            min_item_diag_frac: 0.005,
        }
    }
}

pub struct CookOutput {
    pub bytes: Vec<u8>,
    /// Hierarchy root name (entry with parent "*") — the web viewer's asset name.
    pub root_name: String,
}

struct DrawRangeRaw {
    id: u32,
    index_start: usize,
    index_count: usize,
    node_index: usize,
}

struct ColorGroup {
    base_color: [f32; 4],
    positions: Vec<[f32; 3]>,
    indices: Vec<u32>,
    dr_ids: Vec<u32>,
    dr_starts: Vec<u32>,
    dr_counts: Vec<u32>,
    dr_meshlet_starts: Vec<u32>,
    dr_meshlet_counts: Vec<u32>,
    meshlet_descs: Vec<MeshletDesc>,
    meshlet_verts: Vec<u32>,
    meshlet_tris: Vec<u8>,
    meshlet_bounds: Vec<MeshletBounds>,
    normals: Vec<[f32; 3]>,
    meshlet_positions: Vec<u8>,
    meshlet_normals: Vec<u8>,
}

/// A model handed to the cooker in memory: merged single-material nodes plus
/// the id hierarchy. This is the cooker's real input — [`cook`] is just the
/// adapter that decodes a merged GLB into one of these.
///
/// Constraints the caller must honour (they mirror what the merged GLB carried):
/// - `positions` are WORLD-space and **Z-up** (glTF Y-up input must be rotated
///   `[x, y, z] -> [x, -z, y]` first, exactly as [`cook`] does).
/// - every `MergedRange` indexes into its own node's `indices`.
/// - every range id appears in `hierarchy`, and exactly one entry is a root
///   (`parent_id == None`) — its name becomes the asset name.
///
/// Node order defines colour-group order in the packed file, so a caller that
/// wants byte-identical output to the GLB path must emit nodes in ascending
/// glTF node index. Draw ranges and hierarchy are normalised by the cooker.
#[derive(Clone)]
pub struct MergedModel {
    pub nodes: Vec<MergedNode>,
    pub hierarchy: Vec<MergedHierarchyEntry>,
}

/// One merged node: a single-material geometry blob and the items inside it.
#[derive(Clone)]
pub struct MergedNode {
    pub base_color: [f32; 4],
    pub positions: Vec<[f32; 3]>,
    pub indices: Vec<u32>,
    pub draw_ranges: Vec<MergedRange>,
}

/// One item's index span inside its node.
#[derive(Clone)]
pub struct MergedRange {
    pub id: u32,
    pub index_start: u32,
    pub index_count: u32,
}

/// One hierarchy entry; `parent_id: None` marks a root.
#[derive(Clone)]
pub struct MergedHierarchyEntry {
    pub id: u32,
    pub name: String,
    pub parent_id: Option<u32>,
}

/// Cook one merged GLB into packed `.model` bytes.
///
/// Decodes the GLB into a [`MergedModel`] and defers to [`cook_model`]; the
/// converters (RVM / IFC / STEP) skip this and build the model directly.
pub fn cook(glb_bytes: &[u8], opts: CookOptions) -> Result<CookOutput> {
    cook_model(model_from_merged_glb(glb_bytes)?, opts)
}

/// Decode a merged GLB (`web3dversion: 2`) into the cooker's in-memory model.
fn model_from_merged_glb(glb_bytes: &[u8]) -> Result<MergedModel> {
    let glb = glb::parse_glb(glb_bytes)?;

    // 1. Extras (draw_ranges + hierarchy) — also the merged magic check.
    let (draw_ranges_raw, hierarchy) = parse_extras(&glb.json)?;

    // 2. Geometry per node, rotated glTF Y-up → Z-up at cook time.
    let mut node_geometry: std::collections::HashMap<usize, (Vec<[f32; 3]>, Vec<u32>, [f32; 4])> =
        Default::default();
    for g in glb::node_geometries(&glb)? {
        let positions = g.positions.iter().map(|&[x, y, z]| [x, -z, y]).collect();
        node_geometry.insert(g.node_index, (positions, g.indices, g.base_color));
    }

    // 3. One node (→ one color group) per node index referenced by the ranges.
    let mut node_indices: Vec<usize> = draw_ranges_raw.iter().map(|dr| dr.node_index).collect();
    node_indices.sort_unstable();
    node_indices.dedup();

    let mut nodes = Vec::with_capacity(node_indices.len());
    for &node_index in &node_indices {
        let (positions, indices, base_color) =
            node_geometry.remove(&node_index).ok_or_else(|| {
                anyhow!("node{node_index} referenced in draw_ranges but has no geometry")
            })?;
        let draw_ranges = draw_ranges_raw
            .iter()
            .filter(|dr| dr.node_index == node_index)
            .map(|dr| MergedRange {
                id: dr.id,
                index_start: dr.index_start as u32,
                index_count: dr.index_count as u32,
            })
            .collect();
        nodes.push(MergedNode {
            base_color,
            positions,
            indices,
            draw_ranges,
        });
    }

    Ok(MergedModel { nodes, hierarchy })
}

/// Cook an in-memory [`MergedModel`] into packed `.model` bytes.
pub fn cook_model(model: MergedModel, opts: CookOptions) -> Result<CookOutput> {
    let MergedModel {
        nodes,
        mut hierarchy,
    } = model;
    anyhow::ensure!(
        nodes.iter().any(|n| !n.draw_ranges.is_empty()),
        "merged model has no draw ranges"
    );

    // Hierarchy order decides the packed name pool and parent indices. Sort by
    // the id's STRING form: that is the order a merged GLB's `id_hierarchy`
    // JSON object already iterates in (serde_json map = BTreeMap), so this
    // normalisation is a no-op for the GLB path and makes a direct caller's
    // output byte-identical to it.
    hierarchy.sort_by(|a, b| a.id.to_string().cmp(&b.id.to_string()));
    let root_name = hierarchy
        .iter()
        .find(|h| h.parent_id.is_none())
        .map(|h| h.name.clone())
        .ok_or_else(|| anyhow!("hierarchy has no root entry (parent == \"*\")"))?;

    let mut color_groups: Vec<ColorGroup> = Vec::with_capacity(nodes.len());
    for node in nodes {
        let MergedNode {
            base_color,
            positions,
            indices,
            mut draw_ranges,
        } = node;
        draw_ranges.sort_by_key(|dr| dr.id);

        let mut dr_ids = Vec::with_capacity(draw_ranges.len());
        let mut dr_starts = Vec::with_capacity(draw_ranges.len());
        let mut dr_counts = Vec::with_capacity(draw_ranges.len());
        for dr in &draw_ranges {
            dr_ids.push(dr.id);
            dr_starts.push(dr.index_start);
            dr_counts.push(dr.index_count);
        }

        color_groups.push(ColorGroup {
            base_color,
            positions,
            indices,
            dr_ids,
            dr_starts,
            dr_counts,
            dr_meshlet_starts: Vec::new(),
            dr_meshlet_counts: Vec::new(),
            meshlet_descs: Vec::new(),
            meshlet_verts: Vec::new(),
            meshlet_tris: Vec::new(),
            meshlet_bounds: Vec::new(),
            normals: Vec::new(),
            meshlet_positions: Vec::new(),
            meshlet_normals: Vec::new(),
        });
    }

    // 3.2 Per-item world AABBs, taken from the FULL geometry before the
    // coarsen pass rewrites indices — the coarse cook must bin items exactly
    // as the full cook does, or the two item tables would diverge.
    let mut item_boxes = opts.spatial_order.then(|| item_boxes_of(&color_groups));

    // 3.3 Order each colour group's DRAW RANGES by (cell, id) too. Meshlets
    // are built per draw range, so this is what makes a cell's meshlets — and
    // therefore its vertex/index bytes — a contiguous run inside each group,
    // which is the whole point of the ranges format.
    let mut cell_of_item: Vec<Vec<u32>> = Vec::new();
    if let Some(boxes) = &mut item_boxes {
        let (bmin, bmax) = compute_bounds(&color_groups);
        let extent = [bmax[0] - bmin[0], bmax[1] - bmin[1], bmax[2] - bmin[2]];
        for (cg, cg_boxes) in color_groups.iter_mut().zip(boxes.iter_mut()) {
            let n = cg.dr_ids.len();
            let mut order: Vec<usize> = (0..n).collect();
            order.sort_by_key(|&d| (cell_of(&cg_boxes[d], bmin, extent), cg.dr_ids[d]));
            let permute = |src: &Vec<u32>| -> Vec<u32> { order.iter().map(|&d| src[d]).collect() };
            cg.dr_ids = permute(&cg.dr_ids);
            cg.dr_starts = permute(&cg.dr_starts);
            cg.dr_counts = permute(&cg.dr_counts);
            *cg_boxes = order.iter().map(|&d| cg_boxes[d]).collect();
            cell_of_item.push(cg_boxes.iter().map(|b| cell_of(b, bmin, extent)).collect());
        }
    }

    // 3.25 Coarse variant: simplify/cull per draw range BEFORE meshletizing.
    // Runs on the same color groups the full cook sees, so items/hierarchy
    // below are untouched and both variants' tables match exactly.
    if let Some(c) = opts.coarsen {
        // Tiny-item cut threshold scales with the DENSE (10th–90th pct)
        // diagonal, not the full box: one outlier item inflates the full box
        // by an order of magnitude (observed: 165 m dense vs 866 m full), and
        // with it the cut threshold — gutting the coarse variant of every
        // normal-sized item in the zone. Dense ≤ full always, so this only
        // ever cuts fewer items.
        let (bmin, bmax) = compute_dense_bounds(&color_groups);
        let model_diag = ((bmax[0] - bmin[0]).powi(2)
            + (bmax[1] - bmin[1]).powi(2)
            + (bmax[2] - bmin[2]).powi(2))
        .sqrt();
        for cg in &mut color_groups {
            coarsen_cg(cg, model_diag, c);
        }
    }

    // 3.5 Meshletize + (optional) normals + quantize.
    for cg in &mut color_groups {
        meshletize_cg(cg)?;
        if opts.compute_normals {
            cg.normals = compute_vertex_normals(&cg.positions, &cg.indices);
        }
        build_quantized_streams(cg);
    }

    // 4. Global item list (all draw ranges sorted by id).
    let mut all_items: Vec<(u32, u16, u32)> = Vec::new();
    for (cg_idx, cg) in color_groups.iter().enumerate() {
        for (dr_idx, &dr_id) in cg.dr_ids.iter().enumerate() {
            all_items.push((dr_id, cg_idx as u16, dr_idx as u32));
        }
    }
    // Dense packing order: spatially binned (cell, then id) when enabled, so
    // each octree cell owns a CONTIGUOUS id range; plain id order otherwise.
    // The id→item table below is rebuilt from this order, so source ids,
    // hierarchy and per-item state stay correct under either.
    let mut cell_table: Vec<CellEntry> = Vec::new();
    if let Some(boxes) = &item_boxes {
        all_items.sort_by_key(|&(id, cg, dr)| (cell_of_item[cg as usize][dr as usize], id));
        // Each cell now owns a CONTIGUOUS item range. Record it with the union
        // AABB of the items actually in it — tighter, and immune to the grid
        // cell's own (arbitrary) bounds.
        cell_table = vec![CellEntry::zeroed(); CELL_COUNT as usize];
        for e in &mut cell_table {
            e.aabb_min = [f32::INFINITY; 3];
            e.aabb_max = [f32::NEG_INFINITY; 3];
        }
        for (item_idx, &(_, cg, dr)) in all_items.iter().enumerate() {
            let e = &mut cell_table[cell_of_item[cg as usize][dr as usize] as usize];
            if e.item_count == 0 {
                e.item_start = item_idx as u32;
            }
            e.item_count += 1;
            let (mn, mx) = boxes[cg as usize][dr as usize];
            if mn[0].is_finite() {
                for k in 0..3 {
                    e.aabb_min[k] = e.aabb_min[k].min(mn[k]);
                    e.aabb_max[k] = e.aabb_max[k].max(mx[k]);
                }
            }
        }
        for e in &mut cell_table {
            if !e.aabb_min[0].is_finite() {
                e.aabb_min = [0.0; 3];
                e.aabb_max = [0.0; 3];
            }
        }
    } else {
        all_items.sort_by_key(|(id, ..)| *id);
    }
    let item_count = all_items.len() as u32;

    // 5. Hierarchy section data.
    let id_to_hier_idx: std::collections::HashMap<u32, u32> = hierarchy
        .iter()
        .enumerate()
        .map(|(i, h)| (h.id, i as u32))
        .collect();

    let mut name_pool: Vec<u8> = Vec::new();
    let mut fmt_hier_entries: Vec<FmtHierEntry> = Vec::with_capacity(hierarchy.len());
    for h in &hierarchy {
        let name_offset = name_pool.len() as u32;
        let name_bytes = h.name.as_bytes();
        name_pool.extend_from_slice(name_bytes);
        let parent_index = match h.parent_id {
            None => FmtHierEntry::NO_PARENT,
            Some(pid) => *id_to_hier_idx
                .get(&pid)
                .ok_or_else(|| anyhow!("hierarchy entry {}: parent_id {pid} not found", h.id))?,
        };
        fmt_hier_entries.push(FmtHierEntry {
            id: h.id,
            name_offset,
            parent_index,
            name_len: name_bytes.len() as u16,
            _pad: 0,
        });
    }

    let mut id_item_table: Vec<IdItemEntry> = all_items
        .iter()
        .enumerate()
        .map(|(item_idx, (id, ..))| IdItemEntry {
            id: *id,
            item_index: item_idx as u32,
        })
        .collect();
    id_item_table.sort_by_key(|e| e.id);

    // 6. Pack.
    let dense = if opts.dense_bounds {
        Some(compute_dense_bounds(&color_groups))
    } else {
        None
    };
    let bytes = pack_binary(
        dense,
        &color_groups,
        &all_items,
        item_count,
        &fmt_hier_entries,
        &name_pool,
        &id_item_table,
        &root_name,
        &cell_table,
    )?;
    Ok(CookOutput { bytes, root_name })
}

// ── Coarse-variant simplification ─────────────────────────────────────────────

/// Rebuild a color group's index stream with per-draw-range simplification and
/// tiny-item culling. Draw-range COUNT and ORDER are preserved — cut/emptied
/// ranges keep their entry at zero count, so the item table built from
/// `dr_ids` (and with it item ids, hierarchy, and per-item state slots) is
/// identical to the full cook's. Each range is simplified independently
/// (Sparse: indices are a subset of the group's vertices) against an ABSOLUTE
/// error budget, so a plate keeps its plate-ness while dense curved
/// tessellation collapses hard; Prune drops disconnected slivers. Positions
/// are left untouched — the packed file only
/// stores per-meshlet vertex data, and model/dense bounds must match the full
/// variant so framing and residency priorities agree.
fn coarsen_cg(cg: &mut ColorGroup, model_diag: f32, c: CoarsenOptions) {
    let vertex_bytes: &[u8] = bytemuck::cast_slice::<[f32; 3], u8>(&cg.positions);
    let adapter = match meshopt::VertexDataAdapter::new(vertex_bytes, 12, 0) {
        Ok(a) => a,
        Err(_) => return,
    };

    let mut new_indices: Vec<u32> = Vec::new();
    let mut new_starts: Vec<u32> = Vec::with_capacity(cg.dr_starts.len());
    let mut new_counts: Vec<u32> = Vec::with_capacity(cg.dr_counts.len());
    for di in 0..cg.dr_ids.len() {
        let start = cg.dr_starts[di] as usize;
        let count = cg.dr_counts[di] as usize;
        new_starts.push(new_indices.len() as u32);
        if count == 0 {
            new_counts.push(0);
            continue;
        }
        let dr_indices = &cg.indices[start..start + count];

        let mut amin = [f32::INFINITY; 3];
        let mut amax = [f32::NEG_INFINITY; 3];
        for &i in dr_indices {
            let p = cg.positions[i as usize];
            for k in 0..3 {
                amin[k] = amin[k].min(p[k]);
                amax[k] = amax[k].max(p[k]);
            }
        }
        let diag = ((amax[0] - amin[0]).powi(2)
            + (amax[1] - amin[1]).powi(2)
            + (amax[2] - amin[2]).powi(2))
        .sqrt();
        if diag < c.min_item_diag_frac * model_diag {
            new_counts.push(0);
            continue;
        }

        let target = ((count as f32 * c.ratio) as usize / 3).max(1) * 3;
        let simplified = meshopt::simplify(
            dr_indices,
            &adapter,
            target,
            c.target_error_abs,
            meshopt::SimplifyOptions::Sparse
                | meshopt::SimplifyOptions::Prune
                | meshopt::SimplifyOptions::ErrorAbsolute,
            None,
        );
        new_counts.push(simplified.len() as u32);
        new_indices.extend_from_slice(&simplified);
    }

    cg.indices = new_indices;
    cg.dr_starts = new_starts;
    cg.dr_counts = new_counts;
}

// ── Meshletization (sequential port of the reference) ─────────────────────────

#[derive(Default)]
struct DrMeshletData {
    descs: Vec<MeshletDesc>,
    verts: Vec<u32>,
    tris: Vec<u8>,
    bounds: Vec<MeshletBounds>,
}

fn meshletize_cg(cg: &mut ColorGroup) -> Result<()> {
    let per_dr: Vec<DrMeshletData> = (0..cg.dr_ids.len())
        .map(|di| build_dr_meshlets(cg, di))
        .collect();

    for dr in per_dr {
        let dr_meshlet_start = cg.meshlet_descs.len() as u32;
        let vbase = cg.meshlet_verts.len() as u32;
        let tbase = cg.meshlet_tris.len() as u32;
        for d in dr.descs {
            cg.meshlet_descs.push(MeshletDesc {
                vertex_offset: d.vertex_offset + vbase,
                triangle_offset: d.triangle_offset + tbase,
                ..d
            });
        }
        cg.meshlet_verts.extend_from_slice(&dr.verts);
        cg.meshlet_tris.extend_from_slice(&dr.tris);
        cg.meshlet_bounds.extend_from_slice(&dr.bounds);
        cg.dr_meshlet_starts.push(dr_meshlet_start);
        cg.dr_meshlet_counts
            .push(cg.meshlet_descs.len() as u32 - dr_meshlet_start);
    }
    Ok(())
}

fn build_dr_meshlets(cg: &ColorGroup, di: usize) -> DrMeshletData {
    use std::collections::HashMap;
    let start = cg.dr_starts[di] as usize;
    let count = cg.dr_counts[di] as usize;
    let dr_indices = &cg.indices[start..start + count];
    let mut out = DrMeshletData::default();

    // Compact this DR's vertices to a local 0..N range (O(DR) meshopt calls).
    let mut global_to_local: HashMap<u32, u32> = HashMap::new();
    let mut local_to_global: Vec<u32> = Vec::new();
    let mut local_indices: Vec<u32> = Vec::with_capacity(count);
    for &g in dr_indices {
        let l = *global_to_local.entry(g).or_insert_with(|| {
            let l = local_to_global.len() as u32;
            local_to_global.push(g);
            l
        });
        local_indices.push(l);
    }
    if local_to_global.is_empty() {
        return out;
    }
    let local_positions: Vec<[f32; 3]> = local_to_global
        .iter()
        .map(|&g| cg.positions[g as usize])
        .collect();

    let vertex_bytes: &[u8] = bytemuck::cast_slice::<[f32; 3], u8>(&local_positions);
    let adapter = match meshopt::VertexDataAdapter::new(vertex_bytes, 12, 0) {
        Ok(a) => a,
        Err(_) => return out,
    };
    let opt = meshopt::optimize_vertex_cache(&local_indices, local_positions.len());
    let ctx = meshopt::build_meshlets(&opt, &adapter, MAX_VERTICES, MAX_TRIANGLES, CONE_WEIGHT);

    for mi in 0..ctx.len() {
        let m = &ctx.meshlets[mi];
        let vertex_offset = out.verts.len() as u32;
        let triangle_offset = out.tris.len() as u32;
        let v_start = m.vertex_offset as usize;
        let v_end = v_start + m.vertex_count as usize;

        let mut amin = [f32::INFINITY; 3];
        let mut amax = [f32::NEG_INFINITY; 3];
        for &lv in &ctx.vertices[v_start..v_end] {
            let p = local_positions[lv as usize];
            for k in 0..3 {
                amin[k] = amin[k].min(p[k]);
                amax[k] = amax[k].max(p[k]);
            }
            out.verts.push(local_to_global[lv as usize]);
        }
        let mut aabb_scale = [0.0f32; 3];
        for k in 0..3 {
            let extent = amax[k] - amin[k];
            aabb_scale[k] = if extent > 0.0 { extent / 65535.0 } else { 0.0 };
        }

        let padded_len = ((m.triangle_count as usize * 3) + 3) & !3;
        let t_start = m.triangle_offset as usize;
        out.tris
            .extend_from_slice(&ctx.triangles[t_start..t_start + padded_len]);

        let raw = meshopt::compute_meshlet_bounds(ctx.get(mi), &adapter);
        out.bounds.push(MeshletBounds {
            center: raw.center,
            radius: raw.radius,
            cone_apex: raw.cone_apex,
            cone_axis: raw.cone_axis,
            cone_cutoff: raw.cone_cutoff,
            _pad: 0,
        });

        out.descs.push(MeshletDesc {
            vertex_offset,
            triangle_offset,
            vertex_count: m.vertex_count,
            triangle_count: m.triangle_count,
            aabb_min: amin,
            aabb_scale,
        });
    }
    out
}

// ── Quantized streams + normals (verbatim ports) ──────────────────────────────

fn build_quantized_streams(cg: &mut ColorGroup) {
    let local_count = cg.meshlet_verts.len();
    cg.meshlet_positions = Vec::with_capacity(local_count * 6);
    let has_normals = !cg.normals.is_empty();
    if has_normals {
        cg.meshlet_normals = Vec::with_capacity(local_count * 4);
    }

    for desc in &cg.meshlet_descs {
        let min = desc.aabb_min;
        let scale = desc.aabb_scale;
        let start = desc.vertex_offset as usize;
        let end = start + desc.vertex_count as usize;
        for &gidx in &cg.meshlet_verts[start..end] {
            let p = cg.positions[gidx as usize];
            for k in 0..3 {
                let q = if scale[k] > 0.0 {
                    (((p[k] - min[k]) / scale[k]).round()).clamp(0.0, 65535.0) as u16
                } else {
                    0
                };
                cg.meshlet_positions.extend_from_slice(&q.to_le_bytes());
            }
            if has_normals {
                let oct = octahedral_encode_snorm16(cg.normals[gidx as usize]);
                cg.meshlet_normals.extend_from_slice(&oct[0].to_le_bytes());
                cg.meshlet_normals.extend_from_slice(&oct[1].to_le_bytes());
            }
        }
    }
}

fn octahedral_encode_snorm16(n: [f32; 3]) -> [i16; 2] {
    let len = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt();
    let n = if len > 0.0 {
        [n[0] / len, n[1] / len, n[2] / len]
    } else {
        [0.0, 0.0, 1.0]
    };
    let denom = n[0].abs() + n[1].abs() + n[2].abs();
    let (mut ox, mut oy) = if denom > 0.0 {
        (n[0] / denom, n[1] / denom)
    } else {
        (0.0, 0.0)
    };
    if n[2] < 0.0 {
        let x = (1.0 - oy.abs()) * if ox >= 0.0 { 1.0 } else { -1.0 };
        let y = (1.0 - ox.abs()) * if oy >= 0.0 { 1.0 } else { -1.0 };
        ox = x;
        oy = y;
    }
    let to_i16 = |v: f32| (v.clamp(-1.0, 1.0) * 32767.0).round() as i16;
    [to_i16(ox), to_i16(oy)]
}

fn compute_vertex_normals(positions: &[[f32; 3]], indices: &[u32]) -> Vec<[f32; 3]> {
    let n = positions.len();
    let mut normals = vec![[0.0f32; 3]; n];
    for tri in indices.chunks_exact(3) {
        let [i0, i1, i2] = [tri[0] as usize, tri[1] as usize, tri[2] as usize];
        let p0 = positions[i0];
        let p1 = positions[i1];
        let p2 = positions[i2];
        let e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
        let e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
        let cx = e1[1] * e2[2] - e1[2] * e2[1];
        let cy = e1[2] * e2[0] - e1[0] * e2[2];
        let cz = e1[0] * e2[1] - e1[1] * e2[0];
        for vi in [i0, i1, i2] {
            normals[vi][0] += cx;
            normals[vi][1] += cy;
            normals[vi][2] += cz;
        }
    }
    for n in &mut normals {
        let len = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt();
        if len > 1e-10 {
            n[0] /= len;
            n[1] /= len;
            n[2] /= len;
        } else {
            *n = [0.0, 0.0, 1.0];
        }
    }
    normals
}

// ── Binary packing (verbatim port; source_hash is zeroed — unused by the web) ─

fn pack_binary(
    dense: Option<([f32; 3], [f32; 3])>,
    color_groups: &[ColorGroup],
    all_items: &[(u32, u16, u32)],
    item_count: u32,
    fmt_hier: &[FmtHierEntry],
    name_pool: &[u8],
    id_item_table: &[IdItemEntry],
    root_name: &str,
    cell_table: &[CellEntry],
) -> Result<Vec<u8>> {
    let cg_header_size = std::mem::size_of::<ColorGroupHeader>();
    let n_cg = color_groups.len();

    // v8 appends dense bounds (2 × f32x3) AFTER the v7 header — every v7 field
    // offset is unchanged, only the color-group array moves from 216 to 240.
    // v9 appends the cell-table pointer after that (offset u64 + count u32 +
    // pad), moving the array to 256. Older readers ignore what they do not know.
    let v9 = !cell_table.is_empty();
    let header_size: usize = ModelFileHeader::color_groups_offset() as usize
        + if dense.is_some() { 24 } else { 0 }
        + if v9 { 16 } else { 0 };
    let cg_headers_start: usize = header_size;
    let mut offset: u64 = cg_headers_start as u64 + n_cg as u64 * cg_header_size as u64;

    struct CgOff {
        draw_range: u64,
        meshlet_desc: u64,
        meshlet_tris: u64,
        meshlet_bounds: u64,
        meshlet_positions: u64,
        meshlet_normals: u64,
        desc_c: Vec<u8>,
        tris_c: Vec<u8>,
        bounds_c: Vec<u8>,
        positions_c: Vec<u8>,
        normals_c: Vec<u8>,
    }
    fn encode_stream<T>(data: &[T]) -> Result<Vec<u8>> {
        if data.is_empty() {
            return Ok(Vec::new());
        }
        meshopt::encode_vertex_buffer(data).map_err(|e| anyhow!("meshopt encode: {e}"))
    }
    let mut cg_offs: Vec<CgOff> = Vec::with_capacity(n_cg);

    for cg in color_groups {
        let d = cg.dr_ids.len() as u64;

        debug_assert_eq!(cg.meshlet_positions.len() % 6, 0);
        debug_assert_eq!(cg.meshlet_normals.len() % 4, 0);
        debug_assert_eq!(cg.meshlet_tris.len() % 4, 0);
        let desc_c = encode_stream(&cg.meshlet_descs)?;
        let tris_c = encode_stream(bytemuck::cast_slice::<u8, [u8; 4]>(&cg.meshlet_tris))?;
        let bounds_c = encode_stream(&cg.meshlet_bounds)?;
        let positions_c = {
            let mut padded = cg.meshlet_positions.clone();
            padded.resize(padded.len().div_ceil(12) * 12, 0);
            encode_stream(bytemuck::cast_slice::<u8, [u8; 12]>(&padded))?
        };
        let normals_c = encode_stream(bytemuck::cast_slice::<u8, [u8; 4]>(&cg.meshlet_normals))?;

        let draw_range_off = offset;
        offset += d * 20;
        let meshlet_desc_off = offset;
        offset += desc_c.len() as u64;
        let meshlet_tris_off = offset;
        offset += tris_c.len() as u64;
        let meshlet_bounds_off = offset;
        offset += bounds_c.len() as u64;
        let meshlet_positions_off = offset;
        offset += positions_c.len() as u64;
        let meshlet_normals_off = offset;
        offset += normals_c.len() as u64;

        cg_offs.push(CgOff {
            draw_range: draw_range_off,
            meshlet_desc: meshlet_desc_off,
            meshlet_tris: meshlet_tris_off,
            meshlet_bounds: meshlet_bounds_off,
            meshlet_positions: meshlet_positions_off,
            meshlet_normals: meshlet_normals_off,
            desc_c,
            tris_c,
            bounds_c,
            positions_c,
            normals_c,
        });
    }

    let items_section_off = offset;
    let item_to_cg_off = items_section_off + 24;
    let item_to_cg_end = item_to_cg_off + item_count as u64 * 2;
    let item_to_dr_off = (item_to_cg_end + 3) & !3;
    offset = item_to_dr_off + item_count as u64 * 4;

    let hier_section_off = offset;
    let name_pool_off = hier_section_off + 40;
    let hier_entries_off = name_pool_off + name_pool.len() as u64;
    let id_item_off = hier_entries_off + fmt_hier.len() as u64 * 16;
    // v9 cell table last — a fixed-size trailer that older readers never look at
    let cell_table_off = id_item_off + id_item_table.len() as u64 * 8;
    let total_size = cell_table_off + cell_table.len() as u64 * 32;

    let (bounds_min, bounds_max) = compute_bounds(color_groups);

    let mut buf = vec![0u8; total_size as usize];

    {
        let mut h = ModelFileHeader::zeroed();
        h.magic = MAGIC;
        h.format_version = if v9 {
            FORMAT_VERSION + 2
        } else if dense.is_some() {
            FORMAT_VERSION + 1
        } else {
            FORMAT_VERSION
        };
        h.color_group_count = n_cg as u32;
        h.bounds_min = bounds_min;
        h.bounds_max = bounds_max;
        h.items_offset = items_section_off;
        h.hierarchy_offset = hier_section_off;
        h.set_root_name(root_name);
        write_at(&mut buf, 0, bytemuck::bytes_of(&h));
        if let Some((dmin, dmax)) = dense {
            write_at(&mut buf, 216, bytemuck::cast_slice(&dmin));
            write_at(&mut buf, 228, bytemuck::cast_slice(&dmax));
        }
        if v9 {
            // cell-table pointer at 240: offset u64, count u32, pad u32
            write_at(&mut buf, 240, &cell_table_off.to_ne_bytes());
            write_at(&mut buf, 248, &(cell_table.len() as u32).to_ne_bytes());
        }
    }
    if v9 {
        write_at(
            &mut buf,
            cell_table_off as usize,
            bytemuck::cast_slice::<CellEntry, u8>(cell_table),
        );
    }

    for (i, (cg, off)) in color_groups.iter().zip(cg_offs.iter()).enumerate() {
        let mut cgh = ColorGroupHeader::zeroed();
        cgh.color = cg.base_color;
        cgh.vertex_count = cg.positions.len() as u32;
        cgh.index_count = cg.indices.len() as u32;
        cgh.draw_range_count = cg.dr_ids.len() as u32;
        cgh.meshlet_count = cg.meshlet_descs.len() as u32;
        cgh.draw_range_offset = off.draw_range;
        cgh.meshlet_desc_offset = off.meshlet_desc;
        cgh.meshlet_tris_offset = off.meshlet_tris;
        cgh.meshlet_bounds_offset = off.meshlet_bounds;
        cgh.meshlet_tri_byte_count = cg.meshlet_tris.len() as u32;
        cgh.meshlet_positions_offset = off.meshlet_positions;
        cgh.meshlet_normals_offset = if off.normals_c.is_empty() {
            0
        } else {
            off.meshlet_normals
        };
        cgh.local_vert_count = cg.meshlet_verts.len() as u32;
        cgh.meshlet_desc_csize = off.desc_c.len() as u32;
        cgh.meshlet_tris_csize = off.tris_c.len() as u32;
        cgh.meshlet_bounds_csize = off.bounds_c.len() as u32;
        cgh.meshlet_positions_csize = off.positions_c.len() as u32;
        cgh.meshlet_normals_csize = off.normals_c.len() as u32;
        write_at(
            &mut buf,
            cg_headers_start + i * cg_header_size,
            bytemuck::bytes_of(&cgh),
        );
    }

    for (cg, off) in color_groups.iter().zip(cg_offs.iter()) {
        let d = cg.dr_ids.len();
        let dr = off.draw_range as usize;
        write_at(&mut buf, dr, bytemuck::cast_slice::<u32, u8>(&cg.dr_ids));
        write_at(
            &mut buf,
            dr + d * 4,
            bytemuck::cast_slice::<u32, u8>(&cg.dr_starts),
        );
        write_at(
            &mut buf,
            dr + d * 4 * 2,
            bytemuck::cast_slice::<u32, u8>(&cg.dr_counts),
        );
        write_at(
            &mut buf,
            dr + d * 4 * 3,
            bytemuck::cast_slice::<u32, u8>(&cg.dr_meshlet_starts),
        );
        write_at(
            &mut buf,
            dr + d * 4 * 4,
            bytemuck::cast_slice::<u32, u8>(&cg.dr_meshlet_counts),
        );

        if !off.desc_c.is_empty() {
            write_at(&mut buf, off.meshlet_desc as usize, &off.desc_c);
        }
        if !off.tris_c.is_empty() {
            write_at(&mut buf, off.meshlet_tris as usize, &off.tris_c);
        }
        if !off.bounds_c.is_empty() {
            write_at(&mut buf, off.meshlet_bounds as usize, &off.bounds_c);
        }
        if !off.positions_c.is_empty() {
            write_at(&mut buf, off.meshlet_positions as usize, &off.positions_c);
        }
        if !off.normals_c.is_empty() {
            write_at(&mut buf, off.meshlet_normals as usize, &off.normals_c);
        }
    }

    {
        let mut ish = ItemsSectionHeader::zeroed();
        ish.item_count = item_count;
        ish.item_to_color_group_offset = item_to_cg_off;
        ish.item_to_draw_range_idx_offset = item_to_dr_off;
        write_at(
            &mut buf,
            items_section_off as usize,
            bytemuck::bytes_of(&ish),
        );
    }

    for (i, &(_, cg_idx, _)) in all_items.iter().enumerate() {
        write_u16(&mut buf, item_to_cg_off as usize + i * 2, cg_idx);
    }
    for (i, &(_, _, dr_idx)) in all_items.iter().enumerate() {
        write_u32(&mut buf, item_to_dr_off as usize + i * 4, dr_idx);
    }

    {
        let mut hsh = HierarchySectionHeader::zeroed();
        hsh.entry_count = fmt_hier.len() as u32;
        hsh.id_item_count = id_item_table.len() as u32;
        hsh.name_pool_len = name_pool.len() as u32;
        hsh.name_pool_offset = name_pool_off;
        hsh.entries_offset = hier_entries_off;
        hsh.id_item_offset = id_item_off;
        write_at(
            &mut buf,
            hier_section_off as usize,
            bytemuck::bytes_of(&hsh),
        );
    }

    write_at(&mut buf, name_pool_off as usize, name_pool);
    write_at(
        &mut buf,
        hier_entries_off as usize,
        bytemuck::cast_slice::<FmtHierEntry, u8>(fmt_hier),
    );
    write_at(
        &mut buf,
        id_item_off as usize,
        bytemuck::cast_slice::<IdItemEntry, u8>(id_item_table),
    );

    Ok(buf)
}

// ── Extras parsing (port of parse_extras, on serde_json::Value) ───────────────

fn parse_extras(json: &serde_json::Value) -> Result<(Vec<DrawRangeRaw>, Vec<MergedHierarchyEntry>)> {
    let version = json["asset"]["extras"]["web3dversion"]
        .as_u64()
        .ok_or_else(|| anyhow!("not a merged GLB: asset.extras.web3dversion missing"))?;
    anyhow::ensure!(
        version == 2,
        "unsupported web3dversion {version} (expected 2)"
    );

    let obj = json["scenes"][0]["extras"]
        .as_object()
        .ok_or_else(|| anyhow!("GLB has no scene[0] extras (draw_ranges / id_hierarchy)"))?;

    let prefix = "draw_ranges_node";
    let mut node_keys: Vec<(usize, &serde_json::Map<String, serde_json::Value>)> = Vec::new();
    for (key, value) in obj {
        if let Some(suffix) = key.strip_prefix(prefix) {
            let node_index: usize = suffix
                .parse()
                .with_context(|| format!("draw_ranges key `{key}` has non-numeric suffix"))?;
            let ranges_obj = value
                .as_object()
                .ok_or_else(|| anyhow!("`{key}` is not a JSON object"))?;
            node_keys.push((node_index, ranges_obj));
        }
    }
    node_keys.sort_by_key(|(i, _)| *i);

    let mut draw_ranges: Vec<DrawRangeRaw> = Vec::new();
    for (node_index, ranges_obj) in node_keys {
        for (id_str, range_val) in ranges_obj {
            let id: u32 = id_str
                .parse()
                .with_context(|| format!("DrawRangeId `{id_str}` is not a valid u32"))?;
            let arr = range_val
                .as_array()
                .filter(|a| a.len() == 2)
                .ok_or_else(|| anyhow!("draw_range[{id}] must be [start, count]"))?;
            let index_start = arr[0]
                .as_u64()
                .ok_or_else(|| anyhow!("draw_range[{id}].start is not a number"))?
                as usize;
            let index_count = arr[1]
                .as_u64()
                .ok_or_else(|| anyhow!("draw_range[{id}].count is not a number"))?
                as usize;
            draw_ranges.push(DrawRangeRaw {
                id,
                index_start,
                index_count,
                node_index,
            });
        }
    }
    anyhow::ensure!(
        !draw_ranges.is_empty(),
        "no draw_ranges_node* entries in scene extras"
    );
    draw_ranges.sort_by_key(|r| r.id);

    let hier_obj = obj
        .get("id_hierarchy")
        .and_then(|v| v.as_object())
        .ok_or_else(|| anyhow!("scene extras missing `id_hierarchy`"))?;

    let mut hierarchy: Vec<MergedHierarchyEntry> = Vec::with_capacity(hier_obj.len());
    for (id_str, entry_val) in hier_obj {
        let id: u32 = id_str
            .parse()
            .with_context(|| format!("hierarchy id `{id_str}` is not a valid u32"))?;
        let arr = entry_val
            .as_array()
            .filter(|a| a.len() == 2)
            .ok_or_else(|| anyhow!("hierarchy[{id}] must be [name, parent_id]"))?;
        let name = arr[0]
            .as_str()
            .ok_or_else(|| anyhow!("hierarchy[{id}].name is not a string"))?
            .to_string();
        let parent_str = arr[1]
            .as_str()
            .ok_or_else(|| anyhow!("hierarchy[{id}].parent is not a string"))?;
        let parent_id =
            if parent_str == "*" {
                None
            } else {
                Some(parent_str.parse::<u32>().with_context(|| {
                    format!("hierarchy[{id}].parent `{parent_str}` not valid u32")
                })?)
            };
        hierarchy.push(MergedHierarchyEntry {
            id,
            name,
            parent_id,
        });
    }

    Ok((draw_ranges, hierarchy))
}

fn compute_bounds(color_groups: &[ColorGroup]) -> ([f32; 3], [f32; 3]) {
    let mut min = [f32::MAX; 3];
    let mut max = [f32::MIN; 3];
    let mut any = false;
    for cg in color_groups {
        for p in &cg.positions {
            for i in 0..3 {
                if p[i] < min[i] {
                    min[i] = p[i];
                }
                if p[i] > max[i] {
                    max[i] = p[i];
                }
            }
            any = true;
        }
    }
    if any {
        (min, max)
    } else {
        ([0.0; 3], [0.0; 3])
    }
}

/// Per-axis 10th–90th percentile box over every vertex — "where 80% of the
/// mesh is". O(n) via select_nth; falls back to the full AABB when tiny.
fn compute_dense_bounds(color_groups: &[ColorGroup]) -> ([f32; 3], [f32; 3]) {
    let n: usize = color_groups.iter().map(|cg| cg.positions.len()).sum();
    if n < 16 {
        return compute_bounds(color_groups);
    }
    let mut dmin = [0.0f32; 3];
    let mut dmax = [0.0f32; 3];
    let lo_idx = n / 10;
    let hi_idx = (n * 9) / 10;
    let mut axis: Vec<f32> = Vec::with_capacity(n);
    for k in 0..3 {
        axis.clear();
        for cg in color_groups {
            axis.extend(cg.positions.iter().map(|p| p[k]));
        }
        let (_, lo, _) = axis.select_nth_unstable_by(lo_idx, |a, b| a.total_cmp(b));
        dmin[k] = *lo;
        let (_, hi, _) = axis.select_nth_unstable_by(hi_idx, |a, b| a.total_cmp(b));
        dmax[k] = *hi;
    }
    (dmin, dmax)
}

#[inline]
fn write_at(buf: &mut [u8], offset: usize, data: &[u8]) {
    buf[offset..offset + data.len()].copy_from_slice(data);
}

#[inline]
fn write_u32(buf: &mut [u8], offset: usize, v: u32) {
    buf[offset..offset + 4].copy_from_slice(&v.to_ne_bytes());
}

#[inline]
fn write_u16(buf: &mut [u8], offset: usize, v: u16) {
    buf[offset..offset + 2].copy_from_slice(&v.to_ne_bytes());
}
