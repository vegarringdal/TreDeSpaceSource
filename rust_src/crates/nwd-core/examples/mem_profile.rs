//! Memory profile of the whole-file state `convert_inner_sink` builds before
//! its first output: the container index, the hierarchy, the placement scan
//! and the decoded geometry — each measured as live heap bytes (a counting
//! allocator) plus the item counts behind them.
//!
//! `cargo run --release -p nwd-core --example mem_profile -- <file.nwd>`

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering::Relaxed};
use std::time::Instant;

use nwd_core::{container::Container, fragments, geometry, hierarchy, inspect};

struct Counting;
static LIVE: AtomicUsize = AtomicUsize::new(0);
static PEAK: AtomicUsize = AtomicUsize::new(0);

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        let p = unsafe { System.alloc(l) };
        if !p.is_null() {
            let now = LIVE.fetch_add(l.size(), Relaxed) + l.size();
            PEAK.fetch_max(now, Relaxed);
        }
        p
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        unsafe { System.dealloc(p, l) };
        LIVE.fetch_sub(l.size(), Relaxed);
    }
}

#[global_allocator]
static A: Counting = Counting;

fn mb(n: usize) -> f64 {
    n as f64 / (1024.0 * 1024.0)
}

fn live() -> usize {
    LIVE.load(Relaxed)
}

fn main() {
    let path = std::env::args()
        .nth(1)
        .expect("usage: mem_profile <file.nwd>");
    let t0 = Instant::now();
    let bytes = std::fs::read(&path).unwrap();
    let base = live();
    println!("input                 {:8.1} MB", mb(bytes.len()));

    let c = Container::parse(&bytes).unwrap();
    let after_container = live();
    let infl: usize = c.chunks.iter().map(|ch| ch.inflated_len).sum();
    println!(
        "container index       {:8.1} MB  ({} chunks, {:.1} MB inflated in all)",
        mb(after_container - base),
        c.chunks.len(),
        mb(infl)
    );
    let mut by_size: Vec<(usize, usize)> = c
        .chunks
        .iter()
        .enumerate()
        .map(|(i, ch)| (ch.inflated_len, i))
        .collect();
    by_size.sort_unstable_by(|a, b| b.cmp(a));
    let big: Vec<String> = by_size
        .iter()
        .take(6)
        .map(|(n, i)| format!("#{i} {:.1}", mb(*n)))
        .collect();
    println!("  largest chunks (MB inflated): {}", big.join(", "));

    let geom_index = inspect::geometry_chunks_by_index(&c);
    let geom_idxs: Vec<usize> = geom_index
        .as_ref()
        .map(|(i, _)| i.clone())
        .unwrap_or_default();
    let geom_infl: usize = geom_idxs.iter().map(|&i| c.chunks[i].inflated_len).sum();
    let infos = inspect::classify_except(&c, &geom_idxs);
    println!(
        "classify              {:8.1} MB  ({} geometry chunks = {:.1} MB inflated; {} others)  {:.1}s",
        mb(live() - after_container),
        geom_idxs.len(),
        mb(geom_infl),
        infos.len(),
        t0.elapsed().as_secs_f32()
    );
    let mark = live();

    let hier_i = infos
        .iter()
        .find(|i| i.kind == inspect::ChunkKind::LogicalHierarchy)
        .map(|i| i.index);
    let hier_data = hier_i.map(|i| c.data(i)).unwrap_or_default();
    let hier_bytes = live() - mark;
    let nodes = hierarchy::parse_nodes(&hier_data);
    let nodes_live = live() - mark - hier_bytes;
    let display: usize = nodes.iter().map(|n| n.display.capacity()).sum();
    let leaves = nodes.iter().filter(|n| n.geometry).count();
    let roots = nodes.iter().filter(|n| n.depth == 0).count();
    println!(
        "hierarchy chunk       {:8.1} MB  (inflated, freed after the parse)",
        mb(hier_bytes)
    );
    println!(
        "hierarchy nodes       {:8.1} MB  ({} nodes x {} B = {:.1} MB + names {:.1} MB; {} leaves, {} roots)",
        mb(nodes_live),
        nodes.len(),
        std::mem::size_of::<hierarchy::Node>(),
        mb(nodes.len() * std::mem::size_of::<hierarchy::Node>()),
        mb(display),
        leaves,
        roots
    );
    drop(hier_data);
    let mark = live();

    // the placement scan: every non-geometry chunk inflated and probed; the
    // converter keeps the chunk with the most placements (bytes + fragments)
    let gset: std::collections::HashSet<usize> = geom_idxs.iter().copied().collect();
    let t = Instant::now();
    let mut best: Option<(usize, Vec<u8>, Vec<fragments::Fragment>)> = None;
    let mut interned_best = 0usize;
    let mut scanned = 0usize;
    let mut peak_chunk = 0usize;
    for ci in 0..c.chunks.len() {
        if gset.contains(&ci) {
            continue;
        }
        let data = c.data(ci);
        scanned += data.len();
        peak_chunk = peak_chunk.max(data.len());
        if let Some(i) = fragments::interned_placements(&data) {
            interned_best = interned_best.max(i.len());
        }
        let mut f = fragments::placements(&data);
        let seen: std::collections::HashSet<usize> = f.iter().map(|x| x.offset).collect();
        for fr in fragments::parse(&data).unwrap_or_default() {
            if !seen.contains(&fr.offset) {
                f.push(fr);
            }
        }
        if best.as_ref().is_none_or(|b| f.len() >= b.2.len()) {
            best = Some((ci, data, f));
        }
    }
    let (fci, fdata, frags) = best.unwrap_or_default();
    println!(
        "placement scan        {:8.1} MB  ({:.1} MB inflated over {:.1}s, largest chunk {:.1} MB; interned {})",
        mb(live() - mark),
        mb(scanned),
        t.elapsed().as_secs_f32(),
        mb(peak_chunk),
        interned_best
    );
    println!(
        "  fragment chunk #{fci}  {:8.1} MB  (kept for the legacy linker; the direct path drops it)",
        mb(fdata.capacity())
    );
    println!(
        "  fragments           {:8.1} MB  ({} x {} B, capacity {})",
        mb(frags.capacity() * std::mem::size_of::<fragments::Fragment>()),
        frags.len(),
        std::mem::size_of::<fragments::Fragment>(),
        frags.capacity()
    );
    drop(fdata);
    let mark = live();

    let t = Instant::now();
    let (records, on_disk) = match &geom_index {
        Some((_, sizes)) => {
            let lens: Vec<usize> = geom_idxs
                .iter()
                .map(|&i| c.chunks[i].inflated_len)
                .collect();
            geometry::parse_stream(&lens, |k| c.data(geom_idxs[k]), sizes).unwrap()
        }
        None => panic!("no geometry size index"),
    };
    let rec_live = live() - mark;
    let pos: usize = records.iter().map(|r| r.positions.capacity() * 12).sum();
    let tris: usize = records
        .iter()
        .map(|r| r.decoded_tris.as_ref().map_or(0, |t| t.capacity() * 4))
        .sum();
    let segs: usize = records
        .iter()
        .map(|r| r.line_segments.as_ref().map_or(0, |s| s.capacity() * 8))
        .sum();
    let verts: usize = records.iter().map(|r| r.positions.len()).sum();
    println!(
        "geometry records      {:8.1} MB  ({} records, {} on disk, {:.1}s)",
        mb(rec_live),
        records.len(),
        on_disk.len(),
        t.elapsed().as_secs_f32()
    );
    println!(
        "  positions {:.1} MB ({} vertices), triangle indices {:.1} MB, line segments {:.1} MB, structs {:.1} MB",
        mb(pos),
        verts,
        mb(tris),
        mb(segs),
        mb(records.capacity() * std::mem::size_of::<geometry::GeomRecord>())
    );
    // ── per-root distribution (the direct path's routing) ──────────────────
    let node_pos: std::collections::HashMap<u32, usize> =
        nodes.iter().enumerate().map(|(i, n)| (n.id, i)).collect();
    let mut root_of: Vec<Option<usize>> = Vec::with_capacity(nodes.len());
    let mut root_seq = 0usize;
    for (i, n) in nodes.iter().enumerate() {
        let r = match n.parent_id {
            None => {
                root_seq += 1;
                (n.depth == 0).then_some(root_seq - 1)
            }
            Some(p) => node_pos
                .get(&p)
                .and_then(|&pi| if pi < i { root_of[pi] } else { None }),
        };
        root_of.push(r);
    }
    let n_roots = nodes.iter().filter(|n| n.depth == 0).count();
    let mut frag_root: Vec<Option<usize>> = Vec::with_capacity(frags.len());
    for f in &frags {
        frag_root.push(
            f.group
                .and_then(|g| (g as usize).checked_sub(1))
                .filter(|&g| g < nodes.len() && nodes[g].geometry)
                .and_then(|g| root_of[g]),
        );
    }
    let routed = frag_root.iter().filter(|r| r.is_some()).count();
    let runs = frag_root.windows(2).filter(|w| w[0] != w[1]).count() + 1;
    let mut per_root = vec![0usize; n_roots];
    let mut rec_roots: std::collections::HashMap<usize, Vec<usize>> = Default::default();
    for (f, r) in frags.iter().zip(&frag_root) {
        let Some(r) = *r else { continue };
        per_root[r] += 1;
        if let Some(mi) = f
            .geom_record_idx
            .filter(|&i| i >= 1)
            .and_then(|i| on_disk.mesh(i as usize - 1))
        {
            let v = rec_roots.entry(mi).or_default();
            if v.last() != Some(&r) && !v.contains(&r) {
                v.push(r);
            }
        }
    }
    let rec_bytes = |mi: usize| -> usize {
        let r = &records[mi];
        r.positions.len() * 12 + r.decoded_tris.as_ref().map_or(0, |t| t.len() * 4)
    };
    let mut root_rec_bytes = vec![0usize; n_roots];
    let mut root_recs = vec![0usize; n_roots];
    let (mut shared, mut shared_bytes, mut dup_bytes) = (0usize, 0usize, 0usize);
    for (&mi, rs) in &rec_roots {
        let b = rec_bytes(mi);
        for &r in rs {
            root_rec_bytes[r] += b;
            root_recs[r] += 1;
        }
        if rs.len() > 1 {
            shared += 1;
            shared_bytes += b;
            dup_bytes += b * (rs.len() - 1);
        }
    }
    let no_readout = frags
        .iter()
        .filter(|f| {
            f.geom_record_idx.filter(|&i| i >= 1).is_none_or(|i| {
                on_disk.mesh(i as usize - 1).is_none() && on_disk.aux(i as usize - 1).is_none()
            })
        })
        .count();
    let mut order: Vec<usize> = (0..n_roots).collect();
    order.sort_by_key(|&r| std::cmp::Reverse(root_rec_bytes[r]));
    println!(
        "roots {n_roots}: fragments routed {routed} of {} in {runs} root runs; no record read-out {no_readout}",
        frags.len()
    );
    println!(
        "records used {} of {}; used by >1 root: {shared} ({:.1} MB, decoding per root adds {:.1} MB in all)",
        rec_roots.len(),
        records.len(),
        mb(shared_bytes),
        mb(dup_bytes)
    );
    for &r in order.iter().take(5) {
        println!(
            "  root {r:4}: {:7} fragments, {:6} records, {:6.1} MB decoded geometry",
            per_root[r],
            root_recs[r],
            mb(root_rec_bytes[r])
        );
    }
    // ── what a split at level 2 (each root's children) would produce ──────
    {
        let mut unit_of: Vec<Option<usize>> = vec![None; nodes.len()];
        let mut units = 0usize;
        for (i, n) in nodes.iter().enumerate() {
            unit_of[i] = match (n.depth, n.parent_id) {
                (0, _) => None,
                (1, _) => {
                    units += 1;
                    Some(units - 1)
                }
                (_, Some(p)) => node_pos.get(&p).and_then(|&pi| unit_of[pi]),
                _ => None,
            };
        }
        let mut unit_frags = vec![0usize; units];
        let mut on_root = 0usize;
        for f in &frags {
            match f
                .group
                .and_then(|g| (g as usize).checked_sub(1))
                .filter(|&g| g < nodes.len())
                .and_then(|g| unit_of[g])
            {
                Some(u) => unit_frags[u] += 1,
                None => on_root += 1,
            }
        }
        let mut sorted = unit_frags.clone();
        sorted.sort_unstable_by(|a, b| b.cmp(a));
        let per_root: Vec<usize> = (0..n_roots)
            .map(|r| {
                nodes
                    .iter()
                    .enumerate()
                    .filter(|(i, n)| n.depth == 1 && root_of[*i] == Some(r))
                    .count()
            })
            .collect();
        println!(
            "level-2 split: {units} units (roots have {}..{} children); fragments on the roots themselves {on_root}; largest units {:?}",
            per_root.iter().min().unwrap_or(&0),
            per_root.iter().max().unwrap_or(&0),
            &sorted[..sorted.len().min(5)]
        );
        // what the first levels are: names and classes of the first nodes
        for depth in 0..4u32 {
            let shown: Vec<String> = nodes
                .iter()
                .filter(|n| n.depth == depth)
                .take(4)
                .map(|n| format!("{} [{}]", n.display, n.class.as_deref().unwrap_or("-")))
                .collect();
            let count = nodes.iter().filter(|n| n.depth == depth).count();
            println!("  depth {depth} ({count} nodes): {}", shown.join(" | "));
        }
        let mut top_roots = per_root_sorted_desc(&per_root);
        top_roots.truncate(3);
        println!("  roots with most children: {top_roots:?}");
    }
    let tot: usize = root_rec_bytes.iter().sum();
    println!("  sum over roots {:.1} MB decoded geometry", mb(tot));
    println!(
        "TOTAL live {:.1} MB, peak {:.1} MB, {:.1}s",
        mb(live()),
        mb(PEAK.load(Relaxed)),
        t0.elapsed().as_secs_f32()
    );
}

fn per_root_sorted_desc(v: &[usize]) -> Vec<(usize, usize)> {
    let mut out: Vec<(usize, usize)> = v.iter().copied().enumerate().collect();
    out.sort_unstable_by(|a, b| b.1.cmp(&a.1));
    out
}
