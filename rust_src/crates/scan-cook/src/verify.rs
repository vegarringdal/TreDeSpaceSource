//! Check a `.tdpp` against its source.
//!
//! * LGSX: node by node, the decoded points (snapped back to the 1 mm grid)
//!   must equal the LGSX node's points exactly, attributes included.
//! * E57: the output is re-partitioned, so the check is an order-independent
//!   multiset hash over every point's (grid position, RGB, intensity, setup)
//!   plus the count — equal hashes mean the same points, bit for bit on the
//!   cook grid.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use scan_core::e57::E57;
use scan_core::lgsx::Lgsx;
use serde::Serialize;

use crate::e57::{pt, E57Frame};
use crate::format::FLAG_SETUP;
use crate::lgsx::LgsxFrame;
use crate::node::{Cube, Grid, NodeKey, Pt};
use crate::reader::Tdpp;
use crate::Result;

#[derive(Debug, Default, Serialize)]
pub struct Report {
    pub source_points: u64,
    pub tdpp_points: u64,
    pub nodes_checked: u64,
    pub mismatched_nodes: u64,
    /// Clusters whose quantization step is coarser than the grid (lossy).
    pub coarse_clusters: u64,
    pub source_hash: String,
    pub tdpp_hash: String,
    pub ok: bool,
}

fn splitmix(mut x: u64) -> u64 {
    x = x.wrapping_add(0x9E37_79B9_7F4A_7C15);
    x = (x ^ (x >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    x = (x ^ (x >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    x ^ (x >> 31)
}

pub fn point_hash(p: &Pt) -> u64 {
    let a = (p.g[0] as u32 as u64) | ((p.g[1] as u32 as u64) << 32);
    let b = (p.g[2] as u32 as u64)
        | ((p.rgb[0] as u64) << 32)
        | ((p.rgb[1] as u64) << 40)
        | ((p.rgb[2] as u64) << 48)
        | ((p.setup as u64) << 56);
    splitmix(a ^ splitmix(b ^ splitmix(p.intensity as u64)))
}

/// The intensity bits the file kept — the source is compared under them.
fn intensity_mask(t: &Tdpp) -> u16 {
    if t.header.flags & crate::format::FLAG_INTENSITY8 != 0 {
        crate::node::INTENSITY8_MASK
    } else {
        u16::MAX
    }
}

fn decoded_pts(t: &Tdpp, i: usize, scale: f64, coarse: &AtomicU64) -> Result<Vec<Pt>> {
    let d = t.decode(i)?;
    let c = d
        .clusters
        .iter()
        .filter(|c| {
            c.step
                .iter()
                .any(|&s| (s as f64 - scale).abs() > scale * 1e-4)
        })
        .count();
    coarse.fetch_add(c as u64, Ordering::Relaxed);
    Ok((0..d.positions.len())
        .map(|k| Pt {
            g: [
                (d.positions[k][0] / scale).round() as i32,
                (d.positions[k][1] / scale).round() as i32,
                (d.positions[k][2] / scale).round() as i32,
            ],
            rgb: d.rgb[k],
            setup: d.setup[k],
            intensity: d.intensity[k],
            n: d.normals.get(k).copied().unwrap_or(crate::node::NO_NORMAL),
        })
        .collect())
}

fn par<T: Send>(items: Vec<T>, threads: usize, f: impl Fn(T) -> Result<()> + Sync) -> Result<()> {
    let q = Mutex::new(items);
    let err: Mutex<Option<crate::Error>> = Mutex::new(None);
    std::thread::scope(|s| {
        for _ in 0..threads.max(1) {
            s.spawn(|| loop {
                let Some(it) = q.lock().unwrap().pop() else {
                    break;
                };
                if let Err(e) = f(it) {
                    *err.lock().unwrap() = Some(e);
                    q.lock().unwrap().clear();
                }
            });
        }
    });
    match err.into_inner().unwrap() {
        Some(e) => Err(e),
        None => Ok(()),
    }
}

pub fn against_lgsx(t: &Tdpp, l: &Lgsx, threads: usize) -> Result<Report> {
    let fr = LgsxFrame::new(l)?;
    // cooked in the file's coordinate system, or left in the project frame
    let placed = l.world_pose().apply(fr.grid.origin);
    let at = |o: [f64; 3]| (0..3).all(|k| (t.header.origin[k] - o[k]).abs() <= 1e-6);
    if !at(placed) && !at(fr.grid.origin) {
        return Err("tdpp origin differs from the LGSX cook frame".into());
    }
    let index: HashMap<NodeKey, usize> = t.keys.iter().enumerate().map(|(i, k)| (*k, i)).collect();
    let with_normals = t.header.flags & crate::format::FLAG_NORMALS != 0;
    let keep = intensity_mask(t);
    let (checked, bad, coarse, hs, ht) = (
        AtomicU64::new(0),
        AtomicU64::new(0),
        AtomicU64::new(0),
        AtomicU64::new(0),
        AtomicU64::new(0),
    );
    let matched = Mutex::new(Vec::new());
    par(l.nodes.iter().collect(), threads, |n| {
        let key = fr.key(&n.key)?;
        let p = l.read_node(n)?;
        let mut a: Vec<Pt> = (0..p.len())
            .map(|i| Pt {
                g: fr.to_pt(p.grid[i]),
                rgb: p.rgb.as_ref().map_or([255; 3], |c| c[i]),
                setup: p.setup.as_ref().map_or(0, |s| s[i]),
                intensity: p.intensity.as_ref().map_or(0, |v| v[i]) & keep,
                n: if with_normals {
                    p.normal_code
                        .as_ref()
                        .map_or(crate::node::NO_NORMAL, |c| c[i])
                } else {
                    crate::node::NO_NORMAL
                },
            })
            .collect();
        let Some(&ti) = index.get(&key) else {
            bad.fetch_add(1, Ordering::Relaxed);
            return Ok(());
        };
        let mut b = decoded_pts(t, ti, fr.grid.scale, &coarse)?;
        hs.fetch_add(
            a.iter().map(point_hash).fold(0u64, u64::wrapping_add),
            Ordering::Relaxed,
        );
        ht.fetch_add(
            b.iter().map(point_hash).fold(0u64, u64::wrapping_add),
            Ordering::Relaxed,
        );
        a.sort_unstable();
        b.sort_unstable();
        if a != b {
            bad.fetch_add(1, Ordering::Relaxed);
        }
        checked.fetch_add(1, Ordering::Relaxed);
        matched.lock().unwrap().push(ti);
        Ok(())
    })?;
    let matched = matched.into_inner().unwrap();
    let extra = t
        .nodes
        .iter()
        .enumerate()
        .filter(|(i, r)| r.point_count > 0 && !matched.contains(i))
        .count();
    let r = Report {
        source_points: l.info.point_count,
        tdpp_points: t.header.point_count,
        nodes_checked: checked.into_inner(),
        mismatched_nodes: bad.into_inner() + extra as u64,
        coarse_clusters: coarse.into_inner(),
        source_hash: format!("{:016x}", hs.into_inner()),
        tdpp_hash: format!("{:016x}", ht.into_inner()),
        ok: false,
    };
    Ok(Report {
        ok: r.mismatched_nodes == 0
            && r.source_points == r.tdpp_points
            && r.source_hash == r.tdpp_hash,
        ..r
    })
}

pub fn against_e57(t: &Tdpp, e: &E57, threads: usize) -> Result<Report> {
    let scale = t.meta["grid_scale"]
        .as_f64()
        .ok_or("tdpp metadata has no grid_scale")?;
    let r0 = &t.nodes[0];
    let size = (r0.cube_size as f64 / scale).round() as i64;
    let fr = E57Frame {
        grid: Grid {
            origin: t.header.origin,
            scale,
        },
        root: Cube {
            min: [-size / 2; 3],
            size,
        },
        log2: size.trailing_zeros(),
    };
    let multi = t.header.flags & FLAG_SETUP != 0;
    let keep = intensity_mask(t);
    let (mut hs, mut ns) = (0u64, 0u64);
    for s in 0..e.scans.len() {
        e.for_each_batch(s, true, threads, |b| {
            for i in 0..b.len() {
                let mut p = pt(&fr, &b, i, s.min(255) as u8, multi);
                p.intensity &= keep;
                hs = hs.wrapping_add(point_hash(&p));
            }
            ns += b.len() as u64;
            Ok(())
        })?;
    }
    let (ht, nt, coarse, checked) = (
        AtomicU64::new(0),
        AtomicU64::new(0),
        AtomicU64::new(0),
        AtomicU64::new(0),
    );
    par((0..t.nodes.len()).collect(), threads, |i| {
        let pts = decoded_pts(t, i, scale, &coarse)?;
        ht.fetch_add(
            pts.iter().map(point_hash).fold(0u64, u64::wrapping_add),
            Ordering::Relaxed,
        );
        nt.fetch_add(pts.len() as u64, Ordering::Relaxed);
        checked.fetch_add(1, Ordering::Relaxed);
        Ok(())
    })?;
    let r = Report {
        source_points: ns,
        tdpp_points: nt.into_inner(),
        nodes_checked: checked.into_inner(),
        mismatched_nodes: 0,
        coarse_clusters: coarse.into_inner(),
        source_hash: format!("{hs:016x}"),
        tdpp_hash: format!("{:016x}", ht.into_inner()),
        ok: false,
    };
    Ok(Report {
        ok: r.source_points == r.tdpp_points && r.source_hash == r.tdpp_hash,
        ..r
    })
}
