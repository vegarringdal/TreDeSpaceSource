//! Print decoded normals for codes given on the command line.
fn main() {
    for c in std::env::args().skip(1) {
        let c: u16 = c.parse().unwrap();
        let n = scan_core::lgsx::apr::normal_from_code(c);
        println!(
            "{c} {}",
            n.map_or("none".to_string(), |v| format!(
                "{:.6} {:.6} {:.6}",
                v[0], v[1], v[2]
            ))
        );
    }
}
