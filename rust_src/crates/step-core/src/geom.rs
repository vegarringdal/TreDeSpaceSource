//! Small geometry kernel: vectors, 4x4 transforms, analytic surfaces and
//! B-spline curve evaluation. No external math dependency to keep the
//! footprint small.

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct V3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

pub const fn v3(x: f64, y: f64, z: f64) -> V3 {
    V3 { x, y, z }
}

impl V3 {
    pub const ZERO: V3 = v3(0.0, 0.0, 0.0);
    pub fn add(self, o: V3) -> V3 {
        v3(self.x + o.x, self.y + o.y, self.z + o.z)
    }
    pub fn sub(self, o: V3) -> V3 {
        v3(self.x - o.x, self.y - o.y, self.z - o.z)
    }
    pub fn scale(self, s: f64) -> V3 {
        v3(self.x * s, self.y * s, self.z * s)
    }
    pub fn dot(self, o: V3) -> f64 {
        self.x * o.x + self.y * o.y + self.z * o.z
    }
    pub fn cross(self, o: V3) -> V3 {
        v3(
            self.y * o.z - self.z * o.y,
            self.z * o.x - self.x * o.z,
            self.x * o.y - self.y * o.x,
        )
    }
    pub fn len(self) -> f64 {
        self.dot(self).sqrt()
    }
    pub fn norm(self) -> V3 {
        let l = self.len();
        if l > 1e-300 {
            self.scale(1.0 / l)
        } else {
            V3::ZERO
        }
    }
    /// Any unit vector perpendicular to self.
    pub fn any_perp(self) -> V3 {
        let a = if self.x.abs() < 0.9 {
            v3(1.0, 0.0, 0.0)
        } else {
            v3(0.0, 1.0, 0.0)
        };
        self.cross(a).norm()
    }
}

/// Column-major 4x4 (glTF layout).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct M4(pub [f64; 16]);

impl M4 {
    pub const IDENTITY: M4 = M4([
        1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
    ]);

    /// Z-up (STEP / engineering convention) to glTF Y-up:
    /// (x, y, z) -> (x, z, -y), the same rotation rvm_parser_glb applies.
    pub const Z_UP_TO_Y_UP: M4 = M4([
        1.0, 0.0, 0.0, 0.0, //
        0.0, 0.0, -1.0, 0.0, //
        0.0, 1.0, 0.0, 0.0, //
        0.0, 0.0, 0.0, 1.0,
    ]);

    pub fn from_frame(origin: V3, x: V3, y: V3, z: V3) -> M4 {
        M4([
            x.x, x.y, x.z, 0.0, //
            y.x, y.y, y.z, 0.0, //
            z.x, z.y, z.z, 0.0, //
            origin.x, origin.y, origin.z, 1.0,
        ])
    }

    pub fn scale_uniform(s: f64) -> M4 {
        let mut m = M4::IDENTITY;
        m.0[0] = s;
        m.0[5] = s;
        m.0[10] = s;
        m
    }

    pub fn translate(t: V3) -> M4 {
        let mut m = M4::IDENTITY;
        m.0[12] = t.x;
        m.0[13] = t.y;
        m.0[14] = t.z;
        m
    }

    pub fn mul(self, o: M4) -> M4 {
        let a = &self.0;
        let b = &o.0;
        let mut r = [0.0f64; 16];
        for c in 0..4 {
            for row in 0..4 {
                let mut s = 0.0;
                for k in 0..4 {
                    s += a[k * 4 + row] * b[c * 4 + k];
                }
                r[c * 4 + row] = s;
            }
        }
        M4(r)
    }

    pub fn xform_point(self, p: V3) -> V3 {
        let m = &self.0;
        v3(
            m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12],
            m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13],
            m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14],
        )
    }

    /// Inverse of a rigid transform (rotation + translation only).
    pub fn inverse_rigid(self) -> M4 {
        let m = &self.0;
        let r = [
            m[0], m[4], m[8], //
            m[1], m[5], m[9], //
            m[2], m[6], m[10],
        ]; // transposed rotation rows
        let t = v3(m[12], m[13], m[14]);
        let nt = v3(
            -(r[0] * t.x + r[3] * t.y + r[6] * t.z),
            -(r[1] * t.x + r[4] * t.y + r[7] * t.z),
            -(r[2] * t.x + r[5] * t.y + r[8] * t.z),
        );
        M4([
            r[0], r[1], r[2], 0.0, r[3], r[4], r[5], 0.0, r[6], r[7], r[8], 0.0, nt.x, nt.y, nt.z,
            1.0,
        ])
    }

    pub fn is_identity(&self, eps: f64) -> bool {
        self.0
            .iter()
            .zip(M4::IDENTITY.0.iter())
            .all(|(a, b)| (a - b).abs() < eps)
    }
}

/// Right-handed orthonormal frame from a STEP AXIS2_PLACEMENT_3D.
#[derive(Clone, Copy, Debug)]
pub struct Frame {
    pub o: V3,
    pub x: V3,
    pub y: V3,
    pub z: V3,
}

impl Frame {
    pub fn new(origin: V3, axis: Option<V3>, ref_dir: Option<V3>) -> Frame {
        let z = axis.map(|a| a.norm()).unwrap_or(v3(0.0, 0.0, 1.0));
        let x = match ref_dir {
            Some(r) => {
                let p = r.sub(z.scale(r.dot(z)));
                if p.len() > 1e-12 {
                    p.norm()
                } else {
                    z.any_perp()
                }
            }
            None => z.any_perp(),
        };
        let y = z.cross(x);
        Frame { o: origin, x, y, z }
    }
    pub fn to_m4(&self) -> M4 {
        M4::from_frame(self.o, self.x, self.y, self.z)
    }
}

// ------------------------------------------------------------------ curves

/// An evaluatable 3D curve, used as the directrix/generatrix of swept
/// surfaces and for edge discretization.
#[derive(Clone, Debug)]
pub enum Curve3 {
    /// p + t * d (d carries the STEP vector magnitude)
    Line {
        p: V3,
        d: V3,
    },
    Circle {
        f: Frame,
        r: f64,
    },
    Ellipse {
        f: Frame,
        a: f64,
        b: f64,
    },
    /// t in [0, n-1], linear between samples
    Polyline(Vec<V3>),
    BSpline {
        degree: usize,
        knots: Vec<f64>,
        cps: Vec<V3>,
        weights: Option<Vec<f64>>,
    },
}

impl Curve3 {
    pub fn point(&self, t: f64) -> V3 {
        match self {
            Curve3::Line { p, d } => p.add(d.scale(t)),
            Curve3::Circle { f, r } => f.o.add(f.x.scale(r * t.cos())).add(f.y.scale(r * t.sin())),
            Curve3::Ellipse { f, a, b } => {
                f.o.add(f.x.scale(a * t.cos())).add(f.y.scale(b * t.sin()))
            }
            Curve3::Polyline(pts) => {
                if pts.is_empty() {
                    return V3::ZERO;
                }
                let t = t.clamp(0.0, (pts.len() - 1) as f64);
                let i = (t.floor() as usize).min(pts.len() - 2);
                let f = t - i as f64;
                pts[i].add(pts[i + 1].sub(pts[i]).scale(f))
            }
            Curve3::BSpline {
                degree,
                knots,
                cps,
                weights,
            } => bspline_curve_point(*degree, knots, cps, weights.as_deref(), t),
        }
    }

    /// Parameter domain. Lines are nominally unbounded; callers that need a
    /// finite domain (swept-surface inversion) reduce Line cases analytically
    /// before getting here.
    pub fn domain(&self) -> (f64, f64) {
        match self {
            Curve3::Line { .. } => (0.0, 1.0),
            Curve3::Circle { .. } | Curve3::Ellipse { .. } => (0.0, std::f64::consts::TAU),
            Curve3::Polyline(p) => (0.0, (p.len().max(2) - 1) as f64),
            Curve3::BSpline { degree, knots, .. } => {
                (knots[*degree], knots[knots.len() - 1 - degree])
            }
        }
    }

    /// Parametric period for closed curves.
    pub fn period(&self) -> Option<f64> {
        match self {
            Curve3::Circle { .. } | Curve3::Ellipse { .. } => Some(std::f64::consts::TAU),
            Curve3::Polyline(p) => {
                if p.len() > 2 && p[0].sub(p[p.len() - 1]).len() < 1e-9 {
                    Some((p.len() - 1) as f64)
                } else {
                    None
                }
            }
            Curve3::BSpline { cps, .. } => {
                let (a, b) = self.domain();
                if cps.len() > 2 && self.point(a).sub(self.point(b)).len() < 1e-9 {
                    Some(b - a)
                } else {
                    None
                }
            }
            Curve3::Line { .. } => None,
        }
    }

    /// Rough size estimate for tolerance scaling.
    pub fn approx_size(&self) -> f64 {
        let (a, b) = self.domain();
        let mut mn = v3(f64::MAX, f64::MAX, f64::MAX);
        let mut mx = v3(f64::MIN, f64::MIN, f64::MIN);
        for i in 0..=8 {
            let p = self.point(a + (b - a) * i as f64 / 8.0);
            mn = v3(mn.x.min(p.x), mn.y.min(p.y), mn.z.min(p.z));
            mx = v3(mx.x.max(p.x), mx.y.max(p.y), mx.z.max(p.z));
        }
        mx.sub(mn).len()
    }

    /// Reasonable number of sampling spans for discretization/seeding.
    pub fn nominal_spans(&self) -> usize {
        match self {
            Curve3::Line { .. } => 1,
            Curve3::Circle { .. } | Curve3::Ellipse { .. } => 16,
            Curve3::Polyline(p) => (p.len().max(2) - 1).min(64),
            Curve3::BSpline { degree, knots, .. } => {
                let spans = knots.len().saturating_sub(2 * degree + 1).max(1);
                (spans * 2).clamp(4, 64)
            }
        }
    }
}

// ----------------------------------------------------------- B-spline surface

#[derive(Clone, Debug)]
pub struct BSplineSurface {
    pub deg_u: usize,
    pub deg_v: usize,
    /// control net dimensions: nu rows (along u) of nv points (along v)
    pub nu: usize,
    pub nv: usize,
    /// row-major: cps[iu * nv + iv]
    pub cps: Vec<V3>,
    pub weights: Option<Vec<f64>>,
    /// fully expanded knot vectors
    pub knots_u: Vec<f64>,
    pub knots_v: Vec<f64>,
    pub closed_u: bool,
    pub closed_v: bool,
    /// approximate model-space size (for tolerance scaling)
    pub size: f64,
}

impl BSplineSurface {
    pub fn finish(mut self) -> BSplineSurface {
        let mut mn = v3(f64::MAX, f64::MAX, f64::MAX);
        let mut mx = v3(f64::MIN, f64::MIN, f64::MIN);
        for p in &self.cps {
            mn = v3(mn.x.min(p.x), mn.y.min(p.y), mn.z.min(p.z));
            mx = v3(mx.x.max(p.x), mx.y.max(p.y), mx.z.max(p.z));
        }
        self.size = mx.sub(mn).len().max(1e-9);
        self
    }

    pub fn domain(&self) -> ((f64, f64), (f64, f64)) {
        (
            (
                self.knots_u[self.deg_u],
                self.knots_u[self.knots_u.len() - 1 - self.deg_u],
            ),
            (
                self.knots_v[self.deg_v],
                self.knots_v[self.knots_v.len() - 1 - self.deg_v],
            ),
        )
    }

    pub fn point(&self, u: f64, v: f64) -> V3 {
        let ((u0, u1), (v0, v1)) = self.domain();
        let u = u.clamp(u0, u1);
        let v = v.clamp(v0, v1);
        let (ku, nu_basis) = basis_funs(self.deg_u, &self.knots_u, self.nu, u);
        let (kv, nv_basis) = basis_funs(self.deg_v, &self.knots_v, self.nv, v);
        let mut acc = [0.0f64; 4];
        for (a, bu) in nu_basis.iter().enumerate() {
            let iu = ku - self.deg_u + a;
            for (b, bv) in nv_basis.iter().enumerate() {
                let iv = kv - self.deg_v + b;
                let idx = iu * self.nv + iv;
                let w = self.weights.as_ref().map(|w| w[idx]).unwrap_or(1.0);
                let c = self.cps[idx];
                let f = bu * bv * w;
                acc[0] += f * c.x;
                acc[1] += f * c.y;
                acc[2] += f * c.z;
                acc[3] += f;
            }
        }
        let w = if acc[3].abs() < 1e-300 { 1.0 } else { acc[3] };
        v3(acc[0] / w, acc[1] / w, acc[2] / w)
    }
}

/// Non-zero B-spline basis functions at parameter t (NURBS-book "BasisFuns").
/// Returns (knot span index, deg+1 basis values).
fn basis_funs(degree: usize, knots: &[f64], n_cps: usize, t: f64) -> (usize, Vec<f64>) {
    let p = degree;
    let lo = p;
    let hi = n_cps; // valid spans: [p, n_cps)
    let t = t.clamp(knots[lo], knots[hi]);
    let mut k = lo;
    while k + 1 < hi && !(t < knots[k + 1]) {
        k += 1;
    }
    let mut n = vec![0.0f64; p + 1];
    let mut left = vec![0.0f64; p + 1];
    let mut right = vec![0.0f64; p + 1];
    n[0] = 1.0;
    for j in 1..=p {
        left[j] = t - knots[k + 1 - j];
        right[j] = knots[k + j] - t;
        let mut saved = 0.0;
        for r in 0..j {
            let den = right[r + 1] + left[j - r];
            let temp = if den.abs() < 1e-300 { 0.0 } else { n[r] / den };
            n[r] = saved + right[r + 1] * temp;
            saved = left[j - r] * temp;
        }
        n[j] = saved;
    }
    (k, n)
}

// ------------------------------------------------------------------ surfaces

/// Tessellatable surfaces. The five analytic kinds invert (u, v) in closed
/// form; swept and B-spline surfaces use seeded Newton projection.
#[derive(Clone, Debug)]
pub enum Surface {
    Plane(Frame),
    Cylinder(Frame, f64),
    Cone(Frame, f64, f64), // base radius, semi-angle
    Sphere(Frame, f64),
    Torus(Frame, f64, f64), // major, minor
    /// P(u, v) = C(u) + v * dir
    Extrusion {
        curve: Curve3,
        dir: V3,
    },
    /// P(u, v) = rotate C(v) by angle u around axis frame z
    Revolution {
        curve: Curve3,
        axis: Frame,
    },
    /// P(u, v) = basis(u, v) + d · n̂(u, v) — same parameter space as the
    /// basis surface, every point moved along the basis normal
    Offset {
        basis: Box<Surface>,
        d: f64,
    },
    BSpline(BSplineSurface),
}

impl Surface {
    pub fn point(&self, u: f64, v: f64) -> V3 {
        match self {
            Surface::Plane(f) => f.o.add(f.x.scale(u)).add(f.y.scale(v)),
            Surface::Cylinder(f, r) => {
                f.o.add(f.x.scale(r * u.cos()))
                    .add(f.y.scale(r * u.sin()))
                    .add(f.z.scale(v))
            }
            Surface::Cone(f, r, a) => {
                let rv = r + v * a.tan();
                f.o.add(f.x.scale(rv * u.cos()))
                    .add(f.y.scale(rv * u.sin()))
                    .add(f.z.scale(v))
            }
            Surface::Sphere(f, r) => {
                f.o.add(f.x.scale(r * v.cos() * u.cos()))
                    .add(f.y.scale(r * v.cos() * u.sin()))
                    .add(f.z.scale(r * v.sin()))
            }
            Surface::Torus(f, maj, min) => {
                let rr = maj + min * v.cos();
                f.o.add(f.x.scale(rr * u.cos()))
                    .add(f.y.scale(rr * u.sin()))
                    .add(f.z.scale(min * v.sin()))
            }
            Surface::Extrusion { curve, dir } => curve.point(u).add(dir.scale(v)),
            Surface::Revolution { curve, axis } => {
                let p = curve.point(v).sub(axis.o);
                let (c, s) = (u.cos(), u.sin());
                let px = p.dot(axis.x);
                let py = p.dot(axis.y);
                let pz = p.dot(axis.z);
                axis.o
                    .add(axis.x.scale(px * c - py * s))
                    .add(axis.y.scale(px * s + py * c))
                    .add(axis.z.scale(pz))
            }
            Surface::Offset { basis, d } => {
                let n = basis.normal(u, v);
                basis.point(u, v).add(n.scale(*d))
            }
            Surface::BSpline(b) => b.point(u, v),
        }
    }

    /// Surface normal consistent with d/du x d/dv. Degenerate spots (sphere
    /// poles, cone apex) retry slightly inward.
    pub fn normal(&self, u: f64, v: f64) -> V3 {
        if let Surface::Plane(f) = self {
            return f.z;
        }
        let h = self.fd_step();
        for attempt in 0..3 {
            let off = h * 50.0 * attempt as f64;
            let vv = v + if v >= 0.0 { -off } else { off };
            let du = self.point(u + h, vv).sub(self.point(u - h, vv));
            let dv = self.point(u, vv + h).sub(self.point(u, vv - h));
            let n = du.cross(dv);
            if n.len() > 1e-14 {
                return n.norm();
            }
        }
        match self {
            Surface::Sphere(f, _) => self.point(u, v).sub(f.o).norm(),
            Surface::Cone(f, _, _) => f.z,
            _ => v3(0.0, 0.0, 1.0),
        }
    }

    fn fd_step(&self) -> f64 {
        match self {
            Surface::BSpline(b) => {
                let ((u0, u1), (v0, v1)) = b.domain();
                ((u1 - u0).max(v1 - v0).max(1e-9)) * 1e-6
            }
            Surface::Offset { basis, .. } => basis.fd_step(),
            _ => 1e-5,
        }
    }

    /// Map a 3D point on the surface to (u, v). `hint` (e.g. the previous
    /// boundary point's solution) seeds the Newton search on non-analytic
    /// surfaces; analytic surfaces invert in closed form.
    pub fn uv(&self, p: V3, hint: Option<(f64, f64)>) -> (f64, f64) {
        match self {
            Surface::Plane(f) => {
                let d = p.sub(f.o);
                (d.dot(f.x), d.dot(f.y))
            }
            Surface::Cylinder(f, _) => {
                let d = p.sub(f.o);
                let (px, py) = (d.dot(f.x), d.dot(f.y));
                (py.atan2(px), d.dot(f.z))
            }
            Surface::Cone(f, r, a) => {
                let d = p.sub(f.o);
                let (px, py) = (d.dot(f.x), d.dot(f.y));
                let v = d.dot(f.z);
                // at the apex u is undefined (atan2(0,0)): stay on the previous
                // boundary point's meridian instead of jumping to 0
                let u = if (px * px + py * py).sqrt() < 1e-9 * d.len().max(1.0) {
                    hint.map_or(0.0, |h| h.0)
                } else {
                    // beyond the apex the signed radius r + v·tan(a) flips sign,
                    // so the point lies on the far nappe at angle u+π (ISO
                    // 10303-42 conical_surface spans all v); offset so that
                    // point(u, v) inverts back to p instead of the mirror side.
                    let u = py.atan2(px);
                    if r + v * a.tan() < 0.0 {
                        u + std::f64::consts::PI
                    } else {
                        u
                    }
                };
                (u, v)
            }
            Surface::Sphere(f, r) => {
                let d = p.sub(f.o);
                let (px, py) = (d.dot(f.x), d.dot(f.y));
                let z = (d.dot(f.z) / r).clamp(-1.0, 1.0);
                // same singularity at the poles
                let u = if (px * px + py * py).sqrt() < 1e-9 * r.abs().max(1.0) {
                    hint.map_or(0.0, |h| h.0)
                } else {
                    py.atan2(px)
                };
                (u, z.asin())
            }
            Surface::Torus(f, maj, _) => {
                let d = p.sub(f.o);
                let dz = d.dot(f.z);
                let px = d.dot(f.x);
                let py = d.dot(f.y);
                let radial = (px * px + py * py).sqrt() - maj;
                (py.atan2(px), dz.atan2(radial))
            }
            Surface::Extrusion { curve, dir } => {
                // best v for a given u is the projection onto dir
                let proj = |u: f64| -> (f64, f64) {
                    let d2 = dir.dot(*dir).max(1e-300);
                    let v = p.sub(curve.point(u)).dot(*dir) / d2;
                    let q = curve.point(u).add(dir.scale(v));
                    (v, q.sub(p).dot(q.sub(p)))
                };
                let (t0, t1) = curve.domain();
                let mut best_u = match hint {
                    Some((u, _)) => u,
                    None => {
                        let n = curve.nominal_spans() * 2;
                        let mut bu = t0;
                        let mut bd = f64::MAX;
                        for i in 0..=n {
                            let u = t0 + (t1 - t0) * i as f64 / n as f64;
                            let (_, d) = proj(u);
                            if d < bd {
                                bd = d;
                                bu = u;
                            }
                        }
                        bu
                    }
                };
                // 1D Newton on f(u) = d/du |S - p|^2. The FD stencil is
                // shifted inside the domain so endpoint clamping in the
                // curve evaluation can't corrupt the derivatives.
                let h = (t1 - t0).max(1e-9) * 1e-6;
                let periodic = curve.period().is_some();
                for _ in 0..40 {
                    let uc = if periodic {
                        best_u
                    } else {
                        best_u.clamp(t0 + 2.0 * h, t1 - 2.0 * h)
                    };
                    let (_, d0) = proj(uc - h);
                    let (_, dc) = proj(uc);
                    let (_, d1) = proj(uc + h);
                    let g = (d1 - d0) / (2.0 * h);
                    let gg = (d1 - 2.0 * dc + d0) / (h * h);
                    if gg.abs() < 1e-300 {
                        break;
                    }
                    let mut step = g / gg;
                    if gg < 0.0 {
                        // not a minimum locally: walk downhill instead
                        step = g.signum() * (t1 - t0) / 16.0;
                    }
                    step = step.clamp(-(t1 - t0) / 4.0, (t1 - t0) / 4.0);
                    best_u = uc - step;
                    if !periodic {
                        best_u = best_u.clamp(t0, t1);
                    }
                    if step.abs() < 1e-12 * (t1 - t0) {
                        break;
                    }
                }
                // a bad hint can converge to the wrong local minimum
                if hint.is_some() {
                    let (v, d2) = proj(best_u);
                    let tol = self.approx_size() * 1e-4;
                    if d2.sqrt() > tol {
                        return self.uv(p, None);
                    }
                    return (best_u, v);
                }
                (best_u, proj(best_u).0)
            }
            Surface::Revolution { curve, axis } => {
                // separate: v from the meridian profile, u from the azimuth
                let d = p.sub(axis.o);
                let z_p = d.dot(axis.z);
                let rho_p = {
                    let px = d.dot(axis.x);
                    let py = d.dot(axis.y);
                    (px * px + py * py).sqrt()
                };
                let profile = |v: f64| -> (f64, f64) {
                    let c = curve.point(v).sub(axis.o);
                    let cz = c.dot(axis.z);
                    let cx = c.dot(axis.x);
                    let cy = c.dot(axis.y);
                    ((cx * cx + cy * cy).sqrt(), cz)
                };
                let err = |v: f64| {
                    let (r, z) = profile(v);
                    (r - rho_p) * (r - rho_p) + (z - z_p) * (z - z_p)
                };
                let (t0, t1) = curve.domain();
                let mut best_v = match hint {
                    Some((_, v)) => v,
                    None => {
                        let n = curve.nominal_spans() * 2;
                        let mut bv = t0;
                        let mut bd = f64::MAX;
                        for i in 0..=n {
                            let v = t0 + (t1 - t0) * i as f64 / n as f64;
                            let e = err(v);
                            if e < bd {
                                bd = e;
                                bv = v;
                            }
                        }
                        bv
                    }
                };
                let h = (t1 - t0).max(1e-9) * 1e-6;
                let periodic = curve.period().is_some();
                for _ in 0..40 {
                    let vc = if periodic {
                        best_v
                    } else {
                        best_v.clamp(t0 + 2.0 * h, t1 - 2.0 * h)
                    };
                    let (e0, ec, e1) = (err(vc - h), err(vc), err(vc + h));
                    let g = (e1 - e0) / (2.0 * h);
                    let gg = (e1 - 2.0 * ec + e0) / (h * h);
                    if gg.abs() < 1e-300 {
                        break;
                    }
                    let mut step = g / gg;
                    if gg < 0.0 {
                        step = g.signum() * (t1 - t0) / 16.0;
                    }
                    step = step.clamp(-(t1 - t0) / 4.0, (t1 - t0) / 4.0);
                    best_v = (vc - step).clamp(t0, t1);
                    if step.abs() < 1e-12 * (t1 - t0) {
                        break;
                    }
                }
                if hint.is_some() && err(best_v).sqrt() > self.approx_size() * 1e-4 {
                    return self.uv(p, None);
                }
                // azimuth of p relative to the profile point's azimuth
                let c = curve.point(best_v).sub(axis.o);
                let phi_c = c.dot(axis.y).atan2(c.dot(axis.x));
                let phi_p = d.dot(axis.y).atan2(d.dot(axis.x));
                let mut u = phi_p - phi_c;
                if rho_p < 1e-9 {
                    u = hint.map(|h| h.0).unwrap_or(0.0); // on the axis
                }
                (u, best_v)
            }
            Surface::BSpline(b) => newton_invert_bspline(b, p, hint),
            Surface::Offset { basis, d } => {
                // seed with the basis inverse of p, then re-invert with the
                // offset removed along the local normal (one fixed-point step
                // is enough at offset distances small w.r.t. curvature)
                let (u0, v0) = basis.uv(p, hint);
                let n = basis.normal(u0, v0);
                basis.uv(p.sub(n.scale(*d)), Some((u0, v0)))
            }
        }
    }

    /// Parametric period in u, if the surface wraps in u.
    pub fn u_period(&self) -> Option<f64> {
        match self {
            Surface::Plane(_) => None,
            Surface::Cylinder(..)
            | Surface::Cone(..)
            | Surface::Sphere(..)
            | Surface::Torus(..)
            | Surface::Revolution { .. } => Some(std::f64::consts::TAU),
            Surface::Extrusion { curve, .. } => curve.period(),
            Surface::Offset { basis, .. } => basis.u_period(),
            Surface::BSpline(b) => {
                if b.closed_u {
                    let ((u0, u1), _) = b.domain();
                    Some(u1 - u0)
                } else {
                    None
                }
            }
        }
    }

    pub fn v_period(&self) -> Option<f64> {
        match self {
            Surface::Torus(..) => Some(std::f64::consts::TAU),
            Surface::Offset { basis, .. } => basis.v_period(),
            Surface::Revolution { curve, .. } => curve.period(),
            Surface::BSpline(b) => {
                if b.closed_v {
                    let (_, (v0, v1)) = b.domain();
                    Some(v1 - v0)
                } else {
                    None
                }
            }
            _ => None,
        }
    }

    /// v values where the surface degenerates to a point ("poles"): spheres
    /// at v = ±π/2 and cones at the apex. Faces whose boundary winds around
    /// u an odd number of times are closed against these caps.
    pub fn v_caps(&self) -> Option<(f64, f64)> {
        match self {
            Surface::Offset { basis, .. } => basis.v_caps(),
            Surface::Sphere(_, _) => {
                Some((-std::f64::consts::FRAC_PI_2, std::f64::consts::FRAC_PI_2))
            }
            Surface::Cone(_, r, a) => {
                let t = a.tan();
                if t.abs() < 1e-12 {
                    None
                } else {
                    let apex = -r / t;
                    if apex <= 0.0 {
                        Some((apex, f64::INFINITY))
                    } else {
                        Some((f64::NEG_INFINITY, apex))
                    }
                }
            }
            _ => None,
        }
    }

    /// Max parametric step in u for a given chordal deflection.
    pub fn u_step(&self, defl: f64, max_angle: f64) -> f64 {
        match self {
            Surface::Plane(_) => f64::INFINITY,
            Surface::Cylinder(_, r) | Surface::Cone(_, r, _) | Surface::Sphere(_, r) => {
                angle_step(r.abs(), defl, max_angle)
            }
            Surface::Torus(_, maj, min) => angle_step((maj + min).abs(), defl, max_angle),
            Surface::Revolution { curve, axis } => {
                // largest radius along the sampled profile
                let (t0, t1) = curve.domain();
                let mut rmax: f64 = 1e-9;
                for i in 0..=16 {
                    let c = curve.point(t0 + (t1 - t0) * i as f64 / 16.0).sub(axis.o);
                    let cx = c.dot(axis.x);
                    let cy = c.dot(axis.y);
                    rmax = rmax.max((cx * cx + cy * cy).sqrt());
                }
                angle_step(rmax, defl, max_angle)
            }
            Surface::Extrusion { curve, .. } => {
                let (t0, t1) = curve.domain();
                (t1 - t0) / curve.nominal_spans() as f64
            }
            Surface::Offset { basis, .. } => basis.u_step(defl, max_angle),
            Surface::BSpline(b) => {
                // loose floor only — the perpendicular sag criterion in
                // refinement drives the actual density. A hard per-knot-span
                // floor explodes on surfaces with hundreds of spans
                // (helical springs and the like).
                let ((u0, u1), _) = b.domain();
                let spans = b.nu.saturating_sub(b.deg_u).max(1).min(8);
                (u1 - u0) / spans as f64
            }
        }
    }

    pub fn v_step(&self, defl: f64, max_angle: f64) -> f64 {
        match self {
            Surface::Offset { basis, .. } => basis.v_step(defl, max_angle),
            Surface::Sphere(_, r) => angle_step(r.abs(), defl, max_angle),
            Surface::Torus(_, _, min) => angle_step(min.abs(), defl, max_angle),
            Surface::Revolution { curve, .. } => {
                let (t0, t1) = curve.domain();
                (t1 - t0) / curve.nominal_spans() as f64
            }
            Surface::BSpline(b) => {
                let (_, (v0, v1)) = b.domain();
                let spans = b.nv.saturating_sub(b.deg_v).max(1).min(8);
                (v1 - v0) / spans as f64
            }
            _ => f64::INFINITY,
        }
    }

    /// Characteristic model-space size, for chord-deviation tolerancing.
    pub fn approx_size(&self) -> f64 {
        match self {
            Surface::Cylinder(_, r) | Surface::Sphere(_, r) => r.abs() * 2.0,
            Surface::Cone(_, r, _) => r.abs().max(1.0) * 2.0,
            Surface::Torus(_, maj, min) => (maj + min).abs() * 2.0,
            Surface::Extrusion { curve, dir } => curve.approx_size() + dir.len(),
            Surface::Revolution { curve, .. } => curve.approx_size() * 2.0,
            Surface::Offset { basis, d } => basis.approx_size() + 2.0 * d.abs(),
            Surface::BSpline(b) => b.size,
            Surface::Plane(_) => 1.0,
        }
    }

    /// Whether `uv` runs a numeric (Newton) inversion.
    pub fn uses_newton(&self) -> bool {
        match self {
            Surface::Extrusion { .. } | Surface::Revolution { .. } | Surface::BSpline(_) => true,
            Surface::Offset { basis, .. } => basis.uses_newton(),
            _ => false,
        }
    }

    /// A quadric (cylinder / cone / sphere / torus): a closed, radius-based
    /// surface whose closed-form UV inverse is exact, so `point_residual` is a
    /// reliable distance-to-surface (used to reject boundary geometry that
    /// doesn't lie on the surface).
    pub fn is_quadric(&self) -> bool {
        matches!(
            self,
            Surface::Cylinder(..) | Surface::Cone(..) | Surface::Sphere(..) | Surface::Torus(..)
        )
    }

    /// 3D distance from `p` to this surface, via the closed-form UV inverse
    /// (meaningful only when [`is_quadric`](Surface::is_quadric)). Zero for a
    /// point on the surface; large for one that isn't.
    pub fn point_residual(&self, p: V3) -> f64 {
        let (u, v) = self.uv(p, None);
        self.point(u, v).sub(p).len()
    }
}

/// 2D Newton projection of p onto a B-spline surface. The `hint` (previous
/// boundary point's solution) is tried first; cold starts seed at the Greville
/// point of the control point nearest to p — on surfaces with many spans
/// (coiled tubes, long sweeps) a coarse uniform grid aliases against the folds
/// and Newton converges onto the wrong one — with the uniform domain grid kept
/// as a fallback for rational nets whose control points sit far off-surface.
fn newton_invert_bspline(b: &BSplineSurface, p: V3, hint: Option<(f64, f64)>) -> (f64, f64) {
    let dist2 = |(u, v): (f64, f64)| {
        let d = b.point(u, v).sub(p);
        d.dot(d)
    };
    let tol2 = (b.size * 1e-4) * (b.size * 1e-4);

    if let Some(h) = hint {
        let r = newton_refine_bspline(b, p, h);
        if dist2(r) <= tol2 {
            return r;
        }
        // wrong local minimum from a bad hint: fall through to a cold start
    }

    let ((u0, u1), (v0, v1)) = b.domain();
    // Greville seed at the control point nearest to p, then at its control-net
    // neighbours: near a tight crest the nearest one alone can descend into a
    // non-zero local minimum on the wrong side, while a neighbour brackets the
    // true foot of p. Early-out on the first on-surface result, so ordinary
    // points cost a single Newton descent.
    let mut bi = 0usize;
    let mut bd = f64::MAX;
    for (i, c) in b.cps.iter().enumerate() {
        let d = c.sub(p);
        let d = d.dot(d);
        if d < bd {
            bd = d;
            bi = i;
        }
    }
    let (ciu, civ) = ((bi / b.nv) as i64, (bi % b.nv) as i64);
    let g = |knots: &[f64], deg: usize, i: usize| -> f64 {
        knots[i + 1..=i + deg].iter().sum::<f64>() / deg as f64
    };
    const OFFS: [(i64, i64); 13] = [
        (0, 0),
        (0, 1),
        (0, -1),
        (1, 0),
        (-1, 0),
        (0, 2),
        (0, -2),
        (1, 1),
        (-1, -1),
        (1, -1),
        (-1, 1),
        (2, 0),
        (-2, 0),
    ];
    let mut r1 = (u0, v0);
    let mut best1 = f64::MAX;
    for (di, dj) in OFFS {
        let iu = (ciu + di).clamp(0, b.nu as i64 - 1) as usize;
        let iv = (civ + dj).clamp(0, b.nv as i64 - 1) as usize;
        let seed = (
            g(&b.knots_u, b.deg_u.max(1), iu).clamp(u0, u1),
            g(&b.knots_v, b.deg_v.max(1), iv).clamp(v0, v1),
        );
        let r = newton_refine_bspline(b, p, seed);
        let rd = dist2(r);
        if rd < best1 {
            best1 = rd;
            r1 = r;
        }
        if best1 <= tol2 {
            return r1;
        }
    }

    // Last resort: a span-resolution domain scan. Control points of rational
    // or sparsely-sampled nets can sit far off-surface (so every Greville
    // seed descends wrong), but ~2 samples per knot span cannot alias against
    // the surface's folds the way a coarse uniform grid does.
    let du_span = (u1 - u0).max(1e-12);
    let dv_span = (v1 - v0).max(1e-12);
    let nu = (b.nu.saturating_sub(b.deg_u).max(1) * 2).clamp(4, 128);
    let nv = (b.nv.saturating_sub(b.deg_v).max(1) * 2).clamp(4, 256);
    let mut best = (u0, v0);
    let mut bd = f64::MAX;
    for i in 0..=nu {
        for j in 0..=nv {
            let uu = u0 + du_span * i as f64 / nu as f64;
            let vv = v0 + dv_span * j as f64 / nv as f64;
            let d = dist2((uu, vv));
            if d < bd {
                bd = d;
                best = (uu, vv);
            }
        }
    }
    let r2 = newton_refine_bspline(b, p, best);
    if dist2(r2) < best1 {
        r2
    } else {
        r1
    }
}

/// One damped Gauss-Newton descent of |S(u,v) - p|² from `seed`, clamped to
/// the domain.
fn newton_refine_bspline(b: &BSplineSurface, p: V3, seed: (f64, f64)) -> (f64, f64) {
    let ((u0, u1), (v0, v1)) = b.domain();
    let du_span = (u1 - u0).max(1e-12);
    let dv_span = (v1 - v0).max(1e-12);
    let (mut u, mut v) = seed;

    let hu = du_span * 1e-6;
    let hv = dv_span * 1e-6;
    for _ in 0..30 {
        let s = b.point(u, v);
        let f = s.sub(p);
        let su = b.point(u + hu, v).sub(b.point(u - hu, v)).scale(0.5 / hu);
        let sv = b.point(u, v + hv).sub(b.point(u, v - hv)).scale(0.5 / hv);
        // normal equations of the least-squares step
        let a11 = su.dot(su);
        let a12 = su.dot(sv);
        let a22 = sv.dot(sv);
        let r1 = -f.dot(su);
        let r2 = -f.dot(sv);
        let det = a11 * a22 - a12 * a12;
        if det.abs() < 1e-300 {
            break;
        }
        let mut du = (r1 * a22 - r2 * a12) / det;
        let mut dv = (a11 * r2 - a12 * r1) / det;
        du = du.clamp(-du_span / 4.0, du_span / 4.0);
        dv = dv.clamp(-dv_span / 4.0, dv_span / 4.0);
        // damped step: Gauss-Newton overshoots and ping-pongs around tight
        // folds (the linearization ignores curvature) — halve until the
        // residual actually drops
        let d0 = f.dot(f);
        let mut scale = 1.0;
        let (mut nu_, mut nv_) = (u, v);
        for _ in 0..8 {
            nu_ = (u + du * scale).clamp(u0, u1);
            nv_ = (v + dv * scale).clamp(v0, v1);
            let d = b.point(nu_, nv_).sub(p);
            if d.dot(d) < d0 {
                break;
            }
            scale *= 0.5;
        }
        let (su_, sv_) = (nu_ - u, nv_ - v);
        u = nu_;
        v = nv_;
        if su_.abs() < 1e-12 * du_span && sv_.abs() < 1e-12 * dv_span {
            break;
        }
    }
    (u, v)
}

/// Angular step so the sagitta of a chord on radius `r` stays under `defl`.
pub fn angle_step(r: f64, defl: f64, max_angle: f64) -> f64 {
    if r < 1e-12 {
        return max_angle;
    }
    let ratio = (1.0 - (defl / r)).clamp(-1.0, 1.0);
    let a = 2.0 * ratio.acos();
    a.clamp(2.0_f64.to_radians(), max_angle.max(2.0_f64.to_radians()))
}

// ------------------------------------------------------------- B-spline eval

/// Evaluate a (possibly rational) B-spline curve with full knot vector `knots`
/// (already expanded by multiplicity), `degree`, control points and weights.
pub fn bspline_curve_point(
    degree: usize,
    knots: &[f64],
    cps: &[V3],
    weights: Option<&[f64]>,
    t: f64,
) -> V3 {
    let n = cps.len();
    if n == 0 {
        return V3::ZERO;
    }
    if n == 1 {
        return cps[0];
    }
    let p = degree.min(n - 1);
    // find knot span k with knots[k] <= t < knots[k+1], clamped
    let lo = p;
    let hi = n; // valid spans: [p, n)
    let t = t.clamp(knots[lo], knots[hi]);
    let mut k = lo;
    while k + 1 < hi && !(t < knots[k + 1]) {
        k += 1;
    }
    // de Boor on homogeneous coords
    let mut dx = vec![[0.0f64; 4]; p + 1];
    for j in 0..=p {
        let idx = k - p + j;
        let w = weights.map(|w| w[idx]).unwrap_or(1.0);
        let c = cps[idx];
        dx[j] = [c.x * w, c.y * w, c.z * w, w];
    }
    for r in 1..=p {
        for j in (r..=p).rev() {
            let i = k - p + j;
            let den = knots[i + p - r + 1] - knots[i];
            let alpha = if den.abs() < 1e-300 {
                0.0
            } else {
                (t - knots[i]) / den
            };
            for c in 0..4 {
                dx[j][c] = (1.0 - alpha) * dx[j - 1][c] + alpha * dx[j][c];
            }
        }
    }
    let w = if dx[p][3].abs() < 1e-300 {
        1.0
    } else {
        dx[p][3]
    };
    v3(dx[p][0] / w, dx[p][1] / w, dx[p][2] / w)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: V3, b: V3, eps: f64) -> bool {
        a.sub(b).len() < eps
    }

    #[test]
    fn m4_mul_and_rigid_inverse() {
        let f = Frame::new(
            v3(1.0, 2.0, 3.0),
            Some(v3(0.0, 0.0, 1.0)),
            Some(v3(0.0, 1.0, 0.0)),
        );
        let m = f.to_m4();
        assert!(m.mul(m.inverse_rigid()).is_identity(1e-12));
        let p = v3(5.0, -2.0, 7.0);
        assert!(close(
            m.inverse_rigid().xform_point(m.xform_point(p)),
            p,
            1e-12
        ));
    }

    #[test]
    fn frame_builds_orthonormal_basis_even_with_skewed_refdir() {
        let f = Frame::new(V3::ZERO, Some(v3(0.0, 0.0, 2.0)), Some(v3(1.0, 0.0, 5.0)));
        assert!((f.x.dot(f.z)).abs() < 1e-12);
        assert!((f.x.len() - 1.0).abs() < 1e-12);
        assert!(close(f.z.cross(f.x), f.y, 1e-12));
    }

    #[test]
    fn analytic_surface_uv_roundtrip() {
        let f = Frame::new(v3(1.0, -2.0, 0.5), Some(v3(0.0, 1.0, 1.0)), None);
        let surfaces = [
            Surface::Plane(f),
            Surface::Cylinder(f, 4.0),
            Surface::Cone(f, 3.0, 0.3),
            Surface::Sphere(f, 5.0),
            Surface::Torus(f, 10.0, 2.0),
        ];
        for s in surfaces {
            for &(u, v) in &[(0.3, 0.7), (-1.2, 0.1), (2.0, -0.9)] {
                let p = s.point(u, v);
                let (u2, v2) = s.uv(p, None);
                assert!(close(p, s.point(u2, v2), 1e-9), "{:?} roundtrip failed", s);
            }
        }
    }

    #[test]
    fn cone_uv_roundtrip_across_the_apex() {
        // A CONICAL_SURFACE spans all v (ISO 10303-42): past the apex the
        // signed radius r + v·tan(a) goes negative — the far nappe, at angle
        // u+π. uv() must invert points on *both* nappes, or a valid frustum
        // beyond the apex is mis-mapped (and then wrongly rejected as
        // off-surface by the on-surface guard). Regression for that bug.
        let f = Frame::new(v3(1.0, -2.0, 0.5), Some(v3(0.0, 1.0, 1.0)), None);
        let cone = Surface::Cone(f, 3.0, std::f64::consts::FRAC_PI_4); // apex at v=-3
        for &v in &[2.0_f64, 0.5, -1.0, -5.0, -8.0] {
            let rv = 3.0 + v; // tan(45°) = 1
            for &u in &[0.0_f64, 1.3, -2.4, 3.0] {
                let p = cone.point(u, v);
                let (u2, v2) = cone.uv(p, None);
                assert!(
                    close(p, cone.point(u2, v2), 1e-9),
                    "cone roundtrip failed at (u={u}, v={v}), signed radius {rv}"
                );
            }
        }
        // and the on-surface residual is ~0 on the far nappe (guard must pass)
        let far = cone.point(1.0, -8.0);
        assert!(cone.point_residual(far) < 1e-9);
    }

    #[test]
    fn surface_normals_are_unit_and_radial_where_expected() {
        let f = Frame::new(V3::ZERO, Some(v3(0.0, 0.0, 1.0)), Some(v3(1.0, 0.0, 0.0)));
        let cyl = Surface::Cylinder(f, 2.0);
        assert!(close(cyl.normal(0.0, 5.0), v3(1.0, 0.0, 0.0), 1e-4));
        let sph = Surface::Sphere(f, 3.0);
        let p = sph.point(0.4, 0.2);
        assert!(close(sph.normal(0.4, 0.2), p.norm(), 1e-4));
        // sphere pole: degenerate du, fallback must give +z
        assert!(close(
            sph.normal(1.0, std::f64::consts::FRAC_PI_2),
            v3(0.0, 0.0, 1.0),
            1e-3
        ));
    }

    #[test]
    fn bspline_degree1_is_linear_interpolation() {
        let cps = [v3(0.0, 0.0, 0.0), v3(10.0, 0.0, 0.0)];
        let knots = [0.0, 0.0, 1.0, 1.0];
        let p = bspline_curve_point(1, &knots, &cps, None, 0.25);
        assert!(close(p, v3(2.5, 0.0, 0.0), 1e-12));
    }

    #[test]
    fn bspline_quadratic_bezier_midpoint() {
        let cps = [v3(0.0, 0.0, 0.0), v3(1.0, 2.0, 0.0), v3(2.0, 0.0, 0.0)];
        let knots = [0.0, 0.0, 0.0, 1.0, 1.0, 1.0];
        let p = bspline_curve_point(2, &knots, &cps, None, 0.5);
        assert!(close(p, v3(1.0, 1.0, 0.0), 1e-12));
    }

    #[test]
    fn rational_bspline_quarter_circle() {
        let w = (0.5f64).sqrt();
        let cps = [v3(1.0, 0.0, 0.0), v3(1.0, 1.0, 0.0), v3(0.0, 1.0, 0.0)];
        let weights = [1.0, w, 1.0];
        let knots = [0.0, 0.0, 0.0, 1.0, 1.0, 1.0];
        for i in 0..=10 {
            let t = i as f64 / 10.0;
            let p = bspline_curve_point(2, &knots, &cps, Some(&weights), t);
            assert!((p.len() - 1.0).abs() < 1e-12, "off unit circle at t={}", t);
        }
    }

    #[test]
    fn angle_step_respects_sagitta() {
        let r = 10.0;
        let defl = 0.1;
        let a = angle_step(r, defl, 1.0);
        assert!(r * (1.0 - (a / 2.0).cos()) <= defl + 1e-9);
    }

    // ------------------------------------------------- new: curves

    #[test]
    fn curve3_eval_domain_period() {
        let line = Curve3::Line {
            p: v3(1.0, 0.0, 0.0),
            d: v3(0.0, 2.0, 0.0),
        };
        assert!(close(line.point(0.5), v3(1.0, 1.0, 0.0), 1e-12));
        assert!(line.period().is_none());

        let f = Frame::new(V3::ZERO, Some(v3(0.0, 0.0, 1.0)), Some(v3(1.0, 0.0, 0.0)));
        let circ = Curve3::Circle { f, r: 2.0 };
        assert!(close(
            circ.point(std::f64::consts::FRAC_PI_2),
            v3(0.0, 2.0, 0.0),
            1e-12
        ));
        assert_eq!(circ.period(), Some(std::f64::consts::TAU));

        let poly = Curve3::Polyline(vec![
            v3(0.0, 0.0, 0.0),
            v3(1.0, 0.0, 0.0),
            v3(1.0, 1.0, 0.0),
        ]);
        assert!(close(poly.point(1.5), v3(1.0, 0.5, 0.0), 1e-12));
        assert_eq!(poly.domain(), (0.0, 2.0));
        assert!(poly.period().is_none());
    }

    // ------------------------------------------------- new: bspline surfaces

    fn flat_patch() -> BSplineSurface {
        // bilinear 10x10 patch in the z=0 plane: S(u,v) = (10u, 10v, 0)
        BSplineSurface {
            deg_u: 1,
            deg_v: 1,
            nu: 2,
            nv: 2,
            cps: vec![
                v3(0.0, 0.0, 0.0),
                v3(0.0, 10.0, 0.0),
                v3(10.0, 0.0, 0.0),
                v3(10.0, 10.0, 0.0),
            ],
            weights: None,
            knots_u: vec![0.0, 0.0, 1.0, 1.0],
            knots_v: vec![0.0, 0.0, 1.0, 1.0],
            closed_u: false,
            closed_v: false,
            size: 0.0,
        }
        .finish()
    }

    #[test]
    fn bspline_surface_bilinear_patch_evaluates_exactly() {
        let b = flat_patch();
        assert!(close(b.point(0.0, 0.0), v3(0.0, 0.0, 0.0), 1e-12));
        assert!(close(b.point(1.0, 1.0), v3(10.0, 10.0, 0.0), 1e-12));
        assert!(close(b.point(0.3, 0.7), v3(3.0, 7.0, 0.0), 1e-12));
    }

    #[test]
    fn bspline_surface_newton_inversion_roundtrip() {
        // curved biquadratic patch (a bump)
        let mut cps = Vec::new();
        for i in 0..3 {
            for j in 0..3 {
                let z = if i == 1 && j == 1 { 4.0 } else { 0.0 };
                cps.push(v3(i as f64 * 5.0, j as f64 * 5.0, z));
            }
        }
        let b = BSplineSurface {
            deg_u: 2,
            deg_v: 2,
            nu: 3,
            nv: 3,
            cps,
            weights: None,
            knots_u: vec![0.0, 0.0, 0.0, 1.0, 1.0, 1.0],
            knots_v: vec![0.0, 0.0, 0.0, 1.0, 1.0, 1.0],
            closed_u: false,
            closed_v: false,
            size: 0.0,
        }
        .finish();
        let s = Surface::BSpline(b);
        for &(u, v) in &[(0.2, 0.3), (0.5, 0.5), (0.9, 0.1), (0.0, 1.0)] {
            let p = s.point(u, v);
            // cold start (multi-start grid)
            let (u2, v2) = s.uv(p, None);
            assert!(
                close(p, s.point(u2, v2), 1e-6),
                "cold inversion at ({u},{v})"
            );
            // warm start from a nearby hint
            let (u3, v3_) = s.uv(p, Some((u + 0.05, v - 0.05)));
            assert!(
                close(p, s.point(u3, v3_), 1e-6),
                "warm inversion at ({u},{v})"
            );
        }
    }

    #[test]
    fn bspline_cold_inversion_lands_on_the_right_fold() {
        // A ribbon folded back and forth ~19 times (like one face of a coiled
        // spring laid flat, at a realistic ~21 control points per fold): a
        // coarse uniform seeding grid aliases against the folds and Newton
        // converges onto the wrong one. The cold start must recover the true
        // (u, v) for points anywhere along the folds.
        let nv = 400usize;
        let mut cps = Vec::new();
        for iu in 0..2 {
            for k in 0..nv {
                cps.push(v3(
                    2.0 * k as f64,
                    100.0 * (0.3 * k as f64).sin(),
                    iu as f64 * 10.0,
                ));
            }
        }
        let deg_v = 3usize;
        let mut knots_v = vec![0.0; deg_v + 1];
        for k in 1..(nv - deg_v) {
            knots_v.push(k as f64);
        }
        knots_v.extend(std::iter::repeat_n((nv - deg_v) as f64, deg_v + 1));
        let b = BSplineSurface {
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
        .finish();
        let s = Surface::BSpline(b);
        let (_, (v0, v1)) = match &s {
            Surface::BSpline(b) => b.domain(),
            _ => unreachable!(),
        };
        for i in 0..40 {
            let v = v0 + (v1 - v0) * (0.5 + i as f64) / 40.0;
            let p = s.point(0.5, v);
            let (u2, v2) = s.uv(p, None);
            assert!(
                close(p, s.point(u2, v2), 1e-6),
                "cold inversion off-surface at v={v}: residual {}",
                p.sub(s.point(u2, v2)).len()
            );
            assert!(
                (v2 - v).abs() < 0.5,
                "cold inversion landed on the wrong fold: v={v} -> v2={v2}"
            );
        }
    }

    #[test]
    fn weighted_bspline_surface_with_uniform_weights_matches_unweighted() {
        let b0 = flat_patch();
        let mut b1 = flat_patch();
        b1.weights = Some(vec![2.0; 4]); // uniform weights cancel out
        for &(u, v) in &[(0.1, 0.9), (0.5, 0.5)] {
            assert!(close(b0.point(u, v), b1.point(u, v), 1e-12));
        }
    }

    // ------------------------------------------------- new: swept surfaces

    #[test]
    fn extrusion_uv_roundtrip_with_circle_directrix() {
        // oblique extrusion (NOT reducible to a cylinder)
        let f = Frame::new(V3::ZERO, Some(v3(0.0, 0.0, 1.0)), Some(v3(1.0, 0.0, 0.0)));
        let s = Surface::Extrusion {
            curve: Curve3::Circle { f, r: 3.0 },
            dir: v3(0.5, 0.0, 2.0),
        };
        assert_eq!(s.u_period(), Some(std::f64::consts::TAU));
        for &(u, v) in &[(0.4, 0.2), (3.0, 1.5), (5.5, -0.7)] {
            let p = s.point(u, v);
            let (u2, v2) = s.uv(p, None);
            assert!(
                close(p, s.point(u2, v2), 1e-6),
                "extrusion inversion at ({u},{v})"
            );
        }
        // hint chaining follows a boundary walk
        let mut hint = None;
        for i in 0..20 {
            let u = i as f64 * 0.3;
            let p = s.point(u, 1.0);
            let got = s.uv(p, hint);
            assert!(close(p, s.point(got.0, got.1), 1e-6));
            hint = Some(got);
        }
    }

    #[test]
    fn revolution_uv_roundtrip_with_bspline_profile() {
        // an S-shaped profile revolved around z (not reducible)
        let profile = Curve3::BSpline {
            degree: 2,
            knots: vec![0.0, 0.0, 0.0, 1.0, 1.0, 1.0],
            cps: vec![v3(5.0, 0.0, 0.0), v3(8.0, 0.0, 5.0), v3(5.0, 0.0, 10.0)],
            weights: None,
        };
        let axis = Frame::new(V3::ZERO, Some(v3(0.0, 0.0, 1.0)), Some(v3(1.0, 0.0, 0.0)));
        let s = Surface::Revolution {
            curve: profile,
            axis,
        };
        assert_eq!(s.u_period(), Some(std::f64::consts::TAU));
        for &(u, v) in &[(0.3, 0.2), (2.0, 0.5), (4.5, 0.9)] {
            let p = s.point(u, v);
            let (u2, v2) = s.uv(p, None);
            assert!(
                close(p, s.point(u2, v2), 1e-6),
                "revolution inversion at ({u},{v})"
            );
        }
    }

    // ------------------------------------------------- new: pole caps

    #[test]
    fn sphere_and_cone_report_caps() {
        let f = Frame::new(V3::ZERO, Some(v3(0.0, 0.0, 1.0)), None);
        let sph = Surface::Sphere(f, 5.0);
        let caps = sph.v_caps().unwrap();
        assert!((caps.0 + std::f64::consts::FRAC_PI_2).abs() < 1e-12);
        assert!((caps.1 - std::f64::consts::FRAC_PI_2).abs() < 1e-12);
        // pole points coincide for any u
        assert!(close(sph.point(0.0, caps.1), sph.point(2.0, caps.1), 1e-12));

        // cone opening upward from radius 1 at v=0, semi-angle 45°:
        // apex at v = -1
        let cone = Surface::Cone(f, 1.0, std::f64::consts::FRAC_PI_4);
        let caps = cone.v_caps().unwrap();
        assert!((caps.0 + 1.0).abs() < 1e-12);
        assert!(caps.1.is_infinite());
        assert!(cone.point(1.0, caps.0).sub(cone.point(4.0, caps.0)).len() < 1e-9);

        let cyl = Surface::Cylinder(f, 1.0);
        assert!(cyl.v_caps().is_none());
    }
}
