//! Probe: list every fragment linked (group = 1-based DFS ordinal) to the leaves
//! whose name contains NEEDLE, with its target geometry record and AUX params.
//!
//!     cargo run --release --example leaf_probe -- file.nwd "CYLINDER 5 of"
use nwd_core::{fragments, geometry, hierarchy, inspect, Container};

fn main() {
    let mut args = std::env::args().skip(1);
    let path = args.next().expect("nwd path");
    let needle = args.next().unwrap_or_default();
    let bytes = std::fs::read(&path).unwrap();
    let c = Container::parse(&bytes).unwrap();
    let infos = inspect::classify_all(&c);
    let hi = infos
        .iter()
        .find(|i| i.kind == inspect::ChunkKind::LogicalHierarchy)
        .unwrap()
        .index;
    let nodes = hierarchy::parse_nodes(&c.data(hi));
    let (gidx, _) = inspect::geometry_chunks_by_index(&c).expect("size index");
    let mut geom = Vec::new();
    for &i in &gidx {
        geom.extend_from_slice(&c.data(i));
    }
    let rec_map = geometry::record_index_map(&geom);
    let aux = geometry::aux_primitives(&geom);
    let records = geometry::parse(&geom).unwrap();
    let gset: std::collections::HashSet<usize> = gidx.into_iter().collect();
    let mut best: Vec<fragments::Fragment> = Vec::new();
    for i in 0..c.chunks.len() {
        if gset.contains(&i) {
            continue;
        }
        let f = fragments::placements(&c.data(i));
        if f.len() > best.len() {
            best = f;
        }
    }
    for f in &best {
        let Some(g) = f.group else { continue };
        let Some(n) = nodes.get(g as usize - 1) else {
            continue;
        };
        if !n.display.contains(&needle) {
            continue;
        }
        let ri = f.geom_record_idx.unwrap_or(0) as usize;
        let kind = match (
            rec_map.get(ri.wrapping_sub(1)).copied().flatten(),
            aux.get(ri.wrapping_sub(1)).copied().flatten(),
        ) {
            (Some(m), _) => {
                let r = &records[m];
                let (mn, mx) = r.bbox();
                format!(
                    "MESH v{} nv={} tris={} bbox=[{:.4},{:.4},{:.4}]..[{:.4},{:.4},{:.4}]",
                    r.variant,
                    r.positions.len(),
                    r.decoded_tris.as_ref().map_or(0, |t| t.len() / 3),
                    mn[0],
                    mn[1],
                    mn[2],
                    mx[0],
                    mx[1],
                    mx[2]
                )
            }
            (None, Some(a)) => format!("{a:?}"),
            _ => "NONE".into(),
        };
        println!(
            "g={} '{}' rec={} flag={:#x} t=[{:.4},{:.4},{:.4}] lbb={:?}\n    {}",
            g,
            n.display,
            ri,
            f.class_flag.unwrap_or(0),
            f.translation[0],
            f.translation[1],
            f.translation[2],
            f.local_bbox,
            kind
        );
    }
}
