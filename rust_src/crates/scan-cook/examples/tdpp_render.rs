//! Render a .tdpp's coarse LOD through a setup's cube-face camera (PPM) and
//! extract that face's panorama JPEG from the same file — a visual check of
//! points, poses and embedded panoramas together.
//! usage: tdpp_render <file.tdpp> <setup> <face> <max_depth> <out_prefix>
use scan_cook::reader::Tdpp;
use scan_core::model::{Pose, CUBE_FACES};
use scan_core::source::open_file;

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let t = Tdpp::open(open_file(&a[1]).unwrap()).unwrap();
    let (si, fi, max_depth): (usize, usize, u8) = (
        a[2].parse().unwrap(),
        a[3].parse().unwrap(),
        a[4].parse().unwrap(),
    );
    let setup = &t.meta["setups"][si];
    let r = setup["pose"]["rotation"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_f64().unwrap())
        .collect::<Vec<_>>();
    let tr = setup["pose"]["translation"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_f64().unwrap())
        .collect::<Vec<_>>();
    let pose = Pose {
        rotation: [r[0], r[1], r[2], r[3]],
        translation: [tr[0], tr[1], tr[2]],
    };
    let cam = pose.compose(&CUBE_FACES[fi].pose()).inverse(); // world → camera
    let w = 512usize;
    let mut img = vec![255u8; w * w * 3];
    let mut zb = vec![f32::INFINITY; w * w];
    let o = t.header.origin;
    let mut drawn = 0u64;
    for i in 0..t.nodes.len() {
        if t.nodes[i].depth > max_depth || t.nodes[i].point_count == 0 {
            continue;
        }
        let d = t.decode(i).unwrap();
        for (k, p) in d.positions.iter().enumerate() {
            let c = cam.apply([p[0] + o[0], p[1] + o[1], p[2] + o[2]]);
            let z = -c[2];
            if z < 0.3 {
                continue;
            }
            let u = (c[0] / z * 0.5 + 0.5) * w as f64;
            let v = (0.5 - c[1] / z * 0.5) * w as f64;
            if u < 0.0 || v < 0.0 || u >= w as f64 || v >= w as f64 {
                continue;
            }
            let idx = v as usize * w + u as usize;
            if (z as f32) < zb[idx] {
                zb[idx] = z as f32;
                img[3 * idx..3 * idx + 3].copy_from_slice(&d.rgb[k]);
                drawn += 1;
            }
        }
    }
    let mut ppm = format!("P6\n{w} {w}\n255\n").into_bytes();
    ppm.extend_from_slice(&img);
    std::fs::write(format!("{}_render.ppm", a[5]), ppm).unwrap();
    let face = &setup["panorama"]["faces"][fi]["levels"][0];
    let jpg = t
        .read_blob(
            face["offset"].as_u64().unwrap(),
            face["size"].as_u64().unwrap(),
        )
        .unwrap();
    std::fs::write(format!("{}_photo.jpg", a[5]), jpg).unwrap();
    eprintln!("setup {} face {fi}: {drawn} pixels written", setup["name"]);
}
