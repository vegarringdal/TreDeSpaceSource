//! WebAssembly shell for the STEP converter.
//!
//! Deliberately tiny and **synchronous**: the CPU-bound core never becomes
//! `async`. All file I/O goes through a JS `Io` object the worker provides,
//! backed by OPFS **synchronous** access handles (`createSyncAccessHandle`):
//! the STEP input is read by range (never held in wasm memory), tessellated
//! geometry spills to a temp file, and the cooked `.tdp` is written straight
//! out. See `src/lib/step2glb/` for the workers that drive this.
//!
//! Two APIs:
//! - [`StepSession`] — the streaming, low-memory path the app uses: index →
//!   tessellate (here, or fanned out over sub-workers that each run their own
//!   session and append records to their own cache file) → merge + cook.
//! - [`convert_step_to_tdp`] / [`convert_step_to_glb`] — one-shot, whole-file
//!   in RAM; kept for tests and small inputs.
//!
//! Build (needs the wasm-bindgen CLI / wasm-pack, not required to *compile*):
//!   CC=clang AR=llvm-ar wasm-pack build crates/step-wasm --target web --release

use std::collections::HashMap;

use step_core::convert::{self, ConvertOptions, Jobs, Prepared};
use step_core::io::{
    CachedInput, InputHandle, MemSink, MemTemp, OutputHandle, SlotReader, TempHandle,
};
use step_core::merge::{ExternalMeshes, ExternalRecord};
use step_core::progress::{Phase, ProgressSink};
use step_core::tessellate::TessStats;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;

/// Install the panic hook once, so a wasm abort (a Rust panic, or an
/// out-of-memory when `memory.grow` fails) surfaces as a readable console
/// message rather than a bare `unreachable`.
#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}

fn js_err(e: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&e.to_string())
}

fn copy_in(data: &[u8], buf: &mut [u8]) -> usize {
    let n = data.len().min(buf.len());
    buf[..n].copy_from_slice(&data[..n]);
    n
}

/// Worker-side separator between the stats blobs of several sub-workers.
const STATS_SEPARATOR: char = '\u{1e}';

// ──────────────────────────────────────────────── the JS I/O object

// The object the worker provides. Every call is synchronous (made from inside
// wasm), offsets/lengths travel as f64 (JS numbers). `progress(phase, done,
// total)` mirrors `step_core::progress::Phase` codes.
#[wasm_bindgen]
extern "C" {
    pub type Io;
    #[wasm_bindgen(method)]
    fn size(this: &Io) -> f64;
    #[wasm_bindgen(method)]
    fn read(this: &Io, offset: f64, len: f64) -> Vec<u8>;
    #[wasm_bindgen(method, js_name = writeTemp)]
    fn write_temp(this: &Io, offset: f64, bytes: &[u8]);
    #[wasm_bindgen(method, js_name = readTemp)]
    fn read_temp(this: &Io, offset: f64, len: f64) -> Vec<u8>;
    #[wasm_bindgen(method, js_name = tempLen)]
    fn temp_len(this: &Io) -> f64;
    #[wasm_bindgen(method, js_name = readSlot)]
    fn read_slot(this: &Io, slot: u32, offset: f64, len: f64) -> Vec<u8>;
    #[wasm_bindgen(method, js_name = indexSize)]
    fn index_size(this: &Io) -> f64;
    #[wasm_bindgen(method, js_name = readIndex)]
    fn read_index(this: &Io, offset: f64, len: f64) -> Vec<u8>;
    #[wasm_bindgen(method)]
    fn open(this: &Io, name: &str) -> u32;
    #[wasm_bindgen(method)]
    fn write(this: &Io, handle: u32, bytes: &[u8]);
    #[wasm_bindgen(method)]
    fn close(this: &Io, handle: u32);
    #[wasm_bindgen(method)]
    fn progress(this: &Io, phase: u8, done: f64, total: f64);
}

/// One handle, many roles: the core's input, temp, slot-reader and progress
/// traits all map onto the same JS object.
struct JsIo(Io);
// SAFETY: wasm32 is single-threaded; the handle is never touched concurrently.
unsafe impl Send for JsIo {}
unsafe impl Sync for JsIo {}

impl JsIo {
    fn dup(&self) -> JsIo {
        JsIo(self.0.clone().unchecked_into())
    }
}

impl InputHandle for JsIo {
    fn size(&self) -> u64 {
        self.0.size() as u64
    }
    fn read_at(&self, offset: u64, buf: &mut [u8]) -> std::io::Result<usize> {
        Ok(copy_in(&self.0.read(offset as f64, buf.len() as f64), buf))
    }
}

impl TempHandle for JsIo {
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

impl SlotReader for JsIo {
    fn read_at(&self, slot: u32, offset: u64, buf: &mut [u8]) -> std::io::Result<usize> {
        Ok(copy_in(
            &self.0.read_slot(slot, offset as f64, buf.len() as f64),
            buf,
        ))
    }
}

impl ProgressSink for JsIo {
    fn report(&self, phase: Phase, done: u64, total: u64) {
        self.0.progress(phase.code(), done as f64, total as f64);
    }
}

/// The index file the coordinator wrote, read by range on a sub-worker.
struct JsIndex(Io);
// SAFETY: wasm32 is single-threaded; the handle is never touched concurrently.
unsafe impl Send for JsIndex {}
unsafe impl Sync for JsIndex {}

impl InputHandle for JsIndex {
    fn size(&self) -> u64 {
        self.0.index_size() as u64
    }
    fn read_at(&self, offset: u64, buf: &mut [u8]) -> std::io::Result<usize> {
        Ok(copy_in(
            &self.0.read_index(offset as f64, buf.len() as f64),
            buf,
        ))
    }
}

/// One output file opened through `Io.open`.
struct JsOutput {
    io: Io,
    handle: u32,
}

impl OutputHandle for JsOutput {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<()> {
        self.io.write(self.handle, buf);
        Ok(())
    }
}

// ──────────────────────────────────────────────── the streaming session

fn viewer_options(
    deflection_mm: f64,
    max_angle_deg: f64,
    y_up: bool,
    keep_normals: bool,
    cleanup: bool,
) -> ConvertOptions {
    ConvertOptions {
        deflection_mm,
        max_angle_deg,
        rotate_z_up: y_up,
        drop_normals: !keep_normals,
        cleanup,
        merged: true,
        ..ConvertOptions::default()
    }
}

/// One STEP conversion, held open between calls so the browser can interleave
/// its own async work (spawning sub-workers, handing out batches) between the
/// synchronous stages. Created on the coordinator AND on every tessellation
/// sub-worker (each indexes the same staged file through its own handle).
#[wasm_bindgen]
pub struct StepSession {
    io: JsIo,
    prepared: Option<Prepared>,
    jobs: Jobs,
    stats: TessStats,
}

#[wasm_bindgen]
impl StepSession {
    /// Index the input (`Io.read` by range; `Io.progress` phase 0 = bytes
    /// scanned), resolve units, build the colour map and assembly.
    #[wasm_bindgen(constructor)]
    pub fn new(
        io: Io,
        deflection_mm: f64,
        max_angle_deg: f64,
        y_up: bool,
        keep_normals: bool,
        cleanup: bool,
    ) -> Result<StepSession, JsValue> {
        let opts = viewer_options(deflection_mm, max_angle_deg, y_up, keep_normals, cleanup);
        let io = JsIo(io);
        let input: Box<dyn InputHandle> = Box::new(CachedInput::new(Box::new(io.dup())));
        let prepared = convert::prepare(input, &opts, &io).map_err(js_err)?;
        let jobs = prepared.jobs();
        Ok(StepSession {
            io,
            prepared: Some(prepared),
            jobs,
            stats: TessStats::default(),
        })
    }

    /// A session over the same file built from the index file the coordinator
    /// wrote with `writeIndex` (`Io.indexSize` / `Io.readIndex`): no scan, no
    /// phase-0 progress, and the index is parsed in bounded pieces so this
    /// worker's heap holds the table, never the file. What every tessellation
    /// sub-worker opens.
    #[wasm_bindgen(js_name = fromIndexFile)]
    pub fn from_index_file(
        io: Io,
        deflection_mm: f64,
        max_angle_deg: f64,
        y_up: bool,
        keep_normals: bool,
        cleanup: bool,
    ) -> Result<StepSession, JsValue> {
        let opts = viewer_options(deflection_mm, max_angle_deg, y_up, keep_normals, cleanup);
        let io = JsIo(io);
        let input: Box<dyn InputHandle> = Box::new(CachedInput::new(Box::new(io.dup())));
        let index = JsIndex(io.0.clone().unchecked_into());
        let prepared = convert::prepare_from_index_file(input, &index, &opts).map_err(js_err)?;
        let jobs = prepared.jobs();
        Ok(StepSession {
            io,
            prepared: Some(prepared),
            jobs,
            stats: TessStats::default(),
        })
    }

    /// Stream the file's index to `Io.open(name)` in 1 MB pieces — never held
    /// whole in wasm memory — for the sub-workers' `fromIndexFile`.
    #[wasm_bindgen(js_name = writeIndex)]
    pub fn write_index(&self, name: &str) -> Result<(), JsValue> {
        let p = self
            .prepared
            .as_ref()
            .ok_or_else(|| js_err("session already finished"))?;
        let io: Io = self.io.0.clone().unchecked_into();
        let handle = io.open(name);
        let mut out = JsOutput {
            io: io.clone().unchecked_into(),
            handle,
        };
        p.write_index(&mut out).map_err(js_err)?;
        io.close(handle);
        Ok(())
    }

    /// 0 = keys are product definitions, 1 = standalone solids (no structure).
    #[wasm_bindgen(js_name = jobKind)]
    pub fn job_kind(&self) -> u8 {
        self.jobs.kind.code()
    }

    /// The independent tessellation work units (see `jobKind`).
    pub fn jobs(&self) -> Vec<u32> {
        self.jobs.keys.clone()
    }

    /// Faces in the file — the denominator of the phase-1 progress.
    #[wasm_bindgen(js_name = faceCount)]
    pub fn face_count(&self) -> f64 {
        self.prepared
            .as_ref()
            .map_or(0.0, |p| p.face_count() as f64)
    }

    #[wasm_bindgen(js_name = productCount)]
    pub fn product_count(&self) -> f64 {
        self.prepared
            .as_ref()
            .map_or(0.0, |p| p.product_count() as f64)
    }

    /// Tessellate a batch of jobs, appending each result record to the temp
    /// handle (`Io.writeTemp` at `Io.tempLen`). Returns `[key, offset, len]`
    /// triples — the coordinator collects them from every sub-worker for
    /// [`Self::finish`]. Face ticks go to `Io.progress` phase 1.
    pub fn tessellate(&mut self, keys: &[u32]) -> Result<Vec<f64>, JsValue> {
        let p = self
            .prepared
            .as_mut()
            .ok_or_else(|| js_err("session already finished"))?;
        let mut table = Vec::with_capacity(keys.len() * 3);
        let io = &self.io;
        let mut offset = io.0.temp_len() as u64;
        let mut sink = |key: u32, rec: &[u8]| -> Result<(), String> {
            io.0.write_temp(offset as f64, rec);
            table.extend_from_slice(&[key as f64, offset as f64, rec.len() as f64]);
            offset += rec.len() as u64;
            Ok(())
        };
        p.tessellate_jobs(self.jobs.kind, keys, &mut self.stats, io, &mut sink)
            .map_err(js_err)?;
        Ok(table)
    }

    /// This worker's tessellation tally, for the coordinator's report.
    #[wasm_bindgen(js_name = statsWire)]
    pub fn stats_wire(&self) -> String {
        self.stats.to_wire()
    }

    /// Merge, cook and write. `keys/slots/offsets/lens` are the record table
    /// gathered from the sub-workers (empty ⇒ tessellate here, in-process);
    /// `worker_stats` their `statsWire` blobs joined by U+001E. The full
    /// `.tdp` goes to `Io.open(out_name)`, the coarse variant (when `coarsen`)
    /// to `<stem>.coarse.tdp` — derived from the cooked bytes, so the model is
    /// dropped before the second cook. Returns the JSON report.
    #[wasm_bindgen]
    #[allow(clippy::too_many_arguments)]
    pub fn finish(
        &mut self,
        keys: &[u32],
        slots: &[u32],
        offsets: &[f64],
        lens: &[u32],
        worker_stats: &str,
        out_name: &str,
        coarsen: bool,
        compute_normals: bool,
    ) -> Result<String, JsValue> {
        let p = self
            .prepared
            .take()
            .ok_or_else(|| js_err("session already finished"))?;
        let mut stats = std::mem::take(&mut self.stats);
        for blob in worker_stats.split(STATS_SEPARATOR) {
            if !blob.trim().is_empty() {
                stats.merge(&TessStats::from_wire(blob));
            }
        }
        let mut records: HashMap<u32, ExternalRecord> = HashMap::with_capacity(keys.len());
        for i in 0..keys
            .len()
            .min(slots.len())
            .min(offsets.len())
            .min(lens.len())
        {
            records.insert(
                keys[i],
                ExternalRecord {
                    slot: slots[i],
                    offset: offsets[i] as u64,
                    len: lens[i],
                },
            );
        }
        let external = (!records.is_empty()).then_some(ExternalMeshes {
            records,
            reader: &self.io,
        });

        let io: Io = self.io.0.clone().unchecked_into();
        let handle = io.open(out_name);
        let mut out = JsOutput {
            io: io.clone().unchecked_into(),
            handle,
        };
        let mut tmp = self.io.dup();
        let stem = out_name.strip_suffix(".tdp").unwrap_or(out_name);
        let coarse_name = format!("{stem}.coarse.tdp");
        let coarse_io: Io = io.clone().unchecked_into();
        let progress_io = &self.io;
        let cook = |merged: step_core::glb::MergedData| -> Result<Vec<u8>, String> {
            // cook progress in draw ranges: one pass for the full cook, two
            // more (simplify + meshletize) for the coarse variant
            let ranges: u64 = merged
                .nodes
                .iter()
                .map(|n| n.draw_ranges.len() as u64)
                .sum();
            let total = ranges * if coarsen { 3 } else { 1 };
            let report = |done: u64| progress_io.report(Phase::Cook, done.min(total), total);
            let full = cook_full(to_cooker_model(merged), compute_normals, &mut |d, _| {
                report(d)
            })?;
            if coarsen {
                let coarse = coarsen_full(&full, &mut |d, _| report(ranges + d))?;
                let h = coarse_io.open(&coarse_name);
                coarse_io.write(h, &coarse);
                coarse_io.close(h);
            }
            Ok(full)
        };
        let report = p
            .finish(
                &mut out,
                &mut tmp,
                external.as_ref(),
                stats,
                Some(&cook),
                &self.io,
            )
            .map_err(js_err)?;
        io.close(handle);
        Ok(report.to_json())
    }
}

// ──────────────────────────────────────────────── one-shot in-RAM entries

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

/// Convert a STEP file (raw bytes) to GLB with the default options. Returns a
/// [`ConvertResult`] (GLB bytes + JSON report), or a JS error string.
#[wasm_bindgen]
pub fn convert_step_to_glb(step_bytes: &[u8]) -> Result<ConvertResult, JsValue> {
    let mut out = MemSink::default();
    let mut tmp = MemTemp::default();
    let report = convert::convert(
        Box::new(step_bytes.to_vec()),
        &mut out,
        &mut tmp,
        &ConvertOptions::default(),
    )
    .map_err(js_err)?;
    Ok(ConvertResult {
        glb: out.0,
        info: report.to_json(),
    })
}

// A JS progress sink for the in-RAM path: `report(done, total)` is called as
// product nodes finish (throttled to ~5% by the core).
#[wasm_bindgen]
extern "C" {
    pub type Progress;
    #[wasm_bindgen(method)]
    fn report(this: &Progress, done: f64, total: f64);
}

struct ProductProgress<'a>(&'a Progress);
// SAFETY: wasm32 is single-threaded; never shared across threads.
unsafe impl Sync for ProductProgress<'_> {}

impl ProgressSink for ProductProgress<'_> {
    fn report(&self, phase: Phase, done: u64, total: u64) {
        if phase == Phase::Products {
            self.0.report(done as f64, total as f64);
        }
    }
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

/// STEP → cooked `.tdp` in ONE call, whole file in RAM: the merged model goes
/// straight into the cooker, so no GLB is built, serialised or parsed. Merged
/// mode only — the hierarchical layout carries no draw ranges for the cooker to
/// key items on. Prefer [`StepSession`] for anything large.
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
    let opts = viewer_options(deflection_mm, max_angle_deg, y_up, keep_normals, cleanup);
    let coarse_out: std::cell::RefCell<Option<Vec<u8>>> = std::cell::RefCell::new(None);
    let mut out = MemSink::default();
    let mut tmp = MemTemp::default();
    let sink = ProductProgress(progress);
    let report = convert::convert_cooked_with(
        Box::new(step_bytes.to_vec()),
        &mut out,
        &mut tmp,
        &opts,
        &|merged| {
            let full = cook_full(to_cooker_model(merged), compute_normals, &mut |_, _| {})?;
            if coarsen {
                *coarse_out.borrow_mut() = Some(coarsen_full(&full, &mut |_, _| {})?);
            }
            Ok(full)
        },
        &sink,
    )
    .map_err(js_err)?;
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
            positions: flip_to_z_up(n.positions),
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

/// glTF Y-up `xyz` triples → the cooker's Z-up `[x, -z, y]`, reusing the
/// allocation when its capacity is a whole number of triples (the spill
/// read-back sizes it exactly, so that is the normal case) — this is the one
/// full-size position buffer on the cook path, and copying it would double the
/// peak for a single-colour model. Falls back to a copy otherwise.
fn flip_to_z_up(mut positions: Vec<f32>) -> Vec<[f32; 3]> {
    for p in positions.chunks_exact_mut(3) {
        let (y, z) = (p[1], p[2]);
        p[1] = -z;
        p[2] = y;
    }
    if positions.len() % 3 != 0 || positions.capacity() % 3 != 0 {
        return positions
            .chunks_exact(3)
            .map(|p| [p[0], p[1], p[2]])
            .collect();
    }
    let mut v = std::mem::ManuallyDrop::new(positions);
    let (ptr, len, cap) = (v.as_mut_ptr(), v.len(), v.capacity());
    // SAFETY: `[f32; 3]` has the same alignment as `f32` and exactly three
    // times its size; `len` and `cap` are multiples of three, so the
    // reinterpreted vector covers the same allocation with the same layout
    // (cap * 4 bytes == cap/3 * 12 bytes). The original Vec is not dropped.
    unsafe { Vec::from_raw_parts(ptr as *mut [f32; 3], len / 3, cap / 3) }
}

/// Cook a merged model into the full `.tdp` with the app's settings (dense
/// bounds, spatial order) — what the cooker wasm does for a GLB.
pub fn cook_full(
    model: cooker_core::MergedModel,
    compute_normals: bool,
    progress: cooker_core::CookProgress,
) -> Result<Vec<u8>, String> {
    let opts = cooker_core::CookOptions {
        compute_normals,
        dense_bounds: true,
        coarsen: None,
        spatial_order: true,
    };
    cooker_core::cook_model_with_progress(model, opts, progress)
        .map(|o| o.bytes)
        .map_err(|e| e.to_string())
}

/// The VRAM-budget coarse variant, derived from the cooked bytes (the same
/// derivation the app applies to a plain `.tdp` import) so the merged model
/// need not be kept alive — or cloned — for a second cook.
pub fn coarsen_full(full: &[u8], progress: cooker_core::CookProgress) -> Result<Vec<u8>, String> {
    cooker_core::coarsen_tdp_with_progress(full, cooker_core::CoarsenOptions::default(), progress)
        .map_err(|e| e.to_string())
}
