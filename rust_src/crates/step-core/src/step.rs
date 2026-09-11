//! Low-memory ISO 10303-21 (STEP Part 21) reader.
//!
//! Strategy (similar in spirit to rvm_parser_glb): the file is held once as a
//! byte buffer and a single pass builds a compact index of
//! `#id -> (interned type, byte range of the parameter list)`.
//! Parameters are parsed *lazily*, only for the entities the pipeline actually
//! touches, and the resulting `P` values are dropped right after use.
//! No DOM of the whole file is ever materialized.

use std::borrow::Cow;
use std::collections::HashMap;

use crate::io::{InputHandle, MemSink, OutputHandle};
use crate::progress::{NoProgress, Phase, ProgressSink};

/// One indexed entity instance. 16 bytes.
#[derive(Clone, Copy)]
pub struct EntityRec {
    /// Interned type id (see `StepFile::type_names`). For complex (multi-leaf)
    /// instances this is `TYPE_COMPLEX`.
    pub ty: u32,
    /// Byte range (in `StepFile::data`) of the parameter list, *excluding* the
    /// outer parentheses for simple records. For complex records it covers the
    /// whole `( LEAF1(...) LEAF2(...) ... )` body excluding outer parens.
    pub start: u32,
    pub end: u32,
}

pub const TYPE_COMPLEX: &str = "<COMPLEX>";

/// Type id of an unused slot in a dense [`EntityTable`].
const EMPTY_TYPE: u32 = u32::MAX;
/// A dense table may run ahead of the entities seen so far by this factor
/// (plus [`DENSE_SLACK_MIN`]) before the file counts as sparse-id.
const DENSE_SLACK_FACTOR: usize = 4;
const DENSE_SLACK_MIN: usize = 1 << 20;

/// The entity index, `#id -> EntityRec`. Dense — a `Vec` indexed by id, 12
/// bytes per slot, no hashing, no rehash spikes — while ids stay reasonably
/// contiguous, which is how every exporter writes them; a file whose ids are
/// sparse enough that the dense table would waste more than it saves flips to
/// a hash map. This is the one structure that scales with a huge file, so its
/// bytes decide how many tessellation workers fit in RAM.
pub enum EntityTable {
    Dense { recs: Vec<EntityRec>, count: usize },
    Sparse(HashMap<u32, EntityRec>),
}

const EMPTY_REC: EntityRec = EntityRec {
    ty: EMPTY_TYPE,
    start: 0,
    end: 0,
};

impl Default for EntityTable {
    fn default() -> Self {
        EntityTable::Dense {
            recs: Vec::new(),
            count: 0,
        }
    }
}

impl EntityTable {
    pub fn with_capacity(n: usize) -> Self {
        EntityTable::Dense {
            recs: Vec::with_capacity(n),
            count: 0,
        }
    }

    pub fn len(&self) -> usize {
        match self {
            EntityTable::Dense { count, .. } => *count,
            EntityTable::Sparse(m) => m.len(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn get(&self, id: u32) -> Option<&EntityRec> {
        match self {
            EntityTable::Dense { recs, .. } => recs.get(id as usize).filter(|r| r.ty != EMPTY_TYPE),
            EntityTable::Sparse(m) => m.get(&id),
        }
    }

    pub fn insert(&mut self, id: u32, rec: EntityRec) {
        match self {
            EntityTable::Dense { recs, count } => {
                let idx = id as usize;
                if idx >= recs.len() {
                    if idx > *count * DENSE_SLACK_FACTOR + DENSE_SLACK_MIN {
                        let mut map: HashMap<u32, EntityRec> = HashMap::with_capacity(*count + 1);
                        for (i, r) in recs.iter().enumerate() {
                            if r.ty != EMPTY_TYPE {
                                map.insert(i as u32, *r);
                            }
                        }
                        map.insert(id, rec);
                        *self = EntityTable::Sparse(map);
                        return;
                    }
                    recs.resize(idx + 1, EMPTY_REC);
                }
                if recs[idx].ty == EMPTY_TYPE {
                    *count += 1;
                }
                recs[idx] = rec;
            }
            EntityTable::Sparse(m) => {
                m.insert(id, rec);
            }
        }
    }

    /// Hand back the growth slack once the scan is done.
    pub fn shrink_to_fit(&mut self) {
        match self {
            EntityTable::Dense { recs, .. } => recs.shrink_to_fit(),
            EntityTable::Sparse(m) => m.shrink_to_fit(),
        }
    }

    /// `(id, rec)` pairs in ascending id order.
    pub fn iter(&self) -> Box<dyn Iterator<Item = (u32, &EntityRec)> + '_> {
        match self {
            EntityTable::Dense { recs, .. } => Box::new(
                recs.iter()
                    .enumerate()
                    .filter(|(_, r)| r.ty != EMPTY_TYPE)
                    .map(|(i, r)| (i as u32, r)),
            ),
            EntityTable::Sparse(m) => {
                let mut v: Vec<(u32, &EntityRec)> = m.iter().map(|(k, r)| (*k, r)).collect();
                v.sort_unstable_by_key(|(k, _)| *k);
                Box::new(v.into_iter())
            }
        }
    }
}

/// Rough average record size used to pre-size the entity index of a streamed
/// file (a typical CARTESIAN_POINT line is ~50 bytes; long records only make
/// the estimate conservative).
const BYTES_PER_ENTITY_ESTIMATE: u64 = 64;

/// `"SIDX"` — the index blob's magic, followed by its version.
const INDEX_BLOB_MAGIC: u32 = 0x5844_4953;
const INDEX_BLOB_VERSION: u32 = 1;

/// Lazily-parsed parameter value.
#[derive(Clone, Debug, PartialEq)]
pub enum P {
    Ref(u32),
    F(f64),
    I(i64),
    Str(String),
    Enum(String),
    L(Vec<P>),
    Typed(String, Vec<P>),
    Null, // `$`
    Star, // `*`
}

impl P {
    pub fn as_ref_id(&self) -> Option<u32> {
        match self {
            P::Ref(r) => Some(*r),
            _ => None,
        }
    }
    pub fn as_f64(&self) -> Option<f64> {
        match self {
            P::F(v) => Some(*v),
            P::I(v) => Some(*v as f64),
            _ => None,
        }
    }
    pub fn as_i64(&self) -> Option<i64> {
        match self {
            P::I(v) => Some(*v),
            P::F(v) => Some(*v as i64),
            _ => None,
        }
    }
    pub fn as_str(&self) -> Option<&str> {
        match self {
            P::Str(s) => Some(s),
            _ => None,
        }
    }
    pub fn as_list(&self) -> Option<&[P]> {
        match self {
            P::L(l) => Some(l),
            _ => None,
        }
    }
    /// An enumeration value (`.DIFFERENCE.` → `"DIFFERENCE"`), already uppercased.
    pub fn as_enum(&self) -> Option<&str> {
        match self {
            P::Enum(e) => Some(e),
            _ => None,
        }
    }
    /// `.T.` / `.F.` enums as bool.
    pub fn as_bool(&self) -> Option<bool> {
        match self {
            P::Enum(e) if e == "T" => Some(true),
            P::Enum(e) if e == "F" => Some(false),
            _ => None,
        }
    }
}

/// Backing store for the raw STEP bytes. Both variants hand out a borrowable
/// `&[u8]`, so the whole zero-copy parser is agnostic to where the bytes live:
/// an owned buffer (read into RAM, or fed via an [`crate::io::InputHandle`]) or
/// a memory map (native, files larger than RAM — paged by the OS).
#[derive(Default)]
enum Source {
    #[default]
    Empty,
    Owned(Vec<u8>),
    #[cfg(feature = "mmap")]
    Mmap(memmap2::Mmap),
    /// Ranged reads through a handle (OPFS sync handle, a callback bridge, …):
    /// the bytes are never held contiguously. The index is built with a sliding
    /// window and entity parameters are read by range on demand.
    Reader(Box<dyn InputHandle>),
}

impl Source {
    /// The contiguous backing slice — only valid for in-memory sources. A
    /// `Reader` has no contiguous slice (returns empty); its bytes are obtained
    /// by range via [`StepFile::entity_bytes`].
    fn as_slice(&self) -> &[u8] {
        match self {
            Source::Owned(v) => v,
            #[cfg(feature = "mmap")]
            Source::Mmap(m) => &m[..],
            _ => &[],
        }
    }
    fn is_reader(&self) -> bool {
        matches!(self, Source::Reader(_))
    }
}

pub struct StepFile {
    source: Source,
    pub entities: EntityTable,
    /// type id -> entity ids, for fast "find all NAUO" style queries.
    pub by_type: HashMap<u32, Vec<u32>>,
    pub type_names: Vec<String>,
    type_lookup: HashMap<String, u32>,
    pub header_range: (usize, usize),
    pub warnings: Vec<String>,
}

impl StepFile {
    /// Parse from an owned byte buffer (the bytes are held in RAM).
    pub fn parse(data: Vec<u8>) -> Result<StepFile, String> {
        Self::from_source(Source::Owned(data))
    }

    /// Parse from a ranged input handle (an OPFS sync handle, a callback
    /// bridge, …) **without ever holding the whole file**: the index is built
    /// with a sliding window over the handle and entity parameters are read by
    /// range on demand. The path the wasm / C-ABI shells use.
    pub fn from_input(input: Box<dyn InputHandle>) -> Result<StepFile, String> {
        Self::from_input_with_progress(input, &NoProgress)
    }

    /// [`Self::from_input`] reporting [`Phase::Index`] as bytes scanned / file
    /// size (about every 1 %).
    pub fn from_input_with_progress(
        input: Box<dyn InputHandle>,
        progress: &dyn ProgressSink,
    ) -> Result<StepFile, String> {
        // Pre-size the index from the file size so a huge file doesn't pay
        // for a chain of rehashes (each one transiently doubles the table).
        let est = (input.size() / BYTES_PER_ENTITY_ESTIMATE) as usize;
        let mut sf = StepFile {
            source: Source::Reader(input),
            entities: EntityTable::with_capacity(est),
            by_type: HashMap::new(),
            type_names: Vec::new(),
            type_lookup: HashMap::new(),
            header_range: (0, 0),
            warnings: Vec::new(),
        };
        sf.index_streaming(progress)?;
        Ok(sf)
    }

    /// Memory-map a STEP file from disk and parse it — only touched pages are
    /// resident, so files larger than RAM work (native only). Falls back to a
    /// plain read for inputs that cannot be mapped (e.g. empty files).
    #[cfg(feature = "mmap")]
    pub fn open(path: &std::path::Path) -> Result<StepFile, String> {
        let file = std::fs::File::open(path).map_err(|e| format!("cannot open {path:?}: {e}"))?;
        // SAFETY: the file is not mutated for the lifetime of the map; a
        // concurrent external truncation is the documented mmap caveat.
        match unsafe { memmap2::Mmap::map(&file) } {
            Ok(map) => Self::from_source(Source::Mmap(map)),
            Err(_) => {
                let data = std::fs::read(path).map_err(|e| format!("cannot read {path:?}: {e}"))?;
                Self::parse(data)
            }
        }
    }

    fn from_source(source: Source) -> Result<StepFile, String> {
        let mut sf = StepFile {
            source,
            entities: EntityTable::default(),
            by_type: HashMap::new(),
            type_names: Vec::new(),
            type_lookup: HashMap::new(),
            header_range: (0, 0),
            warnings: Vec::new(),
        };
        sf.index()?;
        Ok(sf)
    }

    /// Total byte length of the input.
    pub fn byte_len(&self) -> usize {
        match &self.source {
            Source::Reader(input) => input.size() as usize,
            s => s.as_slice().len(),
        }
    }

    /// Bytes of the range `[start, end)`: borrowed for an in-memory source
    /// (zero-copy), read into an owned buffer for a `Reader` (ranged read on
    /// demand — the whole file is never materialized).
    fn entity_bytes(&self, start: usize, end: usize) -> Cow<'_, [u8]> {
        if let Source::Reader(input) = &self.source {
            let len = end.saturating_sub(start);
            let mut buf = vec![0u8; len];
            let mut off = 0usize;
            while off < len {
                match input.read_at((start + off) as u64, &mut buf[off..]) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => off += n,
                }
            }
            buf.truncate(off);
            Cow::Owned(buf)
        } else {
            Cow::Borrowed(&self.source.as_slice()[start..end])
        }
    }

    pub fn type_id(&self, name: &str) -> Option<u32> {
        self.type_lookup.get(name).copied()
    }

    pub fn type_name(&self, id: u32) -> &str {
        &self.type_names[id as usize]
    }

    /// All entity ids of an exact type name (empty slice if none).
    pub fn of_type(&self, name: &str) -> &[u32] {
        static EMPTY: [u32; 0] = [];
        match self.type_id(name).and_then(|t| self.by_type.get(&t)) {
            Some(v) => v,
            None => &EMPTY,
        }
    }

    pub fn entity_type(&self, id: u32) -> Option<&str> {
        self.entities.get(id).map(|e| self.type_name(e.ty))
    }

    pub fn is_complex(&self, id: u32) -> bool {
        self.entity_type(id) == Some(TYPE_COMPLEX)
    }

    fn intern(&mut self, name: &str) -> u32 {
        if let Some(&id) = self.type_lookup.get(name) {
            return id;
        }
        let id = self.type_names.len() as u32;
        self.type_names.push(name.to_string());
        self.type_lookup.insert(name.to_string(), id);
        id
    }

    // ---------------------------------------------------------------- index

    fn index(&mut self) -> Result<(), String> {
        // A Reader source has no contiguous buffer: index it with a sliding
        // window over the handle (never holds the whole file).
        if self.source.is_reader() {
            return self.index_streaming(&NoProgress);
        }
        // In-memory: take the source out so the scan can borrow its bytes while
        // the index maps are filled (`intern` mutates `self`); restored at end.
        let src = std::mem::take(&mut self.source);
        let res = self.index_slice(src.as_slice());
        self.source = src;
        self.finish_index();
        res
    }

    fn index_slice(&mut self, data: &[u8]) -> Result<(), String> {
        let n = data.len();
        let mut i;

        // Find DATA; section. Also remember HEADER for unit sniffing.
        let header_start = find_kw(&data, 0, b"HEADER;").unwrap_or(0);
        let data_start = find_kw(&data, 0, b"DATA;").ok_or("no DATA; section found")?;
        self.header_range = (header_start, data_start);
        i = data_start + 5;

        while i < n {
            i = skip_ws_comments(&data, i);
            if i >= n {
                break;
            }
            if data[i] != b'#' {
                // ENDSEC; / END-ISO-10303-21; or junk -> stop at ENDSEC
                if starts_with_ci(&data, i, b"ENDSEC") {
                    break;
                }
                i += 1;
                continue;
            }
            i += 1;
            let (id, ni) = parse_uint(&data, i);
            i = skip_ws_comments(&data, ni);
            if i >= n || data[i] != b'=' {
                // malformed; resync to next ';'
                while i < n && data[i] != b';' {
                    i += 1;
                }
                continue;
            }
            i = skip_ws_comments(&data, i + 1);

            let (ty, pstart, pend, after) = if i < n && data[i] == b'(' {
                // complex instance: #5=( LEAF(...) LEAF(...) );
                let close = match_paren(&data, i)?;
                (self.intern(TYPE_COMPLEX), i + 1, close, close + 1)
            } else {
                // simple: NAME(params);
                let ts = i;
                while i < n && is_ident(data[i]) {
                    i += 1;
                }
                let tname = ascii_upper(&data[ts..i]);
                let j = skip_ws_comments(&data, i);
                if j >= n || data[j] != b'(' {
                    while i < n && data[i] != b';' {
                        i += 1;
                    }
                    self.warnings
                        .push(format!("#{}: malformed record skipped", id));
                    continue;
                }
                let close = match_paren(&data, j)?;
                (self.intern(&tname), j + 1, close, close + 1)
            };

            self.entities.insert(
                id,
                EntityRec {
                    ty,
                    start: pstart as u32,
                    end: pend as u32,
                },
            );
            self.by_type.entry(ty).or_default().push(id);

            // skip to ';'
            i = after;
            while i < n && data[i] != b';' {
                i += 1;
            }
            i += 1;
        }

        Ok(())
    }

    /// Index a `Reader` source with a sliding window: read chunks through the
    /// handle, scan entities with the same lexer, grow the window when a record
    /// spans the buffer end, and drop the consumed prefix after each entity so
    /// peak memory is ~one entity + a chunk — never the whole file.
    fn index_streaming(&mut self, progress: &dyn ProgressSink) -> Result<(), String> {
        let input = match std::mem::take(&mut self.source) {
            Source::Reader(r) => r,
            other => {
                self.source = other;
                return Ok(());
            }
        };
        let mut w = Window::new(input.as_ref());

        // HEADER; / DATA; live at the very top; find them from offset 0.
        let header_start = w.find_kw_from_start(b"HEADER;").unwrap_or(0);
        let data_start = match w.find_kw_from_start(b"DATA;") {
            Some(d) => d,
            None => {
                self.source = Source::Reader(input);
                return Err("no DATA; section found".into());
            }
        };
        self.header_range = (header_start, data_start);
        let mut i = data_start + 5;
        let total = w.total;
        let tick = (total / 100).max(1);
        let mut next_tick = 0usize;
        progress.report(Phase::Index, 0, total as u64);

        while i < total {
            i = w.skip_ws_comments(i);
            if i >= total {
                break;
            }
            if i >= next_tick {
                progress.report(Phase::Index, i as u64, total as u64);
                next_tick = i + tick;
            }
            if w.byte(i) != Some(b'#') {
                if w.starts_with_ci(i, b"ENDSEC") {
                    break;
                }
                i += 1;
                continue;
            }
            i += 1;
            let (id, ni) = w.parse_uint(i);
            i = w.skip_ws_comments(ni);
            if i >= total || w.byte(i) != Some(b'=') {
                i = w.find_byte(i, b';') + 1;
                continue;
            }
            i = w.skip_ws_comments(i + 1);

            let (ty, pstart, pend, after) = if w.byte(i) == Some(b'(') {
                let close = w.match_paren(i)?;
                (self.intern(TYPE_COMPLEX), i + 1, close, close + 1)
            } else {
                let ts = i;
                while w.byte(i).is_some_and(is_ident) {
                    i += 1;
                }
                let tname = w.ascii_upper(ts, i);
                let j = w.skip_ws_comments(i);
                if w.byte(j) != Some(b'(') {
                    i = w.find_byte(i, b';') + 1;
                    self.warnings
                        .push(format!("#{}: malformed record skipped", id));
                    continue;
                }
                let close = w.match_paren(j)?;
                (self.intern(&tname), j + 1, close, close + 1)
            };

            self.entities.insert(
                id,
                EntityRec {
                    ty,
                    start: pstart as u32,
                    end: pend as u32,
                },
            );
            self.by_type.entry(ty).or_default().push(id);

            i = w.find_byte(after, b';') + 1;
            // free everything before the next record
            w.advance_base(i);
        }
        progress.report(Phase::Index, total as u64, total as u64);
        self.finish_index();

        self.source = Source::Reader(input);
        Ok(())
    }

    /// Give back the growth slack of the index and the per-type lists — a big
    /// file's tables grew by doubling, so up to half of each is empty.
    fn finish_index(&mut self) {
        self.entities.shrink_to_fit();
        for ids in self.by_type.values_mut() {
            ids.shrink_to_fit();
        }
    }

    // ------------------------------------------------------------- index file

    /// Serialise the index (entity table, type names, per-type lists, header
    /// range) to `out` in [`INDEX_CHUNK`]-sized pieces — never as one buffer,
    /// which for a huge file would be a second copy of the index the wasm heap
    /// never gives back. Another worker rebuilds the same file from it with
    /// [`Self::read_index`] without scanning. Warnings are not carried (the
    /// coordinator reports them).
    pub fn write_index(&self, out: &mut dyn OutputHandle) -> std::io::Result<()> {
        let mut buf: Vec<u8> = Vec::with_capacity(INDEX_CHUNK + 64);
        {
            let mut w = crate::wire::Writer(&mut buf);
            w.u32(INDEX_BLOB_MAGIC);
            w.u32(INDEX_BLOB_VERSION);
            w.u32(self.header_range.0 as u32);
            w.u32(self.header_range.1 as u32);
            w.u32(self.type_names.len() as u32);
            for name in &self.type_names {
                w.u32(name.len() as u32);
                w.0.extend_from_slice(name.as_bytes());
            }
        }
        let mut flush = |buf: &mut Vec<u8>, force: bool| -> std::io::Result<()> {
            if force || buf.len() >= INDEX_CHUNK {
                out.write(buf)?;
                buf.clear();
            }
            Ok(())
        };
        match &self.entities {
            EntityTable::Dense { recs, count } => {
                buf.push(0);
                buf.extend_from_slice(&(*count as u32).to_le_bytes());
                buf.extend_from_slice(&(recs.len() as u32).to_le_bytes());
                for r in recs {
                    buf.extend_from_slice(&r.ty.to_le_bytes());
                    buf.extend_from_slice(&r.start.to_le_bytes());
                    buf.extend_from_slice(&r.end.to_le_bytes());
                    flush(&mut buf, false)?;
                }
            }
            EntityTable::Sparse(m) => {
                buf.push(1);
                buf.extend_from_slice(&(m.len() as u32).to_le_bytes());
                for (id, r) in m {
                    buf.extend_from_slice(&id.to_le_bytes());
                    buf.extend_from_slice(&r.ty.to_le_bytes());
                    buf.extend_from_slice(&r.start.to_le_bytes());
                    buf.extend_from_slice(&r.end.to_le_bytes());
                    flush(&mut buf, false)?;
                }
            }
        }
        for ty in 0..self.type_names.len() as u32 {
            let ids: &[u32] = self.by_type.get(&ty).map_or(&[], |v| v.as_slice());
            buf.extend_from_slice(&(ids.len() as u32).to_le_bytes());
            for id in ids {
                buf.extend_from_slice(&id.to_le_bytes());
                flush(&mut buf, false)?;
            }
        }
        flush(&mut buf, true)
    }

    /// [`Self::write_index`] into memory — tests and small files.
    pub fn index_blob(&self) -> Vec<u8> {
        let mut sink = MemSink::default();
        self.write_index(&mut sink)
            .expect("an in-memory index write cannot fail");
        sink.0
    }

    /// Rebuild a file from an index another session wrote
    /// ([`Self::write_index`]) plus a handle on the same STEP bytes — no scan,
    /// and the index is parsed straight from `index` in bounded pieces, so the
    /// only full-size structure that exists is the table itself. Entity
    /// parameters are still read by range on demand.
    pub fn read_index(
        input: Box<dyn InputHandle>,
        index: &dyn InputHandle,
    ) -> Result<StepFile, String> {
        let bad = || "malformed index".to_string();
        let mut r = IndexReader::new(index);
        if r.u32().ok_or_else(bad)? != INDEX_BLOB_MAGIC
            || r.u32().ok_or_else(bad)? != INDEX_BLOB_VERSION
        {
            return Err("index: wrong magic/version".into());
        }
        let header_range = (
            r.u32().ok_or_else(bad)? as usize,
            r.u32().ok_or_else(bad)? as usize,
        );
        let ntypes = r.u32().ok_or_else(bad)? as usize;
        let mut type_names = Vec::with_capacity(ntypes);
        let mut type_lookup = HashMap::with_capacity(ntypes);
        for i in 0..ntypes {
            let len = r.u32().ok_or_else(bad)? as usize;
            let bytes = r.bytes(len).ok_or_else(bad)?;
            let name = String::from_utf8(bytes).map_err(|_| bad())?;
            type_lookup.insert(name.clone(), i as u32);
            type_names.push(name);
        }
        let entities = match r.u8().ok_or_else(bad)? {
            0 => {
                let count = r.u32().ok_or_else(bad)? as usize;
                let n = r.u32().ok_or_else(bad)? as usize;
                let mut recs = Vec::with_capacity(n);
                r.recs_into(n, false, &mut recs).ok_or_else(bad)?;
                EntityTable::Dense { recs, count }
            }
            _ => {
                let n = r.u32().ok_or_else(bad)? as usize;
                let mut pairs = Vec::with_capacity(n);
                r.recs_into(n, true, &mut pairs).ok_or_else(bad)?;
                let mut m = HashMap::with_capacity(n);
                for (i, rec) in pairs.into_iter().enumerate() {
                    m.insert(r.ids[i], rec);
                }
                EntityTable::Sparse(m)
            }
        };
        let mut by_type = HashMap::with_capacity(ntypes);
        for ty in 0..ntypes as u32 {
            let n = r.u32().ok_or_else(bad)? as usize;
            if n == 0 {
                continue;
            }
            let mut ids = Vec::with_capacity(n);
            r.u32s_into(n, &mut ids).ok_or_else(bad)?;
            by_type.insert(ty, ids);
        }
        Ok(StepFile {
            source: Source::Reader(input),
            entities,
            by_type,
            type_names,
            type_lookup,
            header_range,
            warnings: Vec::new(),
        })
    }

    /// [`Self::read_index`] from an in-memory index — tests and small files.
    pub fn from_index_blob(input: Box<dyn InputHandle>, blob: &[u8]) -> Result<StepFile, String> {
        let handle: &[u8] = blob;
        Self::read_index(input, &handle)
    }

    // ------------------------------------------------------------ accessors

    /// Lazily parse the parameter list of a simple entity.
    pub fn params(&self, id: u32) -> Option<Vec<P>> {
        let rec = *self.entities.get(id)?;
        let bytes = self.entity_bytes(rec.start as usize, rec.end as usize);
        Some(parse_param_list(&bytes))
    }

    /// For complex (multi-leaf) instances: return the params of the leaf with
    /// the given name, e.g. `B_SPLINE_SURFACE` inside a rational surface combo.
    /// `name_contains`: leaf type must contain this substring.
    pub fn complex_leaf(&self, id: u32, name_contains: &str) -> Option<Vec<P>> {
        let rec = *self.entities.get(id)?;
        if self.type_name(rec.ty) != TYPE_COMPLEX {
            return None;
        }
        let bytes = self.entity_bytes(rec.start as usize, rec.end as usize);
        let slice = &bytes[..];
        let mut i = 0usize;
        let n = slice.len();
        while i < n {
            i = skip_ws_comments(slice, i);
            if i >= n {
                break;
            }
            let ts = i;
            while i < n && is_ident(slice[i]) {
                i += 1;
            }
            if i == ts {
                i += 1;
                continue;
            }
            let tname = ascii_upper(&slice[ts..i]);
            let j = skip_ws_comments(slice, i);
            if j < n && slice[j] == b'(' {
                let close = match match_paren(slice, j) {
                    Ok(c) => c,
                    Err(_) => return None,
                };
                if tname.contains(name_contains) {
                    return Some(parse_param_list(&slice[j + 1..close]));
                }
                i = close + 1;
            }
        }
        None
    }

    /// True if entity (simple or complex) has / contains the given type name.
    /// Leaf type names of a complex instance (empty for simple entities).
    pub fn complex_leaf_names(&self, id: u32) -> Vec<String> {
        let mut out = Vec::new();
        let rec = match self.entities.get(id) {
            Some(r) if self.type_name(r.ty) == TYPE_COMPLEX => *r,
            _ => return out,
        };
        let bytes = self.entity_bytes(rec.start as usize, rec.end as usize);
        let slice = &bytes[..];
        let mut i = 0usize;
        let n = slice.len();
        while i < n {
            i = skip_ws_comments(slice, i);
            if i >= n {
                break;
            }
            let ts = i;
            while i < n && is_ident(slice[i]) {
                i += 1;
            }
            if i == ts {
                i += 1;
                continue;
            }
            let tname = ascii_upper(&slice[ts..i]);
            let j = skip_ws_comments(slice, i);
            if j < n && slice[j] == b'(' {
                match match_paren(slice, j) {
                    Ok(close) => {
                        out.push(tname);
                        i = close + 1;
                    }
                    Err(_) => break,
                }
            }
        }
        out
    }

    #[allow(dead_code)]
    pub fn has_type(&self, id: u32, name: &str) -> bool {
        match self.entities.get(id) {
            None => false,
            Some(rec) => {
                let tn = self.type_name(rec.ty);
                if tn == name {
                    return true;
                }
                if tn == TYPE_COMPLEX {
                    self.complex_leaf(id, name).is_some()
                } else {
                    false
                }
            }
        }
    }

    /// Raw bytes of the HEADER section (for unit sniffing etc.)
    #[allow(dead_code)]
    pub fn header(&self) -> Cow<'_, [u8]> {
        self.entity_bytes(self.header_range.0, self.header_range.1)
    }

    /// Reconstruct the Part-21 source line for one entity from its indexed
    /// byte range: `#id=TYPE(params);`, or `#id=(LEAF1(..) LEAF2(..));` for a
    /// complex instance. Used by `--debug-print` to re-emit failing faces.
    pub fn entity_source(&self, id: u32) -> Option<String> {
        let rec = *self.entities.get(id)?;
        let bytes = self.entity_bytes(rec.start as usize, rec.end as usize);
        let body = std::str::from_utf8(&bytes).ok()?.trim();
        let ty = self.entity_type(id)?;
        Some(if ty == TYPE_COMPLEX {
            format!("#{}=({});", id, body)
        } else {
            format!("#{}={}({});", id, ty, body)
        })
    }

    /// Every `#id` reference inside an entity's parameter bytes. Scans for the
    /// `#<digits>` token, so it is robust across simple, typed and complex
    /// records without re-parsing the value tree.
    pub fn entity_refs(&self, id: u32) -> Vec<u32> {
        let rec = match self.entities.get(id) {
            Some(r) => *r,
            None => return Vec::new(),
        };
        let bytes = self.entity_bytes(rec.start as usize, rec.end as usize);
        let body = &bytes[..];
        let mut out = Vec::new();
        let mut i = 0;
        while i < body.len() {
            if body[i] == b'#' {
                let mut j = i + 1;
                let mut val: u32 = 0;
                while j < body.len() && body[j].is_ascii_digit() {
                    val = val * 10 + u32::from(body[j] - b'0');
                    j += 1;
                }
                if j > i + 1 {
                    out.push(val);
                    i = j;
                    continue;
                }
            }
            i += 1;
        }
        out
    }

    /// Transitive closure of references reachable from `root` (inclusive),
    /// capped at `limit` entities, returned in ascending id order so an
    /// excerpt reads top-to-bottom.
    pub fn subgraph(&self, root: u32, limit: usize) -> Vec<u32> {
        let mut seen = std::collections::HashSet::new();
        let mut stack = vec![root];
        while let Some(id) = stack.pop() {
            if seen.len() >= limit || !seen.insert(id) {
                continue;
            }
            for r in self.entity_refs(id) {
                if !seen.contains(&r) {
                    stack.push(r);
                }
            }
        }
        let mut ids: Vec<u32> = seen.into_iter().collect();
        ids.sort_unstable();
        ids
    }
}

// ------------------------------------------------------------------ lexing

fn is_ident(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'-'
}

fn ascii_upper(b: &[u8]) -> String {
    b.iter()
        .map(|c| (*c as char).to_ascii_uppercase())
        .collect()
}

fn starts_with_ci(data: &[u8], i: usize, kw: &[u8]) -> bool {
    data.len() >= i + kw.len()
        && data[i..i + kw.len()]
            .iter()
            .zip(kw)
            .all(|(a, b)| a.to_ascii_uppercase() == b.to_ascii_uppercase())
}

fn find_kw(data: &[u8], from: usize, kw: &[u8]) -> Option<usize> {
    let mut i = from;
    while i + kw.len() <= data.len() {
        match data[i] {
            b'\'' => i = skip_string(data, i),
            b'/' if i + 1 < data.len() && data[i + 1] == b'*' => i = skip_comment(data, i),
            _ => {
                if starts_with_ci(data, i, kw) {
                    return Some(i);
                }
                i += 1;
            }
        }
    }
    None
}

fn skip_string(data: &[u8], mut i: usize) -> usize {
    // data[i] == '\''
    i += 1;
    while i < data.len() {
        if data[i] == b'\'' {
            if i + 1 < data.len() && data[i + 1] == b'\'' {
                i += 2; // escaped quote
            } else {
                return i + 1;
            }
        } else {
            i += 1;
        }
    }
    i
}

fn skip_comment(data: &[u8], mut i: usize) -> usize {
    i += 2;
    while i + 1 < data.len() {
        if data[i] == b'*' && data[i + 1] == b'/' {
            return i + 2;
        }
        i += 1;
    }
    data.len()
}

fn skip_ws_comments(data: &[u8], mut i: usize) -> usize {
    while i < data.len() {
        match data[i] {
            b' ' | b'\t' | b'\r' | b'\n' => i += 1,
            b'/' if i + 1 < data.len() && data[i + 1] == b'*' => i = skip_comment(data, i),
            _ => break,
        }
    }
    i
}

fn parse_uint(data: &[u8], mut i: usize) -> (u32, usize) {
    let mut v: u64 = 0;
    while i < data.len() && data[i].is_ascii_digit() {
        v = v * 10 + (data[i] - b'0') as u64;
        i += 1;
    }
    (v as u32, i)
}

/// Find the index of the `)` matching the `(` at `open`, string/comment aware.
fn match_paren(data: &[u8], open: usize) -> Result<usize, String> {
    let mut depth = 0i32;
    let mut i = open;
    while i < data.len() {
        match data[i] {
            b'(' => {
                depth += 1;
                i += 1;
            }
            b')' => {
                depth -= 1;
                if depth == 0 {
                    return Ok(i);
                }
                i += 1;
            }
            b'\'' => i = skip_string(data, i),
            b'/' if i + 1 < data.len() && data[i + 1] == b'*' => i = skip_comment(data, i),
            _ => i += 1,
        }
    }
    Err("unbalanced parentheses".into())
}

// ----------------------------------------------------- streaming index window

/// Piece size for writing and reading the index file.
const INDEX_CHUNK: usize = 1024 * 1024;

/// Sequential reader over an [`InputHandle`] with a bounded buffer: parses an
/// index file in [`INDEX_CHUNK`] pieces, so a sub-worker never holds the
/// serialised index next to the table it is building from it.
struct IndexReader<'a> {
    input: &'a dyn InputHandle,
    /// absolute offset of the next byte to fetch from `input`
    pos: u64,
    buf: Vec<u8>,
    /// consumed prefix of `buf`
    off: usize,
    /// ids of the sparse pairs read by `recs_into(.., true, ..)`
    ids: Vec<u32>,
}

impl<'a> IndexReader<'a> {
    fn new(input: &'a dyn InputHandle) -> Self {
        IndexReader {
            input,
            pos: 0,
            buf: Vec::with_capacity(INDEX_CHUNK),
            off: 0,
            ids: Vec::new(),
        }
    }

    /// Make at least `need` unread bytes available (or all that is left).
    fn ensure(&mut self, need: usize) -> bool {
        if self.buf.len() - self.off >= need {
            return true;
        }
        self.buf.drain(..self.off);
        self.off = 0;
        let have = self.buf.len();
        let want = need.max(INDEX_CHUNK) - have;
        self.buf.resize(have + want, 0);
        let mut got = 0usize;
        while got < want {
            match self
                .input
                .read_at(self.pos + got as u64, &mut self.buf[have + got..])
            {
                Ok(0) | Err(_) => break,
                Ok(n) => got += n,
            }
        }
        self.buf.truncate(have + got);
        self.pos += got as u64;
        self.buf.len() >= need
    }

    fn take(&mut self, n: usize) -> Option<&[u8]> {
        if !self.ensure(n) {
            return None;
        }
        let s = &self.buf[self.off..self.off + n];
        self.off += n;
        Some(s)
    }

    fn u8(&mut self) -> Option<u8> {
        self.take(1).map(|s| s[0])
    }

    fn u32(&mut self) -> Option<u32> {
        self.take(4)
            .map(|s| u32::from_le_bytes(s.try_into().unwrap()))
    }

    fn bytes(&mut self, n: usize) -> Option<Vec<u8>> {
        self.take(n).map(|s| s.to_vec())
    }

    /// Append `n` entity records (16-byte `(id, rec)` pairs when `with_ids`,
    /// else 12-byte records), a bounded piece at a time.
    fn recs_into(&mut self, n: usize, with_ids: bool, out: &mut Vec<EntityRec>) -> Option<()> {
        let rec_len = if with_ids { 16 } else { 12 };
        let per_piece = (INDEX_CHUNK / rec_len).max(1);
        let mut left = n;
        while left > 0 {
            let k = left.min(per_piece);
            let raw = self.take(k * rec_len)?;
            let mut ids = Vec::new();
            for c in raw.chunks_exact(rec_len) {
                let f = |i: usize| u32::from_le_bytes(c[i..i + 4].try_into().unwrap());
                let b = if with_ids {
                    ids.push(f(0));
                    4
                } else {
                    0
                };
                out.push(EntityRec {
                    ty: f(b),
                    start: f(b + 4),
                    end: f(b + 8),
                });
            }
            self.ids.extend(ids);
            left -= k;
        }
        Some(())
    }

    /// Append `n` little-endian u32s, a bounded piece at a time.
    fn u32s_into(&mut self, n: usize, out: &mut Vec<u32>) -> Option<()> {
        let per_piece = (INDEX_CHUNK / 4).max(1);
        let mut left = n;
        while left > 0 {
            let k = left.min(per_piece);
            let raw = self.take(k * 4)?;
            out.extend(
                raw.chunks_exact(4)
                    .map(|c| u32::from_le_bytes(c.try_into().unwrap())),
            );
            left -= k;
        }
        Some(())
    }
}

/// A sliding read window over an [`InputHandle`], used to index a `Reader`
/// source without ever holding the whole file. It buffers bytes
/// `[base, base + buf.len())`, grows on demand, and drops the consumed prefix
/// via [`Window::advance_base`], so peak memory is ~one entity + a chunk.
///
/// The non-resumable slice lexers (`skip_ws_comments`, `match_paren`,
/// `find_kw`) are re-run from a safe start with a grown window when a record
/// spans the buffer end — correct because each is a pure function of the bytes
/// at its start offset.
struct Window<'a> {
    input: &'a dyn InputHandle,
    total: usize,
    base: usize,
    buf: Vec<u8>,
}

const WIN_CHUNK: usize = 64 * 1024;

impl<'a> Window<'a> {
    fn new(input: &'a dyn InputHandle) -> Window<'a> {
        let total = input.size() as usize;
        let mut w = Window {
            input,
            total,
            base: 0,
            buf: Vec::new(),
        };
        w.grow();
        w
    }

    /// Append the next chunk; returns false at EOF.
    fn grow(&mut self) -> bool {
        let have = self.base + self.buf.len();
        if have >= self.total {
            return false;
        }
        let want = (self.total - have).min(WIN_CHUNK);
        let old = self.buf.len();
        self.buf.resize(old + want, 0);
        let mut got = 0;
        while got < want {
            match self
                .input
                .read_at((have + got) as u64, &mut self.buf[old + got..])
            {
                Ok(0) | Err(_) => break,
                Ok(n) => got += n,
            }
        }
        self.buf.truncate(old + got);
        got > 0
    }

    fn at_eof_window(&self) -> bool {
        self.base + self.buf.len() >= self.total
    }

    /// Grow until absolute `abs` is buffered (or EOF).
    fn ensure(&mut self, abs: usize) {
        while self.base + self.buf.len() <= abs && self.grow() {}
    }

    /// Drop buffered bytes before `abs` to bound memory.
    fn advance_base(&mut self, abs: usize) {
        if abs > self.base {
            let cut = (abs - self.base).min(self.buf.len());
            self.buf.drain(0..cut);
            self.base += cut;
            // `drain` frees length but not capacity, so a single very large
            // entity (a huge control-point list, a point cloud) would leave the
            // buffer high-water-marked at that entity's size for the rest of the
            // run. Once we've moved past it, hand the memory back so the window
            // stays ~one entity + a chunk, not "the largest entity ever seen".
            if self.buf.capacity() > 4 * WIN_CHUNK && self.buf.capacity() > self.buf.len() * 2 {
                self.buf.shrink_to_fit();
            }
        }
    }

    fn rel(&self, abs: usize) -> usize {
        abs - self.base
    }

    fn byte(&mut self, abs: usize) -> Option<u8> {
        self.ensure(abs);
        self.buf.get(abs - self.base).copied()
    }

    fn starts_with_ci(&mut self, abs: usize, kw: &[u8]) -> bool {
        self.ensure(abs + kw.len());
        starts_with_ci(&self.buf, self.rel(abs), kw)
    }

    fn parse_uint(&mut self, abs: usize) -> (u32, usize) {
        self.ensure(abs + 24); // a decimal id is short
        let (v, rel) = parse_uint(&self.buf, self.rel(abs));
        (v, self.base + rel)
    }

    fn ascii_upper(&mut self, start: usize, end: usize) -> String {
        self.ensure(end);
        ascii_upper(&self.buf[self.rel(start)..self.rel(end)])
    }

    fn skip_ws_comments(&mut self, abs: usize) -> usize {
        loop {
            self.ensure(abs + WIN_CHUNK);
            let r = skip_ws_comments(&self.buf, self.rel(abs));
            // r within the buffer (stopped at a real char) or no more file
            if r < self.buf.len() || self.at_eof_window() {
                return self.base + r;
            }
            if !self.grow() {
                return self.base + r;
            }
        }
    }

    fn match_paren(&mut self, open: usize) -> Result<usize, String> {
        loop {
            self.ensure(open + WIN_CHUNK);
            match match_paren(&self.buf, self.rel(open)) {
                Ok(close_rel) => return Ok(self.base + close_rel),
                Err(e) => {
                    if self.at_eof_window() {
                        return Err(e);
                    }
                    self.grow();
                }
            }
        }
    }

    /// First byte `b` at/after `abs` (dumb scan to reach the record terminator
    /// `;` after a matched body); returns `total` if not found.
    fn find_byte(&mut self, abs: usize, b: u8) -> usize {
        let mut a = abs;
        loop {
            self.ensure(a + WIN_CHUNK);
            let mut k = self.rel(a);
            while k < self.buf.len() && self.buf[k] != b {
                k += 1;
            }
            if k < self.buf.len() || self.at_eof_window() {
                return self.base + k;
            }
            a = self.base + k;
            self.grow();
        }
    }

    /// `find_kw` from offset 0 (only called before any `advance_base`, so
    /// `base == 0`), growing until found or EOF.
    fn find_kw_from_start(&mut self, kw: &[u8]) -> Option<usize> {
        loop {
            if let Some(r) = find_kw(&self.buf, 0, kw) {
                return Some(r);
            }
            if !self.grow() {
                return None;
            }
        }
    }
}

// ------------------------------------------------------------- param parse

/// Parse a comma-separated parameter list (the text *between* parens).
pub fn parse_param_list(s: &[u8]) -> Vec<P> {
    let mut out = Vec::new();
    let mut i = 0usize;
    let n = s.len();
    loop {
        i = skip_ws_comments(s, i);
        if i >= n {
            break;
        }
        let (v, ni) = parse_value(s, i);
        out.push(v);
        i = skip_ws_comments(s, ni);
        if i < n && s[i] == b',' {
            i += 1;
        } else {
            break;
        }
    }
    out
}

fn parse_value(s: &[u8], i: usize) -> (P, usize) {
    let n = s.len();
    match s[i] {
        b'#' => {
            let (id, ni) = parse_uint(s, i + 1);
            (P::Ref(id), ni)
        }
        b'$' => (P::Null, i + 1),
        b'*' => (P::Star, i + 1),
        b'\'' => {
            let end = skip_string(s, i);
            let raw = &s[i + 1..end.saturating_sub(1)];
            let mut t = String::with_capacity(raw.len());
            let mut k = 0;
            while k < raw.len() {
                if raw[k] == b'\'' && k + 1 < raw.len() && raw[k + 1] == b'\'' {
                    t.push('\'');
                    k += 2;
                } else {
                    t.push(raw[k] as char);
                    k += 1;
                }
            }
            (P::Str(t), end)
        }
        b'.' => {
            // enum .NAME.
            let mut j = i + 1;
            while j < n && s[j] != b'.' {
                j += 1;
            }
            (P::Enum(ascii_upper(&s[i + 1..j])), (j + 1).min(n))
        }
        b'(' => {
            let close = match_paren(s, i).unwrap_or(n.saturating_sub(1));
            (P::L(parse_param_list(&s[i + 1..close])), close + 1)
        }
        c if c == b'-' || c == b'+' || c.is_ascii_digit() => {
            let mut j = i;
            let mut isf = false;
            if s[j] == b'-' || s[j] == b'+' {
                j += 1;
            }
            while j < n {
                match s[j] {
                    b'0'..=b'9' => j += 1,
                    b'.' => {
                        isf = true;
                        j += 1;
                    }
                    b'E' | b'e' => {
                        isf = true;
                        j += 1;
                        if j < n && (s[j] == b'-' || s[j] == b'+') {
                            j += 1;
                        }
                    }
                    _ => break,
                }
            }
            let txt: String = s[i..j].iter().map(|b| *b as char).collect();
            if isf {
                // a malformed or overflowing literal (e.g. `1E999` parses to ∞)
                // must not seed a non-finite coordinate into the geometry kernel
                let v: f64 = txt.parse().unwrap_or(0.0);
                (P::F(if v.is_finite() { v } else { 0.0 }), j)
            } else {
                (P::I(txt.parse().unwrap_or(0)), j)
            }
        }
        c if is_ident(c) => {
            // typed parameter: NAME(args)  (e.g. IFCPLANEANGLEMEASURE(...))
            let ts = i;
            let mut j = i;
            while j < n && is_ident(s[j]) {
                j += 1;
            }
            let name = ascii_upper(&s[ts..j]);
            let k = skip_ws_comments(s, j);
            if k < n && s[k] == b'(' {
                let close = match_paren(s, k).unwrap_or(n.saturating_sub(1));
                (
                    P::Typed(name, parse_param_list(&s[k + 1..close])),
                    close + 1,
                )
            } else {
                (P::Enum(name), j)
            }
        }
        _ => (P::Null, i + 1),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(src: &str) -> StepFile {
        StepFile::parse(src.as_bytes().to_vec()).expect("parse")
    }

    const MINI: &str = "ISO-10303-21;
HEADER;
FILE_NAME('t','',(''),(''),'','','');
ENDSEC;
DATA;
#1=CARTESIAN_POINT('a point',(1.,2.5E-1,-3.));
#2 = DIRECTION ( '' , ( 0., 0., 1. ) ) ;
#3=ADVANCED_FACE('it''s',(#10,#20),#2,.T.);
/* a comment with ; and ( inside */
#4=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));
#5=MEASURE_WITH_UNIT(LENGTH_MEASURE(25.4),#4);
ENDSEC;
END-ISO-10303-21;
";

    #[test]
    fn entity_table_stays_dense_for_contiguous_ids_and_flips_for_sparse() {
        let rec = |ty: u32| EntityRec {
            ty,
            start: 1,
            end: 2,
        };
        let mut t = EntityTable::default();
        for id in (1..1000u32).rev() {
            t.insert(id, rec(id));
        }
        assert!(matches!(t, EntityTable::Dense { .. }));
        assert_eq!(t.len(), 999);
        assert_eq!(t.get(500).map(|r| r.ty), Some(500));
        assert!(t.get(0).is_none(), "unused slot reads as absent");
        assert!(t.get(5000).is_none());
        t.insert(500, rec(7));
        assert_eq!(t.len(), 999, "overwriting an id does not change the count");
        assert_eq!(t.iter().count(), 999);
        // an id far beyond the entities seen flips the table to sparse
        t.insert(900_000_000, rec(1));
        assert!(matches!(t, EntityTable::Sparse(_)));
        assert_eq!(t.len(), 1000);
        assert_eq!(t.get(500).map(|r| r.ty), Some(7));
        assert_eq!(t.get(900_000_000).map(|r| r.ty), Some(1));
        assert_eq!(t.iter().last().map(|(id, _)| id), Some(900_000_000));
    }

    #[test]
    fn index_blob_round_trips_without_a_scan() {
        let bytes = include_bytes!("../tests/fixtures/as1_pe_203.stp").to_vec();
        let scanned = StepFile::from_input(Box::new(bytes.clone())).expect("scan");
        let blob = scanned.index_blob();
        let rebuilt = StepFile::from_index_blob(Box::new(bytes), &blob).expect("from blob");
        assert_eq!(rebuilt.entities.len(), scanned.entities.len());
        assert_eq!(rebuilt.type_names, scanned.type_names);
        assert_eq!(rebuilt.header_range, scanned.header_range);
        for ty in ["PRODUCT_DEFINITION", "ADVANCED_FACE", "CARTESIAN_POINT"] {
            assert_eq!(
                rebuilt.of_type(ty),
                scanned.of_type(ty),
                "{ty} list identical"
            );
        }
        for (id, rec) in scanned.entities.iter() {
            let r2 = rebuilt.entities.get(id).expect("every entity present");
            assert_eq!((r2.ty, r2.start, r2.end), (rec.ty, rec.start, rec.end));
        }
        let probe = scanned.of_type("ADVANCED_FACE")[0];
        assert_eq!(
            rebuilt.params(probe),
            scanned.params(probe),
            "params read by range"
        );
        assert_eq!(rebuilt.entity_type(probe), Some("ADVANCED_FACE"));

        // the same index read through a handle that returns short pieces —
        // the sub-worker's path — must come out identical
        let chunky = ChunkedHandle {
            data: blob.clone(),
            chunk: 1000,
        };
        let bytes = include_bytes!("../tests/fixtures/as1_pe_203.stp").to_vec();
        let streamed = StepFile::read_index(Box::new(bytes), &chunky).expect("streamed index");
        assert_eq!(streamed.entities.len(), scanned.entities.len());
        assert_eq!(
            streamed.index_blob(),
            blob,
            "re-serialising reproduces the index byte for byte"
        );
    }

    #[test]
    fn indexes_entities_and_types() {
        let sf = parse(MINI);
        assert_eq!(sf.entities.len(), 5);
        assert_eq!(sf.entity_type(1), Some("CARTESIAN_POINT"));
        assert_eq!(sf.entity_type(4), Some(TYPE_COMPLEX));
        assert_eq!(sf.of_type("CARTESIAN_POINT"), &[1]);
    }

    #[test]
    fn parses_params_lazily() {
        let sf = parse(MINI);
        let p = sf.params(1).unwrap();
        assert_eq!(p[0], P::Str("a point".into()));
        let l = p[1].as_list().unwrap();
        assert_eq!(l[0].as_f64(), Some(1.0));
        assert_eq!(l[1].as_f64(), Some(0.25));
        assert_eq!(l[2].as_f64(), Some(-3.0));
    }

    /// An InputHandle that serves a buffer but caps every read at `chunk`
    /// bytes, forcing the streaming indexer's window to grow and to stitch
    /// records that span chunk boundaries.
    struct ChunkedHandle {
        data: Vec<u8>,
        chunk: usize,
    }
    impl crate::io::InputHandle for ChunkedHandle {
        fn size(&self) -> u64 {
            self.data.len() as u64
        }
        fn read_at(&self, offset: u64, buf: &mut [u8]) -> std::io::Result<usize> {
            let start = (offset as usize).min(self.data.len());
            let n = buf.len().min(self.chunk).min(self.data.len() - start);
            buf[..n].copy_from_slice(&self.data[start..start + n]);
            Ok(n)
        }
    }

    #[test]
    fn streaming_index_matches_owned_parse_across_chunk_sizes() {
        // a file with comments, strings containing ')' and ';', a complex
        // instance, and varied whitespace — all the things the windowed lexer
        // must stitch across chunk boundaries
        let src = b"ISO-10303-21;\nHEADER;\nFILE_NAME('a;b)c','');\nENDSEC;\nDATA;\n\
                    #1=CARTESIAN_POINT('p',(1.,2.5E-1,-3.));\n\
                    /* a long comment with ; and ) and ( inside it */\n\
                    #2 = DIRECTION ( '' , ( 0., 0., 1. ) ) ;\n\
                    #3=ADVANCED_FACE('it''s }',(#1),#2,.T.);\n\
                    #4=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));\n\
                    ENDSEC;\nEND-ISO-10303-21;\n"
            .to_vec();
        let owned = StepFile::parse(src.clone()).expect("owned parse");

        // tiny chunks force window growth / record stitching at every boundary
        for chunk in [1usize, 2, 3, 7, 16, 64, 4096] {
            let h = ChunkedHandle {
                data: src.clone(),
                chunk,
            };
            let sf = StepFile::from_input(Box::new(h)).expect("streaming parse");
            assert_eq!(sf.byte_len(), src.len(), "chunk {chunk}");
            assert_eq!(
                sf.entities.len(),
                owned.entities.len(),
                "entity count, chunk {chunk}"
            );
            for &id in &[1u32, 2, 3, 4] {
                assert_eq!(
                    sf.entity_type(id),
                    owned.entity_type(id),
                    "type #{id} chunk {chunk}"
                );
            }
            // ranged param read matches the owned (zero-copy) parse
            assert_eq!(
                sf.params(1).unwrap()[1].as_list().unwrap().len(),
                3,
                "params #1, chunk {chunk}"
            );
            // complex-instance leaf access works through the Reader source too
            assert!(
                sf.complex_leaf(4, "SI_UNIT").is_some(),
                "complex leaf, chunk {chunk}"
            );
            assert_eq!(sf.entity_type(4), Some(TYPE_COMPLEX));
        }
    }

    #[test]
    fn overflowing_numeric_literals_are_coerced_finite() {
        // `1E999` overflows f64 to +∞ on parse; the indexer must clamp it so a
        // malformed file can never seed a non-finite coordinate into geometry
        let sf = parse("DATA;\n#1=CARTESIAN_POINT('',(1E999,-1.0E400,3.));\nENDSEC;");
        let p = sf.params(1).unwrap();
        let coords = p[1].as_list().unwrap();
        assert_eq!(coords[0].as_f64(), Some(0.0), "1E999 must clamp to 0");
        assert_eq!(coords[1].as_f64(), Some(0.0), "-1E400 must clamp to 0");
        assert_eq!(coords[2].as_f64(), Some(3.0), "valid value untouched");
        for c in coords {
            assert!(c.as_f64().unwrap().is_finite());
        }
    }

    #[test]
    fn handles_whitespace_escapes_enums_refs() {
        let sf = parse(MINI);
        let d = sf.params(2).unwrap();
        assert_eq!(d[1].as_list().unwrap()[2].as_f64(), Some(1.0));

        let f = sf.params(3).unwrap();
        assert_eq!(f[0].as_str(), Some("it's")); // '' escape
        let bounds = f[1].as_list().unwrap();
        assert_eq!(bounds[0].as_ref_id(), Some(10));
        assert_eq!(bounds[1].as_ref_id(), Some(20));
        assert_eq!(f[3].as_bool(), Some(true)); // .T.
    }

    #[test]
    fn complex_instances_and_typed_params() {
        let sf = parse(MINI);
        assert!(sf.is_complex(4));
        let si = sf.complex_leaf(4, "SI_UNIT").unwrap();
        assert_eq!(si[0], P::Enum("MILLI".into()));
        assert_eq!(si[1], P::Enum("METRE".into()));
        assert_eq!(
            sf.complex_leaf_names(4),
            vec!["LENGTH_UNIT", "NAMED_UNIT", "SI_UNIT"]
        );

        let m = sf.params(5).unwrap();
        match &m[0] {
            P::Typed(name, args) => {
                assert_eq!(name, "LENGTH_MEASURE");
                assert_eq!(args[0].as_f64(), Some(25.4));
            }
            other => panic!("expected typed param, got {:?}", other),
        }
    }

    #[test]
    fn entity_source_refs_and_subgraph_round_trip() {
        let sf = parse(MINI);

        // refs are scanned straight from the bytes, including inside lists
        let mut r = sf.entity_refs(3);
        r.sort_unstable();
        assert_eq!(r, vec![2, 10, 20]); // (#10,#20) bounds + #2 surface

        // a simple entity reconstructs to re-parseable Part-21
        assert!(sf
            .entity_source(1)
            .unwrap()
            .starts_with("#1=CARTESIAN_POINT("));
        // a complex instance keeps its leaf structure inside outer parens
        let cs = sf.entity_source(4).unwrap();
        assert!(cs.starts_with("#4=(") && cs.contains("SI_UNIT(.MILLI.,.METRE.)"));
        // a missing id yields nothing rather than panicking
        assert!(sf.entity_source(999).is_none());

        // subgraph from #5 (MEASURE_WITH_UNIT -> #4 unit) pulls the unit in
        assert_eq!(sf.subgraph(5, 100), vec![4, 5]);

        // round-trip: a DATA section rebuilt from the excerpt re-parses, and
        // the reconstructed entities carry the same types and references
        let mut doc = String::from("ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n");
        for id in sf.subgraph(5, 100) {
            doc.push_str(&sf.entity_source(id).unwrap());
            doc.push('\n');
        }
        doc.push_str("ENDSEC;\nEND-ISO-10303-21;\n");
        let re = parse(&doc);
        assert_eq!(re.entities.len(), 2);
        assert!(re.is_complex(4));
        assert_eq!(re.params(5).unwrap()[1].as_ref_id(), Some(4));
    }

    #[test]
    fn strings_with_semicolons_and_parens_dont_break_indexing() {
        let sf = parse(
            "DATA;
#1=PRODUCT('a;b(c)','x','',());
#2=PRODUCT('q','r','',());
ENDSEC;",
        );
        assert_eq!(sf.entities.len(), 2);
        assert_eq!(sf.params(1).unwrap()[0].as_str(), Some("a;b(c)"));
    }
}
