//! Write one inflated chunk to a file (no need to dump all ~800 MB of a big model).
//!
//!     cargo run --release --example chunk_dump -- file.nwd <chunk index> out.bin
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let bytes = std::fs::read(&a[1]).unwrap();
    let c = nwd_core::Container::parse(&bytes).unwrap();
    let i: usize = a[2].parse().unwrap();
    std::fs::write(&a[3], c.data(i)).unwrap();
}
