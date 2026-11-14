//! Integration tests on real scan files in `<repo>/scanSamples/` (not
//! committed — multi-GB). Each test skips when its file is missing.
//! Default `<repo>/scanSamples/` (gitignored); override with `SCAN_SAMPLES`.

use std::path::PathBuf;

use scan_core::e57::E57;
use scan_core::lgsx::{CubeKind, Lgsx};
use scan_core::model::ImageFormat;
use scan_core::source::open_file;

fn sample(name: &str) -> Option<PathBuf> {
    let dir = std::env::var_os("SCAN_SAMPLES")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../scanSamples"));
    let p = dir.join(name);
    if p.exists() {
        Some(p)
    } else {
        eprintln!("skip: {} not present", p.display());
        None
    }
}

#[test]
fn piazza_lgsx() {
    let Some(p) = sample("Piazza-della-Repubblica.lgsx") else {
        return;
    };
    let l = Lgsx::open(open_file(p).unwrap()).unwrap();
    assert_eq!(l.info.point_count, 461_771_540);
    assert_eq!(l.nodes.len(), 3855);
    assert_eq!(l.setups.len(), 14);
    assert!(l
        .setups
        .iter()
        .all(|s| s.point_index.is_some() && s.cubes.len() == 4));

    // a coarse, a middle and a leaf node: points inside their cube
    for node in [
        &l.nodes[0],
        &l.nodes[l.nodes.len() / 2],
        l.nodes.last().unwrap(),
    ] {
        let pts = l.read_node(node).unwrap();
        let k = node.key;
        assert!(!pts.is_empty());
        assert!(pts.grid.iter().all(|g| {
            [(g[0], k.x), (g[1], k.y), (g[2], k.z)]
                .iter()
                .all(|&(v, o)| v >= o && (v as u64) < o as u64 + k.size())
        }));
        assert_eq!(pts.rgb.as_ref().unwrap().len(), pts.len());
        assert!(pts
            .setup
            .as_ref()
            .unwrap()
            .iter()
            .all(|&s| (s as usize) < l.setups.len()));
    }

    // camera cube: 6 faces, JPEG mip chain 3072² → 1²
    let sec = l.cube_section(&l.setups[0], CubeKind::Camera).unwrap();
    let cube = l.cube(sec).unwrap();
    assert_eq!(cube.faces.len(), 6);
    for chain in &cube.faces {
        assert_eq!(chain.len(), 12);
        assert_eq!(
            (chain[0].format, chain[0].width, chain[0].height),
            (ImageFormat::Jpeg, 3072, 3072)
        );
        assert_eq!((chain[11].width, chain[11].height), (1, 1));
    }
    let jpg = l.read_image(sec, &cube.faces[0][0]).unwrap();
    assert!(jpg.starts_with(&[0xFF, 0xD8]) && jpg.ends_with(&[0xFF, 0xD9]));
}

#[test]
fn piazza_e57() {
    let Some(p) = sample("Piazza-della-Repubblica.e57") else {
        return;
    };
    let e = E57::open_with(open_file(p).unwrap(), true).unwrap();
    assert_eq!(e.total_points(), 461_771_540);
    assert_eq!(e.images.len(), 84);
    let st = e.stations();
    assert_eq!(st.len(), 14);
    assert!(st.iter().all(|s| s.cube.is_some()));
    let mut r = e.points(0, false).unwrap();
    r.batch_size = 100_000;
    let b = r.next_batch().unwrap().unwrap();
    assert_eq!(b.len(), 100_000);
    let bounds = e.scans[0].bounds.unwrap();
    assert!(b.positions.iter().all(|&q| {
        (0..3).all(|k| q[k] >= bounds.min[k] - 1e-3 && q[k] <= bounds.max[k] + 50.0)
    }));
    let blob = e.images[0].image.unwrap();
    let jpg = e.read_blob(&blob).unwrap();
    assert!(jpg.starts_with(&[0xFF, 0xD8]));
}

#[test]
fn truncated_e57_is_reported() {
    let Some(p) = sample("TeatroPergolesi.e57") else {
        return;
    };
    let src = open_file(p).unwrap();
    if src.len() >= 8_929_314_816 {
        return; // a complete copy: nothing to check
    }
    let err = E57::open(src)
        .err()
        .expect("truncated file must not open")
        .to_string();
    assert!(err.contains("truncated"), "{err}");
}

/// The header's `root-offset` is the root node's key, not the grid zero: in
/// these files it is 2³¹ + something, and reading it as the zero shifted the
/// whole cloud (by 98.304 m in Teatro) away from its setups and photos.
#[test]
fn lgsx_points_lie_in_the_declared_bounds() {
    for name in [
        "TeatroPergolesi.lgsx",
        "BLK360G1_Indoor_Office_classified 1.lgsx",
        "Piazza-della-Repubblica.lgsx",
        "Tevas test RTC360 1.lgsx",
    ] {
        let Some(p) = sample(name) else { continue };
        let l = Lgsx::open(open_file(p).unwrap()).unwrap();
        let b = &l.info.bounds;
        let batch = l.node_batch(&l.nodes[0]).unwrap();
        assert!(!batch.is_empty());
        for q in &batch.positions {
            for k in 0..3 {
                assert!(
                    q[k] >= b.min[k] - 0.01 && q[k] <= b.max[k] + 0.01,
                    "{name}: point {q:?} outside {:?}..{:?}",
                    b.min,
                    b.max
                );
            }
        }
        for s in &l.setups {
            let t = s.pose.translation;
            assert!(
                (0..2).all(|k| t[k] >= b.min[k] - 5.0 && t[k] <= b.max[k] + 5.0),
                "{name}: setup {} at {t:?} is away from the cloud",
                s.name
            );
        }
    }
}
