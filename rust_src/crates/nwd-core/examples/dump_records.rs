//! Dump decoded geometry-record vertex positions to stdout as JSON lines:
//! {"i":N,"pos":[[x,y,z],...]}
use nwd_core::{geometry, inspect, Container};

fn main() {
    let path = std::env::args().nth(1).unwrap();
    let bytes = std::fs::read(&path).unwrap();
    let container = Container::parse(&bytes).unwrap();
    let geom_index = inspect::geometry_chunks_by_index(&container);
    let segs: Vec<Vec<u8>> = match &geom_index {
        Some((idxs, _)) => idxs.iter().map(|&i| container.data(i)).collect(),
        None => panic!("no geometry index"),
    };
    let buf = geometry::logical_buffer(&segs);
    let records = if container.signature.contains("lichunk-007") {
        geometry::parse_old(&buf, &geom_index.as_ref().unwrap().1).unwrap()
    } else {
        geometry::parse(&buf).unwrap()
    };
    eprintln!("{} records", records.len());
    for (i, r) in records.iter().enumerate() {
        print!("{{\"i\":{},\"variant\":{},\"pos\":[", i, r.variant);
        for (k, p) in r.positions.iter().enumerate() {
            if k > 0 {
                print!(",");
            }
            print!("[{},{},{}]", p[0], p[1], p[2]);
        }
        println!("]}}");
    }
}
