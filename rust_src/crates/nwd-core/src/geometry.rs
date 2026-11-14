//! Geometry-stream parser — `LcOpNwdGeometry` (the 64 KB "lichunk" segments).
//!
//! The geometry stream is one logical buffer split into fixed 64 KB compression
//! segments; concatenate the inflated segments, then walk records. Each record:
//!
//! ```text
//!   [100][94|95][101][60][h4][h5]   6×u32 header (h5 = position float-words)
//!   [positions: h5/3 × 3×f32]       local-space vertices
//!   [bit-packed tail]               quantised normals + (unused-by-us) indices
//! ```
//!
//! The constant `100,*,101,60` prefix delimits records (records may straddle a
//! 64 KB segment boundary — fine after concatenation). `h4` = 2 × triangle count.
//!
//! The on-disk triangle connectivity is a **bit-packed strip-set index array**
//! (with `0xFFFF` restarts) that we don't decode. [`GeomRecord::mesh`] therefore
//! reconstructs triangles **from the vertex positions alone**:
//! - records with a clean **2-layer extrusion axis** → a convex **prism/frustum**
//!   lofted between the two caps (each cap hulled separately): flat plates,
//!   boxes, straight cylinders, *and* tapered cones / snouts / reducers;
//! - **curved tubes** (pipe elbows / bends) → fit a **torus** to the cloud and
//!   re-tessellate it as a clean ring grid ([`torus_mesh`]; the points lie exactly
//!   on a torus even though they're in scrambled strip order);
//! - **everything else** → single-strip expansion with seam culling.

use crate::cursor::Cursor;
use crate::error::Result;
use crate::fcmp;

fn dist(a: [f32; 3], b: [f32; 3]) -> f32 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)).sqrt()
}

#[derive(Debug, Clone)]
pub struct GeomRecord {
    /// Byte offset of the record header in the logical buffer.
    pub offset: usize,
    /// Local-space vertex positions (triangle-strip order).
    pub positions: Vec<[f32; 3]>,
    /// Header variant: `94` = surface (h4 = index count of the stored polygon
    /// set), `95` = **line-set** (h4 = vertex count; vertices are consecutive
    /// segment pairs — a single line or a datum tripod of 3 axis segments).
    /// Drives line-vs-solid routing.
    pub variant: u32,
    /// Triangle indices decoded from the record's STORED connectivity
    /// (`LcOpNwdGeometryCompress`): the pre-marker LZ stream yields the flat
    /// index array (length h4), and the post-marker polygon corner-count table
    /// (+ optional corner stream in the same codec) groups it into
    /// strip-ordered polygon loops. `None` = decode failed → heuristics.
    pub decoded_tris: Option<Vec<u32>>,
    /// Variant 95 only: the stored polylines as vertex-index segments, decoded
    /// from the record's index stream + count table ([`decode_polylines`]).
    /// `None` = not a line record or decode failed (→ consecutive-pair fallback).
    pub line_segments: Option<Vec<[u32; 2]>>,
}

impl GeomRecord {
    /// True if this is a line-set record (header variant 95) — render its
    /// vertices as `N/2` line segments (consecutive pairs), not a surface.
    pub fn is_line(&self) -> bool {
        self.variant == 95
    }

    /// Segment endpoint pairs for a line-set record: the decoded stored
    /// polylines, or consecutive vertex pairs when the record did not decode.
    pub fn segments(&self) -> Vec<([f32; 3], [f32; 3])> {
        match &self.line_segments {
            Some(segs) => segs
                .iter()
                .map(|s| (self.positions[s[0] as usize], self.positions[s[1] as usize]))
                .collect(),
            None => self
                .positions
                .chunks_exact(2)
                .map(|c| (c[0], c[1]))
                .collect(),
        }
    }

    /// Local-space axis-aligned bounding box (min, max).
    pub fn bbox(&self) -> ([f32; 3], [f32; 3]) {
        let mut min = [f32::INFINITY; 3];
        let mut max = [f32::NEG_INFINITY; 3];
        for p in &self.positions {
            for i in 0..3 {
                min[i] = min[i].min(p[i]);
                max[i] = max[i].max(p[i]);
            }
        }
        (min, max)
    }

    /// Local triangulated mesh `(positions, indices)` for this record.
    ///
    /// Records with a clean **2-layer extrusion axis** are reconstructed exactly
    /// by hulling each cap and lofting between them ([`slab_mesh`]): flat plates /
    /// I-beam flanges (thin axis), straight cylinders / tubes (long axis, two end
    /// caps), tapered cones / snouts / reducers (different-radius caps), and true
    /// cones (one cap collapses to an apex). A clean solid instead of the strip's
    /// half-shell / crumple. **Curved tubes** (elbows/bends) are fitted to a torus
    /// and re-tessellated ([`torus_mesh`]). Anything else falls back to the strip
    /// expansion ([`triangles`]). Lines → empty indices.
    pub fn mesh(&self) -> (Vec<[f32; 3]>, Vec<u32>) {
        let (p, i, _) = self.mesh_clean();
        (p, i)
    }

    /// Like [`mesh`], but also returns whether the record reconstructed **cleanly**
    /// from a recognised primitive (prism/frustum/cone via [`slab_mesh`], or curved
    /// tube via [`torus_mesh`]). `false` means it fell back to the single-strip
    /// expansion — i.e. a free-form `FacetGroup` whose packed connectivity we can't
    /// decode (so the strip crumples / the hull fills it solid). The caller can use
    /// this to substitute reference geometry only for those records.
    pub fn mesh_clean(&self) -> (Vec<[f32; 3]>, Vec<u32>, bool) {
        if self.positions.len() < 3 {
            return (self.positions.clone(), Vec::new(), false);
        }
        // Variant 96 = a POINT set (vertices only, no connectivity; seen in
        // DWG/3DS-sourced files). It has no surface — never hull it into one.
        if self.variant == 96 {
            return (self.positions.clone(), Vec::new(), true);
        }
        // Line-set record (variant 95) with ≥ 2 segments: a **datum tripod** (e.g.
        // 6 verts = 3 axis lines). Render each segment as a thin X-cross and merge,
        // so a datum shows as its proper small lines instead of a crumpled 0.1 m
        // strip blob. This changes only the rendered mesh — the linker keys off the
        // raw vertex bbox (`bbox()`), so the placement and the linker anchors are
        // untouched. (Single-line variant-95 records have < 3 verts and already
        // route to the construction-line X-cross path.)
        if self.is_line() {
            let mut pos = Vec::new();
            let mut idx = Vec::new();
            for (a, b) in self.segments() {
                let (sp, si) = cross_mesh(a, b, 0.012);
                let base = pos.len() as u32;
                pos.extend_from_slice(&sp);
                idx.extend(si.iter().map(|k| k + base));
            }
            if !idx.is_empty() {
                return (pos, idx, true);
            }
        }
        // ── DECODED connectivity (exact) ─────────────────────────────────────
        // The stored `LcOpNwdGeometryCompress` index stream is now decoded
        // (see `decode_connectivity`). This is the file's actual triangulation
        // over the original vertices — no reconstruction, no fitting. Heuristics
        // below remain only as a fallback for records that fail to decode.
        if let Some(tris) = &self.decoded_tris {
            if !tris.is_empty() {
                if std::env::var_os("NWD_TRACE").is_some() {
                    eprintln!(
                        "TRACE off={} DECODED nv {} -> tris {}",
                        self.offset,
                        self.positions.len(),
                        tris.len() / 3
                    );
                }
                return (self.positions.clone(), tris.clone(), true);
            }
        }
        // ── REAL-VERTEX render cascade ───────────────────────────────────────
        // Every render path emits the ORIGINAL decoded vertices. We NEVER fall
        // through to the coarse FITS (pca/slab/torus/revolve) here — those
        // fabricate a clean primitive from the bbox and hide un-decoded geometry.
        // The cascade (all real verts):
        //   1. faithful_axial_mesh — accept ONLY if the result is MANIFOLD (a
        //      clean revolution surface: cylinder/cone/tube/elbow). A folded
        //      non-revolution record (a flat box self-overlapping) is rejected.
        //   2. convex_hull_mesh — exact for CONVEX solids (boxes, plates, beams,
        //      cylinders, cones; thin plates too). Accept only when the hull is a
        //      complete closed surface using ~all input verts; else None.
        //   3. vertex-order STRIP — real verts in found order for everything else
        //      (non-convex: C-channels, extruded uprights, freeform).
        let trace = std::env::var_os("NWD_TRACE").is_some();
        if std::env::var_os("NWD_NO_FAITHFUL").is_none() {
            if let Some((p, i)) = faithful_axial_mesh(&self.positions) {
                if !is_non_manifold(&i) {
                    if trace {
                        eprintln!(
                            "TRACE off={} faithful(manifold) nv {} -> {} tris {}",
                            self.offset,
                            self.positions.len(),
                            p.len(),
                            i.len() / 3
                        );
                    }
                    return (p, i, true);
                }
                if trace {
                    eprintln!(
                        "TRACE off={} faithful REJECTED non-manifold, trying hull",
                        self.offset
                    );
                }
            }
        }
        if let Some((p, i)) = convex_hull_mesh(&self.positions) {
            if trace {
                eprintln!(
                    "TRACE off={} hull nv {} -> tris {}",
                    self.offset,
                    self.positions.len(),
                    i.len() / 3
                );
            }
            return (p, i, true);
        }
        if trace {
            eprintln!(
                "TRACE off={} strip nv {} variant {}",
                self.offset,
                self.positions.len(),
                self.variant
            );
        }
        (self.positions.clone(), self.triangles(), false)
    }

    /// [`mesh_clean`] for a caller that owns the record and will not read its
    /// mesh again: a surface record with decoded connectivity MOVES its vertex
    /// and triangle arrays out (they are left empty) instead of cloning them.
    /// Line / point / un-decoded records go through `mesh_clean` unchanged, so
    /// `is_line()` / `segments()` keep working afterwards.
    pub fn take_mesh_clean(&mut self) -> (Vec<[f32; 3]>, Vec<u32>) {
        let movable = self.positions.len() >= 3
            && self.variant != 96
            && !self.is_line()
            && self.decoded_tris.as_ref().is_some_and(|t| !t.is_empty());
        if movable {
            let tris = self.decoded_tris.take().unwrap_or_default();
            return (std::mem::take(&mut self.positions), tris);
        }
        let (p, i, _) = self.mesh_clean();
        (p, i)
    }

    /// The **coarse** fitter cascade (`pca_cylinder_mesh` → `slab_mesh` →
    /// `torus_mesh` → `revolve_mesh` → strip). These fits FABRICATE a clean
    /// primitive from the bbox, so they are **never** used by the RENDER path
    /// (see [`mesh_clean`], which renders only real decoded vertices). This is
    /// retained solely for [`linker_centroid`]: the leaf alignment keeps its
    /// baseline POSITION regardless of which real-vertex render path is taken.
    pub fn mesh_coarse(&self) -> (Vec<[f32; 3]>, Vec<u32>, bool) {
        // A *tilted* cylinder/tube has its axis off the world axes, so the
        // axis-aligned slab/strip reconstruction turns it into a faceted box
        // (e.g. the weld "sticks"). Recover the true axis by PCA and rebuild it
        // round first. Gated to tilted, clearly-cylindrical records so axis-
        // aligned cylinders/plates/cones keep their existing slab handling.
        let trace = std::env::var_os("NWD_TRACE").is_some();
        if let Some((p, i)) = pca_cylinder_mesh(&self.positions) {
            if trace {
                eprintln!(
                    "TRACE off={} pca_cyl nv {} -> {} ratio {:.2}",
                    self.offset,
                    self.positions.len(),
                    p.len(),
                    p.len() as f32 / self.positions.len() as f32
                );
            }
            return (p, i, true);
        }
        if let Some((p, i)) = slab_mesh(&self.positions) {
            if trace {
                eprintln!(
                    "TRACE off={} slab nv {} -> {} ratio {:.2}",
                    self.offset,
                    self.positions.len(),
                    p.len(),
                    p.len() as f32 / self.positions.len() as f32
                );
            }
            return (p, i, true);
        }
        if let Some((p, i)) = torus_mesh(&self.positions) {
            if trace {
                eprintln!(
                    "TRACE off={} torus nv {} -> {} ratio {:.2}",
                    self.offset,
                    self.positions.len(),
                    p.len(),
                    p.len() as f32 / self.positions.len() as f32
                );
            }
            return (p, i, true);
        }
        // Axially-structured solids of revolution that aren't a clean 2-layer
        // prism or a torus — cones, tapered nozzles/reducers, faceted tubes,
        // spheres/cups stored as explicit ring meshes. Re-triangulate the REAL
        // vertices in the (axial, angular) parameter plane so the original
        // geometry is preserved with clean manifold topology. Rejects genuinely
        // irregular / freeform clouds (→ strip fallback).
        if let Some((p, i)) = revolve_mesh(&self.positions) {
            return (p, i, true);
        }
        if trace {
            eprintln!(
                "TRACE off={} strip nv {} variant {}",
                self.offset,
                self.positions.len(),
                self.variant
            );
        }
        (self.positions.clone(), self.triangles(), false)
    }

    /// Centroid the **linker** should use for this record's placement: the mean of
    /// the COARSE-mesh vertices. Keeping the linker on the coarse centroid makes
    /// leaf alignment (and its anchors) invariant to whether the rendered mesh
    /// is the faithful original-vertex reconstruction or a coarse fitter — only the
    /// rendered geometry changes, never the position the linker scores against.
    pub fn linker_centroid(&self) -> [f32; 3] {
        let (p, _, _) = self.mesh_coarse();
        let n = p.len().max(1) as f32;
        let mut c = [0.0f32; 3];
        for q in &p {
            for i in 0..3 {
                c[i] += q[i];
            }
        }
        [c[0] / n, c[1] / n, c[2] / n]
    }

    /// Triangle indices, expanding the strip with alternating winding.
    ///
    /// The on-disk connectivity is a triangle-strip *set* (multiple strips with
    /// restart markers) whose index array is bit-packed and not decoded here, so
    /// we treat the vertices as one strip. To avoid bridging across strip-restart
    /// seams (which would draw long "venetian-blind" slivers), we drop any
    /// triangle whose longest edge is far larger than the record's typical edge
    /// — a robust proxy for a restart boundary — plus degenerate triangles.
    pub fn triangles(&self) -> Vec<u32> {
        let v = self.positions.len();
        let mut idx = Vec::new();
        if v < 3 {
            return idx;
        }
        // The on-disk connectivity is a triangle-strip SET — many short strips, each
        // a zig-zag (§14), joined by a RESTART (the 0xFFFF marker, §38). Within a
        // strip the consecutive edges are small (the bimodal rung/advance steps); a
        // restart is the jump from one strip's last vertex to the next strip's first,
        // a clear statistical OUTLIER above those. Verified on a 120-vert elbow: 17
        // restarts at vertices [18,24,…,114] (period 6) — and the codec tail carries
        // exactly 17 0xFF bytes, so the geometric jump recovers the same boundaries.
        //
        // So split the vertex run into strips at every consecutive edge that exceeds
        // 2.5× the median, and expand each strip INDEPENDENTLY (winding reset per
        // strip). The old code keyed the restart off the i→i+2 step with a ×5 / 1.09
        // floor that these ~0.57 m jumps slipped under, so it bridged across every
        // restart → the "venetian-blind"/spiral crumple on curved tubes (elbows) and
        // the twist on extruded profiles (I-beams). Splitting per strip removes it.
        let cd: Vec<f32> = (0..v - 1)
            .map(|i| dist(self.positions[i], self.positions[i + 1]))
            .collect();
        let med = {
            let mut s = cd.clone();
            s.sort_by(|a, b| fcmp(*a, *b));
            s[s.len() / 2].max(1e-6)
        };
        let restart_thr = (med * 2.5).max(0.02); // strip boundary (outlier jump)
        let cons_cull = (med * 6.0).max(0.02); // a degenerate huge edge inside a strip
                                               // Same-side (i→i+2) cull: even inside one strip the advancing rail can break
                                               // at a profile corner the consecutive split misses (the freeform-FacetGroup
                                               // case — I-beam/channel profiles). The OLD code used ×5 / 1.09 m, which the
                                               // elbow's ~0.48 m diagonals slipped under but so did real profile breaks; use
                                               // a tighter statistical ×2.5 over the i→i+2 steps. After the consecutive
                                               // strip split the elbow's in-strip diagonals are well under this, so it only
                                               // trims the freeform bridges.
        let same_thr = {
            let mut s: Vec<f32> = (0..v - 2)
                .map(|i| dist(self.positions[i], self.positions[i + 2]))
                .collect();
            s.sort_by(|a, b| fcmp(*a, *b));
            // Scale factor 15 keeps rungs/end-caps (~12× advance) but culls
            // strip bridges across voids (~25× advance). Scales with element size.
            (s[s.len() / 2].max(1e-6) * 15.0).max(0.02)
        };
        // Strip start indices: 0, then every vertex whose entry edge is a restart.
        let mut starts = vec![0usize];
        for i in 0..v - 1 {
            if cd[i] > restart_thr {
                starts.push(i + 1);
            }
        }
        starts.push(v);
        for w in starts.windows(2) {
            let (s, e) = (w[0], w[1]);
            if e - s < 3 {
                continue; // strip too short to form a triangle
            }
            for j in s..e - 2 {
                // winding alternates within the strip; parity is strip-LOCAL so each
                // strip starts fresh (a global parity would flip every other strip).
                let (a, b, c) = if (j - s) % 2 == 0 {
                    (j, j + 1, j + 2)
                } else {
                    (j + 1, j, j + 2)
                };
                let (pa, pb, pc) = (self.positions[a], self.positions[b], self.positions[c]);
                if pa == pb || pb == pc || pa == pc {
                    continue; // degenerate
                }
                if dist(pa, pb) > cons_cull || dist(pb, pc) > cons_cull || dist(pa, pc) > cons_cull
                {
                    continue; // a genuinely huge wall edge (degenerate strip)
                }
                if dist(self.positions[j], self.positions[j + 2]) > same_thr {
                    continue; // same-side rail jumped a profile break inside the strip
                }
                idx.extend_from_slice(&[a as u32, b as u32, c as u32]);
            }
        }
        idx
    }
}

/// Find the axis along which the points split into **two clean, well-separated
/// layers** (one dominant gap), returning `(axis, lo_level, hi_level)`. This is
/// the extrusion axis of a prism: the *thin* axis for a flat plate, or the *long*
/// axis for a straight cylinder/short tube (its two end caps). A round tube's
/// cross-section axes have continuous spread (no dominant gap) and are rejected,
/// as are curved elbows (no straight 2-layer axis).
fn extrusion_axis(positions: &[[f32; 3]]) -> Option<(usize, f32, f32)> {
    let mut best: Option<(usize, f32, f32, f32)> = None; // axis, score, lo, hi
    for axis in 0..3 {
        let mut c: Vec<f32> = positions.iter().map(|p| p[axis]).collect();
        c.sort_by(|a, b| fcmp(*a, *b));
        let (mut g1, mut g1i, mut g2) = (0.0f32, 0usize, 0.0f32);
        for i in 0..c.len() - 1 {
            let g = c[i + 1] - c[i];
            if g > g1 {
                g2 = g1;
                g1 = g;
                g1i = i;
            } else if g > g2 {
                g2 = g;
            }
        }
        if g1 < 1e-5 {
            continue;
        }
        let lo_spread = c[g1i] - c[0];
        let hi_spread = c[c.len() - 1] - c[g1i + 1];
        // Clean 2-layer: the split gap dominates both within-layer spread and the
        // next-largest gap. Score prefers the most separated such axis.
        let score = g1 / (lo_spread.max(hi_spread).max(g2) + 1e-6);
        if score > 3.0 && best.map_or(true, |b| score > b.1) {
            let lo = c[..=g1i].iter().sum::<f32>() / (g1i + 1) as f32;
            let hi = c[g1i + 1..].iter().sum::<f32>() / (c.len() - g1i - 1) as f32;
            best = Some((axis, score, lo, hi));
        }
    }
    best.map(|(axis, _, lo, hi)| (axis, lo, hi))
}

/// Convex hull of the points, ordered CCW by angle around their centroid so two
/// caps can be lofted index-aligned (a consistent start angle).
fn ring_hull(pts: Vec<(f32, f32)>) -> Vec<(f32, f32)> {
    let mut h = convex_hull_2d(pts);
    if h.len() < 3 {
        return h;
    }
    let (cx, cy) = (
        h.iter().map(|p| p.0).sum::<f32>() / h.len() as f32,
        h.iter().map(|p| p.1).sum::<f32>() / h.len() as f32,
    );
    h.sort_by(|p, q| fcmp((p.1 - cy).atan2(p.0 - cx), (q.1 - cy).atan2(q.0 - cx)));
    h
}

/// Resample an angle-sorted ring to exactly `k` points, picking the ring vertex
/// nearest each of `k` evenly-spaced target angles (around the ring's centroid).
/// `k <= ring.len()`; the two lofted caps go through this with the same `k` so
/// `lo[i]` and `hi[i]` land at the same angle even when the caps were tessellated
/// to different counts.
fn resample_ring(ring: &[(f32, f32)], k: usize) -> Vec<(f32, f32)> {
    if ring.len() == k {
        return ring.to_vec();
    }
    let (cx, cy) = (
        ring.iter().map(|p| p.0).sum::<f32>() / ring.len() as f32,
        ring.iter().map(|p| p.1).sum::<f32>() / ring.len() as f32,
    );
    let two_pi = std::f32::consts::TAU;
    (0..k)
        .map(|t| {
            let target = -std::f32::consts::PI + two_pi * t as f32 / k as f32;
            *ring
                .iter()
                .min_by(|p, q| {
                    let ad = |r: &(f32, f32)| {
                        let mut d = ((r.1 - cy).atan2(r.0 - cx) - target).abs();
                        if d > std::f32::consts::PI {
                            d = two_pi - d;
                        }
                        d
                    };
                    fcmp(ad(p), ad(q))
                })
                .unwrap()
        })
        .collect()
}

/// Reconstruct a record as a convex prism / frustum (`positions, indices`) when
/// it has a clean 2-layer extrusion axis. The cross-section is hulled **per
/// cap** and the two caps are lofted, so a *tapered* shape (cone, snout/reducer)
/// keeps its taper instead of collapsing to a cylinder; equal caps give a plate
/// or straight cylinder. Returns None for curved/irregular shapes (→ strip).
fn slab_mesh(positions: &[[f32; 3]]) -> Option<(Vec<[f32; 3]>, Vec<u32>)> {
    let (axis, lo, hi) = extrusion_axis(positions)?;
    let (a, b) = match axis {
        0 => (1, 2),
        1 => (0, 2),
        _ => (0, 1),
    };
    let mid = (lo + hi) * 0.5;
    let cross = |pred: &dyn Fn(f32) -> bool| -> Vec<(f32, f32)> {
        ring_hull(
            positions
                .iter()
                .filter(|p| pred(p[axis]))
                .map(|p| (p[a], p[b]))
                .collect(),
        )
    };
    let ring_lo = cross(&|z| z < mid);
    let ring_hi = cross(&|z| z >= mid);
    // Each cap is either a cross-section (hull ≥3) or an **apex** — a degenerate
    // hull (a true cone tapers to a single point, e.g. a 16-pt
    // base circle → 8 coincident points). At least one end must be a real
    // cross-section; the other can collapse to its centroid (the apex). Both
    // degenerate → no shape → strip fallback.
    let (lo_solid, hi_solid) = (ring_lo.len() >= 3, ring_hi.len() >= 3);
    if !lo_solid && !hi_solid {
        return None;
    }
    let centroid = |r: &[(f32, f32)]| {
        let k = r.len().max(1) as f32;
        (
            r.iter().map(|p| p.0).sum::<f32>() / k,
            r.iter().map(|p| p.1).sum::<f32>() / k,
        )
    };
    // Ring point count = the solid cap(s)'; resample both to it so a finely- and
    // coarsely-tessellated pair still lofts index-aligned.
    let n = match (lo_solid, hi_solid) {
        (true, true) => ring_lo.len().min(ring_hi.len()),
        (true, false) => ring_lo.len(),
        _ => ring_hi.len(),
    };
    let lo_ring = if lo_solid {
        resample_ring(&ring_lo, n)
    } else {
        vec![centroid(&ring_lo); n] // apex
    };
    let hi_ring = if hi_solid {
        resample_ring(&ring_hi, n)
    } else {
        vec![centroid(&ring_hi); n] // apex
    };
    let mk = |(u, v): (f32, f32), level: f32| {
        let mut p = [0.0f32; 3];
        p[a] = u;
        p[b] = v;
        p[axis] = level;
        p
    };
    let mut pos = Vec::with_capacity(2 * n);
    for i in 0..n {
        pos.push(mk(lo_ring[i], lo)); // 2i
        pos.push(mk(hi_ring[i], hi)); // 2i+1
    }
    // Emit a triangle only if non-degenerate — at an apex the cap collapses, so
    // side quads become single cone faces and the apex "cap" drops out.
    let mut idx = Vec::new();
    let mut tri = |x: usize, y: usize, z: usize| {
        if pos[x] != pos[y] && pos[y] != pos[z] && pos[x] != pos[z] {
            idx.extend_from_slice(&[x as u32, y as u32, z as u32]);
        }
    };
    for i in 0..n {
        let j = (i + 1) % n;
        let (li, hii, lj, hj) = (2 * i, 2 * i + 1, 2 * j, 2 * j + 1);
        tri(li, hii, hj);
        tri(li, hj, lj);
    }
    for i in 1..n - 1 {
        tri(0, 2 * i, 2 * (i + 1)); // lo cap
        tri(1, 2 * (i + 1) + 1, 2 * i + 1); // hi cap
    }
    Some((pos, idx))
}

/// Build a solid capped cylinder between two cap-centre points `a` and `b` with
/// cross-section `r`adius, in **any** orientation. Used for the NWD's parametric
/// straight pipes (a `type-93` record whose local AABB gives the axis as
/// `2 × (bbox-centre − translation)`), so a 45°-diagonal pipe is built along its
/// true axis instead of being misread as an axis-aligned fat disc. Same ring
/// loft / cap-fan topology as [`slab_mesh`]; placed through the convert map.
/// Detect a **tilted** cylinder/tube from raw vertices (PCA: near-constant radius
/// about an elongated principal axis) and rebuild it round along that true axis.
/// The axis-aligned `slab_mesh`/strip path turns a tilted cylinder into a faceted
/// box; this recovers the real shape (welds, off-axis pipe segments). Returns
/// `None` unless the points are clearly cylindrical AND the axis is off-world
/// (axis-aligned cylinders are left to `slab_mesh`, which already lofts them).
fn pca_cylinder_mesh(positions: &[[f32; 3]]) -> Option<(Vec<[f32; 3]>, Vec<u32>)> {
    let n = positions.len();
    if n < 12 {
        return None;
    }
    let nf = n as f64;
    let mut c = [0f64; 3];
    for p in positions {
        for i in 0..3 {
            c[i] += p[i] as f64;
        }
    }
    for i in 0..3 {
        c[i] /= nf;
    }
    // Covariance, then dominant eigenvector (the long axis) via power iteration.
    let mut cov = [[0f64; 3]; 3];
    for p in positions {
        let d = [p[0] as f64 - c[0], p[1] as f64 - c[1], p[2] as f64 - c[2]];
        for i in 0..3 {
            for j in 0..3 {
                cov[i][j] += d[i] * d[j];
            }
        }
    }
    let mut v = [0.71f64, 0.42, 0.56];
    for _ in 0..48 {
        let mut nv = [0f64; 3];
        for i in 0..3 {
            for j in 0..3 {
                nv[i] += cov[i][j] * v[j];
            }
        }
        let m = (nv[0] * nv[0] + nv[1] * nv[1] + nv[2] * nv[2]).sqrt();
        if m < 1e-12 {
            return None;
        }
        for i in 0..3 {
            v[i] = nv[i] / m;
        }
    }
    // Project onto the axis: axial extent + radial distances.
    let (mut tmin, mut tmax) = (f64::INFINITY, f64::NEG_INFINITY);
    let mut rs = Vec::with_capacity(n);
    for p in positions {
        let d = [p[0] as f64 - c[0], p[1] as f64 - c[1], p[2] as f64 - c[2]];
        let t = d[0] * v[0] + d[1] * v[1] + d[2] * v[2];
        tmin = tmin.min(t);
        tmax = tmax.max(t);
        let perp = [d[0] - v[0] * t, d[1] - v[1] * t, d[2] - v[2] * t];
        rs.push((perp[0] * perp[0] + perp[1] * perp[1] + perp[2] * perp[2]).sqrt());
    }
    let rmean = rs.iter().sum::<f64>() / nf;
    if rmean < 1e-4 {
        return None;
    }
    let cv = (rs.iter().map(|r| (r - rmean).powi(2)).sum::<f64>() / nf).sqrt() / rmean;
    let len = tmax - tmin;
    // Cylinder iff near-constant radius about an elongated axis…
    if cv > 0.15 || len < 1.2 * rmean {
        return None;
    }
    // …and only when that axis is tilted off the world axes (else slab handles it).
    let tilt = 1.0 - v.iter().fold(0.0f64, |m, x| m.max(x.abs()));
    if tilt < 0.04 {
        return None;
    }
    let a = [
        (c[0] + v[0] * tmin) as f32,
        (c[1] + v[1] * tmin) as f32,
        (c[2] + v[2] * tmin) as f32,
    ];
    let b = [
        (c[0] + v[0] * tmax) as f32,
        (c[1] + v[1] * tmax) as f32,
        (c[2] + v[2] * tmax) as f32,
    ];
    Some(cylinder_mesh(a, b, rmean as f32))
}

/// "X-cross" proxy geometry for a construction line `a→b`: two thin perpendicular
/// quads sharing the segment axis (the way `rvm2glb` renders construction lines),
/// so a 1-D line becomes visible geometry. `w` is the cross half-width.
pub fn cross_mesh(a: [f32; 3], b: [f32; 3], w: f32) -> (Vec<[f32; 3]>, Vec<u32>) {
    let d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    let len = (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt();
    if len < 1e-6 {
        return (Vec::new(), Vec::new());
    }
    let dir = [d[0] / len, d[1] / len, d[2] / len];
    let up = if dir[1].abs() < 0.9 {
        [0.0, 1.0, 0.0]
    } else {
        [1.0, 0.0, 0.0]
    };
    let cross = |p: [f32; 3], q: [f32; 3]| {
        [
            p[1] * q[2] - p[2] * q[1],
            p[2] * q[0] - p[0] * q[2],
            p[0] * q[1] - p[1] * q[0],
        ]
    };
    let unit = |p: [f32; 3]| {
        let l = (p[0] * p[0] + p[1] * p[1] + p[2] * p[2]).sqrt().max(1e-6);
        [p[0] / l, p[1] / l, p[2] / l]
    };
    let u = unit(cross(dir, up));
    let v = unit(cross(dir, u));
    let mut pos = Vec::with_capacity(8);
    for n in [u, v] {
        pos.push([a[0] - n[0] * w, a[1] - n[1] * w, a[2] - n[2] * w]);
        pos.push([a[0] + n[0] * w, a[1] + n[1] * w, a[2] + n[2] * w]);
        pos.push([b[0] + n[0] * w, b[1] + n[1] * w, b[2] + n[2] * w]);
        pos.push([b[0] - n[0] * w, b[1] - n[1] * w, b[2] - n[2] * w]);
    }
    let idx = vec![0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
    (pos, idx)
}

/// Axis-aligned box from a local AABB (min/max corners), as 12 triangles.
///
/// Used as an **explicit placeholder** for a placement whose own fragment bbox
/// is real but matches no geometry record confidently (so we cannot reuse a
/// tessellated record): we render the FILE'S OWN extents rather than dropping
/// the placement or fitting an invented primitive (cf. faceted-never-assume).
/// Any near-zero extent (a flat disc/gasket, or a genuinely-no-geometry point
/// marker) is given a small visible thickness `min_thk` so the placeholder is
/// not a degenerate zero-area sliver.
pub fn box_mesh(mn: [f32; 3], mx: [f32; 3], min_thk: f32) -> (Vec<[f32; 3]>, Vec<u32>) {
    let mut lo = [0.0f32; 3];
    let mut hi = [0.0f32; 3];
    for a in 0..3 {
        let c = (mn[a] + mx[a]) * 0.5;
        let h = ((mx[a] - mn[a]).abs() * 0.5).max(min_thk * 0.5);
        lo[a] = c - h;
        hi[a] = c + h;
    }
    let pos = vec![
        [lo[0], lo[1], lo[2]],
        [hi[0], lo[1], lo[2]],
        [hi[0], hi[1], lo[2]],
        [lo[0], hi[1], lo[2]],
        [lo[0], lo[1], hi[2]],
        [hi[0], lo[1], hi[2]],
        [hi[0], hi[1], hi[2]],
        [lo[0], hi[1], hi[2]],
    ];
    let idx = vec![
        0, 2, 1, 0, 3, 2, // -z
        4, 5, 6, 4, 6, 7, // +z
        0, 1, 5, 0, 5, 4, // -y
        3, 7, 6, 3, 6, 2, // +y
        0, 4, 7, 0, 7, 3, // -x
        1, 2, 6, 1, 6, 5, // +x
    ];
    (pos, idx)
}

pub fn cylinder_mesh(a: [f32; 3], b: [f32; 3], r: f32) -> (Vec<[f32; 3]>, Vec<u32>) {
    let axis = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    let len = (axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2]).sqrt();
    let d = if len > 1e-6 {
        [axis[0] / len, axis[1] / len, axis[2] / len]
    } else {
        [0.0, 0.0, 1.0]
    };
    // Two unit vectors perpendicular to the axis (a stable basis).
    let up = if d[0].abs() < 0.9 {
        [1.0, 0.0, 0.0]
    } else {
        [0.0, 1.0, 0.0]
    };
    let cross = |p: [f32; 3], q: [f32; 3]| {
        [
            p[1] * q[2] - p[2] * q[1],
            p[2] * q[0] - p[0] * q[2],
            p[0] * q[1] - p[1] * q[0],
        ]
    };
    let norm = |v: [f32; 3]| {
        let l = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt().max(1e-9);
        [v[0] / l, v[1] / l, v[2] / l]
    };
    let u = norm(cross(d, up));
    let v = cross(d, u); // already unit (d, u orthonormal)
    let n = 16usize;
    let mut pos = Vec::with_capacity(2 * n);
    for k in 0..n {
        let ang = std::f32::consts::TAU * k as f32 / n as f32;
        let (c, s) = (r * ang.cos(), r * ang.sin());
        let off = [
            c * u[0] + s * v[0],
            c * u[1] + s * v[1],
            c * u[2] + s * v[2],
        ];
        pos.push([a[0] + off[0], a[1] + off[1], a[2] + off[2]]); // cap A ring (2k)
        pos.push([b[0] + off[0], b[1] + off[1], b[2] + off[2]]); // cap B ring (2k+1)
    }
    let mut idx = Vec::new();
    for i in 0..n {
        let j = (i + 1) % n;
        let (li, hii, lj, hj) = (2 * i, 2 * i + 1, 2 * j, 2 * j + 1);
        idx.extend_from_slice(&[
            li as u32, hii as u32, hj as u32, li as u32, hj as u32, lj as u32,
        ]);
    }
    for i in 1..n - 1 {
        idx.extend_from_slice(&[0, (2 * i) as u32, (2 * (i + 1)) as u32]); // cap A
        idx.extend_from_slice(&[1, (2 * (i + 1) + 1) as u32, (2 * i + 1) as u32]);
        // cap B
    }
    (pos, idx)
}

// ─── Curved-tube (torus) reconstruction ────────────────────────────────────
// A pipe elbow/bend is stored as a triangle strip whose packed connectivity we
// don't decode, so the strip expansion crumples. But the vertices lie exactly on
// a torus surface, so we fit a torus to the cloud (order-independent) and
// re-tessellate it as a clean ring grid. Validated against the RVM: every elbow
// fits to rms≈0 (bend radius 0.305, pipe radius 0.110, etc.).

fn vsub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn vadd(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
fn vdot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn vcross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
fn vscale(a: [f64; 3], s: f64) -> [f64; 3] {
    [a[0] * s, a[1] * s, a[2] * s]
}
fn vunit(a: [f64; 3]) -> [f64; 3] {
    let l = vdot(a, a).sqrt().max(1e-12);
    [a[0] / l, a[1] / l, a[2] / l]
}

/// Per-point signed distance to the torus described by `x` =
/// `[cx,cy,cz, nx,ny,nz, R_bend, r_tube]`.
fn torus_resid(pts: &[[f64; 3]], x: &[f64; 8]) -> Vec<f64> {
    let c = [x[0], x[1], x[2]];
    let n = vunit([x[3], x[4], x[5]]);
    let (big, small) = (x[6], x[7]);
    pts.iter()
        .map(|p| {
            let v = vsub(*p, c);
            let h = vdot(v, n);
            let w = vsub(v, vscale(n, h));
            let rho = vdot(w, w).sqrt();
            ((rho - big).powi(2) + h * h).sqrt() - small
        })
        .collect()
}

/// Solve an 8×8 linear system by Gaussian elimination with partial pivoting.
fn solve8(mut a: [[f64; 8]; 8], mut b: [f64; 8]) -> Option<[f64; 8]> {
    for col in 0..8 {
        let mut piv = col;
        for r in col + 1..8 {
            if a[r][col].abs() > a[piv][col].abs() {
                piv = r;
            }
        }
        if a[piv][col].abs() < 1e-12 {
            return None;
        }
        a.swap(col, piv);
        b.swap(col, piv);
        for r in 0..8 {
            if r == col {
                continue;
            }
            let f = a[r][col] / a[col][col];
            for k in col..8 {
                a[r][k] -= f * a[col][k];
            }
            b[r] -= f * b[col];
        }
    }
    let mut x = [0.0; 8];
    for i in 0..8 {
        x[i] = b[i] / a[i][i];
    }
    Some(x)
}

/// Levenberg–Marquardt refinement of a torus fit from initial `x0`.
fn torus_lm(pts: &[[f64; 3]], x0: [f64; 8]) -> (f64, [f64; 8]) {
    let mut x = x0;
    let mut lambda = 1e-3;
    let mut f = torus_resid(pts, &x);
    let mut cost: f64 = f.iter().map(|v| v * v).sum();
    let eps = 1e-5;
    for _ in 0..60 {
        // Numerical Jacobian (n×8) → accumulate JtJ (8×8) and Jtf (8).
        let mut jt_j = [[0.0f64; 8]; 8];
        let mut jt_f = [0.0f64; 8];
        let mut jac: Vec<[f64; 8]> = vec![[0.0; 8]; pts.len()];
        for k in 0..8 {
            let mut xp = x;
            xp[k] += eps;
            let fp = torus_resid(pts, &xp);
            for i in 0..pts.len() {
                jac[i][k] = (fp[i] - f[i]) / eps;
            }
        }
        for row in &jac {
            for a in 0..8 {
                for b in 0..8 {
                    jt_j[a][b] += row[a] * row[b];
                }
            }
        }
        for (i, row) in jac.iter().enumerate() {
            for a in 0..8 {
                jt_f[a] += row[a] * f[i];
            }
        }
        let mut improved = false;
        for _ in 0..8 {
            let mut damped = jt_j;
            for d in 0..8 {
                damped[d][d] += lambda * (jt_j[d][d] + 1e-9);
            }
            let neg: [f64; 8] = std::array::from_fn(|i| -jt_f[i]);
            let Some(step) = solve8(damped, neg) else {
                break;
            };
            let xn: [f64; 8] = std::array::from_fn(|i| x[i] + step[i]);
            let fn_ = torus_resid(pts, &xn);
            let cn: f64 = fn_.iter().map(|v| v * v).sum();
            if cn < cost {
                x = xn;
                f = fn_;
                cost = cn;
                lambda = (lambda * 0.5).max(1e-7);
                improved = true;
                break;
            }
            lambda *= 3.0;
        }
        if !improved {
            break;
        }
    }
    ((cost / pts.len() as f64).sqrt(), x)
}

/// Fit a torus to the point cloud: a coarse search over candidate axes (a
/// Fibonacci sphere, scored by how well the points fit a single ring) seeds
/// several LM refinements; the lowest-residual fit wins. Returns
/// `(centre, axis, bend_radius, tube_radius, rms)`.
fn fit_torus(pts: &[[f64; 3]]) -> Option<([f64; 3], [f64; 3], f64, f64, f64)> {
    let n = pts.len();
    let c0 = {
        let s = pts.iter().fold([0.0; 3], |a, p| vadd(a, *p));
        vscale(s, 1.0 / n as f64)
    };
    // Coarse candidates over a Fibonacci sphere.
    let m = 150usize;
    let ga = std::f64::consts::PI * (3.0 - 5.0_f64.sqrt());
    let mut cand: Vec<(f64, [f64; 3], f64, f64)> = Vec::with_capacity(m);
    for i in 0..m {
        let z = 1.0 - 2.0 * (i as f64 + 0.5) / m as f64;
        let rr = (1.0 - z * z).max(0.0).sqrt();
        let t = ga * i as f64;
        let dir = [rr * t.cos(), rr * t.sin(), z];
        // project, fit ring radius = mean rho, score = std of dist-to-ring
        let mut rhos = Vec::with_capacity(n);
        let mut hs = Vec::with_capacity(n);
        for p in pts {
            let v = vsub(*p, c0);
            let h = vdot(v, dir);
            let w = vsub(v, vscale(dir, h));
            rhos.push(vdot(w, w).sqrt());
            hs.push(h);
        }
        let big = rhos.iter().sum::<f64>() / n as f64;
        let ds: Vec<f64> = (0..n)
            .map(|i| ((rhos[i] - big).powi(2) + hs[i] * hs[i]).sqrt())
            .collect();
        let small = ds.iter().sum::<f64>() / n as f64;
        let score = (ds.iter().map(|d| (d - small).powi(2)).sum::<f64>() / n as f64).sqrt();
        cand.push((score, dir, big, small));
    }
    cand.sort_by(|a, b| fcmp(a.0, b.0));
    let mut best: Option<(f64, [f64; 8])> = None;
    for (_, dir, big, small) in cand.into_iter().take(10) {
        let x0 = [
            c0[0],
            c0[1],
            c0[2],
            dir[0],
            dir[1],
            dir[2],
            big,
            small.max(1e-3),
        ];
        let (rms, x) = torus_lm(pts, x0);
        if best.map_or(true, |(r, _)| rms < r) {
            best = Some((rms, x));
        }
    }
    let (rms, x) = best?;
    Some((
        [x[0], x[1], x[2]],
        vunit([x[3], x[4], x[5]]),
        x[6].abs(),
        x[7].abs(),
        rms,
    ))
}

/// Reconstruct a curved tube by fitting a torus and re-tessellating it as a
/// clean ring grid. Returns None if the cloud isn't a clean torus (→ strip).
fn torus_mesh(positions: &[[f32; 3]]) -> Option<(Vec<[f32; 3]>, Vec<u32>)> {
    if positions.len() < 24 {
        return None;
    }
    let pts: Vec<[f64; 3]> = positions
        .iter()
        .map(|p| [p[0] as f64, p[1] as f64, p[2] as f64])
        .collect();
    let (c, n, big, small, rms) = fit_torus(&pts)?;
    let (mut mn, mut mx) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
    for p in &pts {
        for i in 0..3 {
            mn[i] = mn[i].min(p[i]);
            mx[i] = mx[i].max(p[i]);
        }
    }
    let diag = ((mx[0] - mn[0]).powi(2) + (mx[1] - mn[1]).powi(2) + (mx[2] - mn[2]).powi(2)).sqrt();
    // A genuine torus: tiny residual + valid geometry (bend > tube).
    if rms > 0.03 * diag.max(1e-3) || big <= small * 1.05 || small < 1e-3 {
        return None;
    }

    // Arc-plane basis; per-point arc angle; arc range via the largest angular gap.
    let e1 = {
        let up = if n[0].abs() < 0.9 {
            [1.0, 0.0, 0.0]
        } else {
            [0.0, 1.0, 0.0]
        };
        vunit(vsub(up, vscale(n, vdot(up, n))))
    };
    let e2 = vcross(n, e1);
    let mut angs: Vec<f64> = pts
        .iter()
        .map(|p| {
            let v = vsub(*p, c);
            vdot(v, e2).atan2(vdot(v, e1))
        })
        .collect();
    angs.sort_by(|a, b| fcmp(*a, *b));
    let two_pi = std::f64::consts::TAU;
    let (mut gap, mut gi) = (0.0, 0usize);
    for i in 0..angs.len() {
        let g = if i + 1 < angs.len() {
            angs[i + 1] - angs[i]
        } else {
            angs[0] + two_pi - angs[i]
        };
        if g > gap {
            gap = g;
            gi = i;
        }
    }
    let full = gap < 0.35; // a near-complete ring
    let (a0, span) = if full {
        (0.0, two_pi)
    } else {
        let start = angs[(gi + 1) % angs.len()];
        (start, two_pi - gap)
    };
    let ss = 12usize;
    let segs_l = (span / two_pi * 16.0).round().max(2.0) as usize;
    let rings = if full { segs_l } else { segs_l + 1 };
    let mut pos: Vec<[f32; 3]> = Vec::with_capacity(rings * ss);
    for u in 0..rings {
        let a = a0 + span * u as f64 / segs_l as f64;
        let radial = vadd(vscale(e1, a.cos()), vscale(e2, a.sin()));
        let center = vadd(c, vscale(radial, big));
        for k in 0..ss {
            let b = two_pi * k as f64 / ss as f64;
            let p = vadd(
                center,
                vadd(vscale(radial, small * b.cos()), vscale(n, small * b.sin())),
            );
            pos.push([p[0] as f32, p[1] as f32, p[2] as f32]);
        }
    }
    let nr = pos.len() / ss;
    let mut idx = Vec::new();
    let last_u = if full { nr } else { nr - 1 };
    for u in 0..last_u {
        let u1 = (u + 1) % nr;
        for k in 0..ss {
            let k1 = (k + 1) % ss;
            let (a, b, cc, d) = (
                (u * ss + k) as u32,
                (u * ss + k1) as u32,
                (u1 * ss + k1) as u32,
                (u1 * ss + k) as u32,
            );
            idx.extend_from_slice(&[a, b, cc, a, cc, d]);
        }
    }
    Some((pos, idx))
}

// ─── Solid-of-revolution reconstruction (axial ring meshes) ─────────────────
// Cones, tapered nozzles/reducers, faceted tubes, spheres and end-cups are
// stored as explicit triangle-strip meshes whose packed connectivity we can't
// decode, so the strip expansion crumples and the 2-layer slab / torus fits
// don't apply. Their vertices, however, lie on a *surface of revolution*: each
// point has a well-defined position along a principal axis and an angle about
// it. We PCA the cloud for that axis, map every vertex to (axial t, angle θ),
// and re-triangulate in that parameter plane (a periodic-in-θ 2-D Delaunay over
// the *original* indices). This re-connects the exact vertices with clean
// manifold topology. A single vertex at one axial extreme = a cone apex (it
// fans naturally). Triangles that bridge an empty axial band (a hollow nozzle
// gap) are dropped, and a final quality gate rejects genuinely irregular /
// freeform clouds — which fall back to the strip expansion.

/// Compute the cloud centroid and an orthonormal PCA basis `(axis, e1, e2)`
/// where `axis` is the dominant eigenvector of the covariance (the revolution
/// axis) and `e1, e2` span the cross-section plane. Returns `None` if the cloud
/// is too small or degenerate.
fn pca_basis(positions: &[[f32; 3]]) -> Option<([f64; 3], [[f64; 3]; 3])> {
    let n = positions.len();
    if n < 8 {
        return None;
    }
    let nf = n as f64;
    let mut c = [0f64; 3];
    for p in positions {
        for i in 0..3 {
            c[i] += p[i] as f64;
        }
    }
    for i in 0..3 {
        c[i] /= nf;
    }
    let mut cov = [[0f64; 3]; 3];
    for p in positions {
        let d = [p[0] as f64 - c[0], p[1] as f64 - c[1], p[2] as f64 - c[2]];
        for i in 0..3 {
            for j in 0..3 {
                cov[i][j] += d[i] * d[j];
            }
        }
    }
    // Dominant eigenvector (power iteration), then deflate for the other two.
    let mul = |m: &[[f64; 3]; 3], v: [f64; 3]| {
        [
            m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
            m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
            m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
        ]
    };
    let power = |m: &[[f64; 3]; 3], seed: [f64; 3]| -> Option<[f64; 3]> {
        let mut v = seed;
        for _ in 0..64 {
            let nv = mul(m, v);
            let l = (nv[0] * nv[0] + nv[1] * nv[1] + nv[2] * nv[2]).sqrt();
            if l < 1e-12 {
                return None;
            }
            v = [nv[0] / l, nv[1] / l, nv[2] / l];
        }
        Some(v)
    };
    let axis = power(&cov, [0.71, 0.42, 0.56])?;
    // Deflate: cov2 = cov - λ axis axisᵀ.
    let av = mul(&cov, axis);
    let lam = av[0] * axis[0] + av[1] * axis[1] + av[2] * axis[2];
    let mut cov2 = cov;
    for i in 0..3 {
        for j in 0..3 {
            cov2[i][j] -= lam * axis[i] * axis[j];
        }
    }
    let mut e1 = power(&cov2, [0.13, 0.79, 0.6])?;
    // Re-orthogonalise e1 against axis, then e2 = axis × e1.
    let d1 = e1[0] * axis[0] + e1[1] * axis[1] + e1[2] * axis[2];
    for i in 0..3 {
        e1[i] -= d1 * axis[i];
    }
    let l1 = (e1[0] * e1[0] + e1[1] * e1[1] + e1[2] * e1[2]).sqrt();
    if l1 < 1e-9 {
        return None;
    }
    for i in 0..3 {
        e1[i] /= l1;
    }
    let e2 = [
        axis[1] * e1[2] - axis[2] * e1[1],
        axis[2] * e1[0] - axis[0] * e1[2],
        axis[0] * e1[1] - axis[1] * e1[0],
    ];
    Some((c, [axis, e1, e2]))
}

/// Periodic-in-x 2-D Delaunay triangulation (Bowyer–Watson) of the points
/// `pts` (each `(x, y)`), returning triangles as index triples into `pts`. The
/// x coordinate is treated as an angle that wraps over `period`: each point is
/// duplicated at `x-period` and `x+period` so triangles can straddle the seam,
/// and the duplicates are folded back to their canonical index afterwards.
fn delaunay_periodic(pts: &[(f64, f64)], period: f64) -> Vec<[usize; 3]> {
    let n = pts.len();
    if n < 3 {
        return Vec::new();
    }
    // Build the wrapped point set: 3 copies (−period, 0, +period in x).
    let mut wp: Vec<(f64, f64)> = Vec::with_capacity(3 * n);
    let mut orig: Vec<usize> = Vec::with_capacity(3 * n);
    for s in [-period, 0.0, period] {
        for (i, &(x, y)) in pts.iter().enumerate() {
            wp.push((x + s, y));
            orig.push(i);
        }
    }
    let m = wp.len();
    // Super-triangle enclosing all points.
    let (mut minx, mut miny, mut maxx, mut maxy) = (
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    );
    for &(x, y) in &wp {
        minx = minx.min(x);
        miny = miny.min(y);
        maxx = maxx.max(x);
        maxy = maxy.max(y);
    }
    let dx = (maxx - minx).max(1e-6);
    let dy = (maxy - miny).max(1e-6);
    let dmax = dx.max(dy) * 20.0;
    let midx = (minx + maxx) * 0.5;
    let midy = (miny + maxy) * 0.5;
    let mut verts = wp.clone();
    let s0 = verts.len();
    verts.push((midx - dmax, midy - dmax));
    verts.push((midx, midy + dmax));
    verts.push((midx + dmax, midy - dmax));

    // Circumcircle test (returns true if point d is strictly inside abc's circle).
    let in_circ = |a: (f64, f64), b: (f64, f64), c: (f64, f64), d: (f64, f64)| -> bool {
        let ax = a.0 - d.0;
        let ay = a.1 - d.1;
        let bx = b.0 - d.0;
        let by = b.1 - d.1;
        let cx = c.0 - d.0;
        let cy = c.1 - d.1;
        let det = (ax * ax + ay * ay) * (bx * cy - cx * by)
            - (bx * bx + by * by) * (ax * cy - cx * ay)
            + (cx * cx + cy * cy) * (ax * by - bx * ay);
        // Orientation of abc must be CCW for this sign convention.
        let orient = (b.0 - a.0) * (c.1 - a.1) - (c.0 - a.0) * (b.1 - a.1);
        if orient > 0.0 {
            det > 1e-12
        } else {
            det < -1e-12
        }
    };

    let mut tris: Vec<[usize; 3]> = vec![[s0, s0 + 1, s0 + 2]];
    for ip in 0..m {
        let p = verts[ip];
        // Find triangles whose circumcircle contains p; collect their edges.
        let mut bad: Vec<usize> = Vec::new();
        for (ti, t) in tris.iter().enumerate() {
            if in_circ(verts[t[0]], verts[t[1]], verts[t[2]], p) {
                bad.push(ti);
            }
        }
        // Boundary of the polygonal hole = edges not shared by two bad triangles.
        let mut edges: Vec<(usize, usize)> = Vec::new();
        for &ti in &bad {
            let t = tris[ti];
            for e in [(t[0], t[1]), (t[1], t[2]), (t[2], t[0])] {
                let key = (e.0.min(e.1), e.0.max(e.1));
                if let Some(pos) = edges.iter().position(|&(a, b)| (a, b) == key) {
                    edges.swap_remove(pos); // shared → interior, drop both
                } else {
                    edges.push(key);
                }
            }
        }
        // Remove bad triangles (descending index to keep positions valid).
        bad.sort_unstable();
        for &ti in bad.iter().rev() {
            tris.swap_remove(ti);
        }
        // Re-triangulate the hole to p.
        for (a, b) in edges {
            tris.push([a, b, ip]);
        }
    }

    // Drop triangles touching the super-triangle, fold to canonical indices,
    // and de-duplicate (the 3 wrapped copies produce each real triangle thrice).
    let mut out: Vec<[usize; 3]> = Vec::new();
    let mut seen: std::collections::HashSet<[usize; 3]> = std::collections::HashSet::new();
    for t in &tris {
        if t[0] >= s0 || t[1] >= s0 || t[2] >= s0 {
            continue;
        }
        let mut tri = [orig[t[0]], orig[t[1]], orig[t[2]]];
        if tri[0] == tri[1] || tri[1] == tri[2] || tri[0] == tri[2] {
            continue;
        }
        // Canonical key: smallest index first, preserve cyclic order for winding.
        let mut key = tri;
        key.sort_unstable();
        if !seen.insert(key) {
            continue;
        }
        // Keep a representative whose centroid x lies in the base period window so
        // each real triangle is emitted exactly once with sensible coordinates.
        // (Winding is fixed up later from 3-D normals if needed; here we keep the
        // wrapped order for a consistent param-plane orientation.)
        let _ = &mut tri;
        out.push(tri);
    }
    out
}

// ─── Unified faithful reconstruction ────────────────────────────────────────
// Re-connect the ORIGINAL vertices (no resampling / coarsening) for the two
// dominant families of NWD geometry:
//   • straight-axis solids of revolution — cylinders, tubes, cones, reducers,
//     domes/cups — parameterised by (axial distance t, angle θ about a PCA axis);
//   • curved-axis tubes — elbows / bends / U-bends — parameterised by (arc angle
//     φ along a fitted circular centerline, tube angle β around the centerline).
// Each vertex maps to a 2-D parameter point; a periodic-in-angle Delaunay
// (`delaunay_periodic`) reconnects the EXACT vertices with clean manifold
// topology. A quality gate (no oversized bridge triangles, near-all vertices
// used) rejects freeform clouds so they fall through to the coarse fitters.

/// Shared param-plane triangulation + emit: given each original vertex's 2-D
/// parameter `(u, v)` where `u` wraps over `period`, and an optional list of
/// empty `voids` in `v` to suppress bridging across, triangulate and emit the
/// ORIGINAL `positions` with outward-oriented winding. Applies the clean-manifold
/// quality gate; returns `None` on failure.
fn triangulate_param_plane(
    positions: &[[f32; 3]],
    uv: &[(f64, f64)],
    period: f64,
    centroid: [f64; 3],
    voids: &[(f64, f64)],
) -> Option<(Vec<[f32; 3]>, Vec<u32>)> {
    let n = positions.len();
    if n < 8 || uv.len() != n {
        return None;
    }
    let tris = delaunay_periodic(uv, period);
    if tris.is_empty() {
        return None;
    }
    let p3 = |k: usize| {
        [
            positions[k][0] as f64,
            positions[k][1] as f64,
            positions[k][2] as f64,
        ]
    };
    let edge = |i: usize, j: usize| {
        let a = p3(i);
        let b = p3(j);
        ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)).sqrt()
    };
    let crosses_void = |a: usize, b: usize, cc: usize| {
        let lo = uv[a].1.min(uv[b].1).min(uv[cc].1);
        let hi = uv[a].1.max(uv[b].1).max(uv[cc].1);
        voids
            .iter()
            .any(|&(va, vb)| lo <= va + 1e-6 && hi >= vb - 1e-6)
    };
    let mut kept: Vec<[usize; 3]> = Vec::new();
    let mut tri_maxedge: Vec<f64> = Vec::new();
    for tr in &tris {
        let [a, b, cc] = *tr;
        if crosses_void(a, b, cc) {
            continue;
        }
        let me = edge(a, b).max(edge(b, cc)).max(edge(a, cc));
        kept.push(*tr);
        tri_maxedge.push(me);
    }
    if kept.len() < 4 {
        return None;
    }
    // Quality gate: clean reconstructions have near-uniform triangle size; long
    // bridge triangles (freeform clouds, mis-parameterised shapes) are rejected.
    let mut sorted = tri_maxedge.clone();
    sorted.sort_by(|a, b| fcmp(*a, *b));
    let med = sorted[sorted.len() / 2].max(1e-9);
    let long = tri_maxedge.iter().filter(|e| **e > 4.0 * med).count();
    let frac_long = long as f64 / tri_maxedge.len() as f64;
    let max_ratio = sorted[sorted.len() - 1] / med;
    if frac_long > 0.03 || max_ratio > 6.0 {
        return None;
    }
    // Faithfulness: nearly every original vertex must participate.
    let mut used = vec![false; n];
    for tr in &kept {
        for &k in tr.iter() {
            used[k] = true;
        }
    }
    if used.iter().filter(|u| **u).count() < n * 9 / 10 {
        return None;
    }
    // Emit with the ORIGINAL vertices; orient each triangle outward (normal away
    // from the cloud centroid) for consistent winding.
    let cf = [centroid[0] as f32, centroid[1] as f32, centroid[2] as f32];
    let mut idx: Vec<u32> = Vec::with_capacity(kept.len() * 3);
    for tr in &kept {
        let [a, b, cc] = *tr;
        let pa = positions[a];
        let pb = positions[b];
        let pc = positions[cc];
        let ab = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
        let ac = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
        let nrm = [
            ab[1] * ac[2] - ab[2] * ac[1],
            ab[2] * ac[0] - ab[0] * ac[2],
            ab[0] * ac[1] - ab[1] * ac[0],
        ];
        let centroid = [
            (pa[0] + pb[0] + pc[0]) / 3.0,
            (pa[1] + pb[1] + pc[1]) / 3.0,
            (pa[2] + pb[2] + pc[2]) / 3.0,
        ];
        let out = [
            centroid[0] - cf[0],
            centroid[1] - cf[1],
            centroid[2] - cf[2],
        ];
        let dotp = nrm[0] * out[0] + nrm[1] * out[1] + nrm[2] * out[2];
        if dotp >= 0.0 {
            idx.extend_from_slice(&[a as u32, b as u32, cc as u32]);
        } else {
            idx.extend_from_slice(&[a as u32, cc as u32, b as u32]);
        }
    }
    Some((positions.to_vec(), idx))
}

/// Curved-axis tube reconstruction that PRESERVES the original vertices. A pipe
/// elbow/bend's vertices lie on a torus; we fit that torus (centre `c`, axis `n`,
/// bend radius), then parameterise each ORIGINAL vertex by (arc angle φ along the
/// centerline, tube angle β around it) and triangulate in that plane. Unlike
/// `torus_mesh` (which re-tessellates to a fixed grid), this keeps every original
/// vertex. Returns `None` if the cloud isn't a clean partial torus.
fn faithful_curved_mesh(positions: &[[f32; 3]]) -> Option<(Vec<[f32; 3]>, Vec<u32>)> {
    let n = positions.len();
    if n < 24 {
        return None;
    }
    let pts: Vec<[f64; 3]> = positions
        .iter()
        .map(|p| [p[0] as f64, p[1] as f64, p[2] as f64])
        .collect();
    let (c, axis, big, small, rms) = fit_torus(&pts)?;
    let (mut mn, mut mx) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
    for p in &pts {
        for i in 0..3 {
            mn[i] = mn[i].min(p[i]);
            mx[i] = mx[i].max(p[i]);
        }
    }
    let diag = ((mx[0] - mn[0]).powi(2) + (mx[1] - mn[1]).powi(2) + (mx[2] - mn[2]).powi(2)).sqrt();
    if rms > 0.03 * diag.max(1e-3) || big <= small * 1.05 || small < 1e-3 {
        return None;
    }
    // Arc-plane basis (e1, e2) ⟂ axis n.
    let e1 = {
        let up = if axis[0].abs() < 0.9 {
            [1.0, 0.0, 0.0]
        } else {
            [0.0, 1.0, 0.0]
        };
        vunit(vsub(up, vscale(axis, vdot(up, axis))))
    };
    let e2 = vcross(axis, e1);
    // Per-vertex arc angle φ (about the centre, in the arc plane) and tube angle β
    // (about the local centerline point). Build a continuous arc coordinate so the
    // straddling Delaunay works on the SHORT arc, not the full circle: rotate φ so
    // the largest angular gap is the seam, then use φ as the non-periodic axis and
    // β as the periodic one.
    let mut phi: Vec<f64> = pts
        .iter()
        .map(|p| {
            let v = vsub(*p, c);
            vdot(v, e2).atan2(vdot(v, e1))
        })
        .collect();
    let two_pi = std::f64::consts::TAU;
    // Locate the largest gap in sorted φ → arc start.
    let mut order: Vec<usize> = (0..n).collect();
    order.sort_by(|&a, &b| fcmp(phi[a], phi[b]));
    let (mut gap, mut gstart) = (0.0f64, phi[order[0]]);
    for w in 0..n {
        let cur = phi[order[w]];
        let nxt = if w + 1 < n {
            phi[order[w + 1]]
        } else {
            phi[order[0]] + two_pi
        };
        if nxt - cur > gap {
            gap = nxt - cur;
            gstart = if w + 1 < n {
                phi[order[w + 1]]
            } else {
                phi[order[0]] + two_pi
            };
        }
    }
    // Re-base φ to [0, 2π) starting at the gap end (arc start).
    for p in phi.iter_mut() {
        let mut a = *p - gstart;
        while a < 0.0 {
            a += two_pi;
        }
        while a >= two_pi {
            a -= two_pi;
        }
        *p = a;
    }
    let phi_span = phi.iter().cloned().fold(0.0f64, f64::max).max(1e-6);
    // Tube angle β: position relative to the local centerline point.
    let mut beta: Vec<f64> = vec![0.0; n];
    for (k, p) in pts.iter().enumerate() {
        // Local centerline direction at this vertex's arc angle (re-based).
        let a = phi[k] + gstart;
        let radial = vadd(vscale(e1, a.cos()), vscale(e2, a.sin()));
        let center = vadd(c, vscale(radial, big));
        let v = vsub(*p, center);
        // Decompose v in (radial, axis) — the tube cross-section plane.
        let br = vdot(v, radial);
        let bn = vdot(v, axis);
        beta[k] = bn.atan2(br);
    }
    // Parameter plane: u = β (periodic over 2π), v = φ scaled so a full tube turn
    // maps to comparable extent to the arc (near-isotropic triangles). Scale β by
    // small, φ by big so both axes are in length units.
    let su = small;
    let sv = big;
    let uv: Vec<(f64, f64)> = (0..n).map(|k| (beta[k] * su, phi[k] * sv)).collect();
    // If the arc is (near) closed, treat φ as periodic too by NOT marking voids;
    // otherwise it's a partial arc and the seam gap is already excluded.
    let _ = phi_span;
    triangulate_param_plane(positions, &uv, two_pi * su, c, &[])
}

/// Faithful **ring-loft** reconstruction that PRESERVES the original vertices.
/// Bins the cloud into rings along a PCA axis, orders each ring by angle, and
/// lofts consecutive rings together (handling unequal ring sizes by nearest
/// angle); a single-vertex extreme ring is a cone apex (fans naturally); the two
/// outermost rings are capped. This is the canonical reconstruction for
/// cylinders / tubes / cones / reducers stored as a small number of explicit
/// rings (e.g. just two end-cap rings) — cases where the (θ,t) Delaunay's void
/// gate drops the single connecting band. Returns `None` when the cloud isn't a
/// clean stack of co-axial rings (→ revolve / curved / coarse fitters).
fn faithful_ring_loft(positions: &[[f32; 3]]) -> Option<(Vec<[f32; 3]>, Vec<u32>)> {
    let n = positions.len();
    if n < 6 {
        return None;
    }
    let (c, basis) = pca_basis(positions)?;
    let (axis, e1, e2) = (basis[0], basis[1], basis[2]);
    // (axial t, angle θ, radius ρ) per vertex.
    let mut t = vec![0f64; n];
    let mut th = vec![0f64; n];
    let mut rho = vec![0f64; n];
    for (k, p) in positions.iter().enumerate() {
        let d = [p[0] as f64 - c[0], p[1] as f64 - c[1], p[2] as f64 - c[2]];
        t[k] = d[0] * axis[0] + d[1] * axis[1] + d[2] * axis[2];
        let x = d[0] * e1[0] + d[1] * e1[1] + d[2] * e1[2];
        let y = d[0] * e2[0] + d[1] * e2[1] + d[2] * e2[2];
        th[k] = y.atan2(x);
        rho[k] = (x * x + y * y).sqrt();
    }
    let tmin = t.iter().cloned().fold(f64::INFINITY, f64::min);
    let tmax = t.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let rng = tmax - tmin;
    if rng < 1e-5 {
        return None;
    }
    // Cluster vertices into rings by their axial coordinate: sort t, split at gaps
    // that are a large fraction of the extent and several × the typical spacing.
    let mut order: Vec<usize> = (0..n).collect();
    order.sort_by(|&a, &b| fcmp(t[a], t[b]));
    let mut gaps: Vec<f64> = order.windows(2).map(|w| t[w[1]] - t[w[0]]).collect();
    let mut sg = gaps.clone();
    sg.sort_by(|a, b| fcmp(*a, *b));
    let med_gap = if sg.is_empty() { 0.0 } else { sg[sg.len() / 2] };
    let split = (rng * 0.04).max(med_gap * 4.0);
    let mut rings: Vec<Vec<usize>> = Vec::new();
    let mut cur = vec![order[0]];
    for w in 0..gaps.len() {
        if gaps[w] > split {
            rings.push(std::mem::take(&mut cur));
        }
        cur.push(order[w + 1]);
    }
    rings.push(cur);
    let _ = &mut gaps;
    // Need a genuine stack: ≥2 rings, and each interior ring large enough to be a
    // real cross-section. Rings of 1 vertex are apexes (allowed only at the ends).
    // Rings of exactly 2 vertices cause degenerate loft geometry → reject.
    if rings.len() < 2 || rings.iter().any(|r| r.len() == 2) {
        return None;
    }
    // Order each ring CCW by angle (its own centroid angle for stability).
    for ring in rings.iter_mut() {
        if ring.len() >= 2 {
            let (mut sx, mut sy) = (0.0f64, 0.0f64);
            for &k in ring.iter() {
                sx += rho[k] * th[k].cos();
                sy += rho[k] * th[k].sin();
            }
            let (cx, cy) = (sx / ring.len() as f64, sy / ring.len() as f64);
            ring.sort_by(|&a, &b| {
                let aa = (rho[a] * th[a].sin() - cy).atan2(rho[a] * th[a].cos() - cx);
                let bb = (rho[b] * th[b].sin() - cy).atan2(rho[b] * th[b].cos() - cx);
                fcmp(aa, bb)
            });
        }
    }
    // Axisymmetry sanity: every multi-vertex ring should be roughly round (radial
    // spread small vs mean). Rejects flat plates / boxes (→ slab) routed here.
    // Also check angular coverage: a genuine round ring covers ~360° continuously;
    // a C-channel profile (or other open section) leaves a gap > 80°.
    let mut sane_rings = 0usize;
    for ring in &rings {
        if ring.len() < 3 {
            continue;
        }
        let m = ring.iter().map(|&k| rho[k]).sum::<f64>() / ring.len() as f64;
        if m < 1e-6 {
            continue;
        }
        let var = ring.iter().map(|&k| (rho[k] - m).powi(2)).sum::<f64>() / ring.len() as f64;
        if var.sqrt() / m > 0.22 {
            return None; // a ring isn't round → not a co-axial ring stack
        }
        sane_rings += 1;
    }
    if sane_rings < 1 {
        return None;
    }

    // Loft consecutive rings, matching by nearest angle so unequal ring sizes
    // connect without long bridges. Emit ORIGINAL-vertex indices.
    let ang = |k: usize| th[k];
    // Disconnected-ring guard: if the minimum 3-D distance between any two
    // consecutive rings is much larger than the typical within-ring vertex
    // spacing, the "rings" are separate physical pieces (e.g. the two C-channel
    // rails of a cable tray) and must NOT be lofted together.
    let dist3 = |a: usize, b: usize| -> f32 {
        let pa = positions[a];
        let pb = positions[b];
        ((pa[0] - pb[0]).powi(2) + (pa[1] - pb[1]).powi(2) + (pa[2] - pb[2]).powi(2)).sqrt()
    };
    let median_nn = |ring: &[usize]| -> f32 {
        if ring.len() < 2 {
            return 0.0;
        }
        let mut nn: Vec<f32> = ring
            .iter()
            .map(|&a| {
                ring.iter()
                    .filter(|&&b| b != a)
                    .map(|&b| dist3(a, b))
                    .fold(f32::INFINITY, f32::min)
            })
            .collect();
        nn.sort_by(|x, y| fcmp(*x, *y));
        nn[nn.len() / 2]
    };
    for w in 0..rings.len() - 1 {
        let ra = &rings[w];
        let rb = &rings[w + 1];
        let min_inter: f32 = ra
            .iter()
            .flat_map(|&a| rb.iter().map(move |&b| dist3(a, b)))
            .fold(f32::INFINITY, f32::min);
        let spacing = median_nn(ra).max(median_nn(rb));
        if spacing > 1e-6 && min_inter > 4.0 * spacing {
            return None; // two separate pieces, not a continuous tube
        }
    }

    let mut idx: Vec<u32> = Vec::new();
    let nrm_out = |a: usize, b: usize, cc: usize, push: &mut Vec<u32>| {
        let pa = positions[a];
        let pb = positions[b];
        let pc = positions[cc];
        if pa == pb || pb == pc || pa == pc {
            return;
        }
        let ab = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
        let ac = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
        let nv = [
            ab[1] * ac[2] - ab[2] * ac[1],
            ab[2] * ac[0] - ab[0] * ac[2],
            ab[0] * ac[1] - ab[1] * ac[0],
        ];
        let cen = [
            ((pa[0] + pb[0] + pc[0]) / 3.0) as f64 - c[0],
            ((pa[1] + pb[1] + pc[1]) / 3.0) as f64 - c[1],
            ((pa[2] + pb[2] + pc[2]) / 3.0) as f64 - c[2],
        ];
        let dot = nv[0] as f64 * cen[0] + nv[1] as f64 * cen[1] + nv[2] as f64 * cen[2];
        if dot >= 0.0 {
            push.extend_from_slice(&[a as u32, b as u32, cc as u32]);
        } else {
            push.extend_from_slice(&[a as u32, cc as u32, b as u32]);
        }
    };
    for w in 0..rings.len() - 1 {
        let lo = &rings[w];
        let hi = &rings[w + 1];
        match (lo.len(), hi.len()) {
            (1, _) => {
                // apex fan to hi ring
                let apex = lo[0];
                for j in 0..hi.len() {
                    let j1 = (j + 1) % hi.len();
                    nrm_out(apex, hi[j], hi[j1], &mut idx);
                }
            }
            (_, 1) => {
                let apex = hi[0];
                for i in 0..lo.len() {
                    let i1 = (i + 1) % lo.len();
                    nrm_out(apex, lo[i1], lo[i], &mut idx);
                }
            }
            (la, ha) => {
                // Two-pointer angle merge: walk both angle-sorted rings together,
                // always advancing whichever ring's NEXT vertex has the smaller
                // forward angular step. Each advance emits one triangle sharing the
                // current edge — a clean strip with no long diagonal bridges even
                // when the rings have very different vertex counts (e.g. 56 vs 24).
                let two_pi = std::f64::consts::TAU;
                // Align starts: pick the hi vertex whose angle is closest to lo[0].
                let a0 = ang(lo[0]);
                let mut bj = 0usize;
                {
                    let mut bestd = f64::INFINITY;
                    for (j, &k) in hi.iter().enumerate() {
                        let mut d = (ang(k) - a0).abs();
                        if d > std::f64::consts::PI {
                            d = two_pi - d;
                        }
                        if d < bestd {
                            bestd = d;
                            bj = j;
                        }
                    }
                }
                let fwd = |from: f64, to: f64| {
                    let mut d = to - from;
                    while d < 0.0 {
                        d += two_pi;
                    }
                    d
                };
                let (mut i, mut j) = (0usize, 0usize);
                let total = la + ha;
                for _ in 0..total {
                    let ci = lo[i % la];
                    let cj = hi[(bj + j) % ha];
                    let ni = lo[(i + 1) % la];
                    let nj = hi[(bj + j + 1) % ha];
                    // Purely proportional (Bresenham) advance: advance
                    // whichever ring is behind its fair share i/la vs j/ha.
                    // Angular-step guidance caused non-manifold for non-uniform
                    // rings (e.g. rectangles): a short angular step would advance
                    // lo twice, connecting one hi vertex to 3 lo vertices and
                    // pushing the same edge into 3 triangles. The `bj` alignment
                    // already ensures gross angular correspondence; proportional
                    // balance handles fine-grained alternation.
                    let lo_behind = (i as i64) * (ha as i64) <= (j as i64) * (la as i64);
                    let _ = fwd; // keep fwd in scope but no longer used here
                    if i < la && (j >= ha || lo_behind) {
                        // advance lo: triangle (ci, ni, cj)
                        nrm_out(ci, ni, cj, &mut idx);
                        i += 1;
                    } else {
                        // advance hi: triangle (ci, nj, cj)
                        nrm_out(ci, nj, cj, &mut idx);
                        j += 1;
                    }
                }
            }
        }
    }
    if idx.len() < 12 {
        return None;
    }
    // Clean-manifold gate runs on the LOFT (side) triangles only — cap fans
    // legitimately have edges up to the ring diameter (many × the side spacing),
    // so they'd otherwise trip the gate on short, fat shapes. `idx` currently holds
    // exactly the side triangles; caps are appended after the gate.
    let med = {
        let mut e: Vec<f64> = idx
            .chunks(3)
            .map(|tr| {
                let a = positions[tr[0] as usize];
                let b = positions[tr[1] as usize];
                let cc = positions[tr[2] as usize];
                let d = |p: [f32; 3], q: [f32; 3]| {
                    (((p[0] - q[0]).powi(2) + (p[1] - q[1]).powi(2) + (p[2] - q[2]).powi(2)) as f64)
                        .sqrt()
                };
                d(a, b).max(d(b, cc)).max(d(a, cc))
            })
            .collect();
        e.sort_by(|a, b| fcmp(*a, *b));
        e[e.len() / 2].max(1e-9)
    };
    let maxe = idx
        .chunks(3)
        .map(|tr| {
            let a = positions[tr[0] as usize];
            let b = positions[tr[1] as usize];
            let cc = positions[tr[2] as usize];
            let d = |p: [f32; 3], q: [f32; 3]| {
                (((p[0] - q[0]).powi(2) + (p[1] - q[1]).powi(2) + (p[2] - q[2]).powi(2)) as f64)
                    .sqrt()
            };
            d(a, b).max(d(b, cc)).max(d(a, cc))
        })
        .fold(0.0f64, f64::max);
    if maxe > 6.0 * med {
        return None;
    }
    // Caps on the two outermost multi-vertex rings (fan from first vertex), added
    // after the side-triangle gate so the cap diameter doesn't trip it.
    for ring in [rings.first().unwrap(), rings.last().unwrap()] {
        if ring.len() >= 3 {
            for i in 1..ring.len() - 1 {
                nrm_out(ring[0], ring[i], ring[i + 1], &mut idx);
            }
        }
    }
    Some((positions.to_vec(), idx))
}

/// Faithful **ring-tube** reconstruction (clean-room, what_we_know §40) — the
/// canonical path for pipe **elbows/bends**. A curved tube is stored as a stack of
/// closed cross-section **rings** (the decoded ring size `S` = verts/ring): around
/// a ring consecutive verts step ~one facet, and the rings stack along the (curved)
/// tube axis. We recover this purely GEOMETRICALLY (no fit, no codec-byte
/// inversion): the fine-scale nearest-neighbour graph (radius ≈ the 1-NN around-ring
/// spacing) splits the cloud into **degree-2 cycles = the rings**; we order each
/// ring cyclically, chain the rings into stacking order along the tube (start at an
/// end ring), and loft consecutive rings as **CLOSED bands** (wraparound
/// two-pointer merge) so the tube closes around its circumference — leaving only the
/// two open ends as boundary. (An earlier version mistook the rings for open
/// longitudinal strips and lofted an open sheet → a longitudinal slit; that was
/// wrong — the surface is closed.) The elbow's 120 verts → 6 rings × 20 → a clean
/// manifold tube. Returns `None` unless the cloud splits into ≥3 equal-length rings
/// whose closed loft is a clean manifold with bounded edges — so straight cylinders
/// / non-tube / freeform clouds fall through untouched.
fn faithful_strip_tube(positions: &[[f32; 3]]) -> Option<(Vec<[f32; 3]>, Vec<u32>)> {
    let n = positions.len();
    if n < 18 {
        return None;
    }
    let p: Vec<[f64; 3]> = positions
        .iter()
        .map(|q| [q[0] as f64, q[1] as f64, q[2] as f64])
        .collect();
    let dist = |a: usize, b: usize| -> f64 {
        let dx = p[a][0] - p[b][0];
        let dy = p[a][1] - p[b][1];
        let dz = p[a][2] - p[b][2];
        (dx * dx + dy * dy + dz * dz).sqrt()
    };
    // 1-NN median spacing (the fundamental facet edge length).
    let mut nn = vec![f64::INFINITY; n];
    for i in 0..n {
        for j in 0..n {
            if i != j {
                let dd = dist(i, j);
                if dd < nn[i] {
                    nn[i] = dd;
                }
            }
        }
    }
    let mut nns = nn.clone();
    nns.sort_by(|a, b| fcmp(*a, *b));
    let u = nns[n / 2];
    if !(u > 0.0) {
        return None;
    }
    // Adaptive radius: smallest factor of `u` that splits the cloud into ≥3 equal
    // strips (the codec's S longitudinal strips).
    let mut found: Option<(Vec<Vec<usize>>, Vec<Vec<usize>>)> = None;
    for fac in [1.3_f64, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0] {
        let r = u * fac;
        let mut adj: Vec<Vec<usize>> = vec![Vec::new(); n];
        for i in 0..n {
            for j in (i + 1)..n {
                if dist(i, j) <= r {
                    adj[i].push(j);
                    adj[j].push(i);
                }
            }
        }
        let mut seen = vec![false; n];
        let mut comps: Vec<Vec<usize>> = Vec::new();
        for s in 0..n {
            if seen[s] {
                continue;
            }
            let mut st = vec![s];
            let mut c = Vec::new();
            while let Some(x) = st.pop() {
                if seen[x] {
                    continue;
                }
                seen[x] = true;
                c.push(x);
                for &y in &adj[x] {
                    if !seen[y] {
                        st.push(y);
                    }
                }
            }
            comps.push(c);
        }
        let sz = comps[0].len();
        if comps.len() >= 3 && sz >= 4 && comps.iter().all(|c| c.len() == sz) {
            found = Some((comps, adj));
            break;
        }
    }
    let (comps, adj) = found?;
    let s_count = comps.len();
    // Order each component as a path (it must be a simple degree-2 chain).
    let order_strip = |c: &Vec<usize>| -> Option<Vec<usize>> {
        let cset: std::collections::BTreeSet<usize> = c.iter().cloned().collect();
        let local = |x: usize| -> Vec<usize> {
            adj[x]
                .iter()
                .cloned()
                .filter(|y| cset.contains(y))
                .collect()
        };
        let start = c
            .iter()
            .cloned()
            .find(|&x| local(x).len() == 1)
            .unwrap_or(c[0]);
        let mut path = vec![start];
        let mut vis: std::collections::BTreeSet<usize> = std::iter::once(start).collect();
        let mut prev = usize::MAX;
        let mut cur = start;
        while let Some(y) = local(cur)
            .into_iter()
            .find(|&y| y != prev && !vis.contains(&y))
        {
            path.push(y);
            vis.insert(y);
            prev = cur;
            cur = y;
        }
        (path.len() == c.len()).then_some(path)
    };
    let mut strips: Vec<Vec<usize>> = Vec::with_capacity(s_count);
    for c in &comps {
        strips.push(order_strip(c)?);
    }
    // Chain the strips around the cross-section by inter-strip min distance.
    let sd = |a: &Vec<usize>, b: &Vec<usize>| -> f64 {
        let mut m = f64::INFINITY;
        for &x in a {
            for &y in b {
                let dd = dist(x, y);
                if dd < m {
                    m = dd;
                }
            }
        }
        m
    };
    // Start at a channel END (a strip with the fewest close neighbours) so the
    // greedy chain walks along the section instead of starting mid-channel and
    // having to jump across it (which would create a tube-spanning rung).
    let mut g = f64::INFINITY;
    for i in 0..s_count {
        for j in (i + 1)..s_count {
            let s = sd(&strips[i], &strips[j]);
            if s < g {
                g = s;
            }
        }
    }
    let nbr_count = |i: usize| {
        (0..s_count)
            .filter(|&j| j != i && sd(&strips[i], &strips[j]) <= 1.5 * g)
            .count()
    };
    let start_strip = (0..s_count).min_by_key(|&i| nbr_count(i)).unwrap_or(0);
    let mut chain = vec![start_strip];
    // (ordered set: with a hash set, equal-distance ties were broken by the
    // per-process hash seed and the output changed from run to run)
    let mut rem: std::collections::BTreeSet<usize> =
        (0..s_count).filter(|&i| i != start_strip).collect();
    while !rem.is_empty() {
        let last = *chain.last().unwrap();
        let nx = *rem
            .iter()
            .min_by(|&&a, &&b| fcmp(sd(&strips[last], &strips[a]), sd(&strips[last], &strips[b])))
            .unwrap();
        chain.push(nx);
        rem.remove(&nx);
    }
    // Rings in chain order = their stacking order along the curved tube.
    let ordered: Vec<&Vec<usize>> = chain.iter().map(|&c| &strips[c]).collect();
    let centroid = {
        let mut c = [0.0f64; 3];
        for q in &p {
            c[0] += q[0];
            c[1] += q[1];
            c[2] += q[2];
        }
        [c[0] / n as f64, c[1] / n as f64, c[2] / n as f64]
    };
    let push_tri = |a: usize, b: usize, cc: usize, idx: &mut Vec<u32>| {
        let (pa, pb, pc) = (p[a], p[b], p[cc]);
        let ab = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
        let ac = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
        let nv = [
            ab[1] * ac[2] - ab[2] * ac[1],
            ab[2] * ac[0] - ab[0] * ac[2],
            ab[0] * ac[1] - ab[1] * ac[0],
        ];
        let cen = [
            (pa[0] + pb[0] + pc[0]) / 3.0 - centroid[0],
            (pa[1] + pb[1] + pc[1]) / 3.0 - centroid[1],
            (pa[2] + pb[2] + pc[2]) / 3.0 - centroid[2],
        ];
        let dot = nv[0] * cen[0] + nv[1] * cen[1] + nv[2] * cen[2];
        if dot >= 0.0 {
            idx.extend_from_slice(&[a as u32, b as u32, cc as u32]);
        } else {
            idx.extend_from_slice(&[a as u32, cc as u32, b as u32]);
        }
    };
    // Loft consecutive rings as CLOSED bands. Each ring is a cyclic loop; align the
    // next ring's start to this ring's vertex 0 (and pick its winding to match),
    // then walk both rings around with a shortest-diagonal two-pointer merge that
    // WRAPS (mod ring length). This closes the tube around its circumference (the
    // only boundary left is the two open ends) — the fix for the longitudinal slit
    // that an open-strip loft produced.
    let mut idx: Vec<u32> = Vec::new();
    for w in 0..ordered.len() - 1 {
        let a_s = ordered[w];
        let b_raw = ordered[w + 1];
        let (la, lb) = (a_s.len(), b_raw.len());
        // Rotate B so its start is the vertex nearest A[0]; choose direction so the
        // next B vertex follows A's winding (else B is wound the opposite way).
        let a0 = a_s[0];
        let bj = (0..lb)
            .min_by(|&i, &j| fcmp(dist(b_raw[i], a0), dist(b_raw[j], a0)))
            .unwrap();
        let a1 = a_s[1 % la];
        let fwd = dist(b_raw[(bj + 1) % lb], a1) <= dist(b_raw[(bj + lb - 1) % lb], a1);
        let b_s: Vec<usize> = (0..lb)
            .map(|k| {
                if fwd {
                    b_raw[(bj + k) % lb]
                } else {
                    b_raw[(bj + lb - k) % lb]
                }
            })
            .collect();
        let (mut i, mut j) = (0usize, 0usize);
        for _ in 0..(la + lb) {
            let ai = a_s[i % la];
            let bv = b_s[j % lb];
            let ani = a_s[(i + 1) % la];
            let anj = b_s[(j + 1) % lb];
            let d_lo = dist(ani, bv);
            let d_hi = dist(ai, anj);
            // Break distance ties proportionally (same balanced-merge logic as
            // faithful_ring_loft) to prevent equal-size rings from producing a
            // fan that puts an edge in 3 triangles → non-manifold.
            let lo_leading = (i as i64) * (lb as i64) > (j as i64) * (la as i64);
            if i < la && (j >= lb || d_lo < d_hi || (d_lo <= d_hi && !lo_leading)) {
                push_tri(ai, ani, bv, &mut idx);
                i += 1;
            } else {
                push_tri(ai, anj, bv, &mut idx);
                j += 1;
            }
        }
    }
    if idx.len() < 12 {
        return None;
    }
    // Gates: clean manifold (no edge in > 2 triangles) + bounded max edge.
    let mut ec: std::collections::HashMap<(u32, u32), u32> = std::collections::HashMap::new();
    let mut maxe = 0.0f64;
    for tr in idx.chunks(3) {
        for &(x, y) in &[(tr[0], tr[1]), (tr[1], tr[2]), (tr[0], tr[2])] {
            *ec.entry((x.min(y), x.max(y))).or_insert(0) += 1;
            let dd = dist(x as usize, y as usize);
            if dd > maxe {
                maxe = dd;
            }
        }
    }
    if ec.values().any(|&c| c > 2) || maxe > 6.0 * u {
        return None;
    }
    Some((positions.to_vec(), idx))
}

/// Unified faithful reconstructor. Tries, in order, paths that all PRESERVE the
/// ORIGINAL vertices at full resolution: the (θ,t) surface-of-revolution Delaunay
/// (`revolve_mesh`, best for many-ring stacks), the explicit ring-loft
/// (`faithful_ring_loft`, few-ring cylinders/cones), the clean-room strip-tube
/// (`faithful_strip_tube`, elbows/bends — §40), and the curved-axis param-plane
/// (`faithful_curved_mesh`, last resort). Returns `None` when none forms a clean
/// manifold (→ coarse fitters / strip).
fn faithful_axial_mesh(positions: &[[f32; 3]]) -> Option<(Vec<[f32; 3]>, Vec<u32>)> {
    // Strip-tube FIRST: it self-gates to ≥3 equal-length strips that loft to a
    // clean manifold, so straight cylinders / non-tube clouds fall through, but
    // elbows (which `revolve_mesh` mangles into a non-manifold) are caught here.
    if let Some(r) = faithful_strip_tube(positions) {
        return Some(r);
    }
    if let Some(r) = revolve_mesh(positions) {
        return Some(r);
    }
    if let Some(r) = faithful_ring_loft(positions) {
        return Some(r);
    }
    faithful_curved_mesh(positions)
}

/// Reconstruct an axially-structured surface of revolution from its raw
/// vertices. Returns `(positions, indices)` using the original vertices, or
/// `None` when the cloud isn't cleanly axisymmetric (→ strip fallback).
fn revolve_mesh(positions: &[[f32; 3]]) -> Option<(Vec<[f32; 3]>, Vec<u32>)> {
    let n = positions.len();
    if n < 12 {
        return None;
    }
    let (c, basis) = pca_basis(positions)?;
    let (axis, e1, e2) = (basis[0], basis[1], basis[2]);
    // Map each vertex to (axial t, angle θ) and radial distance ρ from the axis.
    let mut t = vec![0f64; n];
    let mut th = vec![0f64; n];
    let mut rho = vec![0f64; n];
    for (k, p) in positions.iter().enumerate() {
        let d = [p[0] as f64 - c[0], p[1] as f64 - c[1], p[2] as f64 - c[2]];
        t[k] = d[0] * axis[0] + d[1] * axis[1] + d[2] * axis[2];
        let x = d[0] * e1[0] + d[1] * e1[1] + d[2] * e1[2];
        let y = d[0] * e2[0] + d[1] * e2[1] + d[2] * e2[2];
        th[k] = y.atan2(x);
        rho[k] = (x * x + y * y).sqrt();
    }
    let tmin = t.iter().cloned().fold(f64::INFINITY, f64::min);
    let tmax = t.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let rng = tmax - tmin;
    if rng < 1e-5 {
        return None;
    }

    // Axisymmetry test: on a genuine surface of revolution the radius ρ is a
    // (single-valued) function of axial position, so within a thin axial band the
    // radial spread is small relative to the mean radius. Bin by t and measure the
    // mean within-band coefficient of variation of ρ; a freeform cloud (e.g. a
    // solid box / random blob) has large radial spread at every band and is
    // rejected so it falls back to the strip expansion.
    {
        let nb = 12usize;
        let mut sum = vec![0f64; nb];
        let mut sumsq = vec![0f64; nb];
        let mut cnt = vec![0usize; nb];
        for k in 0..n {
            let b = (((t[k] - tmin) / rng) * nb as f64).floor() as usize;
            let b = b.min(nb - 1);
            sum[b] += rho[k];
            sumsq[b] += rho[k] * rho[k];
            cnt[b] += 1;
        }
        let (mut cv_acc, mut nbands) = (0f64, 0usize);
        for b in 0..nb {
            if cnt[b] < 3 {
                continue;
            }
            let m = sum[b] / cnt[b] as f64;
            if m < 1e-6 {
                continue;
            }
            let var = (sumsq[b] / cnt[b] as f64 - m * m).max(0.0);
            cv_acc += var.sqrt() / m;
            nbands += 1;
        }
        if nbands < 3 {
            return None;
        }
        if cv_acc / nbands as f64 > 0.18 {
            return None; // not a clean surface of revolution
        }
    }

    // Detect empty axial bands (hollow nozzle gaps): sorted-t gaps that are both
    // a large fraction of the axial extent and many times the typical spacing.
    let mut ts = t.clone();
    ts.sort_by(|a, b| fcmp(*a, *b));
    let mut nzgaps: Vec<f64> = ts
        .windows(2)
        .map(|w| w[1] - w[0])
        .filter(|g| *g > 1e-6)
        .collect();
    nzgaps.sort_by(|a, b| fcmp(*a, *b));
    let med_gap = if nzgaps.is_empty() {
        1e-3
    } else {
        nzgaps[nzgaps.len() / 2]
    };
    let mut voids: Vec<(f64, f64)> = Vec::new();
    for w in ts.windows(2) {
        let g = w[1] - w[0];
        if g > 0.12 * rng && g > 6.0 * med_gap {
            voids.push((w[0], w[1]));
        }
    }

    // Parameter-plane triangulation. Scale θ so a full turn maps to the axial
    // extent — keeps triangles near-isotropic so the Delaunay reflects true
    // surface adjacency rather than the plane's arbitrary aspect ratio.
    let two_pi = std::f64::consts::TAU;
    let sx = rng / two_pi;
    let pts2: Vec<(f64, f64)> = (0..n).map(|k| (th[k] * sx, t[k])).collect();
    let tris = delaunay_periodic(&pts2, two_pi * sx);
    if tris.is_empty() {
        return None;
    }

    // Keep triangles, dropping any that bridge an empty axial band.
    let p3 = |k: usize| {
        [
            positions[k][0] as f64,
            positions[k][1] as f64,
            positions[k][2] as f64,
        ]
    };
    let edge = |i: usize, j: usize| {
        let a = p3(i);
        let b = p3(j);
        ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)).sqrt()
    };
    let crosses_void = |a: usize, b: usize, cc: usize| {
        let lo = t[a].min(t[b]).min(t[cc]);
        let hi = t[a].max(t[b]).max(t[cc]);
        voids
            .iter()
            .any(|&(va, vb)| lo <= va + 1e-6 && hi >= vb - 1e-6)
    };
    let mut kept: Vec<[usize; 3]> = Vec::new();
    let mut tri_maxedge: Vec<f64> = Vec::new();
    for tr in &tris {
        let [a, b, cc] = *tr;
        if crosses_void(a, b, cc) {
            continue;
        }
        let me = edge(a, b).max(edge(b, cc)).max(edge(a, cc));
        kept.push(*tr);
        tri_maxedge.push(me);
    }
    if kept.len() < 4 {
        return None;
    }

    // Quality gate: a clean solid of revolution has near-uniform triangle size.
    // A genuinely irregular / freeform cloud produces many oversized bridging
    // triangles — reject it and let the strip fallback handle it.
    let mut sorted = tri_maxedge.clone();
    sorted.sort_by(|a, b| fcmp(*a, *b));
    let med = sorted[sorted.len() / 2].max(1e-9);
    let long = tri_maxedge.iter().filter(|e| **e > 4.0 * med).count();
    let frac_long = long as f64 / tri_maxedge.len() as f64;
    let max_ratio = sorted[sorted.len() - 1] / med;
    if frac_long > 0.03 || max_ratio > 6.0 {
        return None;
    }
    // Faithfulness: nearly every original vertex must participate.
    let mut used = vec![false; n];
    for tr in &kept {
        for &k in tr.iter() {
            used[k] = true;
        }
    }
    if used.iter().filter(|u| **u).count() < n * 9 / 10 {
        return None;
    }

    // Emit with the original vertices; orient each triangle outward (normal away
    // from the centroid) so winding is consistent.
    let cf = [c[0] as f32, c[1] as f32, c[2] as f32];
    let mut idx: Vec<u32> = Vec::with_capacity(kept.len() * 3);
    for tr in &kept {
        let [a, b, cc] = *tr;
        let pa = positions[a];
        let pb = positions[b];
        let pc = positions[cc];
        let ab = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
        let ac = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
        let nrm = [
            ab[1] * ac[2] - ab[2] * ac[1],
            ab[2] * ac[0] - ab[0] * ac[2],
            ab[0] * ac[1] - ab[1] * ac[0],
        ];
        let centroid = [
            (pa[0] + pb[0] + pc[0]) / 3.0,
            (pa[1] + pb[1] + pc[1]) / 3.0,
            (pa[2] + pb[2] + pc[2]) / 3.0,
        ];
        let out = [
            centroid[0] - cf[0],
            centroid[1] - cf[1],
            centroid[2] - cf[2],
        ];
        let dotp = nrm[0] * out[0] + nrm[1] * out[1] + nrm[2] * out[2];
        if dotp >= 0.0 {
            idx.extend_from_slice(&[a as u32, b as u32, cc as u32]);
        } else {
            idx.extend_from_slice(&[a as u32, cc as u32, b as u32]);
        }
    }
    // Delaunay on a periodic cylinder can occasionally produce non-manifold
    // topology (e.g. near-duplicate θ values). Gate it out here so the caller
    // doesn't need a secondary check.
    if is_non_manifold(&idx) {
        return None;
    }
    Some((positions.to_vec(), idx))
}

/// True if any undirected edge of the triangle set is shared by **more than two**
/// triangles — the signature of a self-overlapping / folded mesh (e.g. a flat box
/// that the revolution reconstruction wrapped onto itself). A clean manifold (a
/// proper closed or bordered surface) has every edge in ≤2 triangles. Used by the
/// render cascade to reject a faithful reconstruction that folded.
fn is_non_manifold(idx: &[u32]) -> bool {
    use std::collections::HashMap;
    let mut count: HashMap<(u32, u32), u32> = HashMap::new();
    for tr in idx.chunks_exact(3) {
        for &(a, b) in &[(tr[0], tr[1]), (tr[1], tr[2]), (tr[2], tr[0])] {
            let key = (a.min(b), a.max(b));
            *count.entry(key).or_insert(0) += 1;
        }
    }
    count.values().any(|&c| c > 2)
}

// ─── 3-D incremental convex hull ────────────────────────────────────────────
// Build the convex hull of a point cloud and emit OUTWARD-oriented triangles by
// ORIGINAL vertex index. Used by the render cascade for convex solids (boxes,
// plates, beams, cylinders, cones) so we render the EXACT decoded vertices with a
// correct closed surface — no fabricated primitive. Only accepted when the hull
// is complete and uses ~all the input vertices (i.e. the shape really is convex);
// non-convex shapes (C-channels, uprights) return None and fall to the strip.

/// Squared distance between two 3-D points (f64).
fn d2_64(a: [f64; 3], b: [f64; 3]) -> f64 {
    let d = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    d[0] * d[0] + d[1] * d[1] + d[2] * d[2]
}

/// Robust incremental 3-D convex hull. Returns `(faces, used_vertex_count)` where
/// each face is a triple of ORIGINAL indices, oriented outward (normal away from
/// the interior). `None` if a hull can't be formed (degenerate / collinear /
/// fully coplanar cloud, < 4 distinct points).
fn convex_hull_faces(pts64: &[[f64; 3]]) -> Option<(Vec<[usize; 3]>, usize)> {
    let n = pts64.len();
    if n < 4 {
        return None;
    }
    // Overall scale for relative tolerances.
    let (mut mn, mut mx) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
    for p in pts64 {
        for i in 0..3 {
            mn[i] = mn[i].min(p[i]);
            mx[i] = mx[i].max(p[i]);
        }
    }
    let diag = ((mx[0] - mn[0]).powi(2) + (mx[1] - mn[1]).powi(2) + (mx[2] - mn[2]).powi(2)).sqrt();
    if diag < 1e-9 {
        return None;
    }
    // Tolerances scaled to the cloud; thin plates (~0.025 thick) are fine because
    // these are RELATIVE to the diagonal, not absolute.
    let eps_vol = 1e-7 * diag.powi(3);
    let eps_dup = (1e-6 * diag).powi(2);

    let sub = |a: [f64; 3], b: [f64; 3]| [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    let cross = |a: [f64; 3], b: [f64; 3]| {
        [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0],
        ]
    };
    let dot = |a: [f64; 3], b: [f64; 3]| a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

    // ── Seed a non-degenerate tetrahedron ──
    // i0: any point. i1: farthest from i0. i2: farthest from the line i0-i1.
    // i3: farthest from the plane i0-i1-i2.
    let i0 = 0usize;
    let mut i1 = i0;
    let mut best = -1.0;
    for (k, p) in pts64.iter().enumerate() {
        let d = d2_64(*p, pts64[i0]);
        if d > best {
            best = d;
            i1 = k;
        }
    }
    if d2_64(pts64[i0], pts64[i1]) < eps_dup {
        return None; // all points coincident
    }
    let line = sub(pts64[i1], pts64[i0]);
    let mut i2 = i0;
    best = -1.0;
    for (k, p) in pts64.iter().enumerate() {
        let v = sub(*p, pts64[i0]);
        let c = cross(line, v);
        let area2 = dot(c, c);
        if area2 > best {
            best = area2;
            i2 = k;
        }
    }
    // Collinear cloud → no 3-D hull.
    {
        let v = sub(pts64[i2], pts64[i0]);
        let c = cross(line, v);
        if dot(c, c) < (eps_dup * d2_64(pts64[i0], pts64[i1])).max(1e-18) {
            return None;
        }
    }
    let normal = cross(sub(pts64[i1], pts64[i0]), sub(pts64[i2], pts64[i0]));
    let mut i3 = i0;
    best = -1.0;
    for (k, p) in pts64.iter().enumerate() {
        let v = sub(*p, pts64[i0]);
        let h = dot(normal, v).abs();
        if h > best {
            best = h;
            i3 = k;
        }
    }
    // Fully coplanar cloud (e.g. a flat polygon with zero thickness) → no 3-D hull.
    {
        let v = sub(pts64[i3], pts64[i0]);
        if dot(normal, v).abs() < 1e-9 * (dot(normal, normal).sqrt() * diag).max(1e-12) {
            return None;
        }
    }
    if i1 == i0 || i2 == i0 || i2 == i1 || i3 == i0 || i3 == i1 || i3 == i2 {
        return None;
    }

    // Signed volume of tetra (a,b,c,d): positive if d is on the + side of abc.
    let orient = |a: [f64; 3], b: [f64; 3], c: [f64; 3], p: [f64; 3]| -> f64 {
        dot(cross(sub(b, a), sub(c, a)), sub(p, a))
    };
    // Build the initial tetra with all faces oriented so the 4th point is BEHIND.
    let mut faces: Vec<[usize; 3]> = Vec::new();
    let mk = |a: usize, b: usize, c: usize, inside: usize, faces: &mut Vec<[usize; 3]>| {
        if orient(pts64[a], pts64[b], pts64[c], pts64[inside]) > 0.0 {
            faces.push([a, c, b]); // flip so `inside` is behind
        } else {
            faces.push([a, b, c]);
        }
    };
    mk(i0, i1, i2, i3, &mut faces);
    mk(i0, i1, i3, i2, &mut faces);
    mk(i0, i2, i3, i1, &mut faces);
    mk(i1, i2, i3, i0, &mut faces);

    // A fixed interior witness (the seed tetra's centroid) — always strictly
    // inside the growing convex hull, so we can orient every new face outward by
    // putting this point BEHIND it.
    let interior = [
        (pts64[i0][0] + pts64[i1][0] + pts64[i2][0] + pts64[i3][0]) / 4.0,
        (pts64[i0][1] + pts64[i1][1] + pts64[i2][1] + pts64[i3][1]) / 4.0,
        (pts64[i0][2] + pts64[i1][2] + pts64[i2][2] + pts64[i3][2]) / 4.0,
    ];

    // A point is "outside" a face if it lies strictly on the +normal side
    // (faces are kept oriented OUTWARD: the interior witness is behind them).
    let face_sees =
        |f: &[usize; 3], p: [f64; 3]| -> f64 { orient(pts64[f[0]], pts64[f[1]], pts64[f[2]], p) };

    // Incrementally add each remaining point.
    for (k, &p) in pts64.iter().enumerate() {
        if k == i0 || k == i1 || k == i2 || k == i3 {
            continue;
        }
        // Faces this point can see.
        let mut visible: Vec<usize> = Vec::new();
        for (fi, f) in faces.iter().enumerate() {
            if face_sees(f, p) > eps_vol {
                visible.push(fi);
            }
        }
        if visible.is_empty() {
            continue; // interior (or on the hull) point
        }
        // Horizon = edges shared by exactly one visible face.
        let mut edge_count: std::collections::BTreeMap<(usize, usize), (usize, (usize, usize))> =
            std::collections::BTreeMap::new();
        for &fi in &visible {
            let f = faces[fi];
            for &(a, b) in &[(f[0], f[1]), (f[1], f[2]), (f[2], f[0])] {
                let key = (a.min(b), a.max(b));
                let e = edge_count.entry(key).or_insert((0, (a, b)));
                e.0 += 1;
                e.1 = (a, b); // keep a directed instance for orientation
            }
        }
        let horizon: Vec<(usize, usize)> = edge_count
            .values()
            .filter(|(c, _)| *c == 1)
            .map(|(_, dir)| *dir)
            .collect();
        // Remove visible faces (descending index).
        let mut vis = visible.clone();
        vis.sort_unstable();
        for &fi in vis.iter().rev() {
            faces.swap_remove(fi);
        }
        // Stitch the horizon to the new point. Each new face (a,b,k) is oriented
        // OUTWARD by putting the fixed interior witness behind it, so the running
        // visibility test stays valid for the points added after this one.
        for (a, b) in horizon {
            let mut nf = [a, b, k];
            if orient(pts64[nf[0]], pts64[nf[1]], pts64[nf[2]], interior) > 0.0 {
                nf.swap(1, 2);
            }
            faces.push(nf);
        }
    }
    if faces.len() < 4 {
        return None;
    }
    let mut used = vec![false; n];
    for f in &faces {
        for &v in f.iter() {
            used[v] = true;
        }
    }
    let used_count = used.iter().filter(|u| **u).count();
    Some((faces, used_count))
}

/// Render a record's REAL vertices as their 3-D convex hull — exact for convex
/// solids (boxes, plates, beams, cylinders, cones). Returns `(positions.clone(),
/// hull_indices)` ONLY when the hull is a complete closed surface using ≥ ~95% of
/// the input vertices (the shape is genuinely convex). Returns `None` for
/// non-convex shapes (a C-channel's hull would skip the notch verts) so they fall
/// through to the vertex-order strip. Real vertices throughout — no fabrication.
fn convex_hull_mesh(positions: &[[f32; 3]]) -> Option<(Vec<[f32; 3]>, Vec<u32>)> {
    let n = positions.len();
    if n < 4 {
        return None;
    }
    let pts64: Vec<[f64; 3]> = positions
        .iter()
        .map(|p| [p[0] as f64, p[1] as f64, p[2] as f64])
        .collect();
    let (faces, used_count) = convex_hull_faces(&pts64)?;
    // Count DISTINCT input positions: duplicate/near-duplicate verts (e.g. a cone
    // apex stored as 8 coincident points, or a strip with repeated corners) must
    // not be charged against the ≥95% coverage test — they can never be hull
    // corners, yet they ARE faithfully present. Coverage is measured over the set
    // of distinct corner locations.
    let mut distinct: Vec<[f64; 3]> = Vec::new();
    let dup_tol = {
        let (mut mn, mut mx) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
        for p in &pts64 {
            for i in 0..3 {
                mn[i] = mn[i].min(p[i]);
                mx[i] = mx[i].max(p[i]);
            }
        }
        let diag =
            ((mx[0] - mn[0]).powi(2) + (mx[1] - mn[1]).powi(2) + (mx[2] - mn[2]).powi(2)).sqrt();
        (1e-5 * diag).powi(2)
    };
    for p in &pts64 {
        if !distinct.iter().any(|q| d2_64(*p, *q) < dup_tol) {
            distinct.push(*p);
        }
    }
    let nd = distinct.len().max(1);
    // Hull must use nearly all DISTINCT corner positions to be considered a true
    // convex solid. We measure which distinct locations a hull vertex lands on.
    let mut hull_used_distinct = vec![false; distinct.len()];
    let mut on_hull = vec![false; n];
    for f in &faces {
        for &v in f.iter() {
            on_hull[v] = true;
        }
    }
    for (vi, hit) in on_hull.iter().enumerate() {
        if *hit {
            if let Some(di) = distinct.iter().position(|q| d2_64(pts64[vi], *q) < dup_tol) {
                hull_used_distinct[di] = true;
            }
        }
    }
    let _ = used_count;
    let covered = hull_used_distinct.iter().filter(|u| **u).count();
    if (covered as f64) < 0.95 * nd as f64 {
        return None; // non-convex: hull skips interior/notch vertices → strip
    }
    let idx: Vec<u32> = faces
        .iter()
        .flat_map(|f| [f[0] as u32, f[1] as u32, f[2] as u32])
        .collect();
    if idx.len() < 12 {
        return None;
    }
    Some((positions.to_vec(), idx))
}

/// 2-D convex hull (monotone chain), CCW, of the given points.
fn convex_hull_2d(mut pts: Vec<(f32, f32)>) -> Vec<(f32, f32)> {
    pts.sort_by(|a, b| fcmp(a.0, b.0).then_with(|| fcmp(a.1, b.1)));
    pts.dedup();
    if pts.len() < 3 {
        return pts;
    }
    let cross = |o: (f32, f32), a: (f32, f32), b: (f32, f32)| {
        (a.0 - o.0) * (b.1 - o.1) - (a.1 - o.1) * (b.0 - o.0)
    };
    let mut hull = Vec::with_capacity(pts.len() + 1);
    for &p in &pts {
        while hull.len() >= 2 && cross(hull[hull.len() - 2], hull[hull.len() - 1], p) <= 0.0 {
            hull.pop();
        }
        hull.push(p);
    }
    let lower = hull.len() + 1;
    for &p in pts.iter().rev().skip(1) {
        while hull.len() >= lower && cross(hull[hull.len() - 2], hull[hull.len() - 1], p) <= 0.0 {
            hull.pop();
        }
        hull.push(p);
    }
    hull.pop();
    hull
}

/// Concatenate the inflated geometry segments into the logical buffer.
///
/// `segments` are the inflated geometry chunks in file order (each ≤ 64 KB).
pub fn logical_buffer<T: AsRef<[u8]>>(segments: &[T]) -> Vec<u8> {
    segments
        .iter()
        .flat_map(|s| s.as_ref().iter().copied())
        .collect()
}

const HEADER_WORDS: usize = 6;

/// On-disk geometry-record kind, in the FULL ordered record array (both decoded
/// magic meshes AND the undecoded AUX slots).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OnDiskKind {
    /// A decoded mesh record (`[100][94|95][101][60]…`) — its byte offset, used to
    /// map back to the [`parse`] output index.
    Magic(usize),
    /// An auxiliary slot (sub-104 / sub-105) — its byte offset. Decoded as a
    /// parametric oriented primitive by [`aux_primitives`] (what_we_know §38).
    Aux(usize),
}

/// A parametric oriented primitive stored in an AUX geometry record (variant
/// 104/105), in the fragment's LOCAL frame (relative to its translation). The
/// `u`,`v` axes are orthonormal; `u × v` is the third basis (the cylinder axis /
/// disc normal). Decoded byte-for-byte from the record — NOT a fitted guess
/// (what_we_know §38; cross-validated: radius matches the fragment bbox 120/122).
#[derive(Debug, Clone, Copy)]
pub enum AuxPrim {
    /// variant-104 (56 B): a FLAT disc/cap. Centre = local origin; the disc lies in
    /// the plane spanned by `u`,`v`; normal = `u × v`; radius `r`. (Weld discs.)
    Disc { u: [f32; 3], v: [f32; 3], r: f32 },
    /// variant-105 (64 B): an oriented CYLINDER. Cap A = local origin `[0,0,0]`;
    /// cap B = `origin` (verified ∥ `u × v`, 21/21); radius `r`. (Weld rods / pipes.)
    Cyl {
        origin: [f32; 3],
        u: [f32; 3],
        v: [f32; 3],
        r: f32,
    },
}

/// Walk the FULL on-disk geometry-record array — BOTH the decoded magic mesh
/// records ([`parse`] sees only these) AND the undecoded AUX slots (sub-104 /
/// sub-105) — in on-disk order. A `fragment`'s `marker+64` value is a **1-based
/// index into THIS full array**, so to read it out we must know where the magic
/// records sit among the aux placeholders.
///
/// A record begins at a 4-byte-aligned offset `o` where `u32@o == 100`:
/// * **MAGIC** — `u32@o+8 == 101 && u32@o+12 == 60`: a decoded mesh. Advance past
///   it the way [`record_starts`] / [`parse`] do (positions at `o+24`, h5
///   word-count at `o+20`): `o + 24 + (h5/3)*12`.
/// * **AUX** — `u32@o+12 == 0 && u32@o+8 ∈ {0, 3, 196611}`: a sub-104 (h2=0/3,
///   size 56) or sub-105 (h2=196611, size 64) undecoded slot → a placeholder.
///
/// Returns one entry per on-disk record in order: `OnDiskKind::Magic(offset)` or
/// `OnDiskKind::Aux`. (Verified: the count equals the size-index record count
/// on all 44 Huldra NWDs — `rec_survey` example.)
fn on_disk_records(buf: &[u8]) -> Vec<OnDiskKind> {
    let n = buf.len();
    let rd = |o: usize| -> Option<u32> {
        (o + 4 <= n).then(|| u32::from_le_bytes(buf[o..o + 4].try_into().unwrap()))
    };
    let mut out = Vec::new();
    let mut o = 0usize;
    while o + 4 <= n {
        if rd(o) == Some(100) {
            let h2 = rd(o + 8);
            let h3 = rd(o + 12);
            if h2 == Some(101) && h3 == Some(60) {
                // MAGIC: advance past the position array (h5 = float-word count).
                if let Some(h5) = rd(o + 20) {
                    let h5 = h5 as usize;
                    if h5 != 0 && h5 % 3 == 0 && h5 <= 200_000 {
                        let end = o + HEADER_WORDS * 4 + (h5 / 3) * 12;
                        if end <= n {
                            out.push(OnDiskKind::Magic(o));
                            o = end;
                            continue;
                        }
                    }
                }
            } else if h3 == Some(0)
                && matches!(h2, Some(0) | Some(3) | Some(196611))
                && matches!(rd(o + 4), Some(104) | Some(105))
            {
                // AUX: variant 104 = disc (56 bytes), 105 = cylinder (64 bytes).
                // The VARIANT word decides — word2 is a flag word (0/3/0x30003)
                // and 105 records with word2 = 0 exist (6 in the Huldra corpus,
                // all validated against the size-index record sizes).
                let size = if rd(o + 4) == Some(105) { 64 } else { 56 };
                out.push(OnDiskKind::Aux(o));
                o += size;
                continue;
            }
        }
        o += 4;
    }
    out
}

/// Map every on-disk record (magic + aux, in order) to its index in the [`parse`]
/// output, or `None` for an AUX placeholder / a magic record [`parse`] dropped.
///
/// A fragment's `geom_record_idx` (`marker+64`, 1-based) indexes THIS array. The
/// j-th magic record on disk is mapped to the [`parse`] record at the SAME byte
/// offset (robust to [`parse`] skipping an invalid record), so a 1-based read-out
/// resolves to the exact decoded mesh — or `None` (aux / unparsed) → fall back to
/// the bbox match. Length == total on-disk records.
pub fn record_index_map(buf: &[u8]) -> Vec<Option<usize>> {
    // Magic byte-offset -> parse-output index (parse stores `offset: o`).
    let parse_idx: std::collections::HashMap<usize, usize> = parse(buf)
        .map(|recs| {
            recs.iter()
                .enumerate()
                .map(|(i, r)| (r.offset, i))
                .collect()
        })
        .unwrap_or_default();
    on_disk_records(buf)
        .into_iter()
        .map(|k| match k {
            OnDiskKind::Magic(off) => parse_idx.get(&off).copied(),
            OnDiskKind::Aux(_) => None,
        })
        .collect()
}

/// Decode the AUX (variant 104/105) record at byte offset `o` into its parametric
/// oriented primitive (what_we_know §38). The 24-B header `[100, type, h2, 0,0,0]`
/// is followed by the float body: 104 = `[u(3), v(3), r, 0]`; 105 = `[origin(3),
/// u(3), v(3), r]`. Returns `None` if the body would run past the buffer.
fn read_aux(buf: &[u8], o: usize) -> Option<AuxPrim> {
    let f = |k: usize| -> Option<f32> {
        let p = o + 24 + 4 * k;
        (p + 4 <= buf.len()).then(|| f32::from_le_bytes(buf[p..p + 4].try_into().unwrap()))
    };
    let v3 = |k: usize| -> Option<[f32; 3]> { Some([f(k)?, f(k + 1)?, f(k + 2)?]) };
    let h1 =
        (o + 8 <= buf.len()).then(|| u32::from_le_bytes(buf[o + 4..o + 8].try_into().unwrap()));
    if h1 == Some(105) {
        Some(AuxPrim::Cyl {
            origin: v3(0)?,
            u: v3(3)?,
            v: v3(6)?,
            r: f(9)?,
        })
    } else {
        Some(AuxPrim::Disc {
            u: v3(0)?,
            v: v3(3)?,
            r: f(6)?,
        })
    }
}

/// Map every on-disk record to its decoded AUX primitive, or `None` for a magic
/// mesh record (use [`record_index_map`] for those). Indexed the same way: a
/// fragment's `geom_record_idx` (`marker+64`, 1-based) indexes this array. Lets the
/// converter render the 122 aux-targeted fragments as their EXACT stored oriented
/// primitives instead of a bbox guess (what_we_know §38). Length == total records.
pub fn aux_primitives(buf: &[u8]) -> Vec<Option<AuxPrim>> {
    on_disk_records(buf)
        .into_iter()
        .map(|k| match k {
            OnDiskKind::Aux(off) => read_aux(buf, off),
            OnDiskKind::Magic(_) => None,
        })
        .collect()
}

/// Segment count Navisworks uses when it tessellates an AUX primitive.
///
/// VALIDATED against the Navisworks FBX export of the Huldra sample
/// (`docs/what_we_know_v1.md`): every AUX disc/cylinder comes out as a 32-segment
/// ring, first ring vertex at angle 0 along `u`, angle increasing toward `v`.
pub const AUX_SEGMENTS: usize = 32;

/// LOCAL points of an AUX primitive, tessellated exactly as Navisworks does.
///
/// - `Disc`: `[centre, ring_0 .. ring_31]` (33 points), ring_k = r·(cos θ u +
///   sin θ v), θ = k·2π/32. Pair with [`aux_disc_indices`] (fan, normal = u×v —
///   the stored outward direction).
/// - `Cyl`: two rings of 32 (64 points), `[lo_0..lo_31, hi_0..hi_31]`: an OPEN
///   tube between the local origin and `origin` (the caps are separate disc
///   records). The rings are ordered so `hi − lo` points along +u×v, which
///   lets one fixed index topology ([`aux_tube_indices`]) face outward.
pub fn aux_points(p: &AuxPrim) -> Vec<[f32; 3]> {
    let ring = |u: [f32; 3], v: [f32; 3], r: f32, c: [f32; 3]| -> Vec<[f32; 3]> {
        (0..AUX_SEGMENTS)
            .map(|k| {
                let a = std::f64::consts::TAU * k as f64 / AUX_SEGMENTS as f64;
                let (cs, sn) = ((a.cos() * r as f64) as f32, (a.sin() * r as f64) as f32);
                [
                    c[0] + cs * u[0] + sn * v[0],
                    c[1] + cs * u[1] + sn * v[1],
                    c[2] + cs * u[2] + sn * v[2],
                ]
            })
            .collect()
    };
    match *p {
        AuxPrim::Disc { u, v, r } => {
            let mut out = vec![[0.0f32; 3]];
            out.extend(ring(u, v, r, [0.0; 3]));
            out
        }
        AuxPrim::Cyl { origin, u, v, r } => {
            let n = [
                u[1] * v[2] - u[2] * v[1],
                u[2] * v[0] - u[0] * v[2],
                u[0] * v[1] - u[1] * v[0],
            ];
            let along = n[0] * origin[0] + n[1] * origin[1] + n[2] * origin[2];
            let (lo, hi) = if along >= 0.0 {
                ([0.0; 3], origin)
            } else {
                (origin, [0.0; 3])
            };
            let mut out = ring(u, v, r, lo);
            out.extend(ring(u, v, r, hi));
            out
        }
    }
}

impl AuxPrim {
    /// Zero radius or a zero frame axis: the record holds no surface (seen in
    /// the Huldra corpus as `u = v = 0, r = 0` discs). Navisworks exports
    /// nothing for these, so neither do we.
    pub fn is_degenerate(&self) -> bool {
        let (u, v, r) = match *self {
            AuxPrim::Disc { u, v, r } | AuxPrim::Cyl { u, v, r, .. } => (u, v, r),
        };
        let l2 = |a: [f32; 3]| a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
        !(r > 0.0 && l2(u) > 1e-12 && l2(v) > 1e-12)
    }
}

/// Fan topology for an [`aux_points`] disc (32 triangles, normal = u×v).
pub fn aux_disc_indices() -> Vec<u32> {
    let n = AUX_SEGMENTS as u32;
    (0..n).flat_map(|k| [1 + k, 1 + (k + 1) % n, 0]).collect()
}

/// Open-tube topology for an [`aux_points`] cylinder (64 triangles, outward).
pub fn aux_tube_indices() -> Vec<u32> {
    let n = AUX_SEGMENTS as u32;
    (0..n)
        .flat_map(|k| {
            let j = (k + 1) % n;
            [k, j, n + k, j, n + j, n + k]
        })
        .collect()
}

/// Find record-start offsets by the constant `100,*,101,60` header prefix.
fn record_starts(buf: &[u8]) -> Vec<usize> {
    let mut starts = Vec::new();
    let mut cur = Cursor::new(buf);
    let n = buf.len();
    let mut o = 0;
    while o + HEADER_WORDS * 4 <= n {
        cur.seek(o);
        let h0 = cur.u32().unwrap();
        let _h1 = cur.u32().unwrap();
        let h2 = cur.u32().unwrap();
        let h3 = cur.u32().unwrap();
        if h0 == 100 && h2 == 101 && h3 == 60 {
            starts.push(o);
        }
        o += 4;
    }
    starts
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rec(positions: Vec<[f32; 3]>) -> GeomRecord {
        GeomRecord {
            offset: 0,
            positions,
            variant: 94,
            decoded_tris: None,
            line_segments: None,
        }
    }

    /// A canonical flat plate's corners: extent 6.31 x 0.3 x 0.026.
    fn flat_box_corners() -> Vec<[f32; 3]> {
        vec![
            [-3.155, -0.15, -0.013],
            [3.155, -0.15, -0.013],
            [-3.155, -0.15, 0.013],
            [3.155, -0.15, 0.013],
            [3.155, 0.15, -0.013],
            [3.155, 0.15, 0.013],
            [-3.155, 0.15, -0.013],
            [-3.155, 0.15, 0.013],
        ]
    }

    /// A line record: 4 vertices, one closed polyline 0-1-2-3-0 stored as the
    /// index stream `03 f0 00 00` (4 new ids + back-ref to the first) and a
    /// one-entry count table (5, 3 bits).
    /// One quad record, as `[100][94][101][60][h4][h5]` + 4 vertices + tail.
    /// `uv` inserts the texture-coordinate block in front of the normals
    /// (the layout of DWG/3DS-sourced records with mapped materials).
    fn quad_record(uv: bool) -> Vec<u8> {
        let mut b = Vec::new();
        for w in [100u32, 94, 101, 60, 4, 12] {
            b.extend_from_slice(&w.to_le_bytes());
        }
        for p in [
            [0.0f32, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [1.0, 1.0, 0.0],
        ] {
            for c in p {
                b.extend_from_slice(&c.to_le_bytes());
            }
        }
        b.extend_from_slice(&[0u8; 4]); // index stream: identity
        let normals_id = if uv {
            // [102][61][-4], UV bounds (4 f32 = 0), bit widths 0/0, count 1,
            // tokens: 1 fresh entry, then repeat it 3 more times.
            for w in [102i32, 61, -4, 0, 0, 0, 0, 0, 1] {
                b.extend_from_slice(&w.to_le_bytes());
            }
            b.extend_from_slice(&[0x00, 0x82, 0x00, 0x00]);
            103i32
        } else {
            102
        };
        // normals: one table entry per corner (+Z), no token stream
        for w in [normals_id, 100, -4, 4] {
            b.extend_from_slice(&w.to_le_bytes());
        }
        b.extend_from_slice(&[
            0x00, 0x7f, 0x00, 0x00, 0x00, 0x00, 0x7f, 0x00, 0x7f, 0x00, 0x00, 0x7f,
        ]);
        // one polygon of 4 corners: [n=1][w=3][n=1] + bit table (100b)
        for w in [1u32, 3, 1, 0b100 << 29] {
            b.extend_from_slice(&w.to_le_bytes());
        }
        b
    }

    /// The texture-coordinate block (`[102][61][-h4]`) shifts the normals
    /// block to id 103; the triangles must come out the same either way.
    #[test]
    fn mesh_record_with_uv_block_decodes_like_one_without() {
        let plain = quad_record(false);
        let with_uv = quad_record(true);
        let a = parse_sized(&plain, &[plain.len() as u32]).unwrap();
        let b = parse_sized(&with_uv, &[with_uv.len() as u32]).unwrap();
        let ta = a[0].decoded_tris.clone().expect("plain record decodes");
        let tb = b[0]
            .decoded_tris
            .clone()
            .expect("record with a UV block decodes");
        assert_eq!(ta.len(), 6, "a quad is two triangles");
        assert_eq!(ta, tb);
    }

    /// The streaming decoder gives the same records as the whole-buffer one,
    /// however the stream is cut into chunks, and indexes every on-disk
    /// record (mesh / AUX / other) by its position in the size index.
    #[test]
    fn parse_stream_matches_whole_buffer_parse() {
        let rec = quad_record(true);
        // AUX disc (variant 104, 56 bytes): header + u, v, r, 0
        let mut aux = Vec::new();
        for w in [100u32, 104, 0, 0, 0, 0] {
            aux.extend_from_slice(&w.to_le_bytes());
        }
        for f in [1.0f32, 0.0, 0.0, 0.0, 1.0, 0.0, 0.25, 0.0] {
            aux.extend_from_slice(&f.to_le_bytes());
        }
        let other = vec![7u8; 20]; // a record of an unknown type
        let mut buf = Vec::new();
        let mut sizes = Vec::new();
        for r in [&rec, &aux, &other, &rec, &aux] {
            buf.extend_from_slice(r);
            sizes.push(r.len() as u32);
        }
        let whole = parse_sized(&buf, &sizes).unwrap();
        for chunk in [7usize, 64, 100, buf.len()] {
            let pieces: Vec<&[u8]> = buf.chunks(chunk).collect();
            let lens: Vec<usize> = pieces.iter().map(|p| p.len()).collect();
            let (recs, index) = parse_stream(&lens, |k| pieces[k].to_vec(), &sizes).unwrap();
            assert_eq!(recs.len(), 2);
            for (a, b) in recs.iter().zip(&whole) {
                assert_eq!(
                    (a.offset, &a.positions, &a.decoded_tris),
                    (b.offset, &b.positions, &b.decoded_tris)
                );
            }
            assert_eq!(index.len(), 5);
            assert_eq!((index.mesh(0), index.mesh(3)), (Some(0), Some(1)));
            assert!(matches!(index.aux(1), Some(AuxPrim::Disc { r, .. }) if r == 0.25));
            assert!(index.aux(4).is_some() && index.mesh(1).is_none());
            assert!(index.mesh(2).is_none() && index.aux(2).is_none());
        }
    }

    #[test]
    fn polyline_record_decodes_closed_loop() {
        let mut buf = vec![0u8; 48]; // 4 vertices' worth of positions (unused)
        let pos_end = buf.len();
        buf.extend_from_slice(&[0x03, 0xf0, 0x00, 0x00]);
        buf.extend_from_slice(&[0u8; 12]);
        for w in [1u32, 3, 1, 0b101 << 29] {
            buf.extend_from_slice(&w.to_le_bytes());
        }
        let segs = decode_polylines(&buf, pos_end, buf.len(), 4, 5).expect("decodes");
        assert_eq!(segs, vec![[0, 1], [1, 2], [2, 3], [3, 0]]);
        // RVM-loader form: marker + normal stream between indices and counts,
        // identity indices, three 2-vertex lines (a datum tripod).
        let mut b2 = vec![0u8; 72];
        let pe = b2.len();
        for w in [0i32, 102, 100, -6, 0, 0x00d2_d2d2, 0, 3, 3, 3, 0x4900_0000] {
            b2.extend_from_slice(&w.to_le_bytes());
        }
        let s2 = decode_polylines(&b2, pe, b2.len(), 6, 6).expect("decodes");
        assert_eq!(s2, vec![[0, 1], [2, 3], [4, 5]]);
    }

    #[test]
    fn slab_box_is_solid() {
        // CHANGED for the real-vertex cascade: the box no longer goes through the
        // coarse slab FIT (which fabricated a prism); it routes faithful(rejected)
        // -> CONVEX HULL of the real 8 corners. Intent preserved: a rectangular
        // box must still render as a closed 12-triangle solid (2 tris × 6 faces).
        let r = rec(flat_box_corners());
        let (_pos, idx) = r.mesh();
        assert_eq!(
            idx.len(),
            12 * 3,
            "box should be 12 triangles, got {}",
            idx.len() / 3
        );
        // New cascade assertion: the rendered mesh is a clean manifold (no folds).
        assert!(!is_non_manifold(&idx), "box hull must be manifold");
    }

    #[test]
    fn flat_box_hull_is_12_tris_all_8_verts() {
        // REQUIRED spot-check: the thin plate must render exactly
        // 12 triangles via the convex hull, using ALL 8 input vertices — even
        // though it is only ~0.025 thick (near-planar). Real vertices, no fit.
        let verts = flat_box_corners();
        let (pos, idx) = convex_hull_mesh(&verts).expect("thin plate must hull");
        assert_eq!(pos.len(), 8, "hull must keep all 8 original verts");
        assert_eq!(idx.len() / 3, 12, "thin box hull must be 12 triangles");
        // Every one of the 8 corners participates in the hull surface.
        let mut used = [false; 8];
        for &i in &idx {
            used[i as usize] = true;
        }
        assert!(used.iter().all(|u| *u), "all 8 verts must be on the hull");
        assert!(!is_non_manifold(&idx), "hull must be a clean manifold");
    }

    fn ring(z: f32, r: f32, n: usize) -> Vec<[f32; 3]> {
        (0..n)
            .map(|k| {
                let a = std::f32::consts::TAU * k as f32 / n as f32;
                [r * a.cos(), r * a.sin(), z]
            })
            .collect()
    }

    #[test]
    fn cylinder_two_caps_is_a_prism() {
        // Two circular caps (z=0, z=2) of 16 points: a straight cylinder.
        // CHANGED for the cascade: now asserts the rendered mesh is MANIFOLD and
        // uses the REAL vertices (no resample). A cylinder is convex, so it renders
        // either via faithful-manifold or the convex hull — both real-vertex paths.
        let mut v = ring(0.0, 0.1, 16);
        v.extend(ring(2.0, 0.1, 16));
        let orig = v.clone();
        let (pos, idx) = rec(v).mesh();
        assert!(
            idx.len() / 3 >= 16 * 2,
            "cylinder should be solid, got {} tris",
            idx.len() / 3
        );
        let zmax = pos.iter().map(|p| p[2]).fold(f32::MIN, f32::max);
        assert!((zmax - 2.0).abs() < 1e-3, "cylinder length wrong: {zmax}");
        assert!(!is_non_manifold(&idx), "cylinder must render as a manifold");
        for p in &pos {
            assert!(
                orig.iter().any(|q| dist(*p, *q) < 1e-5),
                "cylinder must render REAL decoded vertices (no fabricated fit)"
            );
        }
    }

    #[test]
    fn cone_tapers_not_cylinder() {
        // Wide cap (r=0.2) at z=0, narrow cap (r=0.05) at z=2: a cone/snout.
        // CHANGED for the cascade: also assert the render is MANIFOLD. A frustum is
        // convex, so it renders via faithful-manifold or the convex hull — real
        // verts either way; the taper (different cap radii) must be preserved.
        let mut v = ring(0.0, 0.2, 16);
        v.extend(ring(2.0, 0.05, 16));
        let (pos, idx) = rec(v).mesh();
        assert!(idx.len() / 3 >= 16 * 2, "frustum should be solid");
        assert!(!is_non_manifold(&idx), "frustum must render as a manifold");
        let r_at = |z: f32| {
            pos.iter()
                .filter(|p| (p[2] - z).abs() < 0.01)
                .map(|p| (p[0] * p[0] + p[1] * p[1]).sqrt())
                .fold(0.0f32, f32::max)
        };
        assert!(r_at(0.0) > 0.15, "wide end lost: {}", r_at(0.0));
        assert!(
            r_at(2.0) < 0.1,
            "taper lost (came out as cylinder): {}",
            r_at(2.0)
        );
    }

    #[test]
    fn cone_with_mismatched_cap_counts_still_tapers() {
        // Wide cap finely tessellated (24 pts), narrow cap coarse (8 pts):
        // the resample loft must still taper, not fall back to a cylinder.
        let mut v = ring(0.0, 0.30, 24);
        v.extend(ring(2.0, 0.06, 8));
        let (pos, idx) = rec(v).mesh();
        assert!(!idx.is_empty(), "should reconstruct, not degenerate");
        let r_at = |z: f32| {
            pos.iter()
                .filter(|p| (p[2] - z).abs() < 0.01)
                .map(|p| (p[0] * p[0] + p[1] * p[1]).sqrt())
                .fold(0.0f32, f32::max)
        };
        assert!(r_at(0.0) > 0.2, "wide end lost: {}", r_at(0.0));
        assert!(r_at(2.0) < 0.12, "taper lost: {}", r_at(2.0));
    }

    #[test]
    fn true_cone_with_apex_is_solid() {
        // A base circle tapering to a single apex point (like a support pin:
        // 16-pt base circle + 8 coincident apex points). Must be a solid cone,
        // not the thin strip outline.
        let mut v = ring(0.0, 0.03, 16);
        for _ in 0..8 {
            v.push([0.0, 0.0, 0.16]); // apex
        }
        let (pos, idx) = rec(v).mesh();
        assert!(
            idx.len() / 3 >= 16,
            "cone not solid: {} tris",
            idx.len() / 3
        );
        let r_base = pos
            .iter()
            .filter(|p| p[2] < 0.01)
            .map(|p| (p[0] * p[0] + p[1] * p[1]).sqrt())
            .fold(0.0f32, f32::max);
        assert!(r_base > 0.025, "base radius lost: {r_base}");
        // The apex must exist (a point near z=0.16 on the axis).
        assert!(
            pos.iter().any(|p| (p[2] - 0.16).abs() < 0.01),
            "apex missing"
        );
    }

    #[test]
    fn cylinder_mesh_is_solid_round() {
        let (pos, idx) = cylinder_mesh([0.0, 0.0, 0.0], [0.0, 0.0, 2.0], 0.11);
        assert_eq!(pos.len(), 32, "16-segment ring, two caps");
        assert!(idx.len() / 3 >= 16 * 2, "solid: sides + caps");
        let r = pos
            .iter()
            .map(|p| (p[0] * p[0] + p[1] * p[1]).sqrt())
            .fold(0.0f32, f32::max);
        assert!((r - 0.11).abs() < 0.01, "radius {r}");
        let zspan = pos.iter().map(|p| p[2]).fold(f32::NEG_INFINITY, f32::max)
            - pos.iter().map(|p| p[2]).fold(f32::INFINITY, f32::min);
        assert!((zspan - 2.0).abs() < 0.01, "length {zspan}");
    }

    #[test]
    fn cylinder_mesh_diagonal_keeps_axis_and_radius() {
        // A 45° diagonal pipe (the ELBOW 8 case): must follow its true axis, not
        // collapse to a fat axis-aligned disc.
        let (pos, _) = cylinder_mesh([0.0, 0.0, 0.0], [0.0, -0.37, 0.37], 0.11);
        // radius: max distance from the axis line (origin, dir (0,-1,1)/√2)
        let d = [0.0f32, -0.7071, 0.7071];
        let rmax = pos
            .iter()
            .map(|p| {
                let t = p[0] * d[0] + p[1] * d[1] + p[2] * d[2];
                let perp = [p[0] - t * d[0], p[1] - t * d[1], p[2] - t * d[2]];
                (perp[0] * perp[0] + perp[1] * perp[1] + perp[2] * perp[2]).sqrt()
            })
            .fold(0.0f32, f32::max);
        assert!(
            (rmax - 0.11).abs() < 0.01,
            "thin pipe, not fat disc: r={rmax}"
        );
    }

    #[test]
    fn curved_tube_reconstructs_as_clean_torus() {
        // A 90° torus arc (bend R=0.30, tube r=0.10). The elbow's vertices lie on
        // this surface; mesh() must fit the torus and re-tessellate a clean tube
        // (radius ~0.10 about the R=0.30 centerline), not crumple.
        let (big, small) = (0.30f32, 0.10f32);
        let mut v = Vec::new();
        for u in 0..8 {
            let a = std::f32::consts::FRAC_PI_2 * u as f32 / 7.0;
            for k in 0..12 {
                let b = std::f32::consts::TAU * k as f32 / 12.0;
                v.push([
                    (big + small * b.cos()) * a.cos(),
                    (big + small * b.cos()) * a.sin(),
                    small * b.sin(),
                ]);
            }
        }
        let (pos, idx) = rec(v).mesh();
        assert!(
            idx.len() / 3 >= 80,
            "torus grid should be solid: {}",
            idx.len() / 3
        );
        let rmax = pos
            .iter()
            .map(|p| {
                let rho = (p[0] * p[0] + p[1] * p[1]).sqrt();
                ((rho - 0.30).powi(2) + p[2] * p[2]).sqrt()
            })
            .fold(0.0f32, f32::max);
        assert!((rmax - 0.10).abs() < 0.02, "tube radius off: {rmax}");
    }

    #[test]
    fn revolve_reconstructs_faceted_tube_cleanly() {
        // A multi-ring faceted tube (16-pt circle × 6 rings) is not a clean
        // 2-layer prism nor a torus, so it reaches revolve_mesh. It must rebuild
        // as a clean manifold using the original vertices (no long bridges).
        let mut v = Vec::new();
        for i in 0..6 {
            v.extend(ring(i as f32 * 0.4, 0.1, 16));
        }
        let np = v.len();
        let (pos, idx) = revolve_mesh(&v).expect("faceted tube should reconstruct");
        assert_eq!(pos.len(), np, "must reuse the original vertices");
        assert!(
            idx.len() / 3 >= 80,
            "tube should be solid: {}",
            idx.len() / 3
        );
        // No long bridge triangles: max edge ≤ a few × the ring spacing.
        let med = {
            let mut e: Vec<f32> = idx
                .chunks(3)
                .flat_map(|t| {
                    [
                        dist(pos[t[0] as usize], pos[t[1] as usize]),
                        dist(pos[t[1] as usize], pos[t[2] as usize]),
                        dist(pos[t[0] as usize], pos[t[2] as usize]),
                    ]
                })
                .collect();
            e.sort_by(|a, b| fcmp(*a, *b));
            e[e.len() / 2]
        };
        let maxe = idx
            .chunks(3)
            .map(|t| {
                dist(pos[t[0] as usize], pos[t[1] as usize])
                    .max(dist(pos[t[1] as usize], pos[t[2] as usize]))
                    .max(dist(pos[t[0] as usize], pos[t[2] as usize]))
            })
            .fold(0.0f32, f32::max);
        assert!(maxe < 6.0 * med, "bridge triangle: max {maxe} median {med}");
    }

    #[test]
    #[ignore = "stale: tests the pre-codec geometric reconstruction, now a fallback that never runs on real data (100% of mesh records decode); kept for reference"]
    fn faithful_two_ring_cylinder_keeps_original_verts() {
        // A straight cylinder stored as just two end-cap rings (the common case
        // the (θ,t) Delaunay's void gate drops). The unified faithful path must
        // reconstruct it from the ORIGINAL vertices (no resampling) as a clean
        // solid — this is where the coarse slab fitter used to coarsen it.
        let mut v = ring(0.0, 0.11, 28);
        v.extend(ring(1.5, 0.11, 28));
        let np = v.len();
        let (pos, idx) = faithful_axial_mesh(&v).expect("two-ring cylinder must reconstruct");
        assert_eq!(
            pos.len(),
            np,
            "must reuse the original vertices (no resample)"
        );
        // Every emitted vertex is an original vertex (subset/permutation).
        for p in &pos {
            assert!(
                v.iter().any(|q| dist(*p, *q) < 1e-5),
                "emitted a non-original vertex"
            );
        }
        assert!(idx.len() / 3 >= 28 * 2, "cylinder should be solid");
        // No long bridge triangles (clean manifold).
        let med = {
            let mut e: Vec<f32> = idx
                .chunks(3)
                .flat_map(|t| {
                    [
                        dist(pos[t[0] as usize], pos[t[1] as usize]),
                        dist(pos[t[1] as usize], pos[t[2] as usize]),
                        dist(pos[t[0] as usize], pos[t[2] as usize]),
                    ]
                })
                .collect();
            e.sort_by(|a, b| fcmp(*a, *b));
            e[e.len() / 2]
        };
        let maxe = idx
            .chunks(3)
            .map(|t| {
                dist(pos[t[0] as usize], pos[t[1] as usize])
                    .max(dist(pos[t[1] as usize], pos[t[2] as usize]))
                    .max(dist(pos[t[0] as usize], pos[t[2] as usize]))
            })
            .fold(0.0f32, f32::max);
        // Cap fans reach the diameter (~9× the side spacing); the side loft itself
        // must stay tight — verify the bulk of triangles are small.
        assert!(
            maxe < 12.0 * med,
            "bridge triangle: max {maxe} median {med}"
        );
    }

    #[test]
    #[ignore = "stale: tests the pre-codec geometric reconstruction, now a fallback that never runs on real data (100% of mesh records decode); kept for reference"]
    fn faithful_unequal_rings_loft_without_bridges() {
        // Two co-axial rings with very different vertex counts (56 vs 24) — the
        // alternating-density tube case. The two-pointer angle merge must loft them
        // without long diagonal bridges, keeping the original vertices.
        // Length > diameter so PCA finds the true cylinder axis (the alternating-
        // density tube case from the model: rings 56,24,24,56 over a long axis).
        let mut v = ring(0.0, 0.07, 56);
        v.extend(ring(0.20, 0.07, 24));
        v.extend(ring(0.40, 0.07, 24));
        v.extend(ring(0.60, 0.07, 56));
        let np = v.len();
        let (pos, idx) = faithful_ring_loft(&v).expect("unequal rings must loft");
        assert_eq!(pos.len(), np, "original vertices preserved");
        let med = {
            let mut e: Vec<f32> = idx
                .chunks(3)
                .flat_map(|t| {
                    [
                        dist(pos[t[0] as usize], pos[t[1] as usize]),
                        dist(pos[t[1] as usize], pos[t[2] as usize]),
                        dist(pos[t[0] as usize], pos[t[2] as usize]),
                    ]
                })
                .collect();
            e.sort_by(|a, b| fcmp(*a, *b));
            e[e.len() / 2]
        };
        let maxe = idx
            .chunks(3)
            .map(|t| {
                dist(pos[t[0] as usize], pos[t[1] as usize])
                    .max(dist(pos[t[1] as usize], pos[t[2] as usize]))
                    .max(dist(pos[t[0] as usize], pos[t[2] as usize]))
            })
            .fold(0.0f32, f32::max);
        assert!(
            maxe < 6.0 * med,
            "long bridge in unequal-ring loft: {maxe}/{med}"
        );
    }

    #[test]
    fn faithful_keeps_box_path_for_clean_prism() {
        // CHANGED for the cascade: a clean 8-corner box must NOT be hijacked into a
        // degenerate folded "tube" by faithful_axial_mesh. The cascade rejects any
        // non-manifold faithful result and routes the box to the convex hull, which
        // produces the 12-triangle solid prism from the real corners. Intent kept:
        // a box renders as a correct closed 12-triangle solid, manifold, no fold.
        let r = rec(flat_box_corners());
        let (_pos, idx) = r.mesh();
        assert_eq!(idx.len(), 12 * 3, "box must stay a 12-triangle prism");
        assert!(
            !is_non_manifold(&idx),
            "box must render as a clean manifold"
        );
    }

    #[test]
    fn convex_hull_rejects_nonconvex_c_channel() {
        // A C-channel cross-section extruded along z: the notch makes it NON-convex,
        // so its hull would skip the interior notch corners. convex_hull_mesh must
        // return None (the record then renders via the real-vertex strip, never a
        // fabricated box that would fill the notch solid).
        // Cross-section (xy) of a C: outer rectangle with a rectangular bite removed.
        let xs = [
            (-0.5f32, -0.5f32),
            (0.5, -0.5),
            (0.5, 0.5),
            (-0.5, 0.5),
            (0.3, -0.5), // notch entry corners (interior, off the hull)
            (0.3, 0.3),
            (-0.3, 0.3),
            (-0.3, -0.5),
        ];
        let mut v = Vec::new();
        for z in [0.0f32, 1.0] {
            for &(x, y) in &xs {
                v.push([x, y, z]);
            }
        }
        assert!(
            convex_hull_mesh(&v).is_none(),
            "non-convex C-channel must not be hulled (would fabricate a solid box)"
        );
    }

    #[test]
    fn convex_hull_arbitrary_cube_is_12_manifold_tris() {
        // A unit cube (8 corners) → 12 manifold triangles, all 8 verts used.
        let mut v = Vec::new();
        for x in [0.0f32, 1.0] {
            for y in [0.0f32, 1.0] {
                for z in [0.0f32, 1.0] {
                    v.push([x, y, z]);
                }
            }
        }
        let (pos, idx) = convex_hull_mesh(&v).expect("cube must hull");
        assert_eq!(pos.len(), 8);
        assert_eq!(idx.len() / 3, 12, "cube hull is 12 tris");
        assert!(!is_non_manifold(&idx), "cube hull manifold");
    }

    #[test]
    fn revolve_rejects_random_cloud() {
        // A non-axisymmetric random blob must be rejected (→ strip fallback).
        let mut v = Vec::new();
        let mut s = 12345u64;
        let mut rnd = || {
            s = s.wrapping_mul(6364136223846793005).wrapping_add(1);
            ((s >> 33) as f32 / u32::MAX as f32) - 0.5
        };
        for _ in 0..60 {
            v.push([rnd(), rnd(), rnd()]);
        }
        assert!(
            revolve_mesh(&v).is_none(),
            "random cloud must not reconstruct as a revolution"
        );
    }

    #[test]
    fn round_tube_with_rings_keeps_strip() {
        // Round multi-ring tube (16-pt circle × 6 rings): no clean 2-layer axis
        // (cross-section continuous, >2 rings) → strip fallback.
        let mut v = Vec::new();
        for i in 0..6 {
            v.extend(ring(i as f32 * 0.5, 0.1, 16));
        }
        assert!(
            extrusion_axis(&v).is_none(),
            "round multi-ring tube must stay strip"
        );
    }
}

// ---------------------------------------------------------------------------
// Stored-connectivity decoder (`LcOpNwdGeometryCompress`) — cracked 2026-07-01.
//
// A variant-94 mesh record's bytes after the vertex block are:
//   PRE stream                  LZ-style codec → flat vertex-index array V, len h4
//   u32 [102][100][-h4]         marker
//   u32 count + normal stream   (quantised normals; not needed for connectivity)
//   u32 n, u32 w, u32 n         polygon-count triple
//   bit table                   n unsigned w-bit POLYGON CORNER COUNTS,
//                               packed MSB-first within little-endian u32 words
//   corner stream               only if sum(counts) > h4: u32 total, then the
//                               same LZ codec emitting `total` corner ids
//                               (fresh ids 0..h4-1 + back-refs for corners shared
//                               between adjacent polygons)
// Each polygon loop is stored in GL_TRIANGLE_STRIP order.
//
// LZ codec (byte-exact round-trip verified on every unique stream in the
// sample corpus): write position p = len(out):
//   raw r (0x00..0x3f)  append r+1 NEW sequential ids (next_id, next_id+1, …)
//   0x40+v (v=0..63)    append out[p-v]
//   0x80+k              append out[p-1] k+1 times (RLE; k > 0 first seen in Huldra)
//   e0 XX               v = XX   (0..255), append out[p-v]
//   e1 XX               v = 256+XX,        append out[p-v]
//   f0 00 00            append out[0]
//   trailing 0x00 padding
// ---------------------------------------------------------------------------

/// Most ids a single LZ token byte can emit (raw run `0x3f` / RLE `0xbf`).
const LZ_MAX_RUN: usize = 64;

/// Ceiling on the polygon-corner total of one mesh record. The count table
/// alone allows ~655 M (10 000 polygons × 16-bit counts); a real record has
/// at most 1 M corner slots (`h4`), each shared by a handful of polygons, so
/// 16× that is far above anything valid and keeps a corrupt record from
/// reserving gigabytes (fatal on wasm32).
const MAX_POLY_CORNERS: usize = 16_000_000;

/// Decode the record LZ stream into `out_len` ids. Returns `None` on any
/// malformed reference / truncation.
fn lz_decode(stream: &[u8], out_len: usize) -> Option<Vec<u32>> {
    // `out_len` is file-supplied (up to ~655 M for a corner stream). One token
    // byte emits at most LZ_MAX_RUN ids, so a longer output can never decode —
    // reject it before reserving for it.
    if out_len > stream.len().saturating_mul(LZ_MAX_RUN) {
        return None;
    }
    let mut out: Vec<u32> = Vec::with_capacity(out_len);
    let mut next_id: u32 = 0;
    let mut i = 0usize;
    while i < stream.len() && out.len() < out_len {
        let b = stream[i];
        if b == 0xf0 && stream.get(i + 1) == Some(&0) && stream.get(i + 2) == Some(&0) {
            out.push(*out.first()?);
            i += 3;
        } else if (0xe0..0xf0).contains(&b) {
            // Long back-ref: 0xeN XX -> v = N*256 + XX (e2+ first seen in a
            // DWG-sourced file whose records need refs > 511).
            let v = (b as usize - 0xe0) * 256 + *stream.get(i + 1)? as usize;
            if v == 0 || v > out.len() {
                return None;
            }
            out.push(out[out.len() - v]);
            i += 2;
        } else if (0x40..0x80).contains(&b) {
            let v = (b - 0x40) as usize;
            if v == 0 || v > out.len() {
                return None;
            }
            out.push(out[out.len() - v]);
            i += 1;
        } else if (0x80..0xc0).contains(&b) {
            // 0x80+k: repeat the previous id k+1 times (RLE) — same token as in
            // the normal stream. Earlier corpora only showed k = 0; the Huldra
            // corpus has k up to 0x11 (fan-like loops that revisit one
            // vertex), which was ~1% of all mesh records failing to decode.
            let last = *out.last()?;
            for _ in 0..=(b - 0x80) {
                if out.len() >= out_len {
                    break;
                }
                out.push(last);
            }
            i += 1;
        } else if b < 0x40 {
            for _ in 0..=b {
                if out.len() >= out_len {
                    break;
                }
                out.push(next_id);
                next_id += 1;
            }
            i += 1;
        } else {
            return None;
        }
    }
    (out.len() == out_len).then_some(out)
}

/// Read the `[n][w][n]` polygon-count triple + MSB-first bit table at `o`.
fn poly_counts_at(post: &[u8], o: usize) -> Option<(Vec<usize>, usize)> {
    let rd = |p: usize| -> Option<i32> {
        post.get(p..p + 4)
            .map(|b| i32::from_le_bytes(b.try_into().unwrap()))
    };
    let n = rd(o)?;
    let w = rd(o + 4)?;
    let n2 = rd(o + 8)?;
    if n != n2 || n <= 0 || n >= 10_000 || !(1..=16).contains(&w) {
        return None;
    }
    let (n, w) = (n as usize, w as usize);
    let table_bytes = (n * w).div_ceil(32) * 4;
    let tb = post.get(o + 12..o + 12 + table_bytes)?;
    let bit = |j: usize| -> u32 {
        let word = u32::from_le_bytes(tb[j / 32 * 4..j / 32 * 4 + 4].try_into().unwrap());
        (word >> (31 - j % 32)) & 1
    };
    let counts: Vec<usize> = (0..n)
        .map(|i| (0..w).fold(0usize, |acc, k| acc << 1 | bit(i * w + k) as usize))
        .collect();
    Some((counts, o + 12 + table_bytes))
}

/// Decode the QUANTISED NORMAL STREAM between marker+12 and the polygon
/// corner-count table (byte-exact on every unique record in the corpus; spec in
/// docs/what_we_know_v1.md "Geometry records"):
///   u32 count, then count × 3-byte quantized normals (i8 = floor(n·128),
///   packed MSB-first inside little-endian u32 words, padded to 4 bytes), then
///   a token stream emitting exactly h4 normals (one per corner slot):
///     0x00..0x3f  emit r+1 FRESH normals (next unused table entries)
///     0x40+v      copy out[p-v]
///     0x80+k      repeat out[p-1] another k+1 times (RLE)
///     0xd0+k      fixed axis codebook: k>>1 = X/Y/Z, k&1 = sign (d0=+X … d5=-Z)
///     e0 XX/e1 XX long back-ref;  f0 00 00 = copy out[0];  0x00 pad after h4
fn decode_normals(post: &[u8], h4: usize) -> Option<Vec<[f32; 3]>> {
    let count = u32::from_le_bytes(post.get(0..4)?.try_into().unwrap()) as usize;
    if count == 0 || count > 100_000 {
        return None;
    }
    let table_bytes = (3 * count).div_ceil(4) * 4;
    let raw = post.get(4..4 + table_bytes)?;
    // Un-swizzle: bytes are stored MSB-first within each LE u32 word.
    let mut bytes = Vec::with_capacity(table_bytes);
    for w in raw.chunks_exact(4) {
        bytes.extend_from_slice(&[w[3], w[2], w[1], w[0]]);
    }
    let table: Vec<[f32; 3]> = (0..count)
        .map(|i| {
            let c = |k: usize| bytes[3 * i + k] as i8 as f32 / 128.0;
            let v = [c(0), c(1), c(2)];
            let l = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
            if l > 1e-6 {
                [v[0] / l, v[1] / l, v[2] / l]
            } else {
                v // rare degenerate zero entry (sliver face); tolerated
            }
        })
        .collect();
    // 1:1 case (first seen in a DWG-sourced file): when the table
    // holds one normal PER CORNER there is no index stream at all — the table
    // itself is the per-corner normal array.
    if count >= h4 {
        return Some(table.into_iter().take(h4).collect());
    }
    const AXES: [[f32; 3]; 6] = [
        [1.0, 0.0, 0.0],
        [-1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, -1.0, 0.0],
        [0.0, 0.0, 1.0],
        [0.0, 0.0, -1.0],
    ];
    let stream = post.get(4 + table_bytes..)?;
    let mut out: Vec<[f32; 3]> = Vec::with_capacity(h4);
    let mut fresh = 0usize;
    let mut i = 0usize;
    while i < stream.len() && out.len() < h4 {
        let b = stream[i];
        if b == 0xf0 && stream.get(i + 1) == Some(&0) && stream.get(i + 2) == Some(&0) {
            out.push(*out.first()?);
            i += 3;
        } else if (0xe0..0xf0).contains(&b) {
            let v = (b as usize - 0xe0) * 256 + *stream.get(i + 1)? as usize;
            if v == 0 || v > out.len() {
                return None;
            }
            out.push(out[out.len() - v]);
            i += 2;
        } else if (0xd0..0xd6).contains(&b) {
            out.push(AXES[(b - 0xd0) as usize]);
            i += 1;
        } else if (0x80..0xc0).contains(&b) {
            let last = *out.last()?;
            for _ in 0..=(b - 0x80) {
                if out.len() >= h4 {
                    break;
                }
                out.push(last);
            }
            i += 1;
        } else if (0x40..0x80).contains(&b) {
            let v = (b - 0x40) as usize;
            if v == 0 || v > out.len() {
                return None;
            }
            out.push(out[out.len() - v]);
            i += 1;
        } else if b < 0x40 {
            for _ in 0..=b {
                if out.len() >= h4 {
                    break;
                }
                out.push(*table.get(fresh)?);
                fresh += 1;
            }
            i += 1;
        } else {
            return None;
        }
    }
    (out.len() == h4).then_some(out)
}

/// Triangulate one strip-ordered polygon loop into `tris`. When the loop's
/// stored corner normals and the vertex positions are available, each
/// triangle's winding is set so its geometric normal AGREES with the stored
/// (outward) normal — the file's normals are authoritative for orientation.
fn strip_loop_tris(
    loop_v: &[u32],
    loop_n: Option<&[[f32; 3]]>,
    pos: &[[f32; 3]],
    tris: &mut Vec<u32>,
) {
    for i in 0..loop_v.len().saturating_sub(2) {
        let (a, b, c) = (loop_v[i], loop_v[i + 1], loop_v[i + 2]);
        if a == b || b == c || a == c {
            continue;
        }
        // Default strip parity winding (kept when no stored normal decides).
        let (mut v0, mut v1, v2) = if i % 2 == 0 { (b, a, c) } else { (a, b, c) };
        if let Some(ns) = loop_n {
            let (pa, pb, pc) = (pos[v0 as usize], pos[v1 as usize], pos[v2 as usize]);
            let e1 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
            let e2 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
            let g = [
                e1[1] * e2[2] - e1[2] * e2[1],
                e1[2] * e2[0] - e1[0] * e2[2],
                e1[0] * e2[1] - e1[1] * e2[0],
            ];
            let n = ns[i + 1]; // stored normal of the middle corner
            if g[0] * n[0] + g[1] * n[1] + g[2] * n[2] < 0.0 {
                std::mem::swap(&mut v0, &mut v1);
            }
        }
        tris.extend_from_slice(&[v0, v1, v2]);
    }
}

/// Decode the stored connectivity of the variant-94 record whose vertex block
/// ends at `pos_end`, bounded by `end` (next record start). Returns triangle
/// indices (deduplicated), or `None` if any stage fails (caller falls back to
/// the geometric heuristics).
/// Per-corner attribute block types inside a mesh record (`[id][type][-h4]`).
/// 100 = quantised normals ([`decode_normals`]). 61 = texture coordinates:
/// `4 × f32` UV bounds `(u_min, v_min, u_max, v_max)`, `u8 u_bits, u8 v_bits,
/// u16 0`, `u32 count`, a `count × (u_bits + v_bits)`-bit table, then the usual
/// token stream emitting h4 entries. UVs are not exported; the block is
/// recognised so the index stream / normals / polygon table around it decode.
const BLOCK_NORMALS: i32 = 100;
const BLOCK_UV: i32 = 61;

fn decode_connectivity(buf: &[u8], pos_end: usize, end: usize, nv: usize) -> Option<Vec<u32>> {
    let r = decode_connectivity_inner(buf, pos_end, end, nv);
    if let Err(stage) = &r {
        if std::env::var_os("NWD_TRACE_FAIL").is_some() {
            eprintln!("DECODE_FAIL pos_end={pos_end} end={end} nv={nv} stage={stage}");
        }
    }
    r.ok()
}

fn decode_connectivity_inner(
    buf: &[u8],
    pos_end: usize,
    end: usize,
    nv: usize,
) -> std::result::Result<Vec<u32>, &'static str> {
    let tail = buf.get(pos_end..end).ok_or("tail")?;
    // Locate the per-corner attribute blocks that follow the index stream.
    // Each is `[id][type][-h4]` with ids continuing the record's interned
    // sequence (100 record, 101 positions, 102, 103 …):
    //   [102][100][-h4]                      normals only (RVM / Revit loaders)
    //   [102][61][-h4] … [103][100][-h4]     TEXTURE COORDINATES, then normals
    //                                        (DWG / 3DS-sourced files with
    //                                        mapped materials)
    // The index stream ends at the first block; the normal stream and the
    // polygon table follow the normals block.
    let rd = |p: usize| -> Option<i32> {
        tail.get(p..p + 4)
            .map(|b| i32::from_le_bytes(b.try_into().unwrap()))
    };
    let mut marker = None; // (index-stream end, normal-stream start, h4)
    for o in 0..tail.len().saturating_sub(12) {
        if rd(o) != Some(102) {
            continue;
        }
        let (Some(ty), Some(neg)) = (rd(o + 4), rd(o + 8)) else {
            continue;
        };
        if neg >= 0 {
            continue;
        }
        if ty == BLOCK_NORMALS {
            marker = Some((o, o + 12, (-neg) as usize));
            break;
        }
        if ty == BLOCK_UV {
            let normals = (o + 12..tail.len().saturating_sub(12)).find(|&q| {
                rd(q) == Some(103) && rd(q + 4) == Some(BLOCK_NORMALS) && rd(q + 8) == Some(neg)
            });
            if let Some(q) = normals {
                marker = Some((o, q + 12, (-neg) as usize));
            }
            break;
        }
    }
    let (mo, post_start, h4) = marker.ok_or("marker")?;
    if h4 == 0 || h4 > 1_000_000 {
        return Err("h4");
    }
    let pre = &tail[..mo];
    let post = &tail[post_start..];
    let v_arr = if pre.iter().any(|&b| b != 0) {
        match lz_decode(pre, h4) {
            Some(v) => v,
            None => {
                if std::env::var_os("NWD_TRACE_FAIL").is_some() {
                    let hex: String = pre
                        .iter()
                        .map(|b| format!("{b:02x}"))
                        .collect::<Vec<_>>()
                        .join(" ");
                    eprintln!("PRE_FAIL h4={h4} nv={nv} pre_len={} pre=[{hex}]", pre.len());
                }
                return Err("pre_lz");
            }
        }
    } else {
        (0..h4 as u32).collect()
    };
    if v_arr.iter().any(|&v| v as usize >= nv) {
        return Err("pre_range");
    }
    // Vertex positions (needed for stored-normal winding correction).
    let pos_block = buf.get(pos_end - nv * 12..pos_end).ok_or("pos")?;
    let positions: Vec<[f32; 3]> = pos_block
        .chunks_exact(12)
        .map(|c| {
            [
                f32::from_le_bytes(c[0..4].try_into().unwrap()),
                f32::from_le_bytes(c[4..8].try_into().unwrap()),
                f32::from_le_bytes(c[8..12].try_into().unwrap()),
            ]
        })
        .collect();
    // Per-corner stored normals (None = decode failed; winding falls back to
    // the strip-parity default).
    let corner_normals = decode_normals(post, h4);
    if corner_normals.is_none() && std::env::var_os("NWD_TRACE").is_some() {
        eprintln!("TRACE normals DECODE FAILED for record ending at {pos_end}");
    }
    // Scan post for the polygon-count triple; prefer the LAST candidate that
    // fully decodes (matches the validated reference decoder).
    let mut candidates: Vec<usize> = Vec::new();
    for o in 0..post.len().saturating_sub(12) {
        if poly_counts_at(post, o).is_some() {
            candidates.push(o);
        }
    }
    for &o in candidates.iter().rev() {
        let (counts, tend) = poly_counts_at(post, o).unwrap();
        let total: usize = counts.iter().sum();
        if total < h4 || total > MAX_POLY_CORNERS || counts.iter().any(|&c| c < 3) {
            continue;
        }
        let corners: Vec<u32> = if total == h4 {
            (0..h4 as u32).collect()
        } else {
            let stored = post
                .get(tend..tend + 4)
                .map(|b| u32::from_le_bytes(b.try_into().unwrap()));
            if stored != Some(total as u32) {
                continue;
            }
            match lz_decode(&post[tend + 4..], total) {
                Some(c) if c.iter().all(|&x| (x as usize) < h4) => c,
                _ => continue,
            }
        };
        let mut tris = Vec::with_capacity(total * 3);
        let mut p = 0usize;
        let mut ok = true;
        for &c in &counts {
            let loop_v: Vec<u32> = corners[p..p + c]
                .iter()
                .map(|&k| v_arr[k as usize])
                .collect();
            if loop_v.iter().any(|&v| v as usize >= nv) {
                ok = false;
                break;
            }
            let loop_n: Option<Vec<[f32; 3]>> = corner_normals
                .as_ref()
                .map(|ns| corners[p..p + c].iter().map(|&k| ns[k as usize]).collect());
            strip_loop_tris(&loop_v, loop_n.as_deref(), &positions, &mut tris);
            p += c;
        }
        if !ok || tris.is_empty() {
            continue;
        }
        // Drop exact duplicate triangles (double-sided washer records store the
        // whole polygon set twice).
        let mut seen = std::collections::HashSet::new();
        let mut dedup = Vec::with_capacity(tris.len());
        for t in tris.chunks_exact(3) {
            let mut k = [t[0], t[1], t[2]];
            k.sort_unstable();
            if seen.insert(k) {
                dedup.extend_from_slice(t);
            }
        }
        return Ok(dedup);
    }
    Err(if candidates.is_empty() {
        "no_counts"
    } else {
        "counts_reject"
    })
}

/// Decode a variant-95 LINE record's stored polylines. After the vertex block:
///
/// ```text
/// PRE stream            the mesh LZ codec → vertex-index array V (length h4);
///                       empty/zero = identity (then h4 == vertex count)
/// zero words            or, in RVM-loader files, the mesh marker
///                       `[102][100][-h4]` + a normal stream
/// u32 n, u32 w, u32 n   polyline-count triple
/// bit table             n unsigned w-bit VERTEX COUNTS per polyline (MSB-first)
/// ```
///
/// Each polyline of k indices is k−1 consecutive segments. Returns `None` when
/// no count table sums to h4 or the index stream does not decode in range.
fn decode_polylines(
    buf: &[u8],
    pos_end: usize,
    end: usize,
    nv: usize,
    h4: usize,
) -> Option<Vec<[u32; 2]>> {
    let tail = buf.get(pos_end..end)?;
    if h4 < 2 || h4 > 1_000_000 {
        return None;
    }
    // The count triple: last 4-aligned candidate whose counts sum to h4.
    let mut found = None;
    for o in (0..tail.len().saturating_sub(12)).step_by(4) {
        if let Some((counts, _)) = poly_counts_at(tail, o) {
            if counts.iter().sum::<usize>() == h4 && counts.iter().all(|&c| c >= 1) {
                found = Some((o, counts));
            }
        }
    }
    let (to, counts) = found?;
    // RVM-loader line records carry the mesh marker `[102][100][-h4]` (and a
    // normal stream) between the index stream and the count table; DWG-type
    // ones just zero words. The index stream ends at the marker when present.
    let rd = |p: usize| {
        tail.get(p..p + 4)
            .map(|b| i32::from_le_bytes(b.try_into().unwrap()))
    };
    let marker = (0..to.saturating_sub(8))
        .step_by(4)
        .find(|&o| rd(o) == Some(102) && rd(o + 4) == Some(100) && rd(o + 8) == Some(-(h4 as i32)));
    let pre = &tail[..marker.unwrap_or(to)];
    let v: Vec<u32> = if pre.iter().any(|&b| b != 0) {
        lz_decode(pre, h4)?
    } else {
        (0..h4 as u32).collect()
    };
    if v.iter().any(|&i| i as usize >= nv) {
        return None;
    }
    let mut segs = Vec::with_capacity(h4);
    let mut p = 0usize;
    for c in counts {
        for k in p..(p + c).saturating_sub(1) {
            if v[k] != v[k + 1] {
                segs.push([v[k], v[k + 1]]);
            }
        }
        p += c;
    }
    Some(segs)
}

/// Parse all geometry records from the logical buffer.
///
/// Record ends are taken from the next MAGIC record start — which overshoots
/// whenever AUX (104/105) records sit in between. Prefer [`parse_sized`] when
/// the size-index chunk is available.
pub fn parse(buf: &[u8]) -> Result<Vec<GeomRecord>> {
    let starts = record_starts(buf);
    let bounds: Vec<(usize, usize)> = starts
        .iter()
        .enumerate()
        .map(|(si, &o)| (o, starts.get(si + 1).copied().unwrap_or(buf.len())))
        .collect();
    parse_bounded(buf, &bounds)
}

/// Parse the magic (v94/v95) records using the EXACT per-record sizes from
/// the geometry size-index chunk (`inspect::geometry_chunks_by_index`). Each
/// record's codec tail then ends exactly at its own end, instead of running
/// on through any AUX records that follow it (the Huldra corpus interleaves
/// ~37k AUX records with its meshes; the overshoot broke ~1% of decodes).
/// Falls back to [`parse`] if the sizes do not tile the buffer.
pub fn parse_sized(buf: &[u8], sizes: &[u32]) -> Result<Vec<GeomRecord>> {
    let total: usize = sizes.iter().map(|&s| s as usize).sum();
    if total != buf.len() {
        return parse(buf);
    }
    let rd = |o: usize| u32::from_le_bytes(buf[o..o + 4].try_into().unwrap());
    let mut bounds = Vec::new();
    let mut o = 0usize;
    for &s in sizes {
        let e = o + s as usize;
        if e >= o + 16 && rd(o) == 100 && rd(o + 8) == 101 && rd(o + 12) == 60 {
            bounds.push((o, e));
        }
        o = e;
    }
    parse_bounded(buf, &bounds)
}

fn parse_bounded(buf: &[u8], bounds: &[(usize, usize)]) -> Result<Vec<GeomRecord>> {
    let mut records = Vec::new();
    for &(o, rec_end) in bounds {
        if let Some(r) = parse_one(buf, o, rec_end, 0)? {
            records.push(r);
        }
    }
    Ok(records)
}

/// Decode the magic (v94 surface / v95 line / v96 point) record at
/// `buf[o..rec_end]`. `base` is added to the stored `offset` (the logical
/// stream offset of `buf[0]` when `buf` is a window of the stream).
/// `Ok(None)` = not a usable record (bad vertex count / non-finite vertex).
fn parse_one(buf: &[u8], o: usize, rec_end: usize, base: usize) -> Result<Option<GeomRecord>> {
    let mut cur = Cursor::new(buf);
    cur.seek(o + 4); // header variant (94 = surface, 95 = line-set)
    let variant = cur.u32()?;
    let h4 = {
        let mut c = Cursor::new(buf);
        c.seek(o + 16);
        c.u32().unwrap_or(0)
    };
    cur.seek(o + 20); // h5
    let h5 = cur.u32()? as usize;
    if h5 == 0 || h5 % 3 != 0 || h5 > 200_000 {
        return Ok(None);
    }
    let vcount = h5 / 3;
    let pos_start = o + HEADER_WORDS * 4;
    let Some(raw) = buf.get(pos_start..pos_start + vcount * 12) else {
        return Ok(None);
    };
    let mut positions = Vec::with_capacity(vcount);
    for v in raw.chunks_exact(12) {
        let f = |k: usize| f32::from_le_bytes(v[4 * k..4 * k + 4].try_into().unwrap());
        let (x, y, z) = (f(0), f(1), f(2));
        if !(x.is_finite() && y.is_finite() && z.is_finite()) {
            return Ok(None);
        }
        positions.push([x, y, z]);
    }
    let decoded_tris = if variant == 94 {
        decode_connectivity(buf, pos_start + vcount * 12, rec_end, vcount)
    } else {
        None
    };
    let line_segments = if variant == 95 {
        decode_polylines(buf, pos_start + vcount * 12, rec_end, vcount, h4 as usize)
    } else {
        None
    };
    Ok(Some(GeomRecord {
        offset: base + o,
        positions,
        variant,
        decoded_tris,
        line_segments,
    }))
}

/// What each ON-DISK geometry record is, indexed the way a fragment's
/// `geom_record_idx` (`marker+64`, 1-based) counts them: a decoded mesh
/// record (index into the parsed record list), an AUX parametric primitive,
/// or neither. One `u32` per record plus the AUX payloads — the two
/// `Vec<Option<…>>` tables this replaces cost 60 bytes per record.
#[derive(Debug, Default, Clone)]
pub struct GeomIndex {
    /// 0 = none; `AUX_BIT | k` = `aux[k]`; else (record index + 1).
    slot: Vec<u32>,
    aux: Vec<AuxPrim>,
}

impl GeomIndex {
    const AUX_BIT: u32 = 1 << 31;

    /// Number of on-disk records.
    pub fn len(&self) -> usize {
        self.slot.len()
    }
    pub fn is_empty(&self) -> bool {
        self.slot.is_empty()
    }
    /// Parsed-record index of on-disk record `i` (0-based), if it is a mesh.
    pub fn mesh(&self, i: usize) -> Option<usize> {
        match self.slot.get(i) {
            Some(&v) if v != 0 && v & Self::AUX_BIT == 0 => Some(v as usize - 1),
            _ => None,
        }
    }
    /// The AUX primitive stored in on-disk record `i` (0-based), if any.
    pub fn aux(&self, i: usize) -> Option<AuxPrim> {
        match self.slot.get(i) {
            Some(&v) if v & Self::AUX_BIT != 0 => {
                self.aux.get((v & !Self::AUX_BIT) as usize).copied()
            }
            _ => None,
        }
    }
    fn push_mesh(&mut self, record_idx: usize) {
        self.slot.push(record_idx as u32 + 1);
    }
    fn push_aux(&mut self, p: AuxPrim) {
        self.slot.push(Self::AUX_BIT | self.aux.len() as u32);
        self.aux.push(p);
    }
    fn push_none(&mut self) {
        self.slot.push(0);
    }

    /// Build from a whole geometry buffer with the CONTENT walker (files
    /// without a size index): `records` must be the parse of the same buffer.
    pub fn from_buffer(buf: &[u8], records: &[GeomRecord]) -> GeomIndex {
        let by_offset: std::collections::HashMap<usize, usize> = records
            .iter()
            .enumerate()
            .map(|(i, r)| (r.offset, i))
            .collect();
        let mut g = GeomIndex::default();
        for k in on_disk_records(buf) {
            match k {
                OnDiskKind::Magic(off) => match by_offset.get(&off) {
                    Some(&i) => g.push_mesh(i),
                    None => g.push_none(),
                },
                OnDiskKind::Aux(off) => match read_aux(buf, off) {
                    Some(p) => g.push_aux(p),
                    None => g.push_none(),
                },
            }
        }
        g
    }
}

/// Decode the whole geometry stream WITHOUT ever holding it inflated: the
/// size-index chunk gives every on-disk record's exact byte length, so the
/// stream is read a group of chunks at a time (inflated in parallel), the
/// records that are complete in the window are decoded (in parallel — they are
/// independent) and the window slides on. Peak transient memory is one chunk
/// group (~8 MB inflated) however large the model is.
///
/// `chunk_lens[k]` = inflated length of the k-th geometry chunk and
/// `inflate(k)` returns its payload; `sizes` are the per-record lengths
/// (`inspect::geometry_chunks_by_index`). Returns the decoded mesh records in
/// disk order plus the on-disk index ([`GeomIndex`]) — the i-th size entry IS
/// on-disk record i, whatever its type.
pub fn parse_stream<F>(
    chunk_lens: &[usize],
    inflate: F,
    sizes: &[u32],
) -> Result<(Vec<GeomRecord>, GeomIndex)>
where
    F: Fn(usize) -> Vec<u8> + Sync,
{
    enum Slot {
        None,
        Mesh(GeomRecord),
        Aux(AuxPrim),
    }
    const GROUP_BYTES: usize = 8 << 20;
    let decode = |win: &[u8], base: usize, o: usize, e: usize| -> Result<Slot> {
        let rd = |p: usize| u32::from_le_bytes(win[p..p + 4].try_into().unwrap());
        if e < o + 16 || rd(o) != 100 {
            return Ok(Slot::None);
        }
        let (variant, h2, h3) = (rd(o + 4), rd(o + 8), rd(o + 12));
        if h2 == 101 && h3 == 60 {
            return Ok(parse_one(win, o, e, base)?.map_or(Slot::None, Slot::Mesh));
        }
        // AUX: the VARIANT word decides (104 disc / 105 cylinder); word2 is a
        // flag word (0 / 3 / 0x30003) — see `on_disk_records`.
        if h3 == 0 && matches!(h2, 0 | 3 | 196611) && matches!(variant, 104 | 105) {
            return Ok(read_aux(&win[o..e], 0).map_or(Slot::None, Slot::Aux));
        }
        Ok(Slot::None)
    };
    let mut records: Vec<GeomRecord> = Vec::new();
    let mut index = GeomIndex {
        slot: Vec::with_capacity(sizes.len()),
        aux: Vec::new(),
    };
    let mut window: Vec<u8> = Vec::new();
    let mut base = 0usize; // logical stream offset of window[0]
    let mut next = 0usize; // next record (index into sizes)
    let mut ci = 0usize;
    while ci < chunk_lens.len() {
        let mut end = ci;
        let mut bytes = 0usize;
        while end < chunk_lens.len() && (end == ci || bytes < GROUP_BYTES) {
            bytes += chunk_lens[end];
            end += 1;
        }
        #[cfg(not(target_arch = "wasm32"))]
        let datas: Vec<Vec<u8>> = {
            use rayon::prelude::*;
            (ci..end).into_par_iter().map(&inflate).collect()
        };
        #[cfg(target_arch = "wasm32")]
        let datas: Vec<Vec<u8>> = (ci..end).map(&inflate).collect();
        window.reserve(bytes);
        for d in &datas {
            window.extend_from_slice(d);
        }
        drop(datas);
        ci = end;
        // Records complete in the window.
        let mut bounds: Vec<(usize, usize)> = Vec::new();
        let mut o = 0usize;
        while let Some(&s) = sizes.get(next + bounds.len()) {
            let e = o + s as usize;
            if e > window.len() {
                break;
            }
            bounds.push((o, e));
            o = e;
        }
        let win = &window[..];
        #[cfg(not(target_arch = "wasm32"))]
        let slots: Vec<Result<Slot>> = {
            use rayon::prelude::*;
            bounds
                .par_iter()
                .map(|&(o, e)| decode(win, base, o, e))
                .collect()
        };
        #[cfg(target_arch = "wasm32")]
        let slots: Vec<Result<Slot>> = bounds
            .iter()
            .map(|&(o, e)| decode(win, base, o, e))
            .collect();
        for sl in slots {
            match sl? {
                Slot::Mesh(r) => {
                    index.push_mesh(records.len());
                    records.push(r);
                }
                Slot::Aux(p) => index.push_aux(p),
                Slot::None => index.push_none(),
            }
        }
        next += bounds.len();
        window.drain(..o);
        base += o;
    }
    // Size entries past the end of the stream (never on a well-formed file).
    while index.len() < sizes.len() {
        index.push_none();
    }
    Ok((records, index))
}

/// Parse geometry records in the OLD (lichunk-007, ~2013) layout, walked by
/// the per-record sizes from the geometry size-index chunk. Byte layout
/// (validated on every record of two ~2013 Navisworks Simulate files, mean
/// stored-vs-face normal error 0.09°):
/// ```text
/// [100][94][101][60][h4]                     5×u32 header (NO h5 word)
/// h4 × vec3 f32                              corner positions (UNCOMPRESSED
///                                            corner array — the modern format
///                                            LZ-compresses this)
/// u32 0                                      separator
/// [102][100][+h4]                            marker (h4 POSITIVE)
/// h4 × 3×i16                                 per-corner normals (n/32767)
/// align4 + u32 0                             separator
/// [u32 nfaces][nfaces × u16 corner counts]   polygon table (loops in
///                                            GL_TRIANGLE_STRIP order)
/// pad
/// ```
pub fn parse_old(buf: &[u8], record_sizes: &[u32]) -> Result<Vec<GeomRecord>> {
    let rd_u32 = |o: usize| -> Option<u32> {
        buf.get(o..o + 4)
            .map(|b| u32::from_le_bytes(b.try_into().unwrap()))
    };
    let mut records = Vec::new();
    let mut off = 0usize;
    for &sz in record_sizes {
        let o = off;
        off += sz as usize;
        if off > buf.len() {
            break;
        }
        let (Some(w0), Some(variant), Some(w2), Some(w3), Some(h4)) = (
            rd_u32(o),
            rd_u32(o + 4),
            rd_u32(o + 8),
            rd_u32(o + 12),
            rd_u32(o + 16),
        ) else {
            continue;
        };
        if w0 != 100 || w2 != 101 || w3 != 60 {
            continue;
        }
        let h4 = h4 as usize;
        // The corners must fit in the record (also keeps `12 * h4` from
        // wrapping on wasm32 and passing the bound check below).
        if h4 > sz as usize / 12 {
            continue;
        }
        let mo = 20 + 12 * h4 + 4;
        if o + mo + 12 > off {
            continue;
        }
        if rd_u32(o + mo) != Some(102)
            || rd_u32(o + mo + 4) != Some(100)
            || rd_u32(o + mo + 8) != Some(h4 as u32)
        {
            continue;
        }
        // Corner positions.
        let mut positions = Vec::with_capacity(h4);
        let mut ok = true;
        for j in 0..h4 {
            let p = o + 20 + 12 * j;
            let f =
                |k: usize| f32::from_le_bytes(buf[p + 4 * k..p + 4 * k + 4].try_into().unwrap());
            let v = [f(0), f(1), f(2)];
            if !v.iter().all(|x| x.is_finite()) {
                ok = false;
                break;
            }
            positions.push(v);
        }
        if !ok {
            continue;
        }
        // Per-corner normals (3×i16).
        let npos = o + mo + 12;
        let normals: Vec<[f32; 3]> = (0..h4)
            .map(|j| {
                let q = npos + 6 * j;
                let c = |k: usize| {
                    i16::from_le_bytes(buf[q + 2 * k..q + 2 * k + 2].try_into().unwrap()) as f32
                        / 32767.0
                };
                [c(0), c(1), c(2)]
            })
            .collect();
        // Polygon corner-count table.
        let fpos = npos + (6 * h4).div_ceil(4) * 4 + 4;
        let Some(nf) = rd_u32(fpos) else { continue };
        let nf = nf as usize;
        if nf == 0 || fpos + 4 + 2 * nf > off {
            continue;
        }
        let counts: Vec<usize> = (0..nf)
            .map(|k| {
                u16::from_le_bytes(
                    buf[fpos + 4 + 2 * k..fpos + 4 + 2 * k + 2]
                        .try_into()
                        .unwrap(),
                ) as usize
            })
            .collect();
        if counts.iter().sum::<usize>() != h4 {
            continue;
        }
        // Triangulate: strip loops over the SEQUENTIAL corner ids, winding
        // oriented by the stored per-corner normals (same rule as the modern
        // decoder).
        let mut tris = Vec::new();
        let mut p = 0usize;
        for &c in &counts {
            let loop_v: Vec<u32> = (p as u32..(p + c) as u32).collect();
            let loop_n: Vec<[f32; 3]> = (p..p + c).map(|k| normals[k]).collect();
            strip_loop_tris(&loop_v, Some(&loop_n), &positions, &mut tris);
            p += c;
        }
        if tris.is_empty() {
            continue;
        }
        records.push(GeomRecord {
            offset: o,
            positions,
            variant,
            decoded_tris: Some(tris),
            line_segments: None,
        });
    }
    Ok(records)
}
