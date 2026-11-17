//! Decode every octree node of an LGSX file and check invariants:
//! points inside their node cube, Σ counts == hspc point-count, setup index
//! within the LUT. Multi-threaded (std only).
use scan_core::lgsx::Lgsx;
use scan_core::source::open_file;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};

fn main() {
    let path = std::env::args().nth(1).expect("lgsx path");
    let lg = Lgsx::open(open_file(&path).unwrap()).unwrap();
    let nsetups = lg.info.setup_lut.len() as u8;
    let next = AtomicUsize::new(0);
    let total = AtomicU64::new(0);
    let outside = AtomicU64::new(0);
    let bad_setup = AtomicU64::new(0);
    let t = std::time::Instant::now();
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);
    std::thread::scope(|s| {
        for _ in 0..threads {
            s.spawn(|| loop {
                let i = next.fetch_add(1, Ordering::Relaxed);
                let Some(node) = lg.nodes.get(i) else { break };
                let p = lg
                    .read_node(node)
                    .unwrap_or_else(|e| panic!("node {:?}: {e}", node.key));
                let k = node.key;
                let sz = k.size();
                let o = p
                    .grid
                    .iter()
                    .filter(|g| {
                        !((g[0] as u64) >= k.x as u64
                            && (g[0] as u64) < k.x as u64 + sz
                            && (g[1] as u64) >= k.y as u64
                            && (g[1] as u64) < k.y as u64 + sz
                            && (g[2] as u64) >= k.z as u64
                            && (g[2] as u64) < k.z as u64 + sz)
                    })
                    .count();
                outside.fetch_add(o as u64, Ordering::Relaxed);
                if let Some(su) = &p.setup {
                    bad_setup.fetch_add(
                        su.iter().filter(|&&v| v >= nsetups).count() as u64,
                        Ordering::Relaxed,
                    );
                }
                total.fetch_add(p.len() as u64, Ordering::Relaxed);
            });
        }
    });
    let dt = t.elapsed().as_secs_f64();
    let n = total.load(Ordering::Relaxed);
    println!("{} nodes, {n} points (expected {}), outside-cube {}, bad setup {}, {:.1}s on {threads} threads = {:.1} Mpts/s",
        lg.nodes.len(), lg.info.point_count, outside.load(Ordering::Relaxed), bad_setup.load(Ordering::Relaxed), dt, n as f64 / dt / 1e6);
}
