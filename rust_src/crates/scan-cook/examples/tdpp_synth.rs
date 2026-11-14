//! Write a small synthetic .tdpp (wavy surface, LOD tree) for decoder tests.
//! usage: tdpp_synth <out.tdpp> [points] [--setup]
//! `--setup` adds one setup with a pose and a 6-face panorama of dummy
//! 2-level blobs (for parser tests; the blobs are not real JPEGs).
use scan_cook::lod::{self, LodParams};
use scan_cook::node::{self, Cube, EncodeOptions, Grid, NodeKey, Pt};
use scan_cook::writer::Writer;

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let n: usize = a.get(2).and_then(|s| s.parse().ok()).unwrap_or(500_000);
    let mut s = 12345u64;
    let mut rnd = || {
        s = s
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        (s >> 33) as u32
    };
    let size = 1 << 16;
    let pts: Vec<Pt> = (0..n)
        .map(|_| {
            let (x, y) = ((rnd() % size) as i32, (rnd() % size) as i32);
            let z = ((x as f64 * 0.0005).sin() * 8000.0) as i32 + 30000 + (rnd() % 7) as i32;
            Pt {
                g: [x - 32768, y - 32768, z - 32768],
                rgb: [(x >> 8) as u8, (y >> 8) as u8, 128],
                setup: (rnd() % 4) as u8,
                intensity: rnd() as u16,
                n: (rnd() % 65_144) as u16,
            }
        })
        .collect();
    let grid = Grid {
        origin: [500_000.0, 6_600_000.0, 12.0],
        scale: 0.001,
    };
    let root = Cube {
        min: [-32768; 3],
        size: 1 << 16,
    };
    let lp = LodParams {
        capacity: 30_000,
        min_size: 2,
        color_weight: 1.0,
        use_color: true,
    };
    let tree = lod::build(NodeKey::ROOT, root, pts, &grid, &lp);
    let mut w = Writer::create(std::path::Path::new(&a[1])).unwrap();
    let enc = EncodeOptions {
        cluster_size: 256,
        codec_level: 2,
        normals: true,
        intensity16: true,
    };
    let mut v = Vec::new();
    lod::walk(&tree, &mut |t| v.push((t.key, t.cube, t.pts.clone())));
    for (k, c, p) in v {
        if !p.is_empty() {
            w.add_node(node::encode(k, c, &p, &grid, &enc)).unwrap();
        }
    }
    let mut setups = Vec::new();
    if a.iter().any(|x| x == "--setup") {
        let faces: Vec<serde_json::Value> = (0..6)
            .map(|f| {
                let big = w.add_blob(&[f as u8; 64]).unwrap();
                let small = w.add_blob(&[f as u8 + 16; 16]).unwrap();
                serde_json::json!({
                    "face": f,
                    "view": scan_core::model::CUBE_FACES[f].name,
                    "rotation": scan_core::model::CUBE_FACES[f].rotation,
                    "levels": [
                        {"width": 8, "height": 8, "format": "jpg", "offset": big.offset, "size": big.size},
                        {"width": 4, "height": 4, "format": "jpg", "offset": small.offset, "size": small.size},
                    ],
                })
            })
            .collect();
        setups.push(serde_json::json!({
            "index": 0, "name": "Setup A", "label": "Setup A", "guid": "00000000-0000-0000-0000-000000000001",
            "pose": {"rotation": [1.0, 0.0, 0.0, 0.0], "translation": [500_010.0, 6_600_020.0, 13.5]},
            "panorama": {"kind": "cube", "faces": faces},
        }));
    }
    let meta = serde_json::json!({"format": "tdpp", "version": 1, "frame": "synthetic", "grid_scale": 0.001,
                                  "lod": "additive", "cluster_size": 256, "setups": setups});
    let h = w
        .finish(root, &grid, 256, 15, setups.len() as u32, &meta)
        .unwrap();
    eprintln!(
        "{} points, {} nodes, {} bytes",
        h.point_count, h.node_count, h.file_size
    );
}
