//! wasm-bindgen shell: `cook(glbBytes, computeNormals)` → cooked CADM v7.
//! Byte-identical to the reference cooker (see cooker-core golden test).

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct CookResult {
    bytes: Vec<u8>,
    root_name: String,
    bounds: [f32; 6],
    dense: [f32; 6],
}

#[wasm_bindgen]
impl CookResult {
    #[wasm_bindgen(getter)]
    pub fn bytes(&self) -> Vec<u8> {
        self.bytes.clone()
    }
    #[wasm_bindgen(getter, js_name = rootName)]
    pub fn root_name(&self) -> String {
        self.root_name.clone()
    }
    /// Full AABB [minX,minY,minZ,maxX,maxY,maxZ].
    #[wasm_bindgen(getter)]
    pub fn bounds(&self) -> Vec<f32> {
        self.bounds.to_vec()
    }
    /// 10th–90th percentile dense bounds, same layout.
    #[wasm_bindgen(getter)]
    pub fn dense(&self) -> Vec<f32> {
        self.dense.to_vec()
    }
}

/// Cook one merged GLB. Throws (JS exception) with the cooker's error message
/// on non-merged input or malformed GLBs. `coarsen` produces the aggressive
/// low-detail variant for the VRAM-budget residency swap (same item table as
/// the full cook — only geometry shrinks).
#[wasm_bindgen]
pub fn cook(glb: &[u8], compute_normals: bool, coarsen: bool) -> Result<CookResult, JsError> {
    console_error_panic_hook::set_once();
    let out = cooker_core::cook(
        glb,
        cooker_core::CookOptions {
            compute_normals,
            dense_bounds: true,
            coarsen: coarsen.then(cooker_core::CoarsenOptions::default),
            spatial_order: true, // v9: cell-ordered items + cell table
        },
    )
    .map_err(|e| JsError::new(&format!("{e:#}")))?;
    // read both boxes straight from the packed header (48..72 full, 216..240 dense)
    let f = |o: usize| f32::from_le_bytes(out.bytes[o..o + 4].try_into().unwrap());
    let bounds = [f(48), f(52), f(56), f(60), f(64), f(68)];
    let dense = [f(216), f(220), f(224), f(228), f(232), f(236)];
    Ok(CookResult {
        bytes: out.bytes,
        root_name: out.root_name,
        bounds,
        dense,
    })
}

/// Build the coarse variant of an already-cooked `.tdp` (CADM v7–v9) — no
/// source file needed. Geometry is rebuilt from the packed meshlet streams and
/// re-coarsened with the default settings; the item table, hierarchy, cell
/// table and bounds are copied verbatim, so the output is a valid residency
/// swap partner for the input. Throws on wrong magic/version or a truncated
/// file.
#[wasm_bindgen(js_name = coarsenTdp)]
pub fn coarsen_tdp(tdp: &[u8]) -> Result<Vec<u8>, JsError> {
    console_error_panic_hook::set_once();
    cooker_core::coarsen_tdp(tdp, cooker_core::CoarsenOptions::default())
        .map_err(|e| JsError::new(&format!("{e:#}")))
}

/// Cooker version — part of any future cache key.
#[wasm_bindgen(js_name = cookerVersion)]
pub fn cooker_version() -> u32 {
    cooker_core::COOKER_VERSION
}
