//! The DIRECT (composite) conversion: one root at a time.
//!
//! In a composite RVM-loader model every fragment's group id names its tree
//! leaf (1-based DFS ordinal) and its marker+64 word names its geometry
//! record, so each root site is built straight from its own fragments — no
//! alignment heuristics. [`emit_roots`] is that per-root loop.
//!
//! [`convert_streamed`] feeds it without holding the whole file's tables,
//! which is what lets a large model fit the browser's 4 GB wasm memory:
//!
//! * the fragment chunk (one zlib stream, hundreds of MB inflated) is scanned
//!   through a sliding window and kept as 32-byte rows ([`Frag`]);
//! * the hierarchy is kept as 32-byte rows plus one shared name string
//!   ([`NodeTable`]);
//! * the geometry stream is decoded once for its index only — kind, size,
//!   bounding box — and each root then decodes the records it places
//!   ([`StreamedMeshes`]); a record several roots share is kept until its
//!   last root, within a byte budget.
//!
//! What a root is built from is exactly what the whole-file path builds it
//! from, so the outputs are byte-identical; the whole-file path
//! ([`emit_in_memory`], from `convert_inner_sink`) still serves files without
//! a geometry size index.

use std::collections::HashMap;
use std::sync::Arc;

use crate::convert::{
    aux_disc_idx, aux_tube_idx, box_idx, dims_dist, emit_root_model, mem_trace, sorted_dims,
    ConvertOptions, ConvertReport, CookHook, Link, Roots, SplitEmitter, SplitSink, Units,
};
use crate::error::{Error, Result};
use crate::fragments::{self, Fragment};
use crate::geometry::{self, AuxPrim, GeomIndex, GeomRecord, Slot};
use crate::glb::{self, MeshPart, PartPositions};
use crate::hierarchy::Node;
use crate::inspect::{self, ChunkKind};
use crate::{fcmp, Container};

/// "No value" in the packed rows (ids, ordinals and record numbers are far
/// below it).
const NONE: u32 = u32::MAX;

/// The colour of a part whose leaf carries none.
const DEFAULT_COLOR: [f32; 4] = [0.62, 0.62, 0.66, 1.0];

/// Share of fragments whose group id must resolve to a geometry leaf for the
/// direct path (measured 100 % on every composite model tested).
const MIN_ORDINAL_COVERAGE: f64 = 0.99;

/// Bytes of inflated fragment chunk handed to the scanner at a time.
const SCAN_BLOCK: usize = 4 << 20;

/// Decoded meshes kept for later roots that share them.
const SHARED_CACHE_BYTES: usize = 256 << 20;

/// Stored bytes of the records one batch of roots reads ahead. A root's
/// records are scattered over the geometry stream, so reading root by root
/// inflated every chunk ~19 times on a 141-root model; a batch sweeps the
/// stream once (~4 sweeps there) and keeps its records' STORED bytes until
/// their root decodes them.
const BATCH_STORED_BYTES: usize = 32 << 20;

// ── hierarchy ──────────────────────────────────────────────────────────────

/// One hierarchy node as the per-root loop reads it.
#[derive(Clone, Copy)]
struct NodeRow {
    id: u32,
    parent: u32,
    /// Root index (by the node's id, as `Roots::of_node` resolves it).
    root: u32,
    color: [f32; 3],
    opacity: f32,
    geometry: bool,
    has_color: bool,
}

/// The hierarchy without the parse's per-node allocations: 32-byte rows and
/// every display name in one string.
pub(crate) struct NodeTable {
    rows: Vec<NodeRow>,
    names: String,
    name_end: Vec<u32>,
    /// Row of each root, in root order.
    roots: Vec<usize>,
}

impl NodeTable {
    fn empty(capacity: usize) -> NodeTable {
        NodeTable {
            rows: Vec::with_capacity(capacity),
            names: String::new(),
            name_end: Vec::with_capacity(capacity),
            roots: Vec::new(),
        }
    }

    fn push(&mut self, n: &Node) {
        self.names.push_str(&n.display);
        self.name_end.push(self.names.len() as u32);
        self.rows.push(NodeRow {
            id: n.id,
            parent: n.parent_id.unwrap_or(NONE),
            root: NONE,
            color: n.color.unwrap_or_default(),
            opacity: n.opacity,
            geometry: n.geometry,
            has_color: n.color.is_some(),
        });
    }

    /// Fills in each row's root and the roots' rows.
    fn set_roots(&mut self, roots: &Roots) {
        for row in &mut self.rows {
            row.root = roots.of_node(row.id).map_or(NONE, |r| r as u32);
        }
        self.roots = roots.order.iter().map(|id| roots.node_idx[id]).collect();
    }

    fn new(nodes: &[Node], roots: &Roots) -> NodeTable {
        let mut t = NodeTable::empty(nodes.len());
        for n in nodes {
            t.push(n);
        }
        t.set_roots(roots);
        t
    }

    /// Built node by node from the hierarchy's records — the full node list
    /// [`crate::hierarchy::parse_nodes`] returns never exists.
    fn from_records(recs: crate::hierarchy::NodeRecords) -> NodeTable {
        let mut t = NodeTable::empty(recs.len());
        let mut links = Vec::with_capacity(recs.len());
        recs.build(|n| {
            t.push(&n);
            links.push(Link {
                id: n.id,
                parent: n.parent_id,
                depth: n.depth,
            });
        });
        t.names.shrink_to_fit();
        t.set_roots(&Roots::of_links(&links));
        t
    }

    fn name(&self, i: usize) -> &str {
        let start = if i == 0 {
            0
        } else {
            self.name_end[i - 1] as usize
        };
        &self.names[start..self.name_end[i] as usize]
    }

    /// The node a group id names (1-based DFS ordinal), as the per-root loop
    /// reads it.
    fn at_group(&self, group: u32) -> Option<&NodeRow> {
        if group == NONE {
            return None;
        }
        self.rows.get((group as usize).saturating_sub(1))
    }

    /// Share of fragments whose group resolves to a geometry leaf.
    fn ordinal_coverage(&self, frags: &[Frag]) -> f64 {
        if frags.is_empty() {
            return 0.0;
        }
        let hit = frags
            .iter()
            .filter(|f| {
                f.group != NONE
                    && self
                        .rows
                        .get((f.group as usize).wrapping_sub(1))
                        .is_some_and(|n| n.geometry)
            })
            .count();
        hit as f64 / frags.len() as f64
    }
}

// ── fragments ──────────────────────────────────────────────────────────────

/// One fragment as the per-root loop reads it. Its local bounding box is
/// needed only when its record does not resolve, so it lives in
/// [`Frags::bbox`] for those few.
#[derive(Clone, Copy)]
pub(crate) struct Frag {
    t: [f64; 3],
    group: u32,
    /// 1-based on-disk geometry record (marker+64).
    record: u32,
}

pub(crate) struct Frags {
    rows: Vec<Frag>,
    /// Local AABB of each fragment whose record is neither a mesh nor an
    /// AUX primitive (fragment index → box).
    bbox: HashMap<u32, Option<[f32; 6]>>,
}

/// Does on-disk record `record` (1-based) resolve without the shape match?
fn resolves(on_disk: &GeomIndex, record: u32) -> bool {
    record != NONE
        && record >= 1
        && (on_disk.mesh(record as usize - 1).is_some()
            || on_disk.aux(record as usize - 1).is_some())
}

impl Frags {
    fn push(&mut self, on_disk: &GeomIndex, f: Frag, bbox: Option<[f32; 6]>) {
        if !resolves(on_disk, f.record) {
            self.bbox.insert(self.rows.len() as u32, bbox);
        }
        self.rows.push(f);
    }

    fn from_fragments(frags: &[Fragment], on_disk: &GeomIndex) -> Frags {
        let mut out = Frags {
            rows: Vec::with_capacity(frags.len()),
            bbox: HashMap::new(),
        };
        for f in frags {
            out.push(
                on_disk,
                Frag {
                    t: f.translation,
                    group: f.group.unwrap_or(NONE),
                    record: f.geom_record_idx.unwrap_or(NONE),
                },
                f.local_bbox,
            );
        }
        out
    }
}

/// One non-geometry chunk streamed through a window: what
/// `fragments::placements` + the parse-only extras of `fragments::parse` and
/// the interned-stream gate find in it, without the chunk held whole. Every
/// position is examined exactly as the whole-buffer scanners do (the same
/// per-position functions, the whole chunk's length for every bound), and the
/// window keeps the bytes those functions may read around it.
struct ChunkScan<'g> {
    on_disk: &'g GeomIndex,
    n: usize,
    window: Vec<u8>,
    /// Chunk offset of `window[0]`.
    base: usize,
    o_place: usize,
    o_cand: usize,
    gate: fragments::InternedGate,
    /// The placements, in offset order.
    places: Frags,
    /// Offsets of the placements the candidate scan has not passed yet (a
    /// candidate there is the same record).
    recent: std::collections::VecDeque<usize>,
    /// Candidates not at a placement: offset, triple, the AABB before it.
    extras: Vec<(usize, [f64; 3], Option<[f32; 6]>)>,
    /// |value| of every candidate per column, for `parse`'s median bands.
    cols: [Vec<f64>; 3],
}

impl<'g> ChunkScan<'g> {
    fn new(n: usize, on_disk: &'g GeomIndex) -> ChunkScan<'g> {
        ChunkScan {
            on_disk,
            n,
            window: Vec::new(),
            base: 0,
            o_place: 0,
            o_cand: 0,
            gate: fragments::InternedGate::new(),
            places: Frags {
                rows: Vec::new(),
                bbox: HashMap::new(),
            },
            recent: std::collections::VecDeque::new(),
            extras: Vec::new(),
            cols: [Vec::new(), Vec::new(), Vec::new()],
        }
    }

    fn feed(&mut self, bytes: &[u8]) {
        self.window.extend_from_slice(bytes);
        self.advance();
        let keep = [
            self.o_place.saturating_sub(fragments::PLACEMENT_LOOKBACK),
            self.o_cand.saturating_sub(fragments::BBOX_LOOKBACK),
            self.gate.pos().unwrap_or(usize::MAX),
        ]
        .into_iter()
        .min()
        .unwrap_or(0)
        .max(self.base)
        .min(self.base + self.window.len());
        self.window.drain(..keep - self.base);
        self.base = keep;
    }

    fn advance(&mut self) {
        let (n, base) = (self.n, self.base);
        let limit = base + self.window.len();
        let end = limit >= n;
        let w = &self.window;
        while self.o_place + 4 <= n
            && (end || self.o_place + fragments::PLACEMENT_LOOKAHEAD <= limit)
        {
            match fragments::placement_at(w, base, n, self.o_place) {
                Some(f) => {
                    let row = Frag {
                        t: f.translation,
                        group: f.group.unwrap_or(NONE),
                        record: f.geom_record_idx.unwrap_or(NONE),
                    };
                    self.places.push(self.on_disk, row, f.local_bbox);
                    self.recent.push_back(f.offset);
                    self.o_place += fragments::PLACEMENT_STEP;
                }
                None => self.o_place += 4,
            }
        }
        // A candidate at `o` duplicates a placement whose translation sits
        // at `o`; that placement's marker is at most 28 bytes before it, so
        // candidates wait until the placement scan has passed `o − 28`.
        while self.o_cand + 24 <= n
            && (end
                || (self.o_cand + fragments::TRIPLE_LOOKAHEAD <= limit
                    && self.o_cand < self.o_place + 28))
        {
            let o = self.o_cand;
            match fragments::triple_at(w, base, n, o) {
                Some(t) => {
                    for (col, v) in self.cols.iter_mut().zip(t) {
                        col.push(v.abs());
                    }
                    while self.recent.front().is_some_and(|&p| p < o) {
                        self.recent.pop_front();
                    }
                    if self.recent.front() != Some(&o) {
                        self.extras.push((o, t, fragments::bbox_before(w, base, o)));
                    }
                    self.o_cand += fragments::TRIPLE_STEP;
                }
                None => self.o_cand += 4,
            }
        }
        let rd = |p: usize| u32::from_le_bytes(w[p - base..p - base + 4].try_into().unwrap());
        self.gate.advance(rd, n, limit);
    }

    /// The fragments `placements` + `parse` yield for this chunk (placements
    /// first, then the parse-only ones), and whether the interned-stream
    /// gate passed.
    fn finish(self) -> (Frags, bool) {
        let on_disk = self.on_disk;
        let mut out = self.places;
        // `parse` keeps every candidate when there are fewer than 8 (without
        // an AABB), otherwise those inside the per-column median bands.
        let banded = self.cols[0].len() >= 8;
        let bands = banded.then(|| fragments::column_bands(self.cols));
        for (_, t, bb) in self.extras {
            if bands.is_some_and(|b| !fragments::in_bands(&b, &t)) {
                continue;
            }
            let f = Frag {
                t,
                group: NONE,
                record: NONE,
            };
            out.push(on_disk, f, if banded { bb } else { None });
        }
        (out, self.gate.finish())
    }
}

/// The fragments of the chunk with the most placements (ties: the later
/// chunk), as the whole-file scan picks them. `None` when a chunk holds an
/// interned placement stream — the general converter's interned path then
/// applies.
fn scan_fragments(c: &Container, geom_chunks: &[usize], on_disk: &GeomIndex) -> Option<Frags> {
    let geom: std::collections::HashSet<usize> = geom_chunks.iter().copied().collect();
    let mut best: Option<Frags> = None;
    for ci in (0..c.chunks.len()).filter(|ci| !geom.contains(ci)) {
        let mut scan = ChunkScan::new(c.chunks[ci].inflated_len, on_disk);
        let clean = c.stream(ci, SCAN_BLOCK, |b| scan.feed(b));
        let (frags, gate) = if clean {
            scan.finish()
        } else {
            let data = c.data(ci);
            let mut scan = ChunkScan::new(data.len(), on_disk);
            scan.feed(&data);
            scan.finish()
        };
        if gate && fragments::interned_placements(&c.data(ci)).is_some() {
            return None;
        }
        if best
            .as_ref()
            .is_none_or(|b| frags.rows.len() >= b.rows.len())
        {
            best = Some(frags);
        }
    }
    Some(best.unwrap_or(Frags {
        rows: Vec::new(),
        bbox: HashMap::new(),
    }))
}

// ── geometry ───────────────────────────────────────────────────────────────

/// A decoded record as a part is built from it.
pub(crate) enum Proto {
    /// A line-set record: its segments (local).
    Line(Vec<([f32; 3], [f32; 3])>),
    /// A surface: the cleaned local mesh, shared by every placement.
    Mesh(Arc<Vec<[f32; 3]>>, Arc<Vec<u32>>),
}

impl Proto {
    fn of(mut r: GeomRecord) -> Proto {
        if r.is_line() {
            return Proto::Line(r.segments());
        }
        let (pos, idx) = r.take_mesh_clean();
        Proto::Mesh(Arc::new(pos), Arc::new(idx))
    }

    fn bytes(&self) -> usize {
        match self {
            Proto::Line(s) => s.len() * 24,
            Proto::Mesh(p, i) => p.len() * 12 + i.len() * 4,
        }
    }
}

/// Every mesh record's sorted bounding-box dimensions (in mesh-record order)
/// and the on-disk index, for the shape match of fragments without a
/// read-out.
pub(crate) struct MeshIndex {
    on_disk: GeomIndex,
    dims: Vec<[f32; 3]>,
}

/// Where a root's meshes come from.
pub(crate) trait ProtoSource {
    /// The prototypes of mesh records `needed` (ascending); `keep(gi)` is
    /// true when a later root places `gi` too.
    fn load(
        &mut self,
        needed: &[usize],
        keep: &dyn Fn(usize) -> bool,
    ) -> Result<HashMap<usize, Arc<Proto>>>;

    /// Stored bytes of mesh record `gi` that [`ProtoSource::load`] would
    /// decode (0 when it is decoded already).
    fn stored_bytes(&self, gi: usize) -> usize;

    /// Reads mesh records `gis` (ascending) ahead of the roots that load
    /// them, in one sweep; they are decoded only when loaded.
    fn prefetch(&mut self, _gis: &[usize]) -> Result<()> {
        Ok(())
    }
}

/// The whole-file path's records, already decoded.
struct InMemory {
    records: Vec<Option<GeomRecord>>,
    protos: Vec<Option<Arc<Proto>>>,
}

impl ProtoSource for InMemory {
    fn stored_bytes(&self, _gi: usize) -> usize {
        0
    }

    fn load(
        &mut self,
        needed: &[usize],
        _keep: &dyn Fn(usize) -> bool,
    ) -> Result<HashMap<usize, Arc<Proto>>> {
        let mut out = HashMap::with_capacity(needed.len());
        for &gi in needed {
            if self.protos[gi].is_none() {
                let r = self.records[gi].take().expect("record decoded once");
                self.protos[gi] = Some(Arc::new(Proto::of(r)));
            }
            out.insert(gi, self.protos[gi].clone().expect("set above"));
        }
        Ok(out)
    }
}

/// Decodes records from the geometry stream on demand. A record is decoded
/// from the same bytes, and with the same bytes AFTER it in view, as in the
/// whole-stream walk ([`geometry::visit_stream`]): the view ends at the
/// chunk-group boundary that walk decoded it at (a malformed record's
/// vertices may run past its own end).
struct StreamedMeshes<'c, 'a> {
    container: &'c Container<'a>,
    chunks: Vec<usize>,
    /// Stream offset of each geometry chunk, and the total at the end.
    chunk_start: Vec<usize>,
    /// Chunk-index ends of the walk's groups.
    group_end: Vec<usize>,
    /// Stream offset of each on-disk record, and the end of the last.
    rec_start: Vec<usize>,
    /// On-disk index of each mesh record.
    mesh_disk: Vec<u32>,
    window: Vec<u8>,
    /// Stream offset of `window[0]`.
    wbase: usize,
    /// Next chunk to append to the window.
    wnext: usize,
    cache: HashMap<usize, Arc<Proto>>,
    cache_bytes: usize,
    /// Prefetched records, still undecoded.
    raw: HashMap<usize, RawRecord>,
    /// Geometry chunks inflated so far (a chunk several roots read counts
    /// once per read) — reported by the memory trace.
    inflated: usize,
}

impl<'c, 'a> StreamedMeshes<'c, 'a> {
    fn new(
        container: &'c Container<'a>,
        chunks: Vec<usize>,
        sizes: &[u32],
        mesh_disk: Vec<u32>,
    ) -> Self {
        let lens: Vec<usize> = chunks
            .iter()
            .map(|&i| container.chunks[i].inflated_len)
            .collect();
        let prefix = |v: &mut dyn Iterator<Item = usize>| -> Vec<usize> {
            let mut acc = 0usize;
            let mut out = vec![0usize];
            for x in v {
                acc += x;
                out.push(acc);
            }
            out
        };
        StreamedMeshes {
            container,
            chunk_start: prefix(&mut lens.iter().copied()),
            group_end: geometry::stream_groups(&lens),
            rec_start: prefix(&mut sizes.iter().map(|&s| s as usize)),
            chunks,
            mesh_disk,
            window: Vec::new(),
            wbase: 0,
            wnext: 0,
            cache: HashMap::new(),
            cache_bytes: 0,
            raw: HashMap::new(),
            inflated: 0,
        }
    }

    /// Makes the window hold the stream bytes `s .. end`: extends it while
    /// `s` lies within it, otherwise restarts it at the chunk holding `s`.
    fn cover(&mut self, s: usize, end: usize) {
        if self.window.is_empty() || s < self.wbase || s > self.wbase + self.window.len() {
            let k = self.chunk_start.partition_point(|&x| x <= s) - 1;
            self.window.clear();
            self.wbase = self.chunk_start[k];
            self.wnext = k;
        }
        while self.wbase + self.window.len() < end {
            let data = self.container.data(self.chunks[self.wnext]);
            self.window.extend_from_slice(&data);
            self.wnext += 1;
            self.inflated += 1;
        }
    }

    /// Copies mesh records `gis` (ascending on disk) out of the stream, each
    /// with exactly the bytes the whole-stream walk had in view for it: that
    /// walk's window ends at a chunk-group boundary, and the decode reads past
    /// the record only as far as [`geometry::decode_reach`] says. Only the
    /// chunks holding them are inflated.
    fn read(&mut self, gis: &[usize]) -> Result<Vec<RawRecord>> {
        const WINDOW_BYTES: usize = 8 << 20;
        let mut out = Vec::with_capacity(gis.len());
        for &gi in gis {
            let d = self.mesh_disk[gi] as usize;
            let (s, e) = (self.rec_start[d], self.rec_start[d + 1]);
            let cs = &self.chunk_start;
            let Some(&g) = self.group_end.iter().find(|&&g| cs[g] >= e) else {
                return Err(Error::Decode(format!(
                    "mesh record {gi} lies past the stream"
                )));
            };
            let walk_end = cs[g];
            if self.window.len() > WINDOW_BYTES {
                self.window.clear();
            }
            let head_end = walk_end.min(e.max(s + 24));
            self.cover(s, head_end);
            let o = s - self.wbase;
            let reach = geometry::decode_reach(&self.window[o..head_end - self.wbase], 0, e - s);
            let view_end = walk_end.min(s.saturating_add(reach));
            self.cover(s, view_end);
            out.push(RawRecord {
                gi,
                s,
                e,
                view: self.window[o..view_end - self.wbase].to_vec(),
            });
        }
        self.window.clear();
        Ok(out)
    }
}

/// A mesh record's stored bytes, as decoding it needs them: `view` starts at
/// the record (stream offset `s`; it ends at `e`) and runs as far as the
/// decode reads.
struct RawRecord {
    gi: usize,
    s: usize,
    e: usize,
    view: Vec<u8>,
}

/// Decodes records into prototypes — in parallel natively.
fn decode_records(recs: &[RawRecord]) -> Result<Vec<(usize, Proto)>> {
    let one = |r: &RawRecord| -> Result<(usize, Proto)> {
        match geometry::decode_slot(&r.view, r.s, 0, r.e - r.s)? {
            Slot::Mesh(m) => Ok((r.gi, Proto::of(m))),
            Slot::Aux(_) | Slot::None => Err(Error::Decode(format!(
                "mesh record {} did not decode a second time",
                r.gi
            ))),
        }
    };
    #[cfg(not(target_arch = "wasm32"))]
    let done: Vec<Result<(usize, Proto)>> = {
        use rayon::prelude::*;
        recs.par_iter().map(one).collect()
    };
    #[cfg(target_arch = "wasm32")]
    let done: Vec<Result<(usize, Proto)>> = recs.iter().map(one).collect();
    done.into_iter().collect()
}

impl ProtoSource for StreamedMeshes<'_, '_> {
    fn stored_bytes(&self, gi: usize) -> usize {
        let d = self.mesh_disk[gi] as usize;
        self.rec_start[d + 1] - self.rec_start[d]
    }

    fn prefetch(&mut self, gis: &[usize]) -> Result<()> {
        let mut todo: Vec<usize> = gis
            .iter()
            .copied()
            .filter(|gi| !self.cache.contains_key(gi) && !self.raw.contains_key(gi))
            .collect();
        todo.sort_by_key(|&gi| self.mesh_disk[gi]);
        for r in self.read(&todo)? {
            self.raw.insert(r.gi, r);
        }
        Ok(())
    }

    fn load(
        &mut self,
        needed: &[usize],
        keep: &dyn Fn(usize) -> bool,
    ) -> Result<HashMap<usize, Arc<Proto>>> {
        let mut out = HashMap::with_capacity(needed.len());
        let mut recs: Vec<RawRecord> = Vec::new();
        let mut todo: Vec<usize> = Vec::new();
        for &gi in needed {
            if let Some(p) = self.cache.get(&gi) {
                out.insert(gi, p.clone());
            } else if let Some(r) = self.raw.remove(&gi) {
                recs.push(r);
            } else {
                todo.push(gi);
            }
        }
        // in on-disk order, so the window only moves forward
        todo.sort_by_key(|&gi| self.mesh_disk[gi]);
        recs.extend(self.read(&todo)?);
        for (gi, p) in decode_records(&recs)? {
            let p = Arc::new(p);
            if keep(gi) && self.cache_bytes + p.bytes() <= SHARED_CACHE_BYTES {
                self.cache_bytes += p.bytes();
                self.cache.insert(gi, p.clone());
            }
            out.insert(gi, p);
        }
        let mut freed = 0usize;
        self.cache.retain(|&gi, p| {
            let k = keep(gi);
            if !k {
                freed += p.bytes();
            }
            k
        });
        self.cache_bytes -= freed;
        Ok(out)
    }
}

// ── the per-root loop ──────────────────────────────────────────────────────

/// How one fragment is drawn.
enum Res {
    /// A mesh record (by read-out or shape match).
    Mesh(usize),
    Aux(AuxPrim),
    /// A box from the fragment's own AABB.
    Boxed,
}

/// Running totals for the report.
struct Totals {
    triangles: usize,
    placed: usize,
    linked: usize,
    lines: usize,
    min: [f32; 3],
    max: [f32; 3],
}

/// Places every root's fragments and emits the root. Roots go out in root
/// order; a root's parts, items and hierarchy rows are freed before the next.
#[allow(clippy::too_many_arguments)]
fn emit_roots(
    nodes: &NodeTable,
    frags: &Frags,
    meshes: &MeshIndex,
    source: &mut dyn ProtoSource,
    em: &mut SplitEmitter<'_>,
    opts: &ConvertOptions,
    units: &Units,
) -> Result<Totals> {
    let n_roots = nodes.roots.len();
    let mut per_root_frags: Vec<Vec<u32>> = vec![Vec::new(); n_roots];
    let mut unrouted = 0usize;
    for (fi, f) in frags.rows.iter().enumerate() {
        match nodes.at_group(f.group).filter(|n| n.root != NONE) {
            Some(n) => per_root_frags[n.root as usize].push(fi as u32),
            None => unrouted += 1,
        }
    }
    if unrouted > 0 {
        eprintln!("composite: {unrouted} unrouted fragment(s) skipped");
    }
    let mut per_root_nodes: Vec<Vec<u32>> = vec![Vec::new(); n_roots];
    for (i, n) in nodes.rows.iter().enumerate() {
        if n.root != NONE {
            per_root_nodes[n.root as usize].push(i as u32);
        }
    }
    // Long-axis record index for the (rare) fragments without a read-out.
    let by_d2: Vec<(f32, usize)> = {
        let mut v: Vec<(f32, usize)> = meshes
            .dims
            .iter()
            .enumerate()
            .map(|(gi, d)| (d[2], gi))
            .collect();
        v.sort_by(|a, b| fcmp(a.0, b.0));
        v
    };
    let axis_ok = |g: f32, f: f32| -> bool { (g - f).abs() <= 0.01 + 0.02 * f.max(0.05) };
    let resolve = |fi: u32| -> Res {
        let fr = &frags.rows[fi as usize];
        let rec = (fr.record != NONE && fr.record >= 1).then(|| fr.record as usize - 1);
        if let Some(gi) = rec.and_then(|i| meshes.on_disk.mesh(i)) {
            return Res::Mesh(gi);
        }
        if let Some(p) = rec.and_then(|i| meshes.on_disk.aux(i)) {
            return Res::Aux(p);
        }
        // No read-out: windowed exact shape match against the records.
        let Some(Some(bb)) = frags.bbox.get(&fi) else {
            return Res::Boxed;
        };
        let fdims = sorted_dims(&[bb[0], bb[1], bb[2]], &[bb[3], bb[4], bb[5]]);
        let tol2 = 0.01 + 0.02 * fdims[2].max(0.05);
        let lo = by_d2.partition_point(|&(d, _)| d < fdims[2] - tol2);
        let mut best: Option<(f32, usize)> = None;
        for &(_, g2) in by_d2[lo..]
            .iter()
            .take_while(|&&(d, _)| d <= fdims[2] + tol2)
        {
            let gd = &meshes.dims[g2];
            if !(0..3).all(|k| axis_ok(gd[k], fdims[k])) {
                continue;
            }
            let l1 = dims_dist(gd, &fdims);
            if best.is_none_or(|(bl, bg)| l1 < bl || (l1 == bl && g2 < bg)) {
                best = Some((l1, g2));
            }
        }
        best.map_or(Res::Boxed, |(_, g2)| Res::Mesh(g2))
    };
    // The last root that places each mesh record by its read-out: a record
    // stays cached until then.
    let mut last_use = vec![NONE; meshes.dims.len()];
    for (r, fids) in per_root_frags.iter().enumerate() {
        for &fi in fids {
            let fr = &frags.rows[fi as usize];
            if fr.record != NONE && fr.record >= 1 {
                if let Some(gi) = meshes.on_disk.mesh(fr.record as usize - 1) {
                    last_use[gi] = r as u32;
                }
            }
        }
    }

    let mut t = Totals {
        triangles: 0,
        placed: 0,
        linked: 0,
        lines: 0,
        min: [f32::INFINITY; 3],
        max: [f32::NEG_INFINITY; 3],
    };
    let mut emit_root =
        |r: usize, res: &[Res], protos: &HashMap<usize, Arc<Proto>>| -> Result<()> {
            let fids = &per_root_frags[r];
            if fids.is_empty() {
                return Ok(());
            }
            let root_row = nodes.roots[r];
            let root_node = nodes.rows[root_row];
            let root_name = nodes.name(root_row);
            eprintln!(
                "root {}/{} '{}': {} fragments",
                r + 1,
                n_roots,
                root_name,
                fids.len()
            );
            let mut parts: Vec<MeshPart> = Vec::new();
            let mut items: Vec<(u32, usize)> = Vec::new();
            for (&fi, how) in fids.iter().zip(res) {
                let fr = &frags.rows[fi as usize];
                let [tx, ty, tz] = fr.t;
                // group = 1-based DFS node ordinal (see the module docs).
                let leaf = nodes.at_group(fr.group).filter(|n| n.geometry);
                let eid = leaf.map_or(root_node.id, |n| n.id);
                let color = leaf.filter(|n| n.has_color).map_or(DEFAULT_COLOR, |n| {
                    [n.color[0], n.color[1], n.color[2], n.opacity]
                });
                if leaf.is_some() {
                    t.linked += 1;
                }
                match how {
                    Res::Mesh(gi) => match &*protos[gi] {
                        Proto::Line(segs) => {
                            if !opts.include_line {
                                continue;
                            }
                            let place = |p: &[f32; 3]| -> [f32; 3] {
                                let (wx, wy, wz) =
                                    (p[0] as f64 + tx, p[1] as f64 + ty, p[2] as f64 + tz);
                                [wx as f32, wz as f32, -(wy as f32)]
                            };
                            let mut pos = Vec::new();
                            let mut idx = Vec::new();
                            for (a, b) in segs {
                                let (sp, si) =
                                    geometry::cross_mesh(place(a), place(b), units.line_width);
                                let base = pos.len() as u32;
                                pos.extend_from_slice(&sp);
                                idx.extend(si.iter().map(|k| k + base));
                            }
                            if !idx.is_empty() {
                                t.lines += 1;
                                t.triangles += idx.len() / 3;
                                items.push((eid, parts.len()));
                                parts.push(MeshPart {
                                    name: String::new(),
                                    positions: pos.into(),
                                    indices: Arc::new(idx),
                                    mode: glb::MODE_TRIANGLES,
                                    color: [0.80, 0.78, 0.42, 1.0],
                                    path: Vec::new(),
                                });
                            }
                        }
                        Proto::Mesh(mp, mi) => {
                            if mi.is_empty() {
                                continue;
                            }
                            t.triangles += mi.len() / 3;
                            t.placed += 1;
                            items.push((eid, parts.len()));
                            parts.push(MeshPart {
                                name: String::new(),
                                positions: PartPositions::Instanced {
                                    proto: mp.clone(),
                                    t: [tx, ty, tz],
                                },
                                indices: mi.clone(),
                                mode: glb::MODE_TRIANGLES,
                                color,
                                path: Vec::new(),
                            });
                        }
                    },
                    Res::Aux(p) => {
                        if p.is_degenerate() {
                            continue; // no surface (r = 0 / zero frame) — Navisworks emits nothing
                        }
                        // Exact Navisworks tessellation (validated vs its FBX
                        // export): a disc is a flat 32-fan (normal u×v), a
                        // cylinder an OPEN 32-segment tube — its caps are separate
                        // disc fragments of the same leaf.
                        let ci = match p {
                            AuxPrim::Disc { .. } => aux_disc_idx(),
                            AuxPrim::Cyl { .. } => aux_tube_idx(),
                        };
                        t.triangles += ci.len() / 3;
                        t.placed += 1;
                        items.push((eid, parts.len()));
                        parts.push(MeshPart {
                            name: String::new(),
                            positions: PartPositions::Aux {
                                prim: *p,
                                t: [tx, ty, tz],
                            },
                            indices: ci,
                            mode: glb::MODE_TRIANGLES,
                            color,
                            path: Vec::new(),
                        });
                    }
                    Res::Boxed => {
                        // Honest placeholder from the fragment's own AABB.
                        let (mn, mx) = match frags.bbox.get(&fi) {
                            Some(Some(b)) => ([b[0], b[1], b[2]], [b[3], b[4], b[5]]),
                            _ => ([0.0; 3], [0.0; 3]),
                        };
                        let bi = box_idx();
                        t.triangles += bi.len() / 3;
                        t.placed += 1;
                        items.push((eid, parts.len()));
                        parts.push(MeshPart {
                            name: String::new(),
                            positions: PartPositions::Boxed {
                                mn,
                                mx,
                                th: 0.012,
                                t: [tx, ty, tz],
                            },
                            indices: bi,
                            mode: glb::MODE_TRIANGLES,
                            color,
                            path: Vec::new(),
                        });
                    }
                }
            }
            if items.iter().all(|&(_, pi)| parts[pi].indices.is_empty()) {
                return Ok(());
            }
            let mut hier: Vec<(u32, String, Option<u32>)> = per_root_nodes[r]
                .iter()
                .map(|&i| {
                    let n = &nodes.rows[i as usize];
                    let parent = (n.id != root_node.id && n.parent != NONE).then_some(n.parent);
                    (n.id, nodes.name(i as usize).to_string(), parent)
                })
                .collect();
            items.sort();
            hier.sort_by_key(|h| h.0);
            hier.dedup_by_key(|h| h.0);
            mem_trace("  root-parts");
            let (mn, mx) = emit_root_model(
                em,
                opts.mode,
                &units.gopts,
                root_name,
                &parts,
                &items,
                &hier,
            )?;
            mem_trace("  root-emitted");
            for k in 0..3 {
                t.min[k] = t.min[k].min(mn[k]);
                t.max[k] = t.max[k].max(mx[k]);
            }
            Ok(())
        };
    let mut r0 = 0usize;
    let mut next: Option<Vec<Res>> = None;
    while r0 < n_roots {
        // The batch: consecutive roots whose records stay within the budget
        // (at least one root).
        let mut batch: Vec<Vec<Res>> = Vec::new();
        let mut needed: Vec<usize> = Vec::new();
        let mut seen: std::collections::HashSet<usize> = std::collections::HashSet::new();
        let mut stored = 0usize;
        while r0 + batch.len() < n_roots {
            let r = r0 + batch.len();
            let res = next
                .take()
                .unwrap_or_else(|| per_root_frags[r].iter().map(|&fi| resolve(fi)).collect());
            let fresh: Vec<usize> = res
                .iter()
                .filter_map(|x| match x {
                    Res::Mesh(gi) if !seen.contains(gi) => Some(*gi),
                    _ => None,
                })
                .collect::<std::collections::BTreeSet<usize>>()
                .into_iter()
                .collect();
            let add: usize = fresh.iter().map(|&gi| source.stored_bytes(gi)).sum();
            if !batch.is_empty() && stored + add > BATCH_STORED_BYTES {
                next = Some(res);
                break;
            }
            stored += add;
            seen.extend(fresh.iter().copied());
            needed.extend(fresh);
            batch.push(res);
        }
        let r1 = r0 + batch.len();
        needed.sort_unstable();
        source.prefetch(&needed)?;
        drop(needed);
        for (k, res) in batch.into_iter().enumerate() {
            let r = r0 + k;
            let mut need: Vec<usize> = res
                .iter()
                .filter_map(|x| match x {
                    Res::Mesh(gi) => Some(*gi),
                    _ => None,
                })
                .collect();
            need.sort_unstable();
            need.dedup();
            let protos = source.load(&need, &|gi| {
                last_use[gi] != NONE && last_use[gi] as usize > r
            })?;
            emit_root(r, &res, &protos)?;
        }
        r0 = r1;
    }
    Ok(t)
}

fn report(t: Totals, meshes: usize, fragments: usize, unit_scale: f32) -> ConvertReport {
    ConvertReport {
        geometries: meshes,
        fragments,
        placed: t.placed,
        linked: t.linked,
        lines: t.lines,
        triangles: t.triangles,
        bbox_min: t.min,
        bbox_max: t.max,
        unit_scale,
    }
}

/// The whole-file path's direct case: everything is already decoded.
#[allow(clippy::too_many_arguments)]
pub(crate) fn emit_in_memory(
    all_nodes: &[Node],
    roots: &Roots,
    frags: &[Fragment],
    on_disk: GeomIndex,
    records: Vec<GeomRecord>,
    em: &mut SplitEmitter<'_>,
    opts: &ConvertOptions,
    units: &Units,
) -> Result<ConvertReport> {
    let nodes = NodeTable::new(all_nodes, roots);
    let frags = Frags::from_fragments(frags, &on_disk);
    let dims = records
        .iter()
        .map(|r| {
            let (mn, mx) = r.bbox();
            sorted_dims(&mn, &mx)
        })
        .collect();
    let n_meshes = records.len();
    let meshes = MeshIndex { on_disk, dims };
    let mut source = InMemory {
        protos: vec![None; n_meshes],
        records: records.into_iter().map(Some).collect(),
    };
    let t = emit_roots(&nodes, &frags, &meshes, &mut source, em, opts, units)?;
    Ok(report(t, n_meshes, frags.rows.len(), units.unit_scale))
}

/// Converts a composite model one root at a time without holding the whole
/// file's tables (see the module docs). `Ok(None)` when the file is not one
/// this path handles — no geometry size index, the old container revision,
/// an interned placement stream, no root, no geometry, or group ids that do
/// not resolve to leaves; the general converter then runs and takes its own
/// path for it. Nothing has been written to `sink` in that case.
pub(crate) fn convert_streamed<'s>(
    input: crate::convert::Input<'_>,
    opts: &ConvertOptions,
    source_name: &str,
    sink: SplitSink<'s>,
    cook: Option<CookHook<'s>>,
) -> Result<Option<ConvertReport>> {
    mem_trace("start");
    let (input_md5, container) = crate::convert::open_input(input, true);
    let container = container?;
    if container.signature.contains("lichunk-007") {
        return Ok(None);
    }
    let Some((geom_chunks, sizes)) = inspect::geometry_chunks_by_index(&container) else {
        return Ok(None);
    };
    let infos = inspect::classify_except(&container, &geom_chunks);
    mem_trace("classify");

    let Some(hier) = infos
        .iter()
        .find(|i| i.kind == ChunkKind::LogicalHierarchy)
        .map(|i| i.index)
    else {
        return Ok(None);
    };
    // the chunk is released once its records are read, before the nodes
    // are built
    let recs = crate::hierarchy::read_node_records(&container.data(hier));
    let nodes = NodeTable::from_records(recs);
    if nodes.roots.is_empty() {
        return Ok(None);
    }
    mem_trace("hierarchy");

    // The geometry index: every record probed once (its kind and bounding
    // box; a mesh's connectivity is decoded only when a root places it).
    let mut on_disk = GeomIndex::default();
    let mut dims: Vec<[f32; 3]> = Vec::new();
    let mut mesh_disk: Vec<u32> = Vec::new();
    {
        let lens: Vec<usize> = geom_chunks
            .iter()
            .map(|&i| container.chunks[i].inflated_len)
            .collect();
        let mut d = 0u32;
        let inflate = |k: usize| container.data(geom_chunks[k]);
        geometry::walk_stream(&lens, inflate, &sizes, geometry::probe_slot, |probe| {
            on_disk.push_probe(&probe, dims.len());
            if let geometry::Probe::Mesh(mn, mx) = probe {
                dims.push(sorted_dims(&mn, &mx));
                mesh_disk.push(d);
            }
            d += 1;
            Ok(())
        })?;
        on_disk.pad_to(sizes.len());
    }
    if dims.is_empty() {
        return Ok(None);
    }
    mem_trace("geometry-index");

    let Some(frags) = scan_fragments(&container, &geom_chunks, &on_disk) else {
        return Ok(None);
    };
    mem_trace("placement-scan");
    if nodes.ordinal_coverage(&frags.rows) < MIN_ORDINAL_COVERAGE {
        return Ok(None);
    }

    let units = crate::convert::units(opts, &infos);
    let text_strings = crate::convert::split_text_strings(&container, &infos);
    let mut em = SplitEmitter::new(&input_md5, source_name, &units.notes, sink, cook);
    let n_meshes = dims.len();
    let meshes = MeshIndex { on_disk, dims };
    let mut source = StreamedMeshes::new(&container, geom_chunks, &sizes, mesh_disk);
    mem_trace("composite-start");
    let t = emit_roots(&nodes, &frags, &meshes, &mut source, &mut em, opts, &units)?;
    em.finish(Vec::new(), &text_strings)?;
    mem_trace(&format!(
        "composite-done ({} geometry chunk reads for {} chunks)",
        source.inflated,
        source.chunks.len()
    ));
    Ok(Some(report(
        t,
        n_meshes,
        frags.rows.len(),
        units.unit_scale,
    )))
}
