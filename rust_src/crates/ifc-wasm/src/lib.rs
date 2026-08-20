//! WebAssembly bindings for ifc2glb.
//!
//! [`convert_ifc`] takes raw IFC bytes + options and returns a [`ConvertedFiles`] handle
//! (the GLB(s) + `status_file.json`), so a browser can convert entirely client-side. The
//! heavy lifting is the same [`ifc_core::convert`] the CLI uses.

use ifc_core::{
    ConvertOptions, Openings, OutputMode, Quality, Spaces, SplitTier, convert,
    convert_with_progress,
};
use wasm_bindgen::prelude::*;

/// Install a panic hook that forwards Rust panics to the browser console.
#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}

/// The `ifc2glb-wasm` crate version.
#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Conversion options passed from JS. Strings are parsed leniently; unknown values fall
/// back to the defaults.
#[wasm_bindgen]
#[derive(Clone)]
pub struct Options {
    mode: OutputMode,
    split: SplitTier,
    quality: Quality,
    spaces: Spaces,
    openings: Openings,
    recenter: bool,
    source_name: String,
}

#[wasm_bindgen]
impl Options {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Options {
        Options {
            mode: OutputMode::Merged,
            split: SplitTier::None,
            quality: Quality::Medium,
            spaces: Spaces::Skip,
            openings: Openings::Skip,
            recenter: true,
            source_name: "model.ifc".to_string(),
        }
    }

    /// `"merged"` | `"standard"`.
    #[wasm_bindgen(setter)]
    pub fn set_mode(&mut self, v: String) {
        if let Some(m) = OutputMode::parse(&v) {
            self.mode = m;
        }
    }
    /// `"none"` | `"site"` | `"building"` | `"storey"`.
    #[wasm_bindgen(setter)]
    pub fn set_split(&mut self, v: String) {
        if let Some(s) = SplitTier::parse(&v) {
            self.split = s;
        }
    }
    /// `"lowest"` | `"low"` | `"medium"` | `"high"` | `"highest"`.
    #[wasm_bindgen(setter)]
    pub fn set_quality(&mut self, v: String) {
        if let Some(q) = Quality::parse(&v) {
            self.quality = q;
        }
    }
    /// `"skip"` | `"include"` | `"separate"`.
    #[wasm_bindgen(setter)]
    pub fn set_spaces(&mut self, v: String) {
        if let Some(s) = Spaces::parse(&v) {
            self.spaces = s;
        }
    }
    /// `"skip"` | `"include"` | `"separate"`.
    #[wasm_bindgen(setter)]
    pub fn set_openings(&mut self, v: String) {
        if let Some(o) = Openings::parse(&v) {
            self.openings = o;
        }
    }
    #[wasm_bindgen(setter)]
    pub fn set_recenter(&mut self, v: bool) {
        self.recenter = v;
    }
    #[wasm_bindgen(setter)]
    pub fn set_source_name(&mut self, v: String) {
        self.source_name = v;
    }
}

impl Default for Options {
    fn default() -> Self {
        Self::new()
    }
}

impl From<&Options> for ConvertOptions {
    fn from(o: &Options) -> Self {
        ConvertOptions {
            mode: o.mode,
            split: o.split,
            quality: o.quality,
            spaces: o.spaces,
            openings: o.openings,
            recenter: o.recenter,
            dry_run: false,
            source_name: o.source_name.clone(),
        }
    }
}

/// The output files of one conversion. Iterate by index: `len()`, then `name(i)` +
/// `bytes(i)`. Includes the GLB(s) and the trailing `status_file.json`.
#[wasm_bindgen]
pub struct ConvertedFiles {
    names: Vec<String>,
    blobs: Vec<Vec<u8>>,
    mesh_count: usize,
    triangle_count: usize,
    schema: Option<String>,
}

#[wasm_bindgen]
impl ConvertedFiles {
    #[wasm_bindgen(getter)]
    pub fn len(&self) -> usize {
        self.names.len()
    }
    #[wasm_bindgen(getter)]
    pub fn is_empty(&self) -> bool {
        self.names.is_empty()
    }
    pub fn name(&self, i: usize) -> Option<String> {
        self.names.get(i).cloned()
    }
    /// The file's bytes (copied out to JS as a `Uint8Array`).
    pub fn bytes(&self, i: usize) -> Option<Vec<u8>> {
        self.blobs.get(i).cloned()
    }
    #[wasm_bindgen(getter)]
    pub fn mesh_count(&self) -> usize {
        self.mesh_count
    }
    #[wasm_bindgen(getter)]
    pub fn triangle_count(&self) -> usize {
        self.triangle_count
    }
    #[wasm_bindgen(getter)]
    pub fn schema(&self) -> Option<String> {
        self.schema.clone()
    }
}

/// Convert an IFC model to GLB(s) + `status_file.json`.
///
/// `on_progress` is an optional JS callback `(fraction: number) => void` reporting
/// `0.0..=1.0`; pass `null`/`undefined` to skip. It fires synchronously during the (wasm)
/// conversion — a Web Worker can forward it to the main thread to drive a progress bar.
#[wasm_bindgen]
pub fn convert_ifc(
    ifc_bytes: &[u8],
    opts: &Options,
    on_progress: Option<js_sys::Function>,
) -> Result<ConvertedFiles, JsError> {
    let convert_opts = ConvertOptions::from(opts);
    let out = match &on_progress {
        Some(cb) => convert_with_progress(ifc_bytes, &convert_opts, &mut |frac| {
            let _ = cb.call1(&JsValue::NULL, &JsValue::from_f64(frac as f64));
        }),
        None => convert(ifc_bytes, &convert_opts),
    }
    .map_err(|e| JsError::new(&e))?;
    let (mesh_count, triangle_count, schema) = (
        out.report.mesh_count,
        out.report.triangle_count,
        out.report.schema.clone(),
    );
    let mut names = Vec::with_capacity(out.files.len());
    let mut blobs = Vec::with_capacity(out.files.len());
    for f in out.files {
        names.push(f.name);
        blobs.push(f.bytes);
    }
    Ok(ConvertedFiles {
        names,
        blobs,
        mesh_count,
        triangle_count,
        schema,
    })
}

/// A JSON summary of what a model contains, without producing GLBs.
#[wasm_bindgen]
pub fn inspect_ifc(ifc_bytes: &[u8]) -> Result<String, JsError> {
    let opts = ConvertOptions {
        dry_run: true,
        ..ConvertOptions::default()
    };
    let out = convert(ifc_bytes, &opts).map_err(|e| JsError::new(&e))?;
    let r = &out.report;
    let schema = r
        .schema
        .as_deref()
        .map(|s| format!("\"{s}\""))
        .unwrap_or_else(|| "null".to_string());
    Ok(format!(
        "{{\"mesh_count\":{},\"triangle_count\":{},\"schema\":{}}}",
        r.mesh_count, r.triangle_count, schema
    ))
}

/// IFC → cooked `.tdp`(s) in ONE step: each merged output goes straight into the
/// cooker, so no GLB is built, serialised or parsed. Names come back as
/// `<stem>.tdp`, each optionally followed by `<stem>.coarse.tdp` when `coarsen`
/// is set, plus the usual trailing `status_file.json`.
#[wasm_bindgen]
pub fn convert_ifc_tdp(
    ifc_bytes: &[u8],
    opts: &Options,
    on_progress: Option<js_sys::Function>,
    compute_normals: bool,
    coarsen: bool,
) -> Result<ConvertedFiles, JsError> {
    let convert_opts = ConvertOptions::from(opts);
    // (stem, coarse bytes) collected as each output is cooked, so the coarse
    // file can be emitted next to its full sibling below.
    let coarse_by_stem: std::cell::RefCell<Vec<(String, Vec<u8>)>> =
        std::cell::RefCell::new(Vec::new());
    let out = ifc_core::convert_cooked(ifc_bytes, &convert_opts, &|merged, stem| {
        if let Some(cb) = &on_progress {
            let _ = cb.call1(&JsValue::NULL, &JsValue::from_f64(0.95));
        }
        let (full, coarse) = cook_merged(to_cooker_model(merged), compute_normals, coarsen)?;
        if let Some(c) = coarse {
            coarse_by_stem.borrow_mut().push((stem.to_string(), c));
        }
        Ok(full)
    })
    .map_err(|e| JsError::new(&e))?;

    let (mesh_count, triangle_count, schema) = (
        out.report.mesh_count,
        out.report.triangle_count,
        out.report.schema.clone(),
    );
    let coarse = coarse_by_stem.into_inner();
    let mut names = Vec::with_capacity(out.files.len() + coarse.len());
    let mut blobs = Vec::with_capacity(out.files.len() + coarse.len());
    for f in out.files {
        let stem = f.name.strip_suffix(".tdp").map(str::to_string);
        names.push(f.name);
        blobs.push(f.bytes);
        if let Some(stem) = stem {
            if let Some(i) = coarse.iter().position(|(s, _)| *s == stem) {
                names.push(format!("{stem}.coarse.tdp"));
                blobs.push(coarse[i].1.clone());
            }
        }
    }
    Ok(ConvertedFiles {
        names,
        blobs,
        mesh_count,
        triangle_count,
        schema,
    })
}

// ── Direct cook: converter → cooker, no GLB ──────────────────────────────────

/// Bridge the converter's in-memory merged export to the cooker's input, so a
/// model can be cooked to `.tdp` without ever serialising a GLB.
///
/// The only transform is the axis flip: the merged build works in glTF space
/// (Y-up), the cooker wants Z-up, and this applies the same `[x, -z, y]` the
/// cooker applies when reading a GLB — so both paths cook identical bytes.
pub fn to_cooker_model(merged: ifc_core::glb::MergedData) -> cooker_core::MergedModel {
    let nodes = merged
        .nodes
        .into_iter()
        .map(|n| cooker_core::MergedNode {
            base_color: n.base_color,
            positions: n
                .positions
                .chunks_exact(3)
                .map(|p| [p[0], -p[2], p[1]])
                .collect(),
            indices: n.indices,
            draw_ranges: n
                .draw_ranges
                .into_iter()
                .map(|(id, index_start, index_count)| cooker_core::MergedRange {
                    id,
                    index_start,
                    index_count,
                })
                .collect(),
        })
        .collect();
    let hierarchy = merged
        .hierarchy
        .into_iter()
        .map(|(id, name, parent)| cooker_core::MergedHierarchyEntry {
            id,
            name,
            parent_id: parent,
        })
        .collect();
    cooker_core::MergedModel { nodes, hierarchy }
}

/// Cook a merged model into the full `.tdp` (and, when asked, the coarse
/// variant the VRAM budget swaps in). Mirrors what the cooker wasm does for a
/// GLB, so the app's asset pipeline is unchanged apart from the input.
pub fn cook_merged(
    model: cooker_core::MergedModel,
    compute_normals: bool,
    coarsen: bool,
) -> Result<(Vec<u8>, Option<Vec<u8>>), String> {
    let opts = cooker_core::CookOptions {
        compute_normals,
        dense_bounds: true,
        coarsen: None,
        spatial_order: true,
    };
    let coarse = if coarsen {
        let c = cooker_core::CookOptions {
            coarsen: Some(cooker_core::CoarsenOptions::default()),
            ..opts
        };
        cooker_core::cook_model(model.clone(), c)
            .map(|o| Some(o.bytes))
            .map_err(|e| e.to_string())?
    } else {
        None
    };
    let full = cooker_core::cook_model(model, opts).map_err(|e| e.to_string())?;
    Ok((full.bytes, coarse))
}
