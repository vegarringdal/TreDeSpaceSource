//! nwd-dissect — empirical dissector for Navisworks NWD/NWC/NWF files.
//!
//! There is no public spec for these formats. The container is a custom,
//! ZIP-like layout (header + directory + independently zlib-compressed
//! streams). This tool deliberately ignores the directory we don't yet
//! understand and instead *scans* the raw bytes for valid zlib stream
//! headers, inflates each one, and reports what it found. That gives you
//! a ground-truth view of the streams (logical scene graph, spatial
//! hierarchy, geometry chunks, properties, metadata, ...) so you can start
//! mapping the directory format from the other direction.
//!
//! Usage:
//!   nwd-dissect <file.nwd|nwc|nwf>            # report streams
//!   nwd-dissect <file> --dump <out_dir>      # also write each stream to disk
//!
//! Build: `cargo run --release -- yourfile.nwc --dump ./streams`

use std::env;
use std::fs;
use std::path::Path;
use std::process;

use flate2::{Decompress, FlushDecompress, Status};

/// A successfully inflated stream located in the file.
struct FoundStream {
    offset: usize,       // byte offset of the zlib header in the source file
    compressed_len: u64, // bytes consumed by the inflate (total_in)
    data: Vec<u8>,       // decompressed bytes
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        eprintln!("usage: {} <file> [--dump <out_dir>]", args[0]);
        process::exit(2);
    }

    let path = &args[1];
    let mut dump_dir: Option<String> = None;
    let mut i = 2;
    while i < args.len() {
        match args[i].as_str() {
            "--dump" => {
                dump_dir = args.get(i + 1).cloned();
                if dump_dir.is_none() {
                    eprintln!("--dump requires an output directory");
                    process::exit(2);
                }
                i += 2;
            }
            other => {
                eprintln!("unknown argument: {other}");
                process::exit(2);
            }
        }
    }

    let bytes = match fs::read(path) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("failed to read {path}: {e}");
            process::exit(1);
        }
    };

    println!("file: {path}");
    println!("size: {} bytes\n", bytes.len());
    print_header_preview(&bytes);

    let streams = scan_zlib_streams(&bytes);

    if streams.is_empty() {
        println!("\nNo inflatable zlib streams found.");
        println!("The header preview above may still reveal the version/flags.");
        println!("If this is a password-protected NWD, the streams may be encrypted.");
        return;
    }

    println!("\nfound {} zlib stream(s):\n", streams.len());
    println!(
        "{:>10}  {:>12}  {:>12}  {:>5}  preview",
        "offset", "compressed", "inflated", "ratio"
    );
    println!("{}", "-".repeat(72));

    for s in &streams {
        let ratio = if s.compressed_len > 0 {
            s.data.len() as f64 / s.compressed_len as f64
        } else {
            0.0
        };
        println!(
            "{:>10}  {:>12}  {:>12}  {:>5.1}  {}",
            format!("0x{:x}", s.offset),
            s.compressed_len,
            s.data.len(),
            ratio,
            ascii_preview(&s.data, 32),
        );
    }

    if let Some(dir) = dump_dir {
        if let Err(e) = fs::create_dir_all(&dir) {
            eprintln!("\nfailed to create {dir}: {e}");
            process::exit(1);
        }
        for s in &streams {
            let out = Path::new(&dir).join(format!("stream_0x{:08x}.bin", s.offset));
            if let Err(e) = fs::write(&out, &s.data) {
                eprintln!("failed to write {}: {e}", out.display());
            }
        }
        println!("\ndumped {} stream(s) to {dir}/", streams.len());
    }
}

/// Print the first bytes of the file as hex + ascii. Navisworks files begin
/// with a text-ish signature/version line; seeing it verbatim beats guessing.
fn print_header_preview(bytes: &[u8]) {
    let n = bytes.len().min(64);
    println!("header (first {n} bytes):");
    for chunk in bytes[..n].chunks(16) {
        let hex: Vec<String> = chunk.iter().map(|b| format!("{b:02x}")).collect();
        let ascii: String = chunk
            .iter()
            .map(|&b| {
                if (0x20..0x7f).contains(&b) {
                    b as char
                } else {
                    '.'
                }
            })
            .collect();
        println!("  {:<48}  {}", hex.join(" "), ascii);
    }
}

/// Scan for zlib streams. A zlib header is CMF=0x78 (deflate, 32K window)
/// followed by FLG such that (CMF<<8 | FLG) is a multiple of 31. We try to
/// inflate at each candidate; on success we skip past the consumed bytes so
/// we don't re-report the interior of a stream.
fn scan_zlib_streams(bytes: &[u8]) -> Vec<FoundStream> {
    let mut found = Vec::new();
    let mut i = 0usize;

    while i + 1 < bytes.len() {
        let cmf = bytes[i];
        let flg = bytes[i + 1];
        let valid_header = cmf == 0x78 && (((cmf as u16) << 8) | flg as u16) % 31 == 0;

        if valid_header {
            if let Some((consumed, data)) = try_inflate(&bytes[i..]) {
                // Require a non-trivial result so we skip false positives.
                if data.len() >= 16 {
                    let offset = i;
                    i += consumed.max(1) as usize;
                    found.push(FoundStream {
                        offset,
                        compressed_len: consumed,
                        data,
                    });
                    continue;
                }
            }
        }
        i += 1;
    }

    found
}

/// Attempt a streaming zlib inflate from the start of `input`.
/// Returns (bytes_consumed, decompressed_data) on a clean StreamEnd.
fn try_inflate(input: &[u8]) -> Option<(u64, Vec<u8>)> {
    let mut dec = Decompress::new(true); // true = expect zlib header
    let mut out = Vec::new();
    let mut buf = vec![0u8; 64 * 1024];

    loop {
        let in_before = dec.total_in();
        let consumed = in_before as usize;
        if consumed > input.len() {
            return None;
        }
        let status = dec
            .decompress(&input[consumed..], &mut buf, FlushDecompress::None)
            .ok()?;

        let produced = (dec.total_out() as usize) - out.len();
        out.extend_from_slice(&buf[..produced]);

        match status {
            Status::StreamEnd => return Some((dec.total_in(), out)),
            Status::Ok | Status::BufError => {
                // No forward progress on both ends => give up.
                if dec.total_in() == in_before && produced == 0 {
                    return None;
                }
            }
        }
    }
}

/// A short printable preview of a buffer, for guessing stream contents.
fn ascii_preview(data: &[u8], n: usize) -> String {
    data.iter()
        .take(n)
        .map(|&b| {
            if (0x20..0x7f).contains(&b) {
                b as char
            } else {
                '.'
            }
        })
        .collect()
}
