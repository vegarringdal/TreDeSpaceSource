//! Cooked `.tdp` (CADM v7–v9) → coarse variant, with no source file needed.
//!
//! Reads a packed model back into cooker memory, then runs the SAME coarsen →
//! meshletize → pack pipeline the GLB path uses. The input file's item table,
//! hierarchy section, cell table, draw-range order, root name and bounds are
//! carried over VERBATIM — the viewer's in-place variant swap requires the
//! coarse file's tables to be identical to the full file's, and copying them
//! guarantees that by construction (re-binning from dequantized geometry could
//! flip a boundary-straddling item into another cell).
//!
//! Geometry is rebuilt from the per-meshlet quantized vertex streams — the
//! flat vertex/index buffers are not serialized (since v6). Vertices shared by
//! several meshlets are stored once per meshlet, quantized against different
//! meshlet AABBs, so the copies land within quantization error of each other;
//! they are re-welded on a fixed grid so the simplifier sees connected
//! surfaces instead of per-meshlet islands (unwelded borders are locked edges
//! that would gut the simplification ratio).

use anyhow::{anyhow, Result};
use cad_format::{
    CellEntry, ColorGroupHeader, HierarchyEntry as FmtHierEntry, HierarchySectionHeader,
    IdItemEntry, ItemsSectionHeader, MeshletDesc, ModelFileHeader, MAGIC,
};

use crate::cook::{
    build_quantized_streams, coarsen_cg, meshletize_cg, pack_binary, CoarsenOptions, ColorGroup,
};

/// Weld grid pitch in world units (meters). Coarser than the per-meshlet
/// quantization step of any realistically sized meshlet, far finer than the
/// coarsen error budget (30 mm), so welding never visibly moves geometry.
const WELD_GRID: f32 = 1e-3;

/// Cook the coarse variant of an already-cooked `.tdp` file.
///
/// The output matches what cooking the original source with `coarsen` would
/// have produced, up to quantization error in vertex positions, and mirrors
/// the input's format version (v7 in → v7 out, etc.). Fails on wrong
/// magic/version or a structurally truncated file.
pub fn coarsen_tdp(tdp: &[u8], opts: CoarsenOptions) -> Result<Vec<u8>> {
    let f = TdpFile::parse(tdp)?;

    // Tiny-item cut threshold: the full cook derives it from the DENSE
    // diagonal of the original geometry — the header carries exactly that
    // value (v8+), which beats recomputing it from dequantized positions.
    // v7 has no dense bounds; its full AABB is the only diagonal available.
    let (dmin, dmax) = f.dense.unwrap_or(f.bounds);
    let model_diag =
        ((dmax[0] - dmin[0]).powi(2) + (dmax[1] - dmin[1]).powi(2) + (dmax[2] - dmin[2]).powi(2))
            .sqrt();

    let mut color_groups = f.color_groups;
    for cg in &mut color_groups {
        coarsen_cg(cg, model_diag, opts);
    }
    for cg in &mut color_groups {
        meshletize_cg(cg)?;
        build_quantized_streams(cg);
    }

    pack_binary(
        f.bounds,
        f.dense,
        &color_groups,
        &f.all_items,
        f.all_items.len() as u32,
        &f.hier_entries,
        &f.name_pool,
        &f.id_item_table,
        &f.root_name,
        &f.cell_table,
    )
}

// ── File reader ───────────────────────────────────────────────────────────────

struct TdpFile {
    bounds: ([f32; 3], [f32; 3]),
    dense: Option<([f32; 3], [f32; 3])>,
    root_name: String,
    color_groups: Vec<ColorGroup>,
    /// `(id, color_group, draw_range)` in the file's dense item order.
    all_items: Vec<(u32, u16, u32)>,
    hier_entries: Vec<FmtHierEntry>,
    name_pool: Vec<u8>,
    id_item_table: Vec<IdItemEntry>,
    cell_table: Vec<CellEntry>,
}

impl TdpFile {
    fn parse(b: &[u8]) -> Result<TdpFile> {
        let header: ModelFileHeader = read_pod(b, 0)?;
        anyhow::ensure!(header.magic == MAGIC, "not a CADM file");
        let ver = header.format_version;
        anyhow::ensure!((7..=9).contains(&ver), "unsupported CADM version {ver}");

        let bounds = (header.bounds_min, header.bounds_max);
        let dense = if ver >= 8 {
            Some((read_pod::<[f32; 3]>(b, 216)?, read_pod::<[f32; 3]>(b, 228)?))
        } else {
            None
        };
        let cell_table: Vec<CellEntry> = if ver >= 9 {
            let off = read_pod::<u64>(b, 240)? as usize;
            let count = read_pod::<u32>(b, 248)? as usize;
            read_pod_slice(b, off, count)?
        } else {
            Vec::new()
        };
        let root_name = header
            .root_name_str()
            .map_err(|_| anyhow!("root name is not valid UTF-8"))?
            .to_string();

        // v8 appends dense bounds (+24), v9 the cell-table pointer (+16).
        let cg_array_off = 216 + if ver >= 8 { 24 } else { 0 } + if ver >= 9 { 16 } else { 0 };
        let n_cg = header.color_group_count as usize;
        let mut color_groups = Vec::with_capacity(n_cg);
        for i in 0..n_cg {
            let cgh: ColorGroupHeader = read_pod(b, cg_array_off + i * 128)?;
            color_groups.push(read_color_group(b, &cgh)?);
        }

        let ish: ItemsSectionHeader = read_pod(b, header.items_offset as usize)?;
        let item_cg: Vec<u16> = read_pod_slice(
            b,
            ish.item_to_color_group_offset as usize,
            ish.item_count as usize,
        )?;
        let item_dr: Vec<u32> = read_pod_slice(
            b,
            ish.item_to_draw_range_idx_offset as usize,
            ish.item_count as usize,
        )?;
        let mut all_items = Vec::with_capacity(ish.item_count as usize);
        for (&cg, &dr) in item_cg.iter().zip(&item_dr) {
            let id = *color_groups
                .get(cg as usize)
                .and_then(|g| g.dr_ids.get(dr as usize))
                .ok_or_else(|| anyhow!("item table references cg {cg} / draw range {dr}"))?;
            all_items.push((id, cg, dr));
        }

        let hsh: HierarchySectionHeader = read_pod(b, header.hierarchy_offset as usize)?;
        let name_pool: Vec<u8> =
            read_pod_slice(b, hsh.name_pool_offset as usize, hsh.name_pool_len as usize)?;
        let hier_entries: Vec<FmtHierEntry> =
            read_pod_slice(b, hsh.entries_offset as usize, hsh.entry_count as usize)?;
        let id_item_table: Vec<IdItemEntry> =
            read_pod_slice(b, hsh.id_item_offset as usize, hsh.id_item_count as usize)?;

        Ok(TdpFile {
            bounds,
            dense,
            root_name,
            color_groups,
            all_items,
            hier_entries,
            name_pool,
            id_item_table,
            cell_table,
        })
    }
}

/// Rebuild one color group's flat geometry from its packed meshlet streams,
/// preserving the file's draw-range order (already cell-binned by the full
/// cook). Positions are dequantized per meshlet and re-welded; each draw
/// range's index run is re-expanded from its meshlets' triangle lists.
fn read_color_group(b: &[u8], cgh: &ColorGroupHeader) -> Result<ColorGroup> {
    let d = cgh.draw_range_count as usize;
    let dr = cgh.draw_range_offset as usize;
    let dr_ids: Vec<u32> = read_pod_slice(b, dr, d)?;
    let dr_meshlet_starts: Vec<u32> = read_pod_slice(b, dr + d * 12, d)?;
    let dr_meshlet_counts: Vec<u32> = read_pod_slice(b, dr + d * 16, d)?;

    let descs: Vec<MeshletDesc> = {
        let decoded: Vec<[u32; 10]> = decode_stream(
            b,
            cgh.meshlet_desc_offset,
            cgh.meshlet_desc_csize,
            cgh.meshlet_count as usize,
        )?;
        bytemuck::cast_slice(&decoded).to_vec()
    };
    let tris: Vec<u8> = {
        let decoded: Vec<[u8; 4]> = decode_stream(
            b,
            cgh.meshlet_tris_offset,
            cgh.meshlet_tris_csize,
            cgh.meshlet_tri_byte_count as usize / 4,
        )?;
        decoded.into_iter().flatten().collect()
    };
    let quant: Vec<u8> = {
        let padded = (cgh.local_vert_count as usize * 6).div_ceil(12) * 12;
        let decoded: Vec<[u8; 12]> = decode_stream(
            b,
            cgh.meshlet_positions_offset,
            cgh.meshlet_positions_csize,
            padded / 12,
        )?;
        decoded.into_iter().flatten().collect()
    };

    // Dequantize every meshlet-local vertex, welding duplicates as we go.
    let local_count = cgh.local_vert_count as usize;
    let mut positions: Vec<[f32; 3]> = Vec::new();
    let mut local_to_welded: Vec<u32> = vec![0; local_count];
    let mut weld: std::collections::HashMap<[i64; 3], u32> = Default::default();
    for desc in &descs {
        let start = desc.vertex_offset as usize;
        for v in 0..desc.vertex_count as usize {
            let li = start + v;
            anyhow::ensure!(li < local_count, "meshlet vertex range exceeds stream");
            let mut p = [0.0f32; 3];
            for k in 0..3 {
                let o = li * 6 + k * 2;
                let q = u16::from_le_bytes([quant[o], quant[o + 1]]);
                p[k] = desc.aabb_min[k] + q as f32 * desc.aabb_scale[k];
            }
            let key = [
                (p[0] / WELD_GRID).round() as i64,
                (p[1] / WELD_GRID).round() as i64,
                (p[2] / WELD_GRID).round() as i64,
            ];
            let idx = *weld.entry(key).or_insert_with(|| {
                positions.push(p);
                positions.len() as u32 - 1
            });
            local_to_welded[li] = idx;
        }
    }

    // Re-expand each draw range's indices from its meshlets, dropping
    // triangles that welding collapsed to a line or point.
    let mut indices: Vec<u32> = Vec::new();
    let mut dr_starts: Vec<u32> = Vec::with_capacity(d);
    let mut dr_counts: Vec<u32> = Vec::with_capacity(d);
    for di in 0..d {
        dr_starts.push(indices.len() as u32);
        let ms = dr_meshlet_starts[di] as usize;
        let mc = dr_meshlet_counts[di] as usize;
        for desc in descs
            .get(ms..ms + mc)
            .ok_or_else(|| anyhow!("draw range meshlets out of bounds"))?
        {
            let t0 = desc.triangle_offset as usize;
            let vbase = desc.vertex_offset as usize;
            for t in 0..desc.triangle_count as usize {
                let tri = tris
                    .get(t0 + t * 3..t0 + t * 3 + 3)
                    .ok_or_else(|| anyhow!("meshlet triangles out of bounds"))?;
                let a = local_to_welded[vbase + tri[0] as usize];
                let bb = local_to_welded[vbase + tri[1] as usize];
                let c = local_to_welded[vbase + tri[2] as usize];
                if a != bb && bb != c && a != c {
                    indices.extend_from_slice(&[a, bb, c]);
                }
            }
        }
        dr_counts.push(indices.len() as u32 - dr_starts[di]);
    }

    Ok(ColorGroup {
        base_color: cgh.color,
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
    })
}

// ── Bounds-checked reads ──────────────────────────────────────────────────────

fn read_pod<T: bytemuck::Pod>(b: &[u8], off: usize) -> Result<T> {
    let size = std::mem::size_of::<T>();
    let slice = b
        .get(off..off + size)
        .ok_or_else(|| anyhow!("file truncated at offset {off}"))?;
    Ok(bytemuck::pod_read_unaligned(slice))
}

fn read_pod_slice<T: bytemuck::Pod + Clone>(b: &[u8], off: usize, count: usize) -> Result<Vec<T>> {
    let size = count * std::mem::size_of::<T>();
    let slice = b
        .get(off..off + size)
        .ok_or_else(|| anyhow!("file truncated at offset {off}"))?;
    Ok(slice
        .chunks_exact(std::mem::size_of::<T>())
        .map(bytemuck::pod_read_unaligned)
        .collect())
}

fn decode_stream<T: Clone + Default>(
    b: &[u8],
    off: u64,
    csize: u32,
    count: usize,
) -> Result<Vec<T>> {
    if count == 0 {
        return Ok(Vec::new());
    }
    let encoded = b
        .get(off as usize..off as usize + csize as usize)
        .ok_or_else(|| anyhow!("compressed stream out of bounds at {off}"))?;
    meshopt::decode_vertex_buffer(encoded, count).map_err(|e| anyhow!("meshopt decode: {e}"))
}
