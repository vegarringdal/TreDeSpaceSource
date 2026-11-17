//! scan-cook — cook LGSX / E57 scans into `.tdpp`: a single-file,
//! range-addressable point-cloud octree for the TreDeSpace viewer.
//!
//! * additive LOD (each point stored once; a node's points are a subsample
//!   of its region, refined by its children) — the LGSX octree is reused
//!   as-is, E57 gets an out-of-core octree built with
//!   `meshopt_simplifyPoints` choosing each parent's points;
//! * node payloads split into spatially compact clusters
//!   (`meshopt_spatialClusterPoints`), each with its own u16 quantization
//!   box, streams compressed with the meshopt vertex codec;
//! * setups (poses) and cube-map panorama JPEGs travel in the same file.
//!
//! Layout: `docs/TDPP_FORMAT.md`.

mod bytes;
pub mod e57;
pub mod format;
pub mod lgsx;
pub mod lod;
pub(crate) mod mo;
pub mod node;
pub mod reader;
pub mod verify;
pub mod writer;

use std::sync::mpsc;
use std::sync::Mutex;

use node::Encoded;
use writer::Writer;

pub type Error = Box<dyn std::error::Error + Send + Sync>;

/// Seconds since `start` — 0 on wasm32-unknown-unknown, where
/// `std::time::Instant` is unavailable (it traps).
#[derive(Clone, Copy)]
pub struct Clock(#[cfg(not(target_arch = "wasm32"))] std::time::Instant);

impl Clock {
    pub fn start() -> Clock {
        Clock(
            #[cfg(not(target_arch = "wasm32"))]
            std::time::Instant::now(),
        )
    }
    pub fn secs(&self) -> f64 {
        #[cfg(not(target_arch = "wasm32"))]
        return self.0.elapsed().as_secs_f64();
        #[cfg(target_arch = "wasm32")]
        0.0
    }
}
pub type Result<T> = std::result::Result<T, Error>;

#[derive(Clone, Debug)]
pub struct CookOptions {
    /// Points per cluster (`meshopt_spatialClusterPoints`).
    pub cluster_size: usize,
    /// meshopt vertex codec level 0..=3.
    pub codec_level: i32,
    /// E57: max points held by a node (leaf capacity / parent subsample).
    pub node_capacity: usize,
    /// E57: max points of a subtree built in memory at once.
    pub chunk_points: usize,
    /// E57: max points collected per pass over the input.
    pub batch_points: usize,
    /// E57: integer grid resolution in metres.
    pub e57_resolution: f64,
    /// `meshopt_simplifyPoints` colour weight.
    pub color_weight: f32,
    /// Panorama mip levels larger than this (px) are skipped; 0 = no images.
    pub pano_max_size: u32,
    /// Write the optional normal stream (LGSX sources that have normals;
    /// without them there is no stream and no header flag).
    pub normals: bool,
    /// Keep 16-bit intensity (default: 8 bits, about a byte per point less).
    pub intensity16: bool,
    /// LGSX: leave the scan in the project's internal frame instead of its
    /// coordinate system (active, else from survey control).
    pub project_frame: bool,
    pub threads: usize,
}

impl Default for CookOptions {
    fn default() -> Self {
        CookOptions {
            cluster_size: 256,
            codec_level: 2,
            node_capacity: 65_536,
            chunk_points: 8_000_000,
            batch_points: 48_000_000,
            e57_resolution: 0.001,
            color_weight: 1.0,
            pano_max_size: 4096,
            normals: false,
            intensity16: false,
            project_frame: false,
            threads: std::thread::available_parallelism()
                .map(|n| n.get())
                .unwrap_or(4),
        }
    }
}

impl CookOptions {
    pub(crate) fn encode(&self) -> node::EncodeOptions {
        node::EncodeOptions {
            cluster_size: self.cluster_size.max(1),
            codec_level: self.codec_level,
            normals: self.normals,
            intensity16: self.intensity16,
        }
    }
}

/// Run `work` over `items` on `threads` workers and hand every result to
/// `sink` on the calling thread, in no particular order. Sequential on wasm
/// and with one thread.
pub(crate) fn par_each<I, R, F, S>(
    items: Vec<I>,
    threads: usize,
    work: F,
    mut sink: S,
) -> Result<()>
where
    I: Send,
    R: Send,
    F: Fn(I) -> Result<R> + Sync,
    S: FnMut(R) -> Result<()>,
{
    if threads <= 1 || cfg!(target_arch = "wasm32") {
        for item in items {
            sink(work(item)?)?;
        }
        return Ok(());
    }
    let queue = Mutex::new(items.into_iter().collect::<std::collections::VecDeque<_>>());
    let (tx, rx) = mpsc::sync_channel::<Result<R>>(threads * 2);
    std::thread::scope(|s| -> Result<()> {
        for _ in 0..threads {
            let tx = tx.clone();
            let (queue, work) = (&queue, &work);
            s.spawn(move || loop {
                let Some(item) = queue.lock().unwrap().pop_front() else {
                    break;
                };
                let r = work(item);
                let failed = r.is_err();
                if tx.send(r).is_err() || failed {
                    break;
                }
            });
        }
        drop(tx);
        for msg in rx {
            if let Err(e) = msg.and_then(&mut sink) {
                queue.lock().unwrap().clear();
                return Err(e);
            }
        }
        Ok(())
    })
}

/// `work` over `items` on `threads` workers; results in item order.
pub(crate) fn par_map<I, R, F>(items: Vec<I>, threads: usize, work: F) -> Result<Vec<R>>
where
    I: Send,
    R: Send,
    F: Fn(I) -> Result<R> + Sync,
{
    let n = items.len();
    let mut out: Vec<Option<R>> = (0..n).map(|_| None).collect();
    par_each(
        items.into_iter().enumerate().collect(),
        threads,
        |(i, item)| work(item).map(|r| (i, r)),
        |(i, r)| {
            out[i] = Some(r);
            Ok(())
        },
    )?;
    Ok(out.into_iter().flatten().collect())
}

/// Run `work` over `items` on `threads` workers; every encoded node they
/// return is written by the calling thread as it arrives. Items are taken
/// from the front.
pub(crate) fn parallel_write<I, R, F>(
    items: Vec<I>,
    threads: usize,
    w: &mut Writer,
    work: F,
) -> Result<Vec<R>>
where
    I: Send,
    R: Send,
    F: Fn(I) -> Result<(Vec<Encoded>, R)> + Sync,
{
    let n = items.len();
    if threads <= 1 || cfg!(target_arch = "wasm32") {
        let mut out = Vec::with_capacity(n);
        for item in items {
            let (enc, r) = work(item)?;
            for e in enc {
                w.add_node(e)?;
            }
            out.push(r);
        }
        return Ok(out);
    }
    let queue = Mutex::new(
        items
            .into_iter()
            .enumerate()
            .collect::<std::collections::VecDeque<_>>(),
    );
    let (tx, rx) = mpsc::sync_channel::<Result<(usize, Vec<Encoded>, R)>>(threads * 2);
    let mut results: Vec<Option<R>> = (0..n).map(|_| None).collect();
    // results are committed in item order (a small reorder buffer), so the
    // output bytes do not depend on thread timing
    let mut pending: std::collections::BTreeMap<usize, Vec<Encoded>> =
        std::collections::BTreeMap::new();
    let mut next = 0usize;
    std::thread::scope(|s| -> Result<()> {
        for _ in 0..threads.max(1) {
            let tx = tx.clone();
            let (queue, work) = (&queue, &work);
            s.spawn(move || loop {
                let Some((i, item)) = queue.lock().unwrap().pop_front() else {
                    break;
                };
                let r = work(item).map(|(enc, r)| (i, enc, r));
                let failed = r.is_err();
                if tx.send(r).is_err() || failed {
                    break;
                }
            });
        }
        drop(tx);
        for msg in rx {
            let (i, enc, r) = match msg {
                Ok(v) => v,
                Err(e) => {
                    queue.lock().unwrap().clear();
                    return Err(e);
                }
            };
            pending.insert(i, enc);
            results[i] = Some(r);
            while let Some(enc) = pending.remove(&next) {
                for e in enc {
                    w.add_node(e)?;
                }
                next += 1;
            }
        }
        Ok(())
    })?;
    Ok(results
        .into_iter()
        .map(|r| r.expect("worker result"))
        .collect())
}

/// Tail of a cook's last log line when panoramas could not be read (each
/// got its own warning line when it happened).
pub(crate) fn skipped_note(skipped: usize) -> String {
    match skipped {
        0 => String::new(),
        1 => ", 1 panorama left out".into(),
        n => format!(", {n} panoramas left out"),
    }
}

/// Panorama faces → blobs + metadata (`levels` largest first).
pub(crate) fn pano_json(
    faces: Vec<Vec<(u32, u32, &'static str, writer::BlobRef)>>,
) -> serde_json::Value {
    let cf = scan_core::model::CUBE_FACES;
    serde_json::json!({
        "kind": "cube",
        "faces": faces.into_iter().enumerate().map(|(i, levels)| serde_json::json!({
            "face": i,
            "view": cf[i].name,
            "rotation": cf[i].rotation,
            "levels": levels.into_iter().map(|(w, h, f, b)| serde_json::json!({
                "width": w, "height": h, "format": f, "offset": b.offset, "size": b.size
            })).collect::<Vec<_>>()
        })).collect::<Vec<_>>()
    })
}

pub(crate) fn base_meta(
    source: serde_json::Value,
    o: &CookOptions,
) -> serde_json::Map<String, serde_json::Value> {
    let mut m = serde_json::Map::new();
    m.insert("format".into(), "tdpp".into());
    m.insert("version".into(), format::VERSION.into());
    m.insert(
        "generator".into(),
        format!(
            "scan-cook {} (meshoptimizer 1.3)",
            env!("CARGO_PKG_VERSION")
        )
        .into(),
    );
    m.insert("source".into(), source);
    m.insert("lod".into(), "additive".into());
    m.insert("cluster_size".into(), o.cluster_size.into());
    m.insert(
        "streams".into(),
        serde_json::json!({
            "position": "meshopt vertex codec v1, 8 B: u16 x, y, z (cluster-quantized), u16 intensity (low byte 0 under flag 16)",
            "attribute": "meshopt vertex codec v1, 4 B: u8 r - g, g, b - g (wrapping; node flag 1), setup",
            "normal": "optional (flag 8), meshopt vertex codec v1, 4 B: u16 normal ring code (65535 = none), u16 0"
        }),
    );
    m.insert(
        "cube_faces".into(),
        serde_json::to_value(scan_core::model::CUBE_FACES).unwrap(),
    );
    m
}
