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
//! banner + a copy of its record, so the body can be walked front to back
//! when the trailer is missing (not implemented: every sample has one).

use serde::Serialize;

use crate::error::{fmt_err, Error, Result};
use crate::source::{Le, Source, SubSource};

pub const TRAILER_MAGIC: &[u8; 20] = b"Leica Project File X";
pub const SECTION_BANNER: &[u8; 16] = b"wild::geosystems";
/// Most bytes read for the index table (4 + 8 per section, a hash and the
/// writer version: kilobytes in a real file).
const INDEX_TABLE_MAX: u64 = 16 << 20;

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
            return Err(Error::Unsupported(
                "LGSX without the \"Leica Project File X\" trailer".into(),
            ));
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
