//! E57 → `.tdpp`: out-of-core octree build that never spills to disk —
//! the E57 is simply re-read (it is the cheapest "temp file" there is), but
//! only where it has to be: the records are taken in blocks of 2²⁰, and a
//! pass skips every block that holds no point it needs.
//!
//! 1. stats: bounds (scan poses applied: the E57 world frame);
//! 2. counts: points on a 128³ grid over the root cube → chunks (largest
//!    octree cubes with ≤ `chunk_points` points), plus which coarse cells
//!    each block touches;
//! 3. one pass per batch of chunks (≤ `batch_points` points in memory) over
//!    the blocks that touch the batch: collect their points, build each
//!    chunk subtree with additive LOD ([`crate::lod`]), encode every node
//!    below the chunk roots;
//! 4. build the tree above the chunk roots from the roots' retained points,
//!    write the rest.
//!
//! Every stage is a function with a byte form for its result, so the stages
//! run on threads here and on sub-workers in the browser (`scan-wasm`): a
//! worker decodes blocks or builds a whole batch, the coordinator merges,
//! plans and writes.

use scan_core::e57::cv::PacketTable;
use scan_core::e57::{Projection, RangeDecoder, E57};
use scan_core::model::{Aabb, PointBatch, Pose};
use serde_json::json;
use std::collections::HashMap;

use crate::bytes::{In, Out};
use crate::format::{Header, FLAG_COLOR, FLAG_INTENSITY, FLAG_SETUP};
use crate::lod::{self, LodParams, Tree};
use crate::node::{self, Cube, EncodeOptions, Encoded, Grid, NodeKey, Pt};
use crate::writer::Writer;
use crate::{
    base_meta, pano_json, par_each, par_map, parallel_write, skipped_note, CookOptions, Result,
};

/// Records per block — the unit of decoding and of skipping.
pub const BLOCK: u64 = 1 << 20;
/// Block masks are bitsets over a 32³ grid of the root cube.
const MASK_LOG2: u32 = 5;
const MASK_WORDS: usize = 1 << (3 * MASK_LOG2 - 6);
/// Scans a point's one-byte setup index tells apart.
const SETUP_VALUES: usize = 256;

/// The cook grid for an E57 and the root cube.
pub struct E57Frame {
    pub grid: Grid,
    pub root: Cube,
    pub log2: u32,
}

impl E57Frame {
    pub fn new(bounds: &Aabb, res: f64) -> Result<E57Frame> {
        if bounds.is_empty() {
            return Err("E57 has no points".into());
        }
        let mut origin = [0.0; 3];
        let mut half = 0f64;
        #[allow(clippy::needless_range_loop)] // min, max and origin indexed together
        for k in 0..3 {
            let c = ((0.5 * (bounds.min[k] + bounds.max[k])) / res).round();
            origin[k] = c * res;
            half = half
                .max((bounds.max[k] - origin[k]) / res)
                .max((origin[k] - bounds.min[k]) / res);
        }
        let need = 2.0 * (half.ceil() + 2.0);
        let log2 = (need.log2().ceil() as u32).max(4);
        if log2 > 31 {
            return Err(format!(
                "the E57's points lie more than {:.0} km apart, too far for the cook's \
                 {res} m grid — the file probably holds stray points far from the scan \
                 (scan CLI: --e57-resolution)",
                (1u64 << 31) as f64 * res / 1000.0
            )
            .into());
        }
        let size = 1i64 << log2;
        Ok(E57Frame {
            grid: Grid { origin, scale: res },
            root: Cube {
                min: [-size / 2; 3],
                size,
            },
            log2,
        })
    }

    #[inline]
    pub fn g(&self, p: [f64; 3]) -> [i32; 3] {
        let mut g = [0i32; 3];
        for k in 0..3 {
            let v = ((p[k] - self.grid.origin[k]) / self.grid.scale).round() as i64;
            g[k] = v.clamp(self.root.min[k], self.root.min[k] + self.root.size - 1) as i32;
        }
        g
    }
}

/// One E57 point on the cook grid.
#[inline]
pub fn pt(fr: &E57Frame, b: &PointBatch, i: usize, scan: u8, multi: bool) -> Pt {
    Pt {
        g: fr.g(b.positions[i]),
        rgb: b.colors.as_ref().map_or([255; 3], |c| c[i]),
        setup: if multi { scan } else { 0 },
        intensity: b
            .intensity
            .as_ref()
            .map_or(0, |v| (v[i] as f64 * 65535.0).round() as u16),
        n: crate::node::NO_NORMAL,
    }
}

const PT_BYTES: usize = 20;

fn put_pts(out: &mut Out, pts: &[Pt]) {
    out.u64(pts.len() as u64);
    out.0.reserve(pts.len() * PT_BYTES);
    for p in pts {
        for g in p.g {
            out.0.extend(g.to_le_bytes());
        }
        out.0.extend(p.rgb);
        out.0.push(p.setup);
        out.0.extend(p.intensity.to_le_bytes());
        out.0.extend(p.n.to_le_bytes());
    }
}

fn get_pts(r: &mut In) -> Result<Vec<Pt>> {
    let n = r.u64()? as usize;
    let b = r.take(n.checked_mul(PT_BYTES).ok_or("point count overflow")?)?;
    Ok(b.chunks_exact(PT_BYTES)
        .map(|c| {
            let i = |o: usize| i32::from_le_bytes(c[o..o + 4].try_into().unwrap());
            Pt {
                g: [i(0), i(4), i(8)],
                rgb: [c[12], c[13], c[14]],
                setup: c[15],
                intensity: u16::from_le_bytes([c[16], c[17]]),
                n: u16::from_le_bytes([c[18], c[19]]),
            }
        })
        .collect())
}

// -----------------------------------------------------------------------------
// blocks
// -----------------------------------------------------------------------------

/// Every scan's records as independently decodable blocks.
pub struct Blocks {
    decs: Vec<RangeDecoder>,
    /// (scan, block within the scan)
    list: Vec<(u32, u64)>,
}

impl Blocks {
    /// Walks every scan's packet headers (many small reads on a big file);
    /// `progress` gets the fraction walked, weighted by the scans' records.
    pub fn new(e: &E57, progress: &mut dyn FnMut(f64)) -> Result<Blocks> {
        Blocks::build(e, (0..e.scans.len()).map(|_| None).collect(), progress)
    }

    /// From packet tables another worker walked ([`Blocks::tables`]).
    pub fn from_tables(e: &E57, bytes: &[u8]) -> Result<Blocks> {
        let mut r = In(bytes);
        let n = r.u32()? as usize;
        if n != e.scans.len() {
            return Err("packet tables of another file".into());
        }
        let mut tables = Vec::with_capacity(n);
        for _ in 0..n {
            tables.push(Some(PacketTable::from_bytes(r.bytes()?)?));
        }
        Blocks::build(e, tables, &mut |_| {})
    }

    fn build(
        e: &E57,
        tables: Vec<Option<PacketTable>>,
        progress: &mut dyn FnMut(f64),
    ) -> Result<Blocks> {
        let mut decs = Vec::with_capacity(tables.len());
        let mut list = Vec::new();
        let total = e.total_points().max(1) as f64;
        let mut before = 0f64;
        for (s, t) in tables.into_iter().enumerate() {
            let records = e.scans[s].record_count as f64;
            let d = e.range_decoder(s, true, t, &mut |f| {
                progress((before + f * records) / total)
            })?;
            before += records;
            list.extend((0..d.records().div_ceil(BLOCK)).map(|b| (s as u32, b)));
            decs.push(d);
        }
        Ok(Blocks { decs, list })
    }

    /// The packet tables, for [`Blocks::from_tables`].
    pub fn tables(&self) -> Vec<u8> {
        let mut out = Out::default();
        out.u32(self.decs.len() as u32);
        for d in &self.decs {
            out.bytes(&d.table().to_bytes());
        }
        out.0
    }

    pub fn len(&self) -> usize {
        self.list.len()
    }

    pub fn is_empty(&self) -> bool {
        self.list.is_empty()
    }

    /// Decode block `i`: its points (poses applied) and its scan (≤ 255:
    /// every scan past [`SETUP_VALUES`] shares the last value).
    fn decode(&self, i: u32) -> Result<(PointBatch, u8)> {
        let (s, b) = self.list[i as usize];
        let d = &self.decs[s as usize];
        let batch = d.decode(b * BLOCK, ((b + 1) * BLOCK).min(d.records()))?;
        Ok((batch, s.min(255) as u8))
    }
}

// -----------------------------------------------------------------------------
// stage 1: stats
// -----------------------------------------------------------------------------

/// Bounds and attribute presence of a set of blocks.
#[derive(Clone, Copy)]
pub struct Stats {
    pub bounds: Aabb,
    pub total: u64,
    pub has_color: bool,
    pub has_intensity: bool,
}

impl Stats {
    pub const EMPTY: Stats = Stats {
        bounds: Aabb::EMPTY,
        total: 0,
        has_color: false,
        has_intensity: false,
    };

    pub fn merge(&mut self, o: &Stats) {
        self.bounds.union(&o.bounds);
        self.total += o.total;
        self.has_color |= o.has_color;
        self.has_intensity |= o.has_intensity;
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = Out::default();
        for v in self.bounds.min.into_iter().chain(self.bounds.max) {
            out.f64(v);
        }
        out.u64(self.total);
        out.u8(self.has_color as u8);
        out.u8(self.has_intensity as u8);
        out.0
    }

    pub fn from_bytes(b: &[u8]) -> Result<Stats> {
        let mut r = In(b);
        let mut v = [0f64; 6];
        for x in &mut v {
            *x = r.f64()?;
        }
        Ok(Stats {
            bounds: Aabb {
                min: [v[0], v[1], v[2]],
                max: [v[3], v[4], v[5]],
            },
            total: r.u64()?,
            has_color: r.u8()? != 0,
            has_intensity: r.u8()? != 0,
        })
    }
}

/// Stage 1 over blocks `range`.
pub fn stats_blocks(src: &Blocks, range: std::ops::Range<u32>, threads: usize) -> Result<Stats> {
    let mut all = Stats::EMPTY;
    par_each(
        range.collect(),
        threads,
        |i| {
            let (b, _) = src.decode(i)?;
            let mut s = Stats {
                total: b.len() as u64,
                has_color: b.colors.is_some(),
                has_intensity: b.intensity.is_some(),
                ..Stats::EMPTY
            };
            for p in &b.positions {
                s.bounds.add(*p);
            }
            Ok(s)
        },
        |s| {
            all.merge(&s);
            Ok(())
        },
    )?;
    Ok(all)
}

// -----------------------------------------------------------------------------
// stage 2: counts
// -----------------------------------------------------------------------------

/// Counting-grid resolution (log2 cells per axis) for a frame.
fn grid_log2(fr: &E57Frame) -> u32 {
    fr.log2.min(7)
}

/// Counting-grid cell of a grid position, per axis.
#[inline]
fn cell3(fr: &E57Frame, gl: u32, g: [i32; 3]) -> [usize; 3] {
    let shift = fr.log2 - gl;
    let c = |k: usize| ((g[k] as i64 - fr.root.min[k]) >> shift) as usize;
    [c(0), c(1), c(2)]
}

/// Bit of a counting-grid cell in a block mask (the 32³ ancestor cell).
#[inline]
fn mask_bit(gl: u32, c: [usize; 3]) -> usize {
    let ml = MASK_LOG2.min(gl);
    let s = gl - ml;
    (c[0] >> s) | ((c[1] >> s) << ml) | ((c[2] >> s) << (2 * ml))
}

/// Points per counting-grid cell, and the coarse cells each block touches.
pub struct Counts {
    counts: Vec<u32>,
    /// (block, mask) for the blocks counted so far
    masks: Vec<(u32, Vec<u64>)>,
}

impl Counts {
    pub fn new(fr: &E57Frame) -> Counts {
        Counts {
            counts: vec![0; 1 << (3 * grid_log2(fr))],
            masks: Vec::new(),
        }
    }

    pub fn merge(&mut self, o: Counts) -> Result<()> {
        if o.counts.len() != self.counts.len() {
            return Err("counting grids of different frames".into());
        }
        for (a, b) in self.counts.iter_mut().zip(&o.counts) {
            *a += b;
        }
        self.masks.extend(o.masks);
        Ok(())
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = Out::default();
        out.u64(self.counts.len() as u64);
        for c in &self.counts {
            out.u32(*c);
        }
        out.u32(self.masks.len() as u32);
        for (b, m) in &self.masks {
            out.u32(*b);
            for w in m {
                out.u64(*w);
            }
        }
        out.0
    }

    pub fn from_bytes(b: &[u8]) -> Result<Counts> {
        let mut r = In(b);
        let n = r.u64()? as usize;
        let raw = r.take(n.checked_mul(4).ok_or("count grid overflow")?)?;
        let counts = raw
            .chunks_exact(4)
            .map(|c| u32::from_le_bytes(c.try_into().unwrap()))
            .collect();
        let nm = r.u32()? as usize;
        let mut masks = Vec::with_capacity(nm);
        for _ in 0..nm {
            let block = r.u32()?;
            let mut m = Vec::with_capacity(MASK_WORDS);
            for _ in 0..MASK_WORDS {
                m.push(r.u64()?);
            }
            masks.push((block, m));
        }
        Ok(Counts { counts, masks })
    }
}

/// Stage 2 over blocks `range`.
pub fn count_blocks(
    src: &Blocks,
    fr: &E57Frame,
    range: std::ops::Range<u32>,
    threads: usize,
) -> Result<Counts> {
    let gl = grid_log2(fr);
    let cells = 1usize << gl;
    let mut all = Counts::new(fr);
    par_each(
        range.collect(),
        threads,
        |i| {
            let (b, _) = src.decode(i)?;
            let mut mask = vec![0u64; MASK_WORDS];
            let mut idx = Vec::with_capacity(b.len());
            for p in &b.positions {
                let c = cell3(fr, gl, fr.g(*p));
                idx.push((c[0] + cells * (c[1] + cells * c[2])) as u32);
                let bit = mask_bit(gl, c);
                mask[bit / 64] |= 1 << (bit % 64);
            }
            Ok((i, mask, idx))
        },
        |(i, mask, idx)| {
            for k in idx {
                all.counts[k as usize] += 1;
            }
            all.masks.push((i, mask));
            Ok(())
        },
    )?;
    Ok(all)
}

// -----------------------------------------------------------------------------
// plan
// -----------------------------------------------------------------------------

struct Chunk {
    key: NodeKey,
    count: u64,
}

/// Point counts per octree cube down to the counting grid.
pub struct Pyramid(Vec<Vec<u64>>);

impl Pyramid {
    fn count_of(&self, k: &NodeKey) -> u64 {
        let n = 1usize << k.depth;
        self.0[k.depth as usize][k.x as usize + n * (k.y as usize + n * k.z as usize)]
    }
}

/// What every batch pass needs: the grid, the chunks, the batches and the
/// blocks each batch has to decode.
pub struct Plan {
    pub fr: E57Frame,
    gl: u32,
    pub multi: bool,
    pub stats: Stats,
    lp: LodParams,
    enc: EncodeOptions,
    chunks: Vec<Chunk>,
    /// chunk indices per batch
    batches: Vec<Vec<u32>>,
    /// blocks holding points of each batch
    batch_blocks: Vec<Vec<u32>>,
    /// chunk index per counting-grid cell (derived)
    chunk_of_cell: Vec<u32>,
}

impl Plan {
    /// Chunks from the counts, batches of ≤ `batch_points`, and per batch the
    /// blocks whose mask meets the batch's cells.
    pub fn new(
        stats: Stats,
        counts: Counts,
        multi: bool,
        n_blocks: usize,
        o: &CookOptions,
    ) -> Result<(Plan, Pyramid)> {
        let fr = E57Frame::new(&stats.bounds, o.e57_resolution)?;
        let gl = grid_log2(&fr);
        let mut pyr: Vec<Vec<u64>> = vec![Vec::new(); gl as usize + 1];
        pyr[gl as usize] = counts.counts.iter().map(|&c| c as u64).collect();
        for d in (0..gl as usize).rev() {
            let n = 1usize << d;
            let m = 2 * n;
            let mut v = vec![0u64; n * n * n];
            for z in 0..m {
                for y in 0..m {
                    for x in 0..m {
                        v[x / 2 + n * (y / 2 + n * (z / 2))] += pyr[d + 1][x + m * (y + m * z)];
                    }
                }
            }
            pyr[d] = v;
        }
        let pyr = Pyramid(pyr);
        let mut chunks = Vec::new();
        let mut stack = vec![NodeKey::ROOT];
        while let Some(k) = stack.pop() {
            let c = pyr.count_of(&k);
            if c == 0 {
                continue;
            }
            if c <= o.chunk_points as u64 || k.depth as u32 == gl {
                chunks.push(Chunk { key: k, count: c });
            } else {
                stack.extend((0..8).rev().map(|oc| k.child(oc)));
            }
        }
        let mut batches: Vec<Vec<u32>> = vec![Vec::new()];
        let mut acc = 0u64;
        for (ci, ch) in chunks.iter().enumerate() {
            if acc + ch.count > o.batch_points as u64 && !batches.last().unwrap().is_empty() {
                batches.push(Vec::new());
                acc = 0;
            }
            batches.last_mut().unwrap().push(ci as u32);
            acc += ch.count;
        }
        let lp = LodParams {
            capacity: o.node_capacity.max(1),
            min_size: ((0.002 / fr.grid.scale).ceil() as i64).max(2),
            color_weight: o.color_weight,
            use_color: stats.has_color,
        };
        let mut plan = Plan {
            fr,
            gl,
            multi,
            stats,
            lp,
            // an E57 has no normals: no normal stream, whatever the option
            enc: EncodeOptions {
                normals: false,
                ..o.encode()
            },
            chunks,
            batches,
            batch_blocks: Vec::new(),
            chunk_of_cell: Vec::new(),
        };
        plan.derive();
        // a block is needed by a batch when it touches a coarse cell that
        // holds one of the batch's chunks
        let mut masks: Vec<Option<&Vec<u64>>> = vec![None; n_blocks];
        for (b, m) in &counts.masks {
            *masks
                .get_mut(*b as usize)
                .ok_or("block index out of range")? = Some(m);
        }
        if masks.iter().any(|m| m.is_none()) {
            return Err("internal: a block was never counted".into());
        }
        let ml = MASK_LOG2.min(gl);
        for batch in &plan.batches {
            let mut bm = vec![0u64; MASK_WORDS];
            for &ci in batch {
                let k = plan.chunks[ci as usize].key;
                let d = k.depth as u32;
                // the chunk cube in mask cells: a range when coarser than the
                // mask grid, its single ancestor cell when finer
                let (lo, n) = if d <= ml {
                    let s = ml - d;
                    ([k.x << s, k.y << s, k.z << s], 1u32 << s)
                } else {
                    let s = d - ml;
                    ([k.x >> s, k.y >> s, k.z >> s], 1)
                };
                for z in lo[2]..lo[2] + n {
                    for y in lo[1]..lo[1] + n {
                        for x in lo[0]..lo[0] + n {
                            let bit = (x | (y << ml) | (z << (2 * ml))) as usize;
                            bm[bit / 64] |= 1 << (bit % 64);
                        }
                    }
                }
            }
            plan.batch_blocks.push(
                (0..n_blocks as u32)
                    .filter(|&i| {
                        masks[i as usize]
                            .is_some_and(|m| m.iter().zip(&bm).any(|(a, b)| a & b != 0))
                    })
                    .collect(),
            );
        }
        Ok((plan, pyr))
    }

    fn derive(&mut self) {
        let cells = 1usize << self.gl;
        let mut map = vec![u32::MAX; cells * cells * cells];
        for (ci, ch) in self.chunks.iter().enumerate() {
            let span = 1usize << (self.gl - ch.key.depth as u32);
            let (x0, y0, z0) = (
                ch.key.x as usize * span,
                ch.key.y as usize * span,
                ch.key.z as usize * span,
            );
            for z in z0..z0 + span {
                for y in y0..y0 + span {
                    for x in x0..x0 + span {
                        map[x + cells * (y + cells * z)] = ci as u32;
                    }
                }
            }
        }
        self.chunk_of_cell = map;
    }

    pub fn batches(&self) -> usize {
        self.batches.len()
    }

    pub fn chunks(&self) -> usize {
        self.chunks.len()
    }

    /// Blocks decoded over all batch passes (the work the batches cost).
    pub fn batch_block_total(&self) -> usize {
        self.batch_blocks.iter().map(Vec::len).sum()
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = Out::default();
        for v in self.fr.grid.origin {
            out.f64(v);
        }
        out.f64(self.fr.grid.scale);
        out.u32(self.fr.log2);
        out.u8(self.multi as u8);
        out.0.extend(self.stats.to_bytes());
        out.u64(self.lp.capacity as u64);
        out.u64(self.lp.min_size as u64);
        out.u32(self.lp.color_weight.to_bits());
        out.u32(self.enc.cluster_size as u32);
        out.u32(self.enc.codec_level as u32);
        out.u8(self.enc.normals as u8);
        out.u8(self.enc.intensity16 as u8);
        out.u32(self.chunks.len() as u32);
        for c in &self.chunks {
            out.key(&c.key);
            out.u64(c.count);
        }
        for lists in [&self.batches, &self.batch_blocks] {
            out.u32(lists.len() as u32);
            for l in lists {
                out.u32(l.len() as u32);
                for v in l {
                    out.u32(*v);
                }
            }
        }
        out.0
    }

    pub fn from_bytes(b: &[u8]) -> Result<Plan> {
        let mut r = In(b);
        let origin = [r.f64()?, r.f64()?, r.f64()?];
        let scale = r.f64()?;
        let log2 = r.u32()?;
        if !(4..=31).contains(&log2) {
            return Err("malformed cook plan".into());
        }
        let size = 1i64 << log2;
        let fr = E57Frame {
            grid: Grid { origin, scale },
            root: Cube {
                min: [-size / 2; 3],
                size,
            },
            log2,
        };
        let multi = r.u8()? != 0;
        let stats = Stats::from_bytes(r.take(58)?)?;
        let lp = LodParams {
            capacity: r.u64()? as usize,
            min_size: r.u64()? as i64,
            color_weight: f32::from_bits(r.u32()?),
            use_color: stats.has_color,
        };
        let enc = EncodeOptions {
            cluster_size: r.u32()? as usize,
            codec_level: r.u32()? as i32,
            normals: r.u8()? != 0,
            intensity16: r.u8()? != 0,
        };
        let mut chunks = Vec::new();
        for _ in 0..r.u32()? {
            chunks.push(Chunk {
                key: r.key()?,
                count: r.u64()?,
            });
        }
        let mut lists = || -> Result<Vec<Vec<u32>>> {
            let mut out = Vec::new();
            for _ in 0..r.u32()? {
                let n = r.u32()?;
                let mut l = Vec::with_capacity(n as usize);
                for _ in 0..n {
                    l.push(r.u32()?);
                }
                out.push(l);
            }
            Ok(out)
        };
        let batches = lists()?;
        let batch_blocks = lists()?;
        let mut plan = Plan {
            gl: grid_log2(&fr),
            fr,
            multi,
            stats,
            lp,
            enc,
            chunks,
            batches,
            batch_blocks,
            chunk_of_cell: Vec::new(),
        };
        plan.derive();
        Ok(plan)
    }
}

// -----------------------------------------------------------------------------
// stage 3: batches
// -----------------------------------------------------------------------------

/// One built chunk: the encoded nodes below its root, and the root's points
/// (kept for the tree above the chunks).
pub struct ChunkOut {
    pub key: NodeKey,
    pub nodes: Vec<Encoded>,
    pub retained: Vec<Pt>,
}

/// Build batch `bi`: decode the blocks that touch it, keep its points, build
/// and encode every chunk subtree. Chunks come back in plan order.
pub fn build_batch(src: &Blocks, plan: &Plan, bi: usize, threads: usize) -> Result<Vec<ChunkOut>> {
    let batch = plan.batches.get(bi).ok_or("no such batch")?;
    let fr = &plan.fr;
    let cells = 1usize << plan.gl;
    let mut slot = vec![u32::MAX; plan.chunks.len()];
    let mut bufs: Vec<Vec<Pt>> = Vec::with_capacity(batch.len());
    for (si, &ci) in batch.iter().enumerate() {
        slot[ci as usize] = si as u32;
        bufs.push(Vec::with_capacity(plan.chunks[ci as usize].count as usize));
    }
    let slot = &slot;
    par_each(
        plan.batch_blocks[bi].clone(),
        threads,
        |i| {
            let (b, scan) = src.decode(i)?;
            let mut mine = Vec::new();
            for k in 0..b.len() {
                let q = pt(fr, &b, k, scan, plan.multi);
                let c = cell3(fr, plan.gl, q.g);
                // a cell the counting pass saw no point in has no chunk
                let ci = plan.chunk_of_cell[c[0] + cells * (c[1] + cells * c[2])];
                let Some(&s) = slot.get(ci as usize) else {
                    return Err(
                        "internal: a point outside every chunk — the passes over the E57 disagree"
                            .into(),
                    );
                };
                if s != u32::MAX {
                    mine.push((s, q));
                }
            }
            Ok(mine)
        },
        |mine| {
            for (s, q) in mine {
                bufs[s as usize].push(q);
            }
            Ok(())
        },
    )?;
    let items: Vec<(NodeKey, Vec<Pt>)> = batch
        .iter()
        .map(|&ci| plan.chunks[ci as usize].key)
        .zip(bufs)
        .collect();
    par_map(items, threads, |(key, mut pts)| {
        // blocks arrive in any order; a total order makes the LOD selection
        // — and the output bytes — deterministic
        pts.sort_unstable();
        let tree = lod::build(key, key.cube(&fr.root), pts, &fr.grid, &plan.lp);
        let mut nodes = Vec::new();
        lod::walk(&tree, &mut |t: &Tree| {
            if t.key != key && !t.pts.is_empty() {
                nodes.push(node::encode(t.key, t.cube, &t.pts, &fr.grid, &plan.enc));
            }
        });
        Ok(ChunkOut {
            key,
            nodes,
            retained: tree.pts,
        })
    })
}

pub fn batch_to_bytes(chunks: &[ChunkOut]) -> Vec<u8> {
    let mut out = Out::default();
    out.u32(chunks.len() as u32);
    for c in chunks {
        out.key(&c.key);
        put_pts(&mut out, &c.retained);
        out.u32(c.nodes.len() as u32);
        for n in &c.nodes {
            out.node(n);
        }
    }
    out.0
}

pub fn batch_from_bytes(b: &[u8]) -> Result<Vec<ChunkOut>> {
    let mut r = In(b);
    let mut chunks = Vec::new();
    for _ in 0..r.u32()? {
        let key = r.key()?;
        let retained = get_pts(&mut r)?;
        let mut nodes = Vec::new();
        for _ in 0..r.u32()? {
            nodes.push(r.node()?);
        }
        chunks.push(ChunkOut {
            key,
            nodes,
            retained,
        });
    }
    Ok(chunks)
}

// -----------------------------------------------------------------------------
// the cook
// -----------------------------------------------------------------------------

/// The coordinator's state between batches: the output and the chunk roots.
pub struct Assembly {
    w: Writer,
    retained: HashMap<NodeKey, Vec<Pt>>,
}

impl Assembly {
    pub fn new(out: Box<dyn crate::writer::Sink>) -> Result<Assembly> {
        Ok(Assembly {
            w: Writer::new(out)?,
            retained: HashMap::new(),
        })
    }

    /// Write a built batch. Batches must arrive in plan order — the node
    /// order in the file follows it.
    pub fn add_batch(&mut self, chunks: Vec<ChunkOut>) -> Result<()> {
        for c in chunks {
            for n in c.nodes {
                self.w.add_node(n)?;
            }
            self.retained.insert(c.key, c.retained);
        }
        Ok(())
    }
}

pub fn cook(
    e: &E57,
    out: Box<dyn crate::writer::Sink>,
    o: &CookOptions,
    log: &(dyn Fn(&str) + Sync),
) -> Result<Header> {
    let t0 = crate::Clock::start();
    let el = || t0.secs();
    let mut last = -1i32;
    let src = Blocks::new(e, &mut |f| {
        let pct = (f * 20.0) as i32 * 5;
        if pct != last {
            last = pct;
            log(&format!("indexing the file {pct}%"));
        }
    })?;
    let n = src.len() as u32;
    log(&format!("{n} record blocks indexed ({:.0}s)", el()));
    let stats = stats_blocks(&src, 0..n, o.threads)?;
    let fr = E57Frame::new(&stats.bounds, o.e57_resolution)?;
    log(&format!(
        "pass 1 (bounds): {} points, root cube {:.1} m ({:.0}s)",
        stats.total,
        fr.root.size as f64 * fr.grid.scale,
        el()
    ));
    let counts = count_blocks(&src, &fr, 0..n, o.threads)?;
    let (plan, pyr) = Plan::new(stats, counts, e.scans.len() > 1, n as usize, o)?;
    log(&format!(
        "pass 2 (counts): {} chunks in {} batches, {:.1} passes of blocks to read ({:.0}s)",
        plan.chunks(),
        plan.batches(),
        plan.batch_block_total() as f64 / n.max(1) as f64,
        el()
    ));
    let mut asm = Assembly::new(out)?;
    for bi in 0..plan.batches() {
        asm.add_batch(build_batch(&src, &plan, bi, o.threads)?)?;
        log(&format!(
            "batch {}/{}: {} chunks built from {} blocks ({:.0}s)",
            bi + 1,
            plan.batches(),
            plan.batches[bi].len(),
            plan.batch_blocks[bi].len(),
            el()
        ));
    }
    finish(e, &plan, &pyr, asm, o, log, t0)
}

/// Whether two poses are one frame up to rounding — an exporter that writes
/// a scan and its cube faces from the same numbers leaves them a few ulp
/// apart.
fn same_frame(a: &Pose, b: &Pose) -> bool {
    const EPS: f64 = 1e-9;
    let (ma, mb) = (a.matrix3(), b.matrix3());
    (0..3).all(|k| (a.translation[k] - b.translation[k]).abs() < EPS)
        && (0..3).all(|r| (0..3).all(|c| (ma[r][c] - mb[r][c]).abs() < EPS))
}

/// Stage 4: the tree above the chunk roots, the panoramas, the metadata and
/// the header.
pub fn finish(
    e: &E57,
    plan: &Plan,
    pyr: &Pyramid,
    asm: Assembly,
    o: &CookOptions,
    log: &(dyn Fn(&str) + Sync),
    t0: crate::Clock,
) -> Result<Header> {
    let el = || t0.secs();
    let Assembly {
        mut w,
        mut retained,
    } = asm;
    let fr = &plan.fr;
    let gl = plan.gl;
    let lp = &plan.lp;
    let enc = plan.enc;
    let multi = plan.multi;
    let (total, has_color, has_int) = (
        plan.stats.total,
        plan.stats.has_color,
        plan.stats.has_intensity,
    );
    let count_of = |k: &NodeKey| pyr.count_of(k);

    // 4. the tree above the chunk roots
    fn upper(
        k: NodeKey,
        root: &Cube,
        retained: &mut HashMap<NodeKey, Vec<Pt>>,
        gl: u32,
        count_of: &dyn Fn(&NodeKey) -> u64,
        grid: &Grid,
        lp: &LodParams,
    ) -> Option<Tree> {
        if let Some(pts) = retained.remove(&k) {
            return Some(Tree {
                key: k,
                cube: k.cube(root),
                pts,
                children: Vec::new(),
            });
        }
        if k.depth as u32 >= gl || count_of(&k) == 0 {
            return None;
        }
        let children: Vec<Tree> = (0..8)
            .filter_map(|o| upper(k.child(o), root, retained, gl, count_of, grid, lp))
            .collect();
        if children.is_empty() {
            return None;
        }
        let mut t = Tree {
            key: k,
            cube: k.cube(root),
            pts: Vec::new(),
            children,
        };
        lod::select_up(&mut t, grid, lp);
        Some(t)
    }
    let top = upper(
        NodeKey::ROOT,
        &fr.root,
        &mut retained,
        gl,
        &count_of,
        &fr.grid,
        lp,
    )
    .ok_or("no points")?;
    if !retained.is_empty() {
        return Err("internal: chunk roots outside the upper tree".into());
    }
    let mut items = Vec::new();
    fn flatten(t: Tree, out: &mut Vec<(NodeKey, Cube, Vec<Pt>)>) {
        for c in t.children {
            flatten(c, out);
        }
        if !t.pts.is_empty() {
            out.push((t.key, t.cube, t.pts));
        }
    }
    flatten(top, &mut items);
    parallel_write(items, o.threads, &mut w, |(k, c, pts)| {
        Ok((vec![node::encode(k, c, &pts, &fr.grid, &enc)], ()))
    })?;
    log(&format!("upper tree written ({:.0}s)", el()));

    // setups / panoramas
    let stations = e.stations();
    let station_name = |si: usize| {
        let st = &stations[si];
        let n = &e.images[st.images[0]].name;
        n.split("_yaw=").next().unwrap_or(n).to_string()
    };
    let mut pano_of_station = Vec::new();
    // a station's own frame: the cube's, else its spherical image's
    let mut pose_of_station: Vec<Option<Pose>> = Vec::new();
    // a panorama that cannot be read is left out: the points are worth more
    // than a cook that fails at its last step
    let mut skipped = 0usize;
    for (si, st) in stations.iter().enumerate() {
        let mut pano = serde_json::Value::Null;
        let mut pose = st.pose;
        let mut unread = None;
        if let (Some(cube), true) = (st.cube, o.pano_max_size > 0) {
            // all six faces are read before one is written, so a cube is
            // in the file whole or not at all
            let read: scan_core::Result<Vec<_>> = cube
                .iter()
                .map(|&ii| {
                    let im = &e.images[ii];
                    im.image
                        .filter(|_| im.width <= o.pano_max_size && im.height <= o.pano_max_size)
                        .map(|blob| e.read_blob(&blob).map(|bytes| (im, blob, bytes)))
                        .transpose()
                })
                .collect();
            match read {
                Ok(read) => {
                    let mut faces = Vec::new();
                    for face in read {
                        let mut levels = Vec::new();
                        if let Some((im, blob, bytes)) = face {
                            let b = w.add_blob(&bytes)?;
                            levels.push((im.width, im.height, blob.format.extension(), b));
                        }
                        faces.push(levels);
                    }
                    pano = pano_json(faces);
                }
                Err(err) => unread = Some(err),
            }
        } else if o.pano_max_size > 0 {
            // one equirectangular image per station (most non-Leica E57s);
            // kept whole — a sphere cannot be downscaled here, the viewer does
            let sphere = st.images.iter().find_map(|&ii| {
                let im = &e.images[ii];
                match (&im.projection, im.image) {
                    (
                        Projection::Spherical {
                            pixel_width,
                            pixel_height,
                        },
                        Some(blob),
                    ) => Some((im, blob, *pixel_width, *pixel_height)),
                    _ => None,
                }
            });
            if let Some((im, blob, pw, ph)) = sphere {
                match e.read_blob(&blob) {
                    Ok(bytes) => {
                        let b = w.add_blob(&bytes)?;
                        pano = json!({
                            "kind": "sphere",
                            "rotation": im.pose.rotation,
                            "pixel_width": pw,
                            "pixel_height": ph,
                            "levels": [{
                                "width": im.width, "height": im.height,
                                "format": blob.format.extension(), "offset": b.offset, "size": b.size
                            }],
                        });
                        pose = Some(im.pose);
                    }
                    Err(err) => unread = Some(err),
                }
            }
        }
        if let Some(err) = unread {
            skipped += 1;
            log(&format!(
                "warning: panorama of {} left out: {err}",
                station_name(si)
            ));
        }
        pano_of_station.push(pano);
        pose_of_station.push(pose);
    }
    let mut setups = Vec::new();
    if multi {
        if e.scans.len() > SETUP_VALUES {
            log(&format!(
                "warning: {} scans, a point's setup index holds {SETUP_VALUES}: the points of \
                 scans {SETUP_VALUES} and up are stored as setup {}",
                e.scans.len(),
                SETUP_VALUES - 1
            ));
        }
        for (si, sc) in e.scans.iter().enumerate() {
            // the station at the scanner position, else one whose images
            // name this scan (a camera a few centimetres off the mirror)
            let near = stations
                .iter()
                .position(|st| {
                    (0..3).all(|k| (st.position[k] - sc.pose.translation[k]).abs() < 0.01)
                })
                .or_else(|| {
                    stations.iter().position(|st| {
                        e.images[st.images[0]].scan_guid.as_deref() == Some(sc.guid.as_str())
                    })
                });
            // The panorama is drawn in the setup's frame, so a setup with a
            // station takes the station's: the scan pose need not be it (a
            // scan whose points are already in world coordinates has the
            // identity). Where the two are the same frame the scan's own
            // numbers are kept.
            let pose = near
                .and_then(|i| pose_of_station[i])
                .filter(|p| !same_frame(p, &sc.pose))
                .unwrap_or(sc.pose);
            setups.push(json!({
                "index": si, "name": sc.name, "guid": sc.guid, "pose": pose,
                "panorama": near.map_or(serde_json::Value::Null, |i| pano_of_station[i].clone()),
            }));
        }
    } else {
        for si in 0..stations.len() {
            // without a cube or a sphere the station still stands where its
            // images were taken
            let pose = pose_of_station[si].unwrap_or(Pose {
                translation: stations[si].position,
                ..Pose::IDENTITY
            });
            setups.push(json!({
                "index": null, "name": station_name(si), "pose": pose,
                "panorama": pano_of_station[si].clone(),
            }));
        }
    }
    let mut meta = base_meta(
        json!({ "format": "e57", "guid": e.guid, "library": e.library_version, "point_count": total }),
        o,
    );
    meta.insert("frame".into(), "E57 world (scan poses applied)".into());
    meta.insert("grid_scale".into(), fr.grid.scale.into());
    meta.insert("node_capacity".into(), o.node_capacity.into());
    meta.insert("setups".into(), setups.into());
    let flags = if has_color { FLAG_COLOR } else { 0 }
        | if has_int { FLAG_INTENSITY } else { 0 }
        | if multi { FLAG_SETUP } else { 0 }
        | if has_int && !o.intensity16 {
            crate::format::FLAG_INTENSITY8
        } else {
            0
        };
    let n_setups = if multi { e.scans.len() } else { stations.len() };
    let h = w.finish(
        fr.root,
        &fr.grid,
        o.cluster_size,
        flags,
        n_setups as u32,
        &serde_json::Value::Object(meta),
    )?;
    log(&format!(
        "done: {} nodes, {} points, {:.0}s{}",
        h.node_count,
        h.point_count,
        el(),
        skipped_note(skipped)
    ));
    if h.point_count != total {
        return Err(format!("wrote {} points, E57 has {total}", h.point_count).into());
    }
    Ok(h)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_frame_ignores_rounding_only() {
        let scan = Pose {
            rotation: [
                0.9585791041515123,
                2.6407373487654717e-6,
                -4.90269289502618e-7,
                -0.2848264402699833,
            ],
            translation: [-86.458505941488, 189.51900511940778, -0.03410045882379331],
        };
        // the same frame as an exporter writes it for the cube's down face
        let station = Pose {
            rotation: [
                0.9585791041515122,
                2.6407373496547953e-6,
                -4.902692897688931e-7,
                -0.2848264402699833,
            ],
            ..scan
        };
        assert!(same_frame(&scan, &station));
        // q and −q are one rotation
        let negated = Pose {
            rotation: station.rotation.map(|v| -v),
            ..station
        };
        assert!(same_frame(&scan, &negated));
        // a scan already in world coordinates is not its station's frame
        assert!(!same_frame(&Pose::IDENTITY, &station));
        let moved = Pose {
            translation: [-86.458505941488, 189.51900511940778, 0.0],
            ..scan
        };
        assert!(!same_frame(&scan, &moved));
    }

    #[test]
    fn far_apart_points_name_the_problem() {
        let bounds = Aabb {
            min: [0.0; 3],
            max: [5.0e6, 1.0, 1.0],
        };
        let err = E57Frame::new(&bounds, 0.001).err().unwrap().to_string();
        assert!(
            err.contains("2147 km") && err.contains("stray points"),
            "{err}"
        );
        assert!(E57Frame::new(&bounds, 0.01).is_ok());
    }
}
