//! Per-color-group header and data layout.
//!
//! A `.model` file contains `color_group_count` color groups.  Each group has:
//!   1. A fixed-size `ColorGroupHeader` (in the header array after `ModelFileHeader`).
//!   2. Variable-length data sections whose absolute byte offsets are stored
//!      in the header: draw ranges (raw) and the meshlet streams (compressed).

use bytemuck::{Pod, Zeroable};

/// Fixed-size per-color-group header.  **128 bytes**, no implicit padding.
///
/// The `color_group_count` headers form a contiguous array immediately after
/// [`ModelFileHeader`] in the file (at [`ModelFileHeader::color_groups_offset()`]).
///
/// # Data sections
///
/// Each section is referenced by an absolute byte offset into the file.  The
/// meshlet streams are stored **compressed** with the meshoptimizer vertex codec
/// (`meshopt_encodeVertexBuffer`, one stream each); the stored byte length is the
/// matching `*_csize` field and the decoded length is derived from the counts:
///
/// | section            | stride | decoded size                    |
/// |--------------------|--------|---------------------------------|
/// | meshlet_descs      | 40     | `meshlet_count × 40`            |
/// | meshlet_tris       | 4      | `meshlet_tri_byte_count`        |
/// | meshlet_bounds     | 48     | `meshlet_count × 48`            |
/// | meshlet_positions  | 6      | `local_vert_count × 6`          |
/// | meshlet_normals    | 4      | `local_vert_count × 4`          |
///
/// * **Draw-range data** (`draw_range_offset`, raw): `draw_range_count × 20` bytes —
///   five consecutive `[u32; draw_range_count]` arrays:
///   ```text
///   ids[0..D]               — original GLB DrawRangeId
///   starts[0..D]            — first index into this group's index buffer
///   counts[0..D]            — number of indices in this draw range
///   dr_meshlet_starts[0..D] — first meshlet index for this draw range
///   dr_meshlet_counts[0..D] — number of meshlets in this draw range
///   ```
///
/// * **Meshlet descriptors**: `[MeshletDesc; meshlet_count]` — per-meshlet
///   `vertex_offset` / `triangle_offset` / counts + quantization AABB.
///
/// * **Meshlet triangles**: `[u8; meshlet_tri_byte_count]` — three u8 local
///   indices per triangle, per-meshlet padded to 4 bytes (so the total is always
///   4-aligned; the codec treats it as a stride-4 stream).
///
/// * **Meshlet bounds**: `[MeshletBounds; meshlet_count]` — bounding sphere +
///   normal cone per meshlet (cull input).
///
/// * **Meshlet positions**: `local_vert_count × 6` bytes — three `u16` per
///   vertex, quantized against the owning `MeshletDesc`'s `aabb_min`/`aabb_scale`.
///   Vertices are per-meshlet-local (a vertex shared by k meshlets is stored k
///   times), indexed by `MeshletDesc.vertex_offset + local_index`.
///
/// * **Meshlet normals**: `local_vert_count × 4` bytes — two `i16` octahedral per
///   vertex, parallel to `meshlet_positions`.  Offset+csize 0 when the model was
///   cooked without normals.
///
/// The flat f32 geometry (positions / indices / meshlet_verts / smooth normals)
/// exists only in cooker memory; it is never serialized (since v6).
///
/// # Layout (128 bytes, no implicit padding)
///
/// ```text
/// offset   size  field
///      0     16  color                    baseColorFactor RGBA linear
///     16      4  vertex_count             informational (source vertex count)
///     20      4  index_count              → triangle_count = index_count / 3
///     24      4  draw_range_count
///     28      4  meshlet_count            total meshlets across all draw ranges
///     32      8  draw_range_offset        → 5× [u32; D] raw (ids/starts/counts/ms/mc)
///     40      8  meshlet_desc_offset      → codec([MeshletDesc(40); meshlet_count])
///     48      8  meshlet_tris_offset      → codec([u8; meshlet_tri_byte_count])
///     56      8  meshlet_bounds_offset    → codec([MeshletBounds(48); meshlet_count])
///     64      8  meshlet_positions_offset → codec([u8; local_vert_count*6])
///     72      8  meshlet_normals_offset   → codec([u8; local_vert_count*4]) (0 if none)
///     80      4  meshlet_tri_byte_count   decoded triangle-stream length
///     84      4  local_vert_count         sum of every meshlet's vertex_count
///     88      4  meshlet_desc_csize       stored (compressed) byte lengths…
///     92      4  meshlet_tris_csize
///     96      4  meshlet_bounds_csize
///    100      4  meshlet_positions_csize
///    104      4  meshlet_normals_csize
///    108     20  _pad                     reserved, zero
/// total: 128
/// ```
///
/// [`ModelFileHeader`]: crate::ModelFileHeader
/// [`ModelFileHeader::color_groups_offset()`]: crate::ModelFileHeader::color_groups_offset
#[repr(C)]
#[derive(Clone, Copy, Debug, Zeroable, Pod)]
pub struct ColorGroupHeader {
    /// Base colour from `pbrMetallicRoughness.baseColorFactor` (RGBA, linear).
    pub color: [f32; 4],

    /// Number of source vertices (informational — the flat vertex data is not stored).
    pub vertex_count: u32,

    /// Number of source indices (always a multiple of 3); the loader derives
    /// `triangle_count = index_count / 3`.
    pub index_count: u32,

    /// Number of draw ranges in this color group.
    pub draw_range_count: u32,

    /// Total number of meshlets across all draw ranges.
    pub meshlet_count: u32,

    /// Absolute byte offset of the raw draw-range data section.
    ///
    /// Layout: `ids[D] ++ starts[D] ++ counts[D] ++ dr_meshlet_starts[D] ++ dr_meshlet_counts[D]`
    /// where `D = draw_range_count`.  Total size = `D × 20` bytes.
    pub draw_range_offset: u64,

    /// Absolute byte offset of the codec-compressed `[MeshletDesc; meshlet_count]`.
    pub meshlet_desc_offset: u64,

    /// Absolute byte offset of the codec-compressed packed triangle byte array
    /// (decoded: `[u8; meshlet_tri_byte_count]`, 4-aligned per meshlet).
    pub meshlet_tris_offset: u64,

    /// Absolute byte offset of the codec-compressed `[MeshletBounds; meshlet_count]`.
    pub meshlet_bounds_offset: u64,

    /// Absolute byte offset of the codec-compressed quantized position stream
    /// (decoded: `local_vert_count × 6` bytes, three `u16` per local vertex).
    pub meshlet_positions_offset: u64,

    /// Absolute byte offset of the codec-compressed quantized normal stream
    /// (decoded: `local_vert_count × 4` bytes, two `i16` octahedral per local
    /// vertex).  Zero when the model has no normals.
    pub meshlet_normals_offset: u64,

    /// Decoded byte length of the `meshlet_tris` stream.
    pub meshlet_tri_byte_count: u32,

    /// Total number of local (per-meshlet, duplicated) vertices = sum of every
    /// meshlet's `vertex_count`.  Sizes both quantized streams above.
    pub local_vert_count: u32,

    /// Stored (compressed) byte length of the `meshlet_descs` stream.
    pub meshlet_desc_csize: u32,

    /// Stored (compressed) byte length of the `meshlet_tris` stream.
    pub meshlet_tris_csize: u32,

    /// Stored (compressed) byte length of the `meshlet_bounds` stream.
    pub meshlet_bounds_csize: u32,

    /// Stored (compressed) byte length of the `meshlet_positions` stream.
    pub meshlet_positions_csize: u32,

    /// Stored (compressed) byte length of the `meshlet_normals` stream (0 if absent).
    pub meshlet_normals_csize: u32,

    /// Explicit padding / reserved (zero) to keep the header at 128 bytes.
    pub _pad: [u32; 5],
}
