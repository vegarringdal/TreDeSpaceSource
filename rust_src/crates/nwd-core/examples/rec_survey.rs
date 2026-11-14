//! Survey every on-disk geometry record by walking the size-index chunk's exact
//! record sizes: tally (word1, word2, word3, size) header signatures, and check
//! the content walker (`aux_primitives`/`record_index_map`) agrees on the count.
//!
//!     cargo run --release --example rec_survey -- a.nwd [b.nwd ...]
use nwd_core::{geometry, inspect, Container};
use std::collections::BTreeMap;

fn main() {
    let mut tally: BTreeMap<(u32, u32, u32, usize), usize> = BTreeMap::new();
    for path in std::env::args().skip(1) {
        let bytes = std::fs::read(&path).unwrap();
        let c = Container::parse(&bytes).unwrap();
        let Some((idxs, sizes)) = inspect::geometry_chunks_by_index(&c) else {
            println!("{path}: no size index");
            continue;
        };
        let mut buf = Vec::new();
        for &i in &idxs {
            buf.extend_from_slice(&c.data(i));
        }
        let w = |o: usize| u32::from_le_bytes(buf[o..o + 4].try_into().unwrap());
        let mut o = 0usize;
        let mut n = 0usize;
        for &s in &sizes {
            let s = s as usize;
            if o + 16 > buf.len() {
                break;
            }
            let key = (
                w(o + 4),
                w(o + 8),
                w(o + 12),
                if w(o + 12) == 60 { 0 } else { s },
            );
            *tally.entry(key).or_default() += 1;
            o += s;
            n += 1;
        }
        let walker = geometry::aux_primitives(&buf).len();
        let dec = |rs: &[geometry::GeomRecord]| {
            let mesh = rs.iter().filter(|r| r.variant == 94).count();
            let ok = rs
                .iter()
                .filter(|r| {
                    r.variant == 94 && r.decoded_tris.as_ref().is_some_and(|t| !t.is_empty())
                })
                .count();
            (ok, mesh)
        };
        let sized = geometry::parse_sized(&buf, &sizes).unwrap();
        let (lines, lines_ok) = (
            sized.iter().filter(|r| r.variant == 95).count(),
            sized
                .iter()
                .filter(|r| r.variant == 95 && r.line_segments.is_some())
                .count(),
        );
        if lines > 0 {
            println!("  line records decoded {lines_ok}/{lines}");
        }
        let a = dec(&geometry::parse(&buf).unwrap());
        let b = dec(&geometry::parse_sized(&buf, &sizes).unwrap());
        println!(
            "{}: index records {} (bytes {} of {}), content walker {}, decoded magic-bounded {}/{}, size-bounded {}/{}",
            path.rsplit('/').next().unwrap(),
            n,
            o,
            buf.len(),
            walker,
            a.0, a.1, b.0, b.1
        );
    }
    println!("(variant, word2, word3, size[0 = variable mesh]) -> count");
    for (k, v) in tally {
        println!("  {k:?} -> {v}");
    }
}
