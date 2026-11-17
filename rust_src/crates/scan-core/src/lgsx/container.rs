//! LGSX outer container ("Leica Project File X").
//!
//! ```text
//! file  := { "wild::geosystems" section-record payload }*  index  trailer
//! index := "HXMETAV1" record*                    (one per section)
//! record:= u16 len | i32 parent | u32 id | u16 nlen | name\0 | u8 kind
//!          | u64 offset | u64 size | u16 hlen | hash (hex SHA-512)\0 | pad
//! trailer (EOF-anchored, last 32 bytes):
//!          "Leica Project File X" | u32 | u64 table_offset
//! table at table_offset: u32 count | u64 record_offset × count
//!          | u16 hlen | hash | u16 vlen | writer version | …
//! ```
//!
//! Each section payload is also preceded in the body by a `wild::geosystems`
//! banner and a header of its own:
//!
//! ```text
//! body  := "wild::geosystems" | u32 hlen | header[hlen] | payload
//! header:= u64 size | i32 parent | u8 kind | u16 nlen | name | u16 hlen | hash
//! ```
//!
//! (no id, name and hash without the NUL), the next banner starting where the
//! payload ends. A file without the trailer is read that way, front to back
//! ([`Container::open`]): the index and the trailer sit at the very end, so a
//! copy or download cut short loses them first while the sections before
//! the cut are whole. Walking every sample yields exactly its index.

use serde::Serialize;

use crate::error::{fmt_err, Error, Result};
use crate::source::{Le, Source, SubSource};

pub const TRAILER_MAGIC: &[u8; 20] = b"Leica Project File X";
pub const SECTION_BANNER: &[u8; 16] = b"wild::geosystems";
/// Most bytes read for the index table (4 + 8 per section, a hash and the
/// writer version: kilobytes in a real file).
const INDEX_TABLE_MAX: u64 = 16 << 20;
/// Most bytes accepted for one section's body header (a name and a hash: a
/// few hundred bytes in a real file).
const BODY_HEADER_MAX: u32 = 64 << 10;

#[derive(Clone, Debug, Serialize)]
pub struct Section {
    pub id: u32,
    pub parent: i32,
    pub name: String,
    /// 1, 2 or 3 — observed: 3 = data blob, 2 = property tree, 1 = image.
    pub kind: u8,
    pub offset: u64,
    pub size: u64,
    pub hash: String,
}

pub struct Container {
    src: Source,
    pub sections: Vec<Section>,
    pub writer_version: Option<String>,
    /// How the sections were found when the file has no trailer (read front
    /// to back, and where the file ends early) — for the import report.
    /// Empty for a complete file.
    pub notes: Vec<String>,
}

/// One step of the front-to-back walk.
enum BodyStep {
    Section(Section),
    /// Bytes that are not a section banner: the index, or the end.
    End,
    /// The file ends inside this section, described for the report.
    Cut(String),
}

fn mb(n: u64) -> String {
    format!("{:.1} MB", n as f64 / (1024.0 * 1024.0))
}

/// Bytes read per step while looking for where a zero-filled tail begins.
const ZERO_SCAN_CHUNK: u64 = 1 << 20;
/// Shortest zero run at the end taken as never written. A shorter one is as
/// likely to be data (a cut through free space in a database page); an
/// interrupted copy leaves megabytes to gigabytes of zeros.
const ZERO_TAIL_MIN: u64 = 64 << 10;

/// Where the written data ends: the length minus the run of zero bytes at
/// the end. A copy or download that sets the file's size before writing
/// (Windows copies do) and is interrupted leaves a full-length file with
/// zeros where nothing arrived — the trailer among them, and the point
/// cloud's `hspcInfo.json`, which is written last. A complete LGSX ends in
/// its non-zero trailer, so this only runs when that is missing; it reads
/// the zero run once.
fn written_end(src: &Source) -> Result<u64> {
    let mut end = src.len();
    let mut buf = vec![0u8; ZERO_SCAN_CHUNK as usize];
    while end > 0 {
        let start = end.saturating_sub(ZERO_SCAN_CHUNK);
        let chunk = &mut buf[..(end - start) as usize];
        src.read_at(start, chunk)?;
        if let Some(i) = chunk.iter().rposition(|&b| b != 0) {
            return Ok(start + i as u64 + 1);
        }
        end = start;
    }
    Ok(0)
}

/// Reads the body section starting at `pos` (its banner) and numbers it
/// `id`, as the index would (1-based, in file order). `len` is where the
/// written data ends.
fn body_step(src: &Source, len: u64, pos: u64, id: u32) -> Result<BodyStep> {
    let mut head = [0u8; 20];
    let n = (len - pos).min(20) as usize;
    src.read_at(pos, &mut head[..n])?;
    let banner = n.min(16);
    if head[..banner] != SECTION_BANNER[..banner] {
        return Ok(BodyStep::End);
    }
    let cut_header = || BodyStep::Cut(format!("the header of section {id}"));
    if n < 20 {
        return Ok(cut_header());
    }
    let hlen = u32::from_le_bytes(head[16..20].try_into().unwrap());
    if hlen > BODY_HEADER_MAX {
        return fmt_err(format!(
            "LGSX section header at offset {pos} claims {hlen} bytes"
        ));
    }
    let offset = pos + 20 + u64::from(hlen);
    if offset > len {
        return Ok(cut_header());
    }
    let hdr = src.read_vec(pos + 20, hlen as usize)?;
    let mut r = Le::new(&hdr);
    let size = r.u64()?;
    let parent = r.i32()?;
    let kind = r.u8()?;
    let nlen = r.u16()? as usize;
    let name = String::from_utf8_lossy(r.bytes(nlen)?)
        .trim_end_matches('\0')
        .to_string();
    let hl = r.u16()? as usize;
    let hash = String::from_utf8_lossy(r.bytes(hl)?)
        .trim_end_matches('\0')
        .to_string();
    if offset.checked_add(size).is_none_or(|e| e > len) {
        return Ok(BodyStep::Cut(format!(
            "section \"{name}\" ({} of {})",
            mb(len - offset),
            mb(size)
        )));
    }
    Ok(BodyStep::Section(Section {
        id,
        parent,
        name,
        kind,
        offset,
        size,
        hash,
    }))
}

fn parse_record(b: &[u8]) -> Result<Section> {
    let mut r = Le::new(b);
    let _len = r.u16()?;
    let parent = r.i32()?;
    let id = r.u32()?;
    let nlen = r.u16()? as usize;
    let name = String::from_utf8_lossy(r.bytes(nlen)?)
        .trim_end_matches('\0')
        .to_string();
    let kind = r.u8()?;
    let offset = r.u64()?;
    let size = r.u64()?;
    let hlen = r.u16()? as usize;
    let hash = String::from_utf8_lossy(r.bytes(hlen)?)
        .trim_end_matches('\0')
        .to_string();
    Ok(Section {
        id,
        parent,
        name,
        kind,
        offset,
        size,
        hash,
    })
}

impl Container {
    /// Opens the container from its index, or — when the file has no
    /// trailer — by walking the body (see the module docs). The walk keeps
    /// every whole section before the first cut one and records what it did
    /// in [`Container::notes`]; it fails only when not even the first
    /// section is whole.
    pub fn open(src: Source) -> Result<Container> {
        let len = src.len();
        if len < 64 {
            return fmt_err("file too small for an LGSX container");
        }
        let mut head = [0u8; 16];
        src.read_at(0, &mut head)?;
        if &head != SECTION_BANNER {
            return fmt_err("not an LGSX file (missing wild::geosystems banner)");
        }
        let mut tail = [0u8; 32];
        src.read_at(len - 32, &mut tail)?;
        if &tail[..20] != TRAILER_MAGIC {
            return Container::from_body(src);
        }
        let table = u64::from_le_bytes(tail[24..32].try_into().unwrap());
        if table >= len - 32 {
            return fmt_err("LGSX trailer points past the end of the file");
        }
        // the table sits right before the trailer; a trailer pointing far
        // back must not pull the file into memory
        let tbl = src.read_vec(table, (len - 32 - table).min(INDEX_TABLE_MAX) as usize)?;
        let mut r = Le::new(&tbl);
        let count = r.u32()? as usize;
        if count > tbl.len() / 8 {
            return fmt_err(format!("LGSX index claims {count} sections"));
        }
        let offs: Vec<u64> = (0..count).map(|_| r.u64()).collect::<Result<_>>()?;
        let writer_version = (|| -> Result<String> {
            let hl = r.u16()? as usize;
            r.skip(hl)?;
            let vl = r.u16()? as usize;
            Ok(String::from_utf8_lossy(r.bytes(vl)?)
                .trim_end_matches('\0')
                .to_string())
        })()
        .ok();

        let mut sections = Vec::with_capacity(count);
        for &o in &offs {
            if o + 2 > len {
                return fmt_err("LGSX index record offset past the end");
            }
            let mut l = [0u8; 2];
            src.read_at(o, &mut l)?;
            let rl = u16::from_le_bytes(l) as u64 + 2;
            let rec = src.read_vec(o, rl.min(len - o) as usize)?;
            let s = parse_record(&rec)?;
            if s.offset.checked_add(s.size).is_none_or(|e| e > len) {
                return fmt_err(format!(
                    "LGSX section {:?} runs past the end of the file",
                    s.name
                ));
            }
            sections.push(s);
        }
        Ok(Container {
            src,
            sections,
            writer_version,
            notes: Vec::new(),
        })
    }

    fn from_body(src: Source) -> Result<Container> {
        let written = written_end(&src)?;
        let len = if src.len() - written >= ZERO_TAIL_MIN {
            written
        } else {
            src.len()
        };
        let zeros = (src.len() > len).then(|| {
            format!(
                "its last {} are zeros, never written (a copy or download that did not finish)",
                mb(src.len() - len)
            )
        });
        let mut sections: Vec<Section> = Vec::new();
        let mut pos = 0u64;
        let mut cut = None;
        while pos < len {
            match body_step(&src, len, pos, sections.len() as u32 + 1)? {
                BodyStep::Section(s) => {
                    pos = s.offset + s.size;
                    sections.push(s);
                }
                BodyStep::End => break,
                BodyStep::Cut(what) => {
                    cut = Some(what);
                    break;
                }
            }
        }
        if sections.is_empty() {
            let what = cut.unwrap_or_else(|| "its first section".into());
            let why = zeros.map_or_else(
                || "it has no \"Leica Project File X\" trailer at the end and".to_string(),
                |z| format!("{z}, and its data"),
            );
            return fmt_err(format!(
                "the LGSX file is incomplete: {why} ends inside {what} — copy or \
                 download it again"
            ));
        }
        let mut notes = vec![format!(
            "File: no \"Leica Project File X\" trailer at the end — {} sections found \
             by reading the file front to back",
            sections.len()
        )];
        if let Some(z) = zeros {
            notes.push(format!("File: {z}"));
        }
        if let Some(what) = cut {
            notes.push(format!(
                "File: the data ends inside {what}; that section and everything after it are \
                 missing — the file is probably incomplete (an interrupted copy or download)"
            ));
        }
        Ok(Container {
            src,
            sections,
            writer_version: None,
            notes,
        })
    }

    pub fn source(&self) -> &Source {
        &self.src
    }

    pub fn section(&self, name: &str) -> Option<&Section> {
        self.sections.iter().find(|s| s.name == name)
    }

    pub fn read(&self, s: &Section) -> Result<Vec<u8>> {
        let n = usize::try_from(s.size).map_err(|_| Error::Format("section too large".into()))?;
        self.src.read_vec(s.offset, n)
    }

    /// The section as an independent source (offsets from its start).
    pub fn open_section(&self, s: &Section) -> Result<Source> {
        Ok(std::sync::Arc::new(SubSource::new(
            self.src.clone(),
            s.offset,
            s.size,
        )?))
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::source::SliceSource;

    /// One body section as the writer lays it out: banner, header, payload.
    fn body_section(name: &str, payload: &[u8]) -> Vec<u8> {
        let hash = "AB".repeat(64);
        let mut h = Vec::new();
        h.extend((payload.len() as u64).to_le_bytes());
        h.extend((-1i32).to_le_bytes());
        h.push(3);
        h.extend((name.len() as u16).to_le_bytes());
        h.extend(name.as_bytes());
        h.extend((hash.len() as u16).to_le_bytes());
        h.extend(hash.as_bytes());
        let mut out = SECTION_BANNER.to_vec();
        out.extend((h.len() as u32).to_le_bytes());
        out.extend(h);
        out.extend(payload);
        out
    }

    fn two_sections() -> (Vec<u8>, usize) {
        let mut f = body_section("PointCloud", &[1u8; 100]);
        let second = f.len();
        f.extend(body_section("ProjectDatabase", &[2u8; 100]));
        (f, second)
    }

    fn open(bytes: Vec<u8>) -> Result<Container> {
        Container::open(Arc::new(SliceSource::new(bytes)))
    }

    #[test]
    fn walks_a_file_without_trailer() {
        let (mut f, second) = two_sections();
        let first_payload = (second - 100) as u64;
        let second_payload = (f.len() - 100) as u64;
        f.extend(b"HXMETAV1 and the rest of an index");
        let c = open(f).unwrap();
        let got: Vec<_> = c
            .sections
            .iter()
            .map(|s| (s.id, s.name.as_str(), s.offset, s.size, s.kind, s.parent))
            .collect();
        assert_eq!(
            got,
            [
                (1, "PointCloud", first_payload, 100, 3, -1),
                (2, "ProjectDatabase", second_payload, 100, 3, -1)
            ]
        );
        assert_eq!(c.sections[0].hash, "AB".repeat(64));
        assert_eq!(c.read(&c.sections[1]).unwrap(), [2u8; 100]);
        assert_eq!(c.notes.len(), 1);
        assert!(c.writer_version.is_none());
    }

    #[test]
    fn keeps_the_whole_sections_before_a_cut() {
        let (f, second) = two_sections();
        let c = open(f[..f.len() - 30].to_vec()).unwrap();
        assert_eq!(c.sections.len(), 1);
        assert!(c.notes[1].contains("\"ProjectDatabase\""), "{:?}", c.notes);

        let c = open(f[..second + 10].to_vec()).unwrap();
        assert_eq!(c.sections.len(), 1);
        assert!(c.notes[1].contains("header of section 2"), "{:?}", c.notes);
    }

    /// A copy that sized the file first and stopped: full length, zeros
    /// where nothing arrived. The zeros count as missing, not as data.
    #[test]
    fn a_zero_filled_tail_is_missing_data() {
        let (f, second) = two_sections();
        let full = f.len();
        let mut z = f.clone();
        let tail = vec![0u8; ZERO_TAIL_MIN as usize];
        z[full - 60..].fill(0);
        z.extend(&tail);
        let c = open(z).unwrap();
        assert_eq!(c.sections.len(), 1);
        assert!(c.notes[1].contains("zeros"), "{:?}", c.notes);
        assert!(c.notes[2].contains("\"ProjectDatabase\""), "{:?}", c.notes);

        let mut z = f.clone();
        z[second - 50..].fill(0);
        z.extend(&tail);
        let e = open(z).err().unwrap().to_string();
        assert!(e.contains("zeros") && e.contains("\"PointCloud\""), "{e}");

        // a few zero bytes at the end are not taken as a missing tail
        let mut z = f;
        z.extend([0u8; 100]);
        let c = open(z).unwrap();
        assert_eq!((c.sections.len(), c.notes.len()), (2, 1), "{:?}", c.notes);
    }

    #[test]
    fn a_cut_inside_the_first_section_is_an_error() {
        let (f, second) = two_sections();
        let e = open(f[..second - 10].to_vec()).err().unwrap();
        assert!(e.to_string().contains("incomplete"), "{e}");
        assert!(e.to_string().contains("\"PointCloud\""), "{e}");
    }
}
