//! Print Facet Group leaf ancestry to understand byClass nodes.
use nwd_core::hierarchy::parse_nodes;
use nwd_core::inspect::{classify_all, ChunkKind};
use nwd_core::Container;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let bytes = std::fs::read(&args[1]).unwrap();
    let container = Container::parse(&bytes).unwrap();
    let infos = classify_all(&container);
    let hier = infos
        .iter()
        .find(|i| i.kind == ChunkKind::LogicalHierarchy)
        .unwrap();
    let chunk = &container.data(hier.index);

    let nodes = parse_nodes(chunk);
    let by_id: std::collections::HashMap<u32, &nwd_core::hierarchy::Node> =
        nodes.iter().map(|n| (n.id, n)).collect();

    println!("Total nodes: {}", nodes.len());
    let fg: Vec<_> = nodes
        .iter()
        .filter(|n| n.geometry && n.class.as_deref() == Some("Facet Group"))
        .collect();
    println!("Facet Group leaves: {}", fg.len());

    // All geometry leaves
    let all_geom: Vec<_> = nodes.iter().filter(|n| n.geometry).collect();
    println!("All geometry leaves: {}", all_geom.len());

    let fg_class_leaves: Vec<_> = nodes
        .iter()
        .filter(|n| {
            n.geometry
                && matches!(
                    n.class.as_deref(),
                    Some("Facet Group") | Some("Cylinder") | Some("Line")
                )
        })
        .collect();
    println!(
        "Class-named leaves (FG+Cyl+Line): {}",
        fg_class_leaves.len()
    );

    // For each FG leaf, walk up to find first named ancestor
    println!("\nFacet Group ancestry (first 20):");
    for nd in fg.iter().take(20) {
        let mut anc = vec![];
        let mut pid = nd.parent_id;
        while let Some(p_id) = pid {
            if let Some(p) = by_id.get(&p_id) {
                anc.push(format!(
                    "{}({})",
                    p.display,
                    if p.geometry { "leaf" } else { "cont" }
                ));
                pid = p.parent_id;
            } else {
                break;
            }
        }
        println!(
            "  id={} depth={} display={:?} <- {}",
            nd.id,
            nd.depth,
            nd.display,
            anc.iter().take(3).cloned().collect::<Vec<_>>().join(" > ")
        );
    }
}
// Add more analysis - only thing that matters is this code compiles separately
