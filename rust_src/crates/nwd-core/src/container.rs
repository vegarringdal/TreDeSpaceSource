//! LcUStream container reader.
//!
//! Navisworks NWD/NWC files are an `LcUStream`: an ASCII signature line,
//! a small fixed header blob (a content hash + flags), then a back-to-back
//! sequence of independently zlib-compressed chunks, terminated by a repeat
//! of the signature line as a footer.
//!
//! ```text
//!   "#LcUStream-V1.1 binary double release C lichunk-008\n"
//!   <header blob: 0x00, ~38-byte hash, flags 00 00 01 00>
//!   <zlib chunk 0> <zlib chunk 1> ... <zlib chunk N-1>
//!   <00 00 00 00 00 00>
//!   "#LcUStream-V1.1 binary double release C lichunk-008\n"   (footer)
//! ```
//!
//! Chunks are packed contiguously: a chunk's payload ends exactly where the
//! zlib `total_in` says, and the next chunk's `78 9c` header follows. We walk
//! them in order; identity (which operator wrote which chunk) is recovered by
//! [`crate::inspect`] from the chunk contents and the schema registry.

use flate2::{Decompress, FlushDecompress, Status};

use crate::error::{Error, Result};

pub const SIGNATURE_PREFIX: &[u8] = b"#LcUStream-V1.1";

/// Largest inflated size accepted for ONE chunk (1.5 GiB). Chunks inflate
/// lazily, one at a time, each into a single buffer — so this is what bounds
/// the allocation (deflate can expand ~1000×: a few MB of crafted or corrupt
/// input would otherwise demand gigabytes, and on wasm32 a larger buffer
/// cannot exist next to the input anyway). Real chunks are far smaller — the
/// geometry stream is cut into 64 KB segments.
pub const MAX_CHUNK_INFLATED: usize = 1536 * 1024 * 1024;

/// One zlib chunk located in the container. The payload is NOT held in
/// memory — inflate it on demand with [`Container::data`]. (Large NWDs
/// inflate to several times the file size; holding every chunk at once
/// OOMs on real models.)
pub struct Chunk {
    /// Byte offset of the zlib header in the source file.
    pub offset: usize,
    /// Bytes consumed by inflate (the compressed length).
    pub compressed_len: usize,
    /// Decompressed payload length.
    pub inflated_len: usize,
}

/// A parsed container: the header line, the raw header blob, and the chunk
/// index. Borrows the source bytes so chunks can be inflated lazily.
pub struct Container<'a> {
    /// The signature line, e.g. `#LcUStream-V1.1 binary double release C lichunk-008`.
    pub signature: String,
    /// Raw bytes between the signature line and the first zlib chunk
    /// (a leading `0x00`, a content hash, and flag bytes — not yet decoded).
    pub header_blob: Vec<u8>,
    /// Offset of the first zlib chunk.
    pub body_offset: usize,
    pub chunks: Vec<Chunk>,
    bytes: &'a [u8],
}

impl<'a> Container<'a> {
    /// Inflate chunk `i`'s payload (straight into a buffer of its known
    /// inflated size — no intermediate copy, no growth).
    pub fn data(&self, i: usize) -> Vec<u8> {
        let ch = &self.chunks[i];
        let end = (ch.offset + ch.compressed_len).min(self.bytes.len());
        let mut out = Vec::with_capacity(ch.inflated_len);
        let mut dec = Decompress::new(true);
        match dec.decompress_vec(
            &self.bytes[ch.offset..end],
            &mut out,
            FlushDecompress::Finish,
        ) {
            Ok(Status::StreamEnd) if out.len() == ch.inflated_len => out,
            // Anything unexpected: the tolerant streaming path.
            _ => try_inflate(&self.bytes[ch.offset..])
                .map(|(_, d)| d)
                .unwrap_or_default(),
        }
    }

    /// The first `n` bytes of chunk `i`'s payload (fewer if it is shorter) —
    /// inflates only as far as needed. For header sniffing on large chunks.
    pub fn head(&self, i: usize, n: usize) -> Vec<u8> {
        let ch = &self.chunks[i];
        let mut out = Vec::with_capacity(n.min(ch.inflated_len));
        let mut dec = Decompress::new(true);
        let _ = dec.decompress_vec(&self.bytes[ch.offset..], &mut out, FlushDecompress::None);
        out
    }

    /// Parse a whole NWD/NWC byte buffer.
    pub fn parse(bytes: &'a [u8]) -> Result<Container<'a>> {
        if !bytes.starts_with(b"#") {
            return Err(Error::BadSignature(ascii_head(bytes, 32).to_string()));
        }
        // Signature line runs to the first newline.
        let nl = bytes
            .iter()
            .position(|&b| b == b'\n')
            .ok_or_else(|| Error::BadSignature("no newline after signature".into()))?;
        let signature = String::from_utf8_lossy(&bytes[..nl]).trim().to_string();
        if !signature.as_bytes().starts_with(SIGNATURE_PREFIX) {
            return Err(Error::BadSignature(signature));
        }

        // Find the first zlib chunk after the signature line.
        let body_offset = find_zlib(bytes, nl + 1).ok_or_else(|| {
            Error::Decode("no zlib chunk found after header (encrypted NWD?)".into())
        })?;
        let header_blob = bytes[nl + 1..body_offset].to_vec();

        let mut chunks = Vec::new();
        let mut i = body_offset;
        // Chunks are back-to-back in RVM-loader files, but other writers (DWG
        // loader, LightWorks-era exports, the older lichunk-007 revision)
        // interleave metadata/pre-header bytes between the compressed streams —
        // so SCAN forward for the next candidate zlib header and let
        // `try_inflate` validate it (a false positive fails to inflate and the
        // scan continues). Stop at the footer signature line.
        while i + 2 <= bytes.len() {
            let Some(cand) = find_zlib(bytes, i) else {
                break;
            };
            // Stop if the footer signature appears before the next candidate.
            if bytes[i..cand]
                .windows(SIGNATURE_PREFIX.len())
                .any(|w| w == SIGNATURE_PREFIX)
            {
                break;
            }
            let probe = inflate_probe(&bytes[cand..]).map_err(|_| {
                Error::Inflate(format!(
                    "chunk at 0x{cand:x} inflates past the {} MiB limit",
                    MAX_CHUNK_INFLATED >> 20
                ))
            })?;
            match probe {
                Some((consumed, inflated_len)) if inflated_len > 0 => {
                    chunks.push(Chunk {
                        offset: cand,
                        compressed_len: consumed,
                        inflated_len,
                    });
                    i = cand + consumed.max(1);
                }
                _ => i = cand + 1, // false positive; keep scanning
            }
        }

        Ok(Container {
            signature,
            header_blob,
            body_offset,
            chunks,
            bytes,
        })
    }
}

fn ascii_head(bytes: &[u8], n: usize) -> std::borrow::Cow<'_, str> {
    String::from_utf8_lossy(&bytes[..bytes.len().min(n)])
}

/// A zlib header is CMF=0x78 followed by FLG so that (CMF<<8|FLG) % 31 == 0.
fn is_zlib_header(bytes: &[u8], i: usize) -> bool {
    if i + 1 >= bytes.len() {
        return false;
    }
    let cmf = bytes[i];
    let flg = bytes[i + 1];
    cmf == 0x78 && (((cmf as u16) << 8) | flg as u16) % 31 == 0
}

/// Scan forward from `start` for the next valid zlib header.
fn find_zlib(bytes: &[u8], start: usize) -> Option<usize> {
    (start..bytes.len().saturating_sub(1)).find(|&i| is_zlib_header(bytes, i))
}

/// The stream inflates past [`MAX_CHUNK_INFLATED`].
struct TooLarge;

/// Like [`try_inflate`], but discards the output — returns
/// (bytes_consumed, inflated_len) using O(64 KiB) memory. Used by the
/// container walk so indexing a large file never holds inflated payloads.
/// `Ok(None)` = not a zlib stream (a false-positive header); `Err` = a real
/// stream that is too large to accept.
fn inflate_probe(input: &[u8]) -> std::result::Result<Option<(usize, usize)>, TooLarge> {
    let mut dec = Decompress::new(true);
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let in_before = dec.total_in();
        let consumed = in_before as usize;
        if consumed > input.len() {
            return Ok(None);
        }
        let out_before = dec.total_out();
        let Ok(status) = dec.decompress(&input[consumed..], &mut buf, FlushDecompress::None) else {
            return Ok(None);
        };
        if dec.total_out() > MAX_CHUNK_INFLATED as u64 {
            return Err(TooLarge);
        }
        match status {
            Status::StreamEnd => {
                return Ok(Some((dec.total_in() as usize, dec.total_out() as usize)))
            }
            Status::Ok | Status::BufError => {
                if dec.total_in() == in_before && dec.total_out() == out_before {
                    return Ok(None);
                }
            }
        }
    }
}

/// Streaming zlib inflate from the start of `input`. Returns
/// (bytes_consumed, decompressed) on a clean StreamEnd.
fn try_inflate(input: &[u8]) -> Option<(usize, Vec<u8>)> {
    let mut dec = Decompress::new(true);
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
        if dec.total_out() > MAX_CHUNK_INFLATED as u64 {
            return None;
        }
        let produced = (dec.total_out() as usize) - out.len();
        out.extend_from_slice(&buf[..produced]);
        match status {
            Status::StreamEnd => return Some((dec.total_in() as usize, out)),
            Status::Ok | Status::BufError => {
                if dec.total_in() == in_before && produced == 0 {
                    return None;
                }
            }
        }
    }
}
