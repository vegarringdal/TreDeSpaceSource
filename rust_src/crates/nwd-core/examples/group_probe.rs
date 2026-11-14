//! Probe: what does a fragment's GROUP id actually point at?
//! Tests `node_id = group + first_id` directly against the hierarchy.
use nwd_core::{fragments, hierarchy, inspect, Container};

fn main() {
    let path = std::env::args().nth(1).unwrap();
    let bytes = std::fs::read(&path).unwrap();
    let c = Container::parse(&bytes).unwrap();
    let infos = inspect::classify_all(&c);
    let hi = infos
        .iter()
        .find(|i| i.kind == inspect::ChunkKind::LogicalHierarchy)
        .unwrap()
        .index;
    let nodes = hierarchy::parse_nodes(&c.data(hi));
    let by_id: std::collections::HashMap<u32, &hierarchy::Node> =
        nodes.iter().map(|n| (n.id, n)).collect();
    let geom_set: std::collections::HashSet<usize> = inspect::geometry_chunks_by_index(&c)
        .map(|(v, _)| v.into_iter().collect())
        .unwrap_or_default();
    let mut best: Vec<fragments::Fragment> = Vec::new();
    for i in 0..c.chunks.len() {
        if geom_set.contains(&i) {
            continue;
        }
        let f = fragments::placements(&c.data(i));
        if f.len() > best.len() {
            best = f;
        }
    }
    let first_id = hierarchy::first_id_of(&c.data(hi));
    println!(
        "fragments {}  nodes {}  first_id {}",
        best.len(),
        nodes.len(),
        first_id
    );
    let (mut leaf_hits, mut container_hits, mut miss) = (0usize, 0usize, 0usize);
    for f in &best {
        match f.group.and_then(|g| by_id.get(&(g + first_id))) {
            Some(n) if n.geometry => leaf_hits += 1,
            Some(_) => container_hits += 1,
            None => miss += 1,
        }
    }
    println!("direct group+{first_id}: leaf {leaf_hits}, container {container_hits}, miss {miss}");
    // Hypothesis 2: group = node ORDINAL in DFS order (nodes only, ignoring
    // class/material record ids).
    for base in [0i64, 1, -1, 2] {
        let (mut leaf, mut cont, mut miss) = (0usize, 0usize, 0usize);
        for f in &best {
            let Some(g) = f.group else {
                miss += 1;
                continue;
            };
            match usize::try_from(g as i64 + base)
                .ok()
                .and_then(|i| nodes.get(i))
            {
                Some(n) if n.geometry => leaf += 1,
                Some(_) => cont += 1,
                None => miss += 1,
            }
        }
        println!("ordinal nodes[g{base:+}]: leaf {leaf}, cont {cont}, miss {miss}");
    }
    // If a needle name is given, show which fragments nodes[g-1] maps to it,
    // and what the OLD direct rule (by_id[g+first_id]) said for the same frags.
    if let Some(needle) = std::env::args().nth(2) {
        let target: Vec<usize> = nodes
            .iter()
            .enumerate()
            .filter(|(_, n)| n.display.contains(&needle))
            .map(|(i, _)| i)
            .collect();
        println!(
            "nodes matching '{needle}': {:?}",
            target
                .iter()
                .map(|&i| (i, &nodes[i].display))
                .collect::<Vec<_>>()
        );
        for f in &best {
            let Some(g) = f.group else { continue };
            let ord = (g as usize).saturating_sub(1);
            if target.contains(&ord) {
                let old = by_id
                    .get(&(g + first_id))
                    .map(|n| n.display.clone())
                    .unwrap_or("MISS".into());
                println!(
                    "  frag off={} g={} new(nodes[g-1])='{}' old(direct)='{}'",
                    f.offset, g, nodes[ord].display, old
                );
            }
        }
    }
}
