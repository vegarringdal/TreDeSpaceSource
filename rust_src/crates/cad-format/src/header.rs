//! Top-level file header — the first bytes of every `.model` file.

use bytemuck::{Pod, Zeroable};

/// Fixed-size file header at byte offset 0.
///
/// Immediately followed by `color_group_count` × [`ColorGroupHeader`] structs
/// (use [`color_groups_offset()`] to compute the start of that array).
///
/// All multi-byte integers are native-endian (little-endian on x86/ARM).
///
/// # Layout (216 bytes, no implicit padding)
///
/// ```text
/// offset   size  field
///      0      4  magic               b"CADM"
///      4      4  format_version
///      8      4  color_group_count
///     12      4  _pad0               (explicit pad — keeps u64 fields 8-byte aligned)
///     16     32  source_glb_hash     blake3 of source GLB
///     48     12  bounds_min          world-space AABB min, Z-up
///     60     12  bounds_max          world-space AABB max, Z-up
///     72      8  items_offset        absolute byte offset to ItemsSectionHeader
///     80      8  hierarchy_offset    absolute byte offset to HierarchySectionHeader
///     88    128  root_name           null-terminated UTF-8, zero-padded
/// total: 216
/// ```
///
/// [`ColorGroupHeader`]: crate::ColorGroupHeader
/// [`color_groups_offset()`]: ModelFileHeader::color_groups_offset
#[repr(C)]
#[derive(Clone, Copy, Debug, Zeroable, Pod)]
pub struct ModelFileHeader {
    /// File magic — must equal [`MAGIC`].
    ///
    /// [`MAGIC`]: crate::MAGIC
    pub magic: [u8; 4],

    /// Format version — must equal [`FORMAT_VERSION`].
    ///
    /// [`FORMAT_VERSION`]: crate::FORMAT_VERSION
    pub format_version: u32,

    /// Number of color-group nodes in the source GLB.  Determines the length
    /// of the `ColorGroupHeader` array that follows this header.
    pub color_group_count: u32,

    /// Explicit padding — ensures `items_offset` and `hierarchy_offset` are at
    /// 8-byte-aligned offsets (required for `u64` field alignment in `repr(C)`).
    pub _pad0: u32,

    /// blake3 hash of the source GLB file contents (streaming hash, 32 bytes).
    /// Used as the cache key: if this matches the on-disk hash, the cook is skipped.
    pub source_glb_hash: [u8; 32],

    /// World-space AABB minimum corner (Z-up, after Y-up → Z-up rotation).
    pub bounds_min: [f32; 3],

    /// World-space AABB maximum corner (Z-up, after Y-up → Z-up rotation).
    pub bounds_max: [f32; 3],

    /// Absolute byte offset of the [`ItemsSectionHeader`] within the file.
    ///
    /// [`ItemsSectionHeader`]: crate::ItemsSectionHeader
    pub items_offset: u64,

    /// Absolute byte offset of the [`HierarchySectionHeader`] within the file.
    ///
    /// [`HierarchySectionHeader`]: crate::HierarchySectionHeader
    pub hierarchy_offset: u64,

    /// Full name of the site root (the `id_hierarchy` entry whose parent is `"*"`).
    ///
    /// Stored as null-terminated UTF-8, zero-padded to 128 bytes.  Use
    /// [`root_name_str()`] to get a `&str` slice.
    ///
    /// [`root_name_str()`]: ModelFileHeader::root_name_str
    pub root_name: [u8; 128],
}

impl ModelFileHeader {
    /// Byte offset of the `ColorGroupHeader` array within the file.
    ///
    /// Always immediately follows this header:
    /// `size_of::<ModelFileHeader>()`.
    pub const fn color_groups_offset() -> u64 {
        std::mem::size_of::<ModelFileHeader>() as u64
    }

    /// Decode `root_name` as a `&str`, trimming the null terminator and padding.
    ///
    /// Returns an error if the bytes are not valid UTF-8.
    pub fn root_name_str(&self) -> Result<&str, std::str::Utf8Error> {
        let end = self.root_name.iter().position(|&b| b == 0).unwrap_or(128);
        std::str::from_utf8(&self.root_name[..end])
    }

    /// Write a root name into `root_name`, truncating to 127 bytes if needed
    /// (reserves one byte for the null terminator).
    pub fn set_root_name(&mut self, name: &str) {
        self.root_name = [0u8; 128];
        let bytes = name.as_bytes();
        let len = bytes.len().min(127);
        self.root_name[..len].copy_from_slice(&bytes[..len]);
        // null terminator already there from zeroed array
    }
}
