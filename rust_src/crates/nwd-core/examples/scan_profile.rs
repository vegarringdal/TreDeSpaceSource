//! Profile: per-chunk cost of the placement probes on non-geometry chunks.
use nwd_core::{fragments, inspect, Container};

fn main() {
    let path = std::env::args().nth(1).unwrap();
    let bytes = std::fs::read(&path).unwrap();
    let c = Container::parse(&bytes).unwrap();
    let geom: std::collections::HashSet<usize> = inspect::geometry_chunks_by_index(&c)
        .map(|(v, _)| v.into_iter().collect())
        .unwrap_or_default();
    let mut rows: Vec<(f64, f64, f64, usize, usize)> = Vec::new();
    for ci in 0..c.chunks.len() {
        if geom.contains(&ci) {
            continue;
        }
        let t0 = std::time::Instant::now();
        let data = c.data(ci);
        let t_inf = t0.elapsed().as_secs_f64();
        let t1 = std::time::Instant::now();
        let _ = fragments::interned_placements(&data);
        let t_int = t1.elapsed().as_secs_f64();
        let t2 = std::time::Instant::now();
        let _ = fragments::placements(&data);
        let _ = fragments::parse(&data);
        let t_frag = t2.elapsed().as_secs_f64();
        rows.push((t_inf, t_int, t_frag, ci, data.len()));
    }
    rows.sort_by(|a, b| (b.0 + b.1 + b.2).partial_cmp(&(a.0 + a.1 + a.2)).unwrap());
    println!("inflate  interned  frag      chunk  bytes");
    for (i, n, f, ci, len) in rows.iter().take(12) {
        println!("{i:7.2}s {n:8.2}s {f:8.2}s  {ci:5}  {len}");
    }
    let (si, sn, sf): (f64, f64, f64) = rows
        .iter()
        .fold((0.0, 0.0, 0.0), |a, r| (a.0 + r.0, a.1 + r.1, a.2 + r.2));
    println!("TOTAL inflate {si:.1}s interned {sn:.1}s frag {sf:.1}s");
}
