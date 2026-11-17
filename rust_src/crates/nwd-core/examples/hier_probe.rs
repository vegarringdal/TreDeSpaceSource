//! Probe: run hierarchy::parse_nodes on every chunk of a file; report which
//! chunks parse into a plausible node tree (for loader-agnostic detection).
use nwd_core::{hierarchy, Container};

fn main() {
    let path = std::env::args().nth(1).unwrap();
    let bytes = std::fs::read(&path).unwrap();
    let c = Container::parse(&bytes).unwrap();
    for i in 0..c.chunks.len() {
        let ch = c.data(i);
        if ch.len() < 64 {
            continue;
        }
        let nodes = hierarchy::parse_nodes(&ch);
        if nodes.len() > 3 {
            let geom = nodes.iter().filter(|n| n.geometry).count();
            let named = nodes.iter().filter(|n| !n.display.is_empty()).count();
            let roots = nodes.iter().filter(|n| n.parent_id.is_none()).count();
            println!(
                "chunk {i}: {} nodes ({} geom, {} named, {} roots) first: {:?}",
                nodes.len(),
                geom,
                named,
                roots,
                nodes
                    .iter()
                    .take(3)
                    .map(|n| n.display.clone())
                    .collect::<Vec<_>>()
            );
        }
    }
}
