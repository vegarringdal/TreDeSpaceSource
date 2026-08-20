//! B-rep traversal and face tessellation.
//!
//! Faces are triangulated in the surface's UV space with tess2 (odd winding
//! handles holes), refined by midpoint edge subdivision until both the
//! parametric step limits and a 3D chord-deviation criterion are met, then
//! mapped back to 3D with analytic/finite-difference normals.
//!
//! Surface support:
//! - plane + the quadrics (closed-form UV inversion)
//! - surfaces of linear extrusion / revolution (reduced to quadrics where
//!   possible, otherwise seeded 1D Newton inversion)
//! - (rational) B-spline surfaces, trimmed via seeded 2D Newton projection;
//!   a near-full-patch B-spline whose inverted boundary defeats tess2 (extreme
//!   -aspect lofted strips) falls back to gridding the knot domain directly
//! - faces that wrap fully around a periodic direction (cylinder bands,
//!   closed revolutions, ...) are cut at a seam and rebuilt as band polygons
//! - boundary loops that encircle a sphere pole / cone apex are closed with a
//!   synthetic polar cap
//! - AP242 tessellated items are taken verbatim
//!
//! Colors from STYLED_ITEM are carried per item/face into per-color buckets
//! (-> one glTF primitive + material each).

use std::collections::HashMap;

use tess2_rust::tess::TESS_UNDEF;
use tess2_rust::{ElementType, Tessellator, WindingRule};

use crate::geom::*;
use crate::mesh::{MeshSet, TriMesh};
use crate::model::{self, TessParams};
use crate::step::StepFile;
use crate::styles::ColorMap;

#[derive(Default)]
pub struct TessStats {
    pub faces_ok: usize,
    pub faces_failed: usize,
    /// faces with a boundary that collapses to no area — a sliver/degenerate
    /// face (e.g. a single edge whose start and end vertex coincide). These
    /// carry zero surface, so they are skipped without counting as failures.
    pub degenerate_faces: usize,
    pub unsupported_surfaces: HashMap<String, usize>,
    /// supported surface types whose trimming/tessellation still failed
    /// (Newton non-convergence, multi-winding loops, degenerate bounds, …):
    /// count plus a few sample ADVANCED_FACE entity ids for diagnosis
    pub failed_surfaces: HashMap<String, (usize, Vec<u32>)>,
    /// unknown surface types that were silently approximated by a flat plane
    /// through the face boundary (the face is NOT skipped, but the curvature
    /// is lost) — so a missing surface implementation is visible, not silent
    pub approximated_surfaces: HashMap<String, usize>,
    /// edge curve types we cannot discretize: the edge falls back to a straight
    /// chord between its vertices, so the loop is built but the boundary is
    /// wrong. Counts per type (e.g. COMPOSITE_CURVE, HYPERBOLA, PARABOLA)
    pub unsupported_curves: HashMap<String, usize>,
    /// top-level representation items we do not tessellate at all (e.g.
    /// GEOMETRIC_SET, SWEPT_AREA_SOLID, AP242-ed2 TRIANGULATED_FACE) — counted
    /// so a whole item silently producing no geometry is surfaced
    pub unsupported_items: HashMap<String, usize>,
    /// first failing ADVANCED_FACE per surface type, plus the stage that
    /// failed — used by `--debug-print` to dump a self-contained sub-graph
    pub debug_samples: HashMap<String, (u32, &'static str)>,
}

/// Add the counts of `b` into `a` (a small helper for the per-type tallies).
fn merge_counts(a: &mut HashMap<String, usize>, b: &HashMap<String, usize>) {
    for (k, v) in b {
        *a.entry(k.clone()).or_insert(0) += v;
    }
}

impl TessStats {
    /// Fold another stats record in (used by the parallel face workers).
    pub fn merge(&mut self, o: &TessStats) {
        self.faces_ok += o.faces_ok;
        self.faces_failed += o.faces_failed;
        self.degenerate_faces += o.degenerate_faces;
        merge_counts(&mut self.unsupported_surfaces, &o.unsupported_surfaces);
        merge_counts(&mut self.approximated_surfaces, &o.approximated_surfaces);
        merge_counts(&mut self.unsupported_curves, &o.unsupported_curves);
        merge_counts(&mut self.unsupported_items, &o.unsupported_items);
        for (k, (n, ids)) in &o.failed_surfaces {
            let e = self
                .failed_surfaces
                .entry(k.clone())
                .or_insert((0, Vec::new()));
            e.0 += n;
            for id in ids {
                if e.1.len() < 5 {
                    e.1.push(*id);
                }
            }
        }
        for (k, v) in &o.debug_samples {
            self.debug_samples.entry(k.clone()).or_insert(*v);
        }
    }
}

/// Shared, read-only context for a tessellation run.
pub struct Ctx<'a> {
    pub sf: &'a StepFile,
    pub tp: &'a TessParams,
    pub colors: &'a ColorMap,
    /// worker threads for per-face fan-out (1 = serial)
    pub threads: usize,
}

impl<'a> Ctx<'a> {
    pub fn color_of(&self, id: u32, inherited: Option<[f32; 4]>) -> Option<[f32; 4]> {
        self.colors.get(&id).copied().or(inherited)
    }
}

/// Tessellate any geometric representation item we understand into `out`.
/// Returns true if the item produced (or may produce) triangles.
pub fn tessellate_item(
    cx: &Ctx,
    id: u32,
    inherited: Option<[f32; 4]>,
    out: &mut MeshSet,
    stats: &mut TessStats,
) -> bool {
    let sf = cx.sf;
    let color = cx.color_of(id, inherited);
    let ty = match sf.entity_type(id) {
        Some(t) => t.to_string(),
        None => return false,
    };
    match ty.as_str() {
        "MANIFOLD_SOLID_BREP" | "FACETED_BREP" => {
            if let Some(p) = sf.params(id) {
                if let Some(shell) = p.get(1).and_then(|v| v.as_ref_id()) {
                    tessellate_shell(cx, shell, color, out, stats);
                    return true;
                }
            }
            false
        }
        "BREP_WITH_VOIDS" => {
            if let Some(p) = sf.params(id) {
                if let Some(shell) = p.get(1).and_then(|v| v.as_ref_id()) {
                    tessellate_shell(cx, shell, color, out, stats);
                }
                if let Some(voids) = p.get(2).and_then(|v| v.as_list()) {
                    for v in voids {
                        if let Some(r) = v.as_ref_id() {
                            tessellate_shell(cx, resolve_oriented_shell(sf, r), color, out, stats);
                        }
                    }
                }
                return true;
            }
            false
        }
        "SHELL_BASED_SURFACE_MODEL" | "FACE_BASED_SURFACE_MODEL" => {
            if let Some(p) = sf.params(id) {
                if let Some(shells) = p.get(1).and_then(|v| v.as_list()) {
                    for s in shells {
                        if let Some(r) = s.as_ref_id() {
                            tessellate_shell(cx, resolve_oriented_shell(sf, r), color, out, stats);
                        }
                    }
                    return true;
                }
            }
            false
        }
        // ed1 *_SET forms and the ed2 TRIANGULATED_FACE (geometric_link slot
        // auto-detected); explicit triangle list
        "TRIANGULATED_FACE_SET" | "TRIANGULATED_SURFACE_SET" | "TRIANGULATED_FACE" => {
            tessellate_triangulated_set(sf, id, out.bucket(color), false);
            true
        }
        // ed2 strip/fan-encoded form
        "COMPLEX_TRIANGULATED_FACE" => {
            tessellate_triangulated_set(sf, id, out.bucket(color), true);
            true
        }
        "TESSELLATED_SOLID" | "TESSELLATED_SHELL" => {
            if let Some(p) = sf.params(id) {
                if let Some(items) = p.get(1).and_then(|v| v.as_list()) {
                    for it in items {
                        if let Some(r) = it.as_ref_id() {
                            tessellate_item(cx, r, color, out, stats);
                        }
                    }
                    return true;
                }
            }
            false
        }
        "MAPPED_ITEM" => {
            if let Some(p) = sf.params(id) {
                let map = p.get(1).and_then(|v| v.as_ref_id());
                let target = p.get(2).and_then(|v| v.as_ref_id());
                if let Some(map) = map {
                    let mut sub = MeshSet::default();
                    let mut any = false;
                    if let Some(mp) = sf.params(map) {
                        let origin = mp.first().and_then(|v| v.as_ref_id());
                        let rep = mp.get(1).and_then(|v| v.as_ref_id());
                        if let Some(rep) = rep {
                            if let Some(rp) = sf.params(rep) {
                                if let Some(items) = rp.get(1).and_then(|v| v.as_list()) {
                                    for it in items {
                                        if let Some(r) = it.as_ref_id() {
                                            any |= tessellate_item(cx, r, color, &mut sub, stats);
                                        }
                                    }
                                }
                            }
                        }
                        if any {
                            let m_origin = origin
                                .map(|o| model::axis2_matrix(sf, o))
                                .unwrap_or(M4::IDENTITY);
                            let m_target = target
                                .map(|t| model::axis2_matrix(sf, t))
                                .unwrap_or(M4::IDENTITY);
                            sub.transform(&m_target.mul(m_origin.inverse_rigid()));
                            out.append(&sub);
                        }
                    }
                    return any;
                }
            }
            false
        }
        "CLOSED_SHELL" | "OPEN_SHELL" => {
            tessellate_shell(cx, id, color, out, stats);
            true
        }
        "ORIENTED_CLOSED_SHELL" => {
            tessellate_shell(cx, resolve_oriented_shell(sf, id), color, out, stats);
            true
        }
        "ADVANCED_FACE" | "FACE_SURFACE" => {
            tessellate_face(cx, id, color, out, stats);
            true
        }
        // wireframe (datum / reference curves) -> glTF line geometry
        "GEOMETRIC_CURVE_SET" | "GEOMETRIC_SET" => {
            tessellate_curve_set(cx, id, color, out, stats);
            true
        }
        // procedural solids: a planar profile (bounded surface or face)
        // extruded along a direction / revolved around an axis (AP214
        // exporters emit these directly)
        "EXTRUDED_AREA_SOLID"
        | "REVOLVED_AREA_SOLID"
        | "EXTRUDED_FACE_SOLID"
        | "REVOLVED_FACE_SOLID" => match tessellate_swept_area(cx, id, &ty, color, out, stats) {
            Some(true) => {
                stats.faces_ok += 1;
                true
            }
            _ => {
                *stats.unsupported_items.entry(ty.clone()).or_insert(0) += 1;
                false
            }
        },
        // constructive solid geometry: mesh the primitives and evaluate the
        // boolean tree (union / difference / intersection) into one mesh
        "CSG_SOLID"
        | "BOOLEAN_RESULT"
        | "BLOCK"
        | "RIGHT_CIRCULAR_CYLINDER"
        | "RIGHT_CIRCULAR_CONE"
        | "SPHERE"
        | "TORUS"
        | "RIGHT_ANGULAR_WEDGE" => {
            match crate::csg::eval_csg(sf, id, cx.tp) {
                Some(mesh) if !mesh.is_empty() => {
                    out.bucket(color).append(&mesh);
                    stats.faces_ok += 1;
                    true
                }
                // a CSG operand we cannot mesh (right_angular_wedge,
                // half_space_solid, a B-rep solid operand) — surface it
                _ => {
                    *stats.unsupported_items.entry(ty.clone()).or_insert(0) += 1;
                    false
                }
            }
        }
        // datums/origins legitimately sit in a SHAPE_REPRESENTATION item list
        // next to the geometry and carry no surface — not a missing feature
        "AXIS2_PLACEMENT_3D" | "AXIS2_PLACEMENT_2D" | "AXIS1_PLACEMENT" | "CARTESIAN_POINT"
        | "DIRECTION" | "VECTOR" => false,
        other => {
            // a representation item we do not tessellate at all — record it so a
            // silently-empty item (e.g. SWEPT_FACE_SOLID, an AP242-ed2
            // TRIANGULATED_FACE) is surfaced rather than vanishing
            *stats
                .unsupported_items
                .entry(other.to_string())
                .or_insert(0) += 1;
            false
        }
    }
}

/// Synthesize the boundary loop of a RECTANGULAR_TRIMMED_SURFACE's u/v window,
/// for faces that carry no explicit boundary loops (where the window is the
/// authoritative trim). Window values are in ISO parameter conventions
/// (angles in the file's plane-angle unit) — [`model::iso_uv`] converts.
fn rts_window_loop(sf: &StepFile, surf_id: u32, surf: &Surface, tp: &TessParams) -> Option<Loop3> {
    if sf.entity_type(surf_id)? != "RECTANGULAR_TRIMMED_SURFACE" {
        return None;
    }
    let p = sf.params(surf_id)?;
    let (u1, u2) = (p.get(2)?.as_f64()?, p.get(3)?.as_f64()?);
    let (v1, v2) = (p.get(4)?.as_f64()?, p.get(5)?.as_f64()?);
    let ang = model::file_plane_angle_scale(sf);
    let map = |u: f64, v: f64| model::iso_uv(surf, ang, u, v);
    let (cu1, cv1) = map(u1, v1)?;
    let (cu2, cv2) = map(u2, v2)?;

    let steps = |span: f64, step: f64| -> usize {
        if !step.is_finite() || step <= 0.0 {
            1
        } else {
            ((span.abs() / step).ceil() as usize).clamp(1, 256)
        }
    };
    let nu = steps(cu2 - cu1, surf.u_step(tp.deflection, tp.max_angle));
    let nv = steps(cv2 - cv1, surf.v_step(tp.deflection, tp.max_angle));

    // rectangle perimeter in ISO uv, counter-clockwise, closed
    let mut pts: Vec<V3> = Vec::with_capacity(2 * (nu + nv) + 1);
    let mut emit = |u: f64, v: f64| {
        let (cu, cv) = map(u, v).unwrap();
        pts.push(surf.point(cu, cv));
    };
    for i in 0..nu {
        emit(u1 + (u2 - u1) * i as f64 / nu as f64, v1);
    }
    for i in 0..nv {
        emit(u2, v1 + (v2 - v1) * i as f64 / nv as f64);
    }
    for i in 0..nu {
        emit(u2 - (u2 - u1) * i as f64 / nu as f64, v2);
    }
    for i in 0..nv {
        emit(u1, v2 - (v2 - v1) * i as f64 / nv as f64);
    }
    emit(u1, v1);
    Some(Loop3 { pts })
}

/// EXTRUDED_AREA_SOLID / REVOLVED_AREA_SOLID: a planar profile (a
/// CURVE_BOUNDED_SURFACE whose basis is a PLANE) swept along a direction or
/// around an axis. The two caps reuse the planar face pipeline
/// ([`face_to_mesh`]); the walls are exact quad strips with flat per-quad
/// normals (the materials are double-sided, so loop orientation only affects
/// shading side, not visibility). Returns `Some(true)` when triangles were
/// produced, `None`/`Some(false)` for a profile we can't handle (non-planar
/// basis, undiscretizable boundary) — the caller tallies it as unsupported.
fn tessellate_swept_area(
    cx: &Ctx,
    id: u32,
    ty: &str,
    color: Option<[f32; 4]>,
    out: &mut MeshSet,
    stats: &mut TessStats,
) -> Option<bool> {
    let sf = cx.sf;
    let tp = cx.tp;
    let p = sf.params(id)?;

    // the planar profile: either a CURVE_BOUNDED_SURFACE (swept_area_solid,
    // '', basis, (boundaries), implicit) or a FACE_SURFACE / ADVANCED_FACE
    // (swept_face_solid, '', (bounds), surface, same_sense)
    let area = p.get(1)?.as_ref_id()?;
    let (frame, loops): (Frame, Vec<Loop3>) = match sf.entity_type(area)? {
        "CURVE_BOUNDED_SURFACE" => {
            let ap = sf.params(area)?;
            let frame = match model::surface(sf, ap.get(1)?.as_ref_id()?) {
                Some(Surface::Plane(f)) => f,
                _ => return None, // non-planar swept profile: not handled
            };
            let loops = ap
                .get(2)?
                .as_list()?
                .iter()
                .filter_map(|b| b.as_ref_id())
                .filter_map(|bid| {
                    model::boundary_polyline(sf, bid, tp, &mut stats.unsupported_curves)
                        .map(|pts| Loop3 { pts })
                })
                .collect();
            (frame, loops)
        }
        "FACE_SURFACE" | "ADVANCED_FACE" => {
            let ap = sf.params(area)?;
            let frame = match model::surface(sf, ap.get(2)?.as_ref_id()?) {
                Some(Surface::Plane(f)) => f,
                _ => return None,
            };
            let bounds = ap.get(1)?.as_list()?.to_vec();
            let loops = build_loops3d(sf, &bounds, tp, &mut stats.unsupported_curves);
            (frame, loops)
        }
        _ => return None,
    };
    if loops.is_empty() {
        return None;
    }
    // the wall strips walk consecutive point pairs, so every loop must be
    // explicitly closed (first point repeated at the end) — face-bound loops
    // from build_loops3d are not
    let loops: Vec<Loop3> = loops
        .into_iter()
        .map(|mut l| {
            if l.pts.len() >= 2 && l.pts.first() != l.pts.last() {
                l.pts.push(l.pts[0]);
            }
            l
        })
        .collect();

    let mesh = out.bucket(color);

    // one flat-shaded wall quad (two triangles, four dedicated vertices)
    let quad = |mesh: &mut TriMesh, a: V3, b: V3, c: V3, d: V3| {
        let n = b.sub(a).cross(d.sub(a));
        if n.len() < 1e-30 {
            return;
        }
        let n = n.norm();
        let base = mesh.vertex_count() as u32;
        for q in [a, b, c, d] {
            mesh.push_vertex(q, n);
        }
        mesh.indices
            .extend_from_slice(&[base, base + 1, base + 2, base, base + 2, base + 3]);
    };

    if ty.starts_with("EXTRUDED") {
        // ('', swept_area | swept_face, extruded_direction, depth)
        let dir = model::direction(sf, p.get(2)?.as_ref_id()?)?.norm();
        let depth = p.get(3)?.as_f64()?;
        let v = dir.scale(depth);
        let sgn = frame.z.dot(v);

        // caps: profile plane and its translate; same_sense picks the outward
        // normal (away from the solid on each side)
        let _ = face_to_mesh(&Surface::Plane(frame), &loops, tp, sgn < 0.0, mesh);
        let top_frame = Frame {
            o: frame.o.add(v),
            ..frame
        };
        let top: Vec<Loop3> = loops
            .iter()
            .map(|l| Loop3 {
                pts: l.pts.iter().map(|q| q.add(v)).collect(),
            })
            .collect();
        let _ = face_to_mesh(&Surface::Plane(top_frame), &top, tp, sgn > 0.0, mesh);

        for l in &loops {
            for w in l.pts.windows(2) {
                quad(mesh, w[0], w[1], w[1].add(v), w[0].add(v));
            }
        }
    } else {
        // REVOLVED_AREA/FACE_SOLID ('', profile, axis AXIS1_PLACEMENT, angle)
        let axis = model::axis1_placement(sf, p.get(2)?.as_ref_id()?)?;
        let angle = p.get(3)?.as_f64()? * model::file_plane_angle_scale(sf);
        if angle == 0.0 {
            return None;
        }
        let rot = |q: V3, t: f64| -> V3 {
            let d = q.sub(axis.o);
            let (c, s) = (t.cos(), t.sin());
            let px = d.dot(axis.x);
            let py = d.dot(axis.y);
            let pz = d.dot(axis.z);
            axis.o
                .add(axis.x.scale(px * c - py * s))
                .add(axis.y.scale(px * s + py * c))
                .add(axis.z.scale(pz))
        };
        let rmax = loops
            .iter()
            .flat_map(|l| l.pts.iter())
            .map(|q| {
                let d = q.sub(axis.o);
                d.sub(axis.z.scale(d.dot(axis.z))).len()
            })
            .fold(0.0f64, f64::max);
        let step = angle_step(rmax.max(1e-9), tp.deflection, tp.max_angle);
        let nseg = ((angle.abs() / step).ceil() as usize).clamp(2, 720);
        let full = angle.abs() >= std::f64::consts::TAU * (1.0 - 1e-9);

        if !full {
            // start / end caps on the profile plane and its rotated copy
            let _ = face_to_mesh(&Surface::Plane(frame), &loops, tp, true, mesh);
            let rot_dir = |d: V3| rot(axis.o.add(d), angle).sub(axis.o);
            let end_frame = Frame {
                o: rot(frame.o, angle),
                x: rot_dir(frame.x),
                y: rot_dir(frame.y),
                z: rot_dir(frame.z),
            };
            let end: Vec<Loop3> = loops
                .iter()
                .map(|l| Loop3 {
                    pts: l.pts.iter().map(|q| rot(*q, angle)).collect(),
                })
                .collect();
            let _ = face_to_mesh(&Surface::Plane(end_frame), &end, tp, true, mesh);
        }

        for l in &loops {
            for w in l.pts.windows(2) {
                for k in 0..nseg {
                    let t0 = angle * k as f64 / nseg as f64;
                    let t1 = angle * (k + 1) as f64 / nseg as f64;
                    quad(
                        mesh,
                        rot(w[0], t0),
                        rot(w[1], t0),
                        rot(w[1], t1),
                        rot(w[0], t1),
                    );
                }
            }
        }
    }

    Some(!mesh.is_empty())
}

/// Emit a `GEOMETRIC_CURVE_SET` / `GEOMETRIC_SET` as wireframe: discretize each
/// bounded curve element into a glTF LINE polyline (a single line bucket for the
/// set's colour). Points and untrimmed surfaces in the set carry no displayable
/// curve and are skipped; unbounded/unsupported curves are tallied as usual.
fn tessellate_curve_set(
    cx: &Ctx,
    id: u32,
    color: Option<[f32; 4]>,
    out: &mut MeshSet,
    stats: &mut TessStats,
) {
    let sf = cx.sf;
    // GEOMETRIC_SET('', (elements))
    let elems: Vec<u32> = sf
        .params(id)
        .and_then(|p| p.get(1).and_then(|v| v.as_list()).map(|l| l.to_vec()))
        .unwrap_or_default()
        .iter()
        .filter_map(|v| v.as_ref_id())
        .collect();
    let mesh = out.line_bucket(color);
    for e in elems {
        if let Some(poly) = model::curve_to_polyline(sf, e, cx.tp, &mut stats.unsupported_curves) {
            mesh.push_polyline(&poly);
        }
    }
}

/// Granularity at which `--split` breaks a part's geometry into separate nodes,
/// a debugging aid for locating a bad piece in a viewer.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum SplitLevel {
    /// one node per solid item (`MANIFOLD_SOLID_BREP`, …; a shell-model's
    /// shells count individually)
    Solid,
    /// one node per `CLOSED_SHELL` / `OPEN_SHELL` (brep voids included)
    Shell,
    /// one node per `ADVANCED_FACE` — the finest, to pinpoint a single face
    Face,
}

/// Geometry coverage: how many B-rep faces in the file are reachable from the
/// product/representation graph, vs left unreferenced. Faces that are reached
/// but can't be meshed are already tallied in [`TessStats`] (failed /
/// unsupported); this catches the *other* failure mode — faces present in the
/// file that no product points at, so they silently never reach tessellation
/// (an unfollowed representation link, or orphan/loose geometry).
pub struct Coverage {
    /// distinct `ADVANCED_FACE` + `FACE_SURFACE` entities in the file
    pub file_faces: usize,
    /// distinct file faces reachable from some product's shape representation
    pub reached_faces: usize,
    /// file faces no product reaches, ascending — the silent-miss set
    pub unreached: Vec<u32>,
}

/// Compute [`Coverage`] by walking each product's shape-representation items
/// with [`split_units`] (the same traversal tessellation uses) and collecting
/// the faces reached — no tessellation, so it is cheap. With no product
/// structure the converter's fallback meshes all loose geometry, so every face
/// counts as reached.
pub fn geometry_coverage(sf: &StepFile, asm: &crate::hierarchy::Assembly) -> Coverage {
    use std::collections::HashSet;
    let mut all: HashSet<u32> = HashSet::new();
    for ty in ["ADVANCED_FACE", "FACE_SURFACE"] {
        all.extend(sf.of_type(ty).iter().copied());
    }

    let mut reached: HashSet<u32> = HashSet::new();
    if asm.products.is_empty() || asm.roots.is_empty() {
        // no product structure → the fallback meshes all loose geometry
        reached = all.clone();
    } else {
        for node in asm.products.values() {
            for &sr in &node.shape_reps {
                if let Some(p) = sf.params(sr) {
                    if let Some(list) = p.get(1).and_then(|v| v.as_list()) {
                        for it in list {
                            if let Some(r) = it.as_ref_id() {
                                for f in split_units(sf, r, SplitLevel::Face) {
                                    reached.insert(f);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let reached_faces = all.iter().filter(|f| reached.contains(f)).count();
    let mut unreached: Vec<u32> = all
        .iter()
        .filter(|f| !reached.contains(f))
        .copied()
        .collect();
    unreached.sort_unstable();
    Coverage {
        file_faces: all.len(),
        reached_faces,
        unreached,
    }
}

/// Enumerate the geometry entities under top-level representation `item` at the
/// given split granularity, each of which [`tessellate_item`] can mesh on its
/// own. Returns entity ids whose `entity_type` + `#id` make a debuggable node
/// name that cross-references the source (and `--filter #id --extract-step`).
pub fn split_units(sf: &StepFile, item: u32, level: SplitLevel) -> Vec<u32> {
    let ty = match sf.entity_type(item) {
        Some(t) => t,
        None => return vec![],
    };
    let shells_of = |solid: u32| -> Vec<u32> {
        // outer shell (param 1) plus any BREP_WITH_VOIDS void shells (param 2)
        let mut v = vec![];
        if let Some(p) = sf.params(solid) {
            if let Some(s) = p.get(1).and_then(|x| x.as_ref_id()) {
                v.push(resolve_oriented_shell(sf, s));
            }
            if ty == "BREP_WITH_VOIDS" {
                if let Some(voids) = p.get(2).and_then(|x| x.as_list()) {
                    v.extend(
                        voids
                            .iter()
                            .filter_map(|x| x.as_ref_id())
                            .map(|r| resolve_oriented_shell(sf, r)),
                    );
                }
            }
        }
        v
    };
    let model_shells = || -> Vec<u32> {
        let mut v = vec![];
        if let Some(p) = sf.params(item) {
            if let Some(list) = p.get(1).and_then(|x| x.as_list()) {
                for x in list {
                    if let Some(r) = x.as_ref_id() {
                        v.push(resolve_oriented_shell(sf, r));
                    }
                }
            }
        }
        v
    };
    let faces_of = |shell: u32| -> Vec<u32> {
        let mut v = vec![];
        if let Some(p) = sf.params(shell) {
            if let Some(list) = p.get(1).and_then(|x| x.as_list()) {
                v.extend(list.iter().filter_map(|x| x.as_ref_id()));
            }
        }
        v
    };
    let is_solid = matches!(
        ty,
        "MANIFOLD_SOLID_BREP" | "FACETED_BREP" | "BREP_WITH_VOIDS"
    );
    let is_model = matches!(ty, "SHELL_BASED_SURFACE_MODEL" | "FACE_BASED_SURFACE_MODEL");
    match level {
        SplitLevel::Solid => {
            if is_model {
                model_shells()
            } else {
                vec![item]
            }
        }
        SplitLevel::Shell => {
            if is_solid {
                shells_of(item)
            } else if is_model {
                model_shells()
            } else if matches!(ty, "CLOSED_SHELL" | "OPEN_SHELL" | "ORIENTED_CLOSED_SHELL") {
                vec![resolve_oriented_shell(sf, item)]
            } else {
                vec![item]
            }
        }
        SplitLevel::Face => {
            let shells = if is_solid {
                shells_of(item)
            } else if is_model {
                model_shells()
            } else {
                vec![item]
            };
            let mut faces = vec![];
            for s in shells {
                match sf.entity_type(s) {
                    Some("CLOSED_SHELL") | Some("OPEN_SHELL") => faces.extend(faces_of(s)),
                    Some("ADVANCED_FACE") | Some("FACE_SURFACE") => faces.push(s),
                    _ => faces.push(s),
                }
            }
            faces
        }
    }
}

fn resolve_oriented_shell(sf: &StepFile, id: u32) -> u32 {
    if sf.entity_type(id) == Some("ORIENTED_CLOSED_SHELL") {
        if let Some(p) = sf.params(id) {
            if let Some(r) = p.get(2).and_then(|v| v.as_ref_id()) {
                return r;
            }
        }
    }
    id
}

fn tessellate_shell(
    cx: &Ctx,
    shell: u32,
    inherited: Option<[f32; 4]>,
    out: &mut MeshSet,
    stats: &mut TessStats,
) {
    let p = match cx.sf.params(shell) {
        Some(p) => p,
        None => return,
    };
    let faces = match p.get(1).and_then(|v| v.as_list()) {
        Some(f) => f.to_vec(),
        None => return,
    };
    let color = cx.color_of(shell, inherited);
    let ids: Vec<u32> = faces.iter().filter_map(|f| f.as_ref_id()).collect();
    tessellate_faces(cx, &ids, color, out, stats);
}

/// Tessellate faces, fanning out over `cx.threads` workers. Each face fills
/// its own mesh/stats; results merge in face order, so the output is
/// byte-identical to the serial path regardless of thread count.
fn tessellate_faces(
    cx: &Ctx,
    faces: &[u32],
    color: Option<[f32; 4]>,
    out: &mut MeshSet,
    stats: &mut TessStats,
) {
    if cx.threads <= 1 || faces.len() < 2 {
        for &fid in faces {
            tessellate_face(cx, fid, color, out, stats);
        }
        return;
    }
    let next = std::sync::atomic::AtomicUsize::new(0);
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::scope(|s| {
        for _ in 0..cx.threads.min(faces.len()) {
            let tx = tx.clone();
            let next = &next;
            s.spawn(move || loop {
                let i = next.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                if i >= faces.len() {
                    break;
                }
                let mut m = MeshSet::default();
                let mut st = TessStats::default();
                tessellate_face(cx, faces[i], color, &mut m, &mut st);
                if tx.send((i, m, st)).is_err() {
                    break;
                }
            });
        }
        drop(tx);
        let mut results: Vec<Option<(MeshSet, TessStats)>> =
            (0..faces.len()).map(|_| None).collect();
        for (i, m, st) in rx {
            results[i] = Some((m, st));
        }
        for r in results.into_iter().flatten() {
            out.append(&r.0);
            stats.merge(&r.1);
        }
    });
}

// --------------------------------------------------------------------- face

/// One boundary loop in 3D plus the orientation it carries in the file.
#[derive(Clone)]
struct Loop3 {
    /// boundary polyline with FACE_BOUND orientation already applied
    pts: Vec<V3>,
}

fn tessellate_face(
    cx: &Ctx,
    face: u32,
    inherited: Option<[f32; 4]>,
    out: &mut MeshSet,
    stats: &mut TessStats,
) {
    let sf = cx.sf;
    let tp = cx.tp;
    // ADVANCED_FACE('', (bounds), surface, same_sense)
    let p = match sf.params(face) {
        Some(p) => p,
        None => return,
    };
    let bounds = match p.get(1).and_then(|v| v.as_list()) {
        Some(b) => b.to_vec(),
        None => return,
    };
    let surf_id = match p.get(2).and_then(|v| v.as_ref_id()) {
        Some(s) => s,
        None => return,
    };
    let same_sense = p.get(3).and_then(|v| v.as_bool()).unwrap_or(true);
    let color = cx.color_of(face, inherited);
    let mesh = out.bucket(color);

    let surf = model::surface(sf, surf_id);

    let loops3d = build_loops3d(sf, &bounds, tp, &mut stats.unsupported_curves);
    if loops3d.is_empty() {
        if let Some(s) = &surf {
            // a RECTANGULAR_TRIMMED_SURFACE with no boundary loops: the u/v
            // window *is* the trim — synthesize its boundary loop
            if let Some(wl) = rts_window_loop(sf, surf_id, s, tp) {
                if face_to_mesh(s, &[wl], tp, same_sense, mesh).is_ok() {
                    stats.faces_ok += 1;
                    return;
                }
            }
            // full closed quadric with no bounds: tessellate the whole domain
            if tessellate_unbounded(s, tp, same_sense, mesh) {
                stats.faces_ok += 1;
                return;
            }
        }
        // A boundary that discretized but collapses to no area (e.g. a sliver
        // face bounded by one edge whose two ends are the same vertex) is a
        // degenerate face carrying zero surface — skip it quietly, don't flag a
        // tessellation failure. A boundary that produced nothing at all (an
        // unsupported edge curve, already tallied) still falls through to the
        // failure report.
        if boundary_is_degenerate(sf, &bounds, tp) {
            stats.degenerate_faces += 1;
            return;
        }
        stats.faces_failed += 1;
        record_failed(
            stats,
            sf,
            surf_id,
            face,
            "no usable boundary loops (edge discretization failed or <3 points) \
             and not a closed quadric",
        );
        return;
    }

    let surf = match surf {
        Some(s) => s,
        None => {
            let tyname = surface_type_name(sf, surf_id);
            // Unknown surface: near-planar boundary fallback (POLY_LOOP breps)
            match fit_plane(&loops3d) {
                Some(pl) => {
                    // A real but unimplemented surface type (e.g.
                    // RECTANGULAR_TRIMMED_SURFACE, OFFSET_SURFACE) flattened to
                    // a plane through its boundary: the face survives but its
                    // curvature is lost — record it so it isn't silent. Genuine
                    // faceted breps (no SURFACE entity) legitimately use this
                    // path and are not flagged.
                    if tyname.contains("SURFACE") {
                        *stats.approximated_surfaces.entry(tyname).or_insert(0) += 1;
                    }
                    pl
                }
                None => {
                    *stats.unsupported_surfaces.entry(tyname).or_insert(0) += 1;
                    stats.faces_failed += 1;
                    return;
                }
            }
        }
    };

    let cp = mesh.checkpoint();
    match face_to_mesh(&surf, &loops3d, tp, same_sense, mesh) {
        Ok(()) => stats.faces_ok += 1,
        Err(reason) => {
            // A "tess2 produced no triangles" failure on a thin curved face is
            // typically a self-intersecting boundary: arcs discretized at the
            // global deflection sag deeper than the face is thin, so adjacent
            // (near-concentric) boundary chords cross. Re-discretize the
            // boundary much finer and retry before giving up.
            if reason.contains("tess2") {
                mesh.rollback(cp);
                for div in [8.0_f64, 64.0] {
                    let fine = TessParams {
                        deflection: (tp.deflection / div).max(1e-4),
                        max_angle: (tp.max_angle / div.sqrt()).max(0.02),
                    };
                    let fl = build_loops3d(sf, &bounds, &fine, &mut stats.unsupported_curves);
                    if fl.len() != loops3d.len() {
                        continue;
                    }
                    let cp2 = mesh.checkpoint();
                    if face_to_mesh(&surf, &fl, &fine, same_sense, mesh).is_ok() {
                        stats.faces_ok += 1;
                        return;
                    }
                    mesh.rollback(cp2);
                }
            }
            // A planar face whose declared surface trips the trimmer: a PLANE
            // whose explicit POLY_LOOP polygon doesn't lie on it (a faceted
            // export quirk — sometimes an orthogonal PLANE — so the boundary
            // projects to a degenerate UV "slit"), or a flat degree-1 B-spline
            // patch whose 24-edge boundary self-intersects under Newton UV
            // inversion. The boundary is the authoritative geometry, so re-fit
            // the plane to the loop points and tessellate that, taking
            // orientation from the polygon winding.
            if surface_is_planar(&surf) {
                mesh.rollback(cp);
                if let Some(fitted) = fit_plane(&loops3d) {
                    if face_to_mesh(&fitted, &loops3d, tp, true, mesh).is_ok() {
                        stats.faces_ok += 1;
                        return;
                    }
                }
                mesh.rollback(cp);
            }
            // A boundary that encloses no area — out-and-back slit spokes, two
            // coincident edges between the same vertices — is a degenerate face
            // carrying zero surface, not a tessellation failure. (Checked after
            // the planar re-fit, so a real face that merely *projected* to a
            // slit on a wrong declared plane was already recovered above.)
            if boundary_is_degenerate(sf, &bounds, tp) {
                stats.degenerate_faces += 1;
                return;
            }
            stats.faces_failed += 1;
            record_failed(stats, sf, surf_id, face, reason);
        }
    }
}

/// Discretize every FACE_BOUND of a face into 3D boundary polylines at the
/// given tessellation tolerance (orientation already applied).
fn build_loops3d(
    sf: &StepFile,
    bounds: &[crate::step::P],
    tp: &TessParams,
    unsup: &mut HashMap<String, usize>,
) -> Vec<Loop3> {
    let mut loops3d: Vec<Loop3> = Vec::new();
    for b in bounds {
        let bid = match b.as_ref_id() {
            Some(b) => b,
            None => continue,
        };
        // FACE_BOUND / FACE_OUTER_BOUND ('', loop, orientation)
        let bp = match sf.params(bid) {
            Some(bp) => bp,
            None => continue,
        };
        let loop_id = match bp.get(1).and_then(|v| v.as_ref_id()) {
            Some(l) => l,
            None => continue,
        };
        let orientation = bp.get(2).and_then(|v| v.as_bool()).unwrap_or(true);
        if let Some(mut lp) = loop_polyline(sf, loop_id, tp, unsup) {
            if lp.len() >= 3 {
                if !orientation {
                    lp.reverse();
                }
                loops3d.push(Loop3 { pts: lp });
            }
        }
    }
    loops3d
}

/// True if a face's boundary discretized to points but encloses no area — fewer
/// than 3 distinct boundary points across all its bounds. The canonical case is
/// a sliver face bounded by one edge whose start and end vertex coincide (a
/// straight LINE cannot close on itself with any area), which CAD kernels emit
/// from boolean operations. Distinct from a boundary that produced *nothing* (an
/// unsupported curve): there we get no points and report a real failure.
fn boundary_is_degenerate(sf: &StepFile, bounds: &[crate::step::P], tp: &TessParams) -> bool {
    let mut sink = HashMap::new();
    let mut pts: Vec<V3> = Vec::new();
    // sum of |signed area| over the loops, via Newell's formula centred on each
    // loop's centroid (absolute coordinates far from the origin would swamp the
    // cross products) — robust to non-planar loops.
    let mut area = 0.0;
    for b in bounds {
        let bid = match b.as_ref_id() {
            Some(b) => b,
            None => continue,
        };
        let loop_id = sf
            .params(bid)
            .and_then(|bp| bp.get(1).and_then(|v| v.as_ref_id()));
        if let Some(lid) = loop_id {
            if let Some(lp) = loop_polyline(sf, lid, tp, &mut sink) {
                if lp.len() >= 3 {
                    let c = lp
                        .iter()
                        .fold(V3::ZERO, |s, p| s.add(*p))
                        .scale(1.0 / lp.len() as f64);
                    let mut n = V3::ZERO;
                    for i in 0..lp.len() {
                        n = n.add(lp[i].sub(c).cross(lp[(i + 1) % lp.len()].sub(c)));
                    }
                    area += n.len() * 0.5;
                }
                pts.extend_from_slice(&lp);
            }
        }
    }
    if pts.is_empty() {
        return false; // nothing discretized — not "degenerate", just absent
    }
    // bbox diagonal as the length scale for a scale-free area threshold
    let (mut lo, mut hi) = (pts[0], pts[0]);
    for p in &pts {
        lo = v3(lo.x.min(p.x), lo.y.min(p.y), lo.z.min(p.z));
        hi = v3(hi.x.max(p.x), hi.y.max(p.y), hi.z.max(p.z));
    }
    let diag = hi.sub(lo).len();
    // a boundary that encloses ~no area — slit spokes, out-and-back edges — is a
    // degenerate face carrying zero surface (a real face's area is O(diag²))
    if diag > 0.0 && area < 1e-6 * diag * diag {
        return true;
    }
    let eps = 1e-7 * pts.iter().fold(1.0_f64, |m, p| m.max(p.len()));
    let mut distinct: Vec<V3> = Vec::new();
    for p in &pts {
        if !distinct.iter().any(|q| q.sub(*p).len() < eps) {
            distinct.push(*p);
        }
    }
    distinct.len() < 3
}

/// Track a failed face: per-surface-type count plus a few sample face ids so
/// the offending entities can be looked up in the STEP file. The first face of
/// each type also records the failing stage for `--debug-print`.
fn record_failed(
    stats: &mut TessStats,
    sf: &StepFile,
    surf_id: u32,
    face: u32,
    reason: &'static str,
) {
    let ty = surface_type_name(sf, surf_id);
    stats
        .debug_samples
        .entry(ty.clone())
        .or_insert((face, reason));
    let e = stats.failed_surfaces.entry(ty).or_insert((0, Vec::new()));
    e.0 += 1;
    if e.1.len() < 5 {
        e.1.push(face);
    }
}

/// STEP type name of a surface entity, resolving complex instances to their
/// most specific SURFACE leaf.
fn surface_type_name(sf: &StepFile, surf_id: u32) -> String {
    match sf.entity_type(surf_id) {
        Some(crate::step::TYPE_COMPLEX) => {
            let leaves = sf.complex_leaf_names(surf_id);
            leaves
                .iter()
                .find(|l| l.contains("SURFACE") && !l.contains("BOUNDED"))
                .cloned()
                .unwrap_or_else(|| leaves.join("+"))
        }
        Some(t) => t.to_string(),
        None => "?".to_string(),
    }
}

fn loop_polyline(
    sf: &StepFile,
    loop_id: u32,
    tp: &TessParams,
    unsup: &mut HashMap<String, usize>,
) -> Option<Vec<V3>> {
    let ty = sf.entity_type(loop_id)?;
    match ty {
        "EDGE_LOOP" => {
            let p = sf.params(loop_id)?;
            let edges = p.get(1)?.as_list()?;
            let mut pts: Vec<V3> = Vec::new();
            for e in edges {
                let eid = e.as_ref_id()?;
                let ep = model::edge_polyline(sf, eid, tp, unsup)?;
                let skip = usize::from(
                    !pts.is_empty()
                        && pts
                            .last()
                            .map(|l| l.sub(ep[0]).len() < 1e-9)
                            .unwrap_or(false),
                );
                pts.extend_from_slice(&ep[skip..]);
            }
            if pts.len() > 1 && pts[0].sub(*pts.last().unwrap()).len() < 1e-9 {
                pts.pop();
            }
            Some(pts)
        }
        "POLY_LOOP" => {
            let p = sf.params(loop_id)?;
            let pts: Vec<V3> = p
                .get(1)?
                .as_list()?
                .iter()
                .filter_map(|v| v.as_ref_id())
                .filter_map(|r| model::cartesian_point(sf, r))
                .collect();
            Some(pts)
        }
        "VERTEX_LOOP" => Some(Vec::new()),
        _ => None,
    }
}

/// Newell-plane fit fallback for faces with unknown surface types.
/// Is this surface geometrically a plane? True for an explicit `PLANE`, and for
/// a B-spline whose control points are all coplanar — by the convex-hull
/// property the whole surface then lies in that plane (CAD commonly emits a flat
/// region as a degree-1 patch). Used to let a planar face recover via
/// `fit_plane` when its declared surface trips the trimmer.
fn surface_is_planar(surf: &Surface) -> bool {
    match surf {
        Surface::Plane(_) => true,
        Surface::BSpline(b) => {
            let cps = &b.cps;
            if cps.len() < 3 {
                return true; // a point/line control net is (degenerately) planar
            }
            let o = cps[0];
            let a = cps
                .iter()
                .copied()
                .max_by(|p, q| o.sub(*p).len().total_cmp(&o.sub(*q).len()))
                .unwrap();
            let da = a.sub(o);
            if da.len() < 1e-9 {
                return true;
            }
            // normal = the control point furthest off the o–a line
            let mut normal = V3::ZERO;
            for p in cps {
                let n = da.cross(p.sub(o));
                if n.len() > normal.len() {
                    normal = n;
                }
            }
            if normal.len() < 1e-12 {
                return true; // all control points collinear
            }
            let n = normal.norm();
            let span = cps.iter().map(|p| p.sub(o).len()).fold(0.0_f64, f64::max);
            cps.iter()
                .all(|p| p.sub(o).dot(n).abs() <= 1e-3 * span + 1e-6)
        }
        _ => false,
    }
}

fn fit_plane(loops: &[Loop3]) -> Option<Surface> {
    let outer = &loops.first()?.pts;
    if outer.len() < 3 {
        return None;
    }
    let mut n = V3::ZERO;
    let mut c = V3::ZERO;
    for i in 0..outer.len() {
        let a = outer[i];
        let b = outer[(i + 1) % outer.len()];
        n = n.add(v3(
            (a.y - b.y) * (a.z + b.z),
            (a.z - b.z) * (a.x + b.x),
            (a.x - b.x) * (a.y + b.y),
        ));
        c = c.add(a);
    }
    if n.len() < 1e-12 {
        return None;
    }
    let n = n.norm();
    let c = c.scale(1.0 / outer.len() as f64);
    let mut span: f64 = 0.0;
    let mut dev: f64 = 0.0;
    for l in loops {
        for p in &l.pts {
            dev = dev.max((p.sub(c).dot(n)).abs());
            span = span.max(p.sub(c).len());
        }
    }
    if dev > 1e-3 * span.max(1e-9) + 1e-6 {
        return None;
    }
    Some(Surface::Plane(Frame::new(c, Some(n), None)))
}

// ------------------------------------------------------------ UV tess + map

/// Per-loop UV polyline plus winding bookkeeping.
struct LoopUv {
    uv: Vec<[f64; 2]>,
    /// net winding around the u period (0 for ordinary loops)
    w: i32,
    /// net winding around the v period (tube end-circles on a torus wind here)
    wv: i32,
    /// interior of the face is on the +v side of this (winding) loop
    interior_above: bool,
}

fn face_to_mesh(
    surf: &Surface,
    loops3d: &[Loop3],
    tp: &TessParams,
    same_sense: bool,
    mesh: &mut TriMesh,
) -> Result<(), &'static str> {
    // Reject a face whose boundary doesn't lie on its (quadric) surface — a
    // malformed export where an edge from an adjacent face on a *different*
    // surface leaks into this loop (seen in the wild: a radius-3.5 cylinder
    // face whose loop carries a circle centred ~1400 units away). On a quadric
    // the UV inverse is exact, so a point far off the surface is unambiguous;
    // projecting it would map the stray edge to a wild parameter and explode
    // the face into a spike. Tolerance is the surface's own size — orders of
    // magnitude above any real vertex/tolerance slop, so valid faces pass.
    // The floor for near-degenerate surfaces is the tessellation deflection
    // (already expressed in the file's length unit), not an absolute 1.0:
    // a metre-unit file would otherwise clamp the tolerance to a full metre
    // and let the malformed-edge spikes this guard exists for sail through.
    let salvaged: Vec<Loop3>;
    let mut loops3d = loops3d;
    if surf.is_quadric() {
        let tol = surf.approx_size().max(tp.deflection);
        let off_surface = |l: &Loop3| l.pts.iter().any(|&p| surf.point_residual(p) > tol);
        if loops3d.iter().any(off_surface) {
            // salvage: when only *some* loops are poisoned (an edge from an
            // adjacent face leaked into an inner bound), drop those loops and
            // keep the face; only an entirely-poisoned boundary is rejected
            salvaged = loops3d
                .iter()
                .filter(|l| !off_surface(l))
                .cloned()
                .collect();
            if salvaged.is_empty() {
                return Err("face boundary does not lie on its surface (malformed)");
            }
            loops3d = &salvaged;
        }
    }

    let per_u = surf.u_period();
    let per_v = surf.v_period();

    // 3D positions of parameterization singularities (cone apex, sphere
    // poles): boundary points there carry no u information of their own.
    let eps_cap = 1e-7 * surf.approx_size().max(1.0);
    let cap_pts: Vec<crate::geom::V3> = match (per_u, surf.v_caps()) {
        (Some(_), Some((vb, vt))) => [vb, vt]
            .iter()
            .filter(|v| v.is_finite())
            .map(|&v| surf.point(0.0, v))
            .collect(),
        _ => Vec::new(),
    };
    let singular = |p: crate::geom::V3| cap_pts.iter().any(|c| p.sub(*c).len() < eps_cap);

    // 1) map loops to UV with periodic unwrapping; Newton surfaces are seeded
    // from the previous boundary point for continuity and speed.
    let mut loops_uv: Vec<LoopUv> = Vec::new();
    let mut u_ref: Option<f64> = None;
    for l in loops3d {
        // start each loop off-singularity, so a singular point's u (taken
        // from the uv() hint) is the u of its incoming boundary edge
        let n = l.pts.len();
        let start = (0..n).find(|&i| !singular(l.pts[i])).unwrap_or(0);
        let pts: Vec<crate::geom::V3> = (0..n).map(|i| l.pts[(start + i) % n]).collect();

        let mut uv: Vec<[f64; 2]> = Vec::with_capacity(n);
        let mut sing: Vec<bool> = Vec::with_capacity(n);
        let mut hint: Option<(f64, f64)> = None;
        for (i, p) in pts.iter().enumerate() {
            let (mut u, mut v) = surf.uv(*p, hint);
            hint = Some((u, v));
            if i > 0 {
                let pu = uv[i - 1][0];
                let pv = uv[i - 1][1];
                if let Some(per) = per_u {
                    while u - pu > per / 2.0 {
                        u -= per;
                    }
                    while pu - u > per / 2.0 {
                        u += per;
                    }
                }
                if let Some(per) = per_v {
                    while v - pv > per / 2.0 {
                        v -= per;
                    }
                    while pv - v > per / 2.0 {
                        v += per;
                    }
                }
            }
            uv.push([u, v]);
            sing.push(singular(*p));
        }
        // A singular point belongs to both adjacent meridians: walk the cap
        // line from the incoming edge's u to the outgoing edge's u (sampled
        // at the u step, like the periodic-band polar caps, so the polar fan
        // triangulates cleanly) instead of cutting diagonally across the
        // domain.
        if let Some(per) = per_u {
            if sing.iter().any(|&s| s) {
                let du = surf.u_step(tp.deflection, tp.max_angle);
                let mut out: Vec<[f64; 2]> = Vec::with_capacity(uv.len() + 8);
                for i in 0..uv.len() {
                    out.push(uv[i]);
                    if sing[i] {
                        let pu = uv[i][0];
                        let mut nu = uv[(i + 1) % uv.len()][0];
                        while nu - pu > per / 2.0 {
                            nu -= per;
                        }
                        while pu - nu > per / 2.0 {
                            nu += per;
                        }
                        let steps = (((nu - pu).abs() / du).ceil() as usize).clamp(1, 256);
                        for k in 1..=steps {
                            out.push([pu + (nu - pu) * k as f64 / steps as f64, uv[i][1]]);
                        }
                    }
                }
                uv = out;
            }
        }
        // net winding around u: unwrap the implicit closing edge back to p0
        let w = match per_u {
            Some(per) if uv.len() >= 3 => {
                let mut uc = uv[0][0];
                let last = uv[uv.len() - 1][0];
                while uc - last > per / 2.0 {
                    uc -= per;
                }
                while last - uc > per / 2.0 {
                    uc += per;
                }
                ((uc - uv[0][0]) / per).round() as i32
            }
            _ => 0,
        };
        // net winding around v (same construction, the other axis)
        let wv = match per_v {
            Some(per) if uv.len() >= 3 => {
                let mut vc = uv[0][1];
                let last = uv[uv.len() - 1][1];
                while vc - last > per / 2.0 {
                    vc -= per;
                }
                while last - vc > per / 2.0 {
                    vc += per;
                }
                ((vc - uv[0][1]) / per).round() as i32
            }
            _ => 0,
        };
        // With the face normal = surface normal * same_sense, boundary loops
        // run counter-clockwise around the interior in UV iff same_sense.
        // For a loop winding in +u, "interior on the left" means +v.
        let interior_above = (w > 0) == same_sense;
        // align non-winding loops with each other in the periodic direction
        if let Some(per) = per_u {
            if w == 0 {
                let mean: f64 = uv.iter().map(|p| p[0]).sum::<f64>() / uv.len().max(1) as f64;
                match u_ref {
                    None => u_ref = Some(mean),
                    Some(r) => {
                        let shift = ((mean - r) / per).round() * per;
                        if shift != 0.0 {
                            for p in &mut uv {
                                p[0] -= shift;
                            }
                        }
                    }
                }
            }
        }
        loops_uv.push(LoopUv {
            uv,
            w,
            wv,
            interior_above,
        });
    }

    // A boundary whose unwrapped UV polygon encloses (next to) no area is a
    // seam "slit" — an edge walked out and back. Some exporters write a full
    // closed surface as a single face bounded only by such a slit; tessellate
    // the whole domain instead. (Tested in UV, not 3D: a one-loop cylinder
    // band legitimately cancels in 3D but is a real rectangle in UV.)
    let uv_slit = |l: &LoopUv| -> bool {
        if l.w != 0 || l.wv != 0 {
            return false;
        }
        let mut area = 0.0;
        let mut per = 0.0;
        for i in 0..l.uv.len() {
            let a = l.uv[i];
            let b = l.uv[(i + 1) % l.uv.len()];
            area += a[0] * b[1] - b[0] * a[1];
            per += ((b[0] - a[0]).powi(2) + (b[1] - a[1]).powi(2)).sqrt();
        }
        area.abs() * 0.5 < 1e-9 * per * per
    };
    // Loops that wind the *v* period with no u-wind — the tube end-circles of
    // a torus elbow (cable/pipe bends): the face is a band in u between
    // consecutive v-winding circles, spanning the full v period. Without this
    // the circles unwrap to zero-area UV polylines, read as seam slits, and
    // the whole closed surface (a full donut) is emitted instead of the elbow.
    if loops_uv.iter().any(|l| l.wv != 0) && loops_uv.iter().all(|l| l.w == 0) {
        let cp = mesh.checkpoint();
        if tessellate_periodic_band_v(surf, &loops_uv, tp, same_sense, mesh) {
            return Ok(());
        }
        mesh.rollback(cp);
        // a closed-in-v B-spline pipe whose end circles sit at the knot
        // extremes: the full knot domain *is* the face (the domain is bounded,
        // unlike a torus, so this cannot over-fill a whole donut)
        if matches!(surf, Surface::BSpline(_)) && tessellate_unbounded(surf, tp, same_sense, mesh) {
            return Ok(());
        }
        mesh.rollback(cp);
        return Err("v-winding band (tube segment) tessellation failed");
    }

    if loops_uv.iter().all(uv_slit) {
        return ok_or(
            tessellate_unbounded(surf, tp, same_sense, mesh),
            "slit/full-surface tessellation failed (surface not closed-form invertible)",
        );
    }

    // A closed (periodic) B-spline whose single boundary loop spans the whole
    // domain is the entire *capped* surface — a cone/dome whose apex row of
    // control points collapses to a point (a parametric pole, the NURBS way of
    // building a sphere/cone tip), cut open by a radial seam. The seam makes
    // the lone loop wind once (w=±1), so it would enter the periodic-band path
    // below; but that path expects a clean iso-v circle to pair against a cap
    // line, not a loop that also dives down the seam to the pole, and a B-spline
    // has no analytic v_caps() for it to synthesize the cap from. Grid the full
    // domain instead (fold-free; the collapsed row yields zero-area triangles at
    // the tip that cleanup drops). Gated on a single loop, so there is no
    // interior hole to over-fill, and on an actual degenerate pole, so genuine
    // uncapped bands still take the periodic-band path.
    if loops_uv.len() == 1 && bspline_has_v_pole(surf) {
        let contour = [loops_uv[0].uv.clone()];
        if let Some((uu, vv)) = full_wrap_bspline(surf, &contour) {
            if tessellate_uv_grid(surf, uu, vv, tp, same_sense, mesh) {
                return Ok(());
            }
        }
    }

    if loops_uv.iter().any(|l| l.w != 0) {
        // The band path models a winding curve as an iso-v latitude line (paired
        // with another or a polar cap). A single winding loop that also spans a
        // v-range — it carries the winding edge (a full circle / meridian) plus
        // axial/spanning edges — isn't that shape, so fall back to closing it
        // against the surface's v-extent on the interior side (see
        // tessellate_periodic_winding). Roll the mesh back first so a partial
        // band emit doesn't leak.
        let cp = mesh.checkpoint();
        if tessellate_periodic_band(surf, &loops_uv, tp, same_sense, mesh) {
            return Ok(());
        }
        mesh.rollback(cp);
        return ok_or(
            tessellate_periodic_winding(surf, &loops_uv, tp, same_sense, mesh),
            "periodic-band (wrap-around) tessellation failed \
             (multi-winding loop or seam reconstruction)",
        );
    }

    let contours: Vec<Vec<[f64; 2]>> = loops_uv.into_iter().map(|l| l.uv).collect();

    // A periodic (closed) B-spline whose boundary wraps the whole surface — a
    // coil tube etc. — covers the full period in the closed direction (winding
    // around it, which the single-winding detector misses for |w|>1) and the
    // full extent in the other. The face is then the whole closed surface, so
    // grid the full domain (fold-free) rather than tess2-fold the multi-winding
    // contour. Checked before the seam-complement path, which would otherwise
    // mis-claim it (a stray short loop reads as a non-nesting "bite").
    if let Some((uu, vv)) = full_wrap_bspline(surf, &contours) {
        if tessellate_uv_grid(surf, uu, vv, tp, same_sense, mesh) {
            return Ok(());
        }
    }

    // Seam-straddling "long way around" faces. On a u-periodic surface a
    // non-winding outer loop can enclose the *short* side of the seam while the
    // face interior is the complement — most of the surface, e.g. a spherical
    // ball-joint with a bite where it meets its socket. The tell is an inner
    // loop that does not nest inside the outer one: impossible for a real hole,
    // so the interior must be the other side. Tessellate one full u-period band
    // minus every loop, which cuts the bite and the real holes alike and leaves
    // the wrap-around interior.
    if let Some(per) = per_u {
        if complement_interior(&contours) {
            return ok_or(
                tessellate_periodic_complement(surf, &contours, per, tp, same_sense, mesh),
                "periodic-complement (wrap-around interior) tessellation failed",
            );
        }
    }

    // Full-patch B-spline with an unreliable boundary: an extreme-aspect wound
    // strip (u≈1, v≈16000) is the whole parametric surface, but its boundary
    // projects (via Newton) to a self-intersecting UV polygon that tess2 folds
    // and explodes (50% inverted, 100s of thousands of triangles). When the
    // boundary spans the whole knot domain AND self-crosses, trust the surface
    // over the garbage boundary and grid the full domain — fold-free, and there
    // is no trim to over-fill. A clean trim (a simple polygon) is left alone.
    if let Some((uu, vv)) = full_domain_bspline(surf, &contours) {
        if poly_self_intersects(&contours[0])
            && tessellate_uv_grid(surf, uu, vv, tp, same_sense, mesh)
        {
            return Ok(());
        }
    }

    // A rectangular B-spline patch is meshed as a structured grid over its
    // parameter domain: the standard, fold-free way to tessellate a parametric
    // surface — every cell maps to a small (u,v) patch, so the mesh follows the
    // surface and never inverts. tess2's unstructured triangulation is reserved
    // for genuinely-trimmed faces (inner holes / non-rectangular boundaries),
    // where its long diagonal triangles can otherwise fold a twisted surface
    // over itself and shred it.
    if tessellate_full_patch(surf, &contours, tp, same_sense, mesh) {
        return Ok(());
    }
    ok_or(
        emit_uv_region(surf, &contours, tp, same_sense, mesh),
        "UV tessellation produced no triangles \
         (tess2 failed: degenerate or self-intersecting UV contour)",
    )
}

/// Even-odd point-in-polygon test in UV.
fn point_in_poly(pt: [f64; 2], poly: &[[f64; 2]]) -> bool {
    let mut inside = false;
    let mut j = poly.len().wrapping_sub(1);
    for i in 0..poly.len() {
        let (a, b) = (poly[i], poly[j]);
        if (a[1] > pt[1]) != (b[1] > pt[1]) {
            let x = a[0] + (pt[1] - a[1]) / (b[1] - a[1]) * (b[0] - a[0]);
            if pt[0] < x {
                inside = !inside;
            }
        }
        j = i;
    }
    inside
}

/// True when `contours` describe a wrap-around (complement) interior: more than
/// one loop, and some loop's centroid falls outside the largest loop — so it
/// cannot be a nested hole, and the face interior must be the other side of the
/// seam. `false` for the ordinary outer-boundary-plus-holes arrangement.
fn complement_interior(contours: &[Vec<[f64; 2]>]) -> bool {
    if contours.len() < 2 {
        return false;
    }
    let centroid = |c: &[[f64; 2]]| {
        let n = c.len().max(1) as f64;
        [
            c.iter().map(|p| p[0]).sum::<f64>() / n,
            c.iter().map(|p| p[1]).sum::<f64>() / n,
        ]
    };
    let outer = (0..contours.len())
        .max_by(|&a, &b| {
            poly_area(&contours[a])
                .abs()
                .total_cmp(&poly_area(&contours[b]).abs())
        })
        .unwrap();
    (0..contours.len())
        .any(|k| k != outer && !point_in_poly(centroid(&contours[k]), &contours[outer]))
}

/// Tessellate the wrap-around interior of a seam-straddling face: a single full
/// u-period band with every original loop cut out as a hole (odd winding). The
/// band's u-edges fall on the same 3D seam (periodic), so the surface closes;
/// its v-edges sit a hair outside the loops' v-extent, clamped just inside any
/// pole so the edge is a real parallel rather than the singular point.
fn tessellate_periodic_complement(
    surf: &Surface,
    contours: &[Vec<[f64; 2]>],
    per_u: f64,
    tp: &TessParams,
    same_sense: bool,
    mesh: &mut TriMesh,
) -> bool {
    let (mut umin, mut vmin, mut vmax) = (f64::MAX, f64::MAX, f64::MIN);
    for c in contours {
        for p in c {
            umin = umin.min(p[0]);
            vmin = vmin.min(p[1]);
            vmax = vmax.max(p[1]);
        }
    }
    // pad v so loops touching the extent don't lie exactly on the band edge
    // (degenerate for tess2); keep just inside a pole if the surface caps there
    let pad = (vmax - vmin) * 1e-3 + 1e-6;
    let (mut vlo, mut vhi) = (vmin - pad, vmax + pad);
    if let Some((cb, ct)) = surf.v_caps() {
        let m = 1e-4 * (vhi - vlo).abs().max(1.0);
        if cb.is_finite() {
            vlo = vlo.max(cb + m);
        }
        if ct.is_finite() {
            vhi = vhi.min(ct - m);
        }
    }
    let u0 = umin - 1e-6;
    let band = vec![[u0, vlo], [u0 + per_u, vlo], [u0 + per_u, vhi], [u0, vhi]];
    let mut all: Vec<Vec<[f64; 2]>> = Vec::with_capacity(contours.len() + 1);
    all.push(band);
    all.extend(contours.iter().cloned());
    emit_uv_region(surf, &all, tp, same_sense, mesh)
}

fn ok_or(success: bool, reason: &'static str) -> Result<(), &'static str> {
    if success {
        Ok(())
    } else {
        Err(reason)
    }
}

/// Signed area (shoelace) of a closed UV polygon.
fn poly_area(c: &[[f64; 2]]) -> f64 {
    let mut a = 0.0;
    for i in 0..c.len() {
        let p = c[i];
        let q = c[(i + 1) % c.len()];
        a += p[0] * q[1] - q[0] * p[1];
    }
    a * 0.5
}

/// Retry tess2 with the interior holes nudged inward toward their centroids. A
/// hole whose vertices lie exactly on a curved outer boundary (a polygon
/// inscribed in a circular rim, say) pokes through the boundary's discretized
/// chords, so the odd-winding contour self-intersects and tess2 bails. Shrinking
/// the holes a hair separates them from the rim; the recovered face is within a
/// fraction of the deflection of the true one — far better than dropping it.
fn tess2_with_shrunk_holes(loops_uv: &[Vec<[f64; 2]>], su: f64, sv: f64) -> Option<Tess2Out> {
    if loops_uv.len() < 2 {
        return None;
    }
    // the largest-area loop is the outer boundary; shrink every other loop
    let outer = (0..loops_uv.len()).max_by(|&a, &b| {
        poly_area(&loops_uv[a])
            .abs()
            .total_cmp(&poly_area(&loops_uv[b]).abs())
    })?;
    for &frac in &[0.01_f64, 0.04, 0.1] {
        let shrunk: Vec<Vec<[f64; 2]>> = loops_uv
            .iter()
            .enumerate()
            .map(|(i, c)| {
                if i == outer || c.is_empty() {
                    return c.clone();
                }
                let n = c.len() as f64;
                let cx = c.iter().map(|p| p[0]).sum::<f64>() / n;
                let cy = c.iter().map(|p| p[1]).sum::<f64>() / n;
                c.iter()
                    .map(|p| [p[0] + (cx - p[0]) * frac, p[1] + (cy - p[1]) * frac])
                    .collect()
            })
            .collect();
        if let Some(r) = run_tess2(&shrunk, su, sv) {
            return Some(r);
        }
    }
    None
}

/// Metric scale that maps UV close to the 3D arc-length metric, so tess2 and
/// the refinement passes work in (almost) isometric coordinates. Anisotropic
/// UV (e.g. a sphere strip) otherwise produces needle triangles that can fold
/// when mapped onto curvature. Normalized so the larger extent maps to ~1.
fn metric_scale(surf: &Surface, umin: f64, umax: f64, vmin: f64, vmax: f64) -> (f64, f64) {
    let du = (umax - umin).max(1e-12);
    let dv = (vmax - vmin).max(1e-12);
    let (uc, vc) = ((umin + umax) * 0.5, (vmin + vmax) * 0.5);
    let h = 1e-4;
    let lu = surf
        .point(uc + h * du, vc)
        .sub(surf.point(uc - h * du, vc))
        .len()
        / (2.0 * h * du);
    let lv = surf
        .point(uc, vc + h * dv)
        .sub(surf.point(uc, vc - h * dv))
        .len()
        / (2.0 * h * dv);
    let size = (lu * du).max(lv * dv).max(1e-12);
    ((lu / size).max(1e-9 / du), (lv / size).max(1e-9 / dv))
}

/// Triangulate closed UV contours (odd winding -> holes), refine for
/// curvature + chord deviation, map to 3D and append to `mesh`.
fn emit_uv_region(
    surf: &Surface,
    loops_uv: &[Vec<[f64; 2]>],
    tp: &TessParams,
    same_sense: bool,
    mesh: &mut TriMesh,
) -> bool {
    let (su, sv) = {
        let (mut umin, mut umax, mut vmin, mut vmax) = (f64::MAX, f64::MIN, f64::MAX, f64::MIN);
        for l in loops_uv {
            for p in l {
                umin = umin.min(p[0]);
                umax = umax.max(p[0]);
                vmin = vmin.min(p[1]);
                vmax = vmax.max(p[1]);
            }
        }
        metric_scale(surf, umin, umax, vmin, vmax)
    };

    let (verts_uv, tris) =
        match run_tess2(loops_uv, su, sv).or_else(|| tess2_with_shrunk_holes(loops_uv, su, sv)) {
            Some(r) => r,
            None => return false,
        };
    refine_and_emit(surf, verts_uv, tris, su, sv, tp, same_sense, mesh);
    true
}

/// Shared tail of every UV-space tessellation: drop tess2's zero-area
/// triangles, normalize winding, curvature-refine, then map to 3D with
/// normals and append to `mesh`. `(su, sv)` is the metric scale of the source
/// region (see [`metric_scale`]).
fn refine_and_emit(
    surf: &Surface,
    verts_uv: Vec<[f64; 2]>,
    mut tris: Vec<[u32; 3]>,
    su: f64,
    sv: f64,
    tp: &TessParams,
    same_sense: bool,
    mesh: &mut TriMesh,
) {
    // tess2 emits zero-area triangles along collinear contour stretches
    // (e.g. a meridian boundary). They cover nothing in UV, but mapped onto
    // a curved surface their corners no longer align — phantom secant
    // triangles that refinement then multiplies. Drop them up front.
    let (mut umin, mut umax, mut vmin, mut vmax) = (f64::MAX, f64::MIN, f64::MAX, f64::MIN);
    for p in &verts_uv {
        umin = umin.min(p[0]);
        umax = umax.max(p[0]);
        vmin = vmin.min(p[1]);
        vmax = vmax.max(p[1]);
    }
    let eps_a = 1e-10 * ((umax - umin) * (vmax - vmin)).max(1e-300);
    let uv_area2 = |t: &[u32; 3]| {
        let a = verts_uv[t[0] as usize];
        let b = verts_uv[t[1] as usize];
        let c = verts_uv[t[2] as usize];
        (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    };
    tris.retain(|t| uv_area2(t).abs() > eps_a);
    // tess2-rust does not guarantee CCW output: normalize each triangle so
    // that the d/du x d/dv (= surface normal) convention holds downstream.
    for t in &mut tris {
        if uv_area2(t) < 0.0 {
            t.swap(1, 2);
        }
    }
    let mut verts_uv = verts_uv;

    // refine: parametric step limits + 3D chord deviation
    let max_du = surf.u_step(tp.deflection, tp.max_angle);
    let max_dv = surf.v_step(tp.deflection, tp.max_angle);
    let needs_dev = !matches!(surf, Surface::Plane(_));
    if max_du.is_finite() || max_dv.is_finite() || needs_dev {
        refine_uv(
            surf,
            &mut verts_uv,
            &mut tris,
            max_du,
            max_dv,
            tp.deflection,
            if needs_dev { Some((su, sv)) } else { None },
        );
    }

    // map to 3D + normals; fix winding to match the face normal
    let flip = !same_sense;
    let base = mesh.positions.len() as u32 / 3;
    for p in &verts_uv {
        let pos = surf.point(p[0], p[1]);
        let mut n = surf.normal(p[0], p[1]);
        if flip {
            n = n.scale(-1.0);
        }
        mesh.push_vertex(pos, n);
    }
    for t in &tris {
        // tess2 outputs CCW in UV => geometric normal ~ du x dv = surf.normal
        let (a, b, c) = if flip {
            (t[0], t[2], t[1])
        } else {
            (t[0], t[1], t[2])
        };
        mesh.indices.push(base + a);
        mesh.indices.push(base + b);
        mesh.indices.push(base + c);
    }
}

/// Fallback for a near-full-patch B-spline face whose Newton-inverted boundary
/// self-intersects in (metric) UV. Extreme-aspect lofted strips — a thin
/// ribbon swept along a long, folded path — invert their two long rails onto
/// u≈0 and u≈1; rail-inversion noise then crosses the seam at the tiny u scale
/// tess2 works in, and tess2 bails with no triangles. The knot domain *is* the
/// patch, so grid the covered UV rectangle and curvature-refine it instead of
/// triangulating the noisy contour. Gated on the boundary spanning most of the
/// domain in both directions, so genuinely-trimmed faces are left to fail
/// rather than be over-filled.
fn tessellate_full_patch(
    surf: &Surface,
    contours: &[Vec<[f64; 2]>],
    tp: &TessParams,
    same_sense: bool,
    mesh: &mut TriMesh,
) -> bool {
    match full_patch_rect(surf, contours) {
        Some((uu, vv)) => tessellate_uv_grid(surf, uu, vv, tp, same_sense, mesh),
        None => false,
    }
}

/// If `contours` is a single, rectangle-like boundary on a B-spline, return the
/// covered UV rectangle `((u0,u1),(v0,v1))` to grid. "Rectangle-like" = the loop
/// traces (almost) its own bounding box, so gridding that box reproduces the
/// face without over-filling a curved/notched trim — this is exactly the shape
/// of a full or sub-rectangular patch (incl. half of a periodic surface), which
/// is what folds under tess2. `None` for non-B-splines, inner loops, or
/// genuinely trimmed (non-rectangular) boundaries.
fn full_patch_rect(surf: &Surface, contours: &[Vec<[f64; 2]>]) -> Option<((f64, f64), (f64, f64))> {
    let b = match surf {
        Surface::BSpline(b) => b,
        _ => return None,
    };
    // a single boundary only: with inner loops a grid fills the holes
    if contours.len() != 1 || contours[0].len() < 3 {
        return None;
    }
    let ((u0, u1), (v0, v1)) = b.domain();
    let (mut umin, mut umax, mut vmin, mut vmax) = (f64::MAX, f64::MIN, f64::MAX, f64::MIN);
    for p in &contours[0] {
        umin = umin.min(p[0]);
        umax = umax.max(p[0]);
        vmin = vmin.min(p[1]);
        vmax = vmax.max(p[1]);
    }
    let (du, dv) = (umax - umin, vmax - vmin);
    let (ddu, ddv) = ((u1 - u0).abs(), (v1 - v0).abs());
    if ddu < 1e-12 || ddv < 1e-12 || du < 1e-6 * ddu || dv < 1e-6 * ddv {
        return None;
    }
    // the loop must enclose ~its whole bounding box (a rectangle), not a
    // curved or notched sub-region of it — the grid runs unconditionally for
    // these, so the bar is high to avoid over-filling past a curved trim
    if poly_area(&contours[0]).abs() < 0.92 * du * dv {
        return None;
    }
    Some((
        (umin.clamp(u0, u1), umax.clamp(u0, u1)),
        (vmin.clamp(v0, v1), vmax.clamp(v0, v1)),
    ))
}

/// The full knot domain `((u0,u1),(v0,v1))` if `contours` is a single boundary
/// that spans (nearly) the whole domain of a B-spline in both directions — i.e.
/// the face is the entire parametric patch, not a trimmed sub-region.
fn full_domain_bspline(
    surf: &Surface,
    contours: &[Vec<[f64; 2]>],
) -> Option<((f64, f64), (f64, f64))> {
    let b = match surf {
        Surface::BSpline(b) => b,
        _ => return None,
    };
    if contours.len() != 1 || contours[0].len() < 3 {
        return None;
    }
    let ((u0, u1), (v0, v1)) = b.domain();
    let (mut umin, mut umax, mut vmin, mut vmax) = (f64::MAX, f64::MIN, f64::MAX, f64::MIN);
    for p in &contours[0] {
        umin = umin.min(p[0]);
        umax = umax.max(p[0]);
        vmin = vmin.min(p[1]);
        vmax = vmax.max(p[1]);
    }
    let (ddu, ddv) = ((u1 - u0).abs(), (v1 - v0).abs());
    if ddu < 1e-12 || ddv < 1e-12 {
        return None;
    }
    if (umax - umin) >= 0.9 * ddu && (vmax - vmin) >= 0.9 * ddv {
        Some(((u0, u1), (v0, v1)))
    } else {
        None
    }
}

/// The full knot domain to grid when a *periodic* (closed) B-spline face's
/// boundary covers the whole surface: it spans (nearly) the full period in the
/// closed direction — winding around it, which the single-winding detector can
/// miss (|w|>1) — and the full extent in the other. The face is then the entire
/// closed tube / strip (e.g. a coil), so grid the full domain (fold-free)
/// instead of feeding tess2 a multi-winding contour it folds into soup.
fn full_wrap_bspline(
    surf: &Surface,
    contours: &[Vec<[f64; 2]>],
) -> Option<((f64, f64), (f64, f64))> {
    let b = match surf {
        Surface::BSpline(b) => b,
        _ => return None,
    };
    let (per_u, per_v) = (surf.u_period(), surf.v_period());
    if per_u.is_none() && per_v.is_none() {
        return None; // only closed (periodic) surfaces wrap onto themselves
    }
    let ((u0, u1), (v0, v1)) = b.domain();
    let (mut umin, mut umax, mut vmin, mut vmax) = (f64::MAX, f64::MIN, f64::MAX, f64::MIN);
    for c in contours {
        for p in c {
            umin = umin.min(p[0]);
            umax = umax.max(p[0]);
            vmin = vmin.min(p[1]);
            vmax = vmax.max(p[1]);
        }
    }
    let (ddu, ddv) = ((u1 - u0).abs(), (v1 - v0).abs());
    if ddu < 1e-12 || ddv < 1e-12 {
        return None;
    }
    let u_full = (umax - umin) >= 0.9 * per_u.unwrap_or(ddu);
    let v_full = (vmax - vmin) >= 0.9 * per_v.unwrap_or(ddv);
    if u_full && v_full {
        Some(((u0, u1), (v0, v1)))
    } else {
        None
    }
}

/// True if a B-spline surface has a degenerate v-edge — a row of control points
/// (at v = v0 or v = v1) that all coincide, so the surface collapses to a single
/// point there. This is a parametric pole, the standard NURBS way of forming a
/// cone apex / sphere pole (the edge's control points are coalesced). The
/// analytic `v_caps()` only knows these for explicit spheres/cones; detecting one
/// on a B-spline lets the closed-surface grid path cap it instead of feeding a
/// seam-pierced loop to the periodic-band pairing.
fn bspline_has_v_pole(surf: &Surface) -> bool {
    let b = match surf {
        Surface::BSpline(b) => b,
        _ => return false,
    };
    if b.nu < 2 || b.nv == 0 {
        return false;
    }
    let eps = 1e-6 * b.size.max(1.0);
    // column `iv` (fixed v, varying u) collapsed to one point across all rows
    let collapsed = |iv: usize| {
        let first = b.cps[iv];
        (1..b.nu).all(|iu| b.cps[iu * b.nv + iv].sub(first).len() < eps)
    };
    collapsed(0) || collapsed(b.nv - 1)
}

/// Do segments p1p2 and p3p4 properly cross (interiors intersect)?
fn segments_cross(p1: [f64; 2], p2: [f64; 2], p3: [f64; 2], p4: [f64; 2]) -> bool {
    let o = |a: [f64; 2], b: [f64; 2], c: [f64; 2]| {
        (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    };
    let (d1, d2) = (o(p3, p4, p1), o(p3, p4, p2));
    let (d3, d4) = (o(p1, p2, p3), o(p1, p2, p4));
    ((d1 > 0.0) != (d2 > 0.0)) && ((d3 > 0.0) != (d4 > 0.0))
}

/// Does the closed polygon `c` self-intersect (any two non-adjacent edges
/// cross)? A reliable boundary is a simple polygon; a self-crossing one is the
/// tell that a high-aspect surface's Newton boundary projection is unreliable.
/// O(n²), only run on full-domain B-spline patches (few, and the alternative is
/// a fold-shredded tess2 result).
fn poly_self_intersects(c: &[[f64; 2]]) -> bool {
    let n = c.len();
    if n < 4 {
        return false;
    }
    for i in 0..n {
        let (a1, a2) = (c[i], c[(i + 1) % n]);
        for j in (i + 2)..n {
            if i == 0 && j == n - 1 {
                continue; // edge (n-1, 0) is adjacent to edge (0, 1)
            }
            if segments_cross(a1, a2, c[j], c[(j + 1) % n]) {
                return true;
            }
        }
    }
    false
}

/// Grid a UV rectangle into a triangle mesh at ~2 samples per knot span (dense
/// enough that midpoint refinement does not alias fast folds), then run the
/// shared curvature refinement + 3D mapping. Returns false on a degenerate
/// (empty) grid.
fn tessellate_uv_grid(
    surf: &Surface,
    (u0, u1): (f64, f64),
    (v0, v1): (f64, f64),
    tp: &TessParams,
    same_sense: bool,
    mesh: &mut TriMesh,
) -> bool {
    let (mut nu, mut nv) = match surf {
        Surface::BSpline(b) => (
            (b.nu.saturating_sub(b.deg_u).max(1) * 2).clamp(2, 64),
            (b.nv.saturating_sub(b.deg_v).max(1) * 2).clamp(2, 8192),
        ),
        _ => (8, 8),
    };
    // bound the starting mesh; refinement only adds triangles, so leave room
    while nu * nv > 200_000 {
        if nv > nu {
            nv /= 2;
        } else {
            nu /= 2;
        }
    }
    let mut verts: Vec<[f64; 2]> = Vec::with_capacity((nu + 1) * (nv + 1));
    for j in 0..=nv {
        let v = v0 + (v1 - v0) * j as f64 / nv as f64;
        for i in 0..=nu {
            let u = u0 + (u1 - u0) * i as f64 / nu as f64;
            verts.push([u, v]);
        }
    }
    let w = (nu + 1) as u32;
    let mut tris: Vec<[u32; 3]> = Vec::with_capacity(nu * nv * 2);
    for j in 0..nv as u32 {
        for i in 0..nu as u32 {
            let a = j * w + i;
            tris.push([a, a + 1, a + w + 1]);
            tris.push([a, a + w + 1, a + w]);
        }
    }
    if tris.is_empty() {
        return false;
    }
    let (su, sv) = metric_scale(surf, u0, u1, v0, v1);
    refine_and_emit(surf, verts, tris, su, sv, tp, same_sense, mesh);
    true
}

thread_local! {
    /// Set while we're inside tess2 so the global panic hook stays quiet for
    /// expected, recoverable tessellation failures.
    pub static TESS_GUARD: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// Install a panic hook that suppresses output for guarded tess2 panics.
pub fn install_panic_guard() {
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        if !TESS_GUARD.with(|g| g.get()) {
            default(info);
        }
    }));
}

/// tess2 output in UV space: (vertices, triangle index triples).
type Tess2Out = (Vec<[f64; 2]>, Vec<[u32; 3]>);

/// Build tess2's flat (scaled) contour, dropping consecutive coincident points
/// and the closing duplicate. Zero-length edges are the classic trigger for
/// tess2's sweep-line robustness failures (it `unwrap()`s a freed region and
/// panics) — and on wasm a panic aborts the whole module (no `catch_unwind`),
/// so sanitizing the input here is the only way to keep a degenerate boundary
/// from killing the conversion. Returns `None` for fewer than 3 distinct points.
fn sanitize_contour(l: &[[f64; 2]], su: f64, sv: f64) -> Option<Vec<f64>> {
    if l.len() < 3 {
        return None;
    }
    let (mut w, mut h) = (0.0f64, 0.0f64);
    for p in l {
        w = w.max((p[0] * su).abs());
        h = h.max((p[1] * sv).abs());
    }
    let eps = 1e-9 * w.max(h).max(1.0);
    let mut flat: Vec<f64> = Vec::with_capacity(l.len() * 2);
    for p in l {
        let (x, y) = (p[0] * su, p[1] * sv);
        if flat.len() >= 2 {
            let (lx, ly) = (flat[flat.len() - 2], flat[flat.len() - 1]);
            if (x - lx).abs() <= eps && (y - ly).abs() <= eps {
                continue; // coincident with previous → zero-length edge
            }
        }
        flat.push(x);
        flat.push(y);
    }
    // drop a closing duplicate (first ≈ last)
    if flat.len() >= 4 {
        let n = flat.len();
        if (flat[0] - flat[n - 2]).abs() <= eps && (flat[1] - flat[n - 1]).abs() <= eps {
            flat.truncate(n - 2);
        }
    }
    (flat.len() >= 6).then_some(flat) // ≥ 3 distinct points
}

fn run_tess2(loops_uv: &[Vec<[f64; 2]>], su: f64, sv: f64) -> Option<Tess2Out> {
    TESS_GUARD.with(|g| g.set(true));
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let mut tess = Tessellator::new();
        for l in loops_uv {
            if let Some(flat) = sanitize_contour(l, su, sv) {
                tess.add_contour(2, &flat);
            }
        }
        if !tess.tessellate(WindingRule::Odd, ElementType::Polygons, 3, 2, None) {
            return None;
        }
        let tv = tess.vertices();
        let te = tess.elements();
        if te.is_empty() {
            return None;
        }
        let verts: Vec<[f64; 2]> = (0..tess.vertex_count())
            .map(|i| [tv[i * 2] / su, tv[i * 2 + 1] / sv])
            .collect();
        let mut tris: Vec<[u32; 3]> = Vec::with_capacity(tess.element_count());
        for e in te.chunks(3) {
            if e.len() == 3 && e[0] != TESS_UNDEF && e[1] != TESS_UNDEF && e[2] != TESS_UNDEF {
                tris.push([e[0], e[1], e[2]]);
            }
        }
        Some((verts, tris))
    }));
    TESS_GUARD.with(|g| g.set(false));
    result.ok().flatten()
}

/// Fallback for a single winding loop the band path can't pair: the loop winds
/// once in `u` but also spans a `v`-range (it carries the winding edge — a full
/// circle / meridian — plus axial or spanning edges), so it is not the iso-v
/// band the band path assumes. Tessellate the region it bounds on the universal
/// cover: keep the unwrapped loop as an open curve over ≈one u-period, then
/// close it along a far v-edge and fill the strip between. The edge is a
/// **singular cap** where the surface has one (a sphere pole / cone apex — the
/// closing line collapses to a point, adding no area), else the **loop's own
/// v-extreme** on a surface with bounded v (a cylinder, or a torus whose
/// tube-angle stays within one period). Two degeneracies are filtered first: a
/// boundary off the surface (malformed) by the quadric guard in
/// [`face_to_mesh`], and an iso-v rim (zero v-extent, no opposite rim to bound
/// against) by the zero-extent check below. A loop that also winds in v stays
/// skipped for the doubly-periodic seam handling.
fn tessellate_periodic_winding(
    surf: &Surface,
    loops_uv: &[LoopUv],
    tp: &TessParams,
    same_sense: bool,
    mesh: &mut TriMesh,
) -> bool {
    if surf.u_period().is_none() {
        return false;
    }
    // exactly one winding loop (the band path owns the pairable multi-curve
    // cases); the rest are real holes.
    let winders: Vec<&LoopUv> = loops_uv.iter().filter(|l| l.w != 0).collect();
    if winders.len() != 1 || winders[0].w.abs() != 1 || winders[0].uv.len() < 3 {
        return false;
    }
    let wl = winders[0];

    // v-extent of the *winding* loop itself — this is what bounds the face and
    // sets the closing extreme. (Using all loops would let a stray hole's
    // v-range drag the closing edge far past the real face — a spike.) An
    // iso-v winding rim has ~zero extent: it can't bound a finite region on its
    // own (no opposite rim to pair, which the band path needs), so it falls out
    // here and stays skipped rather than closing against an unrelated edge.
    let (mut vmin, mut vmax) = (f64::MAX, f64::MIN);
    for p in &wl.uv {
        vmin = vmin.min(p[1]);
        vmax = vmax.max(p[1]);
    }
    if !(vmax - vmin > 1e-9 * (vmax.abs().max(vmin.abs())).max(1.0)) {
        return false;
    }

    // Close the winding curve against a far v-edge and fill the strip between —
    // but only when that edge is a real **singular cap** (a sphere pole / cone
    // apex), where the closing line collapses to a point and the fan adds no
    // spurious area. The choice of cap is forced by the surface, not the
    // interior flag:
    //   • two finite caps (sphere): both sides are finite lunes — here the
    //     interior sense does pick which pole to close toward. This is the
    //     spec convention (loop CCW around the interior iff same_sense), and
    //     a signed-area check on the closed polygon is mathematically
    //     equivalent to it — so an exporter with an inverted same_sense flag
    //     closes toward the wrong pole and there is no independent signal to
    //     detect that. Deliberately not "fixed" heuristically.
    //   • one finite cap (cone apex): only the capped (tip) side is finite (the
    //     uncapped side runs to infinity and can't be a face), so close toward
    //     the apex regardless of the interior flag.
    //   • no cap, open v (cylinder): v doesn't wrap, so the loop's own v-extent
    //     bounds the face — close at the far extreme (the interior sense picks
    //     which). The two failure modes are filtered upstream: a malformed
    //     v-outlier by the on-surface guard, an iso-v rim by the zero-extent
    //     check above.
    //   • no cap, periodic v (torus): only when the tube-angle extent stays
    //     within one period (no v-wind) — same as a cylinder then; if v also
    //     winds there is no extreme to close against, so leave it for the
    //     doubly-periodic seam handling.
    let (cb, ct) = surf.v_caps().unwrap_or((f64::NEG_INFINITY, f64::INFINITY));
    let below = |c: f64| c + 1e-4 * (vmax - c).abs().max(1.0); // just inside a low cap
    let above = |c: f64| c - 1e-4 * (c - vmin).abs().max(1.0); // just inside a high cap
    let vfar = match (cb.is_finite(), ct.is_finite()) {
        (true, true) => {
            if wl.interior_above {
                above(ct)
            } else {
                below(cb)
            }
        }
        (true, false) => below(cb),
        (false, true) => above(ct),
        (false, false) => {
            if let Some(pv) = surf.v_period() {
                if vmax - vmin >= pv - 1e-9 {
                    return false; // winds in v too: doubly-periodic seam handling
                }
            }
            if wl.interior_above {
                vmax
            } else {
                vmin
            }
        }
    };

    // the unwrapped loop runs from uv[0] to ≈ uv[0] + w·per; close it back along
    // v = vfar (sampled at the u step so a polar cap fans cleanly).
    let u0 = wl.uv[0][0];
    let uend = wl.uv[wl.uv.len() - 1][0];
    let mut poly = wl.uv.clone();
    let du = surf.u_step(tp.deflection, tp.max_angle);
    let n = (((uend - u0).abs() / du).ceil() as usize).clamp(2, 256);
    for k in 0..=n {
        poly.push([uend + (u0 - uend) * k as f64 / n as f64, vfar]);
    }

    let mut all = vec![poly];
    all.extend(loops_uv.iter().filter(|l| l.w == 0).map(|l| l.uv.clone()));
    emit_uv_region(surf, &all, tp, same_sense, mesh)
}

/// The v-axis mirror of [`tessellate_periodic_band`]: loops that wind the
/// **v** period (tube end-circles on a torus / closed-profile revolution —
/// cable and pipe elbows) are cut at a common seam v = c, normalized to run
/// v = c .. c+period, sorted by u, and consecutive curves pair into closed
/// band polygons spanning the full v period. Non-winding loops become holes
/// in their band. No cap handling: none of our v-periodic surfaces has a
/// u cap, so an odd curve count fails (and the face is reported).
fn tessellate_periodic_band_v(
    surf: &Surface,
    loops_uv: &[LoopUv],
    tp: &TessParams,
    same_sense: bool,
    mesh: &mut TriMesh,
) -> bool {
    let per = match surf.v_period() {
        Some(p) => p,
        None => return false,
    };

    struct BandCurve {
        pts: Vec<[f64; 2]>,
        /// interior of the face is on this curve's +u side (from the loop's
        /// winding sign + same_sense — loops run CCW around the interior in
        /// UV iff same_sense; left of +v travel is -u)
        interior_plus_u: bool,
    }
    let mut curves: Vec<BandCurve> = Vec::new();
    let mut holes: Vec<Vec<[f64; 2]>> = Vec::new();
    let mut seam: Option<f64> = None;

    for l in loops_uv {
        if l.wv == 0 {
            holes.push(l.uv.clone());
            continue;
        }
        if l.wv.abs() != 1 || l.uv.len() < 3 {
            return false; // multi-winding loops: out of scope
        }
        let mut ext = l.uv.clone();
        ext.push([l.uv[0][0], l.uv[0][1] + l.wv as f64 * per]);

        let c = *seam.get_or_insert(ext[0][1]);
        // find a crossing of v ≡ c (mod period) along the extended polyline
        let mut cut: Option<(usize, [f64; 2])> = None;
        'outer: for i in 0..ext.len() - 1 {
            let (v0, v1) = (ext[i][1], ext[i + 1][1]);
            let k0 = ((v0.min(v1) - c) / per).floor() as i64;
            for k in k0..=k0 + 2 {
                let cv = c + k as f64 * per;
                if (v0 - cv).abs() < 1e-12 {
                    cut = Some((i, ext[i]));
                    break 'outer;
                }
                if (v0 - cv) * (v1 - cv) <= 0.0 && (v1 - v0).abs() > 1e-12 {
                    let t = (cv - v0) / (v1 - v0);
                    if (0.0..=1.0).contains(&t) {
                        let u = ext[i][0] + t * (ext[i + 1][0] - ext[i][0]);
                        cut = Some((i, [u, cv]));
                        break 'outer;
                    }
                }
            }
        }
        let (ci, cp) = match cut {
            Some(c) => c,
            None => return false,
        };
        let n = l.uv.len();
        let mut open: Vec<[f64; 2]> = Vec::with_capacity(n + 2);
        open.push(cp);
        for j in 1..=n {
            let idx = (ci + j) % n;
            let wraps = ((ci + j) / n) as f64;
            let p = l.uv[idx];
            open.push([p[0], p[1] + wraps * l.wv as f64 * per]);
        }
        open.push([cp[0], cp[1] + l.wv as f64 * per]);
        open.dedup_by(|a, b| (a[0] - b[0]).abs() < 1e-12 && (a[1] - b[1]).abs() < 1e-12);

        // normalize to +v and start exactly at v = c
        if l.wv < 0 {
            open.reverse();
        }
        let shift = ((open[0][1] - c) / per).round() * per;
        if shift != 0.0 {
            for p in &mut open {
                p[1] -= shift;
            }
        }
        curves.push(BandCurve {
            pts: open,
            interior_plus_u: (l.wv < 0) == same_sense,
        });
    }

    // bands need pairs of curves; no u caps exist to absorb an odd count
    if curves.is_empty() || curves.len() % 2 == 1 {
        return false;
    }
    let mean_u = |c: &BandCurve| c.pts.iter().map(|p| p[0]).sum::<f64>() / c.pts.len() as f64;
    curves.sort_by(|a, b| {
        mean_u(a)
            .partial_cmp(&mean_u(b))
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    // Orientation picks the side: the lowest-u curve must open toward +u to
    // be a band's left edge. If it opens toward -u the face wraps the u seam
    // (the elbow runs the long way around) — rotate that curve one u period
    // up and pair from the next one. Needs u to actually be periodic.
    if !curves[0].interior_plus_u {
        match surf.u_period() {
            Some(uper) => {
                let mut c = curves.remove(0);
                for p in &mut c.pts {
                    p[0] += uper;
                }
                curves.push(c);
            }
            None => return false,
        }
    }

    let mut any = false;
    let mut i = 0;
    while i + 1 < curves.len() {
        let left = &curves[i];
        let right = &curves[i + 1];
        let (ul, ur) = (mean_u(left), mean_u(right));
        let mut poly: Vec<[f64; 2]> = Vec::with_capacity(left.pts.len() + right.pts.len());
        poly.extend_from_slice(&left.pts);
        poly.extend(right.pts.iter().rev());
        let mut contours: Vec<Vec<[f64; 2]>> = vec![poly];
        for h in &holes {
            let hu = h.iter().map(|p| p[0]).sum::<f64>() / h.len().max(1) as f64;
            if hu >= ul.min(ur) && hu <= ul.max(ur) {
                let hv = h.iter().map(|p| p[1]).sum::<f64>() / h.len().max(1) as f64;
                let c = left.pts[0][1];
                let shift = ((hv - (c + per / 2.0)) / per).round() * per;
                let mut hh = h.clone();
                if shift != 0.0 {
                    for p in &mut hh {
                        p[1] -= shift;
                    }
                }
                contours.push(hh);
            }
        }
        any |= emit_uv_region(surf, &contours, tp, same_sense, mesh);
        i += 2;
    }
    any
}

/// Faces that wrap fully around a periodic surface. Each winding loop is cut
/// at a common seam parameter `c`, normalized to run u = c .. c+period, then
/// consecutive curves (sorted by v) pair into closed band polygons. An odd
/// curve at a capped extreme (sphere pole / cone apex) is closed against a
/// synthetic polar cap line. Non-winding loops become holes in their band.
fn tessellate_periodic_band(
    surf: &Surface,
    loops_uv: &[LoopUv],
    tp: &TessParams,
    same_sense: bool,
    mesh: &mut TriMesh,
) -> bool {
    let per = match surf.u_period() {
        Some(p) => p,
        None => return false,
    };

    struct BandCurve {
        pts: Vec<[f64; 2]>,
        interior_above: bool,
    }
    let mut curves: Vec<BandCurve> = Vec::new();
    let mut holes: Vec<Vec<[f64; 2]>> = Vec::new();
    let mut seam: Option<f64> = None;

    for l in loops_uv {
        if l.w == 0 {
            holes.push(l.uv.clone());
            continue;
        }
        if l.w.abs() != 1 || l.uv.len() < 3 {
            return false; // multi-winding loops: out of scope
        }
        let mut ext = l.uv.clone();
        ext.push([l.uv[0][0] + l.w as f64 * per, l.uv[0][1]]);

        let c = *seam.get_or_insert(ext[0][0]);
        // find a crossing of u ≡ c (mod period) along the extended polyline
        let mut cut: Option<(usize, [f64; 2])> = None;
        'outer: for i in 0..ext.len() - 1 {
            let (u0, u1) = (ext[i][0], ext[i + 1][0]);
            let k0 = ((u0.min(u1) - c) / per).floor() as i64;
            for k in k0..=k0 + 2 {
                let cv = c + k as f64 * per;
                if (u0 - cv).abs() < 1e-12 {
                    cut = Some((i, ext[i]));
                    break 'outer;
                }
                if (u0 - cv) * (u1 - cv) <= 0.0 && (u1 - u0).abs() > 1e-12 {
                    let t = (cv - u0) / (u1 - u0);
                    if (0.0..=1.0).contains(&t) {
                        let v = ext[i][1] + t * (ext[i + 1][1] - ext[i][1]);
                        cut = Some((i, [cv, v]));
                        break 'outer;
                    }
                }
            }
        }
        let (ci, cp) = match cut {
            Some(c) => c,
            None => return false,
        };
        let n = l.uv.len();
        let mut open: Vec<[f64; 2]> = Vec::with_capacity(n + 2);
        open.push(cp);
        for j in 1..=n {
            let idx = (ci + j) % n;
            let wraps = ((ci + j) / n) as f64;
            let p = l.uv[idx];
            open.push([p[0] + wraps * l.w as f64 * per, p[1]]);
        }
        open.push([cp[0] + l.w as f64 * per, cp[1]]);
        open.dedup_by(|a, b| (a[0] - b[0]).abs() < 1e-12 && (a[1] - b[1]).abs() < 1e-12);

        // normalize to +u and start exactly at u = c
        if l.w < 0 {
            open.reverse();
        }
        let shift = ((open[0][0] - c) / per).round() * per;
        if shift != 0.0 {
            for p in &mut open {
                p[0] -= shift;
            }
        }
        curves.push(BandCurve {
            pts: open,
            interior_above: l.interior_above,
        });
    }

    if curves.is_empty() {
        return false;
    }
    let mean_v = |c: &BandCurve| c.pts.iter().map(|p| p[1]).sum::<f64>() / c.pts.len() as f64;
    curves.sort_by(|a, b| {
        mean_v(a)
            .partial_cmp(&mean_v(b))
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    // odd number of winding curves: close against a polar cap if available
    if curves.len() % 2 == 1 {
        let caps = match surf.v_caps() {
            Some(c) => c,
            None => return false,
        };
        let c = seam.unwrap_or(0.0);
        let top_wants_cap = curves.last().map(|t| t.interior_above).unwrap_or(false);
        let bottom_wants_cap = curves.first().map(|b| !b.interior_above).unwrap_or(false);
        // sample the cap line at the u step so the polar fan triangulates
        // cleanly instead of as long slivers
        let cap_line = |vcap: f64| {
            let n =
                ((per / surf.u_step(tp.deflection, tp.max_angle)).ceil() as usize).clamp(2, 256);
            (0..=n)
                .map(|i| [c + per * i as f64 / n as f64, vcap])
                .collect::<Vec<[f64; 2]>>()
        };
        if top_wants_cap && caps.1.is_finite() {
            curves.push(BandCurve {
                pts: cap_line(caps.1),
                interior_above: false,
            });
            curves.sort_by(|a, b| {
                mean_v(a)
                    .partial_cmp(&mean_v(b))
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
        } else if bottom_wants_cap && caps.0.is_finite() {
            curves.insert(
                0,
                BandCurve {
                    pts: cap_line(caps.0),
                    interior_above: true,
                },
            );
        } else {
            return false;
        }
    }

    let mut any = false;
    let mut i = 0;
    while i + 1 < curves.len() {
        let bottom = &curves[i];
        let top = &curves[i + 1];
        let (vb, vt) = (mean_v(bottom), mean_v(top));
        let mut poly: Vec<[f64; 2]> = Vec::with_capacity(bottom.pts.len() + top.pts.len());
        poly.extend_from_slice(&bottom.pts);
        poly.extend(top.pts.iter().rev());
        let mut contours: Vec<Vec<[f64; 2]>> = vec![poly];
        for h in &holes {
            let hv = h.iter().map(|p| p[1]).sum::<f64>() / h.len().max(1) as f64;
            if hv >= vb.min(vt) && hv <= vb.max(vt) {
                let hu = h.iter().map(|p| p[0]).sum::<f64>() / h.len().max(1) as f64;
                let c = bottom.pts[0][0];
                let shift = ((hu - (c + per / 2.0)) / per).round() * per;
                let mut hh = h.clone();
                if shift != 0.0 {
                    for p in &mut hh {
                        p[0] -= shift;
                    }
                }
                contours.push(hh);
            }
        }
        any |= emit_uv_region(surf, &contours, tp, same_sense, mesh);
        i += 2;
    }
    any
}

/// Full-domain tessellation for a face that has no real trimming boundary —
/// a closed quadric (sphere/torus) or a (rational) B-spline patch whose only
/// boundary is a seam slit or a degenerate loop. For a B-spline the knot
/// domain *is* the patch extent, so gridding it reproduces exactly this face
/// (not an infinite surface), which is why this is safe to fall into.
fn tessellate_unbounded(
    surf: &Surface,
    tp: &TessParams,
    same_sense: bool,
    mesh: &mut TriMesh,
) -> bool {
    use std::f64::consts::{PI, TAU};
    let (u0, u1, v0, v1) = match surf {
        Surface::Sphere(_, _) => (0.0, TAU, -PI / 2.0, PI / 2.0),
        Surface::Torus(_, _, _) => (0.0, TAU, 0.0, TAU),
        Surface::BSpline(b) => {
            let ((u0, u1), (v0, v1)) = b.domain();
            (u0, u1, v0, v1)
        }
        _ => return false,
    };
    let du = surf.u_step(tp.deflection, tp.max_angle);
    let dv = surf.v_step(tp.deflection, tp.max_angle).min(du);
    let nu = (((u1 - u0) / du).ceil() as usize).max(4);
    let nv = (((v1 - v0) / dv).ceil() as usize).max(3);
    let base = mesh.positions.len() as u32 / 3;
    for j in 0..=nv {
        let v = v0 + (v1 - v0) * j as f64 / nv as f64;
        for i in 0..=nu {
            let u = u0 + (u1 - u0) * i as f64 / nu as f64;
            let mut n = surf.normal(u, v);
            if !same_sense {
                n = n.scale(-1.0);
            }
            mesh.push_vertex(surf.point(u, v), n);
        }
    }
    let w = (nu + 1) as u32;
    for j in 0..nv as u32 {
        for i in 0..nu as u32 {
            let a = base + j * w + i;
            let b = a + 1;
            let c = a + w;
            let d = c + 1;
            if same_sense {
                mesh.indices.extend_from_slice(&[a, b, d, a, d, c]);
            } else {
                mesh.indices.extend_from_slice(&[a, d, b, a, c, d]);
            }
        }
    }
    true
}

/// Midpoint edge subdivision in UV until every edge respects the parametric
/// step limits *and* a 3D chord-deviation bound (midpoint of the chord vs the
/// surface point at the UV midpoint). Triangles whose 3D normal disagrees
/// with the surface normal ("folds", typically slivers on curved surfaces)
/// get their longest edge split; edge marks are collected globally first so
/// neighbours split consistently and no T-junction cracks appear.
fn refine_uv(
    surf: &Surface,
    verts: &mut Vec<[f64; 2]>,
    tris: &mut Vec<[u32; 3]>,
    max_du: f64,
    max_dv: f64,
    defl: f64,
    flip_metric: Option<(f64, f64)>,
) {
    let mut pts3: Vec<V3> = verts.iter().map(|p| surf.point(p[0], p[1])).collect();
    let check_dev = !matches!(surf, Surface::Plane(_));

    // Deflection budget: meeting a sag bound of `defl` needs at most about
    // area / defl² triangles — features below the deflection scale are not
    // representable anyway. Near-cusp parameterizations (arc length
    // concentrated in tiny UV ranges, e.g. swept tubes with path kinks)
    // otherwise re-fail the sag test at every subdivision level and explode
    // toward the hard cap; the budget stops them at a sane density without
    // affecting well-parameterized faces.
    let approx_area: f64 = tris
        .iter()
        .map(|t| {
            let (a, b, c) = (
                pts3[t[0] as usize],
                pts3[t[1] as usize],
                pts3[t[2] as usize],
            );
            b.sub(a).cross(c.sub(a)).len() * 0.5
        })
        .sum();
    let budget = if defl > 0.0 {
        ((4.0 * approx_area / (defl * defl)) as usize)
            .max(tris.len() * 4)
            .clamp(2_048, 300_000)
    } else {
        300_000
    };

    for _pass in 0..12 {
        let mut mid: HashMap<(u32, u32), u32> = HashMap::new();
        let mut out: Vec<[u32; 3]> = Vec::with_capacity(tris.len());
        let mut split_any = false;

        // 0 = no, 1 = parametric, 2 = deviation
        let edge_needs_split = |i: u32, j: u32, verts: &Vec<[f64; 2]>, pts3: &Vec<V3>| -> u8 {
            let a = verts[i as usize];
            let b = verts[j as usize];
            if (b[0] - a[0]).abs() > max_du || (b[1] - a[1]).abs() > max_dv {
                return 1;
            }
            if !check_dev {
                return 0;
            }
            // sag test: perpendicular distance from the surface point at the
            // UV midpoint to the 3D chord line. Comparing against the chord
            // *midpoint* instead would also measure tangential drift from
            // non-uniform parameterization speed (ubiquitous on B-splines)
            // and over-refine without bound.
            let pa = pts3[i as usize];
            let chord = pts3[j as usize].sub(pa);
            let l2 = chord.dot(chord);
            // sub-resolution floor: a chord this short with sag > defl means
            // a curvature radius below ~2*defl — a feature the deflection
            // budget cannot represent; refining further only explodes the
            // mesh (cusps on spring/fillet B-splines do exactly that)
            if l2 < (4.0 * defl) * (4.0 * defl) {
                return 0;
            }
            let m = surf.point((a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5);
            let d = m.sub(pa);
            let dev = if l2 < 1e-300 {
                d.len()
            } else {
                let t = (d.dot(chord) / l2).clamp(0.0, 1.0);
                d.sub(chord.scale(t)).len()
            };
            if dev > defl {
                2
            } else {
                0
            }
        };

        // phase 1: mark edges — per-edge criteria plus the longest edge of
        // any folded triangle (marks are global, so adjacency stays crack
        // free in phase 2)
        let mut marked: std::collections::HashSet<(u32, u32)> = std::collections::HashSet::new();
        let key = |i: u32, j: u32| (i.min(j), i.max(j));
        for t in tris.iter() {
            for (i, j) in [(t[0], t[1]), (t[1], t[2]), (t[2], t[0])] {
                if !marked.contains(&key(i, j)) {
                    match edge_needs_split(i, j, verts, &pts3) {
                        0 => {}
                        _ => {
                            marked.insert(key(i, j));
                        }
                    }
                }
            }
            // Fold detection breaks up the big folded slivers that tess2
            // can emit, in the first passes only: persistently folded micro
            // triangles indicate parameterization cusps (collapsed control
            // points on fillet B-splines, degenerate tori) that subdivision
            // cannot fix — chasing them explodes the mesh instead.
            if check_dev && _pass < 3 {
                let (a, b, c) = (
                    pts3[t[0] as usize],
                    pts3[t[1] as usize],
                    pts3[t[2] as usize],
                );
                let gn = b.sub(a).cross(c.sub(a));
                let lmax = b.sub(a).len().max(c.sub(b).len()).max(a.sub(c).len());
                // Skip (near-)degenerate triangles: their geometric normal is
                // numeric noise, they contribute no area, and chasing them
                // explodes the subdivision. optimize() drops them later.
                if gn.len() > 1e-4 * lmax * lmax {
                    let (ua, ub, uc) = (
                        verts[t[0] as usize],
                        verts[t[1] as usize],
                        verts[t[2] as usize],
                    );
                    let cen = [(ua[0] + ub[0] + uc[0]) / 3.0, (ua[1] + ub[1] + uc[1]) / 3.0];
                    let sn = surf.normal(cen[0], cen[1]);
                    if gn.norm().dot(sn) < 0.5 {
                        // folded or badly warped: split the longest 3D edge
                        let l01 = b.sub(a).len();
                        let l12 = c.sub(b).len();
                        let l20 = a.sub(c).len();
                        let e = if l01 >= l12 && l01 >= l20 {
                            (t[0], t[1])
                        } else if l12 >= l20 {
                            (t[1], t[2])
                        } else {
                            (t[2], t[0])
                        };
                        let (ea, eb) = (verts[e.0 as usize], verts[e.1 as usize]);
                        let big_enough = (eb[0] - ea[0]).abs() > max_du / 8.0
                            || (eb[1] - ea[1]).abs() > max_dv / 8.0;
                        if big_enough {
                            marked.insert(key(e.0, e.1));
                        }
                    }
                }
            }
        }

        let mut midpoint = |i: u32, j: u32, verts: &mut Vec<[f64; 2]>, pts3: &mut Vec<V3>| -> u32 {
            let key = (i.min(j), i.max(j));
            *mid.entry(key).or_insert_with(|| {
                let a = verts[i as usize];
                let b = verts[j as usize];
                let m = [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5];
                verts.push(m);
                pts3.push(surf.point(m[0], m[1]));
                (verts.len() - 1) as u32
            })
        };

        // phase 2: subdivide strictly by the marked-edge set
        for t in tris.iter() {
            let s = [
                marked.contains(&key(t[0], t[1])),
                marked.contains(&key(t[1], t[2])),
                marked.contains(&key(t[2], t[0])),
            ];
            if !s[0] && !s[1] && !s[2] {
                out.push(*t);
                continue;
            }
            split_any = true;
            let m01 = if s[0] {
                Some(midpoint(t[0], t[1], verts, &mut pts3))
            } else {
                None
            };
            let m12 = if s[1] {
                Some(midpoint(t[1], t[2], verts, &mut pts3))
            } else {
                None
            };
            let m20 = if s[2] {
                Some(midpoint(t[2], t[0], verts, &mut pts3))
            } else {
                None
            };
            match (m01, m12, m20) {
                (Some(a), Some(b), Some(c)) => {
                    out.push([t[0], a, c]);
                    out.push([a, t[1], b]);
                    out.push([c, b, t[2]]);
                    out.push([a, b, c]);
                }
                (Some(a), Some(b), None) => {
                    out.push([t[0], a, t[2]]);
                    out.push([a, b, t[2]]);
                    out.push([a, t[1], b]);
                }
                (None, Some(b), Some(c)) => {
                    out.push([t[0], t[1], b]);
                    out.push([t[0], b, c]);
                    out.push([c, b, t[2]]);
                }
                (Some(a), None, Some(c)) => {
                    out.push([t[0], a, c]);
                    out.push([a, t[1], c]);
                    out.push([c, t[1], t[2]]);
                }
                (Some(a), None, None) => {
                    out.push([t[0], a, t[2]]);
                    out.push([a, t[1], t[2]]);
                }
                (None, Some(b), None) => {
                    out.push([t[0], t[1], b]);
                    out.push([t[0], b, t[2]]);
                }
                (None, None, Some(c)) => {
                    out.push([t[0], t[1], c]);
                    out.push([c, t[1], t[2]]);
                }
                (None, None, None) => unreachable!(),
            }
        }
        *tris = out;
        // reshape slivers right away so they don't propagate through the
        // next subdivision (Delaunay flips in metric UV)
        if let Some((su, sv)) = flip_metric {
            delaunay_flip(verts, tris, su, sv);
        }
        if !split_any || tris.len() > budget {
            break;
        }
    }
}

// ------------------------------------------------- AP242 tessellated geometry

/// AP242 tessellated geometry: the ed1 `TRIANGULATED_FACE_SET` / `_SURFACE_SET`
/// and the ed2 `TRIANGULATED_FACE` / `COMPLEX_TRIANGULATED_FACE`. Vertices come
/// from a `COORDINATES_LIST`; indices reference it 1-based, directly or through
/// the optional `pnindex` indirection. The ed2 `*_FACE` forms insert a
/// `geometric_link` (a ref/`$`) between `normals` and `pnindex`; since `pnindex`
/// is always a list, the one-slot shift is detected by type. `complex` decodes
/// `triangle_strips` + `triangle_fans` (standard GL winding) instead of an
/// explicit triangle list.
fn tessellate_triangulated_set(sf: &StepFile, id: u32, mesh: &mut TriMesh, complex: bool) {
    let p = match sf.params(id) {
        Some(p) => p,
        None => return,
    };
    let coords = match p
        .get(1)
        .and_then(|v| v.as_ref_id())
        .and_then(|r| sf.params(r))
    {
        Some(c) => c,
        None => return,
    };
    let pts: Vec<V3> = match coords.get(2).and_then(|v| v.as_list()) {
        Some(l) => l
            .iter()
            .filter_map(|t| t.as_list())
            .filter_map(|t| {
                Some(v3(
                    t.first()?.as_f64()?,
                    t.get(1)?.as_f64()?,
                    t.get(2)?.as_f64()?,
                ))
            })
            .collect(),
        None => return,
    };
    // 0 for the ed1 *_SET forms (get(4) = pnindex, a list); 1 for the ed2
    // *_FACE forms whose get(4) is the geometric_link (a ref/$, not a list).
    let off = usize::from(!p.get(4).is_some_and(|v| v.as_list().is_some()));
    let pnindex: Vec<u32> = p
        .get(4 + off)
        .and_then(|v| v.as_list())
        .map(|l| {
            l.iter()
                .filter_map(|v| v.as_i64())
                .map(|v| v as u32)
                .collect()
        })
        .unwrap_or_default();
    let map_idx = |i: u32| -> Option<u32> {
        let i = i.checked_sub(1)?; // STEP is 1-based
        let pi = if pnindex.is_empty() {
            i
        } else {
            pnindex.get(i as usize)?.checked_sub(1)?
        };
        ((pi as usize) < pts.len()).then_some(pi)
    };
    // each sublist of (1-based) point indices in slot `slot` (strips/fans/tris)
    let lists = |slot: usize| -> Vec<Vec<u32>> {
        p.get(slot)
            .and_then(|v| v.as_list())
            .map(|ls| {
                ls.iter()
                    .filter_map(|s| s.as_list())
                    .map(|s| {
                        s.iter()
                            .filter_map(|v| v.as_i64())
                            .map(|v| v as u32)
                            .collect()
                    })
                    .collect()
            })
            .unwrap_or_default()
    };

    let base = mesh.positions.len() as u32 / 3;
    for pnt in &pts {
        mesh.push_vertex(*pnt, V3::ZERO);
    }
    let istart = mesh.indices.len();
    let mut idx: Vec<u32> = Vec::new();
    let mut emit = |a: u32, b: u32, c: u32| {
        if let (Some(a), Some(b), Some(c)) = (map_idx(a), map_idx(b), map_idx(c)) {
            idx.extend([base + a, base + b, base + c]);
        }
    };
    if complex {
        // triangle_strips (slot 5+off): k-th triangle alternates winding so the
        // strip stays consistently oriented (GL_TRIANGLE_STRIP)
        for s in lists(5 + off) {
            for k in 0..s.len().saturating_sub(2) {
                if k % 2 == 0 {
                    emit(s[k], s[k + 1], s[k + 2]);
                } else {
                    emit(s[k + 1], s[k], s[k + 2]);
                }
            }
        }
        // triangle_fans (slot 6+off): every triangle shares the first vertex
        for f in lists(6 + off) {
            for k in 1..f.len().saturating_sub(1) {
                emit(f[0], f[k], f[k + 1]);
            }
        }
    } else {
        for t in lists(5 + off) {
            if t.len() >= 3 {
                emit(t[0], t[1], t[2]);
            }
        }
    }
    drop(emit);
    mesh.indices.extend(idx);
    mesh.compute_missing_normals(base as usize, istart);
}

/// Lawson edge flips in (metric-scaled) UV. Interior edges are flipped while
/// the flip increases the smaller of the two triangles' minimum angles;
/// boundary edges (single adjacent triangle) are left alone.
fn delaunay_flip(verts: &[[f64; 2]], tris: &mut Vec<[u32; 3]>, su: f64, sv: f64) {
    let p = |i: u32| [verts[i as usize][0] * su, verts[i as usize][1] * sv];
    let min_angle = |a: [f64; 2], b: [f64; 2], c: [f64; 2]| -> f64 {
        let l = |x: [f64; 2], y: [f64; 2]| ((x[0] - y[0]).powi(2) + (x[1] - y[1]).powi(2)).sqrt();
        let (ab, bc, ca) = (l(a, b), l(b, c), l(c, a));
        if ab < 1e-300 || bc < 1e-300 || ca < 1e-300 {
            return 0.0;
        }
        let ang = |opp: f64, s1: f64, s2: f64| {
            ((s1 * s1 + s2 * s2 - opp * opp) / (2.0 * s1 * s2))
                .clamp(-1.0, 1.0)
                .acos()
        };
        ang(bc, ab, ca).min(ang(ca, ab, bc)).min(ang(ab, bc, ca))
    };
    let area2 = |a: [f64; 2], b: [f64; 2], c: [f64; 2]| {
        (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    };

    for _sweep in 0..6 {
        // interior edge -> (tri index, opposite vertex)
        let mut edge_map: HashMap<(u32, u32), Vec<(usize, u32)>> = HashMap::new();
        for (ti, t) in tris.iter().enumerate() {
            for k in 0..3 {
                let (i, j, o) = (t[k], t[(k + 1) % 3], t[(k + 2) % 3]);
                edge_map
                    .entry((i.min(j), i.max(j)))
                    .or_default()
                    .push((ti, o));
            }
        }
        let mut dirty: Vec<bool> = vec![false; tris.len()];
        let mut flips = 0usize;
        // HashMap order is randomized per process; flip in sorted edge order
        // so the triangulation (and the GLB bytes) are reproducible
        let mut edges: Vec<_> = edge_map.iter().collect();
        edges.sort_unstable_by_key(|(k, _)| **k);
        for ((i, j), adj) in edges {
            if adj.len() != 2 {
                continue;
            }
            let ((t1, o1), (t2, o2)) = (adj[0], adj[1]);
            if dirty[t1] || dirty[t2] || o1 == o2 {
                continue;
            }
            let (pi, pj, po1, po2) = (p(*i), p(*j), p(o1), p(o2));
            // candidate triangles after the flip must keep CCW orientation
            if area2(po1, po2, pj) <= 1e-18 || area2(po2, po1, pi) <= 1e-18 {
                continue;
            }
            let before = min_angle(pi, pj, po1).min(min_angle(pj, pi, po2));
            let after = min_angle(po1, po2, pj).min(min_angle(po2, po1, pi));
            if after > before + 1e-12 {
                tris[t1] = [o1, o2, *j];
                tris[t2] = [o2, o1, *i];
                dirty[t1] = true;
                dirty[t2] = true;
                flips += 1;
            }
        }
        if flips == 0 {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geom::{v3, BSplineSurface, Surface};

    /// A 0.5 mm-wide ribbon folded back and forth several times along v — the
    /// extreme-aspect lofted strip that defeats tess2 on its inverted boundary
    /// (cf. vendor faces #4941516 / #4947113). Thin in u, long and folded in v.
    fn folded_ribbon() -> Surface {
        let nv = 60usize;
        let deg_v = 3usize;
        let width = 0.5;
        let mut cps = Vec::new();
        for iu in 0..2 {
            for k in 0..nv {
                cps.push(v3(
                    2.0 * k as f64,
                    40.0 * (0.4 * k as f64).sin(),
                    iu as f64 * width,
                ));
            }
        }
        let mut knots_v = vec![0.0; deg_v + 1];
        for k in 1..(nv - deg_v) {
            knots_v.push(k as f64);
        }
        knots_v.extend(std::iter::repeat_n((nv - deg_v) as f64, deg_v + 1));
        Surface::BSpline(
            BSplineSurface {
                deg_u: 1,
                deg_v,
                nu: 2,
                nv,
                cps,
                weights: None,
                knots_u: vec![0.0, 0.0, 1.0, 1.0],
                knots_v,
                closed_u: false,
                closed_v: false,
                size: 0.0,
            }
            .finish(),
        )
    }

    fn domain(s: &Surface) -> ((f64, f64), (f64, f64)) {
        match s {
            Surface::BSpline(b) => b.domain(),
            _ => unreachable!(),
        }
    }

    /// True surface area from a dense reference grid.
    fn ref_area(s: &Surface) -> f64 {
        let ((u0, u1), (v0, v1)) = domain(s);
        let (nu, nv) = (8usize, 4000usize);
        let pt = |i: usize, j: usize| {
            s.point(
                u0 + (u1 - u0) * i as f64 / nu as f64,
                v0 + (v1 - v0) * j as f64 / nv as f64,
            )
        };
        let mut a = 0.0;
        for j in 0..nv {
            for i in 0..nu {
                let (p00, p10, p01, p11) = (pt(i, j), pt(i + 1, j), pt(i, j + 1), pt(i + 1, j + 1));
                a += p10.sub(p00).cross(p01.sub(p00)).len() * 0.5;
                a += p10.sub(p11).cross(p01.sub(p11)).len() * 0.5;
            }
        }
        a
    }

    fn mesh_area(m: &TriMesh) -> f64 {
        let p = |i: u32| {
            v3(
                m.positions[i as usize * 3] as f64,
                m.positions[i as usize * 3 + 1] as f64,
                m.positions[i as usize * 3 + 2] as f64,
            )
        };
        m.indices
            .chunks(3)
            .map(|t| p(t[1]).sub(p(t[0])).cross(p(t[2]).sub(p(t[0]))).len() * 0.5)
            .sum()
    }

    #[test]
    fn full_patch_grid_recovers_a_folded_strip_that_defeats_tess2() {
        let s = folded_ribbon();
        let ((u0, u1), (v0, v1)) = domain(&s);
        // the face boundary covers the whole knot domain (rails + caps)
        let contour = vec![vec![[u0, v0], [u1, v0], [u1, v1], [u0, v1]]];
        let tp = TessParams {
            deflection: 0.1,
            max_angle: 20.0_f64.to_radians(),
        };
        let mut mesh = TriMesh::default();
        assert!(
            tessellate_full_patch(&s, &contour, &tp, true, &mut mesh),
            "full-patch fallback must accept and grid the strip"
        );
        let (got, want) = (mesh_area(&mesh), ref_area(&s));
        // The decisive anti-garbage check: triangles that bridge across folds
        // (tess2's failure mode here, and what the pre-fix path produced) add
        // huge spurious area — the broken mesh measured ~800x the true area.
        assert!(
            (got - want).abs() < 0.02 * want,
            "gridded area {got} vs reference {want}"
        );
        // and it must actually have gridded the strip, not collapsed to a few
        // spanning triangles
        assert!(mesh.indices.len() / 3 > 100, "implausibly few triangles");
        // every vertex lies on the surface
        for c in mesh.positions.chunks(3) {
            let p = v3(c[0] as f64, c[1] as f64, c[2] as f64);
            let (u, v) = s.uv(p, None);
            assert!(
                s.point(u, v).sub(p).len() < 1e-2,
                "off-surface vertex {p:?}"
            );
        }
    }

    #[test]
    fn complement_interior_flags_only_non_nesting_loops() {
        let outer = vec![[0.0, 0.0], [4.0, 0.0], [4.0, 4.0], [0.0, 4.0]];
        // a hole nested inside the outer boundary is the ordinary case
        let hole = vec![[1.0, 1.0], [2.0, 1.0], [2.0, 2.0], [1.0, 2.0]];
        assert!(!complement_interior(&[outer.clone(), hole]));
        // a loop sitting entirely outside the largest one cannot be a nested
        // hole: the face interior must be the complement (seam-straddling)
        let elsewhere = vec![[10.0, 1.0], [11.0, 1.0], [11.0, 2.0], [10.0, 2.0]];
        assert!(complement_interior(&[outer, elsewhere]));
        // a single loop is never a complement boundary
        assert!(!complement_interior(&[vec![
            [0.0, 0.0],
            [1.0, 0.0],
            [1.0, 1.0]
        ]]));
    }

    #[test]
    fn surface_is_planar_detects_coplanar_control_nets() {
        use crate::geom::BSplineSurface;
        let mk = |cps: Vec<V3>| {
            Surface::BSpline(
                BSplineSurface {
                    deg_u: 1,
                    deg_v: 1,
                    nu: 2,
                    nv: 2,
                    cps,
                    weights: None,
                    knots_u: vec![0.0, 0.0, 1.0, 1.0],
                    knots_v: vec![0.0, 0.0, 1.0, 1.0],
                    closed_u: false,
                    closed_v: false,
                    size: 0.0,
                }
                .finish(),
            )
        };
        // a coplanar 2x2 quad (all z = 0) is geometrically a plane
        let flat = mk(vec![
            v3(0., 0., 0.),
            v3(10., 0., 0.),
            v3(0., 10., 0.),
            v3(10., 10., 0.),
        ]);
        assert!(surface_is_planar(&flat));
        // lifting one corner makes it a genuine bilinear saddle, not a plane
        let saddle = mk(vec![
            v3(0., 0., 0.),
            v3(10., 0., 0.),
            v3(0., 10., 0.),
            v3(10., 10., 5.),
        ]);
        assert!(!surface_is_planar(&saddle));
    }

    #[test]
    fn point_in_poly_basics() {
        let sq = [[0.0, 0.0], [2.0, 0.0], [2.0, 2.0], [0.0, 2.0]];
        assert!(point_in_poly([1.0, 1.0], &sq));
        assert!(!point_in_poly([3.0, 1.0], &sq));
        assert!(!point_in_poly([-1.0, 1.0], &sq));
    }

    #[test]
    fn patched_tess2_fails_soft_without_panicking() {
        // Drive the (vendored, fail-soft) tess2 directly — bypassing run_tess2's
        // catch_unwind — with degenerate / self-intersecting contours that
        // stress the sweep. The patch must make it return a bool (success or a
        // clean failure) rather than panicking on a freed region; on wasm a
        // panic here would abort the whole module.
        use tess2_rust::{ElementType, Tessellator, WindingRule};
        let nasty: &[&[f64]] = &[
            &[0., 0., 1., 1., 1., 0., 0., 1., 0., 0.], // self-intersecting bowtie
            &[0., 0., 0., 0., 1., 0., 1., 0., 0., 1.], // repeated/coincident verts
            &[0., 0., 1., 0., 2., 0., 3., 0.],         // fully collinear (zero area)
        ];
        for c in nasty {
            let mut t = Tessellator::new();
            t.add_contour(2, c);
            // the assertion is simply that this call returns at all
            let _ = t.tessellate(WindingRule::Odd, ElementType::Polygons, 3, 2, None);
        }
    }

    #[test]
    fn sanitize_contour_drops_zero_length_edges() {
        // a square with a repeated vertex and a closing duplicate
        let c = vec![
            [0.0, 0.0],
            [0.0, 0.0], // coincident with previous
            [1.0, 0.0],
            [1.0, 1.0],
            [0.0, 1.0],
            [0.0, 0.0], // closing duplicate of the first
        ];
        let flat = sanitize_contour(&c, 1.0, 1.0).expect("4 distinct corners");
        assert_eq!(flat.len(), 8, "4 distinct points × 2 coords");
        // an all-coincident contour has no area → dropped
        assert!(sanitize_contour(&[[5.0, 5.0], [5.0, 5.0], [5.0, 5.0]], 1.0, 1.0).is_none());
    }

    #[test]
    fn full_patch_gate_grids_a_rectangular_sub_patch() {
        // A rectangle covering only the first 30% of v is still a valid
        // (sub-)rectangular patch: gridding its bbox reproduces it, so the gate
        // must accept it (not reject on coverage alone).
        let s = folded_ribbon();
        let ((u0, u1), (v0, v1)) = domain(&s);
        let vm = v0 + 0.3 * (v1 - v0);
        let contour = vec![vec![[u0, v0], [u1, v0], [u1, vm], [u0, vm]]];
        let tp = TessParams {
            deflection: 0.1,
            max_angle: 20.0_f64.to_radians(),
        };
        let mut mesh = TriMesh::default();
        assert!(tessellate_full_patch(&s, &contour, &tp, true, &mut mesh));
        assert!(mesh.indices.len() / 3 > 50, "should grid the sub-rectangle");
    }

    #[test]
    fn full_patch_gate_rejects_a_non_rectangular_sub_region() {
        // A triangular boundary covering only PART of the knot domain (a genuine
        // trimmed sub-region, not the whole surface) encloses ~half its bbox;
        // the gate must reject it so the grid doesn't over-fill past the trim.
        let s = folded_ribbon();
        let ((u0, u1), (v0, v1)) = domain(&s);
        let (um, vm) = (u0 + 0.5 * (u1 - u0), v0 + 0.5 * (v1 - v0));
        let contour = vec![vec![[u0, v0], [um, v0], [u0, vm]]]; // triangle in a quarter
        let tp = TessParams {
            deflection: 0.1,
            max_angle: 20.0_f64.to_radians(),
        };
        let mut mesh = TriMesh::default();
        assert!(
            !tessellate_full_patch(&s, &contour, &tp, true, &mut mesh),
            "a non-rectangular sub-region must not be grid-filled"
        );
        assert!(
            mesh.indices.is_empty(),
            "rejected gate must not emit geometry"
        );
    }

    #[test]
    fn full_wrap_grids_a_closed_bspline_covering_its_domain() {
        use crate::geom::BSplineSurface;
        // a closed-in-u B-spline tube: deg 1 around (4 points), deg 3 along v
        let (nu, nv, deg_v) = (4usize, 6usize, 3usize);
        let mut cps = Vec::new();
        for k in 0..nv {
            for iu in 0..nu {
                let a = iu as f64 / nu as f64 * std::f64::consts::TAU;
                cps.push(v3(2.0 * a.cos(), 2.0 * a.sin(), 3.0 * k as f64));
            }
        }
        let mut knots_v = vec![0.0; deg_v + 1];
        for k in 1..(nv - deg_v) {
            knots_v.push(k as f64);
        }
        knots_v.extend(std::iter::repeat_n((nv - deg_v) as f64, deg_v + 1));
        let s = Surface::BSpline(
            BSplineSurface {
                deg_u: 1,
                deg_v,
                nu,
                nv,
                cps,
                weights: None,
                knots_u: vec![0.0, 1.0, 2.0, 3.0, 4.0],
                knots_v,
                closed_u: true,
                closed_v: false,
                size: 0.0,
            }
            .finish(),
        );
        assert!(s.u_period().is_some(), "closed_u surface is periodic in u");
        let ((u0, u1), (v0, v1)) = domain(&s);
        // a boundary covering the whole domain (the full tube) is a full wrap
        let full = vec![vec![[u0, v0], [u1, v0], [u1, v1], [u0, v1]]];
        assert!(full_wrap_bspline(&s, &full).is_some());
        // a small corner region is not a full wrap (would over-fill the rest)
        let part = vec![vec![
            [u0, v0],
            [u0 + 0.1 * (u1 - u0), v0],
            [u0, v0 + 0.1 * (v1 - v0)],
        ]];
        assert!(full_wrap_bspline(&s, &part).is_none());
    }

    #[test]
    fn bspline_v_pole_detects_a_collapsed_control_row() {
        use crate::geom::BSplineSurface;
        // a closed-in-u dome: deg-1 ring of 4 points around u, deg-1 along v,
        // whose top v-row (iv = nv-1) collapses to a single apex point
        let (nu, nv) = (4usize, 2usize);
        let mk = |apex_collapsed: bool| {
            // row-major: cps[iu * nv + iv], matching BSplineSurface indexing
            let mut cps = Vec::new();
            for iu in 0..nu {
                for iv in 0..nv {
                    let a = iu as f64 / nu as f64 * std::f64::consts::TAU;
                    if iv == nv - 1 && apex_collapsed {
                        cps.push(v3(0.0, 0.0, 5.0)); // shared apex
                    } else {
                        cps.push(v3(2.0 * a.cos(), 2.0 * a.sin(), 3.0 * iv as f64));
                    }
                }
            }
            Surface::BSpline(
                BSplineSurface {
                    deg_u: 1,
                    deg_v: 1,
                    nu,
                    nv,
                    cps,
                    weights: None,
                    knots_u: vec![0.0, 1.0, 2.0, 3.0, 4.0],
                    knots_v: vec![0.0, 0.0, 1.0, 1.0],
                    closed_u: true,
                    closed_v: false,
                    size: 0.0,
                }
                .finish(),
            )
        };
        // the collapsed top row is a parametric pole (cone apex / dome tip)
        assert!(bspline_has_v_pole(&mk(true)));
        // an ordinary open tube has no collapsed row
        assert!(!bspline_has_v_pole(&mk(false)));
        // analytic surfaces are not B-splines: no pole reported here
        assert!(!bspline_has_v_pole(&Surface::Plane(
            crate::geom::Frame::new(V3::ZERO, None, None)
        )));
    }

    #[test]
    fn full_domain_self_intersection_distinguishes_wound_strip_from_clean_trim() {
        // A high-aspect wound strip is the full parametric patch but its boundary
        // projects to a self-crossing UV polygon; a clean trim is a simple one.
        // The grid path keys on exactly this: full-domain span + self-crossing.
        let s = folded_ribbon();
        let ((u0, u1), (v0, v1)) = domain(&s);
        // a clean rectangle spanning the domain: full-domain, but simple
        let simple = vec![[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
        assert!(full_domain_bspline(&s, std::slice::from_ref(&simple)).is_some());
        assert!(!poly_self_intersects(&simple));
        // a bowtie spanning the domain: full-domain AND self-crossing (its two
        // diagonals cross) — the wound-strip tell
        let bowtie = vec![[u0, v0], [u1, v1], [u1, v0], [u0, v1]];
        assert!(full_domain_bspline(&s, std::slice::from_ref(&bowtie)).is_some());
        assert!(poly_self_intersects(&bowtie));
        // a small clean triangle in a sub-region is neither full-domain nor self-
        // crossing, so it is left to tess2 (no over-fill)
        let (um, vm) = (u0 + 0.4 * (u1 - u0), v0 + 0.4 * (v1 - v0));
        let tri = vec![[u0, v0], [um, v0], [u0, vm]];
        assert!(full_domain_bspline(&s, std::slice::from_ref(&tri)).is_none());
        assert!(!poly_self_intersects(&tri));
    }
}
