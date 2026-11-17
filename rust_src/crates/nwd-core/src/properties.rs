//! Per-node PROPERTY stream — the attribute tabs Navisworks shows for an item
//! (for RVM-loader files: the PDMS attributes of the source `.txt`, plus a
//! `PDMS File Comments` block on each File node).
//!
//! DECODED + VALIDATED on the full Huldra dataset (see
//! `convertSamples/nwd/huldra/README.md`): every property
//! chunk parses to its last byte, block counts equal the hierarchy header
//! table, and the values reproduce the source RVM attribute `.txt` files
//! exactly — 44/44 files, every block, every key (`docs/what_we_know_v1.md`).
//! Other AVEVA writer variants (category `AVEVA`, F = 3 nodes owning two
//! sets) follow the same grammar.
//!
//! ```text
//! chunk   := block*                       (blocks never straddle chunks)
//! block   := [id][T][-1]                  a property SET record (unnamed);
//!                                         T = 86 (attributes) or 79 (only
//!                                         seen empty, F = 3 writers)
//!            category                     def | ref | 0 (none)
//!            [0][count]
//!            count × (propdef value)
//! category, propdef := [id][52][len][display][len][internal]   inline def
//!                    | [1][id]                                 back-reference
//! value   := [4][len][utf-8, NUL-padded to 4]                 string
//!          | [2][i32]                                          integer
//! ```
//!
//! Ids are interned across ALL property chunks of a file (a ref may point at
//! a def from an earlier chunk). The chunks are the `n` chunks counted by the
//! hierarchy header table ([`crate::hierarchy::header_table`]), each holding
//! `table[k]` blocks. Ownership: a tree node with F attribute slots (slot 0 =
//! material) owns the next F − 1 blocks, in DFS order
//! ([`crate::hierarchy::Node::property_sets`]).

use std::collections::HashMap;

/// One property value.
#[derive(Debug, Clone, PartialEq)]
pub enum PropValue {
    Str(String),
    Int(i32),
}

impl std::fmt::Display for PropValue {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PropValue::Str(s) => f.write_str(s),
            PropValue::Int(i) => write!(f, "{i}"),
        }
    }
}

/// One node's property set (one Navisworks property tab).
#[derive(Debug, Clone)]
pub struct PropBlock {
    /// Set record type: 86 (attributes) or 79.
    pub kind: u32,
    /// Display name of the tab, e.g. `PDMS`, `PDMS File Comments`.
    pub category: String,
    /// Internal name, e.g. `lcldrvm_props`.
    pub category_internal: String,
    /// (display name, value) in stored order, e.g. ("Name", "/HA-PIPE").
    pub props: Vec<(String, PropValue)>,
}

const TYPE_SET: u32 = 86;
const TYPE_SET_B: u32 = 79;
const TYPE_DEF: u32 = 52;
const TAG_INT: u32 = 2;
const TAG_STR: u32 = 4;
const NONE_LEN: u32 = 0xFFFF_FFFF;

fn u32le(b: &[u8], o: usize) -> Option<u32> {
    b.get(o..o + 4)
        .map(|s| u32::from_le_bytes(s.try_into().unwrap()))
}

fn read_str(b: &[u8], o: usize) -> Option<(String, usize)> {
    let ln = u32le(b, o)? as usize;
    let raw = b.get(o + 4..o + 4 + ln)?;
    let txt = raw.split(|&c| c == 0).next().unwrap_or(&[]);
    Some((
        String::from_utf8_lossy(txt).into_owned(),
        o + 4 + ((ln + 3) & !3),
    ))
}

fn is_set_type(t: u32) -> bool {
    t == TYPE_SET || t == TYPE_SET_B
}

/// True if `data` starts like a property chunk: `[id][86|79][-1]`.
pub fn is_property_chunk(data: &[u8]) -> bool {
    matches!(
        (u32le(data, 0), u32le(data, 4), u32le(data, 8)),
        (Some(id), Some(t), Some(NONE_LEN)) if id >= 100 && is_set_type(t)
    )
}

/// Streaming reader: feed the property chunks in order; interned defs carry
/// over between chunks.
#[derive(Default)]
pub struct PropReader {
    defs: HashMap<u32, (String, String)>,
}

impl PropReader {
    pub fn new() -> Self {
        Self::default()
    }

    fn def_or_ref(&mut self, b: &[u8], o: usize) -> Option<((String, String), usize)> {
        let w = u32le(b, o)?;
        if w == 0 {
            return Some(((String::new(), String::new()), o + 4));
        }
        if w == 1 {
            let id = u32le(b, o + 4)?;
            return Some((self.defs.get(&id)?.clone(), o + 8));
        }
        if u32le(b, o + 4)? != TYPE_DEF {
            return None;
        }
        let (display, e) = read_str(b, o + 8)?;
        let (internal, e) = read_str(b, e)?;
        self.defs.insert(w, (display.clone(), internal.clone()));
        Some(((display, internal), e))
    }

    /// Parse one chunk, calling `out` per block. Returns the number of blocks
    /// read, or `Err((blocks_read, byte_offset))` where the grammar stopped
    /// (e.g. an unknown value tag) — blocks before that are still delivered.
    pub fn feed(
        &mut self,
        b: &[u8],
        mut out: impl FnMut(PropBlock),
    ) -> std::result::Result<usize, (usize, usize)> {
        let mut o = 0usize;
        let mut count = 0usize;
        while o + 12 <= b.len() {
            let Some(kind) = u32le(b, o + 4).filter(|&t| is_set_type(t)) else {
                break;
            };
            if u32le(b, o + 8) != Some(NONE_LEN) {
                break;
            }
            let start = o;
            let Some(block) = self.block(kind, b, o + 12, &mut o) else {
                return Err((count, start));
            };
            out(block);
            count += 1;
        }
        // Only zero padding may follow the last block.
        if b[o.min(b.len())..].iter().any(|&x| x != 0) {
            return Err((count, o));
        }
        Ok(count)
    }

    fn block(&mut self, kind: u32, b: &[u8], mut o: usize, end: &mut usize) -> Option<PropBlock> {
        let ((category, category_internal), e) = self.def_or_ref(b, o)?;
        o = e;
        let n = u32le(b, o + 4)? as usize;
        o += 8;
        if n > 100_000 {
            return None;
        }
        let mut props = Vec::with_capacity(n);
        for _ in 0..n {
            let ((name, _), e) = self.def_or_ref(b, o)?;
            o = e;
            let value = match u32le(b, o)? {
                TAG_STR => {
                    let (s, e) = read_str(b, o + 4)?;
                    o = e;
                    PropValue::Str(s)
                }
                TAG_INT => {
                    let v = u32le(b, o + 4)? as i32;
                    o += 8;
                    PropValue::Int(v)
                }
                _ => return None,
            };
            props.push((name, value));
        }
        *end = o;
        Some(PropBlock {
            kind,
            category,
            category_internal,
            props,
        })
    }
}

/// Indices of the property chunks, in stream order: the `n_chunks` chunks
/// with the `[id][86][-1]` signature that precede the hierarchy chunk
/// (walking backwards past small marker chunks and anything else).
pub fn find_chunks(c: &crate::Container, hier_index: usize, n_chunks: usize) -> Vec<usize> {
    let mut out = Vec::new();
    let mut i = hier_index;
    while i > 0 && out.len() < n_chunks {
        i -= 1;
        // Peek without inflating huge geometry chunks twice: property chunks
        // are never tiny; marker chunks are 8–64 bytes.
        if c.chunks[i].inflated_len < 16 {
            continue;
        }
        if is_property_chunk(&c.data(i)) {
            out.push(i);
        } else if !out.is_empty() {
            break; // the property chunks are contiguous
        }
    }
    out.reverse();
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn w(v: &mut Vec<u8>, x: u32) {
        v.extend_from_slice(&x.to_le_bytes());
    }
    fn s(v: &mut Vec<u8>, t: &str) {
        w(v, t.len() as u32);
        v.extend_from_slice(t.as_bytes());
        while v.len() % 4 != 0 {
            v.push(0);
        }
    }

    #[test]
    fn parses_defs_refs_and_values() {
        let mut b = Vec::new();
        // block 1: inline category + 2 inline props
        w(&mut b, 100);
        w(&mut b, 86);
        w(&mut b, NONE_LEN);
        w(&mut b, 101);
        w(&mut b, 52);
        s(&mut b, "PDMS");
        s(&mut b, "lcldrvm_props");
        w(&mut b, 0);
        w(&mut b, 2);
        w(&mut b, 102);
        w(&mut b, 52);
        s(&mut b, "Name");
        s(&mut b, "lcldrvm_prop_name");
        w(&mut b, 4);
        s(&mut b, "/CD2-PSUP");
        w(&mut b, 103);
        w(&mut b, 52);
        s(&mut b, "NumbDb");
        s(&mut b, "lcldrvm_prop_numbdb");
        w(&mut b, 2);
        w(&mut b, 435);
        // block 2: refs only
        w(&mut b, 104);
        w(&mut b, 86);
        w(&mut b, NONE_LEN);
        w(&mut b, 1);
        w(&mut b, 101);
        w(&mut b, 0);
        w(&mut b, 1);
        w(&mut b, 1);
        w(&mut b, 102);
        w(&mut b, 4);
        s(&mut b, "/PS/CD2/0001");
        let mut got = Vec::new();
        let n = PropReader::new().feed(&b, |blk| got.push(blk)).unwrap();
        assert_eq!(n, 2);
        assert_eq!(got[0].category, "PDMS");
        assert_eq!(got[0].props[1], ("NumbDb".into(), PropValue::Int(435)));
        assert_eq!(
            got[1].props[0],
            ("Name".into(), PropValue::Str("/PS/CD2/0001".into()))
        );
    }
}
