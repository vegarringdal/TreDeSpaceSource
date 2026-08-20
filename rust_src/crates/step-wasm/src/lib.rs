//! WebAssembly shell for step2glb.
//!
//! Deliberately tiny and **synchronous**: STEP bytes in, GLB bytes + a JSON
//! report out. All file I/O (reading the upload, writing the result) is done on
//! the JavaScript side — in a Web Worker using OPFS **synchronous** access
//! handles (`createSyncAccessHandle`) — so the CPU-bound core never has to
//! become `async`. See `wasm-demo/` for the worker + page that drive this.
//!
//! Build (needs the wasm-bindgen CLI / wasm-pack, not required to *compile*):
//!   wasm-pack build crates/wasm --target web --out-dir ../../wasm-demo/pkg
//! or: cargo build -p step2glb-wasm --target wasm32-unknown-unknown

use step_core::convert::{convert, convert_with_progress, ConvertOptions};
use step_core::io::{InputHandle, MemSink, MemTemp, OutputHandle, TempHandle};
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;

/// The result of a conversion: the GLB bytes plus a JSON diagnostics report
/// (`facesOk`, `facesSkipped`, `unsupported*`, `unitAssumedMillimetres`, …).
#[wasm_bindgen]
pub struct ConvertResult {
    glb: Vec<u8>,
    info: String,
}

#[wasm_bindgen]
impl ConvertResult {
    /// The GLB bytes (a `Uint8Array` in JS).
    #[wasm_bindgen(getter)]
    pub fn glb(&self) -> Vec<u8> {
        self.glb.clone()
    }
    /// The JSON diagnostics report.
    #[wasm_bindgen(getter)]
    pub fn info(&self) -> String {
        self.info.clone()
    }
}

/// Install the panic hook once, so a wasm abort (a Rust panic, or an
/// out-of-memory when `memory.grow` fails) surfaces as a readable console
/// message rather than a bare `unreachable` trap.
#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}

fn run(bytes: &[u8], opts: &ConvertOptions) -> Result<ConvertResult, JsValue> {
    let input = bytes.to_vec();
    let mut out = MemSink::default();
    let mut tmp = MemTemp::default();
    let report =
        convert(Box::new(input), &mut out, &mut tmp, opts).map_err(|e| JsValue::from_str(&e))?;
    Ok(ConvertResult {
        glb: out.0,
        info: report.to_json(),
    })
}

/// Convert a STEP file (raw bytes) to GLB with the default options. Returns a
/// [`ConvertResult`] (GLB bytes + JSON report), or a JS error string.
#[wasm_bindgen]
pub fn convert_step_to_glb(step_bytes: &[u8]) -> Result<ConvertResult, JsValue> {
    run(step_bytes, &ConvertOptions::default())
}

// A JS progress sink for the in-RAM path: `report(done, total)` is called as
// product nodes finish (throttled to ~5% by the core), mirroring the streaming
// path's `io.progress`. The worker forwards it to the page as a postMessage.
#[wasm_bindgen]
extern "C" {
    pub type Progress;
    #[wasm_bindgen(method)]
    fn report(this: &Progress, done: f64, total: f64);
}

/// Convert with the knobs a viewer exposes. `cleanup` runs the rvm-style
/// position weld (+ degenerate drop; the simplify step needs meshoptimizer,
/// which the wasm build omits). `merged` selects the one-mesh-per-color world-
/// baked layout vs the hierarchical per-part node tree. `progress.report(done,
/// total)` fires as product nodes are processed — the in-RAM counterpart of the
/// streaming path's `io.progress`, so the UI shows % on this path too.
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn convert_step_to_glb_opts(
    step_bytes: &[u8],
    deflection_mm: f64,
    max_angle_deg: f64,
    y_up: bool,
    keep_normals: bool,
    cleanup: bool,
    merged: bool,
    progress: &Progress,
) -> Result<ConvertResult, JsValue> {
    let opts = ConvertOptions {
        deflection_mm,
        max_angle_deg,
        rotate_z_up: y_up,
        drop_normals: !keep_normals,
        cleanup,
        merged,
        ..ConvertOptions::default()
    };
    let mut out = MemSink::default();
    let mut tmp = MemTemp::default();
    let report = convert_with_progress(
        Box::new(step_bytes.to_vec()),
        &mut out,
        &mut tmp,
        &opts,
        &mut |done, total| progress.report(done as f64, total as f64),
    )
    .map_err(|e| JsValue::from_str(&e))?;
    Ok(ConvertResult {
        glb: out.0,
        info: report.to_json(),
    })
}

/// Cooked result: the `.tdp` the viewer loads, plus the optional coarse variant
/// the VRAM budget swaps in.
#[wasm_bindgen]
pub struct CookedResult {
    tdp: Vec<u8>,
    coarse: Option<Vec<u8>>,
    info: String,
}

#[wasm_bindgen]
impl CookedResult {
    #[wasm_bindgen(getter)]
    pub fn tdp(&self) -> Vec<u8> {
        self.tdp.clone()
    }
    /// The coarse `.tdp`, or `undefined` when not requested / not produced.
    #[wasm_bindgen(getter)]
    pub fn coarse(&self) -> Option<Vec<u8>> {
        self.coarse.clone()
    }
    #[wasm_bindgen(getter)]
    pub fn info(&self) -> String {
        self.info.clone()
    }
}

/// STEP → cooked `.tdp` in ONE step: the merged model goes straight into the
/// cooker, so no GLB is built, serialised or parsed. Merged mode only — the
/// hierarchical layout carries no draw ranges for the cooker to key items on.
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn convert_step_to_tdp(
    step_bytes: &[u8],
    deflection_mm: f64,
    max_angle_deg: f64,
    y_up: bool,
    keep_normals: bool,
    cleanup: bool,
    compute_normals: bool,
    coarsen: bool,
    progress: &Progress,
) -> Result<CookedResult, JsValue> {
    let opts = ConvertOptions {
        deflection_mm,
        max_angle_deg,
        rotate_z_up: y_up,
        drop_normals: !keep_normals,
        cleanup,
        merged: true,
        ..ConvertOptions::default()
    };
    let coarse_out: std::cell::RefCell<Option<Vec<u8>>> = std::cell::RefCell::new(None);
    let mut out = MemSink::default();
    let mut tmp = MemTemp::default();
    let report = step_core::convert::convert_cooked(
        Box::new(step_bytes.to_vec()),
        &mut out,
        &mut tmp,
        &opts,
        &|merged| {
            let (full, coarse) = cook_merged(to_cooker_model(merged), compute_normals, coarsen)?;
            *coarse_out.borrow_mut() = coarse;
            Ok(full)
        },
    )
    .map_err(|e| JsValue::from_str(&e))?;
    let _ = progress;
    Ok(CookedResult {
        tdp: out.0,
        coarse: coarse_out.into_inner(),
        info: report.to_json(),
    })
}

/// Version of the underlying converter, for the demo UI.
#[wasm_bindgen]
pub fn version() -> String {
    concat!("step2glb-wasm ", env!("CARGO_PKG_VERSION")).to_string()
}

// Freestanding `wasm32-unknown-unknown` has no C++ runtime, so meshoptimizer's
// C++ `operator new`/`delete` (`_Znwm`/`_ZdlPv`/…) are undefined at link time.
// Provide minimal versions backed by Rust's global allocator. Only on wasm +
// `optimize` — on native, libstdc++/libc++ already defines these (defining ours
// would clash).
#[cfg(all(feature = "optimize", target_arch = "wasm32"))]
mod cxx_alloc {
    use std::alloc::{alloc, dealloc, Layout};

    // Stash the allocation size in a 16-byte header so sizeless `operator
    // delete` can reconstruct the Layout; 16 also keeps the returned pointer
    // suitably aligned.
    const HDR: usize = 16;

    unsafe fn cxx_new(size: usize) -> *mut u8 {
        let layout = Layout::from_size_align(size + HDR, HDR).unwrap();
        // SAFETY: layout has non-zero size (size + HDR >= HDR).
        let base = alloc(layout);
        if base.is_null() {
            return base;
        }
        (base as *mut usize).write(size);
        base.add(HDR)
    }

    unsafe fn cxx_delete(ptr: *mut u8) {
        if ptr.is_null() {
            return;
        }
        let base = ptr.sub(HDR);
        let size = (base as *const usize).read();
        dealloc(base, Layout::from_size_align(size + HDR, HDR).unwrap());
    }

    #[no_mangle]
    pub extern "C" fn _Znwm(size: usize) -> *mut u8 {
        unsafe { cxx_new(size) }
    }
    #[no_mangle]
    pub extern "C" fn _Znam(size: usize) -> *mut u8 {
        unsafe { cxx_new(size) }
    }
    #[no_mangle]
    pub extern "C" fn _ZdlPv(ptr: *mut u8) {
        unsafe { cxx_delete(ptr) }
    }
    #[no_mangle]
    pub extern "C" fn _ZdaPv(ptr: *mut u8) {
        unsafe { cxx_delete(ptr) }
    }
    #[no_mangle]
    pub extern "C" fn _ZdlPvm(ptr: *mut u8, _size: usize) {
        unsafe { cxx_delete(ptr) }
    }
    #[no_mangle]
    pub extern "C" fn _ZdaPvm(ptr: *mut u8, _size: usize) {
        unsafe { cxx_delete(ptr) }
    }
}

// ---------------------------------------------------- streaming (callback) API

// A JS object the worker provides, backed by OPFS *synchronous* access handles.
// Rust calls these to pull input ranges, append the GLB, spill geometry to a
// temp file, and report progress — so nothing larger than a chunk is ever held
// in wasm memory. Offsets/lengths are passed as f64 (JS numbers).
#[wasm_bindgen]
extern "C" {
    pub type Io;
    #[wasm_bindgen(method)]
    fn size(this: &Io) -> f64;
    #[wasm_bindgen(method)]
    fn read(this: &Io, offset: f64, len: f64) -> Vec<u8>;
    #[wasm_bindgen(method, js_name = writeOutput)]
    fn write_output(this: &Io, bytes: &[u8]);
    #[wasm_bindgen(method, js_name = writeTemp)]
    fn write_temp(this: &Io, offset: f64, bytes: &[u8]);
    #[wasm_bindgen(method, js_name = readTemp)]
    fn read_temp(this: &Io, offset: f64, len: f64) -> Vec<u8>;
    #[wasm_bindgen(method, js_name = tempLen)]
    fn temp_len(this: &Io) -> f64;
    #[wasm_bindgen(method)]
    fn progress(this: &Io, done: f64, total: f64);
}

fn copy_in(data: &[u8], buf: &mut [u8]) -> usize {
    let n = data.len().min(buf.len());
    buf[..n].copy_from_slice(&data[..n]);
    n
}

struct OpfsInput(Io);
// SAFETY: wasm32 is single-threaded; the handle is never touched concurrently.
unsafe impl Send for OpfsInput {}
unsafe impl Sync for OpfsInput {}
impl InputHandle for OpfsInput {
    fn size(&self) -> u64 {
        self.0.size() as u64
    }
    fn read_at(&self, offset: u64, buf: &mut [u8]) -> std::io::Result<usize> {
        Ok(copy_in(&self.0.read(offset as f64, buf.len() as f64), buf))
    }
}

struct OpfsOutput(Io);
impl OutputHandle for OpfsOutput {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<()> {
        self.0.write_output(buf);
        Ok(())
    }
}

struct OpfsTemp(Io);
impl TempHandle for OpfsTemp {
    fn write_at(&mut self, offset: u64, buf: &[u8]) -> std::io::Result<()> {
        self.0.write_temp(offset as f64, buf);
        Ok(())
    }
    fn read_at(&self, offset: u64, buf: &mut [u8]) -> std::io::Result<usize> {
        Ok(copy_in(
            &self.0.read_temp(offset as f64, buf.len() as f64),
            buf,
        ))
    }
    fn len(&self) -> u64 {
        self.0.temp_len() as u64
    }
}

/// Streaming conversion: input is read **by range** from the `io` handle, the
/// GLB is written through `io.writeOutput`, geometry spills through
/// `io.writeTemp`/`readTemp`, and progress is reported via `io.progress`. The
/// whole file is never materialized in wasm memory. Returns the JSON report
/// (the GLB bytes went out through `io`, not the return value).
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn convert_streaming(
    io: Io,
    deflection_mm: f64,
    max_angle_deg: f64,
    y_up: bool,
    keep_normals: bool,
    cleanup: bool,
    merged: bool,
) -> Result<String, JsValue> {
    let opts = ConvertOptions {
        deflection_mm,
        max_angle_deg,
        rotate_z_up: y_up,
        drop_normals: !keep_normals,
        cleanup,
        merged,
        ..ConvertOptions::default()
    };
    // three views of the same JS handle object (wasm32 is single-threaded)
    let input: Box<dyn InputHandle> = Box::new(OpfsInput(io.clone().unchecked_into()));
    let mut out = OpfsOutput(io.clone().unchecked_into());
    let mut tmp = OpfsTemp(io.clone().unchecked_into());
    let report = convert_with_progress(input, &mut out, &mut tmp, &opts, &mut |done, total| {
        io.progress(done as f64, total as f64);
    })
    .map_err(|e| JsValue::from_str(&e))?;
    Ok(report.to_json())
}

// ── Direct cook: converter → cooker, no GLB ──────────────────────────────────

/// Bridge the converter's in-memory merged export to the cooker's input, so a
/// model can be cooked to `.tdp` without ever serialising a GLB.
///
/// The only transform is the axis flip: the merged build works in glTF space
/// (Y-up), the cooker wants Z-up, and this applies the same `[x, -z, y]` the
/// cooker applies when reading a GLB — so both paths cook identical bytes.
pub fn to_cooker_model(merged: step_core::glb::MergedData) -> cooker_core::MergedModel {
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
            parent_id: (parent != 0).then_some(parent),
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
