//! Dump positions (f32, project frame) + raw normal codes of some LGSX nodes
//! for the normal-codec investigation: <out>/node<i>.bin = n × (3×f32 + u16 code + u16 setup)
use scan_core::lgsx::Lgsx;
use scan_core::source::open_file;
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let l = Lgsx::open(open_file(&a[1]).unwrap()).unwrap();
    for idx in a[3..].iter().map(|s| s.parse::<usize>().unwrap()) {
        let node = &l.nodes[idx];
        let p = l.read_node(node).unwrap();
        let codes = p.normal_code.as_ref().unwrap();
        let mut out = Vec::with_capacity(p.len() * 16);
        for i in 0..p.len() {
            let w = l.info.to_world(p.grid[i]);
            for v in w {
                out.extend_from_slice(&(v as f32).to_le_bytes());
            }
            out.extend_from_slice(&codes[i].to_le_bytes());
            out.extend_from_slice(&(p.setup.as_ref().map_or(0, |s| s[i]) as u16).to_le_bytes());
        }
        std::fs::write(format!("{}/node{idx}.bin", a[2]), out).unwrap();
        eprintln!("node {idx} {:?}: {} points", node.key, p.len());
    }
}
