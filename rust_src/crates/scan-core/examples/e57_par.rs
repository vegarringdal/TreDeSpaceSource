//! Compare sequential vs parallel E57 decoding: order-independent hash of
//! every point (exact f64 bits + rgb + intensity) and throughput.
use scan_core::e57::E57;
use scan_core::source::open_file;
use scan_core::PointBatch;

fn mix(mut x: u64) -> u64 {
    x = x.wrapping_add(0x9E37_79B9_7F4A_7C15);
    x = (x ^ (x >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    x = (x ^ (x >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    x ^ (x >> 31)
}
fn hash(b: &PointBatch) -> u64 {
    let mut h = 0u64;
    for i in 0..b.len() {
        let p = b.positions[i];
        let c = b.colors.as_ref().map_or([0; 3], |c| c[i]);
        let it = b.intensity.as_ref().map_or(0.0, |v| v[i]);
        let v = mix(p[0].to_bits())
            ^ mix(p[1].to_bits().rotate_left(1))
            ^ mix(p[2].to_bits().rotate_left(2))
            ^ mix(((c[0] as u64) << 16 | (c[1] as u64) << 8 | c[2] as u64)
                ^ ((it.to_bits() as u64) << 24));
        h = h.wrapping_add(mix(v));
    }
    h
}
fn main() {
    let path = std::env::args().nth(1).unwrap();
    let threads: usize = std::env::args()
        .nth(2)
        .map(|s| s.parse().unwrap())
        .unwrap_or(4);
    let e = E57::open(open_file(&path).unwrap()).unwrap();
    for t in [1, threads, threads] {
        let t0 = std::time::Instant::now();
        let (mut n, mut h) = (0u64, 0u64);
        e.for_each_batch(0, true, t, |b| {
            n += b.len() as u64;
            h = h.wrapping_add(hash(&b));
            Ok(())
        })
        .unwrap();
        let dt = t0.elapsed().as_secs_f64();
        println!(
            "threads {t}: {n} points hash {h:016x} in {dt:.1}s = {:.1} Mpts/s",
            n as f64 / dt / 1e6
        );
    }
}
