//! scan-wasm — LGSX / E57 inspection and the `.tdpp` cook in the
//! browser (a Web Worker; wasm is single-threaded here).
//!
//! IO contract (all synchronous, called from inside wasm):
//!
//! ```text
//! io.size(): number                         input length
//! io.read(offset, len): Uint8Array          input bytes (e.g. OPFS sync handle `read(buf, {at})`)
//! io.write(offset, bytes: Uint8Array)       output bytes at an absolute offset (`write(buf, {at})`)
//! io.progress(message: string)              human-readable progress
//! ```
//!
//! The input is pulled in ranges as needed (multi-GB files never sit in
//! wasm memory); the output is streamed in 8 MB blocks, and the 128-byte
//! header at offset 0 is rewritten last.

use std::sync::Arc;

use serde::Deserialize;
use wasm_bindgen::prelude::*;

use scan_cook::e57;
use scan_cook::lgsx;
use scan_cook::writer::Sink;
use scan_cook::CookOptions;
use scan_core::e57::E57;
use scan_core::lgsx::Lgsx;
use scan_core::source::{ReadAt, Source};

#[wasm_bindgen]
extern "C" {
    /// The JS IO object (see the module docs).
    pub type Io;
    #[wasm_bindgen(method)]
    fn size(this: &Io) -> f64;
    #[wasm_bindgen(method)]
    fn read(this: &Io, offset: f64, len: u32) -> Vec<u8>;
    #[wasm_bindgen(method)]
    fn write(this: &Io, offset: f64, bytes: &[u8]);
    #[wasm_bindgen(method)]
    fn progress(this: &Io, message: &str);
}

#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
pub fn version() -> String {
    format!(
        "scan-wasm {} (meshoptimizer 1.3)",
        env!("CARGO_PKG_VERSION")
    )
}

/// Shares the JS object with the readers. wasm here is single-threaded, so
/// the Send/Sync promises cannot be violated.
struct JsIo(Io);
unsafe impl Send for JsIo {}
unsafe impl Sync for JsIo {}

struct JsSource {
    io: Arc<JsIo>,
    len: u64,
}

impl ReadAt for JsSource {
    fn len(&self) -> u64 {
        self.len
    }
    fn read_at(&self, offset: u64, buf: &mut [u8]) -> scan_core::Result<()> {
        if offset + buf.len() as u64 > self.len {
            return Err(scan_core::Error::Eof {
                offset,
                len: buf.len() as u64,
            });
        }
        let v = self.io.0.read(offset as f64, buf.len() as u32);
        if v.len() != buf.len() {
            return Err(scan_core::Error::Eof {
                offset,
                len: buf.len() as u64,
            });
        }
        buf.copy_from_slice(&v);
        Ok(())
    }
}

/// Appends are staged and written in large blocks.
struct JsSink {
    io: Arc<JsIo>,
    buf: Vec<u8>,
    flushed: u64,
}

const BLOCK: usize = 8 << 20;

impl Sink for JsSink {
    fn write_all(&mut self, bytes: &[u8]) -> std::io::Result<()> {
        self.buf.extend_from_slice(bytes);
        if self.buf.len() >= BLOCK {
            self.flush()?;
        }
        Ok(())
    }
    fn write_at(&mut self, offset: u64, bytes: &[u8]) -> std::io::Result<()> {
        self.flush()?;
        self.io.0.write(offset as f64, bytes);
        Ok(())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        if !self.buf.is_empty() {
            self.io.0.write(self.flushed as f64, &self.buf);
            self.flushed += self.buf.len() as u64;
            self.buf.clear();
        }
        Ok(())
    }
}

enum Input {
    E57(Box<E57>),
    Lgsx(Box<Lgsx>),
}

fn open(io: &Arc<JsIo>) -> Result<Input, JsError> {
    let src: Source = Arc::new(JsSource {
        io: io.clone(),
        len: io.0.size() as u64,
    });
    let mut head = [0u8; 16];
    src.read_at(0, &mut head).map_err(err)?;
    if &head[..8] == b"ASTM-E57" {
        Ok(Input::E57(Box::new(E57::open(src).map_err(err)?)))
    } else if &head == b"wild::geosystems" {
        Ok(Input::Lgsx(Box::new(Lgsx::open(src).map_err(err)?)))
    } else {
        Err(JsError::new("neither an E57 nor an LGSX file"))
    }
}

fn err(e: impl std::fmt::Display) -> JsError {
    JsError::new(&e.to_string())
}

/// JSON summary of an LGSX / E57 input: format, point count, setups with
/// poses, panorama availability. Cheap — reads only metadata.
#[wasm_bindgen]
pub fn info(io: Io) -> Result<String, JsError> {
    let io = Arc::new(JsIo(io));
    let v = match open(&io)? {
        Input::Lgsx(l) => serde_json::json!({
            "format": "lgsx",
            "writer": l.container.writer_version,
            "points": l.info.point_count,
            "bounds": l.info.bounds,
            "nodes": l.nodes.len(),
            "setups": l.setups,
        }),
        Input::E57(e) => serde_json::json!({
            "format": "e57",
            "points": e.total_points(),
            "scans": e.scans,
            "stations": e.stations(),
            "images": e.images.len(),
        }),
    };
    Ok(v.to_string())
}

/// Options for [`cook`], as JSON; every field is optional (CLI defaults,
/// with a smaller E57 batch so the cook fits in wasm32 memory).
#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct Opts {
    cluster_size: Option<usize>,
    codec_level: Option<i32>,
    node_capacity: Option<usize>,
    chunk_points: Option<usize>,
    batch_points: Option<usize>,
    e57_resolution: Option<f64>,
    pano_max_size: Option<u32>,
    normals: Option<bool>,
    intensity16: Option<bool>,
    project_frame: Option<bool>,
}

fn cook_options(options_json: &str) -> Result<CookOptions, JsError> {
    let o: Opts = if options_json.trim().is_empty() {
        Opts::default()
    } else {
        serde_json::from_str(options_json).map_err(err)?
    };
    let d = CookOptions::default();
    Ok(CookOptions {
        cluster_size: o.cluster_size.unwrap_or(d.cluster_size),
        codec_level: o.codec_level.unwrap_or(d.codec_level),
        node_capacity: o.node_capacity.unwrap_or(d.node_capacity),
        chunk_points: o.chunk_points.unwrap_or(4_000_000),
        batch_points: o.batch_points.unwrap_or(16_000_000),
        e57_resolution: o.e57_resolution.unwrap_or(d.e57_resolution),
        color_weight: d.color_weight,
        pano_max_size: o.pano_max_size.unwrap_or(d.pano_max_size),
        normals: o.normals.unwrap_or(false),
        intensity16: o.intensity16.unwrap_or(false),
        project_frame: o.project_frame.unwrap_or(false),
        threads: 1,
    })
}

fn js_sink(io: &Arc<JsIo>) -> Box<JsSink> {
    Box::new(JsSink {
        io: io.clone(),
        buf: Vec::with_capacity(BLOCK),
        flushed: 0,
    })
}

fn open_e57(io: &Arc<JsIo>) -> Result<E57, JsError> {
    match open(io)? {
        Input::E57(e) => Ok(*e),
        Input::Lgsx(_) => Err(JsError::new("not an E57 file")),
    }
}

fn report(h: &scan_cook::format::Header) -> String {
    serde_json::json!({
        "points": h.point_count,
        "nodes": h.node_count,
        "fileSize": h.file_size,
        "flags": h.flags,
        "setups": h.setup_count,
    })
    .to_string()
}

/// An E57 cook spread over sub-workers — this is the coordinator's side: it
/// owns the output, merges what the workers ([`E57Part`]) return, plans, and
/// writes. The caller drives the stages in order:
///
/// ```text
/// new → tables() to every worker
/// add_stats(part.stats(i0, i1)) over all blocks
/// stats() → add_counts(part.counts(stats, i0, i1)) over all blocks
/// plan() to every worker → add_batch(part.batch(b)) for b in 0..batches(), IN ORDER
/// finish()
/// ```
#[wasm_bindgen]
pub struct E57Cook {
    io: Arc<JsIo>,
    e: E57,
    opts: CookOptions,
    blocks: e57::Blocks,
    stats: e57::Stats,
    counts: Option<e57::Counts>,
    plan: Option<(e57::Plan, e57::Pyramid)>,
    asm: Option<e57::Assembly>,
    next_batch: u32,
}

#[wasm_bindgen]
impl E57Cook {
    /// Opens the E57 and walks its packet headers (the slow part of opening).
    #[wasm_bindgen(constructor)]
    pub fn new(io: Io, options_json: &str) -> Result<E57Cook, JsError> {
        let opts = cook_options(options_json)?;
        let io = Arc::new(JsIo(io));
        let e = open_e57(&io)?;
        let mut last = -1i32;
        let blocks = e57::Blocks::new(&e, &mut |f| {
            let pct = (f * 100.0) as i32;
            if pct != last {
                last = pct;
                io.0.progress(&format!("Indexing the file {pct}%"));
            }
        })
        .map_err(err)?;
        Ok(E57Cook {
            io,
            e,
            opts,
            blocks,
            stats: e57::Stats::EMPTY,
            counts: None,
            plan: None,
            asm: None,
            next_batch: 0,
        })
    }

    /// The packet tables, for [`E57Part::new`].
    pub fn tables(&self) -> Vec<u8> {
        self.blocks.tables()
    }

    /// Record blocks to run the stats and the counts stages over.
    pub fn blocks(&self) -> u32 {
        self.blocks.len() as u32
    }

    pub fn add_stats(&mut self, part: &[u8]) -> Result<(), JsError> {
        self.stats
            .merge(&e57::Stats::from_bytes(part).map_err(err)?);
        Ok(())
    }

    /// The merged stats, for [`E57Part::counts`].
    pub fn stats(&self) -> Vec<u8> {
        self.stats.to_bytes()
    }

    pub fn add_counts(&mut self, part: &[u8]) -> Result<(), JsError> {
        let part = e57::Counts::from_bytes(part).map_err(err)?;
        match self.counts.as_mut() {
            Some(c) => c.merge(part).map_err(err)?,
            None => self.counts = Some(part),
        }
        Ok(())
    }

    /// Plan the batches (every block must have been counted) and open the
    /// output. Returns the plan for [`E57Part::set_plan`].
    pub fn plan(&mut self) -> Result<Vec<u8>, JsError> {
        let counts = self.counts.take().ok_or_else(|| err("no counts yet"))?;
        let planned = e57::Plan::new(
            self.stats,
            counts,
            self.e.scans.len() > 1,
            self.blocks.len(),
            &self.opts,
        )
        .map_err(err)?;
        let bytes = planned.0.to_bytes();
        self.io.0.progress(&format!(
            "{} points in {} chunks, {} batches, {:.1} passes of the file to read",
            self.stats.total,
            planned.0.chunks(),
            planned.0.batches(),
            planned.0.batch_block_total() as f64 / self.blocks.len().max(1) as f64
        ));
        self.plan = Some(planned);
        self.asm = Some(e57::Assembly::new(js_sink(&self.io)).map_err(err)?);
        Ok(bytes)
    }

    pub fn batches(&self) -> u32 {
        self.plan.as_ref().map_or(0, |p| p.0.batches() as u32)
    }

    /// Write batch `index` — batches must be added in order.
    pub fn add_batch(&mut self, index: u32, part: &[u8]) -> Result<(), JsError> {
        if index != self.next_batch {
            return Err(err(format!(
                "batch {index} added out of order (expected {})",
                self.next_batch
            )));
        }
        let asm = self.asm.as_mut().ok_or_else(|| err("no plan yet"))?;
        asm.add_batch(e57::batch_from_bytes(part).map_err(err)?)
            .map_err(err)?;
        self.next_batch += 1;
        Ok(())
    }

    /// The tree above the chunks, the panoramas and the header. Returns the
    /// same JSON report as [`cook`].
    pub fn finish(&mut self) -> Result<String, JsError> {
        let (plan, pyr) = self.plan.take().ok_or_else(|| err("no plan yet"))?;
        let asm = self.asm.take().ok_or_else(|| err("no plan yet"))?;
        if self.next_batch as usize != plan.batches() {
            return Err(err("not every batch was added"));
        }
        let log_io = self.io.clone();
        let log = move |m: &str| log_io.0.progress(m);
        let h = e57::finish(
            &self.e,
            &plan,
            &pyr,
            asm,
            &self.opts,
            &log,
            scan_cook::Clock::start(),
        )
        .map_err(err)?;
        Ok(report(&h))
    }
}

/// A sub-worker's side of an E57 cook: decodes record blocks and builds whole
/// batches, each call independent of the other workers. Reads the input
/// through its own `io` (only `size` and `read` are used).
#[wasm_bindgen]
pub struct E57Part {
    opts: CookOptions,
    blocks: e57::Blocks,
    plan: Option<e57::Plan>,
}

#[wasm_bindgen]
impl E57Part {
    /// `tables` = [`E57Cook::tables`] (so the packet headers are walked once).
    #[wasm_bindgen(constructor)]
    pub fn new(io: Io, tables: &[u8], options_json: &str) -> Result<E57Part, JsError> {
        let opts = cook_options(options_json)?;
        let e = open_e57(&Arc::new(JsIo(io)))?;
        Ok(E57Part {
            opts,
            blocks: e57::Blocks::from_tables(&e, tables).map_err(err)?,
            plan: None,
        })
    }

    /// Stage 1 over blocks `[i0, i1)`.
    pub fn stats(&self, i0: u32, i1: u32) -> Result<Vec<u8>, JsError> {
        Ok(e57::stats_blocks(&self.blocks, i0..i1, 1)
            .map_err(err)?
            .to_bytes())
    }

    /// Stage 2 over blocks `[i0, i1)`; `stats` = [`E57Cook::stats`].
    pub fn counts(&self, stats: &[u8], i0: u32, i1: u32) -> Result<Vec<u8>, JsError> {
        let stats = e57::Stats::from_bytes(stats).map_err(err)?;
        let fr = e57::E57Frame::new(&stats.bounds, self.opts.e57_resolution).map_err(err)?;
        Ok(e57::count_blocks(&self.blocks, &fr, i0..i1, 1)
            .map_err(err)?
            .to_bytes())
    }

    pub fn set_plan(&mut self, plan: &[u8]) -> Result<(), JsError> {
        self.plan = Some(e57::Plan::from_bytes(plan).map_err(err)?);
        Ok(())
    }

    /// Build batch `index`: its encoded nodes and chunk roots, for
    /// [`E57Cook::add_batch`].
    pub fn batch(&self, index: u32) -> Result<Vec<u8>, JsError> {
        let plan = self.plan.as_ref().ok_or_else(|| err("no plan yet"))?;
        let chunks = e57::build_batch(&self.blocks, plan, index as usize, 1).map_err(err)?;
        Ok(e57::batch_to_bytes(&chunks))
    }
}

fn open_lgsx(io: &Arc<JsIo>) -> Result<Lgsx, JsError> {
    match open(io)? {
        Input::Lgsx(l) => Ok(*l),
        Input::E57(_) => Err(JsError::new("not an LGSX file")),
    }
}

/// An LGSX cook spread over sub-workers — the coordinator's side: it owns
/// the output and writes the node runs the workers ([`LgsxPart`]) encode,
/// in node order, then the photos and the header.
#[wasm_bindgen]
pub struct LgsxCook {
    io: Arc<JsIo>,
    l: Lgsx,
    opts: CookOptions,
    frame: lgsx::LgsxFrame,
    asm: Option<lgsx::Assembly>,
    next: u32,
}

#[wasm_bindgen]
impl LgsxCook {
    #[wasm_bindgen(constructor)]
    pub fn new(io: Io, options_json: &str) -> Result<LgsxCook, JsError> {
        let opts = cook_options(options_json)?;
        let io = Arc::new(JsIo(io));
        let l = open_lgsx(&io)?;
        let frame = lgsx::LgsxFrame::new(&l).map_err(err)?;
        let asm = lgsx::Assembly::new(js_sink(&io)).map_err(err)?;
        Ok(LgsxCook {
            io,
            l,
            opts,
            frame,
            asm: Some(asm),
            next: 0,
        })
    }

    /// Octree nodes to encode ([`LgsxPart::nodes`] over all of them).
    pub fn nodes(&self) -> u32 {
        self.l.nodes.len() as u32
    }

    /// Write the run starting at node `first` — runs must be added in order.
    pub fn add_nodes(&mut self, first: u32, part: &[u8]) -> Result<(), JsError> {
        if first != self.next {
            return Err(err(format!(
                "nodes from {first} added out of order (expected {})",
                self.next
            )));
        }
        let run = lgsx::NodesOut::from_bytes(part).map_err(err)?;
        self.next += run.nodes.len() as u32;
        self.asm
            .as_mut()
            .ok_or_else(|| err("already finished"))?
            .add_nodes(run)
            .map_err(err)
    }

    /// The setups, their photos and the header. Returns the same JSON report
    /// as [`cook`].
    pub fn finish(&mut self) -> Result<String, JsError> {
        let asm = self.asm.take().ok_or_else(|| err("already finished"))?;
        if self.next as usize != self.l.nodes.len() {
            return Err(err("not every node was added"));
        }
        let log_io = self.io.clone();
        let log = move |m: &str| log_io.0.progress(m);
        let h = lgsx::finish(
            &self.l,
            &self.frame,
            asm,
            &self.opts,
            &log,
            scan_cook::Clock::start(),
        )
        .map_err(err)?;
        Ok(report(&h))
    }
}

/// A sub-worker's side of an LGSX cook: decodes and re-encodes runs of
/// octree nodes through its own `io` (only `size` and `read` are used).
#[wasm_bindgen]
pub struct LgsxPart {
    l: Lgsx,
    opts: CookOptions,
    frame: lgsx::LgsxFrame,
}

#[wasm_bindgen]
impl LgsxPart {
    #[wasm_bindgen(constructor)]
    pub fn new(io: Io, options_json: &str) -> Result<LgsxPart, JsError> {
        let opts = cook_options(options_json)?;
        let l = open_lgsx(&Arc::new(JsIo(io)))?;
        let frame = lgsx::LgsxFrame::new(&l).map_err(err)?;
        Ok(LgsxPart { l, opts, frame })
    }

    /// Encode nodes `[i0, i1)`, for [`LgsxCook::add_nodes`].
    pub fn nodes(&self, i0: u32, i1: u32) -> Result<Vec<u8>, JsError> {
        Ok(lgsx::encode_nodes(
            &self.l,
            &self.frame,
            &self.opts,
            i0 as usize..i1 as usize,
            1,
        )
        .map_err(err)?
        .to_bytes())
    }
}

/// Cook the input into `.tdpp` through `io.write`. Returns a JSON report
/// (point count, node count, file size).
#[wasm_bindgen]
pub fn cook(io: Io, options_json: &str) -> Result<String, JsError> {
    let opts = cook_options(options_json)?;
    let io = Arc::new(JsIo(io));
    let sink = js_sink(&io);
    let log_io = io.clone();
    let log = move |m: &str| log_io.0.progress(m);
    let h = match open(&io)? {
        Input::Lgsx(l) => scan_cook::lgsx::cook(&l, sink, &opts, &log),
        Input::E57(e) => scan_cook::e57::cook(&e, sink, &opts, &log),
    }
    .map_err(err)?;
    Ok(report(&h))
}
