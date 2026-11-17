//! Self-check of the interned placement stream (DWG/3DS/Revit loaders): every
//! fragment record stores its own world extent (`anchor + local_bbox`). Place
//! each geometry record with its transform and compare the resulting AABB.
//!
//!     cargo run --release --example place_check -- file.nwc [tolerance]
use glam::{DQuat, DVec3};
use nwd_core::{fragments, geometry, inspect, Container};
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let tol: f64 = a.get(2).and_then(|s| s.parse().ok()).unwrap_or(0.01);
    let bytes = std::fs::read(&a[1]).unwrap();
    let c = Container::parse(&bytes).unwrap();
    let (idx, sizes) = inspect::geometry_chunks_by_index(&c).expect("size index");
    let mut buf = Vec::new();
    for &i in &idx {
        buf.extend_from_slice(&c.data(i));
    }
    let recs = geometry::parse_sized(&buf, &sizes).unwrap();
    let map = geometry::record_index_map(&buf);
    let gset: std::collections::HashSet<usize> = idx.into_iter().collect();
    let mut best: Vec<fragments::InternedFrag> = Vec::new();
    for i in 0..c.chunks.len() {
        if gset.contains(&i) {
            continue;
        }
        if let Some(v) = fragments::interned_placements(&c.data(i)) {
            if v.len() > best.len() {
                best = v;
            }
        }
    }
    let (mut ok, mut bad, mut norec, mut worst) = (0usize, 0usize, 0usize, 0.0f64);
    let mut ok_a = 0usize;
    let mut tb = (DVec3::splat(f64::MAX), DVec3::splat(f64::MIN));
    let mut ab = tb;
    let mut errs = Vec::new();
    for f in &best {
        let Some(r) = map
            .get(f.record_idx as usize - 1)
            .copied()
            .flatten()
            .map(|i| &recs[i])
        else {
            norec += 1;
            continue;
        };
        let q = DQuat::from_xyzw(f.quat[0], f.quat[1], f.quat[2], f.quat[3]);
        let t = DVec3::from_array(f.translation);
        let (mut mn, mut mx) = (DVec3::splat(f64::MAX), DVec3::splat(f64::MIN));
        for p in &r.positions {
            let w = q * (DVec3::new(p[0] as f64, p[1] as f64, p[2] as f64) * f.scale) + t;
            mn = mn.min(w);
            mx = mx.max(w);
        }
        let an = DVec3::from_array(f.anchor);
        let b = f.local_bbox;
        let emn = an + DVec3::new(b[0] as f64, b[1] as f64, b[2] as f64);
        let emx = an + DVec3::new(b[3] as f64, b[4] as f64, b[5] as f64);
        let e = (mn - emn)
            .abs()
            .max_element()
            .max((mx - emx).abs().max_element());
        // Hypothesis A: anchor is the translation, identity rotation.
        let (mut amn, mut amx) = (DVec3::splat(f64::MAX), DVec3::splat(f64::MIN));
        for p in &r.positions {
            let w = DVec3::new(p[0] as f64, p[1] as f64, p[2] as f64) + an;
            amn = amn.min(w);
            amx = amx.max(w);
        }
        let ea = (amn - emn)
            .abs()
            .max_element()
            .max((amx - emx).abs().max_element());
        if ea <= tol {
            ok_a += 1
        }
        tb.0 = tb.0.min(mn);
        tb.1 = tb.1.max(mx);
        ab.0 = ab.0.min(amn);
        ab.1 = ab.1.max(amx);
        errs.push(e);
        if e <= tol {
            ok += 1
        } else {
            bad += 1
        }
        worst = worst.max(e);
    }
    errs.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let med = errs.get(errs.len() / 2).copied().unwrap_or(0.0);
    println!("{}: fragments {} | transform rule ok {} bad {} (median err {:.4}, worst {:.3}) | anchor-as-translation ok {} | no record {}",
        a[1].rsplit('/').next().unwrap(), best.len(), ok, bad, med, worst, ok_a, norec);
    println!(
        "   world bbox, transform rule : {:8.1?} .. {:8.1?}",
        tb.0.to_array(),
        tb.1.to_array()
    );
    println!(
        "   world bbox, anchor rule    : {:8.1?} .. {:8.1?}",
        ab.0.to_array(),
        ab.1.to_array()
    );
}
