//! myVR `mMapArchive` ("mMPK") — the file archive holding the HSPC point
//! octree inside the LGSX `PointCloud` section.
//!
//! ```text
//! 0x00 "mMPK" | u32 version (1) | u32 0 | u32 file_count
//! 0x10 u32 trie_len | u32 pool_len | u32 dir_block_len | u32 size_block_len
//! 0x20 u64 data_offset | 16 × 0
//! 0x38 dir block : u32 raw_len | zlib( trie[trie_len] | pool[pool_len] )
//!      size block: u32 raw_len | zlib( u32 file_size × file_count )
//! data_offset: the files, contiguous, in file-index order
//! ```
//!
//! The directory is a byte trie. A node is
//! `varint label_off | u8 label_len | u8 child_count` followed, for a leaf
//! (`child_count == 0`), by `varint file_index`; otherwise by `u8 0`, the
//! first child's edge byte, then `(varint rel_offset, edge byte)` for the
//! remaining children — offsets are relative to the end of the node, where
//! the first child starts. Labels are slices of the string pool (NUL counted
//! in `label_len`). Varints are big-endian base-128.

use std::collections::HashMap;
use std::io::Read;

use crate::error::{fmt_err, Error, Result};
use crate::source::{Le, Source, SubSource};

pub const MAGIC: &[u8; 4] = b"mMPK";

#[derive(Clone, Debug)]
pub struct Entry {
    pub path: String,
    /// Offset within the archive source.
    pub offset: u64,
    pub size: u64,
}

pub struct Archive {
    src: Source,
    pub entries: Vec<Entry>,
    by_path: HashMap<String, usize>,
}

/// Most bytes reserved for a header block before any of it is inflated.
const BLOCK_RESERVE: usize = 1 << 24;

fn inflate(block: &[u8], what: &str) -> Result<Vec<u8>> {
    let mut r = Le::new(block);
    let raw_len = r.u32()? as usize;
    // the declared size is unchecked until the block has inflated to it
    let mut out = Vec::with_capacity(raw_len.min(BLOCK_RESERVE));
    flate2::read::ZlibDecoder::new(&block[4..])
        .take(raw_len as u64 + 1)
        .read_to_end(&mut out)
        .map_err(|e| Error::Format(format!("mMPK {what}: {e}")))?;
    if out.len() != raw_len {
        return fmt_err(format!(
            "mMPK {what}: inflated {} bytes, expected {raw_len}",
            out.len()
        ));
    }
    Ok(out)
}

fn varint(b: &[u8], p: &mut usize) -> Result<u64> {
    let mut v = 0u64;
    for _ in 0..10 {
        let c = *b
            .get(*p)
            .ok_or_else(|| Error::Format("mMPK trie: truncated varint".into()))?;
        *p += 1;
        v = (v << 7) | (c & 0x7F) as u64;
        if c < 0x80 {
            return Ok(v);
        }
    }
    fmt_err("mMPK trie: varint too long")
}

/// Walk the directory trie; returns `paths[file_index]`.
pub fn decode_trie(trie: &[u8], pool: &[u8], file_count: usize) -> Result<Vec<String>> {
    let mut paths: Vec<Option<String>> = vec![None; file_count];
    // explicit stack: (node position, path prefix)
    let mut stack: Vec<(usize, Vec<u8>)> = vec![(0, Vec::new())];
    let mut visited = 0usize;
    while let Some((pos, mut prefix)) = stack.pop() {
        visited += 1;
        if visited > 4 * file_count + 1024 {
            return fmt_err("mMPK trie: cycle or runaway structure");
        }
        let mut p = pos;
        let label_off = varint(trie, &mut p)? as usize;
        let hdr = trie
            .get(p..p + 2)
            .ok_or_else(|| Error::Format("mMPK trie: truncated node".into()))?;
        let (label_len, count) = (hdr[0] as usize, hdr[1] as usize);
        p += 2;
        let label = pool
            .get(label_off..label_off + label_len)
            .ok_or_else(|| Error::Format("mMPK trie: label outside the pool".into()))?;
        prefix.extend(label.iter().take_while(|&&c| c != 0));
        if count == 0 {
            let idx = varint(trie, &mut p)? as usize;
            let slot = paths
                .get_mut(idx)
                .ok_or_else(|| Error::Format(format!("mMPK trie: file index {idx}")))?;
            *slot = Some(String::from_utf8_lossy(&prefix).into_owned());
            continue;
        }
        p += 1; // u8 0
        let mut kids = Vec::with_capacity(count);
        let first = *trie
            .get(p)
            .ok_or_else(|| Error::Format("mMPK trie: truncated".into()))?;
        p += 1;
        kids.push((0u64, first));
        for _ in 1..count {
            let off = varint(trie, &mut p)?;
            let c = *trie
                .get(p)
                .ok_or_else(|| Error::Format("mMPK trie: truncated".into()))?;
            p += 1;
            kids.push((off, c));
        }
        for &(off, c) in kids.iter().rev() {
            let mut np = prefix.clone();
            np.push(c);
            stack.push((p + off as usize, np));
        }
    }
    paths
        .into_iter()
        .enumerate()
        .map(|(i, p)| p.ok_or_else(|| Error::Format(format!("mMPK trie: file {i} has no path"))))
        .collect()
}

impl Archive {
    pub fn open(src: Source) -> Result<Archive> {
        let head = src.read_vec(0, 0x38)?;
        if &head[..4] != MAGIC {
            return fmt_err("PointCloud section is not an mMapArchive (no mMPK magic)");
        }
        let mut r = Le::at(&head, 4);
        let version = r.u32()?;
        let _ = r.u32()?;
        let file_count = r.u32()? as usize;
        let trie_len = r.u32()? as usize;
        let pool_len = r.u32()? as usize;
        let dir_len = r.u32()? as usize;
        let sizes_len = r.u32()? as usize;
        let data_offset = r.u64()?;
        if version != 1 {
            return Err(Error::Unsupported(format!("mMPK version {version}")));
        }
        if 0x38 + dir_len as u64 + sizes_len as u64 > data_offset || data_offset > src.len() {
            return fmt_err("mMPK header block sizes are inconsistent");
        }
        let dir = inflate(&src.read_vec(0x38, dir_len)?, "directory")?;
        // checked: the two u32 lengths can wrap a 32-bit usize
        if trie_len.checked_add(pool_len) != Some(dir.len()) {
            return fmt_err("mMPK directory length mismatch");
        }
        let (trie, pool) = dir.split_at(trie_len);
        let sizes_raw = inflate(
            &src.read_vec(0x38 + dir_len as u64, sizes_len)?,
            "size table",
        )?;
        if file_count.checked_mul(4) != Some(sizes_raw.len()) {
            return fmt_err("mMPK size table length mismatch");
        }
        let paths = decode_trie(trie, pool, file_count)?;
        let mut entries = Vec::with_capacity(file_count);
        let mut off = data_offset;
        for (i, path) in paths.into_iter().enumerate() {
            let size = u32::from_le_bytes(sizes_raw[4 * i..4 * i + 4].try_into().unwrap()) as u64;
            entries.push(Entry {
                path,
                offset: off,
                size,
            });
            off += size;
        }
        if off > src.len() {
            return fmt_err("mMPK files run past the end of the archive");
        }
        let by_path = entries
            .iter()
            .enumerate()
            .map(|(i, e)| (e.path.clone(), i))
            .collect();
        Ok(Archive {
            src,
            entries,
            by_path,
        })
    }

    pub fn find(&self, path: &str) -> Option<&Entry> {
        self.by_path.get(path).map(|&i| &self.entries[i])
    }

    pub fn read(&self, e: &Entry) -> Result<Vec<u8>> {
        self.src.read_vec(e.offset, e.size as usize)
    }

    pub fn open_entry(&self, e: &Entry) -> Result<Source> {
        Ok(std::sync::Arc::new(SubSource::new(
            self.src.clone(),
            e.offset,
            e.size,
        )?))
    }
}
