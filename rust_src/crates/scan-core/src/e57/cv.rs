//! E57 CompressedVector binary sections (ASTM E2807 §9): a 32-byte section
//! header, then data packets whose per-field bytestreams concatenate into one
//! continuous bitstream per prototype field. Only the bitPackCodec exists in
//! practice: integers are stored as `value - minimum` in
//! `ceil(log2(max - min + 1))` bits, LSB first; floats as raw IEEE words.

use super::paged::{LogicalCursor, Paged};
use super::xml::Elem;
use crate::error::{fmt_err, Error, Result};

const SECTION_CV: u8 = 1;
const PACKET_INDEX: u8 = 0;
const PACKET_DATA: u8 = 1;
const PACKET_EMPTY: u8 = 2;

/// How one prototype field is encoded.
#[derive(Clone, Debug)]
pub enum Codec {
    /// Integer in `[min, min + 2^bits)`; `bits == 0` means the constant `min`.
    Int {
        min: i64,
        bits: u32,
    },
    /// ScaledInteger: `(raw) * scale + offset`, raw packed like `Int`.
    Scaled {
        min: i64,
        bits: u32,
        scale: f64,
        offset: f64,
    },
    F32,
    F64,
}

impl Codec {
    fn bits(&self) -> u32 {
        match *self {
            Codec::Int { bits, .. } | Codec::Scaled { bits, .. } => bits,
            Codec::F32 => 32,
            Codec::F64 => 64,
        }
    }
}

#[derive(Clone, Debug)]
pub struct Field {
    pub name: String,
    pub codec: Codec,
    /// Declared minimum/maximum (decoded units), for normalisation.
    pub min: f64,
    pub max: f64,
}

fn bits_for(min: i64, max: i64) -> Result<u32> {
    if max < min {
        return fmt_err(format!("E57 integer field with max {max} < min {min}"));
    }
    let range = (max as i128 - min as i128) as u128;
    Ok(if range == 0 {
        0
    } else {
        128 - range.leading_zeros()
    })
}

/// Flatten a CompressedVector prototype (a Structure of numeric leaves) into
/// its field list, in bytestream order.
pub fn fields_of(prototype: &Elem) -> Result<Vec<Field>> {
    let mut out = Vec::new();
    let Elem::Structure(children) = prototype else {
        return fmt_err("E57 prototype is not a Structure");
    };
    for (name, e) in children {
        let (codec, min, max) = match *e {
            Elem::Integer { min, max, .. } => (
                Codec::Int {
                    min,
                    bits: bits_for(min, max)?,
                },
                min as f64,
                max as f64,
            ),
            Elem::ScaledInteger {
                min,
                max,
                scale,
                offset,
                ..
            } => (
                Codec::Scaled {
                    min,
                    bits: bits_for(min, max)?,
                    scale,
                    offset,
                },
                min as f64 * scale + offset,
                max as f64 * scale + offset,
            ),
            Elem::Float {
                double, min, max, ..
            } => (if double { Codec::F64 } else { Codec::F32 }, min, max),
            _ => {
                return Err(Error::Unsupported(format!(
                    "E57 prototype field {name} of type {} (nested prototypes are not decoded)",
                    e.type_name()
                )))
            }
        };
        if codec.bits() > 64 {
            return Err(Error::Unsupported(format!(
                "E57 field {name} wider than 64 bits"
            )));
        }
        out.push(Field {
            name: name.clone(),
            codec,
            min,
            max,
        });
    }
    Ok(out)
}

/// One field's pending bitstream bytes.
#[derive(Default)]
struct Stream {
    buf: Vec<u8>,
    /// valid bytes in `buf` (the rest is zero padding for wide unaligned loads)
    len: usize,
    bit: u64,
}

const PAD: usize = 16;

impl Stream {
    fn push(&mut self, bytes: &[u8]) {
        self.buf.truncate(self.len);
        self.buf.extend_from_slice(bytes);
        self.len = self.buf.len();
        self.buf.resize(self.len + PAD, 0);
    }
    fn available(&self, bits: u32) -> u64 {
        if bits == 0 {
            return u64::MAX;
        }
        (self.len as u64 * 8 - self.bit) / bits as u64
    }
    fn compact(&mut self) {
        let drop = (self.bit / 8) as usize;
        if drop > 0 {
            self.buf.drain(..drop);
            self.len -= drop;
            self.bit -= drop as u64 * 8;
        }
    }
    #[inline]
    fn take(&mut self, n: u32) -> u64 {
        let byte = (self.bit >> 3) as usize;
        let sh = (self.bit & 7) as u32;
        self.bit += n as u64;
        if n + sh <= 64 {
            let w = u64::from_le_bytes(self.buf[byte..byte + 8].try_into().unwrap());
            let v = w >> sh;
            if n == 64 {
                v
            } else {
                v & ((1u64 << n) - 1)
            }
        } else {
            let w = u128::from_le_bytes(self.buf[byte..byte + 16].try_into().unwrap());
            ((w >> sh) as u64) & if n == 64 { u64::MAX } else { (1u64 << n) - 1 }
        }
    }
}

/// Streaming decoder for one CompressedVector.
pub struct CvReader<'a> {
    cur: LogicalCursor<'a>,
    next_packet: u64,
    section_end: u64,
    fields: Vec<Field>,
    streams: Vec<Stream>,
    remaining: u64,
}

impl<'a> CvReader<'a> {
    /// `file_offset` is the CompressedVector's physical `fileOffset`.
    pub fn new(
        paged: &'a Paged,
        file_offset: u64,
        record_count: u64,
        fields: Vec<Field>,
    ) -> Result<Self> {
        let sec = paged.phys_to_logical(file_offset);
        let mut hdr = [0u8; 32];
        paged.read_logical(sec, &mut hdr)?;
        if hdr[0] != SECTION_CV {
            return fmt_err(format!(
                "E57 CompressedVector section id {} at {file_offset}",
                hdr[0]
            ));
        }
        let section_len = u64::from_le_bytes(hdr[8..16].try_into().unwrap());
        let data_phys = u64::from_le_bytes(hdr[16..24].try_into().unwrap());
        let n = fields.len();
        Ok(CvReader {
            cur: LogicalCursor::new(paged, 8 << 20),
            next_packet: paged.phys_to_logical(data_phys),
            section_end: sec + section_len,
            fields,
            streams: (0..n).map(|_| Stream::default()).collect(),
            remaining: record_count,
        })
    }

    pub fn fields(&self) -> &[Field] {
        &self.fields
    }

    pub fn remaining(&self) -> u64 {
        self.remaining
    }

    fn available(&self) -> u64 {
        self.streams
            .iter()
            .zip(&self.fields)
            .map(|(s, f)| s.available(f.codec.bits()))
            .min()
            .unwrap_or(0)
    }

    /// Read the next data packet into the field streams. `false` at the end
    /// of the section.
    fn read_packet(&mut self) -> Result<bool> {
        loop {
            if self.next_packet + 4 > self.section_end {
                return Ok(false);
            }
            let at = self.next_packet;
            let h = self.cur.get(at, 4)?;
            let (ptype, len) = (h[0], u16::from_le_bytes([h[2], h[3]]) as u64 + 1);
            self.next_packet = at + len;
            match ptype {
                PACKET_DATA => {
                    let pkt = self.cur.get(at, len as usize)?;
                    if pkt.len() < 6 {
                        return fmt_err("E57 data packet shorter than its header");
                    }
                    let count = u16::from_le_bytes([pkt[4], pkt[5]]) as usize;
                    if count != self.streams.len() {
                        return fmt_err(format!(
                            "E57 data packet has {count} bytestreams, prototype has {} fields",
                            self.streams.len()
                        ));
                    }
                    let mut p = 6 + 2 * count;
                    if p > pkt.len() {
                        return fmt_err("E57 data packet: bytestream table overruns packet");
                    }
                    for i in 0..count {
                        let n = u16::from_le_bytes([pkt[6 + 2 * i], pkt[7 + 2 * i]]) as usize;
                        if p + n > pkt.len() {
                            return fmt_err("E57 data packet: bytestream overruns packet");
                        }
                        self.streams[i].push(&pkt[p..p + n]);
                        p += n;
                    }
                    return Ok(true);
                }
                PACKET_INDEX | PACKET_EMPTY => continue,
                t => return fmt_err(format!("E57 packet type {t} at logical {at}")),
            }
        }
    }

    /// Decode up to `max` records into per-field columns (decoded units).
    /// Returns the number of records decoded; 0 at the end.
    pub fn read(&mut self, max: usize, cols: &mut Vec<Vec<f64>>) -> Result<usize> {
        cols.resize_with(self.fields.len(), Vec::new);
        for c in cols.iter_mut() {
            c.clear();
        }
        let want = (max as u64).min(self.remaining);
        let mut done = 0u64;
        while done < want {
            let mut avail = self.available();
            if avail == 0 {
                if !self.read_packet()? {
                    return fmt_err(format!(
                        "E57 CompressedVector ended with {} of its records missing",
                        self.remaining
                    ));
                }
                avail = self.available();
                if avail == 0 {
                    continue;
                }
            }
            let n = avail.min(want - done) as usize;
            for ((s, f), col) in self
                .streams
                .iter_mut()
                .zip(&self.fields)
                .zip(cols.iter_mut())
            {
                decode_into(s, f, n, col);
                s.compact();
            }
            done += n as u64;
            self.remaining -= n as u64;
        }
        Ok(done as usize)
    }
}

// ---------------------------------------------------------------------------
// Random access by record range (parallel decoding)
// ---------------------------------------------------------------------------
//
// Bitpacked fields have a fixed width, so the position of record `r` in a
// field's concatenated bytestream is simply `r · bits`. A table of every
// data packet's per-field byte counts (read from the packet headers alone)
// therefore locates any record range without decoding what precedes it.

/// Where every data packet of a CompressedVector is, and how many bytes of
/// each field it carries.
pub struct PacketTable {
    /// Logical offset of each data packet.
    pub logical: Vec<u64>,
    pub len: Vec<u32>,
    /// `slices[p * nf + f]` = (offset of field `f`'s bytes inside packet `p`, length).
    pub slices: Vec<(u32, u32)>,
    /// `cum[f * (np + 1) + p]` = bytes of field `f` before packet `p`.
    pub cum: Vec<u64>,
    pub fields: usize,
}

impl PacketTable {
    pub fn packets(&self) -> usize {
        self.logical.len()
    }

    /// Flat little-endian form, to hand a walked table to another worker
    /// (walking the packet headers of a big file takes many small reads).
    pub fn to_bytes(&self) -> Vec<u8> {
        let np = self.packets();
        let mut out = Vec::with_capacity(8 + np * (12 + 8 * self.fields) + self.cum.len() * 8);
        out.extend((self.fields as u32).to_le_bytes());
        out.extend((np as u32).to_le_bytes());
        for v in &self.logical {
            out.extend(v.to_le_bytes());
        }
        for v in &self.len {
            out.extend(v.to_le_bytes());
        }
        for (a, b) in &self.slices {
            out.extend(a.to_le_bytes());
            out.extend(b.to_le_bytes());
        }
        for v in &self.cum {
            out.extend(v.to_le_bytes());
        }
        out
    }

    pub fn from_bytes(b: &[u8]) -> Result<PacketTable> {
        let bad = || Error::Format("malformed E57 packet table".into());
        let u32_at = |o: usize| -> Result<u32> {
            Ok(u32::from_le_bytes(
                b.get(o..o + 4).ok_or_else(bad)?.try_into().unwrap(),
            ))
        };
        let u64_at = |o: usize| -> Result<u64> {
            Ok(u64::from_le_bytes(
                b.get(o..o + 8).ok_or_else(bad)?.try_into().unwrap(),
            ))
        };
        let fields = u32_at(0)? as usize;
        let np = u32_at(4)? as usize;
        let n_cum = fields * (np + 1);
        if b.len() != 8 + np * (12 + 8 * fields) + n_cum * 8 {
            return Err(bad());
        }
        let mut at = 8;
        let mut logical = Vec::with_capacity(np);
        for _ in 0..np {
            logical.push(u64_at(at)?);
            at += 8;
        }
        let mut len = Vec::with_capacity(np);
        for _ in 0..np {
            len.push(u32_at(at)?);
            at += 4;
        }
        let mut slices = Vec::with_capacity(np * fields);
        for _ in 0..np * fields {
            slices.push((u32_at(at)?, u32_at(at + 4)?));
            at += 8;
        }
        let mut cum = Vec::with_capacity(n_cum);
        for _ in 0..n_cum {
            cum.push(u64_at(at)?);
            at += 8;
        }
        Ok(PacketTable {
            logical,
            len,
            slices,
            cum,
            fields,
        })
    }
    fn cum(&self, f: usize, p: usize) -> u64 {
        self.cum[f * (self.packets() + 1) + p]
    }
}

/// Walk the packet headers of a CompressedVector (small reads only).
pub fn packet_table(paged: &Paged, file_offset: u64, nfields: usize) -> Result<PacketTable> {
    packet_table_with(paged, file_offset, nfields, &mut |_| {})
}

/// [`packet_table`], reporting how far through the section the walk is
/// (0..=1, about every thousand packets) — on a multi-GB file read through a
/// browser this is a hundred thousand small reads.
pub fn packet_table_with(
    paged: &Paged,
    file_offset: u64,
    nfields: usize,
    progress: &mut dyn FnMut(f64),
) -> Result<PacketTable> {
    let sec = paged.phys_to_logical(file_offset);
    let mut hdr = [0u8; 32];
    paged.read_logical(sec, &mut hdr)?;
    if hdr[0] != SECTION_CV {
        return fmt_err(format!(
            "E57 CompressedVector section id {} at {file_offset}",
            hdr[0]
        ));
    }
    let end = sec + u64::from_le_bytes(hdr[8..16].try_into().unwrap());
    let mut at = paged.phys_to_logical(u64::from_le_bytes(hdr[16..24].try_into().unwrap()));
    let mut t = PacketTable {
        logical: Vec::new(),
        len: Vec::new(),
        slices: Vec::new(),
        cum: Vec::new(),
        fields: nfields,
    };
    let mut lens = vec![0u8; 2 * nfields];
    let mut totals = vec![0u64; nfields];
    let mut per_field: Vec<Vec<u64>> = vec![vec![0]; nfields];
    // a data packet's header and stream lengths in ONE read (they were three)
    let head_len = 6 + 2 * nfields as u64;
    let mut head = vec![0u8; head_len as usize];
    let start = at;
    let mut walked = 0u32;
    while at + 4 <= end {
        let got = head_len.min(end - at) as usize;
        paged.read_logical(at, &mut head[..got])?;
        let h = &head[..got];
        let len = u16::from_le_bytes([h[2], h[3]]) as u64 + 1;
        walked += 1;
        if walked.is_multiple_of(1024) {
            progress((at - start) as f64 / (end - start).max(1) as f64);
        }
        match h[0] {
            PACKET_DATA => {
                if got < head_len as usize {
                    return fmt_err("E57 data packet header runs past the section");
                }
                let count = u16::from_le_bytes([h[4], h[5]]) as usize;
                if count != nfields {
                    return fmt_err(format!(
                        "E57 data packet has {count} bytestreams, prototype has {nfields} fields"
                    ));
                }
                lens.copy_from_slice(&h[6..]);
                let mut off = 6 + 2 * nfields as u32;
                for f in 0..nfields {
                    let n = u16::from_le_bytes([lens[2 * f], lens[2 * f + 1]]) as u32;
                    t.slices.push((off, n));
                    off += n;
                    totals[f] += n as u64;
                    per_field[f].push(totals[f]);
                }
                if off as u64 > len {
                    return fmt_err("E57 data packet: bytestreams overrun the packet");
                }
                t.logical.push(at);
                t.len.push(len as u32);
            }
            PACKET_INDEX | PACKET_EMPTY => {}
            ty => return fmt_err(format!("E57 packet type {ty} at logical {at}")),
        }
        at += len;
    }
    t.cum = per_field.concat();
    Ok(t)
}

fn decode_into(s: &mut Stream, f: &Field, n: usize, col: &mut Vec<f64>) {
    col.reserve(n);
    match f.codec {
        Codec::Int { min, bits } => {
            for _ in 0..n {
                let v = if bits == 0 { 0 } else { s.take(bits) };
                col.push((min as i128 + v as i128) as f64);
            }
        }
        Codec::Scaled {
            min,
            bits,
            scale,
            offset,
        } => {
            for _ in 0..n {
                let v = if bits == 0 { 0 } else { s.take(bits) };
                col.push((min as i128 + v as i128) as f64 * scale + offset);
            }
        }
        Codec::F32 => {
            for _ in 0..n {
                col.push(f32::from_bits(s.take(32) as u32) as f64);
            }
        }
        Codec::F64 => {
            for _ in 0..n {
                col.push(f64::from_bits(s.take(64)));
            }
        }
    }
}

/// Decode records `[r0, r1)` into per-field columns, independently of any
/// other range.
pub fn decode_range(
    paged: &Paged,
    t: &PacketTable,
    fields: &[Field],
    r0: u64,
    r1: u64,
) -> Result<Vec<Vec<f64>>> {
    let n = (r1 - r0) as usize;
    let np = t.packets();
    // byte range per field and the packets covering it
    let mut spans = Vec::with_capacity(fields.len());
    let (mut pmin, mut pmax) = (usize::MAX, 0usize);
    for (fi, f) in fields.iter().enumerate() {
        let bits = f.codec.bits() as u64;
        if bits == 0 {
            spans.push(None);
            continue;
        }
        let (b0, b1) = (r0 * bits / 8, (r1 * bits).div_ceil(8));
        if b1 > t.cum(fi, np) {
            return fmt_err(format!(
                "E57 field {} has fewer bytes than its record count needs",
                f.name
            ));
        }
        // first packet whose cumulative end exceeds b0, last whose start is < b1
        let c = &t.cum[fi * (np + 1)..(fi + 1) * (np + 1)];
        let p0 = c[1..].partition_point(|&v| v <= b0);
        let p1 = c[..np].partition_point(|&v| v < b1);
        pmin = pmin.min(p0);
        pmax = pmax.max(p1);
        spans.push(Some((b0, b1, p0, p1, (r0 * bits) % 8)));
    }
    let mut cols: Vec<Vec<f64>> = vec![Vec::new(); fields.len()];
    let block = if pmin < pmax {
        let lo = t.logical[pmin];
        let hi = t.logical[pmax - 1] + t.len[pmax - 1] as u64;
        Some((lo, paged.read_logical_vec(lo, (hi - lo) as usize)?))
    } else {
        None
    };
    for (fi, f) in fields.iter().enumerate() {
        let mut s = Stream::default();
        if let (Some((b0, b1, p0, p1, bit)), Some((lo, data))) = (spans[fi], block.as_ref()) {
            let mut bytes = Vec::with_capacity((b1 - b0) as usize);
            for p in p0..p1 {
                let (off, len) = t.slices[p * t.fields + fi];
                let start = t.cum(fi, p);
                let a = b0.max(start) - start;
                let b = b1.min(start + len as u64) - start;
                let base = (t.logical[p] - lo) as usize + off as usize;
                bytes.extend_from_slice(&data[base + a as usize..base + b as usize]);
            }
            s.push(&bytes);
            s.bit = bit;
        } else {
            s.push(&[]);
        }
        decode_into(&mut s, f, n, &mut cols[fi]);
    }
    Ok(cols)
}
