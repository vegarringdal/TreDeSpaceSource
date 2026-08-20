//! Meshlet descriptor and bounding-volume types.
//!
//! Used by `cad-cooker` (writer) and the mesh-shader pipeline (reader).
//!
//! # Coordinate conventions
//!
//! `MeshletBounds` fields use the same Z-up world space as the rest of the
//! `.model` format (Y-up → Z-up rotation already applied at cook time).

use bytemuck::{Pod, Zeroable};

// ── MeshletDesc ───────────────────────────────────────────────────────────────

/// Per-meshlet descriptor.
///
/// Layout mirrors `meshoptimizer`'s `meshopt_Meshlet` C struct exactly — all
/// four fields are `u32`, so the on-disk layout matches what the mesh shader
/// reads natively.
///
/// With per-meshlet quantization (DECISIONS §3.19), meshlet vertices are stored
/// **local + quantized** to this descriptor's AABB.
/// `vertex_offset` is the **element index** of this meshlet's first vertex in the
/// per-color-group quantized position / normal streams (no `meshlet_verts`
/// indirection any more):
///
/// ```text
/// meshlet_positions[(vertex_offset + i) * 6 ..]   → 3× u16 per vertex (i < vertex_count)
///     decode:  pos = aabb_min + u16 * aabb_scale
/// meshlet_normals  [(vertex_offset + i) * 4 ..]   → 2× i16 octahedral per vertex (if present)
/// meshlet_tris[triangle_offset .. triangle_offset + ((triangle_count*3+3)&!3)]
///     → [u8]   three 8-bit LOCAL vertex indices (0..vertex_count) per triangle, padded to 4
/// ```
///
/// # Layout (40 bytes, no implicit padding)
///
/// ```text
/// offset   size  field
///      0      4  vertex_offset    element index into the local position/normal streams
///      4      4  triangle_offset  byte offset into meshlet_tris
///      8      4  vertex_count
///     12      4  triangle_count
///     16     12  aabb_min   [f32;3]   quantization box minimum corner (Z-up world)
///     28     12  aabb_scale [f32;3]   per-axis (extent / 65535); pos = aabb_min + u16*aabb_scale
/// total: 40
/// ```
///
/// [`ColorGroupHeader`]: crate::ColorGroupHeader
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Zeroable, Pod)]
pub struct MeshletDesc {
    /// Element index of this meshlet's first vertex in the per-CG quantized
    /// position / normal streams.
    pub vertex_offset: u32,
    /// Byte offset of this meshlet's triangle data within `meshlet_tris`.
    pub triangle_offset: u32,
    /// Number of unique vertices in this meshlet (≤ 64).
    pub vertex_count: u32,
    /// Number of triangles in this meshlet (≤ 124).
    pub triangle_count: u32,
    /// Quantization box minimum corner (Z-up world space).
    pub aabb_min: [f32; 3],
    /// Per-axis quantization scale = `extent / 65535`.  Decode a u16 component `q`
    /// as `aabb_min[k] + q * aabb_scale[k]`.  Zero on a degenerate (flat) axis.
    pub aabb_scale: [f32; 3],
}

// ── MeshletBounds ─────────────────────────────────────────────────────────────

/// Per-meshlet bounding sphere + backface cone, for GPU culling.
///
/// Computed by `meshoptimizer::computeMeshletBounds`.  Stores the full-precision
/// (`f32`) fields only — the quantised `i8` fields (`cone_axis_s8`,
/// `cone_cutoff_s8`) are omitted; they can be recomputed from these values in
/// the shader if needed, or stored later.
///
/// Used by the compute cull pass:
/// - **Frustum cull**: sphere test with `center` + `radius`.
/// - **Backface cone cull**: `dot(view_dir, cone_axis) < cone_cutoff` — the
///   meshlet is entirely back-facing and can be discarded.
///
/// # Layout (48 bytes, no implicit padding)
///
/// ```text
/// offset   size  field
///      0     12  center       bounding sphere centre (world space, Z-up)
///     12      4  radius       bounding sphere radius
///     16     12  cone_apex    apex of the normal cone
///     28     12  cone_axis    unit axis of the normal cone
///     40      4  cone_cutoff  cos(half-angle) of the cone; < 1 = valid cone
///     44      4  _pad         explicit padding
/// total: 48
/// ```
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Zeroable, Pod)]
pub struct MeshletBounds {
    /// Centre of the bounding sphere (Z-up world space).
    pub center: [f32; 3],
    /// Radius of the bounding sphere.
    pub radius: f32,
    /// Apex point of the backface normal cone.
    pub cone_apex: [f32; 3],
    /// Unit axis of the backface normal cone.
    pub cone_axis: [f32; 3],
    /// Cosine of the half-angle of the normal cone.
    /// A value ≥ 1.0 means the cone is degenerate (all normals, cone culling not applicable).
    pub cone_cutoff: f32,
    /// Explicit padding to reach 48 bytes and satisfy alignment.
    pub _pad: u32,
}
