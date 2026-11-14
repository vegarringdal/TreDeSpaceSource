//! Regression tests on the Huldra sample (Equinor open data), read from
//! `convertSamples/nwd/huldra/` — see its README for source and licence.
//!
//! Expected values come from the decoded files and were validated against the
//! Navisworks FBX export and the AVEVA attribute `.txt` files of the full dataset
//! (results in `docs/what_we_know_v1.md`).

use nwd_core::{fragments, geometry, hierarchy, inspect, properties, Container};

fn load(rel: &str) -> Vec<u8> {
    let p = format!(
        "{}/../../../convertSamples/nwd/{rel}",
        env!("CARGO_MANIFEST_DIR")
    );
    std::fs::read(&p).unwrap_or_else(|e| panic!("{p}: {e}"))
}

fn hier_index(c: &Container) -> usize {
    inspect::classify_all(c)
        .iter()
        .find(|i| i.kind == inspect::ChunkKind::LogicalHierarchy)
        .expect("hierarchy chunk")
        .index
}

fn geometry_buf(c: &Container) -> (Vec<u8>, Vec<u32>) {
    let (idx, sizes) = inspect::geometry_chunks_by_index(c).expect("size index");
    let mut buf = Vec::new();
    for i in idx {
        buf.extend_from_slice(&c.data(i));
    }
    (buf, sizes)
}

fn fragments_of(c: &Container) -> Vec<fragments::Fragment> {
    let geom: std::collections::HashSet<usize> = inspect::geometry_chunks_by_index(c)
        .map(|(v, _)| v.into_iter().collect())
        .unwrap_or_default();
    (0..c.chunks.len())
        .filter(|i| !geom.contains(i))
        .map(|i| fragments::placements(&c.data(i)))
        .max_by_key(|f| f.len())
        .unwrap_or_default()
}

/// Single-root area file: full tree (slot-count grammar), property stream,
/// direct group-ordinal links (incl. the near-axis placement), all meshes decode.
#[test]
fn cd2_tree_props_links_geometry() {
    let bytes = load("huldra/HDA-ASB-CD2.nwd");
    let c = Container::parse(&bytes).unwrap();
    let hi = hier_index(&c);
    let hdata = c.data(hi);
    let nodes = hierarchy::parse_nodes(&hdata);
    assert_eq!(nodes.len(), 754);
    assert_eq!(nodes.iter().filter(|n| n.geometry).count(), 511);
    assert_eq!(nodes[0].display, "/CD2-PSUP");
    assert_eq!(nodes[0].child_count, 20);
    assert_eq!(hierarchy::header_table(&hdata), vec![754]);

    // Property stream: one block per node, values as in CD2-PSUP.txt.
    let chunks = properties::find_chunks(&c, hi, 1);
    assert_eq!(chunks.len(), 1);
    let mut blocks = Vec::new();
    let n = properties::PropReader::new()
        .feed(&c.data(chunks[0]), |b| blocks.push(b))
        .unwrap();
    assert_eq!(n, 754);
    assert_eq!(nodes.iter().filter(|n| n.has_properties()).count(), 754);
    let root = &blocks[0];
    assert_eq!(root.category, "PDMS");
    let get = |k: &str| {
        root.props
            .iter()
            .find(|p| p.0 == k)
            .map(|p| p.1.to_string())
    };
    assert_eq!(get("Name").as_deref(), Some("/CD2-PSUP"));
    assert_eq!(get("RefNo").as_deref(), Some("=25011/73"));
    assert_eq!(get("NumbDb").as_deref(), Some("435"));

    // Every fragment's group id is the 1-based DFS ordinal of a geometry leaf;
    // 852 incl. the box at z = 0 the old |coord| >= 1 m gate dropped.
    let frags = fragments_of(&c);
    assert_eq!(frags.len(), 852);
    let linked = frags
        .iter()
        .filter(|f| {
            f.group
                .and_then(|g| nodes.get(g as usize - 1))
                .is_some_and(|n| n.geometry)
        })
        .count();
    assert_eq!(linked, 852);

    let (buf, sizes) = geometry_buf(&c);
    let recs = geometry::parse_sized(&buf, &sizes).unwrap();
    let mesh = recs.iter().filter(|r| r.variant == 94).count();
    let ok = recs
        .iter()
        .filter(|r| r.variant == 94 && r.decoded_tris.as_ref().is_some_and(|t| !t.is_empty()))
        .count();
    assert_eq!((ok, mesh), (149, 149));
}

/// Multi-file area NWD: ten File roots, each followed by a partition trailer;
/// property blocks span four chunks counted by the header table; mesh records
/// using the PRE-stream RLE token (0x80+k, k > 0) decode.
#[test]
fn ha_file_roots_props_and_rle() {
    let bytes = load("huldra/HDA-ASB-HA.nwd");
    let c = Container::parse(&bytes).unwrap();
    let hi = hier_index(&c);
    let hdata = c.data(hi);
    let nodes = hierarchy::parse_nodes(&hdata);
    assert_eq!(nodes.len(), 31094);
    let roots: Vec<&str> = nodes
        .iter()
        .filter(|n| n.depth == 0)
        .map(|n| n.display.as_str())
        .collect();
    assert_eq!(roots.len(), 10);
    assert_eq!(roots[0], "HA-ARCH.RVM");
    assert_eq!(roots[9], "HA-TELE.RVM");
    assert!(nodes
        .iter()
        .filter(|n| n.depth == 0)
        .all(|n| n.class.as_deref() == Some("File")));

    let table = hierarchy::header_table(&hdata);
    assert_eq!(table, vec![8772, 11142, 9253, 22]);
    let chunks = properties::find_chunks(&c, hi, table.len());
    let mut reader = properties::PropReader::new();
    let mut total = 0usize;
    for (k, &ci) in chunks.iter().enumerate() {
        let n = reader.feed(&c.data(ci), |_| {}).unwrap();
        assert_eq!(n as u32, table[k]);
        total += n;
    }
    let owned: u32 = nodes.iter().map(|n| n.property_sets()).sum();
    assert_eq!(total as u32, owned);

    let (buf, sizes) = geometry_buf(&c);
    let recs = geometry::parse_sized(&buf, &sizes).unwrap();
    let mesh = recs.iter().filter(|r| r.variant == 94).count();
    let ok = recs
        .iter()
        .filter(|r| r.variant == 94 && r.decoded_tris.as_ref().is_some_and(|t| !t.is_empty()))
        .count();
    assert_eq!((ok, mesh), (8255, 8255));
}

/// Assembly NWD of all 22 areas: nested File nodes (area .nwd → .RVM → site).
#[test]
fn assembly_nested_file_nodes() {
    let bytes = load("huldra/Huldra_Asbuilt.nwd");
    let c = Container::parse(&bytes).unwrap();
    let nodes = hierarchy::parse_nodes(&c.data(hier_index(&c)));
    assert_eq!(nodes.len(), 234_760);
    assert_eq!(nodes.iter().filter(|n| n.geometry).count(), 183_219);
    assert_eq!(nodes.iter().filter(|n| n.depth == 0).count(), 22);
    let ha = nodes
        .iter()
        .find(|n| n.display == "HDA-ASB-HA.nwd")
        .unwrap();
    assert_eq!(ha.child_count, 10);
    assert!(nodes
        .iter()
        .any(|n| n.display == "HA-ARCH.RVM" && n.parent_id == Some(ha.id)));
}

/// AUX tessellation matches Navisworks: 32-segment disc fan / open tube.
#[test]
fn aux_tessellation_shape() {
    let disc = geometry::AuxPrim::Disc {
        u: [1.0, 0.0, 0.0],
        v: [0.0, 1.0, 0.0],
        r: 2.0,
    };
    let p = geometry::aux_points(&disc);
    assert_eq!(p.len(), 33);
    assert_eq!(p[1], [2.0, 0.0, 0.0]); // first ring vertex at angle 0 along u
    let idx = geometry::aux_disc_indices();
    assert_eq!(idx.len(), 32 * 3);
    // normal of the first fan triangle = u × v = +Z
    let (a, b, c) = (p[idx[0] as usize], p[idx[1] as usize], p[idx[2] as usize]);
    let n = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    assert!(n > 0.0);
    let cyl = geometry::AuxPrim::Cyl {
        origin: [0.0, 0.0, -1.0],
        u: [1.0, 0.0, 0.0],
        v: [0.0, 1.0, 0.0],
        r: 1.0,
    };
    assert_eq!(geometry::aux_points(&cyl).len(), 64);
    assert_eq!(geometry::aux_tube_indices().len(), 64 * 3);
    let degenerate = geometry::AuxPrim::Disc {
        u: [0.0; 3],
        v: [0.0; 3],
        r: 0.0,
    };
    assert!(degenerate.is_degenerate());
}
