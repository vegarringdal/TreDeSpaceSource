//! Ground-truth probe: decode a sample of LGSX octree nodes, stream the E57
//! export of the same project, snap E57 points to the HSPC integer grid and
//! match exactly. Writes one CSV row per decoded LGSX point (storage order)
//! with both position hypotheses and the E57 attributes when matched.
//!
//! usage: lgsx_vs_e57 <file.lgsx> <file.e57> <out.csv> [node_stride]

use std::collections::{HashMap, HashSet};
use std::io::Write;

use scan_core::e57::E57;
use scan_core::lgsx::{apr, hspc::NodeKey, Lgsx};
use scan_core::source::open_file;

fn demorton(c: u128) -> [u32; 3] {
    let mut v = [0u32; 3];
    for i in 0..32 {
        for (k, out) in v.iter_mut().enumerate() {
            *out |= (((c >> (3 * i + k)) & 1) as u32) << i;
        }
    }
    v
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let stride: usize = a.get(4).map(|s| s.parse().unwrap()).unwrap_or(97);
    let lg = Lgsx::open(open_file(&a[1]).unwrap()).unwrap();
    let info = &lg.info;
    println!("nodes {} points {}", lg.nodes.len(), info.point_count);

    // pick a spread of nodes (all levels), skipping huge ones
    struct Dec {
        key: NodeKey,
        n: usize,
        h0: Vec<[u32; 3]>,
        h1: Vec<[u32; 3]>,
        other: Vec<Vec<u8>>, // planes of the non-position groups, flattened
    }
    let mut decs = Vec::new();
    for node in lg.nodes.iter().step_by(stride) {
        let bytes = lg.node_bytes(node).unwrap();
        let (h, groups) = apr::decode_planes(&bytes).unwrap();
        let n = h.point_count as usize;
        if n > 300_000 {
            continue;
        }
        let pos = &groups[0];
        let s: Vec<u128> = (0..n)
            .map(|i| {
                let mut v = 0u128;
                for k in 0..12 {
                    v |= (pos.planes[k][i] as u128) << (8 * k);
                }
                v
            })
            .collect();
        let m96 = (1u128 << 96) - 1;
        let mut h0 = Vec::with_capacity(n);
        let mut acc = 0u128;
        for &v in &s {
            acc = (acc + v) & m96;
            h0.push(demorton(acc));
        }
        // pair-swap hypothesis: storage index i holds point i^1
        let sw = |i: usize| if (i ^ 1) < n { i ^ 1 } else { i };
        let mut h1 = Vec::with_capacity(n);
        let mut acc = 0u128;
        for i in 0..n {
            acc = (acc + s[sw(i)]) & m96;
            h1.push(demorton(acc));
        }
        // attribute planes in point order under the same swap
        let other = groups[1..]
            .iter()
            .flat_map(|g| {
                g.planes
                    .iter()
                    .map(|pl| (0..n).map(|i| pl[sw(i)]).collect::<Vec<u8>>())
                    .collect::<Vec<_>>()
            })
            .collect();
        decs.push(Dec {
            key: node.key,
            n,
            h0,
            h1,
            other,
        });
    }
    println!(
        "decoded {} nodes, {} points",
        decs.len(),
        decs.iter().map(|d| d.n).sum::<usize>()
    );

    // only keep E57 points that land on a decoded cell (either hypothesis)
    let cells: HashSet<[u32; 3]> = decs
        .iter()
        .flat_map(|d| d.h0.iter().chain(d.h1.iter()).copied())
        .collect();
    // E57 pass
    let e = E57::open(open_file(&a[2]).unwrap()).unwrap();
    let mut gt: HashMap<[u32; 3], (f32, [u8; 3])> = HashMap::new();
    let mut dup = 0u64;
    let t = std::time::Instant::now();
    let mut r = e.points(0, false).unwrap();
    let mut total = 0u64;
    while let Some(b) = r.next_batch().unwrap() {
        for i in 0..b.len() {
            let p = b.positions[i];
            let mut g = [0u32; 3];
            for k in 0..3 {
                g[k] = (((p[k] - info.origin[k]) / info.scale[k]).round() as i64
                    + info.root_offset[k] as i64) as u32;
            }
            if cells.contains(&g) {
                let v = (
                    b.intensity.as_ref().unwrap()[i],
                    b.colors.as_ref().unwrap()[i],
                );
                if gt.insert(g, v).is_some() {
                    dup += 1;
                }
            }
        }
        total += b.len() as u64;
    }
    println!(
        "E57: {total} points in {:.1}s, {} in sampled regions, {dup} duplicate grid cells",
        t.elapsed().as_secs_f64(),
        gt.len()
    );

    let mut out = std::io::BufWriter::new(std::fs::File::create(&a[3]).unwrap());
    writeln!(
        out,
        "node,level,i,n,h0,h1,x,y,z,ei,er,eg,eb,{}",
        (0..decs[0].other.len())
            .map(|k| format!("p{k}"))
            .collect::<Vec<_>>()
            .join(",")
    )
    .unwrap();
    let (mut m0, mut m1, mut all) = (0u64, 0u64, 0u64);
    for (ni, d) in decs.iter().enumerate() {
        for i in 0..d.n {
            let g0 = gt.get(&d.h0[i]);
            let g1 = gt.get(&d.h1[i]);
            m0 += g0.is_some() as u64;
            m1 += g1.is_some() as u64;
            all += 1;
            let (p, g) = if g1.is_some() {
                (d.h1[i], g1)
            } else {
                (d.h0[i], g0)
            };
            let (ei, c) = g.map(|&(a, c)| (a, c)).unwrap_or((-1.0, [0, 0, 0]));
            write!(
                out,
                "{ni},{},{i},{},{},{},{},{},{},{ei},{},{},{}",
                d.key.level,
                d.n,
                g0.is_some() as u8,
                g1.is_some() as u8,
                p[0],
                p[1],
                p[2],
                c[0],
                c[1],
                c[2]
            )
            .unwrap();
            for pl in &d.other {
                write!(out, ",{}", pl[i]).unwrap();
            }
            writeln!(out).unwrap();
        }
    }
    println!("match h0 {m0}/{all}  h1 {m1}/{all}");
}
