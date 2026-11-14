//! Non-RVM files (Revit / DWG / 3DS loaders): parse the scene tree with the
//! general node grammar, parse the placement frames, and report how they link.
//!
//!     cargo run --release --example tree_probe -- file.nwc [--tree]
//!
//! Prints: node / leaf / instance-reference counts, declared vs parsed frames,
//! frames whose group word lands on a geometry leaf, leaves that own at least
//! one frame, and — for nodes that carry their own translation (instances) —
//! how many have a frame placed at exactly that translation.
use nwd_core::{fragments, hierarchy, inspect, Container};
fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let show = args.iter().any(|a| a == "--tree");
    for path in args.iter().filter(|a| !a.starts_with("--")) {
        let bytes = std::fs::read(path).unwrap();
        let c = Container::parse(&bytes).unwrap();
        let (mut tree, mut frames): (Option<hierarchy::Tree>, Vec<fragments::InternedFrag>) =
            (None, Vec::new());
        let mut declared = 0u32;
        for i in 0..c.chunks.len() {
            let d = c.data(i);
            if tree.is_none() && inspect::looks_like_hierarchy(&d) {
                tree = hierarchy::parse_tree(&d);
            }
            if let Some(v) = fragments::interned_placements(&d) {
                if v.len() >= frames.len() {
                    declared = u32::from_le_bytes(d[0..4].try_into().unwrap());
                    frames = v;
                }
            }
        }
        let name = path.rsplit('/').next().unwrap();
        let Some(t) = tree else {
            println!(
                "{name}: tree did not parse; frames declared {declared} parsed {}",
                frames.len()
            );
            continue;
        };
        let leaf_of = |f: &fragments::InternedFrag| {
            t.nodes
                .get((f.group as usize).wrapping_sub(1))
                .filter(|n| n.geometry)
        };
        let linked = frames.iter().filter(|f| leaf_of(f).is_some()).count();
        let mut owned = vec![false; t.nodes.len()];
        for f in &frames {
            if leaf_of(f).is_some() {
                owned[f.group as usize - 1] = true;
            }
        }
        let leaves = t.nodes.iter().filter(|n| n.geometry).count();
        // instance check: a node with its own translation vs the frames of its subtree
        let (mut inst, mut inst_hit) = (0usize, 0usize);
        for (i, tr) in t.translations.iter().enumerate() {
            let Some(tr) = tr else { continue };
            let end = (i + 1..t.nodes.len())
                .find(|&j| t.nodes[j].depth <= t.nodes[i].depth)
                .unwrap_or(t.nodes.len());
            let sub: Vec<&fragments::InternedFrag> = frames
                .iter()
                .filter(|f| (i + 1..=end).contains(&(f.group as usize)))
                .collect();
            if sub.is_empty() {
                continue;
            }
            inst += 1;
            if sub
                .iter()
                .any(|f| (0..2).all(|k| (f.translation[k] - tr[k]).abs() < 1e-6))
            {
                inst_hit += 1;
            }
        }
        println!(
            "{name}: nodes {} (leaves {leaves}, depth-0 {}, instance refs {}) | frames declared {declared} parsed {} instanced {} | on a leaf {linked} | leaves with a frame {} | translated nodes with frames {inst}, a frame at that x/y {inst_hit}",
            t.nodes.len(),
            t.nodes.iter().filter(|n| n.depth == 0).count(),
            t.instance_refs,
            frames.len(),
            frames.iter().filter(|f| f.instanced).count(),
            owned.iter().filter(|o| **o).count(),
        );
        if show {
            for n in &t.nodes {
                println!(
                    "{}{} [{}]{}",
                    "  ".repeat(n.depth as usize),
                    n.display,
                    n.class.as_deref().unwrap_or("-"),
                    if n.geometry { " *" } else { "" }
                );
            }
        }
    }
}
