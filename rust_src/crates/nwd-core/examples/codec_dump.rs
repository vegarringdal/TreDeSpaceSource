//! codec_dump — dump the connectivity/codec TAIL of each mesh geometry record,
//! to test the Edgebreaker/CLERS hypothesis against live bytes.
//!
//! For each variant-94 mesh record we print: vcount, h4 (=2·triangles, so the
//! expected triangle count T), and the raw tail bytes (everything after the
//! position array, up to the next record's magic). We then run a few
//! Edgebreaker probes on the tail:
//!   - histogram of the CLERS-letter bytes  C=0x43 L=0x4c E=0x45 R=0x52 S=0x53
//!   - count of 0x43 ('C') and the Edgebreaker invariant  #C ?= V-3
//!
//! Usage: cargo run --release --example codec_dump -- <file.nwd> [vcount_filter]

use nwd_core::inspect::{classify_all, ChunkKind};
use nwd_core::{geometry, Container};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let path = &args[1];
    let want: Option<usize> = args.get(2).and_then(|s| s.parse().ok());
    let bytes = std::fs::read(path).unwrap();
    let container = Container::parse(&bytes).unwrap();
    let infos = classify_all(&container);
    let geom_segments: Vec<Vec<u8>> = infos
        .iter()
        .filter(|i| i.kind == ChunkKind::Geometry && i.inflated_len > 4096)
        .map(|i| container.data(i.index))
        .collect();
    let buf = geometry::logical_buffer(&geom_segments);
    let n = buf.len();

    // Find every record magic: word0=100, word2=101, word3=60.
    let rd = |o: usize| -> Option<u32> {
        (o + 4 <= n).then(|| u32::from_le_bytes(buf[o..o + 4].try_into().unwrap()))
    };
    let mut starts: Vec<usize> = Vec::new();
    let mut o = 0usize;
    while o + 24 <= n {
        if rd(o) == Some(100) && rd(o + 8) == Some(101) && rd(o + 12) == Some(60) {
            starts.push(o);
            o += 24;
        } else {
            o += 4;
        }
    }
    starts.push(n); // sentinel for last tail end

    println!("file {path}: {} record magics", starts.len() - 1);
    for w in 0..starts.len() - 1 {
        let o = starts[w];
        let variant = rd(o + 4).unwrap_or(0);
        let h4 = rd(o + 16).unwrap_or(0);
        let h5 = rd(o + 20).unwrap_or(0) as usize;
        if h5 == 0 || h5 % 3 != 0 {
            continue;
        }
        let vcount = h5 / 3;
        if variant != 94 {
            continue;
        }
        if let Some(f) = want {
            if vcount != f {
                continue;
            }
        }
        let pos_end = o + 24 + vcount * 12;
        let tail_end = starts[w + 1];
        if pos_end > tail_end || tail_end > n {
            continue;
        }
        let tail = &buf[pos_end..tail_end];
        let t_tris = h4 / 2; // h4 = 2·triangle count
                             // Per-record TAIL binary dump (env NWD_TAILBIN=<dir>): one .bin per record.
        if let Some(dir) = std::env::var_os("NWD_TAILBIN") {
            let pth = format!("{}/tail_{:x}_v{}.bin", dir.to_string_lossy(), o, vcount);
            let _ = std::fs::write(&pth, tail);
        }
        // Per-record position dump (env NWD_RECDUMP=<dir>): one file per record.
        if let Some(dir) = std::env::var_os("NWD_RECDUMP") {
            use std::io::Write as _;
            let p = format!("{}/rec_{:x}_v{}.txt", dir.to_string_lossy(), o, vcount);
            if let Ok(mut f) = std::fs::File::create(&p) {
                for v in 0..vcount {
                    let q = o + 24 + v * 12;
                    let x = f32::from_le_bytes(buf[q..q + 4].try_into().unwrap());
                    let y = f32::from_le_bytes(buf[q + 4..q + 8].try_into().unwrap());
                    let z = f32::from_le_bytes(buf[q + 8..q + 12].try_into().unwrap());
                    let _ = writeln!(f, "    [{:>2}] {:+.4} {:+.4} {:+.4}", v, x, y, z);
                }
            }
        }
        // Positions (only when a vcount filter pins a single shape class).
        if want.is_some() {
            println!("  POSITIONS (V={}):", vcount);
            for v in 0..vcount {
                let p = o + 24 + v * 12;
                let x = f32::from_le_bytes(buf[p..p + 4].try_into().unwrap());
                let y = f32::from_le_bytes(buf[p + 4..p + 8].try_into().unwrap());
                let z = f32::from_le_bytes(buf[p + 8..p + 12].try_into().unwrap());
                println!("    [{:>2}] {:+.4} {:+.4} {:+.4}", v, x, y, z);
            }
        }
        // CLERS-letter histogram.
        let (mut nc, mut nl, mut ne, mut nr, mut ns) = (0, 0, 0, 0, 0);
        for &b in tail {
            match b {
                0x43 => nc += 1,
                0x4c => nl += 1,
                0x45 => ne += 1,
                0x52 => nr += 1,
                0x53 => ns += 1,
                _ => {}
            }
        }
        println!(
            "\n=== off=0x{:x} V={} T(h4/2)={} tail={}B   #C(0x43)={} (V-3={})  L={} E={} R={} S={}",
            o,
            vcount,
            t_tris,
            tail.len(),
            nc,
            vcount as i64 - 3,
            nl,
            ne,
            nr,
            ns
        );
        // Full tail dump (env NWD_FULLTAIL) for one targeted record.
        if want.is_some() && std::env::var_os("NWD_FULLTAIL").is_some() {
            println!("  FULL TAIL ({} bytes):", tail.len());
            let hx: Vec<String> = tail.iter().map(|b| format!("{:02x}", b)).collect();
            for (ci, chunk) in hx.chunks(32).enumerate() {
                println!("  +{:<4} {}", ci * 32, chunk.join(" "));
            }
            return; // one record only
        }
        // Raw tail hex — head (96B) and tail-end (160B), where the connectivity
        // bit-stream lives (after the big quantised-normal block).
        let head = tail.len().min(96);
        let hh: Vec<String> = tail[..head].iter().map(|b| format!("{:02x}", b)).collect();
        println!("  HEAD:");
        for (i, chunk) in hh.chunks(32).enumerate() {
            println!("  +{:<4} {}", i * 32, chunk.join(" "));
        }
        let tstart = tail.len().saturating_sub(160);
        if tstart > head {
            println!("  END (from +{}):", tstart);
            let te: Vec<String> = tail[tstart..]
                .iter()
                .map(|b| format!("{:02x}", b))
                .collect();
            for (i, chunk) in te.chunks(32).enumerate() {
                println!("  +{:<4} {}", tstart + i * 32, chunk.join(" "));
            }
        }
    }
}
