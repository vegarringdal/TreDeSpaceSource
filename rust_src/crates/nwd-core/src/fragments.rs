//! Fragment / spatial-leaf parser — `LcOpNwdFragments` / `LcOpNwdSpatialHierarchy`
//! chunk.
//!
//! Each leaf carries a placement: a small **local f32 bounding box** followed by
//! a **world f64 translation** (plus rotation/scale we don't fully model yet) —
//! see `docs/what_we_know_v1.md`. Records repeat on a fixed stride. We extract the
//! world translation (validated: the set's world bbox matches the RVM oracle) and
//! the local bbox where present.
//!
//! Coordinate map to glTF (Y-up): the NWD native triple `(c0, c1, c2)` becomes
//! `(c0, c2, −c1)` — the same Z-up→Y-up convention the reference uses, confirmed
//! against the oracle bbox.

use crate::error::Result;

#[derive(Debug, Clone)]
pub struct Fragment {
    /// Byte offset of the translation triple within the chunk.
    pub offset: usize,
    /// World translation in NWD-native axes (c0, c1, c2).
    pub translation: [f64; 3],
    /// Local-space AABB (min xyz, max xyz) if a valid one sat at the fixed
    /// `offset-24` slot; `None` for the variable-size records (use
    /// [`candidate_bboxes`] to recover those).
    pub local_bbox: Option<[f32; 6]>,
    /// The **per-root / sub-system PARTITION** id: the `u32` sitting 8 bytes
    /// before the `[93]` placement marker (i.e. at `marker_offset - 8`). It is
    /// contiguous and increments per root in placement-stream order, so a run of
    /// equal `marker8` values is one root's (or one sub-system's) contiguous block
    /// of placements. `None` for parse-only (matrix-format) fragments that carry
    /// no type-93 marker. See `MEMORY` / `what_we_know` §25/§26.
    pub marker8: Option<u32>,
    /// The **per-leaf GROUP id**: the `u32` at `marker_offset + 100`. Within each
    /// `marker8` (idA root) partition it is STRICTLY MONOTONIC NON-DECREASING; its
    /// maximal equal-value runs partition placements ONE RUN PER GEOMETRY LEAF, in
    /// hierarchy DFS pre-order. This is the VERIFIED grouping signal that drives the
    /// linker's per-leaf attribution. `None` for matrix-format parse-only fragments
    /// (no type-93 marker). See task brief / `what_we_know`.
    pub group: Option<u32>,
    /// The **render-class flag**: the `u32` at `marker_offset + 96`. Observed
    /// values: `0x40012100` = weld-disc multi-primitive sub-part, `0x40002102` =
    /// solid/facet. Used to corroborate the multi-primitive (weld-disc) leaves.
    /// `None` for matrix-format parse-only fragments.
    pub class_flag: Option<u32>,
    /// The **1-based index into the FULL on-disk geometry-record array** (magic
    /// mesh records + undecoded AUX slots, in disk order): the `u32` at
    /// `marker_offset + 64`. This is the EXACT fragment→geometry read-out — it
    /// names the precise record (orientation included) for this placement. Map it
    /// through [`crate::geometry::record_index_map`] to the decoded mesh, or treat
    /// out-of-range / AUX as "no read-out" → fall back to the bbox match. `None`
    /// for matrix-format parse-only fragments (no type-93 marker).
    pub geom_record_idx: Option<u32>,
}

impl Fragment {
    /// World translation mapped to glTF Y-up space.
    pub fn translation_glb(&self) -> [f32; 3] {
        let [c0, c1, c2] = self.translation;
        [c0 as f32, c2 as f32, -c1 as f32]
    }
}

fn read_f64(buf: &[u8], o: usize) -> f64 {
    f64::from_le_bytes(buf[o..o + 8].try_into().unwrap())
}
fn read_f32(buf: &[u8], o: usize) -> f32 {
    f32::from_le_bytes(buf[o..o + 4].try_into().unwrap())
}
fn read_u32(buf: &[u8], o: usize) -> u32 {
    u32::from_le_bytes(buf[o..o + 4].try_into().unwrap())
}

/// True if the parse-only candidate at translation offset `o` is a stride-116
/// PARTITION-HEADER record (root anchor) rather than a real placement. Its world
/// translation sits at marker+28 (vs +32), so the candidate scanner lands on it; the
/// signature is a `[93]` marker 28 bytes back, idA (marker-8) == 0 — a sentinel real
/// placements never carry — and group (marker+100) == 0. The trailer holds a
/// root→leaf-range map (+108 = container id, marker-4 = first leaf, +112 = range end).
/// These are METADATA; they are load-bearing in the linker so they are kept and
/// rendered, but they are LABELLED as markers (not geometry). See what_we_know §36.
pub fn is_partition_header(chunk: &[u8], o: usize) -> bool {
    o >= 36
        && o + 76 <= chunk.len()
        && read_u32(chunk, o - 28) == 93
        && read_u32(chunk, o - 36) == 0
        && read_u32(chunk, o + 72) == 0
}

/// Parse the chunk's **type-93 placement records** directly. Each record is a
/// `[93]` u32 marker, then a 6×f32 local AABB (at +4), a 4-byte slot, and a
/// 3×f64 world translation (at +32); the object id sits at marker−4. Yields one
/// `Fragment` per record, so every distinct instance is preserved — unlike the
/// `candidate_triples` heuristic, which under-finds and then needs lossy
/// distance dedup. Empty if the chunk holds no such records.
pub fn placements(chunk: &[u8]) -> Vec<Fragment> {
    let loose = |v: f64| v.is_finite() && (1.0..=1.0e7).contains(&v.abs());
    let n = chunk.len();
    let mut out = Vec::new();
    let mut o = 0usize;
    while o + 4 <= n {
        if read_u32(chunk, o) == 93 && o + 56 <= n {
            let bb = [
                read_f32(chunk, o + 4),
                read_f32(chunk, o + 8),
                read_f32(chunk, o + 12),
                read_f32(chunk, o + 16),
                read_f32(chunk, o + 20),
                read_f32(chunk, o + 24),
            ];
            // The 3×f64 world translation starts at the next 8-BYTE-ALIGNED
            // offset after the bbox (markers at o%8==0 → o+32 with a 4-byte pad;
            // markers at o%8==4 → o+28, no pad). Reading a fixed o+32 rejected
            // every odd-aligned record as garbage, degrading it to the parse-only
            // path (square own-AABB placeholder, no marker+64 read-out) — e.g.
            // FLANGE rim disc faces. All record-tail fields shift with it.
            let tbase = (o + 28).div_ceil(8) * 8;
            let t = [
                read_f64(chunk, tbase),
                read_f64(chunk, tbase + 8),
                read_f64(chunk, tbase + 16),
            ];
            // `loose` (every |coordinate| ≥ 1 m) was the original plausibility
            // gate; it silently DROPS real placements near a world axis plane
            // (Huldra: wellhead conductors at z = −0.4 m, a box at z = 0 — the
            // FBX export has them). Such records are recognised instead by
            // their record-tail constants `[13][0]` at translation+40 — present
            // on every type-93 record in the corpus and on no false candidate.
            let tail_ok = tbase + 48 <= n
                && read_u32(chunk, tbase + 40) == 13
                && read_u32(chunk, tbase + 44) == 0;
            let t_ok = t.iter().all(|&v| v.is_finite() && v.abs() <= 1.0e7)
                && (t.iter().all(|&v| loose(v)) || tail_ok);
            if valid_local_bbox(&bb) && t_ok {
                // marker8 = the partition id: at o-8 for aligned records; a
                // shifted (partition-first) record's own idA slot is a 0 sentinel
                // and its partition id sits inside the insert at o-80.
                let marker8 = if o % 8 == 0 {
                    (o >= 8).then(|| read_u32(chunk, o - 8))
                } else {
                    (o >= 80).then(|| read_u32(chunk, o - 80))
                };
                // group  = the per-leaf grouping id at marker+100;
                // class_flag = the render-class flag at marker+96.
                // The 120-B record FRAME spans o-20 .. o+100 (the [93] marker sits
                // 20 bytes into its own record), so the u32 at o+100 is the NEXT
                // record's group — reading it there shifted every leaf-run boundary
                // by one fragment (caught by click-testing: a cylinder's body
                // landed in the following element's group). This record's own
                // group is at o-20, its class flag at o-24. Verified: per-leaf
                // co-primitive spread drops 0.79 m -> 0.35 m corpus-wide.
                // Pre-marker fields. ALIGNED frame (o%8==0): group at o-20,
                // class flag at o-24. The SHIFTED records (o%8==4) are each
                // partition's FIRST placement: a 68-byte partition insert (two
                // interned records: partition id `pid` + a material) sits between
                // their group field and the idA/idB slots, so their own fields
                // live further back: class_flag at o-92, group at o-88, and the
                // partition id (the idA all following placements carry) at o-80.
                // Field-mapped corpus-wide (23/23 shifted records across 8 files;
                // groups fit the monotone sequence, flags obey the target rule).
                let aligned = o % 8 == 0;
                let group = if aligned {
                    (o >= 20).then(|| read_u32(chunk, o - 20))
                } else {
                    (o >= 88).then(|| read_u32(chunk, o - 88))
                };
                let class_flag = if aligned {
                    (o >= 24).then(|| read_u32(chunk, o - 24))
                } else {
                    (o >= 92).then(|| read_u32(chunk, o - 92))
                };
                // geom_record_idx = the 1-based on-disk geometry-record index,
                // 32 bytes after the translation start (= marker+64 for the
                // padded/aligned layout; shifts −4 for the o%8==4 records).
                let geom_record_idx = (tbase + 36 <= n).then(|| read_u32(chunk, tbase + 32));
                out.push(Fragment {
                    offset: tbase,
                    translation: t,
                    local_bbox: Some(bb),
                    marker8,
                    group,
                    class_flag,
                    geom_record_idx,
                });
                o += 56;
                continue;
            }
        }
        o += 4;
    }
    out
}

/// A valid local AABB has min ≤ max on every axis and small-ish extents.
fn valid_local_bbox(bb: &[f32; 6]) -> bool {
    (0..3).all(|i| bb[i] <= bb[i + 3] && bb[i + 3] - bb[i] <= 1.0e4)
        && bb.iter().all(|v| v.is_finite())
}

/// A candidate world-translation triple: three consecutive 4-byte-aligned f64,
/// all finite and non-trivial, where the value right after is *not* another such
/// coord (so we catch the isolated translation, not a run inside a 4×4 matrix).
fn candidate_triples(chunk: &[u8]) -> Vec<(usize, [f64; 3])> {
    let loose = |v: f64| v.is_finite() && (1.0..=1.0e7).contains(&v.abs());
    let n = chunk.len();
    let mut out = Vec::new();
    let mut o = 0usize;
    while o + 24 <= n {
        let a = read_f64(chunk, o);
        let b = read_f64(chunk, o + 8);
        let c = read_f64(chunk, o + 16);
        let after = o + 32 <= n && loose(read_f64(chunk, o + 24));
        if loose(a) && loose(b) && loose(c) && !after {
            out.push((o, [a, b, c]));
            o += 24;
        } else {
            o += 4;
        }
    }
    out
}

/// Median of a slice of f64 (clones+sorts; slice is small).
fn median(vals: &[f64]) -> f64 {
    let mut v = vals.to_vec();
    v.sort_by(|a, b| crate::fcmp(*a, *b));
    v[v.len() / 2]
}

/// Extract fragment placements from a fragments/spatial chunk.
///
/// Two passes: (1) gather candidate f64 translation triples; (2) keep those
/// whose every component lies within a band around that *column's* median
/// (`[med/3, med·3]`). Real translations cluster tightly per axis (X, height,
/// Y), so per-column banding rejects axis-contaminated false positives (a stray
/// value in one slot) and scale/matrix entries — without hardcoding the model's
/// coordinate range. Median resists the few outliers in the candidate set.
pub fn parse(chunk: &[u8]) -> Result<Vec<Fragment>> {
    let cands = candidate_triples(chunk);
    if cands.len() < 8 {
        return Ok(cands
            .into_iter()
            .map(|(o, t)| Fragment {
                offset: o,
                translation: t,
                local_bbox: None,
                marker8: None,
                group: None,
                class_flag: None,
                geom_record_idx: None,
            })
            .collect());
    }

    // Per-column |value| median and acceptance band.
    let col = |k: usize| -> (f64, f64) {
        let vals: Vec<f64> = cands.iter().map(|(_, t)| t[k].abs()).collect();
        let m = median(&vals);
        (m / 3.0, m * 3.0)
    };
    let bands = [col(0), col(1), col(2)];
    let in_band = |t: &[f64; 3]| (0..3).all(|k| (bands[k].0..=bands[k].1).contains(&t[k].abs()));

    let mut frags = Vec::new();
    for (o, t) in cands {
        if !in_band(&t) {
            continue;
        }
        let local_bbox = (o >= 24)
            .then(|| {
                [
                    read_f32(chunk, o - 24),
                    read_f32(chunk, o - 20),
                    read_f32(chunk, o - 16),
                    read_f32(chunk, o - 12),
                    read_f32(chunk, o - 8),
                    read_f32(chunk, o - 4),
                ]
            })
            .filter(valid_local_bbox);
        frags.push(Fragment {
            offset: o,
            translation: t,
            local_bbox,
            // parse() works off f64 translation triples (matrix-format records);
            // it does not locate a [93] marker, so there is no partition id.
            marker8: None,
            group: None,
            class_flag: None,
            geom_record_idx: None,
        });
    }
    Ok(frags)
}

/// Candidate local AABBs for a fragment whose record is variable-size: scan
/// backward from the translation over `[24, 160)` bytes (24 = past the fixed
/// slot, so we never read the translation doubles as f32) and return every
/// 6×f32 window that is a valid small AABB. The caller picks the one that
/// matches a geometry record's bbox. Returns `(min,max)` pairs.
pub fn candidate_bboxes(chunk: &[u8], offset: usize) -> Vec<[f32; 6]> {
    let mut out = Vec::new();
    let mut back = 24;
    while back < 160 {
        if back > offset {
            break;
        }
        let b = offset - back;
        let bb = [
            read_f32(chunk, b),
            read_f32(chunk, b + 4),
            read_f32(chunk, b + 8),
            read_f32(chunk, b + 12),
            read_f32(chunk, b + 16),
            read_f32(chunk, b + 20),
        ];
        let ext = [bb[3] - bb[0], bb[4] - bb[1], bb[5] - bb[2]];
        let valid = (0..3).all(|i| bb[i] <= bb[i + 3])
            && bb.iter().all(|v| v.is_finite() && v.abs() < 1.0e4)
            && ext.iter().any(|&e| e > 0.005)
            && ext.iter().all(|&e| e < 60.0);
        if valid {
            out.push(bb);
        }
        back += 4;
    }
    out
}

/// A straight pipe stored **parametrically**: the two cap-centre points `a`, `b`
/// in the fragment's **local** frame (relative to its translation) and the
/// cross-section `r`adius. Any orientation — axis-aligned, disc, or diagonal.
#[derive(Debug, Clone, Copy)]
pub struct CylParam {
    pub a: [f32; 3],
    pub b: [f32; 3],
    pub r: f32,
}

/// Recognise a fragment as a **parametric straight cylinder** (pipe / tube /
/// weld), in any orientation. These sit in a `type-93` record whose **local
/// AABB** (6×f32 at `offset-28`) bounds the pipe, with the **translation at one
/// cap centre**. So the axis is `2 × (AABB-centre)` (the AABB centre, taken
/// relative to the translation, points halfway to the other cap): cap A = the
/// translation (local origin), cap B = `2 × AABB-centre`. The radius is the AABB
/// half-extent perpendicular to that axis.
///
/// This one rule covers slender pipes, flat discs/washers (axis = short), and
/// 45° diagonals (axis off the principal axes) alike — a diagonal pipe is built
/// along its true axis instead of being misread as a fat disc. A **cylinder-model
/// validator** then confirms each AABB extent equals what a cylinder of that
/// axis/radius would produce, which rejects boxes / pyramids / facet groups.
/// Returns the local cap centres + radius, else `None`. The *curved-vs-straight*
/// split is left to the caller (build only when no tessellated record matches —
/// a curved elbow carries its own mesh, a parametric-only pipe does not).
pub fn cylinder_param(chunk: &[u8], fr: &Fragment) -> Option<CylParam> {
    let o = fr.offset;
    if o < 32 || o + 24 > chunk.len() {
        return None;
    }
    if u32::from_le_bytes(chunk[o - 32..o - 28].try_into().ok()?) != 93 {
        return None;
    }
    let bb = [
        read_f32(chunk, o - 28),
        read_f32(chunk, o - 24),
        read_f32(chunk, o - 20),
        read_f32(chunk, o - 16),
        read_f32(chunk, o - 12),
        read_f32(chunk, o - 8),
    ];
    if !bb.iter().all(|v| v.is_finite()) {
        return None;
    }
    let half = [
        (bb[3] - bb[0]) / 2.0,
        (bb[4] - bb[1]) / 2.0,
        (bb[5] - bb[2]) / 2.0,
    ];
    if half.iter().any(|&h| h < 0.0) {
        return None; // min > max — not a valid AABB
    }
    // AABB centre relative to the translation = halfway to the far cap.
    let mid = [
        (bb[0] + bb[3]) / 2.0,
        (bb[1] + bb[4]) / 2.0,
        (bb[2] + bb[5]) / 2.0,
    ];
    let half_len = (mid[0] * mid[0] + mid[1] * mid[1] + mid[2] * mid[2]).sqrt();
    if half_len < 0.015 {
        return None; // translation at the centre / a point — no resolvable axis
    }
    let d = [mid[0] / half_len, mid[1] / half_len, mid[2] / half_len];
    let length = 2.0 * half_len;
    // Radius = the *smallest* AABB half-extent among the axes perpendicular to d.
    // A slight tilt inflates one transverse extent (e.g. 0.22 vs 0.32); the true
    // diameter is the un-inflated (minimum) one.
    let mut r = f32::INFINITY;
    let mut have_perp = false;
    for i in 0..3 {
        if d[i].abs() < 0.6 {
            r = r.min(half[i]);
            have_perp = true;
        }
    }
    if !have_perp || !(0.04..=0.35).contains(&r) || !(0.04..=12.0).contains(&length) {
        return None;
    }
    // Cylinder-model validator: a cylinder of this axis/radius/length has AABB
    // half-extent `(length/2)|d_i| + r·√(1−d_i²)` on each axis. Reject anything
    // that doesn't match (boxes, pyramids, facet groups, oval sections).
    for i in 0..3 {
        let expect = half_len * d[i].abs() + r * (1.0 - d[i] * d[i]).max(0.0).sqrt();
        if (expect - half[i]).abs() > 0.06 + 0.12 * half[i] {
            return None;
        }
    }
    Some(CylParam {
        a: [0.0, 0.0, 0.0],
        b: [2.0 * mid[0], 2.0 * mid[1], 2.0 * mid[2]],
        r,
    })
}

/// Build a parametric cylinder **directly from a fragment's local AABB**, for a
/// small solid that carries no tessellated geometry record and isn't picked up by
/// [`cylinder_param`] (its radius is below that recogniser's lower bound). These
/// are the multi-primitive weld/elbow sub-parts: a fragment whose local box is a
/// tiny solid (a weld disc `~0.010 × 0.010 × 0.012`) which rvm2glb models as a
/// short small-radius `Cylinder`. The AABB's longest extent is the cylinder axis
/// (cap centres at the box-centre ± half-length), the radius is the mean of the
/// two shorter **half**-extents, so a near-square cross-section reconstructs round.
///
/// Bounded to genuinely tiny solids (`max extent ≤ MAX_EXT`, all three extents
/// real) so it can never fire for plates / beams / pipes — those already
/// reconstruct from their own records. Cap centres are relative to the
/// translation (local origin = the box centre offset from the translation).
pub fn bbox_cylinder(fr: &Fragment) -> Option<CylParam> {
    const MAX_EXT: f32 = 0.05; // only tiny weld/elbow sub-discs
    const MIN_EXT: f32 = 0.006; // larger than parser noise / a flat washer
    let bb = fr.local_bbox?;
    let ext = [bb[3] - bb[0], bb[4] - bb[1], bb[5] - bb[2]];
    if ext.iter().any(|&e| !(MIN_EXT..=MAX_EXT).contains(&e)) {
        return None; // a real 3-D solid box, all extents tiny
    }
    let centre = [
        (bb[0] + bb[3]) * 0.5,
        (bb[1] + bb[4]) * 0.5,
        (bb[2] + bb[5]) * 0.5,
    ];
    // Longest axis = cylinder axis; the other two are the (near-equal) diameter.
    let mut order = [0usize, 1, 2];
    order.sort_by(|&i, &j| crate::fcmp(ext[j], ext[i]));
    let (long, p, q) = (order[0], order[1], order[2]);
    let half_len = ext[long] * 0.5;
    let r = (ext[p] + ext[q]) * 0.25; // mean of the two shorter half-extents
    if r < 1e-4 || half_len < 1e-4 {
        return None;
    }
    let mut a = centre;
    let mut b = centre;
    a[long] -= half_len;
    b[long] += half_len;
    Some(CylParam { a, b, r })
}

/// World-space AABB of all fragments (glTF Y-up), expanded by each fragment's
/// local extent. Useful as an oracle check.
pub fn world_bbox(frags: &[Fragment]) -> ([f32; 3], [f32; 3]) {
    let mut min = [f32::INFINITY; 3];
    let mut max = [f32::NEG_INFINITY; 3];
    for fr in frags {
        let t = fr.translation_glb();
        let ext = fr
            .local_bbox
            .map(|bb| {
                [
                    bb[0].abs().max(bb[3].abs()),
                    bb[1].abs().max(bb[4].abs()),
                    bb[2].abs().max(bb[5].abs()),
                ]
            })
            .unwrap_or([0.05, 0.05, 0.05]);
        // local extents are in native axes; map magnitudes to glTF (x, z, y).
        let e = [ext[0], ext[2], ext[1]];
        for i in 0..3 {
            min[i] = min[i].min(t[i] - e[i]);
            max[i] = max[i].max(t[i] + e[i]);
        }
    }
    (min, max)
}

// ---------------------------------------------------------------------------
// Interned placement stream (non-RVM writers: 3DS/DWG loaders).
//
// The placement chunk of these writers is a flat stream of interned records
// `[id u32][type u32][payload]` with strictly sequential ids. Flat groups in
// fixed order: transform (type 14 = translation / 15 = + quaternion xyzw /
// 16 = + signed uniform scale / 17 = undecoded), optional materials (55, 54),
// fragments (93), close (13). A fragment binds to the nearest PRECEDING
// transform. Placement math: `world = R(q) · (s·v) + t` (column vectors).
// Fragment 93 payload = `[6×f32 local bbox][align8][3×f64 anchor — NOT a
// translation][2×u32][u32 geometry-record index, 1-based into the decoded
// record array]`. Byte-exact spec: docs/what_we_know_v1.md (multi-writer section);
// validated against a 3DS ground-truth pair (99.92% of triangles).
// ---------------------------------------------------------------------------

/// One fragment from the interned placement stream.
#[derive(Debug, Clone)]
pub struct InternedFrag {
    /// 1-based index into the decoded geometry-record array.
    pub record_idx: u32,
    /// Translation (world = R·(s·v) + t).
    pub translation: [f64; 3],
    /// Rotation quaternion, xyzw. Identity when the transform was type 14.
    pub quat: [f64; 4],
    /// Signed uniform scale (−1 = mirrored instance).
    pub scale: f64,
    /// Diffuse RGB from the nearest preceding material record, if any.
    pub diffuse: Option<[f32; 3]>,
    /// The fragment record's own AABB (min xyz, max xyz) relative to `anchor`.
    pub local_bbox: [f32; 6],
    /// The fragment record's 3×f64 anchor: `anchor + local_bbox` is the
    /// part's WORLD extent (a self-check for the placement transform).
    /// For an instanced frame these are the REFERENCED record's values (the
    /// extent of the first instance).
    pub anchor: [f64; 3],
    /// The frame head's group word: the 1-based ordinal of the owning tree
    /// leaf in the instance-EXPANDED DFS order of the hierarchy.
    pub group: u32,
    /// True when the frame references an earlier fragment record instead of
    /// defining one (a further instance of the same geometry).
    pub instanced: bool,
}

/// Try to parse `chunk` as an interned placement stream. Returns `None` when
/// the chunk doesn't match (wrong header, no sequential ids, or no fragments).
pub fn interned_placements(chunk: &[u8]) -> Option<Vec<InternedFrag>> {
    let n = chunk.len();
    let rd = |o: usize| -> Option<u32> {
        chunk
            .get(o..o + 4)
            .map(|b| u32::from_le_bytes(b.try_into().unwrap()))
    };
    let rf32 = |o: usize| -> Option<f32> {
        chunk
            .get(o..o + 4)
            .map(|b| f32::from_le_bytes(b.try_into().unwrap()))
    };
    let rf64 = |o: usize| -> Option<f64> {
        chunk
            .get(o..o + 8)
            .map(|b| f64::from_le_bytes(b.try_into().unwrap()))
    };
    if n < 32 {
        return None;
    }
    let first_id = rd(4)?;
    if first_id != 100 {
        return None;
    }
    // The chunk is `[frame count]` followed by FRAMES — records of type 13,
    // the first one being id 100 itself (`[100][13]` right after the count):
    //
    //   [id][13] [pad to 8] [f64 scalar] [w0][w1][class flag][group]
    //            TRANSFORM slot · MATERIAL slot · FRAGMENT slot
    //
    // A slot is `0` (null), `[1][id]` (back-reference to an earlier record)
    // or an inline definition: transform = a 14/15/16 record, material = a
    // 55 record followed by its 54 (colours) and optionally 185 (asset JSON),
    // fragment = a 93 record. One frame = one placed part.
    //
    // INSTANCING: a frame whose fragment slot is a back-reference places the
    // SAME geometry again under its own transform — this is how the Revit
    // loader stores repeated family instances (in the free desk sample 15 of
    // the 18 frames are such references). `group` is the owning leaf's
    // 1-based ordinal in the instance-expanded tree.
    //
    // Record boundaries: scan for the strictly sequential ids. NOTE: the
    // header's count word is the FRAME count, not the record count.
    let mut bounds: Vec<(usize, u32)> = Vec::new(); // (offset of id word, type)
    if rd(8) == Some(13) {
        bounds.push((4, 13));
    }
    let mut next_id = first_id + 1;
    let mut o = 8usize;
    while o + 8 <= n {
        if rd(o) == Some(next_id) {
            let ty = rd(o + 4)?;
            if ty < 100 {
                bounds.push((o, ty));
                next_id += 1;
                o += 8;
                continue;
            }
            // Type 185 = an inline material-asset JSON blob
            // `[id][185][len][utf-8, padded to 4]` (Revit exports embed one per
            // material in this stream). It is a record of the id chain: step
            // over it by its length — ignoring it ended the chain at the first
            // blob and lost every later placement (101 of 137 in one sample).
            if ty == 185 {
                let len = rd(o + 8)? as usize;
                if o + 12 + len <= n {
                    bounds.push((o, ty));
                    next_id += 1;
                    o += 12 + len.div_ceil(4) * 4;
                    continue;
                }
            }
        }
        o += 4;
    }
    // Gate hard against the RVM placement chunk (similar header, sequential-ish
    // idB values): a real interned placement stream carries dedicated TRANSFORM
    // records (types 14/15/16), which the RVM writer never emits.
    let n_transforms = bounds
        .iter()
        .filter(|&&(_, t)| (14..=16).contains(&t))
        .count();
    if bounds.len() < 8 || n_transforms < 8 {
        return None;
    }
    type Xf = ([f64; 3], [f64; 4], f64);
    const IDENTITY: Xf = ([0.0; 3], [0.0, 0.0, 0.0, 1.0], 1.0);
    #[derive(Clone, Copy)]
    struct Frag {
        local_bbox: [f32; 6],
        anchor: [f64; 3],
        record_idx: u32,
    }
    let id_of = |bo: usize| rd(bo).unwrap_or(0);
    let mut xf_by_id: std::collections::HashMap<u32, Xf> = std::collections::HashMap::new();
    let mut mat_by_id: std::collections::HashMap<u32, Option<[f32; 3]>> =
        std::collections::HashMap::new();
    let mut frag_by_id: std::collections::HashMap<u32, Frag> = std::collections::HashMap::new();
    let mut out = Vec::new();
    let mut kinds = [0usize; 5]; // transform slot: inline / ref / null / ref-unknown / other
    let mut n_frag = 0usize;
    let mut n_inst = 0usize;
    let frame_starts: Vec<usize> = (0..bounds.len()).filter(|&i| bounds[i].1 == 13).collect();
    for (fi, &b13) in frame_starts.iter().enumerate() {
        let b_end = frame_starts.get(fi + 1).copied().unwrap_or(bounds.len());
        let span_end = bounds.get(b_end).map(|&(e, _)| e).unwrap_or(n);
        // Frame head: f64 payloads are 8-byte aligned relative to the chunk start.
        let a8 = (bounds[b13].0 + 8).div_ceil(8) * 8;
        let group = rd(a8 + 20).unwrap_or(0);
        let slot_o = a8 + 24;
        let mut xf: Option<Xf> = None; // inline transform of this frame
        let mut xf_inline = false;
        let mut diffuse: Option<[f32; 3]> = None;
        let mut mat_inline = false;
        let mut cur55: Option<u32> = None;
        let mut frag: Option<Frag> = None;
        let mut after_xf = slot_o; // where the material slot starts
        for bi in b13 + 1..b_end {
            let (bo, ty) = bounds[bi];
            let pstart = bo + 8;
            let pend = bounds.get(bi + 1).map(|&(e, _)| e).unwrap_or(n);
            let p8 = pstart.div_ceil(8) * 8;
            match ty {
                14 | 15 | 16 => {
                    let need = match ty {
                        14 => 3,
                        15 => 7,
                        _ => 8,
                    };
                    if p8 + need * 8 > pend {
                        continue;
                    }
                    let f = |k: usize| rf64(p8 + 8 * k).unwrap_or(0.0);
                    let x: Xf = (
                        [f(0), f(1), f(2)],
                        if ty >= 15 {
                            [f(3), f(4), f(5), f(6)]
                        } else {
                            [0.0, 0.0, 0.0, 1.0]
                        },
                        if ty == 16 { f(7) } else { 1.0 },
                    );
                    xf_by_id.insert(id_of(bo), x);
                    if bo == slot_o {
                        xf = Some(x);
                        xf_inline = true;
                        after_xf = p8 + need * 8;
                    }
                }
                17 => {
                    // Undecoded transform variant (11 f64): identity, so a
                    // stale transform never leaks onto its fragments.
                    xf_by_id.insert(id_of(bo), IDENTITY);
                    if bo == slot_o {
                        xf = Some(IDENTITY);
                        xf_inline = true;
                        after_xf = p8 + 11 * 8;
                    }
                }
                55 => {
                    cur55 = Some(id_of(bo));
                    mat_by_id.insert(id_of(bo), None);
                    mat_inline = true;
                }
                54 => {
                    // Material: f32 RGB triples (ambient, diffuse, specular).
                    // Find 9 consecutive plausible f32 colour components.
                    'scan: for s in (pstart..pend.saturating_sub(36)).step_by(4) {
                        let mut vals = [0.0f32; 9];
                        for (k, v) in vals.iter_mut().enumerate() {
                            match rf32(s + 4 * k) {
                                Some(x) if (0.0..=1.0).contains(&x) => *v = x,
                                _ => continue 'scan,
                            }
                        }
                        diffuse = Some([vals[3], vals[4], vals[5]]);
                        break;
                    }
                    mat_inline = true;
                    if let Some(m) = cur55 {
                        mat_by_id.insert(m, diffuse);
                    }
                }
                93 => {
                    // [6×f32 bbox][align8][3×f64 anchor][2×u32][u32 record idx]
                    let ba8 = (pstart + 24).div_ceil(8) * 8;
                    let gi_off = ba8 + 24 + 8;
                    let Some(gi) = rd(gi_off) else { continue };
                    if gi == 0 || gi_off + 4 > pend {
                        continue;
                    }
                    let mut local_bbox = [0.0f32; 6];
                    for (k, v) in local_bbox.iter_mut().enumerate() {
                        *v = rf32(pstart + 4 * k).unwrap_or(0.0);
                    }
                    let fr = Frag {
                        local_bbox,
                        anchor: [
                            rf64(ba8).unwrap_or(0.0),
                            rf64(ba8 + 8).unwrap_or(0.0),
                            rf64(ba8 + 16).unwrap_or(0.0),
                        ],
                        record_idx: gi,
                    };
                    frag_by_id.insert(id_of(bo), fr);
                    frag = Some(fr);
                }
                _ => {}
            }
        }
        // Transform slot when it is not an inline definition.
        if !xf_inline {
            match rd(slot_o) {
                Some(1) => {
                    xf = rd(slot_o + 4).and_then(|id| xf_by_id.get(&id).copied());
                    kinds[if xf.is_some() { 1 } else { 3 }] += 1;
                    after_xf = slot_o + 8;
                }
                Some(0) => {
                    kinds[2] += 1;
                    after_xf = slot_o + 4;
                }
                _ => kinds[4] += 1,
            }
        } else {
            kinds[0] += 1;
        }
        // Material slot when it is a back-reference.
        if !mat_inline && rd(after_xf) == Some(1) {
            diffuse = rd(after_xf + 4)
                .and_then(|id| mat_by_id.get(&id).copied())
                .flatten();
        }
        // Fragment slot: the inline 93 record, else the frame's last slot
        // `[1][id]` naming an earlier one.
        let mut instanced = false;
        if frag.is_none() && span_end >= 8 && rd(span_end - 8) == Some(1) {
            frag = rd(span_end - 4).and_then(|id| frag_by_id.get(&id).copied());
            instanced = frag.is_some();
        }
        let Some(fr) = frag else { continue };
        n_frag += 1;
        n_inst += instanced as usize;
        // Null transform slot: the fragment's own anchor is the translation
        // (the RVM rule, validated against the Huldra FBX export).
        let (xt, xq, xs) = xf.unwrap_or((fr.anchor, [0.0, 0.0, 0.0, 1.0], 1.0));
        out.push(InternedFrag {
            local_bbox: fr.local_bbox,
            anchor: fr.anchor,
            record_idx: fr.record_idx,
            translation: xt,
            quat: xq,
            scale: xs,
            diffuse,
            group,
            instanced,
        });
    }
    if std::env::var_os("NWD_TRACE").is_some() && n_frag > 0 {
        eprintln!(
            "TRACE interned frames: declared {} parsed {} (instanced {}) | transform slot inline {} / ref {} / null {} / ref-to-non-transform {} / other-word {}",
            rd(0).unwrap_or(0), n_frag, n_inst, kinds[0], kinds[1], kinds[2], kinds[3], kinds[4]
        );
    }
    (n_frag > 0).then_some(out)
}
