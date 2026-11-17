//! Dump the non-mesh records (variant 95 lines, 96 points, ...) of a file: header words,
//! vertex count and the tail words after the vertex block.
//!
//!     cargo run --release --example line_probe -- file.nwd [max]
use nwd_core::{inspect, Container};
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let max: usize = a.get(2).and_then(|s| s.parse().ok()).unwrap_or(8);
    let bytes = std::fs::read(&a[1]).unwrap();
    let c = Container::parse(&bytes).unwrap();
    let Some((idx, sizes)) = inspect::geometry_chunks_by_index(&c) else {
        return;
    };
    let mut buf = Vec::new();
    for i in idx {
        buf.extend_from_slice(&c.data(i));
    }
    let w = |o: usize| u32::from_le_bytes(buf[o..o + 4].try_into().unwrap());
    let (mut o, mut shown) = (0usize, 0usize);
    let mut hist = std::collections::BTreeMap::new();
    for &s in &sizes {
        let s = s as usize;
        if o + 24 <= buf.len() && w(o) == 100 && w(o + 12) == 60 && w(o + 4) != 94 {
            let (v, h4, h5) = (w(o + 4), w(o + 16), w(o + 20) as usize);
            let nv = h5 / 3;
            let tail_o = o + 24 + nv * 12;
            let tail: Vec<i32> = (tail_o..(o + s).min(tail_o + 80))
                .step_by(4)
                .map(|p| w(p) as i32)
                .collect();
            *hist
                .entry((v, nv.min(9), (o + s - tail_o).min(999)))
                .or_insert(0usize) += 1;
            if shown < max {
                shown += 1;
                let p: Vec<f32> = (0..(nv * 3).min(12))
                    .map(|k| {
                        f32::from_le_bytes(buf[o + 24 + 4 * k..o + 28 + 4 * k].try_into().unwrap())
                    })
                    .collect();
                println!("v{v} h4={h4} nv={nv} size={s} pos={p:.3?} tail={tail:?}");
            }
        }
        o += s;
    }
    println!("(variant, nv<=9, tail bytes) -> count: {hist:?}");
}
