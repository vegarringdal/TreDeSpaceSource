//! Golden run of the app's NWD path (`convert_stream_cooked` + the cooker,
//! as `convert_streaming_tdp` calls it), so a converter change can be checked
//! byte for byte and for memory. Prints one line per output file —
//! `<set>/<input stem>/<NNNN-name> <bytes> <fnv64>` — on stdout, and the
//! peak live heap and time per input on stderr. Nothing is written to disk.
//!
//! `cargo run --release -p nwd-wasm --example golden -- <set> [--lines] <file.nwd>...`
//! `… -- --hash-dir <dir>` prints the same lines for a folder of files
//! written by an earlier version of this tool (`<dir>/<set>/<stem>/<file>`).

use std::alloc::{GlobalAlloc, Layout, System};
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering::Relaxed};
use std::time::Instant;

use nwd_core::convert::{convert_stream_cooked, ConvertOptions};
use nwd_wasm::{cook_merged, to_cooker_model};

struct Counting;
static LIVE: AtomicUsize = AtomicUsize::new(0);
static PEAK: AtomicUsize = AtomicUsize::new(0);

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        let p = unsafe { System.alloc(l) };
        if !p.is_null() {
            let now = LIVE.fetch_add(l.size(), Relaxed) + l.size();
            PEAK.fetch_max(now, Relaxed);
        }
        p
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        unsafe { System.dealloc(p, l) };
        LIVE.fetch_sub(l.size(), Relaxed);
    }
}

#[global_allocator]
static A: Counting = Counting;

/// FNV-1a, 64-bit: a stable content hash with no dependency.
fn fnv64(data: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for &b in data {
        h ^= b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

fn run(input: &Path, set: &str, opts: &ConvertOptions) {
    let stem = input.file_stem().unwrap().to_string_lossy().to_string();
    let bytes = std::fs::read(input).unwrap();
    PEAK.store(LIVE.load(Relaxed), Relaxed);
    let t = Instant::now();
    let mut files = 0usize;
    let report = convert_stream_cooked(
        &bytes,
        opts,
        &input.file_name().unwrap().to_string_lossy(),
        &mut |merged, stem| {
            let (full, coarse) = cook_merged(to_cooker_model(merged), false, true)?;
            let mut v = Vec::new();
            if let Some(c) = coarse {
                v.push((format!("{stem}.coarse.tdp"), c));
            }
            v.push((format!("{stem}.tdp"), full));
            Ok(v)
        },
        &mut |name, data| {
            files += 1;
            println!(
                "{set}/{stem}/{files:04}-{name} {} {:016x}",
                data.len(),
                fnv64(data)
            );
            Ok(())
        },
    );
    let peak = PEAK.load(Relaxed) as f64 / (1024.0 * 1024.0);
    match report {
        Ok(r) => eprintln!(
            "{stem}: {files} files, {} triangles, peak {peak:.1} MB, {:.1}s",
            r.triangles,
            t.elapsed().as_secs_f32()
        ),
        Err(e) => {
            eprintln!("{stem}: ERROR {e}");
            println!("{set}/{stem}/ERROR {e}");
        }
    }
}

/// The output lines for files an earlier version wrote to disk.
fn hash_dir(root: &Path) {
    let mut lines = Vec::new();
    for set in std::fs::read_dir(root).unwrap().flatten() {
        if !set.path().is_dir() {
            continue;
        }
        for stem in std::fs::read_dir(set.path()).unwrap().flatten() {
            for f in std::fs::read_dir(stem.path()).unwrap().flatten() {
                let data = std::fs::read(f.path()).unwrap();
                lines.push(format!(
                    "{}/{}/{} {} {:016x}",
                    set.file_name().to_string_lossy(),
                    stem.file_name().to_string_lossy(),
                    f.file_name().to_string_lossy(),
                    data.len(),
                    fnv64(&data)
                ));
            }
        }
    }
    lines.sort();
    for l in lines {
        println!("{l}");
    }
}

fn main() {
    let mut args = std::env::args().skip(1);
    let set = args
        .next()
        .expect("usage: golden <set> [--lines] <file>... | --hash-dir <dir>");
    if set == "--hash-dir" {
        hash_dir(Path::new(&args.next().expect("--hash-dir <dir>")));
        return;
    }
    let mut opts = ConvertOptions::default();
    for a in args {
        if a == "--lines" {
            opts = ConvertOptions {
                include_line: true,
                line_width: 0.01,
                cleanup_precision: 3,
                ..ConvertOptions::default()
            };
            continue;
        }
        run(Path::new(&a), &set, &opts);
    }
}
