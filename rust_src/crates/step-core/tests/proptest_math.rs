//! Property-based fuzzing of the custom geometry kernel (`src/geom.rs`).
//!
//! The math here is hand-rolled — NURBS evaluation, analytic (u,v) inversion and
//! seeded Newton projection — so the decisive robustness question is not "is one
//! example right" but "can *any* finite input make it panic, hang, or return
//! NaN/∞". proptest throws thousands of random surfaces, curves and query points
//! at the public entry points and asserts: bounded (every loop already caps its
//! iterations, so a hang shows up as a timeout), no panic, finite output, and —
//! for the closed-form invertible surfaces — a correct point round-trip.

use proptest::prelude::*;
use step_core::geom::{angle_step, v3, BSplineSurface, Curve3, Frame, Surface, V3};

fn fin(p: V3) -> bool {
    p.x.is_finite() && p.y.is_finite() && p.z.is_finite()
}

prop_compose! {
    fn pt(range: f64)(x in -range..range, y in -range..range, z in -range..range) -> V3 {
        v3(x, y, z)
    }
}

// A frame with a guaranteed non-degenerate axis (z biased away from zero) so
// the analytic round-trip tests exercise a real coordinate system.
prop_compose! {
    fn frame()(
        o in pt(1e3),
        ax in -2.0..2.0f64, ay in -2.0..2.0f64, az in 0.3..2.0f64,
        rx in -2.0..2.0f64, ry in -2.0..2.0f64, rz in -2.0..2.0f64,
    ) -> Frame {
        Frame::new(o, Some(v3(ax, ay, az)), Some(v3(rx, ry, rz)))
    }
}

/// Clamped ("quasi-uniform") knot vector: ends multiplicity `deg+1`, interior
/// knots multiplicity 1 — always `n + deg + 1` knots for `n >= deg + 1`.
fn clamped_knots(deg: usize, n: usize) -> Vec<f64> {
    let interior = n - deg - 1;
    let mut k = vec![0.0; deg + 1];
    k.extend((1..=interior).map(|j| j as f64));
    k.extend(std::iter::repeat_n((interior + 1) as f64, deg + 1));
    k
}

/// A random (non-rational) B-spline surface with a clamped knot vector. Control
/// nets range from a single Bézier patch up to 8 extra rows/cols per direction.
fn bspline_surface() -> impl Strategy<Value = BSplineSurface> {
    (1usize..=3, 1usize..=3, 0usize..=6, 0usize..=6).prop_flat_map(|(du, dv, eu, ev)| {
        let (nu, nv) = (du + 1 + eu, dv + 1 + ev);
        proptest::collection::vec((-1e3..1e3f64, -1e3..1e3f64, -1e3..1e3f64), nu * nv).prop_map(
            move |raw| {
                let cps = raw.iter().map(|&(x, y, z)| v3(x, y, z)).collect();
                BSplineSurface {
                    deg_u: du,
                    deg_v: dv,
                    nu,
                    nv,
                    cps,
                    weights: None,
                    knots_u: clamped_knots(du, nu),
                    knots_v: clamped_knots(dv, nv),
                    closed_u: false,
                    closed_v: false,
                    size: 0.0,
                }
                .finish()
            },
        )
    })
}

/// One of each analytic surface kind with realistic, non-degenerate parameters.
fn analytic_surface() -> impl Strategy<Value = Surface> {
    prop_oneof![
        frame().prop_map(Surface::Plane),
        (frame(), 0.1..1e3f64).prop_map(|(f, r)| Surface::Cylinder(f, r)),
        (frame(), 0.1..1e3f64, -1.4..1.4f64).prop_map(|(f, r, a)| Surface::Cone(f, r, a)),
        (frame(), 0.1..1e3f64).prop_map(|(f, r)| Surface::Sphere(f, r)),
        (frame(), 1.0..1e3f64, 0.05..0.9f64).prop_map(|(f, maj, frac)| Surface::Torus(
            f,
            maj,
            maj * frac
        )),
    ]
}

// ----------------------------------------------------------------- NURBS eval

proptest! {
    #[test]
    fn bspline_surface_point_is_finite(s in bspline_surface(), tu in 0.0..1.0f64, tv in 0.0..1.0f64) {
        let ((u0, u1), (v0, v1)) = s.domain();
        let p = s.point(u0 + (u1 - u0) * tu, v0 + (v1 - v0) * tv);
        prop_assert!(fin(p), "NURBS surface point not finite: {p:?}");
    }

    #[test]
    fn bspline_curve_point_is_finite(
        deg in 1usize..=3, extra in 0usize..=8,
        raw in proptest::collection::vec((-1e3..1e3f64, -1e3..1e3f64, -1e3..1e3f64), 2..16),
        t in 0.0..1.0f64,
    ) {
        let n = deg + 1 + extra;
        prop_assume!(raw.len() >= n);
        let cps: Vec<V3> = raw[..n].iter().map(|&(x, y, z)| v3(x, y, z)).collect();
        let curve = Curve3::BSpline { degree: deg, knots: clamped_knots(deg, n), cps, weights: None };
        let (t0, t1) = curve.domain();
        let p = curve.point(t0 + (t1 - t0) * t);
        prop_assert!(fin(p), "NURBS curve point not finite: {p:?}");
    }
}

// ------------------------------------------------- seeded Newton / analytic inversion

proptest! {
    #![proptest_config(ProptestConfig::with_cases(1024))]

    #[test]
    fn bspline_surface_inversion_never_nans(s in bspline_surface(), p in pt(2e3)) {
        let surf = Surface::BSpline(s);
        let (u, v) = surf.uv(p, None);
        prop_assert!(u.is_finite() && v.is_finite(), "NURBS uv() not finite: ({u},{v})");
        // the projected foot must also be a finite surface point
        prop_assert!(fin(surf.point(u, v)));
    }

    #[test]
    fn analytic_inversion_never_nans(s in analytic_surface(), p in pt(2e3)) {
        let (u, v) = s.uv(p, None);
        prop_assert!(u.is_finite() && v.is_finite(), "analytic uv() not finite: ({u},{v})");
        prop_assert!(fin(s.point(u, v)));
    }

    // a hint seeded from a *previous, possibly unrelated* boundary point is the
    // real call pattern (continuity seeding); it must never destabilize uv()
    #[test]
    fn inversion_with_arbitrary_hint_never_nans(
        s in analytic_surface(), p in pt(2e3), hu in -1e4..1e4f64, hv in -1e4..1e4f64,
    ) {
        let (u, v) = s.uv(p, Some((hu, hv)));
        prop_assert!(u.is_finite() && v.is_finite(), "hinted uv() not finite: ({u},{v})");
    }
}

// --------------------------- closed-form inverse round-trip + scalar helpers

proptest! {
    #![proptest_config(ProptestConfig::with_cases(512))]

    #[test]
    fn plane_and_cylinder_roundtrip(
        f in frame(), r in 0.5..500.0f64, u in -3.1..3.1f64, v in -500.0..500.0f64, plane in any::<bool>(),
    ) {
        // a point built ON the surface must invert back to a point at the same
        // place (u may be modular / poles excepted, but the 3D foot is exact)
        let s = if plane { Surface::Plane(f) } else { Surface::Cylinder(f, r) };
        let p = s.point(u, v);
        let (u2, v2) = s.uv(p, None);
        let q = s.point(u2, v2);
        let scale = 1.0 + p.sub(f.o).len();
        prop_assert!(q.sub(p).len() < 1e-6 * scale, "roundtrip drift {} (p={p:?} q={q:?})", q.sub(p).len());
    }

    #[test]
    fn angle_step_is_bounded(r in -1e4..1e4f64, defl in 0.0..1e3f64, max in 0.0..3.2f64) {
        let a = angle_step(r, defl, max);
        prop_assert!(a.is_finite() && a > 0.0, "angle_step out of range: {a}");
    }

    #[test]
    fn conic_curves_are_finite(
        f in frame(), a in 0.1..1e3f64, b in 0.1..1e3f64, t in -10.0..10.0f64, kind in 0u8..3,
    ) {
        let c = match kind {
            0 => Curve3::Circle { f, r: a },
            1 => Curve3::Ellipse { f, a, b },
            _ => Curve3::Line { p: f.o, d: v3(a, b, 1.0) },
        };
        prop_assert!(fin(c.point(t)), "conic curve point not finite");
    }
}
