//! HSPC octree node files (`.apr`, magic `APRN`, format version 22).
//!
//! ```text
//! 0x00 "APRN"          0x04 u64 file_size      0x0C u32 format_version
//! 0x10 u32 attribute_id (== hspcInfo "attribute-id")
//! 0x14 u64 point_count 0x1C u64 payload_size
//! 0x24 u64 key[3]      (grid coordinates of the node corner)
//! 0x3C f64 scale[3]    0x54 f64 origin[3]
//! 0x6C u32 level       0x70 u64 header_size (= payload offset)
//! 0x78 u64 bbox[6]     (min xyz, max xyz — node-local grid units; loose)
//! 0xA8 u32 attr_count, then per attribute:
//!      u8 dtype | u8 role | u32 0 | u16 name_len | name
//!      dtype: 0 = U8, 1 = U16, 2 = U32, 10 = M96 (3 × u32)
//!      role:  0 = POSITION, 4/5/6 = R/G/B, 8 = INTENSITY, 100 = CUSTOM
//! payload (at header_size):
//!      u8 0x64 | u8 group_count | u64 group_offset × group_count
//!      then one [u64 len | zstd frame] per byte plane, groups back to back
//! ```
//!
//! Each zstd frame inflates to exactly `point_count` bytes: attributes are
//! stored as **byte planes** (plane k holds byte k of every point's value).
//! Groups, in order: the non-colour attributes in table order, then R/G/B as
//! one 3-plane colour group. See [`decode`] for the per-group transforms.

use std::io::Read;

use serde::Serialize;

use crate::error::{fmt_err, Error, Result};
use crate::source::Le;

pub const MAGIC: &[u8; 4] = b"APRN";

pub const DT_U8: u8 = 0;
pub const DT_U16: u8 = 1;
/// Seen on the custom attribute `ColorRgbe32` (HDR colour beside the 8-bit
/// R/G/B, which is what the reader uses).
pub const DT_U32: u8 = 2;
pub const DT_M96: u8 = 10;

pub const ROLE_POSITION: u8 = 0;
pub const ROLE_R: u8 = 4;
pub const ROLE_G: u8 = 5;
pub const ROLE_B: u8 = 6;
pub const ROLE_INTENSITY: u8 = 8;
pub const ROLE_CUSTOM: u8 = 100;

#[derive(Clone, Debug, Serialize)]
pub struct AttrDesc {
    pub dtype: u8,
    pub role: u8,
    pub name: String,
}

impl AttrDesc {
    pub fn width(&self) -> Option<usize> {
        match self.dtype {
            DT_U8 => Some(1),
            DT_U16 => Some(2),
            DT_U32 => Some(4),
            DT_M96 => Some(12),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct AprHeader {
    pub file_size: u64,
    pub format_version: u32,
    pub attribute_id: u32,
    pub point_count: u64,
    pub payload_size: u64,
    pub key: [u64; 3],
    pub scale: [f64; 3],
    pub origin: [f64; 3],
    pub level: u32,
    pub header_size: u64,
    pub bbox: [u64; 6],
    pub attrs: Vec<AttrDesc>,
}

impl AprHeader {
    pub fn parse(b: &[u8]) -> Result<AprHeader> {
        if b.len() < 0xAC || &b[..4] != MAGIC {
            return fmt_err("not an APRN node");
        }
        let mut r = Le::at(b, 4);
        let file_size = r.u64()?;
        let format_version = r.u32()?;
        let attribute_id = r.u32()?;
        let point_count = r.u64()?;
        let payload_size = r.u64()?;
        let key = [r.u64()?, r.u64()?, r.u64()?];
        let scale = [r.f64()?, r.f64()?, r.f64()?];
        let origin = [r.f64()?, r.f64()?, r.f64()?];
        let level = r.u32()?;
        let header_size = r.u64()?;
        let mut bbox = [0u64; 6];
        for v in &mut bbox {
            *v = r.u64()?;
        }
        let n = r.u32()? as usize;
        if n > 64 {
            return fmt_err(format!("APRN with {n} attributes"));
        }
        let mut attrs = Vec::with_capacity(n);
        for _ in 0..n {
            let dtype = r.u8()?;
            let role = r.u8()?;
            r.skip(4)?;
            let len = r.u16()? as usize;
            let name = String::from_utf8_lossy(r.bytes(len)?).into_owned();
            attrs.push(AttrDesc { dtype, role, name });
        }
        if r.pos as u64 != header_size {
            return fmt_err(format!(
                "APRN header ends at {} but header_size is {header_size}",
                r.pos
            ));
        }
        if format_version != 22 {
            return Err(Error::Unsupported(format!(
                "APRN format version {format_version}"
            )));
        }
        Ok(AprHeader {
            file_size,
            format_version,
            attribute_id,
            point_count,
            payload_size,
            key,
            scale,
            origin,
            level,
            header_size,
            bbox,
            attrs,
        })
    }
}

/// What a payload group carries.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub enum GroupKind {
    Position,
    Intensity,
    /// R, G, B as one group (attribute indices in the table).
    Color,
    /// Any other attribute (by table index), e.g. `Normal`, `SetupIndexU8`.
    Custom(usize),
}

/// The group layout implied by an attribute table.
pub fn group_layout(attrs: &[AttrDesc]) -> Result<Vec<(GroupKind, usize)>> {
    let mut groups = Vec::new();
    let mut rgb = 0;
    for (i, a) in attrs.iter().enumerate() {
        let w = a
            .width()
            .ok_or_else(|| Error::Unsupported(format!("APRN dtype {} ({})", a.dtype, a.name)))?;
        match a.role {
            ROLE_R | ROLE_G | ROLE_B if a.dtype == DT_U8 => rgb += 1,
            ROLE_POSITION if a.dtype == DT_M96 => groups.push((GroupKind::Position, w)),
            ROLE_INTENSITY => groups.push((GroupKind::Intensity, w)),
            _ => groups.push((GroupKind::Custom(i), w)),
        }
    }
    match rgb {
        0 => {}
        3 => groups.push((GroupKind::Color, 3)),
        n => return Err(Error::Unsupported(format!("APRN with {n} of R/G/B"))),
    }
    Ok(groups)
}

/// One payload group's byte planes, already inflated.
pub struct Group {
    pub kind: GroupKind,
    pub planes: Vec<Vec<u8>>,
}

/// Most bytes reserved for a plane before any of it is inflated (the size is
/// the header's point count, which nothing has checked yet).
const PLANE_RESERVE: usize = 1 << 22;

fn zstd(frame: &[u8], expect: usize) -> Result<Vec<u8>> {
    let mut out = Vec::with_capacity(expect.min(PLANE_RESERVE));
    let dec = ruzstd::decoding::StreamingDecoder::new(frame)
        .map_err(|e| Error::Format(format!("APRN zstd frame: {e}")))?;
    // one byte past the expected size is enough to tell a frame that
    // inflates to more
    dec.take((expect as u64).saturating_add(1))
        .read_to_end(&mut out)
        .map_err(|e| Error::Format(format!("APRN zstd frame: {e}")))?;
    if out.len() != expect {
        return fmt_err(format!(
            "APRN plane inflated to {} bytes, expected {expect}",
            out.len()
        ));
    }
    Ok(out)
}

/// Split a node file into its header and inflated byte-plane groups.
pub fn decode_planes(b: &[u8]) -> Result<(AprHeader, Vec<Group>)> {
    let h = AprHeader::parse(b)?;
    if h.file_size != b.len() as u64 || h.header_size + h.payload_size != h.file_size {
        return fmt_err("APRN sizes are inconsistent with the file");
    }
    let n = usize::try_from(h.point_count).map_err(|_| Error::Format("APRN point count".into()))?;
    let layout = group_layout(&h.attrs)?;
    let mut r = Le::at(b, h.header_size as usize);
    let tag = r.u8()?;
    let ng = r.u8()? as usize;
    if tag != 0x64 || ng != layout.len() {
        return fmt_err(format!(
            "APRN payload tag {tag:#x} with {ng} groups (expected {})",
            layout.len()
        ));
    }
    let goffs: Vec<u64> = (0..ng).map(|_| r.u64()).collect::<Result<_>>()?;
    let base = r.pos;
    let mut groups = Vec::with_capacity(ng);
    for (gi, (kind, width)) in layout.into_iter().enumerate() {
        if (r.pos - base) as u64 != goffs[gi] {
            return fmt_err(format!(
                "APRN group {gi} at {} but table says {}",
                r.pos - base,
                goffs[gi]
            ));
        }
        let mut planes = Vec::with_capacity(width);
        for _ in 0..width {
            let len = r.u64()? as usize;
            planes.push(zstd(r.bytes(len)?, n)?);
        }
        groups.push(Group { kind, planes });
    }
    if r.remaining() != 0 {
        return fmt_err(format!("APRN has {} trailing payload bytes", r.remaining()));
    }
    Ok((h, groups))
}

// ---------------------------------------------------------------------------
// Value reconstruction
// ---------------------------------------------------------------------------
//
// Validated against the E57 export of the same project (exact match of all
// 4.38 M points of a 40-node sample, every level):
//
// * Storage order is **pair-swapped**: plane byte `i` belongs to point
//   `i ^ 1` (an odd final element stays in place).
// * POSITION: 96-bit little-endian integers (12 planes); in point order they
//   are deltas of the points' sorted 3-D Morton codes (bit 3i = x_i,
//   3i+1 = y_i, 3i+2 = z_i of the 32-bit grid coordinates).
// * INTENSITY, CUSTOM (U8/U16): deltas of the value, modulo 2^(8·width).
// * Colour group: plane 0 = G as u8 deltas; plane 1 = B − G, plane 2 = R − G
//   (mod 256, not delta-coded).

/// Decoded content of one node, in Morton order.
#[derive(Clone, Debug, Default)]
pub struct NodePoints {
    /// Grid coordinates (see [`super::hspc::HspcInfo::to_world`]).
    pub grid: Vec<[u32; 3]>,
    pub rgb: Option<Vec<[u8; 3]>>,
    /// Raw 16-bit intensity (`/ 65535` gives the E57 value).
    pub intensity: Option<Vec<u16>>,
    /// `SetupIndexU8` (index into the hspcInfo SetupLUT).
    pub setup: Option<Vec<u8>>,
    /// `Normal` as stored (16-bit `CodecNormal16PcApi` code); decode with
    /// [`normal_from_code`].
    pub normal_code: Option<Vec<u16>>,
}

impl NodePoints {
    /// Unit normals (project frame, oriented towards the scanner), `None`
    /// for points without one.
    pub fn normals(&self) -> Option<Vec<Option<[f32; 3]>>> {
        self.normal_code
            .as_ref()
            .map(|c| c.iter().map(|&v| normal_from_code(v)).collect())
    }

    pub fn len(&self) -> usize {
        self.grid.len()
    }
    pub fn is_empty(&self) -> bool {
        self.grid.is_empty()
    }
}

#[inline]
fn swap_index(i: usize, n: usize) -> usize {
    let j = i ^ 1;
    if j < n {
        j
    } else {
        i
    }
}

/// Gather bits 0, 3, 6, … (21 of them) of `v`.
#[inline]
fn compact21(mut x: u64) -> u32 {
    x &= 0x1249_2492_4924_9249;
    x = (x ^ (x >> 2)) & 0x10c3_0c30_c30c_30c3;
    x = (x ^ (x >> 4)) & 0x100f_00f0_0f00_f00f;
    x = (x ^ (x >> 8)) & 0x001f_0000_ff00_00ff;
    x = (x ^ (x >> 16)) & 0x001f_0000_0000_ffff;
    x = (x ^ (x >> 32)) & 0x001f_ffff;
    x as u32
}

/// 96-bit Morton code → (x, y, z).
#[inline]
pub fn demorton96(c: u128) -> [u32; 3] {
    let mut out = [0u32; 3];
    for (k, o) in out.iter_mut().enumerate() {
        let lo = compact21((c >> k) as u64 & 0x7FFF_FFFF_FFFF_FFFF);
        let hi = compact21((c >> (63 + k)) as u64);
        *o = lo | (hi << 21);
    }
    out
}

/// Morton-encode grid coordinates (inverse of [`demorton96`]).
pub fn morton96(p: [u32; 3]) -> u128 {
    let mut c = 0u128;
    for i in 0..32 {
        for (k, &v) in p.iter().enumerate() {
            c |= (((v >> i) & 1) as u128) << (3 * i + k);
        }
    }
    c
}

/// Rebuild delta-coded unsigned values of `width` bytes (≤ 8) from planes.
fn undelta(planes: &[Vec<u8>], n: usize) -> Vec<u64> {
    let width = planes.len();
    let mask = if width >= 8 {
        u64::MAX
    } else {
        (1u64 << (8 * width)) - 1
    };
    let mut out = Vec::with_capacity(n);
    let mut acc = 0u64;
    for i in 0..n {
        let j = swap_index(i, n);
        let mut d = 0u64;
        for (k, pl) in planes.iter().enumerate() {
            d |= (pl[j] as u64) << (8 * k);
        }
        acc = acc.wrapping_add(d) & mask;
        out.push(acc);
    }
    out
}

/// Fully decode a node file.
pub fn decode(b: &[u8]) -> Result<(AprHeader, NodePoints)> {
    let (h, groups) = decode_planes(b)?;
    let n = h.point_count as usize;
    let mut out = NodePoints::default();
    for g in &groups {
        match g.kind {
            GroupKind::Position => {
                if g.planes.len() != 12 {
                    return fmt_err("APRN position group is not 12 planes");
                }
                let mut grid = Vec::with_capacity(n);
                let mut acc = 0u128;
                const M96: u128 = (1u128 << 96) - 1;
                for i in 0..n {
                    let j = swap_index(i, n);
                    let mut lo = 0u64;
                    for k in 0..8 {
                        lo |= (g.planes[k][j] as u64) << (8 * k);
                    }
                    let mut hi = 0u32;
                    for k in 0..4 {
                        hi |= (g.planes[8 + k][j] as u32) << (8 * k);
                    }
                    acc = acc.wrapping_add(((hi as u128) << 64) | lo as u128) & M96;
                    grid.push(demorton96(acc));
                }
                out.grid = grid;
            }
            GroupKind::Intensity => {
                if g.planes.len() == 2 {
                    out.intensity = Some(
                        undelta(&g.planes, n)
                            .into_iter()
                            .map(|v| v as u16)
                            .collect(),
                    );
                } else {
                    let v = undelta(&g.planes, n);
                    let max = (1u64 << (8 * g.planes.len())) - 1;
                    out.intensity = Some(v.into_iter().map(|x| (x * 65535 / max) as u16).collect());
                }
            }
            GroupKind::Color => {
                let gch = undelta(&g.planes[..1], n);
                let mut rgb = Vec::with_capacity(n);
                for (i, &gv) in gch.iter().enumerate() {
                    let j = swap_index(i, n);
                    let gv = gv as u8;
                    rgb.push([
                        gv.wrapping_add(g.planes[2][j]),
                        gv,
                        gv.wrapping_add(g.planes[1][j]),
                    ]);
                }
                out.rgb = Some(rgb);
            }
            GroupKind::Custom(ai) => {
                let a = &h.attrs[ai];
                let v = undelta(&g.planes, n);
                match (a.name.as_str(), g.planes.len()) {
                    ("SetupIndexU8", 1) => {
                        out.setup = Some(v.into_iter().map(|x| x as u8).collect())
                    }
                    ("Normal", 2) => {
                        out.normal_code = Some(v.into_iter().map(|x| x as u16).collect())
                    }
                    _ => {} // unknown custom attributes are skipped
                }
            }
        }
    }
    if out.grid.len() != n {
        return fmt_err("APRN node without a POSITION attribute");
    }
    Ok((h, out))
}

// ---------------------------------------------------------------------------
// CodecNormal16PcApi
// ---------------------------------------------------------------------------
//
// Fitted against PCA normals of 3.8 M points (oriented towards each point's
// scanner position): latitude rings of constant polar spacing.
//   ring k = 0..=226, polar angle θ_k = k·π/226 (θ from +Z, z up)
//   ring size  s_k = max(1, ⌈452·sin θ_k⌉)     → 65 144 codes in total
//   code = Σ_{i<k} s_i + j,  φ = −π + (j + ½)·2π/s_k
//   n = (sin θ cos φ, sin θ sin φ, cos θ); 65535 (and any code ≥ 65 144) = none
// Median deviation from the PCA normals is at their noise level (2.4–3.5°),
// signed azimuth bias < 0.25 of a ring step; quantization ≤ ~0.4°.

pub const NORMAL_RINGS: usize = 227;
pub const NORMAL_CODES: usize = 65_144;

fn normal_rings() -> &'static ([u32; NORMAL_RINGS + 1], [u32; NORMAL_RINGS]) {
    static T: std::sync::OnceLock<([u32; NORMAL_RINGS + 1], [u32; NORMAL_RINGS])> =
        std::sync::OnceLock::new();
    T.get_or_init(|| {
        let mut start = [0u32; NORMAL_RINGS + 1];
        let mut size = [0u32; NORMAL_RINGS];
        for k in 0..NORMAL_RINGS {
            let th = k as f64 * std::f64::consts::PI / 226.0;
            size[k] = ((452.0 * th.sin() - 1e-9).ceil() as u32).max(1);
            start[k + 1] = start[k] + size[k];
        }
        (start, size)
    })
}

/// Decode a `CodecNormal16PcApi` code to a unit normal.
pub fn normal_from_code(code: u16) -> Option<[f32; 3]> {
    let (start, size) = normal_rings();
    let c = code as u32;
    if c >= start[NORMAL_RINGS] {
        return None;
    }
    let k = start.partition_point(|&s| s <= c) - 1;
    let j = (c - start[k]) as f64;
    let th = k as f64 * std::f64::consts::PI / 226.0;
    let ph = -std::f64::consts::PI + (j + 0.5) * std::f64::consts::TAU / size[k] as f64;
    Some([
        (th.sin() * ph.cos()) as f32,
        (th.sin() * ph.sin()) as f32,
        th.cos() as f32,
    ])
}

/// Encode a unit vector to the nearest `CodecNormal16PcApi` code (inverse
/// of [`normal_from_code`]).
pub fn normal_to_code(v: [f32; 3]) -> u16 {
    let (start, size) = normal_rings();
    let l = ((v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) as f64).sqrt();
    if l <= 0.0 {
        return u16::MAX;
    }
    let th = ((v[2] as f64 / l).clamp(-1.0, 1.0)).acos();
    let k = ((th / (std::f64::consts::PI / 226.0)).round() as usize).min(NORMAL_RINGS - 1);
    let ph = (v[1] as f64).atan2(v[0] as f64);
    let j = (((ph + std::f64::consts::PI) / std::f64::consts::TAU * size[k] as f64).floor() as u32)
        .min(size[k] - 1);
    (start[k] + j) as u16
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normal_codec_roundtrip() {
        for c in (0..NORMAL_CODES as u32).step_by(7) {
            let v = normal_from_code(c as u16).unwrap();
            assert_eq!(normal_to_code(v), c as u16, "code {c}");
        }
    }

    #[test]
    fn normal_codec_layout() {
        let (start, size) = normal_rings();
        assert_eq!(start[NORMAL_RINGS] as usize, NORMAL_CODES);
        assert_eq!(&size[..6], &[1, 7, 13, 19, 26, 32]);
        assert_eq!(&size[NORMAL_RINGS - 4..], &[19, 13, 7, 1]);
        assert_eq!(normal_from_code(0), Some([0.0, 0.0, 1.0]));
        assert_eq!(normal_from_code(65535), None);
        let s = normal_from_code((NORMAL_CODES - 1) as u16).unwrap();
        assert!((s[2] + 1.0).abs() < 1e-6);
        // equator ring: horizontal, unit length
        let e = normal_from_code(32_600).unwrap();
        assert!(
            e[2].abs() < 0.02 && ((e[0] * e[0] + e[1] * e[1] + e[2] * e[2]) - 1.0).abs() < 1e-5
        );
    }

    #[test]
    fn morton_roundtrip() {
        for p in [
            [0u32, 0, 0],
            [1, 2, 3],
            [0x8002_1209, 0x8001_fe00, 0x8001_8e01],
            [u32::MAX, 0, u32::MAX],
        ] {
            assert_eq!(demorton96(morton96(p)), p);
        }
        // high byte of a code near the 2^31 root offset is 0xE0
        assert_eq!((morton96([1 << 31, 1 << 31, 1 << 31]) >> 88) as u8, 0xE0);
    }

    #[test]
    fn pair_swap() {
        assert_eq!(
            (0..5).map(|i| swap_index(i, 5)).collect::<Vec<_>>(),
            vec![1, 0, 3, 2, 4]
        );
        assert_eq!(
            (0..4).map(|i| swap_index(i, 4)).collect::<Vec<_>>(),
            vec![1, 0, 3, 2]
        );
    }
}
