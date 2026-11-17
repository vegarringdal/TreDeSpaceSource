//! Node payload encoding/decoding.
//!
//! ```text
//! u32 point_count | u32 cluster_count | u32 pos_stream_size | u32 attr_stream_size
//! | u32 normal_stream_size (0 = no normals)
//! ClusterRecord × cluster_count            (32 B each)
//! position stream  (meshopt vertex codec v1, 8 B/vertex: u16 qx qy qz, u16 intensity)
//! attribute stream (meshopt vertex codec v1, 4 B/vertex: u8 r−g g b−g setup,
//!                   the node record flagged NODE_COLOR_DELTA)
//! normal stream    (optional, meshopt vertex codec v1, 4 B/vertex: u16 ring code, u16 0)
//! ```
//! each stream padded to 4 bytes. Points are in cluster order
//! (`meshopt_spatialClusterPoints`); cluster `i` covers points
//! `[first, first + count)`.

use crate::format::*;
use crate::mo;

/// A point on the cook's integer grid.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, PartialOrd, Ord)]
#[repr(C)]
pub struct Pt {
    /// Grid coordinates relative to the grid origin.
    pub g: [i32; 3],
    pub rgb: [u8; 3],
    pub setup: u8,
    pub intensity: u16,
    /// Normal as a 16-bit ring code (`docs/TDPP_FORMAT.md`; the LGSX
    /// `CodecNormal16PcApi`), `NO_NORMAL` when the source has none.
    pub n: u16,
}

/// The intensity bits an 8-bit cook keeps.
pub const INTENSITY8_MASK: u16 = 0xff00;

/// Ring code meaning "no normal".
pub const NO_NORMAL: u16 = u16::MAX;

pub use scan_core::lgsx::apr::{normal_from_code, normal_to_code};

/// The integer grid: `world = origin + g · scale`.
#[derive(Clone, Copy, Debug)]
pub struct Grid {
    pub origin: [f64; 3],
    pub scale: f64,
}

/// An octree cube in grid units.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Cube {
    pub min: [i64; 3],
    pub size: i64,
}

impl Cube {
    pub fn child(&self, octant: usize) -> Cube {
        let h = self.size / 2;
        Cube {
            min: [
                self.min[0] + if octant & 1 != 0 { h } else { 0 },
                self.min[1] + if octant & 2 != 0 { h } else { 0 },
                self.min[2] + if octant & 4 != 0 { h } else { 0 },
            ],
            size: h,
        }
    }
    pub fn octant_of(&self, g: [i32; 3]) -> usize {
        let h = self.size / 2;
        ((g[0] as i64 - self.min[0] >= h) as usize)
            | (((g[1] as i64 - self.min[1] >= h) as usize) << 1)
            | (((g[2] as i64 - self.min[2] >= h) as usize) << 2)
    }
}

/// Octree address: depth below the root and cube index at that depth.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct NodeKey {
    pub depth: u8,
    pub x: u32,
    pub y: u32,
    pub z: u32,
}

impl NodeKey {
    pub const ROOT: NodeKey = NodeKey {
        depth: 0,
        x: 0,
        y: 0,
        z: 0,
    };
    pub fn child(&self, octant: usize) -> NodeKey {
        NodeKey {
            depth: self.depth + 1,
            x: 2 * self.x + (octant & 1) as u32,
            y: 2 * self.y + ((octant >> 1) & 1) as u32,
            z: 2 * self.z + ((octant >> 2) & 1) as u32,
        }
    }
    pub fn parent(&self) -> Option<NodeKey> {
        (self.depth > 0).then(|| NodeKey {
            depth: self.depth - 1,
            x: self.x / 2,
            y: self.y / 2,
            z: self.z / 2,
        })
    }
    pub fn octant(&self) -> usize {
        ((self.x & 1) | ((self.y & 1) << 1) | ((self.z & 1) << 2)) as usize
    }
    pub fn cube(&self, root: &Cube) -> Cube {
        let s = root.size >> self.depth;
        Cube {
            min: [
                root.min[0] + self.x as i64 * s,
                root.min[1] + self.y as i64 * s,
                root.min[2] + self.z as i64 * s,
            ],
            size: s,
        }
    }
}

/// An encoded node, ready for the writer.
pub struct Encoded {
    pub key: NodeKey,
    pub payload: Vec<u8>,
    pub record: NodeRecord,
}

#[derive(Clone, Copy, Debug)]
pub struct EncodeOptions {
    pub cluster_size: usize,
    pub codec_level: i32,
    /// Write the optional normal stream.
    pub normals: bool,
    /// Keep all 16 intensity bits (default: the high 8 — the low byte of a
    /// scan's intensity is noise that costs about a byte per point).
    pub intensity16: bool,
}

fn pad4(v: &mut Vec<u8>) {
    while !v.len().is_multiple_of(4) {
        v.push(0);
    }
}

/// Largest extent a cluster's u16 coordinates hold at one grid unit per step.
const CLUSTER_SPAN: i64 = 65535;

fn extent(pts: &[Pt], ids: &[u32]) -> ([i32; 3], [i32; 3]) {
    let (mut lo, mut hi) = ([i32::MAX; 3], [i32::MIN; 3]);
    for &i in ids {
        let g = pts[i as usize].g;
        for k in 0..3 {
            lo[k] = lo[k].min(g[k]);
            hi[k] = hi[k].max(g[k]);
        }
    }
    (lo, hi)
}

/// Hand `ids` on as clusters that each span at most `CLUSTER_SPAN` grid units
/// per axis: a wider one (sparse points of a coarse level, far apart) is cut
/// at the middle of its longest axis until the halves fit, keeping the order.
/// Without this such a cluster would need a step above one grid unit and its
/// points would no longer be stored exactly.
fn split_to_fit(pts: &[Pt], ids: Vec<u32>, out: &mut Vec<Vec<u32>>) {
    let (lo, hi) = extent(pts, &ids);
    let ext = |k: usize| hi[k] as i64 - lo[k] as i64;
    let axis = (0..3).max_by_key(|&k| ext(k)).unwrap_or(0);
    if ids.is_empty() || ext(axis) <= CLUSTER_SPAN {
        if !ids.is_empty() {
            out.push(ids);
        }
        return;
    }
    let mid = lo[axis] as i64 + ext(axis) / 2;
    let (a, b): (Vec<u32>, Vec<u32>) = ids
        .into_iter()
        .partition(|&i| pts[i as usize].g[axis] as i64 <= mid);
    split_to_fit(pts, a, out);
    split_to_fit(pts, b, out);
}

/// Points a cell of the spacing measurement holds when the node is one flat
/// sheet across its cube (cells per edge = √points / √this).
const SPACING_CELL_POINTS: usize = 64;
/// Most cells per cube edge in the spacing measurement.
const SPACING_MAX_CELLS: i64 = 1024;

/// The point spacing of a node (metres), measured from its points: the LOD
/// metric a viewer projects to decide whether the node needs refining.
///
/// `edge / √points` would be right for ONE flat sheet of points across the
/// cube. A real node holds several surfaces — both faces of a wall, a floor
/// and what stands on it — or a surface that covers only a corner of the
/// cube, so its points lie wider or closer than that. The surface they cover
/// is estimated instead: the cube is cut into cells several point spacings
/// wide, and the occupied cells are counted — a sheet occupies one layer of
/// cells, so `occupied · cell²` approximates its area whatever its shape — and
/// the spacing is `√(area / points)`. Integer cell arithmetic, an exact count
/// and one square root: the same on every machine. A surface oblique to the
/// grid crosses up to √3 times the cells of its area, so this reads up to
/// about 30 % wide, never narrow; for a node of few points (one cell) it is
/// `edge / √points` again.
fn measured_spacing(pts: &[Pt], cube: &Cube, scale: f64) -> f64 {
    let n = pts.len();
    let side = ((n / SPACING_CELL_POINTS) as f64).sqrt() as i64;
    // a power of two, so the cells nest in the (power-of-two) octree cube
    let cells = (side.clamp(1, SPACING_MAX_CELLS) as u64 + 1).next_power_of_two() as i64 / 2;
    let cell = (cube.size / cells).max(1);
    let per_edge = (cube.size / cell).max(1);
    let mut keys: Vec<u64> = pts
        .iter()
        .map(|p| {
            let c = |k: usize| ((p.g[k] as i64 - cube.min[k]) / cell).clamp(0, per_edge - 1) as u64;
            (c(0) * per_edge as u64 + c(1)) * per_edge as u64 + c(2)
        })
        .collect();
    keys.sort_unstable();
    keys.dedup();
    cell as f64 * scale * (keys.len() as f64 / n as f64).sqrt()
}

/// Encode one node's points. `cube` is the node cube on `grid`.
pub fn encode(key: NodeKey, cube: Cube, pts: &[Pt], grid: &Grid, o: &EncodeOptions) -> Encoded {
    let n = pts.len();
    let s = grid.scale;
    let rel = |g: i32, k: usize| (g as i64 - cube.min[k]) as f64 * s;
    let pos: Vec<[f32; 3]> = pts
        .iter()
        .map(|p| {
            [
                rel(p.g[0], 0) as f32,
                rel(p.g[1], 1) as f32,
                rel(p.g[2], 2) as f32,
            ]
        })
        .collect();
    let order = mo::spatial_cluster_points(&pos, o.cluster_size);

    let mut clusters = Vec::new();
    let mut pos_raw = Vec::with_capacity(n * POS_VERTEX_SIZE);
    let mut attr_raw = Vec::with_capacity(n * ATTR_VERTEX_SIZE);
    let mut nrm_raw = Vec::with_capacity(if o.normals { n * NORMAL_VERTEX_SIZE } else { 0 });
    let (mut lo, mut hi) = ([i32::MAX; 3], [i32::MIN; 3]);
    let mut setup_mask = 0u64;
    let mut parts = Vec::with_capacity(n.div_ceil(o.cluster_size));
    for chunk in order.chunks(o.cluster_size) {
        split_to_fit(pts, chunk.to_vec(), &mut parts);
    }
    let mut first = 0usize;
    for chunk in &parts {
        let (cmin, cmax) = extent(pts, chunk);
        // every cluster spans ≤ 65535 grid units (split_to_fit), so the
        // step is one grid unit and grid-aligned input is stored exactly
        let step = [1i64; 3];
        for k in 0..3 {
            lo[k] = lo[k].min(cmin[k]);
            hi[k] = hi[k].max(cmax[k]);
        }
        clusters.push(ClusterRecord {
            min: [
                rel(cmin[0], 0) as f32,
                rel(cmin[1], 1) as f32,
                rel(cmin[2], 2) as f32,
            ],
            step: [
                (step[0] as f64 * s) as f32,
                (step[1] as f64 * s) as f32,
                (step[2] as f64 * s) as f32,
            ],
            first: first as u32,
            count: chunk.len() as u32,
        });
        first += chunk.len();
        for &i in chunk {
            let p = &pts[i as usize];
            for (g, lo) in p.g.iter().zip(&cmin) {
                let q = *g as i64 - *lo as i64;
                pos_raw.extend_from_slice(&(q as u16).to_le_bytes());
            }
            let intensity = if o.intensity16 {
                p.intensity
            } else {
                p.intensity & INTENSITY8_MASK
            };
            pos_raw.extend_from_slice(&intensity.to_le_bytes());
            let [r, g, b] = p.rgb;
            attr_raw.extend_from_slice(&[r.wrapping_sub(g), g, b.wrapping_sub(g), p.setup]);
            if o.normals {
                nrm_raw.extend_from_slice(&p.n.to_le_bytes());
                nrm_raw.extend_from_slice(&[0, 0]);
            }
            setup_mask |= 1u64 << (p.setup as u32).min(63);
        }
    }
    let pos_enc = mo::encode_vertex(&pos_raw, POS_VERTEX_SIZE, o.codec_level);
    let attr_enc = mo::encode_vertex(&attr_raw, ATTR_VERTEX_SIZE, o.codec_level);
    let nrm_enc = if o.normals {
        mo::encode_vertex(&nrm_raw, NORMAL_VERTEX_SIZE, o.codec_level)
    } else {
        Vec::new()
    };

    let mut payload = Vec::with_capacity(
        PAYLOAD_HEADER_SIZE
            + clusters.len() * CLUSTER_RECORD_SIZE
            + pos_enc.len()
            + attr_enc.len()
            + 8,
    );
    payload.extend_from_slice(&(n as u32).to_le_bytes());
    payload.extend_from_slice(&(clusters.len() as u32).to_le_bytes());
    payload.extend_from_slice(&(pos_enc.len() as u32).to_le_bytes());
    payload.extend_from_slice(&(attr_enc.len() as u32).to_le_bytes());
    payload.extend_from_slice(&(nrm_enc.len() as u32).to_le_bytes());
    for c in &clusters {
        let mut b = [0u8; CLUSTER_RECORD_SIZE];
        let mut w = W(&mut b, 0);
        for v in c.min.iter().chain(&c.step) {
            w.f32(*v);
        }
        w.u32(c.first);
        w.u32(c.count);
        payload.extend_from_slice(&b);
    }
    payload.extend_from_slice(&pos_enc);
    pad4(&mut payload);
    payload.extend_from_slice(&attr_enc);
    pad4(&mut payload);
    payload.extend_from_slice(&nrm_enc);
    pad4(&mut payload);

    let cs = cube.size as f64 * s;
    let to_rel = |g: i32| (g as f64 * s) as f32;
    let record = NodeRecord {
        cube_min: [
            (cube.min[0] as f64 * s) as f32,
            (cube.min[1] as f64 * s) as f32,
            (cube.min[2] as f64 * s) as f32,
        ],
        cube_size: cs as f32,
        bounds_min: if n > 0 {
            [to_rel(lo[0]), to_rel(lo[1]), to_rel(lo[2])]
        } else {
            [0.0; 3]
        },
        bounds_max: if n > 0 {
            [to_rel(hi[0]), to_rel(hi[1]), to_rel(hi[2])]
        } else {
            [0.0; 3]
        },
        spacing: if n > 0 {
            measured_spacing(pts, &cube, s) as f32
        } else {
            cs as f32
        },
        point_count: n as u32,
        cluster_count: clusters.len() as u32,
        payload_size: payload.len() as u32,
        setup_mask,
        depth: key.depth,
        octant: key.octant() as u8,
        flags: NODE_COLOR_DELTA,
        ..Default::default()
    };
    Encoded {
        key,
        payload,
        record,
    }
}

/// A decoded node payload.
#[derive(Clone, Debug, Default)]
pub struct Decoded {
    pub clusters: Vec<ClusterRecord>,
    /// Positions relative to the header origin (f64 for verification).
    pub positions: Vec<[f64; 3]>,
    pub rgb: Vec<[u8; 3]>,
    pub intensity: Vec<u16>,
    pub setup: Vec<u8>,
    /// Normal ring codes; empty when the node has no normal stream.
    pub normals: Vec<u16>,
}

/// Decode a node payload given its record.
pub fn decode(rec: &NodeRecord, payload: &[u8]) -> Result<Decoded, String> {
    if payload.len() < PAYLOAD_HEADER_SIZE {
        return Err("payload shorter than its header".into());
    }
    let mut r = R(payload, 0);
    let (n, nc, ps, as_, ns) = (
        r.u32() as usize,
        r.u32() as usize,
        r.u32() as usize,
        r.u32() as usize,
        r.u32() as usize,
    );
    if n != rec.point_count as usize || nc != rec.cluster_count as usize {
        return Err("payload header disagrees with the node record".into());
    }
    let tab = PAYLOAD_HEADER_SIZE;
    let pos_at = tab + nc * CLUSTER_RECORD_SIZE;
    let attr_at = pos_at + ps.div_ceil(4) * 4;
    let nrm_at = attr_at + as_.div_ceil(4) * 4;
    if nrm_at + ns > payload.len() {
        return Err("payload streams overrun".into());
    }
    let mut clusters = Vec::with_capacity(nc);
    let mut cr = R(payload, tab);
    for _ in 0..nc {
        clusters.push(ClusterRecord {
            min: [cr.f32(), cr.f32(), cr.f32()],
            step: [cr.f32(), cr.f32(), cr.f32()],
            first: cr.u32(),
            count: cr.u32(),
        });
    }
    let pos = mo::decode_vertex(&payload[pos_at..pos_at + ps], n, POS_VERTEX_SIZE)
        .map_err(|e| format!("pos stream: {e}"))?;
    let attr = mo::decode_vertex(&payload[attr_at..attr_at + as_], n, ATTR_VERTEX_SIZE)
        .map_err(|e| format!("attr stream: {e}"))?;
    let nrm = if ns > 0 {
        mo::decode_vertex(&payload[nrm_at..nrm_at + ns], n, NORMAL_VERTEX_SIZE)
            .map_err(|e| format!("normal stream: {e}"))?
    } else {
        Vec::new()
    };
    let delta = rec.flags & NODE_COLOR_DELTA != 0;
    let mut d = Decoded {
        positions: Vec::with_capacity(n),
        rgb: Vec::with_capacity(n),
        intensity: Vec::with_capacity(n),
        setup: Vec::with_capacity(n),
        ..Default::default()
    };
    for c in &clusters {
        for i in c.first as usize..(c.first + c.count) as usize {
            let q =
                |k: usize| u16::from_le_bytes([pos[8 * i + 2 * k], pos[8 * i + 2 * k + 1]]) as f64;
            let mut p = [0.0; 3];
            for (k, v) in p.iter_mut().enumerate() {
                *v = rec.cube_min[k] as f64 + c.min[k] as f64 + q(k) * c.step[k] as f64;
            }
            d.positions.push(p);
            d.intensity
                .push(u16::from_le_bytes([pos[8 * i + 6], pos[8 * i + 7]]));
            let g = attr[4 * i + 1];
            d.rgb.push(if delta {
                [
                    attr[4 * i].wrapping_add(g),
                    g,
                    attr[4 * i + 2].wrapping_add(g),
                ]
            } else {
                [attr[4 * i], g, attr[4 * i + 2]]
            });
            d.setup.push(attr[4 * i + 3]);
            if ns > 0 {
                d.normals
                    .push(u16::from_le_bytes([nrm[4 * i], nrm[4 * i + 1]]));
            }
        }
    }
    d.clusters = clusters;
    if d.positions.len() != n {
        return Err("clusters do not cover the node's points".into());
    }
    Ok(d)
}

#[cfg(test)]
mod tests {
    use super::*;

    const EDGE: i64 = 4096;
    const SCALE: f64 = 0.001;

    /// A `side × side` sheet of points at height `z` over `[0, extent)²`.
    fn sheet(side: i64, extent: i64, z: i32) -> Vec<Pt> {
        let step = extent / side;
        (0..side * side)
            .map(|i| Pt {
                g: [((i % side) * step) as i32, ((i / side) * step) as i32, z],
                ..Pt::default()
            })
            .collect()
    }

    fn spacing(pts: &[Pt]) -> f64 {
        let cube = Cube {
            min: [0; 3],
            size: EDGE,
        };
        measured_spacing(pts, &cube, SCALE)
    }

    #[test]
    fn one_sheet_across_the_cube_is_edge_over_root_points() {
        let pts = sheet(256, EDGE, 100);
        let flat = EDGE as f64 * SCALE / (pts.len() as f64).sqrt();
        assert!(
            (spacing(&pts) - flat).abs() < flat * 0.01,
            "{}",
            spacing(&pts)
        );
    }

    #[test]
    fn the_same_points_on_two_sheets_lie_wider() {
        // half the points on each of two sheets far apart: each sheet is
        // √2 sparser than one sheet holding them all
        let mut pts = sheet(181, EDGE, 100);
        pts.extend(sheet(181, EDGE, 3000));
        let flat = EDGE as f64 * SCALE / (pts.len() as f64).sqrt();
        let got = spacing(&pts);
        assert!((got / flat - 2f64.sqrt()).abs() < 0.05, "{}", got / flat);
    }

    #[test]
    fn a_sheet_over_a_quarter_of_the_cube_lies_closer() {
        let pts = sheet(256, EDGE / 2, 100);
        let flat = EDGE as f64 * SCALE / (pts.len() as f64).sqrt();
        let got = spacing(&pts);
        assert!((got / flat - 0.5).abs() < 0.03, "{}", got / flat);
    }

    #[test]
    fn a_few_points_fall_back_to_edge_over_root_points() {
        let pts = sheet(4, EDGE, 0);
        let flat = EDGE as f64 * SCALE / 4.0;
        assert_eq!(spacing(&pts), flat);
    }
}
