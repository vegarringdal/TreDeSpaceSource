//! LGSX cube-map sections (`SETUP-camera-N`, `-scanintensity-`, `-scandepth-`,
//! `-depthmask-`):
//!
//! ```text
//! "CUBE" | face 0 … face 5 | property blocks | u64 table[8]   (last 64 bytes)
//! table = [face0_start (= 4), face1 … face5 start, faces_end, meta_offset]
//! face  = a full mip chain of encoded images, largest first
//!         (camera / intensity: JPEG 3072² → 1²; depth mask: PNG;
//!          scan depth: JPEG XR)
//! ```

use serde::Serialize;

use crate::error::{fmt_err, Result};
use crate::model::ImageFormat;

pub const MAGIC: &[u8; 4] = b"CUBE";

/// One encoded image inside a section (offsets relative to the section).
#[derive(Clone, Copy, Debug, Serialize)]
pub struct ImageSpan {
    pub offset: u64,
    pub len: u64,
    pub format: ImageFormat,
    pub width: u32,
    pub height: u32,
}

/// The six faces, each a mip chain (largest first).
#[derive(Clone, Debug, Serialize)]
pub struct Cube {
    pub faces: Vec<Vec<ImageSpan>>,
}

/// Parse the face table and split each face into its mip images.
pub fn parse(b: &[u8]) -> Result<Cube> {
    if b.len() < 4 + 64 || &b[..4] != MAGIC {
        return fmt_err("not a CUBE section");
    }
    let t: Vec<u64> = (0..8)
        .map(|i| {
            u64::from_le_bytes(
                b[b.len() - 64 + 8 * i..b.len() - 56 + 8 * i]
                    .try_into()
                    .unwrap(),
            )
        })
        .collect();
    if t[0] != 4 || t.windows(2).take(6).any(|w| w[1] <= w[0]) || t[6] > b.len() as u64 {
        return fmt_err("CUBE face table is not monotonic");
    }
    let mut faces = Vec::with_capacity(6);
    for f in 0..6 {
        let (s, e) = (t[f] as usize, t[f + 1] as usize);
        faces.push(split_chain(&b[s..e], s as u64));
    }
    Ok(Cube { faces })
}

/// Split a run of concatenated images.
pub fn split_chain(b: &[u8], base: u64) -> Vec<ImageSpan> {
    let mut out = Vec::new();
    let mut p = 0usize;
    while p + 8 <= b.len() {
        let Some(format) = ImageFormat::sniff(&b[p..]) else {
            break;
        };
        let (len, w, h) = match format {
            ImageFormat::Jpeg => jpeg_extent(&b[p..]),
            ImageFormat::Png => png_extent(&b[p..]),
            ImageFormat::JpegXr => jxr_extent(&b[p..]),
        };
        if len == 0 {
            break;
        }
        out.push(ImageSpan {
            offset: base + p as u64,
            len: len as u64,
            format,
            width: w,
            height: h,
        });
        p += len;
    }
    out
}

/// Byte length and size of a baseline/progressive JPEG (walks the markers and
/// the entropy-coded segments up to EOI).
pub fn jpeg_extent(b: &[u8]) -> (usize, u32, u32) {
    let (mut w, mut h) = (0u32, 0u32);
    let mut p = 2usize;
    while p + 4 <= b.len() {
        if b[p] != 0xFF {
            return (0, w, h);
        }
        let m = b[p + 1];
        match m {
            0xD9 => return (p + 2, w, h),
            0xFF => {
                p += 1;
                continue;
            }
            0xD0..=0xD7 | 0x01 => {
                p += 2;
                continue;
            }
            _ => {}
        }
        let seg = u16::from_be_bytes([b[p + 2], b[p + 3]]) as usize;
        if matches!(m, 0xC0..=0xC3 | 0xC5..=0xC7 | 0xC9..=0xCB | 0xCD..=0xCF) && p + 9 <= b.len() {
            h = u16::from_be_bytes([b[p + 5], b[p + 6]]) as u32;
            w = u16::from_be_bytes([b[p + 7], b[p + 8]]) as u32;
        }
        p += 2 + seg;
        if m == 0xDA {
            // entropy-coded data: runs until a marker other than a stuffed
            // 0xFF00 or a restart marker
            while p + 1 < b.len() {
                if b[p] == 0xFF && b[p + 1] != 0x00 && !(0xD0..=0xD7).contains(&b[p + 1]) {
                    break;
                }
                p += 1;
            }
        }
    }
    (0, w, h)
}

/// Byte length and size of a PNG (chunk walk to IEND).
pub fn png_extent(b: &[u8]) -> (usize, u32, u32) {
    let (mut w, mut h) = (0u32, 0u32);
    let mut p = 8usize;
    while p + 12 <= b.len() {
        let len = u32::from_be_bytes(b[p..p + 4].try_into().unwrap()) as usize;
        let ty = &b[p + 4..p + 8];
        if ty == b"IHDR" && p + 16 <= b.len() {
            w = u32::from_be_bytes(b[p + 8..p + 12].try_into().unwrap());
            h = u32::from_be_bytes(b[p + 12..p + 16].try_into().unwrap());
        }
        // checked: a chunk length near 2³² wraps a 32-bit usize and the walk
        // would start over
        let Some(next) = p.checked_add(12).and_then(|q| q.checked_add(len)) else {
            return (0, w, h);
        };
        p = next;
        if ty == b"IEND" {
            return (p.min(b.len()), w, h);
        }
    }
    (0, w, h)
}

/// JPEG XR: the TIFF-style container records the image data offset + byte
/// count (tags 0xBCC0 / 0xBCC1); width/height are tags 0xBC80 / 0xBC81.
pub fn jxr_extent(b: &[u8]) -> (usize, u32, u32) {
    let rd16 = |p: usize| b.get(p..p + 2).map(|s| u16::from_le_bytes([s[0], s[1]]));
    let rd32 = |p: usize| {
        b.get(p..p + 4)
            .map(|s| u32::from_le_bytes(s.try_into().unwrap()))
    };
    let Some(ifd) = rd32(4) else { return (0, 0, 0) };
    let ifd = ifd as usize;
    let Some(n) = rd16(ifd) else { return (0, 0, 0) };
    let (mut w, mut h, mut off, mut cnt) = (0u32, 0u32, 0usize, 0usize);
    for i in 0..n as usize {
        let e = ifd + 2 + 12 * i;
        let (Some(tag), Some(ty), Some(val)) = (rd16(e), rd16(e + 2), rd32(e + 8)) else {
            break;
        };
        let v = if ty == 3 { val & 0xFFFF } else { val };
        match tag {
            0xBC80 => w = v,
            0xBC81 => h = v,
            0xBCC0 => off = v as usize,
            0xBCC1 => cnt = v as usize,
            _ => {}
        }
    }
    let end = off + cnt;
    if off == 0 || end > b.len() {
        return (0, w, h);
    }
    (end, w, h)
}
