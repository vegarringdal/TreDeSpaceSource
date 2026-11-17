//! The few meshoptimizer calls the cook makes, over the shared `meshopt`
//! crate's raw bindings (meshoptimizer 1.3, `rust_src/crates/meshopt`).

use std::os::raw::{c_int, c_void};

use meshopt::ffi;

/// A permutation of `0..positions.len()` whose consecutive runs of
/// `cluster_size` are spatially compact (`meshopt_spatialClusterPoints`).
pub fn spatial_cluster_points(positions: &[[f32; 3]], cluster_size: usize) -> Vec<u32> {
    let mut out = vec![0u32; positions.len()];
    if positions.is_empty() {
        return out;
    }
    assert!(cluster_size > 0);
    unsafe {
        ffi::meshopt_spatialClusterPoints(
            out.as_mut_ptr(),
            positions.as_ptr().cast(),
            positions.len(),
            12,
            cluster_size,
        );
    }
    out
}

/// Indices of at most `target` representative points
/// (`meshopt_simplifyPoints`, colour-aware when `colors` is given).
pub fn simplify_points(
    positions: &[[f32; 3]],
    colors: Option<&[[f32; 3]]>,
    color_weight: f32,
    target: usize,
) -> Vec<u32> {
    if positions.is_empty() || target == 0 {
        return Vec::new();
    }
    if let Some(c) = colors {
        assert_eq!(c.len(), positions.len());
    }
    let target = target.min(positions.len());
    let mut out = vec![0u32; target];
    let n = unsafe {
        ffi::meshopt_simplifyPoints(
            out.as_mut_ptr(),
            positions.as_ptr().cast(),
            positions.len(),
            12,
            colors.map_or(std::ptr::null(), |c| c.as_ptr().cast()),
            12,
            color_weight,
            target,
        )
    };
    out.truncate(n);
    out
}

/// Vertex codec, format version 1 (decodable by meshoptimizer ≥ 0.23, the
/// viewer's `MeshoptDecoder`), compression `level` 0..=3.
pub fn encode_vertex(data: &[u8], vertex_size: usize, level: i32) -> Vec<u8> {
    assert!(
        vertex_size.is_multiple_of(4)
            && vertex_size <= 256
            && data.len().is_multiple_of(vertex_size)
    );
    let count = data.len() / vertex_size;
    let bound = unsafe { ffi::meshopt_encodeVertexBufferBound(count, vertex_size) };
    let mut out = vec![0u8; bound];
    let n = unsafe {
        ffi::meshopt_encodeVertexBufferLevel(
            out.as_mut_ptr(),
            out.len(),
            data.as_ptr().cast::<c_void>(),
            count,
            vertex_size,
            level.clamp(0, 3) as c_int,
            1,
        )
    };
    assert!(n > 0, "meshopt_encodeVertexBufferLevel failed");
    out.truncate(n);
    out
}

/// Decode a vertex-codec stream of `count` vertices.
pub fn decode_vertex(encoded: &[u8], count: usize, vertex_size: usize) -> Result<Vec<u8>, i32> {
    let mut out = vec![0u8; count * vertex_size];
    let rc = unsafe {
        ffi::meshopt_decodeVertexBuffer(
            out.as_mut_ptr().cast(),
            count,
            vertex_size,
            encoded.as_ptr(),
            encoded.len(),
        )
    };
    if rc == 0 {
        Ok(out)
    } else {
        Err(rc)
    }
}
