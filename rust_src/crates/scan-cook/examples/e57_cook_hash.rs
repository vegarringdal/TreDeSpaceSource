//! Cook an E57 into a sink that only hashes what it is given — to compare
//! two builds of the cook, or time one, without the disk space for the
//! output: `e57_cook_hash file.e57 [threads] [batch_points] [chunk_points]`.
//! `STAGED=1` runs the stages the way the browser's sub-workers do — every
//! result through its byte form, a second `Blocks` from the shared tables.
use scan_cook::writer::Sink;
use scan_cook::CookOptions;
use scan_core::e57::E57;
use std::sync::{Arc, Mutex};

struct HashSink(Arc<Mutex<(md5::Context, u64)>>);

impl Sink for HashSink {
    fn write_all(&mut self, bytes: &[u8]) -> std::io::Result<()> {
        let mut g = self.0.lock().unwrap();
        g.0.consume(bytes);
        g.1 += bytes.len() as u64;
        Ok(())
    }
    fn write_at(&mut self, offset: u64, bytes: &[u8]) -> std::io::Result<()> {
        // the header rewrite — reported apart from the stream
        eprintln!("header {offset}:{:x}", md5::compute(bytes));
        Ok(())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let args: Vec<String> = std::env::args().collect();
    let num = |i: usize| args.get(i).and_then(|s| s.parse::<usize>().ok());
    let mut o = CookOptions::default();
    if let Some(t) = num(2) {
        o.threads = t;
    }
    if let Some(b) = num(3) {
        o.batch_points = b;
    }
    if let Some(c) = num(4) {
        o.chunk_points = c;
    }
    let e = E57::open(scan_core::source::open_file(&args[1])?)?;
    let state = Arc::new(Mutex::new((md5::Context::new(), 0u64)));
    let t = std::time::Instant::now();
    let sink = Box::new(HashSink(state.clone()));
    let log = |m: &str| eprintln!("{m}");
    let h = if std::env::var("STAGED").is_ok() {
        staged(&e, sink, &o, &log)?
    } else {
        scan_cook::e57::cook(&e, sink, &o, &log)?
    };
    let g = state.lock().unwrap();
    println!(
        "{} points, {} nodes, stream {} bytes md5 {:x}, {:.0}s",
        h.point_count,
        h.node_count,
        g.1,
        g.0.clone().compute(),
        t.elapsed().as_secs_f64()
    );
    Ok(())
}

/// The sub-worker protocol, in one process: a "part" built from the shared
/// packet tables does the block and batch work, everything crosses as bytes.
fn staged(
    e: &E57,
    sink: Box<dyn Sink>,
    o: &CookOptions,
    log: &(dyn Fn(&str) + Sync),
) -> Result<scan_cook::format::Header, Box<dyn std::error::Error + Send + Sync>> {
    use scan_cook::e57::*;
    let t0 = scan_cook::Clock::start();
    let main = Blocks::new(e, &mut |_| {})?;
    let part = Blocks::from_tables(e, &main.tables())?;
    let n = part.len() as u32;
    let step = 8;
    let mut stats = Stats::EMPTY;
    for i in (0..n).step_by(step) {
        let bytes = stats_blocks(&part, i..(i + step as u32).min(n), o.threads)?.to_bytes();
        stats.merge(&Stats::from_bytes(&bytes)?);
    }
    let fr = E57Frame::new(
        &Stats::from_bytes(&stats.to_bytes())?.bounds,
        o.e57_resolution,
    )?;
    let mut counts = Counts::new(&fr);
    for i in (0..n).step_by(step) {
        let bytes = count_blocks(&part, &fr, i..(i + step as u32).min(n), o.threads)?.to_bytes();
        counts.merge(Counts::from_bytes(&bytes)?)?;
    }
    let (plan, pyr) = Plan::new(stats, counts, e.scans.len() > 1, n as usize, o)?;
    let part_plan = Plan::from_bytes(&plan.to_bytes())?;
    let mut asm = Assembly::new(sink)?;
    for b in 0..plan.batches() {
        let bytes = batch_to_bytes(&build_batch(&part, &part_plan, b, o.threads)?);
        asm.add_batch(batch_from_bytes(&bytes)?)?;
    }
    finish(e, &plan, &pyr, asm, o, log, t0)
}
