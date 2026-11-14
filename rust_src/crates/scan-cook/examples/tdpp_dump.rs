//! Per-node checksums of a .tdpp (count, Σpos, Σrgb, Σintensity, Σsetup) for
//! cross-checking other decoders (ts/tdpp.ts).
//! usage: tdpp_dump <file.tdpp> <node> [<node> …]
use scan_cook::reader::Tdpp;
use scan_core::source::open_file;

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let t = Tdpp::open(open_file(&a[1]).unwrap()).unwrap();
    for i in a[2..].iter().map(|s| s.parse::<usize>().unwrap()) {
        let d = t.decode(i).unwrap();
        let mut sp = [0f64; 3];
        for p in &d.positions {
            for k in 0..3 {
                sp[k] += p[k];
            }
        }
        let sr: u64 = d
            .rgb
            .iter()
            .map(|c| c[0] as u64 + c[1] as u64 + c[2] as u64)
            .sum();
        let si: u64 = d.intensity.iter().map(|&v| v as u64).sum();
        let ss: u64 = d.setup.iter().map(|&v| v as u64).sum();
        let sn: i64 = d.normals.iter().map(|&n| n as i64).sum();
        println!(
            "{{\"node\":{i},\"count\":{},\"sumPos\":[{:.3},{:.3},{:.3}],\"sumRgb\":{sr},\"sumIntensity\":{si},\"sumSetup\":{ss},\"sumNormal\":{sn}}}",
            d.positions.len(), sp[0], sp[1], sp[2]
        );
    }
}
