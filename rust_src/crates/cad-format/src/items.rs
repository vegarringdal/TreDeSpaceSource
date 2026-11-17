//! Items section, hierarchy section, and their entry types.
//!
//! The *items section* maps the dense `ItemIndex` (0..item_count) to the
//! color group and draw range that contain its geometry.
//!
//! The *hierarchy section* stores the full id_hierarchy from the source GLB:
//! names, parent links, and a sorted id → ItemIndex lookup table.

use bytemuck::{Pod, Zeroable};

// ── Items section ─────────────────────────────────────────────────────────────

/// Fixed-size header for the items section.
///
/// Located at [`ModelFileHeader::items_offset`] within the file.
///
/// Followed (at the offsets stored in this header) by two parallel arrays
/// of length `item_count`:
///
/// * `item_to_color_group` — `[u16; item_count]`, one 2-byte entry per item.
/// * `item_to_draw_range_idx` — `[u32; item_count]`, one 4-byte entry per item.
///
/// Together these let the renderer resolve an `ItemIndex` to the
/// `(ColorGroup, DrawRangeIdx)` pair needed to locate geometry and per-item state.
///
/// # Layout (24 bytes, no implicit padding)
///
/// ```text
/// offset   size  field
///      0      4  item_count
///      4      4  _pad                (explicit pad — keeps u64 fields 8-byte aligned)
///      8      8  item_to_color_group_offset
///     16      8  item_to_draw_range_idx_offset
/// total: 24
/// ```
///
/// [`ModelFileHeader::items_offset`]: crate::ModelFileHeader::items_offset
#[repr(C)]
#[derive(Clone, Copy, Debug, Zeroable, Pod)]
pub struct ItemsSectionHeader {
    /// Total number of items (= total draw_ranges across all color groups).
    /// Both arrays referenced below have exactly this many entries.
    pub item_count: u32,

    /// Explicit padding — ensures the following `u64` fields are 8-byte aligned.
    pub _pad: u32,

    /// Absolute byte offset of the `item_to_color_group` array (`[u16; item_count]`).
    /// Index `i` gives the color-group index for `ItemIndex` `i`.
    pub item_to_color_group_offset: u64,

    /// Absolute byte offset of the `item_to_draw_range_idx` array (`[u32; item_count]`).
    /// Index `i` gives the draw-range index within that color group for `ItemIndex` `i`.
    pub item_to_draw_range_idx_offset: u64,
}

// ── Hierarchy section ─────────────────────────────────────────────────────────

/// Fixed-size header for the hierarchy section.
///
/// Located at [`ModelFileHeader::hierarchy_offset`] within the file.
///
/// Three variable-length data blocks follow (at the offsets in this header):
///
/// * **Name pool** (`name_pool_offset`): `name_pool_len` bytes of concatenated
///   UTF-8 strings, not null-terminated.  Individual names are sliced using
///   `name_offset + name_len` from [`HierarchyEntry`].
///
/// * **Hierarchy entries** (`entries_offset`): `entry_count × sizeof(HierarchyEntry)`
///   bytes — one entry per node in the original `id_hierarchy`.
///
/// * **Id→item index table** (`id_item_offset`): `id_item_count × sizeof(IdItemEntry)`
///   bytes — sorted by `id`, used for binary search.  Only geometry-bearing items
///   are present; container nodes (groups without geometry) are absent.
///
/// # Layout (40 bytes, no implicit padding)
///
/// ```text
/// offset   size  field
///      0      4  entry_count
///      4      4  id_item_count
///      8      4  name_pool_len
///     12      4  _pad
///     16      8  name_pool_offset
///     24      8  entries_offset
///     32      8  id_item_offset
/// total: 40
/// ```
///
/// [`ModelFileHeader::hierarchy_offset`]: crate::ModelFileHeader::hierarchy_offset
#[repr(C)]
#[derive(Clone, Copy, Debug, Zeroable, Pod)]
pub struct HierarchySectionHeader {
    /// Total number of hierarchy entries (geometry items + container nodes).
    pub entry_count: u32,

    /// Number of entries in the id→item index table.
    /// Equal to the number of geometry-bearing items (those with a draw range).
    pub id_item_count: u32,

    /// Byte length of the name pool.
    pub name_pool_len: u32,

    /// Explicit padding.
    pub _pad: u32,

    /// Absolute byte offset of the name pool (`[u8; name_pool_len]`).
    pub name_pool_offset: u64,

    /// Absolute byte offset of the hierarchy entries (`[HierarchyEntry; entry_count]`).
    pub entries_offset: u64,

    /// Absolute byte offset of the id→item index table (`[IdItemEntry; id_item_count]`).
    /// Entries are sorted by `id` — use binary search.
    pub id_item_offset: u64,
}

// ── HierarchyEntry ────────────────────────────────────────────────────────────

/// One node in the source GLB's `id_hierarchy`.
///
/// Covers both geometry-bearing items (those with a draw range) and
/// container/group nodes (pure tree structure, no geometry).
///
/// # Layout (16 bytes, no implicit padding)
///
/// ```text
/// offset   size  field
///      0      4  id
///      4      4  name_offset
///      8      4  parent_index
///     12      2  name_len
///     14      2  _pad
/// total: 16
/// ```
#[repr(C)]
#[derive(Clone, Copy, Debug, Zeroable, Pod)]
pub struct HierarchyEntry {
    /// Original GLB id (from `id_hierarchy` JSON key).
    pub id: u32,

    /// Byte offset of this entry's name within the name pool.
    pub name_offset: u32,

    /// Index of the parent entry in the `hierarchy_entries` array.
    /// `u32::MAX` means "no parent" (root node).
    pub parent_index: u32,

    /// Byte length of the name in the name pool (UTF-8, not null-terminated).
    pub name_len: u16,

    /// Explicit padding to align struct size to 4 bytes.
    pub _pad: u16,
}

impl HierarchyEntry {
    /// Sentinel value for `parent_index` meaning "this is the root node".
    pub const NO_PARENT: u32 = u32::MAX;
}

// ── IdItemEntry ───────────────────────────────────────────────────────────────

/// One entry in the id → `ItemIndex` lookup table.
///
/// The table is sorted by `id` — use binary search to resolve a GLB draw-range id
/// to its dense `ItemIndex` (index into the `MeshItem` GPU buffer).
///
/// Container nodes (hierarchy entries with no geometry) are absent from this table.
///
/// # Layout (8 bytes)
///
/// ```text
/// offset   size  field
///      0      4  id          GLB draw_range_id (sparse key)
///      4      4  item_index  dense ItemIndex (GPU buffer slot)
/// total: 8
/// ```
#[repr(C)]
#[derive(Clone, Copy, Debug, Zeroable, Pod)]
pub struct IdItemEntry {
    /// Original GLB draw_range_id (sparse).
    pub id: u32,
    /// Dense `ItemIndex` — index into the per-model `MeshItem` GPU buffer.
    pub item_index: u32,
}
