//! Quick E57 probe: CRC byte order on page 0, first points, decode speed.
use scan_core::e57::{paged::crc32c, E57};
use scan_core::source::open_file;
fn main() {
    let path = std::env::args().nth(1).expect("path");
    let limit: u64 = std::env::args()
        .nth(2)
        .map(|s| s.parse().unwrap())
        .unwrap_or(5_000_000);
    let src = open_file(&path).unwrap();
    let mut pg = vec![0u8; 1024];
    src.read_at(0, &mut pg).unwrap();
    let c = crc32c(&pg[..1020]);
    println!(
        "page0 crc be={:08x?} le={:08x?} stored={:02x?}",
        c.to_be_bytes(),
        c.to_le_bytes(),
        &pg[1020..]
    );
    let e = E57::open_with(src, true).unwrap();
    let t = std::time::Instant::now();
    let mut r = e.points(0, false).unwrap();
    let mut n = 0u64;
    let mut first = true;
    while let Some(b) = r.next_batch().unwrap() {
        if first {
            for i in 0..5 {
                println!(
                    "{:?} rgb={:?} i={:?}",
                    b.positions[i],
                    b.colors.as_ref().map(|c| c[i]),
                    b.intensity.as_ref().map(|c| c[i])
                );
            }
            first = false;
        }
        n += b.len() as u64;
        if n >= limit {
            break;
        }
    }
    let dt = t.elapsed().as_secs_f64();
    println!("{n} points in {dt:.2}s = {:.1} Mpts/s", n as f64 / dt / 1e6);
}
