//! Constructive Solid Geometry (ISO 10303-42): CSG primitive meshing plus a
//! BSP-tree mesh boolean to evaluate `BOOLEAN_RESULT` trees (union / difference
//! / intersection) under a `CSG_SOLID`.
//!
//! STEP stores CSG as a recipe — primitives (`block`, `right_circular_cylinder`,
//! …) combined by set operations — not as a mesh. We tessellate each primitive
//! into a closed, outward-oriented polygon soup, then evaluate the boolean tree
//! with the classic BSP algorithm (Thurston / csg.js): partition each operand by
//! the other's face planes, keep/drop/flip the right fragments, and stitch. This
//! is the standard approach for a lightweight (no-kernel) converter. It is robust
//! for primitive trees; the known soft spot is exactly-coplanar coincident faces
//! between operands, where it can leave a thin artifact — acceptable for visual
//! glTF output and far simpler than an exact B-rep surface-intersection kernel.

use crate::geom::{v3, Frame, V3};
use crate::mesh::TriMesh;
use crate::model::{self, TessParams};
use crate::step::StepFile;

// --------------------------------------------------------------- BSP polygons

/// A polygon vertex carrying its own shading normal (interpolated on splits).
#[derive(Clone)]
struct Vertex {
    pos: V3,
    normal: V3,
}

impl Vertex {
    fn lerp(&self, o: &Vertex, t: f64) -> Vertex {
        Vertex {
            pos: self.pos.add(o.pos.sub(self.pos).scale(t)),
            normal: self.normal.add(o.normal.sub(self.normal).scale(t)),
        }
    }
    fn flip(&mut self) {
        self.normal = self.normal.scale(-1.0);
    }
}

/// The supporting plane of a polygon: `normal · x = w`, normal pointing out of
/// the solid.
#[derive(Clone, Copy)]
struct Plane {
    normal: V3,
    w: f64,
}

impl Plane {
    fn from_points(a: V3, b: V3, c: V3) -> Option<Plane> {
        let n = b.sub(a).cross(c.sub(a));
        if n.len() < 1e-300 {
            return None;
        }
        let normal = n.norm();
        Some(Plane {
            normal,
            w: normal.dot(a),
        })
    }
    fn flip(&mut self) {
        self.normal = self.normal.scale(-1.0);
        self.w = -self.w;
    }
}

#[derive(Clone)]
struct Polygon {
    vertices: Vec<Vertex>,
    plane: Plane,
}

impl Polygon {
    /// Build from >=3 vertices, deriving the plane from the first non-degenerate
    /// triple (the vertices are coplanar by construction).
    fn new(vertices: Vec<Vertex>) -> Option<Polygon> {
        if vertices.len() < 3 {
            return None;
        }
        let p0 = vertices[0].pos;
        for i in 1..vertices.len() - 1 {
            if let Some(plane) = Plane::from_points(p0, vertices[i].pos, vertices[i + 1].pos) {
                return Some(Polygon { vertices, plane });
            }
        }
        None
    }
    fn flip(&mut self) {
        self.vertices.reverse();
        for v in &mut self.vertices {
            v.flip();
        }
        self.plane.flip();
    }
}

const COPLANAR: u8 = 0;
const FRONT: u8 = 1;
const BACK: u8 = 2;
const SPANNING: u8 = 3;

impl Plane {
    /// Classify and split `polygon` against this plane, routing the pieces into
    /// the four buckets (csg.js `splitPolygon`). `eps` is the on-plane tolerance.
    fn split_polygon(
        &self,
        polygon: Polygon,
        eps: f64,
        coplanar_front: &mut Vec<Polygon>,
        coplanar_back: &mut Vec<Polygon>,
        front: &mut Vec<Polygon>,
        back: &mut Vec<Polygon>,
    ) {
        let mut polygon_type = 0u8;
        let mut types: Vec<u8> = Vec::with_capacity(polygon.vertices.len());
        for v in &polygon.vertices {
            let t = self.normal.dot(v.pos) - self.w;
            let ty = if t < -eps {
                BACK
            } else if t > eps {
                FRONT
            } else {
                COPLANAR
            };
            polygon_type |= ty;
            types.push(ty);
        }
        match polygon_type {
            COPLANAR => {
                if self.normal.dot(polygon.plane.normal) > 0.0 {
                    coplanar_front.push(polygon);
                } else {
                    coplanar_back.push(polygon);
                }
            }
            FRONT => front.push(polygon),
            BACK => back.push(polygon),
            _ => {
                // SPANNING: cut the polygon along the plane into a front and a
                // back piece, inserting interpolated vertices at the crossings
                let n = polygon.vertices.len();
                let mut f: Vec<Vertex> = Vec::new();
                let mut b: Vec<Vertex> = Vec::new();
                for i in 0..n {
                    let j = (i + 1) % n;
                    let (ti, tj) = (types[i], types[j]);
                    let vi = &polygon.vertices[i];
                    if ti != BACK {
                        f.push(vi.clone());
                    }
                    if ti != FRONT {
                        b.push(vi.clone());
                    }
                    if (ti | tj) == SPANNING {
                        let vj = &polygon.vertices[j];
                        let denom = self.normal.dot(vj.pos.sub(vi.pos));
                        if denom.abs() > 1e-300 {
                            let t = (self.w - self.normal.dot(vi.pos)) / denom;
                            let mid = vi.lerp(vj, t);
                            f.push(mid.clone());
                            b.push(mid);
                        }
                    }
                }
                if let Some(p) = Polygon::new(f) {
                    front.push(p);
                }
                if let Some(p) = Polygon::new(b) {
                    back.push(p);
                }
            }
        }
    }
}

// ------------------------------------------------------------------ BSP node

#[derive(Default)]
struct Node {
    plane: Option<Plane>,
    front: Option<Box<Node>>,
    back: Option<Box<Node>>,
    polygons: Vec<Polygon>,
}

impl Node {
    fn build(&mut self, polygons: Vec<Polygon>, eps: f64) {
        if polygons.is_empty() {
            return;
        }
        if self.plane.is_none() {
            self.plane = Some(polygons[0].plane);
        }
        let plane = self.plane.unwrap();
        let mut front: Vec<Polygon> = Vec::new();
        let mut back: Vec<Polygon> = Vec::new();
        for p in polygons {
            // coplanar pieces (either orientation) stay on this node
            let mut cf: Vec<Polygon> = Vec::new();
            let mut cb: Vec<Polygon> = Vec::new();
            plane.split_polygon(p, eps, &mut cf, &mut cb, &mut front, &mut back);
            self.polygons.append(&mut cf);
            self.polygons.append(&mut cb);
        }
        if !front.is_empty() {
            self.front
                .get_or_insert_with(|| Box::new(Node::default()))
                .build(front, eps);
        }
        if !back.is_empty() {
            self.back
                .get_or_insert_with(|| Box::new(Node::default()))
                .build(back, eps);
        }
    }

    /// Recursively remove all parts of `polygons` that fall inside this BSP.
    fn clip_polygons(&self, polygons: Vec<Polygon>, eps: f64) -> Vec<Polygon> {
        let plane = match self.plane {
            Some(p) => p,
            None => return polygons,
        };
        let mut front: Vec<Polygon> = Vec::new();
        let mut back: Vec<Polygon> = Vec::new();
        for p in polygons {
            // a coplanar fragment is kept on the side its normal agrees with
            let mut cf: Vec<Polygon> = Vec::new();
            let mut cb: Vec<Polygon> = Vec::new();
            plane.split_polygon(p, eps, &mut cf, &mut cb, &mut front, &mut back);
            front.append(&mut cf);
            back.append(&mut cb);
        }
        let mut front = match &self.front {
            Some(n) => n.clip_polygons(front, eps),
            None => front,
        };
        let back = match &self.back {
            Some(n) => n.clip_polygons(back, eps),
            None => Vec::new(), // no back tree -> everything behind is inside, dropped
        };
        front.extend(back);
        front
    }

    /// Clip this node's polygons (recursively) to the volume of `bsp`.
    fn clip_to(&mut self, bsp: &Node, eps: f64) {
        self.polygons = bsp.clip_polygons(std::mem::take(&mut self.polygons), eps);
        if let Some(n) = &mut self.front {
            n.clip_to(bsp, eps);
        }
        if let Some(n) = &mut self.back {
            n.clip_to(bsp, eps);
        }
    }

    fn invert(&mut self) {
        for p in &mut self.polygons {
            p.flip();
        }
        if let Some(p) = &mut self.plane {
            p.flip();
        }
        if let Some(n) = &mut self.front {
            n.invert();
        }
        if let Some(n) = &mut self.back {
            n.invert();
        }
        std::mem::swap(&mut self.front, &mut self.back);
    }

    fn all_polygons(&self) -> Vec<Polygon> {
        let mut out = self.polygons.clone();
        if let Some(n) = &self.front {
            out.extend(n.all_polygons());
        }
        if let Some(n) = &self.back {
            out.extend(n.all_polygons());
        }
        out
    }
}

fn node_from(polygons: &[Polygon], eps: f64) -> Node {
    let mut n = Node::default();
    n.build(polygons.to_vec(), eps);
    n
}

/// `a ∪ b` — keep the parts of each operand outside the other, plus the seam.
fn union(a: &[Polygon], b: &[Polygon], eps: f64) -> Vec<Polygon> {
    let mut na = node_from(a, eps);
    let mut nb = node_from(b, eps);
    na.clip_to(&nb, eps);
    nb.clip_to(&na, eps);
    nb.invert();
    nb.clip_to(&na, eps);
    nb.invert();
    na.build(nb.all_polygons(), eps);
    na.all_polygons()
}

/// `a − b` — drill `b` out of `a` (the cut walls inherit `b`'s flipped normals).
fn subtract(a: &[Polygon], b: &[Polygon], eps: f64) -> Vec<Polygon> {
    let mut na = node_from(a, eps);
    let mut nb = node_from(b, eps);
    na.invert();
    na.clip_to(&nb, eps);
    nb.clip_to(&na, eps);
    nb.invert();
    nb.clip_to(&na, eps);
    nb.invert();
    na.build(nb.all_polygons(), eps);
    na.invert();
    na.all_polygons()
}

/// `a ∩ b` — keep only the overlapping material.
fn intersect(a: &[Polygon], b: &[Polygon], eps: f64) -> Vec<Polygon> {
    let mut na = node_from(a, eps);
    let mut nb = node_from(b, eps);
    na.invert();
    nb.clip_to(&na, eps);
    nb.invert();
    na.clip_to(&nb, eps);
    nb.clip_to(&na, eps);
    na.build(nb.all_polygons(), eps);
    na.invert();
    na.all_polygons()
}

/// On-plane tolerance for the split: relative to the extent of the **smaller**
/// operand, so the boolean behaves the same at any model scale *and* a thin
/// feature subtracted from a large body isn't swallowed by a tolerance sized
/// to the body (a combined-extent eps mis-buckets the thin feature's faces as
/// coplanar and drops them). Floored relative to the larger operand only to
/// stay non-zero when one operand is degenerate — no absolute (unit-assuming)
/// floor.
fn boolean_eps(a: &[Polygon], b: &[Polygon]) -> f64 {
    fn diag(polys: &[Polygon]) -> f64 {
        let mut lo = v3(f64::MAX, f64::MAX, f64::MAX);
        let mut hi = v3(f64::MIN, f64::MIN, f64::MIN);
        for p in polys {
            for v in &p.vertices {
                lo = v3(lo.x.min(v.pos.x), lo.y.min(v.pos.y), lo.z.min(v.pos.z));
                hi = v3(hi.x.max(v.pos.x), hi.y.max(v.pos.y), hi.z.max(v.pos.z));
            }
        }
        if lo.x > hi.x {
            return 0.0; // no vertices
        }
        hi.sub(lo).len()
    }
    let (da, db) = (diag(a), diag(b));
    (da.min(db) * 1e-7).max(da.max(db) * 1e-12).max(1e-300)
}

// ---------------------------------------------------------- primitive meshing

/// Number of segments to span a full `2π` turn of radius `r` at the tolerance.
fn ring_segments(r: f64, tp: &TessParams) -> usize {
    let step = crate::geom::angle_step(r.abs().max(1e-9), tp.deflection, tp.max_angle);
    ((std::f64::consts::TAU / step).ceil() as usize).clamp(8, 720)
}

/// A flat polygon from CCW (as seen from outside) positions, all sharing one
/// face normal `n` (used for the box / caps).
fn flat_face(pts: &[V3], n: V3) -> Option<Polygon> {
    Polygon::new(pts.iter().map(|&p| Vertex { pos: p, normal: n }).collect())
}

/// `block(position, x, y, z)`: a vertex at the placement origin, edges along the
/// positive placement axes, occupying [0,x]×[0,y]×[0,z] (ISO 10303-42).
fn block(f: &Frame, x: f64, y: f64, z: f64) -> Vec<Polygon> {
    let c = |i: f64, j: f64, k: f64| {
        f.o.add(f.x.scale(x * i))
            .add(f.y.scale(y * j))
            .add(f.z.scale(z * k))
    };
    // 8 corners by (i,j,k) in {0,1}
    let p = [
        c(0., 0., 0.), // 0
        c(1., 0., 0.), // 1
        c(1., 1., 0.), // 2
        c(0., 1., 0.), // 3
        c(0., 0., 1.), // 4
        c(1., 0., 1.), // 5
        c(1., 1., 1.), // 6
        c(0., 1., 1.), // 7
    ];
    // each face wound CCW seen from outside so its derived normal points out
    let faces: [([usize; 4], V3); 6] = [
        ([0, 3, 2, 1], f.z.scale(-1.0)), // bottom z=0
        ([4, 5, 6, 7], f.z),             // top z=1
        ([0, 1, 5, 4], f.y.scale(-1.0)), // front y=0
        ([3, 7, 6, 2], f.y),             // back y=1
        ([0, 4, 7, 3], f.x.scale(-1.0)), // left x=0
        ([1, 2, 6, 5], f.x),             // right x=1
    ];
    faces
        .iter()
        .filter_map(|(idx, n)| flat_face(&idx.map(|i| p[i]), *n))
        .collect()
}

/// `right_angular_wedge(position, x, y, z, ltx)`: the trapezoid
/// (0,0) (x,0) (ltx,z) (0,z) in the local xz-plane, extruded along +y
/// (ISO 10303-42). `ltx = 0` degenerates the top edge to a line — a
/// triangular prism; the zero-area top face is dropped.
fn wedge(f: &Frame, x: f64, y: f64, z: f64, ltx: f64) -> Vec<Polygon> {
    let c = |i: f64, j: f64, k: f64| f.o.add(f.x.scale(i)).add(f.y.scale(j)).add(f.z.scale(k));
    let p = [
        c(0., 0., 0.), // 0
        c(x, 0., 0.),  // 1
        c(x, y, 0.),   // 2
        c(0., y, 0.),  // 3
        c(0., 0., z),  // 4
        c(ltx, 0., z), // 5
        c(ltx, y, z),  // 6
        c(0., y, z),   // 7
    ];
    // slant normal: profile edge (x,0) -> (ltx,z) rotated -90° in the xz-plane
    let slant = f.x.scale(z).add(f.z.scale(x - ltx)).norm();
    let quads: [(&[usize], V3); 6] = [
        (&[0, 3, 2, 1], f.z.scale(-1.0)), // bottom
        (&[4, 5, 6, 7], f.z),             // top (zero area when ltx = 0)
        (&[0, 1, 5, 4], f.y.scale(-1.0)), // front y=0 (trapezoid)
        (&[3, 7, 6, 2], f.y),             // back y=y (trapezoid)
        (&[0, 4, 7, 3], f.x.scale(-1.0)), // left x=0
        (&[1, 2, 6, 5], slant),           // slanted face
    ];
    quads
        .iter()
        .filter_map(|(idx, n)| {
            // drop repeated corners (ltx = 0 collapses 4≡5 and 6≡7)
            let mut pts: Vec<V3> = Vec::with_capacity(4);
            for &i in *idx {
                if pts.last().map_or(true, |l| l.sub(p[i]).len() > 1e-12) {
                    pts.push(p[i]);
                }
            }
            while pts.len() > 1 && pts.first().unwrap().sub(*pts.last().unwrap()).len() <= 1e-12 {
                pts.pop();
            }
            if pts.len() < 3 {
                return None;
            }
            flat_face(&pts, *n)
        })
        .collect()
}

/// `right_circular_cylinder(position, height, radius)`: base centre at the
/// placement location, extruded `height` along the placement axis.
fn cylinder(f: &Frame, height: f64, radius: f64, tp: &TessParams) -> Vec<Polygon> {
    let n = ring_segments(radius, tp);
    let axis = f.z;
    let ring = |i: usize| {
        let a = std::f64::consts::TAU * i as f64 / n as f64;
        let radial = f.x.scale(a.cos()).add(f.y.scale(a.sin()));
        (f.o.add(radial.scale(radius)), radial) // (point, outward normal)
    };
    let top = axis.scale(height);
    let mut polys = Vec::with_capacity(n + 2 * (n - 2));
    let cap_b = f.o;
    let cap_t = f.o.add(top);
    for i in 0..n {
        let (b0, r0) = ring(i);
        let (b1, r1) = ring((i + 1) % n);
        let (t0, t1) = (b0.add(top), b1.add(top));
        // side quad, outward radial normals (smooth shading around the wall)
        if let Some(p) = Polygon::new(vec![
            Vertex {
                pos: b0,
                normal: r0,
            },
            Vertex {
                pos: b1,
                normal: r1,
            },
            Vertex {
                pos: t1,
                normal: r1,
            },
            Vertex {
                pos: t0,
                normal: r0,
            },
        ]) {
            polys.push(p);
        }
        // bottom cap fan (normal -axis), top cap fan (normal +axis)
        if let Some(p) = flat_face(&[cap_b, b1, b0], axis.scale(-1.0)) {
            polys.push(p);
        }
        if let Some(p) = flat_face(&[cap_t, t0, t1], axis) {
            polys.push(p);
        }
    }
    polys
}

/// `right_circular_cone(position, height, radius, semi_angle)`: base circle of
/// `radius` at the location, apex at `location + height·axis`.
fn cone(f: &Frame, height: f64, radius: f64, tp: &TessParams) -> Vec<Polygon> {
    let n = ring_segments(radius, tp);
    let apex = f.o.add(f.z.scale(height));
    // outward normal of the cone wall at angle θ: (h·cosθ, h·sinθ, r) in frame
    let on_wall = |a: f64| {
        f.x.scale(height * a.cos())
            .add(f.y.scale(height * a.sin()))
            .add(f.z.scale(radius))
            .norm()
    };
    let base = |i: usize| {
        let a = std::f64::consts::TAU * i as f64 / n as f64;
        f.o.add(f.x.scale(radius * a.cos()))
            .add(f.y.scale(radius * a.sin()))
    };
    let mut polys = Vec::with_capacity(2 * n);
    for i in 0..n {
        let a0 = std::f64::consts::TAU * i as f64 / n as f64;
        let a1 = std::f64::consts::TAU * (i + 1) as f64 / n as f64;
        let (b0, b1) = (base(i), base((i + 1) % n));
        let (nn0, nn1) = (on_wall(a0), on_wall(a1));
        // side triangle to the apex; apex normal averaged from the two edges
        if let Some(p) = Polygon::new(vec![
            Vertex {
                pos: b0,
                normal: nn0,
            },
            Vertex {
                pos: b1,
                normal: nn1,
            },
            Vertex {
                pos: apex,
                normal: nn0.add(nn1).norm(),
            },
        ]) {
            polys.push(p);
        }
        // base cap fan (normal -axis)
        if let Some(p) = flat_face(&[f.o, b1, b0], f.z.scale(-1.0)) {
            polys.push(p);
        }
    }
    polys
}

/// `sphere(radius, centre)`: a UV sphere about `centre` (no placement frame, so
/// the global axes are used).
fn sphere(centre: V3, radius: f64, tp: &TessParams) -> Vec<Polygon> {
    let n_lon = ring_segments(radius, tp);
    let n_lat = (n_lon / 2).max(4);
    let pt = |ilat: usize, ilon: usize| {
        let phi = std::f64::consts::PI * ilat as f64 / n_lat as f64; // 0..π
        let theta = std::f64::consts::TAU * ilon as f64 / n_lon as f64;
        let nrm = v3(phi.sin() * theta.cos(), phi.sin() * theta.sin(), phi.cos());
        (centre.add(nrm.scale(radius)), nrm)
    };
    let mut polys = Vec::new();
    for j in 0..n_lat {
        for i in 0..n_lon {
            let (p00, n00) = pt(j, i);
            let (p01, n01) = pt(j, (i + 1) % n_lon);
            let (p10, n10) = pt(j + 1, i);
            let (p11, n11) = pt(j + 1, (i + 1) % n_lon);
            // wound [p00, p10, p11, p01] for an outward (radial) normal,
            // collapsing the degenerate triangle at each pole (north: p00≡p01,
            // south: p10≡p11)
            let mut vs: Vec<Vertex> = vec![
                Vertex {
                    pos: p00,
                    normal: n00,
                },
                Vertex {
                    pos: p10,
                    normal: n10,
                },
            ];
            if j + 1 != n_lat {
                vs.push(Vertex {
                    pos: p11,
                    normal: n11,
                });
            }
            if j != 0 {
                vs.push(Vertex {
                    pos: p01,
                    normal: n01,
                });
            }
            if let Some(p) = Polygon::new(vs) {
                polys.push(p);
            }
        }
    }
    polys
}

/// `torus(position, major_radius, minor_radius)`: tube of `minor` swept on a
/// circle of `major` in the placement's xy-plane, about its axis.
fn torus(f: &Frame, major: f64, minor: f64, tp: &TessParams) -> Vec<Polygon> {
    let n_major = ring_segments(major + minor, tp);
    let n_minor = ring_segments(minor, tp).max(6);
    let pt = |i: usize, j: usize| {
        let u = std::f64::consts::TAU * i as f64 / n_major as f64; // around axis
        let v = std::f64::consts::TAU * j as f64 / n_minor as f64; // around tube
        let radial = f.x.scale(u.cos()).add(f.y.scale(u.sin()));
        let nrm = radial.scale(v.cos()).add(f.z.scale(v.sin()));
        let pos =
            f.o.add(radial.scale(major + minor * v.cos()))
                .add(f.z.scale(minor * v.sin()));
        (pos, nrm)
    };
    let mut polys = Vec::with_capacity(n_major * n_minor);
    for i in 0..n_major {
        for j in 0..n_minor {
            let (p00, n00) = pt(i, j);
            let (p10, n10) = pt((i + 1) % n_major, j);
            let (p11, n11) = pt((i + 1) % n_major, (j + 1) % n_minor);
            let (p01, n01) = pt(i, (j + 1) % n_minor);
            if let Some(p) = Polygon::new(vec![
                Vertex {
                    pos: p00,
                    normal: n00,
                },
                Vertex {
                    pos: p10,
                    normal: n10,
                },
                Vertex {
                    pos: p11,
                    normal: n11,
                },
                Vertex {
                    pos: p01,
                    normal: n01,
                },
            ]) {
                polys.push(p);
            }
        }
    }
    polys
}

// ------------------------------------------------------------- tree evaluation

/// A placement frame from either an `axis2_placement_3d` (location + axis + ref)
/// or an `axis1_placement` (location + axis) — CSG primitives use both, and some
/// exporters substitute one for the other.
fn placement_frame(sf: &StepFile, id: u32) -> Option<Frame> {
    match sf.entity_type(id)? {
        "AXIS2_PLACEMENT_3D" => model::axis2_placement(sf, id),
        _ => model::axis1_placement(sf, id),
    }
}

/// Evaluate a CSG node (primitive, boolean_result, or csg_solid wrapper) to a
/// closed, outward-oriented polygon soup in model space. `None` for an operand
/// type we cannot mesh (e.g. half_space_solid, or a B-rep solid operand).
fn eval_operand(sf: &StepFile, id: u32, tp: &TessParams, depth: u32) -> Option<Vec<Polygon>> {
    if depth > 64 {
        return None;
    }
    let ty = sf.entity_type(id)?;
    let p = sf.params(id)?;
    match ty {
        "CSG_SOLID" => {
            // csg_solid(tree_root_expression)
            eval_operand(sf, p.get(1)?.as_ref_id()?, tp, depth + 1)
        }
        "BOOLEAN_RESULT" => {
            // boolean_result(operator, first_operand, second_operand). A
            // half-space operand is unbounded and can't be meshed standalone:
            // materialize it as a block clipped to the *other* operand's
            // bounds (exact within the region where the boolean can matter).
            let op = p.get(1)?.as_enum()?;
            let ia = p.get(2)?.as_ref_id()?;
            let ib = p.get(3)?.as_ref_id()?;
            let (a, b) = match (
                eval_operand(sf, ia, tp, depth + 1),
                eval_operand(sf, ib, tp, depth + 1),
            ) {
                (Some(a), Some(b)) => (a, b),
                (Some(a), None) => {
                    let b = half_space_block(sf, ib, &a)?;
                    (a, b)
                }
                (None, Some(b)) => {
                    let a = half_space_block(sf, ia, &b)?;
                    (a, b)
                }
                (None, None) => return None,
            };
            let eps = boolean_eps(&a, &b);
            Some(match op {
                "UNION" => union(&a, &b, eps),
                "INTERSECTION" => intersect(&a, &b, eps),
                "DIFFERENCE" => subtract(&a, &b, eps),
                _ => return None,
            })
        }
        "BLOCK" => {
            let f = placement_frame(sf, p.get(1)?.as_ref_id()?)?;
            Some(block(
                &f,
                p.get(2)?.as_f64()?,
                p.get(3)?.as_f64()?,
                p.get(4)?.as_f64()?,
            ))
        }
        "RIGHT_CIRCULAR_CYLINDER" => {
            let f = placement_frame(sf, p.get(1)?.as_ref_id()?)?;
            Some(cylinder(&f, p.get(2)?.as_f64()?, p.get(3)?.as_f64()?, tp))
        }
        "RIGHT_CIRCULAR_CONE" => {
            let f = placement_frame(sf, p.get(1)?.as_ref_id()?)?;
            Some(cone(&f, p.get(2)?.as_f64()?, p.get(3)?.as_f64()?, tp))
        }
        "SPHERE" => {
            // sphere(radius, centre)
            let radius = p.get(1)?.as_f64()?;
            let centre = model::cartesian_point(sf, p.get(2)?.as_ref_id()?)?;
            Some(sphere(centre, radius, tp))
        }
        "TORUS" => {
            let f = placement_frame(sf, p.get(1)?.as_ref_id()?)?;
            Some(torus(&f, p.get(2)?.as_f64()?, p.get(3)?.as_f64()?, tp))
        }
        "RIGHT_ANGULAR_WEDGE" => {
            // ('', position, x, y, z, ltx): trapezoidal profile in the local
            // xz-plane — (0,0) (x,0) (ltx,z) (0,z) — extruded along y
            let f = placement_frame(sf, p.get(1)?.as_ref_id()?)?;
            Some(wedge(
                &f,
                p.get(2)?.as_f64()?,
                p.get(3)?.as_f64()?,
                p.get(4)?.as_f64()?,
                p.get(5)?.as_f64()?,
            ))
        }
        _ => None, // half_space_solid (bounded at the boolean), brep operand: unmeshed
    }
}

/// Materialize a HALF_SPACE_SOLID / BOXED_HALF_SPACE (planar base surface)
/// as a block: one face on the plane, extending into the material side far
/// enough to fully cover `other`'s bounding box. Exact wherever the boolean
/// against `other` can produce geometry; the far faces lie strictly outside
/// `other` and are cut away. `agreement_flag = .T.` means the surface normal
/// points *away* from the material (ISO 10303-42).
fn half_space_block(sf: &StepFile, id: u32, other: &[Polygon]) -> Option<Vec<Polygon>> {
    let ty = sf.entity_type(id)?;
    if ty != "HALF_SPACE_SOLID" && ty != "BOXED_HALF_SPACE" {
        return None;
    }
    // ('', base_surface, agreement_flag[, enclosure]) — the BOXED enclosure is
    // an optimization hint; the plane + flag define the solid
    let p = sf.params(id)?;
    let f = match model::surface(sf, p.get(1)?.as_ref_id()?) {
        Some(crate::geom::Surface::Plane(f)) => f,
        _ => return None, // non-planar half-space: unmeshed
    };
    let agreement = p.get(2).and_then(|v| v.as_bool()).unwrap_or(true);

    // bbox of the bounded operand
    let mut lo = v3(f64::MAX, f64::MAX, f64::MAX);
    let mut hi = v3(f64::MIN, f64::MIN, f64::MIN);
    for poly in other {
        for v in &poly.vertices {
            lo = v3(lo.x.min(v.pos.x), lo.y.min(v.pos.y), lo.z.min(v.pos.z));
            hi = v3(hi.x.max(v.pos.x), hi.y.max(v.pos.y), hi.z.max(v.pos.z));
        }
    }
    if lo.x > hi.x {
        return None;
    }
    let c = lo.add(hi).scale(0.5);
    let r = hi.sub(lo).len().max(1e-9) * 2.0;

    // block frame: sits on the plane at the lateral projection of the bbox
    // centre, z into the material (right-handed via y = z × x)
    let zdir = if agreement { f.z.scale(-1.0) } else { f.z };
    let xdir = f.x;
    let ydir = zdir.cross(xdir);
    let d = c.sub(f.o);
    let proj = f.o.add(f.x.scale(d.dot(f.x))).add(f.y.scale(d.dot(f.y)));
    let o = proj.sub(xdir.scale(r)).sub(ydir.scale(r));
    Some(block(
        &Frame {
            o,
            x: xdir,
            y: ydir,
            z: zdir,
        },
        2.0 * r,
        2.0 * r,
        2.0 * r,
    ))
}

/// Fan-triangulate the (convex) result polygons into a `TriMesh` with normals.
fn to_trimesh(polys: &[Polygon]) -> TriMesh {
    let mut m = TriMesh::default();
    for poly in polys {
        let nverts = poly.vertices.len();
        if nverts < 3 {
            continue;
        }
        let base = m.vertex_count() as u32;
        for v in &poly.vertices {
            m.push_vertex(v.pos, v.normal);
        }
        for i in 1..nverts as u32 - 1 {
            m.indices.extend_from_slice(&[base, base + i, base + i + 1]);
        }
    }
    m
}

/// Evaluate a `CSG_SOLID` / `BOOLEAN_RESULT` / CSG primitive to a triangle mesh,
/// or `None` if it (or one of its operands) uses geometry we cannot mesh.
pub fn eval_csg(sf: &StepFile, id: u32, tp: &TessParams) -> Option<TriMesh> {
    let polys = eval_operand(sf, id, tp, 0)?;
    if polys.is_empty() {
        return None;
    }
    Some(to_trimesh(&polys))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Signed volume of a closed outward-oriented polygon soup (fan-triangulated
    /// divergence theorem) — positive equals the enclosed volume.
    fn vol(polys: &[Polygon]) -> f64 {
        let mut v = 0.0;
        for p in polys {
            for i in 1..p.vertices.len() - 1 {
                let (a, b, c) = (p.vertices[0].pos, p.vertices[i].pos, p.vertices[i + 1].pos);
                v += a.dot(b.cross(c)) / 6.0;
            }
        }
        v
    }
    fn ident(o: V3) -> Frame {
        Frame::new(o, Some(v3(0., 0., 1.)), Some(v3(1., 0., 0.)))
    }
    fn tp() -> TessParams {
        TessParams {
            deflection: 0.005,
            max_angle: 0.15,
        }
    }

    #[test]
    fn block_volume_is_exact() {
        assert!((vol(&block(&ident(V3::ZERO), 2.0, 3.0, 4.0)) - 24.0).abs() < 1e-9);
    }

    #[test]
    fn round_primitive_volumes_converge() {
        let cyl = vol(&cylinder(&ident(V3::ZERO), 10.0, 3.0, &tp()));
        let cyl_ideal = std::f64::consts::PI * 9.0 * 10.0;
        assert!((cyl - cyl_ideal).abs() < 0.01 * cyl_ideal, "cylinder {cyl}");

        let sph = vol(&sphere(V3::ZERO, 2.0, &tp()));
        let sph_ideal = 4.0 / 3.0 * std::f64::consts::PI * 8.0;
        assert!((sph - sph_ideal).abs() < 0.02 * sph_ideal, "sphere {sph}");

        let cone_v = vol(&cone(&ident(V3::ZERO), 6.0, 2.0, &tp()));
        let cone_ideal = std::f64::consts::PI * 4.0 * 6.0 / 3.0;
        assert!(
            (cone_v - cone_ideal).abs() < 0.02 * cone_ideal,
            "cone {cone_v}"
        );

        let tor = vol(&torus(&ident(V3::ZERO), 5.0, 1.5, &tp()));
        let tor_ideal = 2.0 * std::f64::consts::PI.powi(2) * 5.0 * 1.5 * 1.5;
        assert!((tor - tor_ideal).abs() < 0.02 * tor_ideal, "torus {tor}");
    }

    #[test]
    fn boolean_ops_match_set_volumes() {
        // unit cube at origin, and a unit cube shifted +0.5 in x (overlap = half)
        let a = block(&ident(V3::ZERO), 1.0, 1.0, 1.0);
        let b = block(&ident(v3(0.5, 0.0, 0.0)), 1.0, 1.0, 1.0);
        let eps = boolean_eps(&a, &b);
        // A − B keeps x∈[0,0.5] → 0.5
        assert!((vol(&subtract(&a, &b, eps)) - 0.5).abs() < 1e-6, "subtract");
        // A ∩ B keeps x∈[0.5,1] → 0.5
        assert!(
            (vol(&intersect(&a, &b, eps)) - 0.5).abs() < 1e-6,
            "intersect"
        );
        // A ∪ B = 2 − overlap → 1.5
        assert!((vol(&union(&a, &b, eps)) - 1.5).abs() < 1e-6, "union");
    }

    #[test]
    fn subtract_is_oriented_outward() {
        // a hole entirely inside the block keeps a positive (outward) volume
        let a = block(&ident(V3::ZERO), 10.0, 10.0, 10.0);
        let b = cylinder(&ident(v3(5.0, 5.0, 0.0)), 10.0, 3.0, &tp());
        let r = subtract(&a, &b, boolean_eps(&a, &b));
        let v = vol(&r);
        assert!(v > 0.0, "result must stay outward-oriented (v={v})");
        let ideal = 1000.0 - std::f64::consts::PI * 9.0 * 10.0;
        assert!(
            (v - ideal).abs() < 0.02 * ideal,
            "drilled volume {v} vs {ideal}"
        );
    }
}
