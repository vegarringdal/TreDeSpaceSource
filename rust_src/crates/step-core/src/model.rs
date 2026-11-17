//! Typed accessors over the lazy STEP index: points, directions, placements,
//! surface construction and edge-curve discretization.

use std::collections::HashMap;

use crate::geom::*;
use crate::step::{StepFile, P, TYPE_COMPLEX};

/// SI length-unit prefix -> metres. (`SI_UNIT(prefix, .METRE.)`.)
fn si_prefix_scale(prefix: Option<&str>) -> f64 {
    match prefix {
        Some("MILLI") => 0.001,
        Some("CENTI") => 0.01,
        Some("DECI") => 0.1,
        Some("DECA") => 10.0,
        Some("HECTO") => 100.0,
        Some("KILO") => 1000.0,
        Some("MICRO") => 1e-6,
        Some("NANO") => 1e-9,
        _ => 1.0,
    }
}

/// Length scale (to metres) of one unit entity, if it is a length unit: a
/// metre `SI_UNIT(prefix,.METRE.)` (plain or inside a complex `LENGTH_UNIT`) or
/// an inch/foot `CONVERSION_BASED_UNIT`. Returns `None` for angle/other units.
fn length_unit_scale(sf: &StepFile, unit: u32) -> Option<f64> {
    // an SI metre unit is a length unit whether or not it is tagged LENGTH_UNIT
    let si = sf.complex_leaf(unit, "SI_UNIT").or_else(|| {
        sf.params(unit)
            .filter(|_| sf.entity_type(unit) == Some("SI_UNIT"))
    });
    if let Some(si) = si {
        let mut prefix = None;
        let mut metre = false;
        for v in &si {
            if let P::Enum(e) = v {
                if e == "METRE" {
                    metre = true;
                } else {
                    prefix = Some(e.clone());
                }
            }
        }
        if metre {
            return Some(si_prefix_scale(prefix.as_deref()));
        }
    }
    // CONVERSION_BASED_UNIT('INCH'|'FOOT', ...) — only when tagged a length unit
    if sf.complex_leaf(unit, "LENGTH_UNIT").is_some() {
        if let Some(cbu) = sf.complex_leaf(unit, "CONVERSION_BASED_UNIT") {
            return match cbu
                .iter()
                .find_map(|v| v.as_str())?
                .trim_matches('"')
                .to_ascii_uppercase()
                .as_str()
            {
                "INCH" => Some(0.0254),
                "FOOT" => Some(0.3048),
                _ => None,
            };
        }
    }
    None
}

/// The file's global length-unit scale to metres — the first length unit among
/// the unit entities (plain SI_UNITs, then complex units), matching the scan a
/// single-context file would use. `None` if no length unit is declared. Shared
/// by the GLB unit scaling and the per-instance transform unit handling so they
/// stay consistent.
pub fn file_length_scale(sf: &StepFile) -> Option<f64> {
    for &id in sf.of_type("SI_UNIT") {
        if let Some(s) = length_unit_scale(sf, id) {
            return Some(s);
        }
    }
    let cty = sf.type_id(TYPE_COMPLEX)?;
    sf.by_type
        .get(&cty)?
        .iter()
        .find_map(|&id| length_unit_scale(sf, id))
}

/// Length-unit scale (to metres) of a SHAPE_REPRESENTATION's own context, if it
/// carries a `GLOBAL_UNIT_ASSIGNED_CONTEXT` with a length unit. Some CAD
/// systems mix mm and metre contexts in one file, so geometry must be scaled per
/// representation rather than by a single global unit.
pub fn representation_length_scale(sf: &StepFile, rep: u32) -> Option<f64> {
    // SHAPE_REPRESENTATION('name', (items), context)
    let ctx = sf.params(rep)?.get(2).and_then(|v| v.as_ref_id())?;
    let assigned = sf.complex_leaf(ctx, "GLOBAL_UNIT_ASSIGNED_CONTEXT")?;
    assigned
        .iter()
        .filter_map(|v| v.as_list())
        .flat_map(|l| l.iter().filter_map(|v| v.as_ref_id()))
        .find_map(|u| length_unit_scale(sf, u))
}

/// Factor to bring a representation's geometry into the file's global unit, so a
/// metre-context part in an otherwise-mm file is sized consistently before the
/// global unit scaling. 1.0 when the representation has no own unit or already
/// matches the global one.
pub fn rep_unit_factor(sf: &StepFile, rep: u32, global_scale: f64) -> f64 {
    match representation_length_scale(sf, rep) {
        Some(s) if global_scale.abs() > 1e-300 => s / global_scale,
        _ => 1.0,
    }
}

/// Radians per one of `unit`, if `unit` is a plane-angle unit. SI radian → 1.0;
/// a `CONVERSION_BASED_UNIT('DEGREE'|'GRAD', …)` → the exact factor by name
/// (mirrors how length handles INCH/FOOT). `None` if it isn't a plane-angle
/// unit.
fn plane_angle_unit_scale(sf: &StepFile, unit: u32) -> Option<f64> {
    if sf.complex_leaf(unit, "PLANE_ANGLE_UNIT").is_none()
        && sf.entity_type(unit) != Some("PLANE_ANGLE_UNIT")
    {
        return None;
    }
    if let Some(si) = sf.complex_leaf(unit, "SI_UNIT") {
        if si.iter().any(|v| matches!(v, P::Enum(e) if e == "RADIAN")) {
            return Some(1.0);
        }
    }
    if let Some(cbu) = sf.complex_leaf(unit, "CONVERSION_BASED_UNIT") {
        return match cbu
            .iter()
            .find_map(|v| v.as_str())?
            .trim_matches('"')
            .to_ascii_uppercase()
            .as_str()
        {
            "DEGREE" | "DEGREES" => Some(std::f64::consts::PI / 180.0),
            "GRAD" | "GRADIAN" | "GON" => Some(std::f64::consts::PI / 200.0),
            _ => None,
        };
    }
    None
}

/// Radians per the file's plane-angle unit (1.0 for SI radians, π/180 for a
/// degree context). STEP angle measures — notably a `CONICAL_SURFACE`'s
/// `semi_angle` — are in this unit, and some exporters declare degrees via a
/// `CONVERSION_BASED_UNIT`. Reads the unit the global context actually
/// **assigns** (not the radian base that the degree conversion references), so a
/// degree file isn't mistaken for radians.
pub fn file_plane_angle_scale(sf: &StepFile) -> f64 {
    let cty = match sf.type_id(TYPE_COMPLEX) {
        Some(t) => t,
        None => return 1.0,
    };
    let Some(ids) = sf.by_type.get(&cty) else {
        return 1.0;
    };
    for &id in ids {
        if let Some(assigned) = sf.complex_leaf(id, "GLOBAL_UNIT_ASSIGNED_CONTEXT") {
            if let Some(s) = assigned
                .iter()
                .filter_map(|v| v.as_list())
                .flat_map(|l| l.iter().filter_map(|v| v.as_ref_id()))
                .find_map(|u| plane_angle_unit_scale(sf, u))
            {
                return s;
            }
        }
    }
    1.0
}

pub fn cartesian_point(sf: &StepFile, id: u32) -> Option<V3> {
    // CARTESIAN_POINT('', (x, y, z))
    let p = sf.params(id)?;
    let l = p.get(1)?.as_list()?;
    Some(v3(
        l.first()?.as_f64()?,
        l.get(1).and_then(|v| v.as_f64()).unwrap_or(0.0),
        l.get(2).and_then(|v| v.as_f64()).unwrap_or(0.0),
    ))
}

pub fn direction(sf: &StepFile, id: u32) -> Option<V3> {
    let p = sf.params(id)?;
    let l = p.get(1)?.as_list()?;
    Some(
        v3(
            l.first()?.as_f64()?,
            l.get(1).and_then(|v| v.as_f64()).unwrap_or(0.0),
            l.get(2).and_then(|v| v.as_f64()).unwrap_or(0.0),
        )
        .norm(),
    )
}

/// AXIS2_PLACEMENT_3D('', location, axis?, ref_direction?)
pub fn axis2_placement(sf: &StepFile, id: u32) -> Option<Frame> {
    let p = sf.params(id)?;
    let o = p
        .get(1)
        .and_then(|v| v.as_ref_id())
        .and_then(|r| cartesian_point(sf, r))
        .unwrap_or(V3::ZERO);
    let axis = p
        .get(2)
        .and_then(|v| v.as_ref_id())
        .and_then(|r| direction(sf, r));
    let refd = p
        .get(3)
        .and_then(|v| v.as_ref_id())
        .and_then(|r| direction(sf, r));
    Some(Frame::new(o, axis, refd))
}

pub fn axis2_matrix(sf: &StepFile, id: u32) -> M4 {
    axis2_placement(sf, id)
        .map(|f| f.to_m4())
        .unwrap_or(M4::IDENTITY)
}

/// Build an evaluatable surface from a STEP surface entity. Swept surfaces
/// with line/circle generatrices are reduced to the equivalent analytic
/// surface (closed-form UV inversion); everything else evaluates directly.
pub fn surface(sf: &StepFile, id: u32) -> Option<Surface> {
    let ty = sf.entity_type(id)?;
    if ty == crate::step::TYPE_COMPLEX {
        // rational B-spline surface in complex-instance form
        return bspline_surface_complex(sf, id).map(Surface::BSpline);
    }
    let p = sf.params(id)?;
    let frame = |i: usize| {
        p.get(i)
            .and_then(|v| v.as_ref_id())
            .and_then(|r| axis2_placement(sf, r))
    };
    match ty {
        "PLANE" => Some(Surface::Plane(frame(1)?)),
        "CYLINDRICAL_SURFACE" => Some(Surface::Cylinder(frame(1)?, p.get(2)?.as_f64()?)),
        // semi_angle is a plane-angle measure — convert from the file's angle
        // unit to radians (degree-context files declare it via a
        // CONVERSION_BASED_UNIT), else a 45° cone read as 45 rad becomes a near
        // -flat disk.
        "CONICAL_SURFACE" => Some(Surface::Cone(
            frame(1)?,
            p.get(2)?.as_f64()?,
            p.get(3)?.as_f64()? * file_plane_angle_scale(sf),
        )),
        "SPHERICAL_SURFACE" => Some(Surface::Sphere(frame(1)?, p.get(2)?.as_f64()?)),
        "TOROIDAL_SURFACE" | "DEGENERATE_TOROIDAL_SURFACE" => Some(Surface::Torus(
            frame(1)?,
            p.get(2)?.as_f64()?,
            p.get(3)?.as_f64()?,
        )),
        "SURFACE_OF_LINEAR_EXTRUSION" => {
            // ('', swept_curve, extrusion_axis VECTOR)
            let curve = curve3(sf, p.get(1)?.as_ref_id()?)?;
            let dir = vector(sf, p.get(2)?.as_ref_id()?)?;
            Some(reduce_extrusion(curve, dir))
        }
        "SURFACE_OF_REVOLUTION" => {
            // ('', swept_curve, axis AXIS1_PLACEMENT)
            let curve = curve3(sf, p.get(1)?.as_ref_id()?)?;
            let axis = axis1_placement(sf, p.get(2)?.as_ref_id()?)?;
            Some(reduce_revolution(curve, axis))
        }
        "B_SPLINE_SURFACE_WITH_KNOTS" => bspline_surface_simple(sf, &p).map(Surface::BSpline),
        "UNIFORM_SURFACE" | "QUASI_UNIFORM_SURFACE" | "BEZIER_SURFACE" => {
            // no-knot B-spline surface forms: the knot vector is implied by the
            // type and synthesized from the degree + control-net dimensions
            bspline_surface_form(sf, &p, KnotForm::from_type(ty)?, None).map(Surface::BSpline)
        }
        "RECTANGULAR_TRIMMED_SURFACE" => {
            // ('', basis_surface, u1, u2, v1, v2, usense, vsense): a window onto
            // the basis surface's parameter domain. A face that uses it carries
            // explicit boundary loops that lie on the basis (and within the
            // window), so those loops are the authoritative trim — resolve to the
            // basis and tessellate normally. The u1/u2/v1/v2 window is redundant
            // for a bounded face, and usense/vsense only flip the *trimmed*
            // surface's own parameterization, which we never use.
            surface(sf, p.get(1)?.as_ref_id()?)
        }
        "OFFSET_SURFACE" => {
            // ('', basis_surface, distance, self_intersect): every point of the
            // basis moved `distance` along the basis normal. Shares the basis
            // parameter space, so trimming loops invert through the offset.
            let basis = surface(sf, p.get(1)?.as_ref_id()?)?;
            let d = p.get(2)?.as_f64()?;
            if d == 0.0 {
                return Some(basis);
            }
            Some(Surface::Offset {
                basis: Box::new(basis),
                d,
            })
        }
        _ => None,
    }
}

/// VECTOR('', direction, magnitude) -> scaled direction
pub fn vector(sf: &StepFile, id: u32) -> Option<V3> {
    let p = sf.params(id)?;
    let d = direction(sf, p.get(1)?.as_ref_id()?)?;
    let m = p.get(2).and_then(|v| v.as_f64()).unwrap_or(1.0);
    Some(d.scale(m))
}

/// AXIS1_PLACEMENT('', location, axis)
pub fn axis1_placement(sf: &StepFile, id: u32) -> Option<Frame> {
    let p = sf.params(id)?;
    let o = p
        .get(1)
        .and_then(|v| v.as_ref_id())
        .and_then(|r| cartesian_point(sf, r))
        .unwrap_or(V3::ZERO);
    let axis = p
        .get(2)
        .and_then(|v| v.as_ref_id())
        .and_then(|r| direction(sf, r));
    Some(Frame::new(o, axis, None))
}

// ------------------------------------------------------- evaluatable curves

/// Build an evaluatable `Curve3` from a STEP curve entity.
pub fn curve3(sf: &StepFile, id: u32) -> Option<Curve3> {
    let ty = sf.entity_type(id)?;
    match ty {
        "LINE" => {
            let p = sf.params(id)?;
            Some(Curve3::Line {
                p: cartesian_point(sf, p.get(1)?.as_ref_id()?)?,
                d: vector(sf, p.get(2)?.as_ref_id()?)?,
            })
        }
        "CIRCLE" => {
            let p = sf.params(id)?;
            Some(Curve3::Circle {
                f: axis2_placement(sf, p.get(1)?.as_ref_id()?)?,
                r: p.get(2)?.as_f64()?,
            })
        }
        "ELLIPSE" => {
            let p = sf.params(id)?;
            Some(Curve3::Ellipse {
                f: axis2_placement(sf, p.get(1)?.as_ref_id()?)?,
                a: p.get(2)?.as_f64()?,
                b: p.get(3)?.as_f64()?,
            })
        }
        "POLYLINE" => {
            let p = sf.params(id)?;
            let pts: Vec<V3> = p
                .get(1)?
                .as_list()?
                .iter()
                .filter_map(|v| v.as_ref_id())
                .filter_map(|r| cartesian_point(sf, r))
                .collect();
            if pts.len() >= 2 {
                Some(Curve3::Polyline(pts))
            } else {
                None
            }
        }
        "B_SPLINE_CURVE_WITH_KNOTS" => {
            let p = sf.params(id)?;
            bspline_curve3(sf, &p, None)
        }
        "UNIFORM_CURVE" | "QUASI_UNIFORM_CURVE" | "BEZIER_CURVE" => {
            // no-knot B-spline curve forms: knots implied by the type
            let p = sf.params(id)?;
            bspline_curve3_form(sf, &p, KnotForm::from_type(ty)?, None)
        }
        "TRIMMED_CURVE" | "SURFACE_CURVE" | "SEAM_CURVE" => {
            let p = sf.params(id)?;
            curve3(sf, p.get(1)?.as_ref_id()?)
        }
        crate::step::TYPE_COMPLEX => {
            let core = sf.complex_leaf(id, "B_SPLINE_CURVE_WITH_KNOTS")?;
            let base = sf.complex_leaf(id, "B_SPLINE_CURVE")?;
            let weights = sf
                .complex_leaf(id, "RATIONAL_B_SPLINE_CURVE")
                .and_then(|w| w.first().and_then(|l| l.as_list().map(|l| l.to_vec())))
                .map(|l| l.iter().filter_map(|v| v.as_f64()).collect::<Vec<f64>>());
            // merge fields of both leaves and parse
            let mut merged = base;
            merged.extend(core);
            bspline_curve3(sf, &merged, weights)
        }
        // HYPERBOLA / PARABOLA are deliberately absent: as swept-surface
        // profiles they would need a finite parameter domain for the Newton
        // UV inversion, and an unbounded conic has no principled finite window
        // without the trimming face (any cap is a magic number). They *are*
        // supported as edge geometry via the adaptive discretizer in
        // `curve_polyline`, and profile use is tallied in the report.
        _ => None,
    }
}

/// Assemble a `Curve3::BSpline` from B_SPLINE_CURVE(_WITH_KNOTS) params
/// (field positions detected dynamically, as in `bspline_polyline_core`).
fn bspline_curve3(sf: &StepFile, params: &[P], weights: Option<Vec<f64>>) -> Option<Curve3> {
    let mut degree: Option<usize> = None;
    let mut cps: Option<Vec<V3>> = None;
    let mut num_lists: Vec<Vec<f64>> = Vec::new();
    for p in params {
        match p {
            P::I(v) if degree.is_none() => degree = Some((*v).max(1) as usize),
            P::L(l) => {
                if !l.is_empty() && l.iter().all(|e| matches!(e, P::Ref(_))) {
                    if cps.is_none() {
                        cps = Some(
                            l.iter()
                                .filter_map(|e| e.as_ref_id())
                                .filter_map(|r| cartesian_point(sf, r))
                                .collect(),
                        );
                    }
                } else if !l.is_empty() && l.iter().all(|e| matches!(e, P::I(_) | P::F(_))) {
                    num_lists.push(l.iter().filter_map(|e| e.as_f64()).collect());
                }
            }
            _ => {}
        }
    }
    let degree = degree?;
    let cps = cps?;
    if cps.len() < 2 || num_lists.len() < 2 {
        return None;
    }
    let mults = &num_lists[num_lists.len() - 2];
    let knots_u = &num_lists[num_lists.len() - 1];
    let mut knots = Vec::new();
    for (m, k) in mults.iter().zip(knots_u.iter()) {
        for _ in 0..(*m as usize) {
            knots.push(*k);
        }
    }
    if knots.len() != cps.len() + degree + 1 {
        return None;
    }
    if let Some(w) = &weights {
        if w.len() != cps.len() {
            return None;
        }
    }
    Some(Curve3::BSpline {
        degree,
        knots,
        cps,
        weights,
    })
}

// --------------------------------------------------------- swept reductions

/// Extrusion of a line is a plane; extrusion of a circle along its own axis
/// is a cylinder. Everything else stays a general extrusion surface.
pub fn reduce_extrusion(curve: Curve3, dir: V3) -> Surface {
    match &curve {
        Curve3::Line { p, d } => {
            let n = d.cross(dir);
            if n.len() > 1e-12 {
                return Surface::Plane(Frame::new(*p, Some(n.norm()), Some(d.norm())));
            }
            Surface::Extrusion { curve, dir }
        }
        Curve3::Circle { f, r } => {
            if f.z.cross(dir.norm()).len() < 1e-9 {
                let sign = if f.z.dot(dir) >= 0.0 { 1.0 } else { -1.0 };
                let frame = Frame::new(f.o, Some(f.z.scale(sign)), Some(f.x));
                return Surface::Cylinder(frame, *r);
            }
            Surface::Extrusion { curve, dir }
        }
        _ => Surface::Extrusion { curve, dir },
    }
}

/// Revolved lines coplanar with the axis reduce to cylinders/cones/planes;
/// revolved circles coplanar with the axis reduce to spheres/tori.
pub fn reduce_revolution(curve: Curve3, axis: Frame) -> Surface {
    let in_axis = |p: V3| {
        let d = p.sub(axis.o);
        (
            d.sub(axis.z.scale(d.dot(axis.z))), // radial vector
            d.dot(axis.z),                      // height
        )
    };
    match &curve {
        Curve3::Line { p, d } => {
            let (rad, _) = in_axis(*p);
            let dn = d.norm();
            // coplanar with the axis: direction lies in span(z, radial dir)
            let radial_dir = if rad.len() > 1e-12 {
                rad.norm()
            } else {
                // line starts on the axis; use the direction's radial part
                let dr = dn.sub(axis.z.scale(dn.dot(axis.z)));
                if dr.len() < 1e-12 {
                    // line *is* the axis -> degenerate
                    return Surface::Revolution { curve, axis };
                }
                dr.norm()
            };
            let out_of_plane = dn
                .sub(axis.z.scale(dn.dot(axis.z)))
                .sub(radial_dir.scale(dn.sub(axis.z.scale(dn.dot(axis.z))).dot(radial_dir)));
            if out_of_plane.len() > 1e-9 {
                return Surface::Revolution { curve, axis };
            }
            let dz = dn.dot(axis.z);
            let drad = dn.dot(radial_dir);
            if drad.abs() < 1e-12 {
                // parallel to axis -> cylinder, radius = radial distance
                let frame = Frame::new(axis.o, Some(axis.z), Some(radial_dir));
                return Surface::Cylinder(frame, rad.len());
            }
            if dz.abs() < 1e-12 {
                // perpendicular to axis -> plane (annulus)
                let (_, h) = in_axis(*p);
                let frame = Frame::new(axis.o.add(axis.z.scale(h)), Some(axis.z), Some(radial_dir));
                return Surface::Plane(frame);
            }
            // slanted -> cone: radius at the axis frame origin's height plane
            let (rad0, h0) = in_axis(*p);
            let slope = drad / dz; // d radius / d height
            let r_at_origin = rad0.len() - h0 * slope;
            let frame = Frame::new(axis.o, Some(axis.z), Some(radial_dir));
            return Surface::Cone(frame, r_at_origin, slope.atan());
        }
        Curve3::Circle { f, r } => {
            // circle plane must contain the axis direction
            if f.z.dot(axis.z).abs() < 1e-9 {
                let (rad, h) = in_axis(f.o);
                if rad.len() < 1e-9 {
                    // centered on the axis -> sphere
                    let frame = Frame::new(axis.o.add(axis.z.scale(h)), Some(axis.z), None);
                    return Surface::Sphere(frame, *r);
                }
                let frame = Frame::new(axis.o.add(axis.z.scale(h)), Some(axis.z), Some(rad.norm()));
                return Surface::Torus(frame, rad.len(), *r);
            }
            Surface::Revolution { curve, axis }
        }
        _ => Surface::Revolution { curve, axis },
    }
}

// ------------------------------------------------------- B-spline surfaces

/// B_SPLINE_SURFACE_WITH_KNOTS('name', u_deg, v_deg, ((cps)), form,
///   u_closed, v_closed, self_isect, (u_mults), (v_mults), (u_knots),
///   (v_knots), spec)
fn bspline_surface_simple(sf: &StepFile, p: &[P]) -> Option<BSplineSurface> {
    let deg_u = p.get(1)?.as_i64()? as usize;
    let deg_v = p.get(2)?.as_i64()? as usize;
    let net = parse_control_net(sf, p.get(3)?)?;
    let closed_u = p.get(5).and_then(|v| v.as_bool()).unwrap_or(false);
    let closed_v = p.get(6).and_then(|v| v.as_bool()).unwrap_or(false);
    let knots_u = expand_knots(p.get(8)?, p.get(10)?)?;
    let knots_v = expand_knots(p.get(9)?, p.get(11)?)?;
    build_bspline_surface(
        deg_u, deg_v, net, None, knots_u, knots_v, closed_u, closed_v,
    )
}

/// Complex-instance (usually rational) form: fields are split across the
/// B_SPLINE_SURFACE, B_SPLINE_SURFACE_WITH_KNOTS and RATIONAL_B_SPLINE_SURFACE
/// leaves.
pub fn bspline_surface_complex(sf: &StepFile, id: u32) -> Option<BSplineSurface> {
    let base = sf.complex_leaf(id, "B_SPLINE_SURFACE")?;
    // B_SPLINE_SURFACE(u_deg, v_deg, ((cps)), form, u_closed, v_closed, si)
    let mut ints: Vec<i64> = Vec::new();
    let mut net: Option<(usize, usize, Vec<V3>)> = None;
    let mut bools: Vec<bool> = Vec::new();
    for v in &base {
        match v {
            P::I(i) => ints.push(*i),
            P::L(_) if net.is_none() => net = parse_control_net(sf, v),
            P::Enum(e) if e == "T" || e == "F" => bools.push(e == "T"),
            _ => {}
        }
    }
    if ints.len() < 2 {
        return None;
    }
    let (deg_u, deg_v) = (ints[0].max(1) as usize, ints[1].max(1) as usize);
    let net = net?;

    let wk = sf.complex_leaf(id, "B_SPLINE_SURFACE_WITH_KNOTS")?;
    // four numeric lists: u_mults, v_mults, u_knots, v_knots
    let lists: Vec<Vec<f64>> = wk
        .iter()
        .filter_map(|v| v.as_list())
        .filter(|l| !l.is_empty() && l.iter().all(|e| matches!(e, P::I(_) | P::F(_))))
        .map(|l| l.iter().filter_map(|e| e.as_f64()).collect())
        .collect();
    if lists.len() < 4 {
        return None;
    }
    let expand = |m: &Vec<f64>, k: &Vec<f64>| -> Vec<f64> {
        let mut out = Vec::new();
        for (mm, kk) in m.iter().zip(k.iter()) {
            for _ in 0..(*mm as usize) {
                out.push(*kk);
            }
        }
        out
    };
    let knots_u = expand(&lists[0], &lists[2]);
    let knots_v = expand(&lists[1], &lists[3]);

    let weights = sf
        .complex_leaf(id, "RATIONAL_B_SPLINE_SURFACE")
        .and_then(|w| {
            let rows: Vec<Vec<f64>> = w
                .iter()
                .filter_map(|v| v.as_list())
                .flat_map(|outer| {
                    outer
                        .iter()
                        .filter_map(|row| row.as_list())
                        .map(|row| row.iter().filter_map(|e| e.as_f64()).collect::<Vec<f64>>())
                        .collect::<Vec<_>>()
                })
                .collect();
            if rows.is_empty() {
                None
            } else {
                Some(rows.into_iter().flatten().collect::<Vec<f64>>())
            }
        });

    let (cu, cv) = (
        bools.first().copied().unwrap_or(false),
        bools.get(1).copied().unwrap_or(false),
    );
    build_bspline_surface(deg_u, deg_v, net, weights, knots_u, knots_v, cu, cv)
}

fn parse_control_net(sf: &StepFile, p: &P) -> Option<(usize, usize, Vec<V3>)> {
    let rows = p.as_list()?;
    let nu = rows.len();
    let mut nv = 0usize;
    let mut cps = Vec::new();
    for row in rows {
        let row = row.as_list()?;
        if nv == 0 {
            nv = row.len();
        } else if nv != row.len() {
            return None;
        }
        for r in row {
            cps.push(cartesian_point(sf, r.as_ref_id()?)?);
        }
    }
    if nu == 0 || nv == 0 {
        None
    } else {
        Some((nu, nv, cps))
    }
}

fn expand_knots(mults: &P, knots: &P) -> Option<Vec<f64>> {
    let m = mults.as_list()?;
    let k = knots.as_list()?;
    let mut out = Vec::new();
    for (mm, kk) in m.iter().zip(k.iter()) {
        let mm = mm.as_i64()? as usize;
        let kk = kk.as_f64()?;
        for _ in 0..mm {
            out.push(kk);
        }
    }
    Some(out)
}

#[allow(clippy::too_many_arguments)]
fn build_bspline_surface(
    deg_u: usize,
    deg_v: usize,
    net: (usize, usize, Vec<V3>),
    weights: Option<Vec<f64>>,
    knots_u: Vec<f64>,
    knots_v: Vec<f64>,
    closed_u: bool,
    closed_v: bool,
) -> Option<BSplineSurface> {
    let (nu, nv, cps) = net;
    if knots_u.len() != nu + deg_u + 1 || knots_v.len() != nv + deg_v + 1 {
        return None;
    }
    if let Some(w) = &weights {
        if w.len() != nu * nv {
            return None;
        }
    }
    Some(
        BSplineSurface {
            deg_u,
            deg_v,
            nu,
            nv,
            cps,
            weights,
            knots_u,
            knots_v,
            closed_u,
            closed_v,
            size: 0.0,
        }
        .finish(),
    )
}

/// A B-spline form whose knot vector is *implied* rather than listed (ISO
/// 10303-42: `uniform_curve`/`_surface`, `quasi_uniform_*`, `bezier_*`).
#[derive(Clone, Copy)]
enum KnotForm {
    /// every knot equally spaced, multiplicity 1 (ends included → not clamped)
    Uniform,
    /// ends clamped (multiplicity d+1), interior knots uniform multiplicity 1
    QuasiUniform,
    /// piecewise Bézier: ends multiplicity d+1, interior breakpoints d
    Bezier,
}

impl KnotForm {
    /// Map a STEP entity type name to its implied-knot form, if any.
    fn from_type(ty: &str) -> Option<KnotForm> {
        match ty {
            "UNIFORM_CURVE" | "UNIFORM_SURFACE" => Some(KnotForm::Uniform),
            "QUASI_UNIFORM_CURVE" | "QUASI_UNIFORM_SURFACE" => Some(KnotForm::QuasiUniform),
            "BEZIER_CURVE" | "BEZIER_SURFACE" => Some(KnotForm::Bezier),
            _ => None,
        }
    }
}

/// Synthesize the implied knot vector for a no-knot B-spline form, per ISO
/// 10303-42. `n` is the control-point count in this direction and `d` the
/// degree; the result always has `n + d + 1` knots (the well-formedness rule
/// `Σ multiplicities = n + d + 1`). Returns None for a control-point count the
/// form cannot represent (e.g. a Bézier net that is not a whole number of
/// degree-d segments).
fn synthesize_knots(form: KnotForm, d: usize, n: usize) -> Option<Vec<f64>> {
    if n < d + 1 {
        return None;
    }
    let total = n + d + 1;
    let knots: Vec<f64> = match form {
        KnotForm::Uniform => (0..total).map(|i| i as f64).collect(),
        KnotForm::QuasiUniform => {
            let interior = n - d - 1; // distinct interior knots, multiplicity 1
            let mut v = vec![0.0; d + 1];
            v.extend((1..=interior).map(|j| j as f64));
            v.extend(std::iter::repeat_n((interior + 1) as f64, d + 1));
            v
        }
        KnotForm::Bezier => {
            if d == 0 || !(n - 1).is_multiple_of(d) {
                return None; // not a clean run of degree-d Bézier segments
            }
            let segs = (n - 1) / d;
            let mut v = vec![0.0; d + 1];
            for s in 1..segs {
                v.extend(std::iter::repeat_n(s as f64, d));
            }
            v.extend(std::iter::repeat_n(segs as f64, d + 1));
            v
        }
    };
    (knots.len() == total).then_some(knots)
}

/// Build a `Curve3::BSpline` from a no-knot B-spline curve form (UNIFORM_CURVE
/// etc.): fields are degree, control_points_list (per the B_SPLINE_CURVE
/// supertype); the knot vector is synthesized from `form`.
fn bspline_curve3_form(
    sf: &StepFile,
    params: &[P],
    form: KnotForm,
    weights: Option<Vec<f64>>,
) -> Option<Curve3> {
    let degree = params.get(1)?.as_i64()?.max(1) as usize;
    let cps: Vec<V3> = params
        .get(2)?
        .as_list()?
        .iter()
        .filter_map(|e| e.as_ref_id())
        .filter_map(|r| cartesian_point(sf, r))
        .collect();
    if cps.len() < 2 {
        return None;
    }
    if let Some(w) = &weights {
        if w.len() != cps.len() {
            return None;
        }
    }
    let knots = synthesize_knots(form, degree, cps.len())?;
    Some(Curve3::BSpline {
        degree,
        knots,
        cps,
        weights,
    })
}

/// Build a `BSplineSurface` from a no-knot B-spline surface form
/// (UNIFORM_SURFACE etc.): fields are u_degree, v_degree, control_points_list,
/// surface_form, u_closed, v_closed (per the B_SPLINE_SURFACE supertype); both
/// knot vectors are synthesized from `form`.
fn bspline_surface_form(
    sf: &StepFile,
    p: &[P],
    form: KnotForm,
    weights: Option<Vec<f64>>,
) -> Option<BSplineSurface> {
    let deg_u = p.get(1)?.as_i64()?.max(1) as usize;
    let deg_v = p.get(2)?.as_i64()?.max(1) as usize;
    let net = parse_control_net(sf, p.get(3)?)?;
    let closed_u = p.get(5).and_then(|v| v.as_bool()).unwrap_or(false);
    let closed_v = p.get(6).and_then(|v| v.as_bool()).unwrap_or(false);
    let knots_u = synthesize_knots(form, deg_u, net.0)?;
    let knots_v = synthesize_knots(form, deg_v, net.1)?;
    build_bspline_surface(
        deg_u, deg_v, net, weights, knots_u, knots_v, closed_u, closed_v,
    )
}

// ------------------------------------------------------------- edge sampling

pub struct TessParams {
    pub deflection: f64,
    pub max_angle: f64, // radians
}

/// Discretize an ORIENTED_EDGE (or EDGE_CURVE) into a 3D polyline that starts
/// at the edge start vertex and ends at the edge end vertex, honouring
/// orientation. The last point is included.
pub fn edge_polyline(
    sf: &StepFile,
    id: u32,
    tp: &TessParams,
    unsup: &mut HashMap<String, usize>,
) -> Option<Vec<V3>> {
    let ty = sf.entity_type(id)?;
    let (edge_id, flip_oriented) = if ty == "ORIENTED_EDGE" {
        // ORIENTED_EDGE('', *, *, edge, orientation)
        let p = sf.params(id)?;
        let edge = p.get(3)?.as_ref_id()?;
        let orient = p.get(4).and_then(|v| v.as_bool()).unwrap_or(true);
        (edge, !orient)
    } else {
        (id, false)
    };

    // EDGE_CURVE('', start_vertex, end_vertex, curve, same_sense)
    let p = sf.params(edge_id)?;
    let sv = vertex_point(sf, p.get(1)?.as_ref_id()?)?;
    let ev = vertex_point(sf, p.get(2)?.as_ref_id()?)?;
    // The 3D curve may be omitted ($): a legal EDGE_CURVE between two known
    // vertices with no separate geometry is a straight segment. Don't let a
    // null (or unresolved) curve drop the whole edge — and hence the loop and
    // the entire face — to None.
    let curve = p.get(3).and_then(|v| v.as_ref_id());
    let same_sense = p.get(4).and_then(|v| v.as_bool()).unwrap_or(true);

    let (a, b) = if same_sense { (sv, ev) } else { (ev, sv) };
    let mut pts = curve
        .and_then(|c| curve_polyline(sf, c, a, b, tp, unsup))
        .unwrap_or_else(|| vec![a, b]);
    if !same_sense {
        pts.reverse();
    }
    if flip_oriented {
        pts.reverse();
    }
    Some(pts)
}

fn vertex_point(sf: &StepFile, id: u32) -> Option<V3> {
    // VERTEX_POINT('', point)
    let p = sf.params(id)?;
    cartesian_point(sf, p.get(1)?.as_ref_id()?)
}

/// Discretize `curve` from `a` to `b` (3D positions of the trimming vertices).
/// `unsup` tallies curve types we don't support (the edge then falls back to a
/// Adaptively sample a parametric curve `eval` over `[t0, t1]`, subdividing each
/// span until its chord sag and turn angle meet the tessellation tolerance.
/// Returns the points in order, `eval(t0)` first and `eval(t1)` last. Used for
/// the open conics (hyperbola, parabola) whose curvature varies along the curve.
fn sample_param_curve(eval: &dyn Fn(f64) -> V3, t0: f64, t1: f64, tp: &TessParams) -> Vec<V3> {
    fn refine(
        eval: &dyn Fn(f64) -> V3,
        ta: f64,
        tb: f64,
        pa: V3,
        pb: V3,
        tp: &TessParams,
        depth: u32,
        out: &mut Vec<V3>,
    ) {
        let tm = 0.5 * (ta + tb);
        let pm = eval(tm);
        let sag = pm.sub(pa.add(pb).scale(0.5)).len();
        let (v1, v2) = (pm.sub(pa), pb.sub(pm));
        let (l1, l2) = (v1.len(), v2.len());
        let ang = if l1 < 1e-12 || l2 < 1e-12 {
            0.0
        } else {
            (v1.dot(v2) / (l1 * l2)).clamp(-1.0, 1.0).acos()
        };
        if depth < 20 && (sag > tp.deflection || ang > tp.max_angle) {
            refine(eval, ta, tm, pa, pm, tp, depth + 1, out);
            refine(eval, tm, tb, pm, pb, tp, depth + 1, out);
        } else {
            out.push(pb);
        }
    }
    let (pa, pb) = (eval(t0), eval(t1));
    let mut out = vec![pa];
    refine(eval, t0, t1, pa, pb, tp, 0, &mut out);
    out
}

/// Map ISO 10303-42 surface parameters onto our [`Surface`] parameterization:
/// angle-valued directions are given in the file's plane-angle unit (`ang` =
/// radians per file unit), and the cone's ISO `v` runs along the slant while
/// ours runs along the axis. `None` for surfaces whose ISO parameter range is
/// exporter-dependent (extrusion / revolution) — callers tally those.
pub fn iso_uv(surf: &Surface, ang: f64, u: f64, v: f64) -> Option<(f64, f64)> {
    match surf {
        Surface::Plane(_) | Surface::BSpline(_) => Some((u, v)),
        Surface::Cylinder(..) => Some((u * ang, v)),
        Surface::Cone(_, _, alpha) => Some((u * ang, v * alpha.cos())),
        Surface::Sphere(..) | Surface::Torus(..) => Some((u * ang, v * ang)),
        Surface::Offset { basis, .. } => iso_uv(basis, ang, u, v),
        _ => None,
    }
}

/// PCURVE('', basis_surface, DEFINITIONAL_REPRESENTATION): a curve given in
/// the basis surface's parameter space. Used when an edge's 3D geometry is
/// omitted (`$`) or unsupported — the 2D curve is discretized over its own
/// bounded domain, mapped through the surface, then oriented/snapped to the
/// edge's trimming vertices `a`/`b`.
///
/// Parameter conventions per ISO 10303-42: angle-parameterized directions are
/// in the file's plane-angle unit; the cone's ISO `v` runs along the slant,
/// while our [`Surface::Cone`] `v` runs along the axis (factor `cos α`).
/// Extrusion / revolution / trimmed basis surfaces have exporter-dependent
/// parameter ranges — left unhandled (tallied) rather than guessed.
fn pcurve_polyline(
    sf: &StepFile,
    id: u32,
    a: V3,
    b: V3,
    tp: &TessParams,
    unsup: &mut HashMap<String, usize>,
) -> Option<Vec<V3>> {
    let p = sf.params(id)?;
    let surf = surface(sf, p.get(1)?.as_ref_id()?)?;
    let ang = file_plane_angle_scale(sf);
    if iso_uv(&surf, ang, 0.0, 0.0).is_none() {
        *unsup.entry("PCURVE".to_string()).or_insert(0) += 1;
        return None;
    }
    let to3d = |u: f64, v: f64| -> V3 {
        let (u, v) = iso_uv(&surf, ang, u, v).unwrap();
        surf.point(u, v)
    };

    // DEFINITIONAL_REPRESENTATION('', (items), context): the 2D curve. Only
    // *bounded* 2D curves carry their own domain (an unbounded LINE pcurve
    // would need a parameter inverse to trim) — curve_endpoints supplies it.
    let dr = sf.params(p.get(2)?.as_ref_id()?)?;
    let c2 = dr
        .get(1)?
        .as_list()?
        .iter()
        .filter_map(|v| v.as_ref_id())
        .next()?;
    let (ua, ub) = curve_endpoints(sf, c2)?;
    let uv = curve_polyline(sf, c2, ua, ub, tp, unsup)?;
    if uv.len() < 2 {
        return None;
    }

    let mut pts: Vec<V3> = uv.iter().map(|q| to3d(q.x, q.y)).collect();
    // orient the mapped chain to run a -> b, then snap the ends exactly onto
    // the edge's topological vertices
    let fwd = a.sub(pts[0]).len() + b.sub(*pts.last()?).len();
    let rev = a.sub(*pts.last()?).len() + b.sub(pts[0]).len();
    if rev < fwd {
        pts.reverse();
    }
    *pts.first_mut()? = a;
    *pts.last_mut()? = b;
    Some(pts)
}

/// Discretize a *closed* profile boundary curve (the boundaries of a
/// CURVE_BOUNDED_SURFACE / swept-area profile: BOUNDARY_CURVE,
/// OUTER_BOUNDARY_CURVE, a bare CIRCLE, …) into a closed 3D polyline
/// (first point == last point). The curve carries no edge vertices, so the
/// discretization is seeded with a point on the curve itself (a == b, which
/// the closed-curve branches treat as a full turn).
pub fn boundary_polyline(
    sf: &StepFile,
    id: u32,
    tp: &TessParams,
    unsup: &mut HashMap<String, usize>,
) -> Option<Vec<V3>> {
    let ty = sf.entity_type(id)?;
    let seed = match ty {
        "CIRCLE" | "ELLIPSE" => {
            let p = sf.params(id)?;
            let f = axis2_placement(sf, p.get(1)?.as_ref_id()?)?;
            let rx = p.get(2)?.as_f64()?;
            f.o.add(f.x.scale(rx))
        }
        "COMPOSITE_CURVE" | "BOUNDARY_CURVE" | "OUTER_BOUNDARY_CURVE" => {
            // start of the first segment (oriented by its same_sense flag)
            let p = sf.params(id)?;
            let seg = p.get(1)?.as_list()?.first()?.as_ref_id()?;
            let sp = sf.params(seg)?;
            let same = sp.get(1).and_then(|v| v.as_bool()).unwrap_or(true);
            let (s, e) = curve_endpoints(sf, sp.get(2)?.as_ref_id()?)?;
            if same {
                s
            } else {
                e
            }
        }
        _ => curve_endpoints(sf, id)?.0,
    };
    let pts = curve_polyline(sf, id, seed, seed, tp, unsup)?;
    if pts.len() < 3 {
        return None;
    }
    Some(pts)
}

/// Natural 3D start/end of a *bounded* curve (its own parameterization extent),
/// used to drive each segment of a `COMPOSITE_CURVE` (whose segments carry no
/// trim parameters of their own — the parent curve is bounded per WR1).
fn curve_endpoints(sf: &StepFile, id: u32) -> Option<(V3, V3)> {
    let ty = sf.entity_type(id)?;
    let p = sf.params(id)?;
    match ty {
        "POLYLINE" => {
            let l = p.get(1)?.as_list()?;
            Some((
                cartesian_point(sf, l.first()?.as_ref_id()?)?,
                cartesian_point(sf, l.last()?.as_ref_id()?)?,
            ))
        }
        // a clamped B-spline passes through its first and last control points
        "B_SPLINE_CURVE_WITH_KNOTS" | "RATIONAL_B_SPLINE_CURVE" => {
            let l = p.get(2)?.as_list()?;
            Some((
                cartesian_point(sf, l.first()?.as_ref_id()?)?,
                cartesian_point(sf, l.last()?.as_ref_id()?)?,
            ))
        }
        TYPE_COMPLEX => {
            // control points live in the B_SPLINE_CURVE leaf of the complex form
            let leaf = sf.complex_leaf(id, "B_SPLINE_CURVE")?;
            let cps = leaf.iter().find_map(|v| {
                v.as_list()
                    .filter(|l| !l.is_empty() && l.iter().all(|e| e.as_ref_id().is_some()))
            })?;
            Some((
                cartesian_point(sf, cps.first()?.as_ref_id()?)?,
                cartesian_point(sf, cps.last()?.as_ref_id()?)?,
            ))
        }
        "TRIMMED_CURVE" => {
            // prefer explicit CARTESIAN_POINTs in trim_1 / trim_2, else fall back
            // to the basis curve's own endpoints
            let trim_pt = |slot: usize| -> Option<V3> {
                p.get(slot)?
                    .as_list()?
                    .iter()
                    .filter_map(|v| v.as_ref_id())
                    .find_map(|r| cartesian_point(sf, r))
            };
            let (ba, bb) =
                curve_endpoints(sf, p.get(1)?.as_ref_id()?).unwrap_or((V3::ZERO, V3::ZERO));
            Some((trim_pt(2).unwrap_or(ba), trim_pt(3).unwrap_or(bb)))
        }
        "COMPOSITE_CURVE" => {
            let segs = p.get(1)?.as_list()?;
            let seg_pt = |seg: &P, start: bool| -> Option<V3> {
                let sp = sf.params(seg.as_ref_id()?)?;
                let same = sp.get(1).and_then(|v| v.as_bool()).unwrap_or(true);
                let (s, e) = curve_endpoints(sf, sp.get(2)?.as_ref_id()?)?;
                let (s, e) = if same { (s, e) } else { (e, s) };
                Some(if start { s } else { e })
            };
            Some((seg_pt(segs.first()?, true)?, seg_pt(segs.last()?, false)?))
        }
        _ => None,
    }
}

/// Discretize a standalone *bounded* curve (e.g. a `GEOMETRIC_CURVE_SET`
/// element) over its full extent into a 3D polyline. `None` for unbounded
/// (`LINE`/`CIRCLE` with no trim) or unsupported curves.
pub fn curve_to_polyline(
    sf: &StepFile,
    id: u32,
    tp: &TessParams,
    unsup: &mut HashMap<String, usize>,
) -> Option<Vec<V3>> {
    let (a, b) = curve_endpoints(sf, id)?;
    curve_polyline(sf, id, a, b, tp, unsup)
}

/// straight chord), so a silently-straightened boundary is reported.
fn curve_polyline(
    sf: &StepFile,
    id: u32,
    a: V3,
    b: V3,
    tp: &TessParams,
    unsup: &mut HashMap<String, usize>,
) -> Option<Vec<V3>> {
    let ty = sf.entity_type(id)?;
    match ty {
        "LINE" => Some(vec![a, b]),
        "CIRCLE" | "ELLIPSE" => {
            let p = sf.params(id)?;
            let f = axis2_placement(sf, p.get(1)?.as_ref_id()?)?;
            let (rx, ry) = if ty == "CIRCLE" {
                let r = p.get(2)?.as_f64()?;
                (r, r)
            } else {
                (p.get(2)?.as_f64()?, p.get(3)?.as_f64()?)
            };
            let ang = |pt: V3| -> f64 {
                let d = pt.sub(f.o);
                (d.dot(f.y) / ry).atan2(d.dot(f.x) / rx)
            };
            let t0 = ang(a);
            let mut t1 = ang(b);
            let full = a.sub(b).len() < 1e-9 * (1.0 + rx.abs());
            if full {
                t1 = t0 + std::f64::consts::TAU;
            } else {
                while t1 <= t0 + 1e-12 {
                    t1 += std::f64::consts::TAU;
                }
            }
            let step = angle_step(rx.max(ry), tp.deflection, tp.max_angle);
            // at least 2 segments: a face bounded by just a chord and a
            // shallow arc (a sliver) needs the arc's interior point, or the
            // closed loop collapses to 2 points and the face loses its only
            // boundary
            let nseg = (((t1 - t0) / step).ceil() as usize).max(2);
            let mut pts = Vec::with_capacity(nseg + 1);
            for i in 0..=nseg {
                let t = t0 + (t1 - t0) * i as f64 / nseg as f64;
                pts.push(
                    f.o.add(f.x.scale(rx * t.cos()))
                        .add(f.y.scale(ry * t.sin())),
                );
            }
            // snap endpoints exactly to the topological vertices
            *pts.first_mut()? = a;
            *pts.last_mut()? = b;
            Some(pts)
        }
        "B_SPLINE_CURVE_WITH_KNOTS" | "RATIONAL_B_SPLINE_CURVE" => {
            bspline_polyline(sf, id, sf.params(id)?, None, a, b)
        }
        "UNIFORM_CURVE" | "QUASI_UNIFORM_CURVE" | "BEZIER_CURVE" => {
            // no-knot B-spline forms as edge geometry: synthesize the implied
            // knots from the type, then sample like any other B-spline edge
            let p = sf.params(id)?;
            let form = KnotForm::from_type(ty)?;
            let degree = p.get(1)?.as_i64()?.max(1) as usize;
            let cps: Vec<V3> = p
                .get(2)?
                .as_list()?
                .iter()
                .filter_map(|e| e.as_ref_id())
                .filter_map(|r| cartesian_point(sf, r))
                .collect();
            if cps.len() < 2 {
                return None;
            }
            let knots = synthesize_knots(form, degree, cps.len())?;
            sample_bspline_to_polyline(degree, &knots, cps, None, a, b)
        }
        "POLYLINE" => {
            let p = sf.params(id)?;
            let pts: Vec<V3> = p
                .get(1)?
                .as_list()?
                .iter()
                .filter_map(|v| v.as_ref_id())
                .filter_map(|r| cartesian_point(sf, r))
                .collect();
            if pts.len() >= 2 {
                Some(pts)
            } else {
                None
            }
        }
        "HYPERBOLA" => {
            // HYPERBOLA('', position, semi_axis, semi_imag_axis).
            // P(u) = C + semi_axis*cosh(u)*x + semi_imag_axis*sinh(u)*y
            // (ISO 10303-42; matches OpenCascade Geom_Hyperbola). The +x branch.
            let p = sf.params(id)?;
            let f = axis2_placement(sf, p.get(1)?.as_ref_id()?)?;
            let (sa, si) = (p.get(2)?.as_f64()?, p.get(3)?.as_f64()?);
            let eval = |u: f64| {
                f.o.add(f.x.scale(sa * u.cosh()))
                    .add(f.y.scale(si * u.sinh()))
            };
            let param = |pt: V3| (pt.sub(f.o).dot(f.y) / si).asinh();
            let mut pts = sample_param_curve(&eval, param(a), param(b), tp);
            *pts.first_mut()? = a;
            *pts.last_mut()? = b;
            Some(pts)
        }
        "PARABOLA" => {
            // PARABOLA('', position, focal_dist). focal_dist is the focal length:
            // P(u) = C + focal_dist*u^2*x + 2*focal_dist*u*y, giving y^2 = 4*f*x
            // locally (ISO 10303-42; OpenCascade Geom_Parabola). Vertex at u=0.
            let p = sf.params(id)?;
            let f = axis2_placement(sf, p.get(1)?.as_ref_id()?)?;
            let fd = p.get(2)?.as_f64()?;
            if fd.abs() < 1e-12 {
                return None;
            }
            let eval = |u: f64| f.o.add(f.x.scale(fd * u * u)).add(f.y.scale(2.0 * fd * u));
            let param = |pt: V3| pt.sub(f.o).dot(f.y) / (2.0 * fd);
            let mut pts = sample_param_curve(&eval, param(a), param(b), tp);
            *pts.first_mut()? = a;
            *pts.last_mut()? = b;
            Some(pts)
        }
        // BOUNDARY_CURVE / OUTER_BOUNDARY_CURVE (CURVE_BOUNDED_SURFACE and
        // swept-area profiles) are composite_curve subtypes with identical
        // parameters — same discretization
        "COMPOSITE_CURVE" | "BOUNDARY_CURVE" | "OUTER_BOUNDARY_CURVE" => {
            // COMPOSITE_CURVE('', (segments), self_intersect). Each
            // COMPOSITE_CURVE_SEGMENT(transition, same_sense, parent_curve) joins
            // end to end; parent_curve is a bounded_curve (WR1), so it has its own
            // endpoints. Discretize each parent over its extent, orient it by
            // same_sense, stitch on the shared join, then run the whole chain a->b.
            let p = sf.params(id)?;
            let segs = p.get(1)?.as_list()?;
            let eps = 1e-6 * (1.0 + a.sub(b).len());
            let mut out: Vec<V3> = Vec::new();
            for seg in segs {
                let sp = sf.params(seg.as_ref_id()?)?;
                let same = sp.get(1).and_then(|v| v.as_bool()).unwrap_or(true);
                let parent = sp.get(2)?.as_ref_id()?;
                let (s, e) = curve_endpoints(sf, parent)?;
                let (qa, qb) = if same { (s, e) } else { (e, s) };
                let mut seg_pts = curve_polyline(sf, parent, qa, qb, tp, unsup)?;
                // make the segment run qa -> qb regardless of how the parent
                // discretizer ordered it (e.g. a reversed POLYLINE)
                if seg_pts.len() >= 2 && qa.sub(seg_pts[0]).len() > qa.sub(*seg_pts.last()?).len() {
                    seg_pts.reverse();
                }
                let skip = usize::from(out.last().is_some_and(|t| t.sub(seg_pts[0]).len() < eps));
                out.extend_from_slice(&seg_pts[skip.min(seg_pts.len())..]);
            }
            if out.len() < 2 {
                return None;
            }
            // orient the assembled chain to run from the edge's a to b
            let fwd = a.sub(out[0]).len() + b.sub(*out.last()?).len();
            let rev = a.sub(*out.last()?).len() + b.sub(out[0]).len();
            if rev < fwd {
                out.reverse();
            }
            *out.first_mut()? = a;
            *out.last_mut()? = b;
            Some(out)
        }
        "SURFACE_CURVE" | "SEAM_CURVE" | "INTERSECTION_CURVE" | "BOUNDED_CURVE" => {
            // SURFACE_CURVE('', curve_3d, (pcurves), repr) -> follow the 3D
            // curve; when it is `$` or unsupported, fall back to an associated
            // p-curve evaluated through its surface
            let p = sf.params(id)?;
            if let Some(pts) = p
                .get(1)
                .and_then(|v| v.as_ref_id())
                .and_then(|c3| curve_polyline(sf, c3, a, b, tp, unsup))
            {
                return Some(pts);
            }
            p.get(2)?
                .as_list()?
                .iter()
                .filter_map(|v| v.as_ref_id())
                .find_map(|pc| pcurve_polyline(sf, pc, a, b, tp, unsup))
        }
        "PCURVE" => pcurve_polyline(sf, id, a, b, tp, unsup),
        "TRIMMED_CURVE" => {
            // TRIMMED_CURVE('', basis, trim1, trim2, sense, mode): endpoints are
            // already given by the edge vertices, just discretize the basis.
            let p = sf.params(id)?;
            curve_polyline(sf, p.get(1)?.as_ref_id()?, a, b, tp, unsup)
        }
        crate::step::TYPE_COMPLEX => {
            // rational b-spline curve expressed as a complex instance: the
            // degree and control points live in the B_SPLINE_CURVE leaf, the
            // knot vector in B_SPLINE_CURVE_WITH_KNOTS, the weights in
            // RATIONAL_B_SPLINE_CURVE — merge the leaves before parsing
            let core = sf.complex_leaf(id, "B_SPLINE_CURVE_WITH_KNOTS")?;
            let mut params = sf.complex_leaf(id, "B_SPLINE_CURVE").unwrap_or_default();
            params.extend(core);
            let weights = sf
                .complex_leaf(id, "RATIONAL_B_SPLINE_CURVE")
                .and_then(|w| w.first().and_then(|l| l.as_list().map(|l| l.to_vec())))
                .map(|l| l.iter().filter_map(|v| v.as_f64()).collect::<Vec<f64>>());
            bspline_polyline_core(sf, &params, weights, a, b, true)
        }
        _ => {
            // unsupported curve type -> caller falls back to a straight segment
            // between the edge vertices; tally it so the lost curvature is
            // reported rather than silently straightening the boundary
            *unsup.entry(ty.to_string()).or_insert(0) += 1;
            None
        }
    }
}

fn bspline_polyline(
    sf: &StepFile,
    _id: u32,
    params: Vec<P>,
    weights: Option<Vec<f64>>,
    a: V3,
    b: V3,
) -> Option<Vec<V3>> {
    bspline_polyline_core(sf, &params, weights, a, b, false)
}

/// B_SPLINE_CURVE_WITH_KNOTS('name', degree, (cps), form, closed, self_isect,
///                            (mults), (knots), spec)
/// In complex instances the leading 'name' belongs to BOUNDED_CURVE /
/// B_SPLINE_CURVE leaves and the B_SPLINE_CURVE_WITH_KNOTS leaf often carries
/// only (mults),(knots),spec — so we detect field layout dynamically.
fn bspline_polyline_core(
    sf: &StepFile,
    params: &[P],
    weights: Option<Vec<f64>>,
    a: V3,
    b: V3,
    complex: bool,
) -> Option<Vec<V3>> {
    // Locate degree (first integer), control point list (first list of refs),
    // and the two trailing numeric lists (multiplicities, knots).
    let mut degree: Option<usize> = None;
    let mut cps: Option<Vec<V3>> = None;
    let mut num_lists: Vec<Vec<f64>> = Vec::new();

    let scan = |params: &[P],
                degree: &mut Option<usize>,
                cps: &mut Option<Vec<V3>>,
                num_lists: &mut Vec<Vec<f64>>| {
        for p in params {
            match p {
                P::I(v) if degree.is_none() => *degree = Some((*v).max(1) as usize),
                P::L(l) => {
                    if !l.is_empty() && l.iter().all(|e| matches!(e, P::Ref(_))) {
                        if cps.is_none() {
                            *cps = Some(
                                l.iter()
                                    .filter_map(|e| e.as_ref_id())
                                    .filter_map(|r| cartesian_point(sf, r))
                                    .collect(),
                            );
                        }
                    } else if !l.is_empty() && l.iter().all(|e| matches!(e, P::I(_) | P::F(_))) {
                        num_lists.push(l.iter().filter_map(|e| e.as_f64()).collect());
                    }
                }
                _ => {}
            }
        }
    };

    scan(params, &mut degree, &mut cps, &mut num_lists);

    // In complex instances the cps may live in the B_SPLINE_CURVE leaf
    if complex && cps.is_none() {
        // params came from the WITH_KNOTS leaf only; cannot recover here
        return None;
    }

    let degree = degree?;
    let cps = cps?;
    if cps.len() < 2 || num_lists.len() < 2 {
        return None;
    }
    let mults = &num_lists[num_lists.len() - 2];
    let knots_u = &num_lists[num_lists.len() - 1];

    let mut knots: Vec<f64> = Vec::new();
    for (m, k) in mults.iter().zip(knots_u.iter()) {
        for _ in 0..(*m as usize) {
            knots.push(*k);
        }
    }
    if knots.len() != cps.len() + degree + 1 {
        // malformed; fall back to control polygon
        let mut pts = cps;
        *pts.first_mut()? = a;
        *pts.last_mut()? = b;
        return Some(pts);
    }

    sample_bspline_to_polyline(degree, &knots, cps, weights, a, b)
}

/// Sample a B-spline curve with an explicit knot vector into a polyline over its
/// parametric domain, then align the result to the edge's trimming vertices
/// a/b. Shared by the explicit-knot path and the no-knot forms (UNIFORM /
/// QUASI_UNIFORM / BEZIER), whose knots are synthesized first.
fn sample_bspline_to_polyline(
    degree: usize,
    knots: &[f64],
    cps: Vec<V3>,
    weights: Option<Vec<f64>>,
    a: V3,
    b: V3,
) -> Option<Vec<V3>> {
    if knots.len() != cps.len() + degree + 1 {
        return None;
    }
    // A rational curve needs one weight per control point; a truncated or
    // padded list (or a non-numeric token silently dropped upstream) would
    // index out of bounds inside the de Boor evaluation. The surface and
    // curve3 paths validate this at construction — mirror them here.
    if let Some(w) = &weights {
        if w.len() != cps.len() {
            return None;
        }
    }
    let w = weights.as_deref();
    let t0 = knots[degree];
    let t1 = knots[knots.len() - 1 - degree];
    let nseg = (cps.len().max(degree + 1) * 4).clamp(8, 512);
    let mut pts = Vec::with_capacity(nseg + 1);
    for i in 0..=nseg {
        let t = t0 + (t1 - t0) * i as f64 / nseg as f64;
        pts.push(bspline_curve_point(degree, knots, &cps, w, t));
    }
    let mut pts = align_polyline_to_vertices(pts, a, b);
    *pts.first_mut()? = a;
    *pts.last_mut()? = b;
    Some(pts)
}

/// Align a sampled basis-curve polyline with the edge's trimming vertices.
/// Exporters trim edges to interior stretches of the basis curve, and close
/// closed edges at a vertex away from the curve's own parametric seam —
/// blindly snapping the curve's natural endpoints onto such vertices folds the
/// polyline through long false chords (and the face's UV contour with it).
fn align_polyline_to_vertices(pts: Vec<V3>, a: V3, b: V3) -> Vec<V3> {
    let n = pts.len();
    if n < 3 {
        return pts;
    }
    let mut step = 0.0f64;
    let mut len = 0.0f64;
    for i in 1..n {
        let d = pts[i].sub(pts[i - 1]).len();
        step = step.max(d);
        len += d;
    }
    let tol = step.max(1e-12);
    if pts[0].sub(a).len() <= tol && pts[n - 1].sub(b).len() <= tol {
        return pts; // vertices sit on the curve endpoints (the common case)
    }
    let nearest = |q: V3, ring: &[V3]| -> usize {
        let mut bi = 0usize;
        let mut bd = f64::MAX;
        for (i, p) in ring.iter().enumerate() {
            let d = p.sub(q).len();
            if d < bd {
                bd = d;
                bi = i;
            }
        }
        bi
    };
    if pts[0].sub(pts[n - 1]).len() <= 1e-6 * len.max(1e-9) {
        // closed basis curve: walk the ring forward from a to b (an edge
        // follows increasing parameter, wrapping through the curve's seam)
        let ring = &pts[..n - 1];
        let m = ring.len();
        let ia = nearest(a, ring);
        let span = if a.sub(b).len() <= tol {
            m // closed edge: the full ring, re-seamed at the vertex
        } else {
            let ib = nearest(b, ring);
            if ia == ib {
                return pts; // degenerate trim: keep the old behaviour
            }
            (ib + m - ia) % m
        };
        (0..=span).map(|k| ring[(ia + k) % m]).collect()
    } else {
        // open curve trimmed to an interior stretch
        let ia = nearest(a, &pts);
        let ib = nearest(b, &pts);
        if ia < ib {
            pts[ia..=ib].to_vec()
        } else {
            pts // vertices against the parameter direction: leave as-is
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn synthesize_knots_matches_iso_10303_42_forms() {
        // total knot count is always n + d + 1 for every form
        let total = |d: usize, n: usize| n + d + 1;

        // uniform: equally spaced, multiplicity 1 throughout (not clamped)
        let u = synthesize_knots(KnotForm::Uniform, 3, 5).unwrap();
        assert_eq!(u, vec![0., 1., 2., 3., 4., 5., 6., 7., 8.]);
        assert_eq!(u.len(), total(3, 5));

        // quasi-uniform: ends clamped (mult d+1), interior uniform mult 1
        let q = synthesize_knots(KnotForm::QuasiUniform, 3, 5).unwrap();
        assert_eq!(q, vec![0., 0., 0., 0., 1., 2., 2., 2., 2.]);
        assert_eq!(q.len(), total(3, 5));
        // minimal quasi-uniform net (n = d+1) has no interior knots → Bézier
        let q2 = synthesize_knots(KnotForm::QuasiUniform, 2, 3).unwrap();
        assert_eq!(q2, vec![0., 0., 0., 1., 1., 1.]);

        // single Bézier segment: ends mult d+1, no interior
        let b1 = synthesize_knots(KnotForm::Bezier, 3, 4).unwrap();
        assert_eq!(b1, vec![0., 0., 0., 0., 1., 1., 1., 1.]);
        assert_eq!(b1.len(), total(3, 4));
        // piecewise Bézier: two degree-2 segments → interior breakpoint mult d
        let b2 = synthesize_knots(KnotForm::Bezier, 2, 5).unwrap();
        assert_eq!(b2, vec![0., 0., 0., 1., 1., 2., 2., 2.]);
        assert_eq!(b2.len(), total(2, 5));
        // a control-point count that is not a whole number of segments is invalid
        assert!(synthesize_knots(KnotForm::Bezier, 2, 4).is_none());

        // fewer control points than degree+1 cannot form a curve
        assert!(synthesize_knots(KnotForm::Uniform, 3, 3).is_none());

        // every synthesized vector is non-decreasing and clamps a valid domain
        for form in [KnotForm::Uniform, KnotForm::QuasiUniform, KnotForm::Bezier] {
            let k = synthesize_knots(form, 3, 7).unwrap();
            assert!(k.windows(2).all(|w| w[1] >= w[0]), "knots must be sorted");
            assert!(k[k.len() - 1 - 3] > k[3], "domain must be non-empty");
        }
    }
}
