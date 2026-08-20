//! Spatial cell table (FORMAT v9) — the "cheap octree".
//!
//! The cooker bins items into a fixed 2-level octree (root + 2×2×2 + 4×4×4 =
//! 73 cells) and renumbers the DENSE item indices so each cell owns a
//! CONTIGUOUS range. No tree is stored: this table of ranges IS the octree.
//! Only the dense packing order changes — source ids and the id→item table are
//! untouched, so hierarchy, selection, colouring and snapshots are unaffected.
//!
//! Cell numbering: 0 = root (items that straddle a level-1 boundary, i.e. the
//! zone-spanning outliers), 1..=8 = level 1, 9..=72 = level 2, indexed
//! `x + y*dim + z*dim*dim` within their level.

use bytemuck::{Pod, Zeroable};

/// Cells in the fixed 2-level scheme: root + 8 + 64.
pub const CELL_COUNT: u32 = 73;

/// One cell: the union AABB of the items it holds, plus their contiguous
/// dense-index range. Empty cells have `item_count == 0` and a zero AABB.
///
/// # Layout (32 bytes, no implicit padding)
///
/// ```text
/// offset   size  field
///      0     12  aabb_min      union of the cell's item boxes (world, Z-up)
///     12     12  aabb_max
///     24      4  item_start    first dense item index in this cell
///     28      4  item_count    number of items (0 = empty cell)
/// total: 32
/// ```
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Zeroable, Pod, PartialEq)]
pub struct CellEntry {
    /// Union AABB minimum of the items in this cell (world space, Z-up).
    pub aabb_min: [f32; 3],
    /// Union AABB maximum of the items in this cell.
    pub aabb_max: [f32; 3],
    /// First dense item index belonging to this cell.
    pub item_start: u32,
    /// Item count; 0 marks an empty cell (its AABB is zeroed).
    pub item_count: u32,
}
