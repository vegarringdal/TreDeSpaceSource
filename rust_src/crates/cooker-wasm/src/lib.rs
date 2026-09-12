//! wasm-bindgen shell: `cook(glbBytes, computeNormals, coarsen)` → cooked CADM
//! (v9), plus `cookMergedModel` for a model handed over as flat typed arrays.
//! Byte-identical to the reference cooker (see cooker-core golden test).

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct CookResult {
    bytes: Vec<u8>,
    coarse: Option<Vec<u8>>,
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
    /// The coarse variant — present only when the cook asked for one.
    #[wasm_bindgen(getter)]
    pub fn coarse(&self) -> Option<Vec<u8>> {
        self.coarse.clone()
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

/// The app's cook settings: v9 — dense bounds + cell-ordered items.
fn app_options(compute_normals: bool) -> cooker_core::CookOptions {
    cooker_core::CookOptions {
        compute_normals,
        dense_bounds: true,
        coarsen: None,
        spatial_order: true,
    }
}

fn to_result(
    out: cooker_core::CookOutput,
    coarse: Option<cooker_core::CookOutput>,
) -> CookResult {
    // read both boxes straight from the packed header (48..72 full, 216..240 dense)
    let f = |o: usize| f32::from_le_bytes(out.bytes[o..o + 4].try_into().unwrap());
    let bounds = [f(48), f(52), f(56), f(60), f(64), f(68)];
    let dense = [f(216), f(220), f(224), f(228), f(232), f(236)];
    CookResult {
        bytes: out.bytes,
        coarse: coarse.map(|c| c.bytes),
        root_name: out.root_name,
        bounds,
        dense,
    }
}

fn js_err(e: anyhow::Error) -> JsError {
    JsError::new(&format!("{e:#}"))
}

/// Cook one merged GLB. Throws (JS exception) with the cooker's error message
/// on non-merged input or malformed GLBs. `coarsen` additionally produces the
/// aggressive low-detail variant for the VRAM-budget residency swap (same item
/// table as the full cook — only geometry shrinks) from the SAME parse, so the
/// GLB is decoded once for both.
#[wasm_bindgen]
pub fn cook(glb: &[u8], compute_normals: bool, coarsen: bool) -> Result<CookResult, JsError> {
    console_error_panic_hook::set_once();
    let opts = app_options(compute_normals);
    if !coarsen {
        return Ok(to_result(cooker_core::cook(glb, opts).map_err(js_err)?, None));
    }
    let (full, coarse) = cooker_core::cook_both(glb, opts).map_err(js_err)?;
    Ok(to_result(full, Some(coarse)))
}

/// Cook a model handed over as flat typed arrays (see cooker-core `flat.rs`
/// for the layout) — the `.tdp` export path, which builds the arrays from the
/// viewer's own geometry instead of writing a GLB first. Same cook settings as
/// `cook`; no coarse variant (a re-import derives it from the file).
#[wasm_bindgen(js_name = cookMergedModel)]
pub fn cook_merged_model(
    positions: &[f32],
    indices: &[u32],
    nodes: &[u32],
    colors: &[f32],
    ranges: &[u32],
    hierarchy_json: &str,
    compute_normals: bool,
) -> Result<CookResult, JsError> {
    console_error_panic_hook::set_once();
    let model = cooker_core::model_from_flat(positions, indices, nodes, colors, ranges, hierarchy_json)
        .map_err(js_err)?;
    let out = cooker_core::cook_model(model, app_options(compute_normals)).map_err(js_err)?;
    Ok(to_result(out, None))
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
    cooker_core::coarsen_tdp(tdp, cooker_core::CoarsenOptions::default()).map_err(js_err)
}

/// Cooker version — part of any future cache key.
#[wasm_bindgen(js_name = cookerVersion)]
pub fn cooker_version() -> u32 {
    cooker_core::COOKER_VERSION
}
