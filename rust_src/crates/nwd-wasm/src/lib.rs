//! nwd-wasm — browser bindings, modelled on the RVM converter's wasm crate.
//!
//! Contract (the caller is `src/lib/nwd2tdp/nwd2tdpWorker.ts`): the worker
//! passes an `io` object over the picked file and its output folder —
//!
//! ```text
//! io.size(): number                          input length
//! io.read(offset, len): Uint8Array           input bytes, read from the file
//! io.open(name): number                      begin an output file → handle
//! io.write(handle, bytes: Uint8Array)        append (may be called repeatedly)
//! io.close(handle)                           end of that file
//! io.progress(index, name, bytes)            one call per finished output
//! ```
//!
//! The converter ALWAYS runs the split-per-root pipeline (one merged model
//! per root site + `status_file.json`). The app calls
//! [`convert_streaming_tdp`]: each root's merged model is built once, in
//! memory, and handed straight to `cooker-core`, which cooks it into
//! `<root>.tdp` (+ `<root>.coarse.tdp`) — no GLB is built, serialised or
//! parsed — and only the cooked files and the status file go out through
//! `io`. [`convert_streaming`] writes merged GLBs instead. Either way one
//! root is emitted and freed before the next.
//!
//! The input is read by range through `io.read`, straight from the file on
//! disk: a composite model (the per-root direct path — every large
//! RVM-loader export) is converted without the file ever being in wasm memory
//! whole, which is what lets a model of several hundred MB fit. Any other
//! file is pulled through `io.read` in 8 MB slices into ONE wasm-side buffer
//! (the general converter needs random access over it). Outputs go the other
//! way in 8 MB slices as each root is cooked; the worker passes them on to
//! disk and keeps nothing.

use wasm_bindgen::prelude::*;

use nwd_core::convert::{
    convert_stream, convert_stream_cooked, ConvertOptions, OutputMode, UnitScale,
};

/// Conversion options (defaults = `ConvertOptions::default()`, as in the CLI).
#[wasm_bindgen]
pub struct Options {
    /// Per-root GLB structure — rvm2glb numbering: 0 = merged (default),
    /// 2 = standard. (1/3 = instanced modes, not implemented for NWD.)
    pub mode: u8,
    pub include_line: bool,
    /// Width of the line crosses, in output units (metres).
    pub line_width: f32,
    pub include_normals: bool,
    pub cleanup_position: bool,
    /// Decimal places of the weld grid, in output units (2 = 1 cm, 3 = 1 mm).
    pub cleanup_precision: u8,
    pub meshopt_threshold: f32,
    pub meshopt_target_error: f32,
    /// Unit factor, model units → metres. `0.0` (the default) = automatic:
    /// the unit the file's trailers store (metres, centimetres, feet …),
    /// else 0.3048 for a Revit-loader file, otherwise 1. Any
    /// positive value is an explicit factor (`1.0` = as stored). The factor
    /// that was applied comes back as `unitScale` in the report.
    pub unit_scale: f32,
}

#[wasm_bindgen]
impl Options {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Options {
        Options::default()
    }
}

impl Default for Options {
    fn default() -> Self {
        let d = ConvertOptions::default();
        Options {
            mode: 0,
            include_line: d.include_line,
            line_width: d.line_width,
            include_normals: d.include_normals,
            cleanup_position: d.cleanup_position,
            cleanup_precision: d.cleanup_precision,
            meshopt_threshold: d.meshopt_threshold,
            meshopt_target_error: d.meshopt_target_error,
            unit_scale: 0.0,
        }
    }
}

impl Options {
    fn to_convert(&self) -> ConvertOptions {
        ConvertOptions {
            mode: if self.mode == 2 {
                OutputMode::Standard
            } else {
                OutputMode::Merged
            },
            include_line: self.include_line,
            line_width: self.line_width,
            include_normals: self.include_normals,
            cleanup_position: self.cleanup_position,
            cleanup_precision: self.cleanup_precision,
            meshopt_threshold: self.meshopt_threshold,
            meshopt_target_error: self.meshopt_target_error,
            part_colors: false,
            // 0 (and anything that is not a positive number) = automatic
            unit_scale: if self.unit_scale.is_finite() && self.unit_scale > 0.0 {
                UnitScale::Factor(self.unit_scale)
            } else {
                UnitScale::Auto
            },
        }
    }
}

#[wasm_bindgen(start)]
pub fn start() {
    // Readable console messages on wasm aborts (incl. OOM) instead of a bare trap.
    console_error_panic_hook::set_once();
}

// meshoptimizer's C++ `operator new/delete` on wasm32 come from the shared
// meshopt crate's shim (rust_src/crates/meshopt/wasm_shim), like the other
// converters — no local definitions here (they would collide at link time).

#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

fn call1(io: &JsValue, method: &str, a: &JsValue) -> Result<JsValue, JsValue> {
    let f: js_sys::Function = js_sys::Reflect::get(io, &JsValue::from_str(method))?.into();
    f.call1(io, a)
}

fn call2(io: &JsValue, method: &str, a: &JsValue, b: &JsValue) -> Result<JsValue, JsValue> {
    let f: js_sys::Function = js_sys::Reflect::get(io, &JsValue::from_str(method))?.into();
    f.call2(io, a, b)
}

fn call3(
    io: &JsValue,
    method: &str,
    a: &JsValue,
    b: &JsValue,
    c: &JsValue,
) -> Result<JsValue, JsValue> {
    let f: js_sys::Function = js_sys::Reflect::get(io, &JsValue::from_str(method))?.into();
    f.call3(io, a, b, c)
}

const CHUNK: usize = 8 * 1024 * 1024;

/// Pull the whole input through `io.size()` / `io.read(offset, len)` (the
/// NWD parser needs random access over the inflated container).
fn read_input(io: &JsValue) -> Result<Vec<u8>, JsValue> {
    let size_fn: js_sys::Function = js_sys::Reflect::get(io, &JsValue::from_str("size"))?.into();
    let size = size_fn
        .call0(io)?
        .as_f64()
        .ok_or_else(|| JsValue::from_str("io.size() did not return a number"))?
        as usize;
    let mut bytes: Vec<u8> = Vec::with_capacity(size);
    let mut off = 0usize;
    while off < size {
        let len = CHUNK.min(size - off);
        let v = call2(
            io,
            "read",
            &JsValue::from_f64(off as f64),
            &JsValue::from_f64(len as f64),
        )?;
        let arr = js_sys::Uint8Array::new(&v);
        let got = arr.length() as usize;
        if got == 0 {
            return Err(JsValue::from_str("io.read returned 0 bytes"));
        }
        let start = bytes.len();
        bytes.resize(start + got, 0);
        arr.copy_to(&mut bytes[start..]);
        off += got;
    }
    Ok(bytes)
}

/// The input read through `io.read` by range, keeping the last few 1 MB
/// blocks: the converter mostly reads small pieces (a ~20 KB chunk at a
/// time) in order, and every `io.read` is a synchronous read of the file.
#[cfg(target_arch = "wasm32")]
struct IoInput<'a> {
    io: &'a JsValue,
    size: usize,
    /// (block index, bytes), most recently used last.
    blocks: std::cell::RefCell<Vec<(usize, Vec<u8>)>>,
}

// SAFETY: the converter shares its input across threads only in its rayon
// paths, which are compiled for native targets alone; in wasm32 everything
// runs on the worker's one thread.
#[cfg(target_arch = "wasm32")]
unsafe impl Sync for IoInput<'_> {}

#[cfg(target_arch = "wasm32")]
impl<'a> IoInput<'a> {
    const BLOCK: usize = 1 << 20;
    const KEEP: usize = 8;

    fn new(io: &'a JsValue) -> Result<IoInput<'a>, JsValue> {
        let size_fn: js_sys::Function =
            js_sys::Reflect::get(io, &JsValue::from_str("size"))?.into();
        let size = size_fn
            .call0(io)?
            .as_f64()
            .ok_or_else(|| JsValue::from_str("io.size() did not return a number"))?
            as usize;
        Ok(IoInput {
            io,
            size,
            blocks: std::cell::RefCell::new(Vec::new()),
        })
    }

    /// Copies block `bi`'s bytes from `start` into `out`; returns how many.
    fn copy_from_block(&self, bi: usize, start: usize, out: &mut [u8]) -> usize {
        let mut blocks = self.blocks.borrow_mut();
        let k = match blocks.iter().position(|b| b.0 == bi) {
            Some(k) => k,
            None => {
                let at = bi * Self::BLOCK;
                let len = Self::BLOCK.min(self.size - at);
                let v = call2(
                    self.io,
                    "read",
                    &JsValue::from_f64(at as f64),
                    &JsValue::from_f64(len as f64),
                )
                .unwrap_or_else(|e| panic!("reading the input at {at} failed: {e:?}"));
                let arr = js_sys::Uint8Array::new(&v);
                if arr.length() as usize != len {
                    panic!("io.read({at}, {len}) returned {} bytes", arr.length());
                }
                let mut data = vec![0u8; len];
                arr.copy_to(&mut data);
                if blocks.len() >= Self::KEEP {
                    blocks.remove(0);
                }
                blocks.push((bi, data));
                blocks.len() - 1
            }
        };
        let entry = blocks.remove(k);
        let n = (entry.1.len() - start).min(out.len());
        out[..n].copy_from_slice(&entry.1[start..start + n]);
        blocks.push(entry);
        n
    }
}

#[cfg(target_arch = "wasm32")]
impl nwd_core::ReadAt for IoInput<'_> {
    fn len(&self) -> usize {
        self.size
    }

    fn read_at(&self, offset: usize, buf: &mut [u8]) {
        let mut done = 0usize;
        while done < buf.len() {
            let pos = offset + done;
            let bi = pos / Self::BLOCK;
            done += self.copy_from_block(bi, pos - bi * Self::BLOCK, &mut buf[done..]);
        }
    }
}

/// One output file through `io.open` / `io.write` (8 MB slices) / `io.close`,
/// then `io.progress(index, name, bytes)`.
fn write_output(io: &JsValue, index: u32, name: &str, data: &[u8]) -> Result<(), JsValue> {
    let handle = call1(io, "open", &JsValue::from_str(name))?;
    for chunk in data.chunks(CHUNK) {
        let arr = js_sys::Uint8Array::from(chunk);
        call2(io, "write", &handle, &arr.into())?;
    }
    call1(io, "close", &handle)?;
    let _ = call3(
        io,
        "progress",
        &JsValue::from_f64(index as f64),
        &JsValue::from_str(name),
        &JsValue::from_f64(data.len() as f64),
    );
    Ok(())
}

/// The cook options every NWD cook uses — the ones the RVM converter uses.
fn cook_options(compute_normals: bool) -> cooker_core::CookOptions {
    cooker_core::CookOptions {
        compute_normals,
        dense_bounds: true,
        coarsen: None,
        spatial_order: true,
    }
}

/// Bridge the converter's in-memory merged export to the cooker's input, so a
/// root can be cooked to `.tdp` without ever serialising a GLB.
///
/// The only transform is the axis flip: [`nwd_core::glb::MergedData`] carries
/// glTF space (Y-up) because that is what the merged build produces, and the
/// cooker wants Z-up — the same `[x, -z, y]` the cooker applies when it reads a
/// GLB, so both paths land on identical bytes. The flip is done in place: the
/// vertex buffer is moved, not copied.
pub fn to_cooker_model(merged: nwd_core::glb::MergedData) -> cooker_core::MergedModel {
    let nodes = merged
        .nodes
        .into_iter()
        .map(|n| {
            let mut positions = n.positions;
            for p in positions.iter_mut() {
                *p = [p[0], -p[2], p[1]];
            }
            cooker_core::MergedNode {
                base_color: n.base_color,
                positions,
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
            }
        })
        .collect();
    let hierarchy = merged
        .hierarchy
        .into_iter()
        .map(|(id, name, parent_id)| cooker_core::MergedHierarchyEntry {
            id,
            name,
            parent_id,
        })
        .collect();
    cooker_core::MergedModel { nodes, hierarchy }
}

/// A merged model → cooked `.tdp` (and the coarse variant the VRAM budget
/// swaps in). The GLB-free twin of [`cook_glb`]: same cooker, same options,
/// same bytes.
pub fn cook_merged(
    model: cooker_core::MergedModel,
    compute_normals: bool,
    coarsen: bool,
) -> Result<(Vec<u8>, Option<Vec<u8>>), String> {
    let opts = cook_options(compute_normals);
    if !coarsen {
        return cooker_core::cook_model(model, opts)
            .map(|o| (o.bytes, None))
            .map_err(|e| e.to_string());
    }
    let (full, coarse) = cooker_core::cook_model_both(model, opts).map_err(|e| e.to_string())?;
    Ok((full.bytes, Some(coarse.bytes)))
}

/// GLB bytes → cooked `.tdp` (and the coarse variant the VRAM budget swaps
/// in), with the cook options the RVM converter uses (`rvm-wasm::cook_merged`).
/// The reference path: the app cooks through [`cook_merged`], and
/// `tests/direct_cook.rs` holds the two to the same bytes.
pub fn cook_glb(
    glb: &[u8],
    compute_normals: bool,
    coarsen: bool,
) -> Result<(Vec<u8>, Option<Vec<u8>>), String> {
    let opts = cook_options(compute_normals);
    if !coarsen {
        return cooker_core::cook(glb, opts)
            .map(|o| (o.bytes, None))
            .map_err(|e| e.to_string());
    }
    let (full, coarse) = cooker_core::cook_both(glb, opts).map_err(|e| e.to_string())?;
    Ok((full.bytes, Some(coarse.bytes)))
}

fn report_json(report: &nwd_core::convert::ConvertReport, files: u32) -> String {
    // The f32 factor through its shortest decimal form, so JSON says 0.3048
    // rather than the f32's f64 expansion (0.30480000376701355).
    let unit_scale: f64 = report.unit_scale.to_string().parse().unwrap_or(1.0);
    serde_json::json!({
        "geometries": report.geometries,
        "fragments": report.fragments,
        "meshes": report.placed,
        "linked": report.linked,
        "lines": report.lines,
        "triangles": report.triangles,
        "files": files,
        "unitScale": unit_scale,
    })
    .to_string()
}

/// Convert an NWD/NWC through the streaming io object; returns a JSON report
/// string. Always split-per-root (rvm2glb "merged" contract).
#[wasm_bindgen]
pub fn convert_streaming(
    io: JsValue,
    opts: &Options,
    source_name: &str,
) -> Result<String, JsValue> {
    let bytes = read_input(&io)?;
    let mut n_files: u32 = 0;
    let mut io_err: Option<JsValue> = None;
    let mut sink = |name: &str, data: &[u8]| -> nwd_core::Result<()> {
        let res = write_output(&io, n_files, name, data);
        n_files += 1;
        res.map_err(|e| {
            io_err = Some(e);
            nwd_core::Error::Decode("io callback failed".into())
        })
    };
    let report =
        convert_stream(&bytes, &opts.to_convert(), source_name, &mut sink).map_err(|e| {
            io_err
                .take()
                .unwrap_or_else(|| JsValue::from_str(&e.to_string()))
        })?;
    Ok(report_json(&report, n_files))
}

/// NWD/NWC → cooked `.tdp` files through the same io object: every root's
/// merged model is cooked straight from memory (no GLB) into `<root>.tdp`,
/// plus `<root>.coarse.tdp` with `coarsen`; `status_file.json` follows last.
#[wasm_bindgen]
pub fn convert_streaming_tdp(
    io: JsValue,
    opts: &Options,
    source_name: &str,
    compute_normals: bool,
    coarsen: bool,
) -> Result<String, JsValue> {
    let mut n_files: u32 = 0;
    let mut io_err: Option<JsValue> = None;
    // One model = its `.tdp`; the coarse variant, written first, shares the
    // model's index, and the status file takes the next one.
    let mut sink = |name: &str, data: &[u8]| -> nwd_core::Result<()> {
        let res = write_output(&io, n_files, name, data);
        if !name.ends_with(".coarse.tdp") {
            n_files += 1;
        }
        res.map_err(|e| {
            io_err = Some(e);
            nwd_core::Error::Decode("io callback failed".into())
        })
    };
    let mut cook =
        |merged: nwd_core::glb::MergedData, stem: &str| -> Result<Vec<(String, Vec<u8>)>, String> {
            let (full, coarse) = cook_merged(to_cooker_model(merged), compute_normals, coarsen)?;
            let mut files = Vec::with_capacity(2);
            if let Some(c) = coarse {
                files.push((format!("{stem}.coarse.tdp"), c));
            }
            files.push((format!("{stem}.tdp"), full));
            Ok(files)
        };
    let opts = opts.to_convert();
    #[cfg(target_arch = "wasm32")]
    let streamed = {
        let input = IoInput::new(&io)?;
        nwd_core::convert::convert_streamed_cooked(&input, &opts, source_name, &mut cook, &mut sink)
    };
    #[cfg(not(target_arch = "wasm32"))]
    let streamed: nwd_core::Result<Option<nwd_core::convert::ConvertReport>> = Ok(None);
    let report = match streamed {
        Ok(Some(r)) => Ok(r),
        Ok(None) => {
            let bytes = read_input(&io)?;
            convert_stream_cooked(&bytes, &opts, source_name, &mut cook, &mut sink)
        }
        Err(e) => Err(e),
    };
    let report = report.map_err(|e| {
        io_err
            .take()
            .unwrap_or_else(|| JsValue::from_str(&e.to_string()))
    })?;
    Ok(report_json(&report, n_files))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The `unit_scale` contract the worker relies on: 0 (the default) and
    /// anything that is not a positive number mean automatic; a positive
    /// value is an explicit factor; the applied one is reported as
    /// `unitScale`, in its short decimal form.
    #[test]
    fn unit_scale_option_and_report_key() {
        let with = |unit_scale: f32| {
            Options {
                unit_scale,
                ..Options::default()
            }
            .to_convert()
            .unit_scale
        };
        assert_eq!(Options::default().unit_scale, 0.0);
        assert_eq!(with(0.0), UnitScale::Auto);
        assert_eq!(with(-1.0), UnitScale::Auto);
        assert_eq!(with(f32::NAN), UnitScale::Auto);
        assert_eq!(with(1.0), UnitScale::Factor(1.0));
        assert_eq!(with(0.3048), UnitScale::Factor(0.3048));

        let report = nwd_core::convert::ConvertReport {
            geometries: 3,
            fragments: 18,
            placed: 18,
            linked: 18,
            lines: 0,
            triangles: 1968,
            bbox_min: [0.0; 3],
            bbox_max: [1.0; 3],
            unit_scale: nwd_core::convert::FEET_TO_METRES,
        };
        let json = report_json(&report, 2);
        assert!(json.contains("\"unitScale\":0.3048"), "{json}");
        assert!(json.contains("\"files\":2"), "{json}");
    }
}
