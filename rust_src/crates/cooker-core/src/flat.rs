//! Flat (typed-array) form of a [`MergedModel`] — the shape a JS caller hands
//! across the wasm boundary as a handful of transferable buffers instead of a
//! serialised GLB. The app's `.tdp` export builds one of these from its export
//! tree; the cooker turns it back into a [`MergedModel`] here.
//!
//! Layout (every offset and count in ELEMENTS of the array it indexes):
//! - `positions`: xyz per vertex, all nodes back to back.
//! - `indices`: all nodes back to back; each value is NODE-LOCAL
//!   (`0..vertex_count` of its own node).
//! - `nodes`: 6 per node — `vertex_start, vertex_count, index_start,
//!   index_count, range_start, range_count`.
//! - `colors`: 4 per node — base colour RGBA (0–1).
//! - `ranges`: 3 per range — `id, index_start (node-local), index_count`.
//! - `hierarchy_json`: `[[id, name, parentId | null], …]`; exactly one entry
//!   has a null parent (the root, whose name becomes the asset name).
//!
//! Positions must already be WORLD-space and Z-up, as [`MergedModel`] requires.

use anyhow::{anyhow, ensure, Result};

use crate::cook::{MergedHierarchyEntry, MergedModel, MergedNode, MergedRange};

const NODE_STRIDE: usize = 6;
const RANGE_STRIDE: usize = 3;

/// Decode the flat arrays into a [`MergedModel`], validating every span so a
/// malformed caller fails here with a message instead of panicking inside the
/// cook.
pub fn model_from_flat(
    positions: &[f32],
    indices: &[u32],
    nodes: &[u32],
    colors: &[f32],
    ranges: &[u32],
    hierarchy_json: &str,
) -> Result<MergedModel> {
    ensure!(positions.len() % 3 == 0, "positions: length not a multiple of 3");
    ensure!(nodes.len() % NODE_STRIDE == 0, "nodes: length not a multiple of {NODE_STRIDE}");
    ensure!(ranges.len() % RANGE_STRIDE == 0, "ranges: length not a multiple of {RANGE_STRIDE}");
    let node_count = nodes.len() / NODE_STRIDE;
    ensure!(colors.len() == node_count * 4, "colors: expected {} floats", node_count * 4);
    let vertex_total = positions.len() / 3;
    let range_total = ranges.len() / RANGE_STRIDE;

    let mut out = Vec::with_capacity(node_count);
    for n in 0..node_count {
        let f = &nodes[n * NODE_STRIDE..(n + 1) * NODE_STRIDE];
        let (vs, vc, is, ic, rs, rc) = (
            f[0] as usize,
            f[1] as usize,
            f[2] as usize,
            f[3] as usize,
            f[4] as usize,
            f[5] as usize,
        );
        ensure!(vs + vc <= vertex_total, "node {n}: vertex span out of range");
        ensure!(is + ic <= indices.len(), "node {n}: index span out of range");
        ensure!(rs + rc <= range_total, "node {n}: range span out of range");
        let node_indices = indices[is..is + ic].to_vec();
        ensure!(
            node_indices.iter().all(|&i| (i as usize) < vc),
            "node {n}: index refers past its {vc} vertices"
        );
        let draw_ranges: Vec<MergedRange> = ranges[rs * RANGE_STRIDE..(rs + rc) * RANGE_STRIDE]
            .chunks_exact(RANGE_STRIDE)
            .map(|r| MergedRange {
                id: r[0],
                index_start: r[1],
                index_count: r[2],
            })
            .collect();
        for dr in &draw_ranges {
            ensure!(
                (dr.index_start + dr.index_count) as usize <= ic,
                "node {n}: draw range {} exceeds the node's {ic} indices",
                dr.id
            );
        }
        let c = &colors[n * 4..n * 4 + 4];
        out.push(MergedNode {
            base_color: [c[0], c[1], c[2], c[3]],
            positions: positions[vs * 3..(vs + vc) * 3]
                .chunks_exact(3)
                .map(|p| [p[0], p[1], p[2]])
                .collect(),
            indices: node_indices,
            draw_ranges,
        });
    }

    let hier: Vec<(u32, String, Option<u32>)> =
        serde_json::from_str(hierarchy_json).map_err(|e| anyhow!("hierarchy: {e}"))?;
    let hierarchy = hier
        .into_iter()
        .map(|(id, name, parent_id)| MergedHierarchyEntry {
            id,
            name,
            parent_id,
        })
        .collect();

    Ok(MergedModel {
        nodes: out,
        hierarchy,
    })
}
