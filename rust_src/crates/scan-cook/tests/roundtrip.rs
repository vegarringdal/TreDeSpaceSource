//! Synthetic round trips: node codec, LOD build, writer → reader.

use scan_cook::format::NO_INDEX;
use scan_cook::lod::{self, LodParams};
use scan_cook::node::{self, Cube, EncodeOptions, Grid, NodeKey, Pt};
use scan_cook::reader::Tdpp;
use scan_cook::verify::point_hash;
use scan_cook::writer::Writer;
use scan_core::source::open_file;

struct Lcg(u64);
impl Lcg {
    fn next(&mut self) -> u32 {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        (self.0 >> 33) as u32
    }
}

/// Points on a wavy surface inside a cube of `size` grid units at `min`.
fn surface(n: usize, min: i32, size: i32, seed: u64) -> Vec<Pt> {
    let mut r = Lcg(seed);
    (0..n)
        .map(|_| {
            let x = (r.next() % size as u32) as i32;
            let y = (r.next() % size as u32) as i32;
            let z = ((((x as f64) * 0.01).sin() * 0.2 + 0.5) * size as f64) as i32
                + (r.next() % 5) as i32;
            Pt {
                g: [min + x, min + y, min + z.min(size - 1)],
                rgb: [(x % 256) as u8, (y % 256) as u8, (r.next() % 256) as u8],
                setup: (r.next() % 3) as u8,
                intensity: (r.next() % 65536) as u16,
                n: (r.next() % 65_144) as u16,
            }
        })
        .collect()
}

fn back_to_grid(d: &node::Decoded, scale: f64) -> Vec<Pt> {
    (0..d.positions.len())
        .map(|k| Pt {
            g: [0, 1, 2].map(|a| (d.positions[k][a] / scale).round() as i32),
            rgb: d.rgb[k],
            setup: d.setup[k],
            intensity: d.intensity[k],
            n: d.normals.get(k).copied().unwrap_or(node::NO_NORMAL),
        })
        .collect()
}

#[test]
fn node_codec_is_lossless_on_the_grid() {
    let grid = Grid {
        origin: [1000.0, -2000.0, 30.0],
        scale: 0.001,
    };
    let cube = Cube {
        min: [-4096; 3],
        size: 8192,
    };
    let mut pts = surface(20_000, -4096, 8192, 7);
    let e = node::encode(
        NodeKey::ROOT,
        cube,
        &pts,
        &grid,
        &EncodeOptions {
            cluster_size: 64,
            codec_level: 2,
            normals: true,
            intensity16: true,
        },
    );
    assert_eq!(e.record.point_count, 20_000);
    assert_eq!(e.record.cluster_count, 20_000u32.div_ceil(64));
    assert_eq!(e.record.setup_mask, 0b111);
    let d = node::decode(&e.record, &e.payload).unwrap();
    let mut back = back_to_grid(&d, grid.scale);
    pts.sort_unstable();
    back.sort_unstable();
    assert_eq!(pts, back);
    // clusters are compact and partition the points
    let covered: u32 = d.clusters.iter().map(|c| c.count).sum();
    assert_eq!(covered, 20_000);
    assert!(d.clusters.iter().all(|c| c.step == [0.001f32; 3]));
}

#[test]
fn eight_bit_intensity_keeps_the_high_byte() {
    let grid = Grid {
        origin: [0.0; 3],
        scale: 0.001,
    };
    let cube = Cube {
        min: [-4096; 3],
        size: 8192,
    };
    let mut pts = surface(5_000, -4096, 8192, 11);
    let enc = EncodeOptions {
        cluster_size: 64,
        codec_level: 2,
        normals: true,
        intensity16: false,
    };
    let e = node::encode(NodeKey::ROOT, cube, &pts, &grid, &enc);
    assert_eq!(e.record.flags, scan_cook::format::NODE_COLOR_DELTA);
    let d = node::decode(&e.record, &e.payload).unwrap();
    let mut back = back_to_grid(&d, grid.scale);
    for p in &mut pts {
        p.intensity &= node::INTENSITY8_MASK;
    }
    pts.sort_unstable();
    back.sort_unstable();
    assert_eq!(pts, back);
}

#[test]
fn far_apart_points_are_split_into_exact_clusters() {
    // 40 points spread over 400 m on a 0.1 mm grid: one cluster could not
    // hold them at one grid unit per step (u16 reaches 6.5 m), so it is
    // split until every part can — the points come back exactly
    let grid = Grid {
        origin: [0.0; 3],
        scale: 0.0001,
    };
    let size = 1 << 22;
    let cube = Cube { min: [0; 3], size };
    let mut pts = surface(40, 0, size as i32, 3);
    let e = node::encode(
        NodeKey::ROOT,
        cube,
        &pts,
        &grid,
        &EncodeOptions {
            cluster_size: 256,
            codec_level: 1,
            normals: true,
            intensity16: true,
        },
    );
    let d = node::decode(&e.record, &e.payload).unwrap();
    assert!(d.clusters.len() > 1);
    assert_eq!(e.record.cluster_count as usize, d.clusters.len());
    assert!(d.clusters.iter().all(|c| c.step == [0.0001f32; 3]));
    assert_eq!(d.clusters.iter().map(|c| c.count).sum::<u32>(), 40);
    let mut back = back_to_grid(&d, grid.scale);
    pts.sort_unstable();
    back.sort_unstable();
    assert_eq!(pts, back);
}

#[test]
fn lod_build_write_read() {
    let grid = Grid {
        origin: [10.0, 20.0, 30.0],
        scale: 0.001,
    };
    let root = Cube {
        min: [-32768; 3],
        size: 65536,
    };
    let pts = surface(300_000, -32768, 65536, 11);
    let want: u64 = pts.iter().map(point_hash).fold(0, u64::wrapping_add);
    let lp = LodParams {
        capacity: 20_000,
        min_size: 2,
        color_weight: 1.0,
        use_color: true,
    };
    let tree = lod::build(NodeKey::ROOT, root, pts, &grid, &lp);
    assert!(!tree.children.is_empty() && tree.pts.len() <= 20_000);

    let path =
        std::env::temp_dir().join(format!("scan_cook_roundtrip_{}.tdpp", std::process::id()));
    let mut w = Writer::create(&path).unwrap();
    let enc = EncodeOptions {
        cluster_size: 128,
        codec_level: 2,
        normals: true,
        intensity16: true,
    };
    let mut nodes = Vec::new();
    lod::walk(&tree, &mut |t| nodes.push((t.key, t.cube, t.pts.clone())));
    for (k, c, p) in nodes {
        if !p.is_empty() {
            w.add_node(node::encode(k, c, &p, &grid, &enc)).unwrap();
        }
    }
    let h = w
        .finish(
            root,
            &grid,
            128,
            7,
            3,
            &serde_json::json!({"format": "tdpp", "grid_scale": 0.001, "setups": []}),
        )
        .unwrap();
    assert_eq!(h.point_count, 300_000);

    let t = Tdpp::open(open_file(&path).unwrap()).unwrap();
    assert_eq!(t.nodes[0].parent, NO_INDEX);
    let mut got = 0u64;
    let mut n = 0u64;
    for (i, r) in t.nodes.iter().enumerate() {
        if i > 0 {
            assert!((r.parent as usize) < i);
            let p = &t.nodes[r.parent as usize];
            assert!(
                (p.first_child as usize..p.first_child as usize + p.child_count as usize)
                    .contains(&i)
            );
            assert_eq!(r.depth, p.depth + 1);
        }
        let d = t.decode(i).unwrap();
        let pts = back_to_grid(&d, 0.001);
        // every point inside its node cube
        let c = t.keys[i].cube(&root);
        assert!(pts
            .iter()
            .all(|q| (0..3)
                .all(|k| (q.g[k] as i64) >= c.min[k] && (q.g[k] as i64) < c.min[k] + c.size)));
        got = pts.iter().map(point_hash).fold(got, u64::wrapping_add);
        n += pts.len() as u64;
    }
    std::fs::remove_file(&path).ok();
    assert_eq!(n, 300_000);
    assert_eq!(got, want, "multiset of points changed");
}

#[test]
fn normal_ring_codes_roundtrip() {
    // every code decodes to a unit vector that encodes back to itself
    for c in 0..65_144u32 {
        let v = node::normal_from_code(c as u16).unwrap();
        assert!(((v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) - 1.0).abs() < 1e-5);
        assert_eq!(node::normal_to_code(v), c as u16);
    }
    assert_eq!(node::normal_from_code(node::NO_NORMAL), None);
}
