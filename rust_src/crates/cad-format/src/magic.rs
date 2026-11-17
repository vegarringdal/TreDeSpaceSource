//! File magic and format version constants.

/// Four-byte magic at the start of every `.model` file.
pub const MAGIC: [u8; 4] = *b"CADM";

/// Format version embedded in [`ModelFileHeader::format_version`].
///
/// Bumped on any incompatible layout change.  The renderer rejects files whose
/// version does not match — re-cook required.  Versions bump freely in v1.
///
/// History:
///   1 — initial format (flat geometry, no meshlets).
///   2 — adds meshlet sections to `ColorGroupHeader`.
///   3 — adds per-vertex smooth normals: `normals_offset: u64` in
///       `ColorGroupHeader` (96 → 104 bytes).
///   4 — meshopt vertex-compression bump (header layout unchanged at 104 bytes;
///       positions/normals remained stored raw — compression fields were never
///       added to `ColorGroupHeader`).
///   5 — per-meshlet 16-bit position quantization (DECISIONS §3.19/§3.67).
///       `MeshletDesc` gains `aabb_min`/`aabb_scale` (16 → 40 bytes);
///       `ColorGroupHeader` gains `meshlet_positions_offset` + `meshlet_normals_offset`
///       + `local_vert_count` (104 → 128 bytes).  The GPU mesh shader reads the
///       quantized local streams (positions 6 B, octahedral normals 4 B/vertex)
///       instead of the global vertex buffer + `meshlet_verts`.
///   6 — drop the now-redundant raw sections: `vertex` (positions), `index`,
///       `meshlet_verts`, and `normals` are no longer written (their header
///       offsets are 0).  The loader rebuilds per-draw-range and per-CG AABBs
///       from the per-meshlet AABBs in `MeshletDesc` (union is exact).  Header
///       layout unchanged at 128 bytes; the dropped sections just become absent.
///   7 — compress the meshlet streams (descs, tris, bounds, quantized positions
///       + normals) with the meshoptimizer vertex codec; `ColorGroupHeader`
///       drops the dead v5 offset fields and gains per-stream compressed sizes
///       (`*_csize`).  Still 128 bytes, field layout changed.
pub const FORMAT_VERSION: u32 = 7;
