//! Shared POD types for the packed `.model` binary file format.
//!
//! Used by `cad-cooker` (writer) and `cad-render` (mmap reader).
//! No GPU deps, no allocator deps, no I/O — pure data layout definitions.
//!
//! # File layout (FORMAT_VERSION 2)
//!
//! ```text
//! [0]                  ModelFileHeader         (216 bytes, fixed)
//! [216]                ColorGroupHeader × N    (96 bytes each, N = color_group_count)
//! [variable]           per-CG sections: vertex | index | draw_range | meshlet_desc |
//!                      meshlet_verts | meshlet_tris | meshlet_bounds
//! [items_offset]       ItemsSectionHeader      (24 bytes, fixed)
//! [variable]           items arrays
//! [hierarchy_offset]   HierarchySectionHeader  (40 bytes, fixed)
//! [variable]           name pool, hierarchy entries, id→item table
//! ```
//!
//! All multi-byte integers are native-endian (little-endian on x86/ARM).
//! All fixed-size structs implement [`bytemuck::Pod`] — safe to cast from `&[u8]`.

pub mod cells;
pub mod color_group;
pub mod header;
pub mod items;
pub mod magic;
pub mod meshlets;

pub use cells::{CellEntry, CELL_COUNT};
pub use color_group::ColorGroupHeader;
pub use header::ModelFileHeader;
pub use items::{HierarchyEntry, HierarchySectionHeader, IdItemEntry, ItemsSectionHeader};
pub use magic::{FORMAT_VERSION, MAGIC};
pub use meshlets::{MeshletBounds, MeshletDesc};

// ── Layout tests ─────────────────────────────────────────────────────────────
//
// These tests lock in the binary layout so any accidental struct change
// (reorder, added field, changed type) causes an immediate test failure.

#[cfg(test)]
mod tests {
    use super::*;
    use bytemuck::Zeroable;
    use std::mem::{offset_of, size_of};

    // ── ModelFileHeader ───────────────────────────────────────────────────────

    #[test]
    fn model_file_header_size() {
        assert_eq!(size_of::<ModelFileHeader>(), 216);
    }

    #[test]
    fn model_file_header_offsets() {
        assert_eq!(offset_of!(ModelFileHeader, magic), 0);
        assert_eq!(offset_of!(ModelFileHeader, format_version), 4);
        assert_eq!(offset_of!(ModelFileHeader, color_group_count), 8);
        assert_eq!(offset_of!(ModelFileHeader, _pad0), 12);
        assert_eq!(offset_of!(ModelFileHeader, source_glb_hash), 16);
        assert_eq!(offset_of!(ModelFileHeader, bounds_min), 48);
        assert_eq!(offset_of!(ModelFileHeader, bounds_max), 60);
        assert_eq!(offset_of!(ModelFileHeader, items_offset), 72);
        assert_eq!(offset_of!(ModelFileHeader, hierarchy_offset), 80);
        assert_eq!(offset_of!(ModelFileHeader, root_name), 88);
    }

    #[test]
    fn model_file_header_color_groups_offset() {
        assert_eq!(ModelFileHeader::color_groups_offset(), 216);
    }

    #[test]
    fn model_file_header_root_name_roundtrip() {
        let mut h = ModelFileHeader::zeroed();
        h.set_root_name("PLANT-SITE-001");
        assert_eq!(h.root_name_str().unwrap(), "PLANT-SITE-001");
    }

    #[test]
    fn model_file_header_root_name_truncation() {
        let mut h = ModelFileHeader::zeroed();
        let long = "x".repeat(200);
        h.set_root_name(&long);
        assert_eq!(h.root_name_str().unwrap().len(), 127);
    }

    // ── ColorGroupHeader ──────────────────────────────────────────────────────

    #[test]
    fn color_group_header_size() {
        assert_eq!(size_of::<ColorGroupHeader>(), 128);
    }

    #[test]
    fn color_group_header_offsets() {
        assert_eq!(offset_of!(ColorGroupHeader, color), 0);
        assert_eq!(offset_of!(ColorGroupHeader, vertex_count), 16);
        assert_eq!(offset_of!(ColorGroupHeader, index_count), 20);
        assert_eq!(offset_of!(ColorGroupHeader, draw_range_count), 24);
        assert_eq!(offset_of!(ColorGroupHeader, meshlet_count), 28);
        assert_eq!(offset_of!(ColorGroupHeader, draw_range_offset), 32);
        assert_eq!(offset_of!(ColorGroupHeader, meshlet_desc_offset), 40);
        assert_eq!(offset_of!(ColorGroupHeader, meshlet_tris_offset), 48);
        assert_eq!(offset_of!(ColorGroupHeader, meshlet_bounds_offset), 56);
        assert_eq!(offset_of!(ColorGroupHeader, meshlet_positions_offset), 64);
        assert_eq!(offset_of!(ColorGroupHeader, meshlet_normals_offset), 72);
        assert_eq!(offset_of!(ColorGroupHeader, meshlet_tri_byte_count), 80);
        assert_eq!(offset_of!(ColorGroupHeader, local_vert_count), 84);
        assert_eq!(offset_of!(ColorGroupHeader, meshlet_desc_csize), 88);
        assert_eq!(offset_of!(ColorGroupHeader, meshlet_tris_csize), 92);
        assert_eq!(offset_of!(ColorGroupHeader, meshlet_bounds_csize), 96);
        assert_eq!(offset_of!(ColorGroupHeader, meshlet_positions_csize), 100);
        assert_eq!(offset_of!(ColorGroupHeader, meshlet_normals_csize), 104);
        assert_eq!(offset_of!(ColorGroupHeader, _pad), 108);
    }

    // ── MeshletDesc ───────────────────────────────────────────────────────────

    #[test]
    fn meshlet_desc_size() {
        assert_eq!(size_of::<MeshletDesc>(), 40);
    }

    #[test]
    fn meshlet_desc_offsets() {
        assert_eq!(offset_of!(MeshletDesc, vertex_offset), 0);
        assert_eq!(offset_of!(MeshletDesc, triangle_offset), 4);
        assert_eq!(offset_of!(MeshletDesc, vertex_count), 8);
        assert_eq!(offset_of!(MeshletDesc, triangle_count), 12);
        assert_eq!(offset_of!(MeshletDesc, aabb_min), 16);
        assert_eq!(offset_of!(MeshletDesc, aabb_scale), 28);
    }

    // ── MeshletBounds ─────────────────────────────────────────────────────────

    #[test]
    fn meshlet_bounds_size() {
        assert_eq!(size_of::<MeshletBounds>(), 48);
    }

    #[test]
    fn meshlet_bounds_offsets() {
        assert_eq!(offset_of!(MeshletBounds, center), 0);
        assert_eq!(offset_of!(MeshletBounds, radius), 12);
        assert_eq!(offset_of!(MeshletBounds, cone_apex), 16);
        assert_eq!(offset_of!(MeshletBounds, cone_axis), 28);
        assert_eq!(offset_of!(MeshletBounds, cone_cutoff), 40);
        assert_eq!(offset_of!(MeshletBounds, _pad), 44);
    }

    // ── ItemsSectionHeader ────────────────────────────────────────────────────

    #[test]
    fn items_section_header_size() {
        assert_eq!(size_of::<ItemsSectionHeader>(), 24);
    }

    #[test]
    fn items_section_header_offsets() {
        assert_eq!(offset_of!(ItemsSectionHeader, item_count), 0);
        assert_eq!(offset_of!(ItemsSectionHeader, _pad), 4);
        assert_eq!(
            offset_of!(ItemsSectionHeader, item_to_color_group_offset),
            8
        );
        assert_eq!(
            offset_of!(ItemsSectionHeader, item_to_draw_range_idx_offset),
            16
        );
    }

    // ── HierarchySectionHeader ────────────────────────────────────────────────

    #[test]
    fn hierarchy_section_header_size() {
        assert_eq!(size_of::<HierarchySectionHeader>(), 40);
    }

    #[test]
    fn hierarchy_section_header_offsets() {
        assert_eq!(offset_of!(HierarchySectionHeader, entry_count), 0);
        assert_eq!(offset_of!(HierarchySectionHeader, id_item_count), 4);
        assert_eq!(offset_of!(HierarchySectionHeader, name_pool_len), 8);
        assert_eq!(offset_of!(HierarchySectionHeader, _pad), 12);
        assert_eq!(offset_of!(HierarchySectionHeader, name_pool_offset), 16);
        assert_eq!(offset_of!(HierarchySectionHeader, entries_offset), 24);
        assert_eq!(offset_of!(HierarchySectionHeader, id_item_offset), 32);
    }

    // ── HierarchyEntry ────────────────────────────────────────────────────────

    #[test]
    fn hierarchy_entry_size() {
        assert_eq!(size_of::<HierarchyEntry>(), 16);
    }

    #[test]
    fn hierarchy_entry_offsets() {
        assert_eq!(offset_of!(HierarchyEntry, id), 0);
        assert_eq!(offset_of!(HierarchyEntry, name_offset), 4);
        assert_eq!(offset_of!(HierarchyEntry, parent_index), 8);
        assert_eq!(offset_of!(HierarchyEntry, name_len), 12);
        assert_eq!(offset_of!(HierarchyEntry, _pad), 14);
    }

    #[test]
    fn hierarchy_entry_no_parent_sentinel() {
        assert_eq!(HierarchyEntry::NO_PARENT, u32::MAX);
    }

    // ── IdItemEntry ───────────────────────────────────────────────────────────

    #[test]
    fn id_item_entry_size() {
        assert_eq!(size_of::<IdItemEntry>(), 8);
    }

    #[test]
    fn id_item_entry_offsets() {
        assert_eq!(offset_of!(IdItemEntry, id), 0);
        assert_eq!(offset_of!(IdItemEntry, item_index), 4);
    }

    // ── Pod / bytemuck ────────────────────────────────────────────────────────

    #[test]
    fn all_types_are_pod() {
        let _: ModelFileHeader = bytemuck::Zeroable::zeroed();
        let _: ColorGroupHeader = bytemuck::Zeroable::zeroed();
        let _: MeshletDesc = bytemuck::Zeroable::zeroed();
        let _: MeshletBounds = bytemuck::Zeroable::zeroed();
        let _: ItemsSectionHeader = bytemuck::Zeroable::zeroed();
        let _: HierarchySectionHeader = bytemuck::Zeroable::zeroed();
        let _: HierarchyEntry = bytemuck::Zeroable::zeroed();
        let _: IdItemEntry = bytemuck::Zeroable::zeroed();
    }

    #[test]
    fn magic_and_version() {
        assert_eq!(MAGIC, *b"CADM");
        assert_eq!(FORMAT_VERSION, 7);
    }
}
