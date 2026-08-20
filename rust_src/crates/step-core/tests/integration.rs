//! End-to-end tests over real STEP text: parsing, hierarchy extraction,
//! tessellation correctness (area / normals / watertight-ish checks) and
//! GLB output validity.

use step_core::geom::{v3, V3};
use step_core::mesh::{MeshSet, TriMesh};
use step_core::model::TessParams;
use step_core::step::StepFile;
use step_core::styles::{self, ColorMap};
use step_core::tessellate::{self, Ctx, TessStats};
use step_core::{glb, hierarchy, merge};

fn load(name: &str) -> StepFile {
    let path = format!("{}/tests/fixtures/{}", env!("CARGO_MANIFEST_DIR"), name);
    StepFile::parse(std::fs::read(path).expect("fixture")).expect("parse")
}

fn tp() -> TessParams {
    TessParams {
        deflection: 0.05,
        max_angle: 20.0_f64.to_radians(),
    }
}

fn tessellate_all(sf: &StepFile, types: &[&str]) -> (MeshSet, TessStats) {
    let tp = tp();
    let colors = styles::build_color_map(sf);
    tessellate_with(sf, &tp, &colors, types)
}

fn tessellate_with(
    sf: &StepFile,
    tp: &TessParams,
    colors: &ColorMap,
    types: &[&str],
) -> (MeshSet, TessStats) {
    let cx = Ctx {
        sf,
        tp,
        colors,
        threads: 1,
    };
    let mut set = MeshSet::default();
    let mut stats = TessStats::default();
    for ty in types {
        for &id in sf.of_type(ty) {
            tessellate::tessellate_item(&cx, id, None, &mut set, &mut stats);
        }
    }
    (set, stats)
}

fn total_area(m: &TriMesh) -> f64 {
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

/// Signed volume of a closed, outward-oriented mesh (divergence theorem):
/// Σ (v0 · (v1 × v2)) / 6. Positive when the surface normals face outward.
fn signed_volume(m: &TriMesh) -> f64 {
    let p = |i: u32| {
        v3(
            m.positions[i as usize * 3] as f64,
            m.positions[i as usize * 3 + 1] as f64,
            m.positions[i as usize * 3 + 2] as f64,
        )
    };
    m.indices
        .chunks(3)
        .map(|t| p(t[0]).dot(p(t[1]).cross(p(t[2]))) / 6.0)
        .sum()
}

// ------------------------------------------------------------- planar face

#[test]
fn planar_triangle_face_tessellates_exactly() {
    let sf = load("triangle.step");
    let (set, stats) = tessellate_all(&sf, &["MANIFOLD_SOLID_BREP"]);
    let mesh = set.merged();
    assert_eq!(stats.faces_ok, 1);
    assert_eq!(stats.faces_failed, 0);
    assert!(!mesh.is_empty());
    // right triangle with legs of 10 -> area 50
    assert!((total_area(&mesh) - 50.0).abs() < 1e-6);
    // every normal is +z (same_sense = .T., plane axis = +z)
    for n in mesh.normals.chunks(3) {
        assert!((n[2] - 1.0).abs() < 1e-6, "normal {:?}", n);
    }
    // triangle winding must agree with the normal
    let p = |i: u32| {
        v3(
            mesh.positions[i as usize * 3] as f64,
            mesh.positions[i as usize * 3 + 1] as f64,
            mesh.positions[i as usize * 3 + 2] as f64,
        )
    };
    for t in mesh.indices.chunks(3) {
        let gn = p(t[1]).sub(p(t[0])).cross(p(t[2]).sub(p(t[0])));
        assert!(gn.z > 0.0, "winding disagrees with face normal");
    }
}

// ----------------------------------------------- edge with a null 3D curve

#[test]
fn edge_with_null_curve_falls_back_to_a_segment() {
    // A loop edge whose 3D curve is `$` is a straight segment between its
    // vertices; it must not drop the edge -> loop -> whole face to a skip.
    let sf = load("null_curve_edge.step");
    let (set, stats) = tessellate_all(&sf, &["MANIFOLD_SOLID_BREP"]);
    let mesh = set.merged();
    assert_eq!(stats.faces_ok, 1, "face must tessellate, not be skipped");
    assert_eq!(stats.faces_failed, 0);
    // right triangle with legs 12 and 8 -> area 48
    assert!((total_area(&mesh) - 48.0).abs() < 1e-6);
}

// ---------------------------- hole inscribed in a curved rim -> shrink retry

#[test]
fn inscribed_hole_recovers_by_shrinking() {
    // The square hole's corners lie exactly on the circular rim, so once the
    // rim is discretized they poke through it; the face must still tessellate
    // (holes nudged inward) instead of being skipped.
    let sf = load("inscribed_hole.step");
    let (set, stats) = tessellate_all(&sf, &["MANIFOLD_SOLID_BREP"]);
    let mesh = set.merged();
    assert_eq!(stats.faces_ok, 1, "inscribed-hole face must recover");
    assert_eq!(stats.faces_failed, 0);
    // pi*100 - 200 ~= 114.16, a touch more after the hole is nudged inward
    let a = total_area(&mesh);
    assert!((110.0..120.0).contains(&a), "area {}", a);
    for p in mesh.positions.chunks(3) {
        assert!(p[2].abs() < 1e-6, "off-plane point {:?}", p);
    }
}

// ------------------------------ thin curved face -> finer-retry on tess2 fail

#[test]
fn thin_arc_band_recovers_via_finer_retry() {
    // At a coarse deflection the two near-concentric boundary arcs (r40, r40.3)
    // self-intersect once discretized; the face must still tessellate via the
    // finer-retry fallback instead of being skipped.
    let sf = load("thin_arc_band.step");
    let coarse = TessParams {
        deflection: 1.0,
        max_angle: 25.0_f64.to_radians(),
    };
    let colors = styles::build_color_map(&sf);
    let (set, stats) = tessellate_with(&sf, &coarse, &colors, &["MANIFOLD_SOLID_BREP"]);
    let mesh = set.merged();
    assert_eq!(stats.faces_ok, 1, "thin band must recover via finer retry");
    assert_eq!(stats.faces_failed, 0);
    // annular sector area ~ (pi/3)*(40.3^2 - 40^2)/2 ~= 12.6
    assert!(
        (total_area(&mesh) - 12.6).abs() < 0.6,
        "area {}",
        total_area(&mesh)
    );
    for p in mesh.positions.chunks(3) {
        assert!(p[2].abs() < 1e-6, "off-plane point {:?}", p);
    }
}

// ----------------------------------- B-spline patch with no real boundary

#[test]
fn bspline_patch_with_degenerate_bound_tessellates_full_domain() {
    // A B-spline face whose only bound is degenerate (a VERTEX_LOOP / seam
    // slit) must tessellate over its whole knot domain, not be skipped: the
    // knot domain is the patch extent, so this reproduces just the patch.
    let sf = load("bspline_unbounded.step");
    let (set, stats) = tessellate_all(&sf, &["MANIFOLD_SOLID_BREP"]);
    let mesh = set.merged();
    assert_eq!(stats.faces_ok, 1, "patch must tessellate, not be skipped");
    assert_eq!(stats.faces_failed, 0);
    // flat 10x10 patch -> area 100, independent of tessellation density
    assert!(
        (total_area(&mesh) - 100.0).abs() < 1e-4,
        "area {}",
        total_area(&mesh)
    );
    // planar patch in z=0: every point on the plane
    for p in mesh.positions.chunks(3) {
        assert!(p[2].abs() < 1e-6, "off-plane point {:?}", p);
    }
}

// --------------------------- closed B-spline with a degenerate apex (pole)

#[test]
fn closed_bspline_cone_with_apex_pole_tessellates() {
    // Vendor excerpt: a rational B-spline closed in u whose top control row
    // collapses to one point — a NURBS cone/dome apex (a parametric pole). Its
    // lone boundary loop winds once around the seam, so it used to fall into the
    // periodic-band path and fail ("no analytic v_caps for a B-spline pole").
    // The closed-surface grid path must cap it: tessellate, not skip.
    let sf = load("bspline_cone_pole.step");
    let (set, stats) = tessellate_all(&sf, &["ADVANCED_FACE"]);
    let mesh = set.merged();
    assert_eq!(
        stats.faces_ok, 1,
        "capped B-spline must tessellate, not skip"
    );
    assert_eq!(stats.faces_failed, 0);
    assert_eq!(stats.degenerate_faces, 0);
    assert!(!mesh.is_empty(), "must emit triangles");
    // the apex row collapses, so a band of triangles there is zero-area, but the
    // dome wall has real area — sanity-check it is positive and finite
    let area = total_area(&mesh);
    assert!(
        area > 1.0 && area.is_finite(),
        "implausible dome area {area}"
    );
    // By the convex-hull property a B-spline surface lies within the bounding
    // box of its control net. At ~3.5M-unit coordinates this is the robust
    // on-surface check (Newton round-trip is noisy at that magnitude); it also
    // rules out the pre-fix garbage — fold-bridging triangles would land far
    // outside the net. The control net spans ~87 x 87 x 17 units.
    let surf = step_core::model::surface(&sf, 288206).expect("surface");
    let (lo, hi) = match &surf {
        step_core::geom::Surface::BSpline(b) => {
            let mut lo = v3(f64::MAX, f64::MAX, f64::MAX);
            let mut hi = v3(f64::MIN, f64::MIN, f64::MIN);
            for p in &b.cps {
                lo = v3(lo.x.min(p.x), lo.y.min(p.y), lo.z.min(p.z));
                hi = v3(hi.x.max(p.x), hi.y.max(p.y), hi.z.max(p.z));
            }
            (lo, hi)
        }
        _ => panic!("expected a B-spline surface"),
    };
    let eps = 1e-3 * hi.sub(lo).len();
    for c in mesh.positions.chunks(3) {
        let p = v3(c[0] as f64, c[1] as f64, c[2] as f64);
        assert!(
            p.x >= lo.x - eps
                && p.x <= hi.x + eps
                && p.y >= lo.y - eps
                && p.y <= hi.y + eps
                && p.z >= lo.z - eps
                && p.z <= hi.z + eps,
            "vertex {p:?} outside control-net hull (fold garbage?)"
        );
    }
}

// ---------------------------------------- CSG: block minus a drilled cylinder

#[test]
fn csg_block_minus_cylinder_drills_a_hole() {
    // CSG_SOLID -> BOOLEAN_RESULT(.DIFFERENCE., BLOCK 10^3, CYLINDER r3 h10).
    // Evaluating the boolean must drill a through-hole, not render the block and
    // cylinder as separate solids. Checked by enclosed volume: block 1000 minus
    // a (faceted) cylinder pi*3^2*10 ~= 282.7, so ~717. The faceted hole removes
    // slightly less than the ideal cylinder, so the result is marginally above.
    let sf = load("csg_block_minus_cylinder.step");
    let (set, stats) = tessellate_all(&sf, &["CSG_SOLID"]);
    let mesh = set.merged();
    assert_eq!(stats.faces_ok, 1, "CSG_SOLID must evaluate to geometry");
    assert!(!mesh.is_empty());
    let vol = signed_volume(&mesh);
    let ideal = 1000.0 - std::f64::consts::PI * 9.0 * 10.0; // ~717.26
    assert!(
        vol > ideal - 1.0 && vol < ideal + 6.0,
        "volume {vol:.2} vs ideal {ideal:.2} (block-with-hole)"
    );
    // sanity: clearly less than the solid block (the hole was actually removed)
    assert!(
        vol < 950.0,
        "hole not removed (volume {vol:.2} ~ solid block)"
    );
    // every vertex lies within the block bounds [0,10]^3 (no stray geometry)
    for c in mesh.positions.chunks(3) {
        for &x in c {
            assert!(
                (-1e-4..=10.0 + 1e-4).contains(&x),
                "vertex out of block: {c:?}"
            );
        }
    }
}

// ------------------------------- no-knot B-spline forms (uniform / Bézier)

#[test]
fn bezier_surface_form_synthesizes_knots_and_evaluates() {
    // A degree-2x2 BEZIER_SURFACE carries no explicit knots — they are implied
    // by the type and must be synthesized. Flat 10x10 corners with the centre
    // control point lifted to z=5 make it a genuine curved Bézier (not a plane):
    // verify it resolves and evaluates (corners interpolate, centre bulges).
    let src = "DATA;
#10=CARTESIAN_POINT('',(0.,0.,0.));
#11=CARTESIAN_POINT('',(0.,5.,0.));
#12=CARTESIAN_POINT('',(0.,10.,0.));
#13=CARTESIAN_POINT('',(5.,0.,0.));
#14=CARTESIAN_POINT('',(5.,5.,5.));
#15=CARTESIAN_POINT('',(5.,10.,0.));
#16=CARTESIAN_POINT('',(10.,0.,0.));
#17=CARTESIAN_POINT('',(10.,5.,0.));
#18=CARTESIAN_POINT('',(10.,10.,0.));
#20=BEZIER_SURFACE('',2,2,((#10,#11,#12),(#13,#14,#15),(#16,#17,#18)),.UNSPECIFIED.,.F.,.F.,.F.);
ENDSEC;";
    let sf = StepFile::parse(src.as_bytes().to_vec()).expect("parse");
    let surf = step_core::model::surface(&sf, 20).expect("BEZIER_SURFACE resolves");
    assert!(
        matches!(surf, step_core::geom::Surface::BSpline(_)),
        "BEZIER_SURFACE must build a B-spline"
    );
    // Bézier patches interpolate their corner control points (domain [0,1]^2)
    assert!(surf.point(0., 0.).sub(v3(0., 0., 0.)).len() < 1e-9);
    assert!(surf.point(1., 1.).sub(v3(10., 10., 0.)).len() < 1e-9);
    // de Casteljau at the centre: z = 0.25 * 5 = 1.25, proving it is evaluated
    // as a real Bézier surface, not flattened
    let c = surf.point(0.5, 0.5);
    assert!(
        (c.x - 5.).abs() < 1e-9 && (c.y - 5.).abs() < 1e-9,
        "centre xy {c:?}"
    );
    assert!(
        (c.z - 1.25).abs() < 1e-9,
        "centre bulge z {} (want 1.25)",
        c.z
    );
}

#[test]
fn uniform_curve_form_synthesizes_knots() {
    // A UNIFORM_CURVE carries no explicit knots either. Degree 1 over three
    // collinear control points must resolve to a B-spline curve, not be dropped
    // as an unsupported curve type.
    let src = "DATA;
#1=CARTESIAN_POINT('',(0.,0.,0.));
#2=CARTESIAN_POINT('',(5.,0.,0.));
#3=CARTESIAN_POINT('',(10.,0.,0.));
#4=UNIFORM_CURVE('',1,(#1,#2,#3),.UNSPECIFIED.,.F.,.F.);
ENDSEC;";
    let sf = StepFile::parse(src.as_bytes().to_vec()).expect("parse");
    let curve = step_core::model::curve3(&sf, 4).expect("UNIFORM_CURVE resolves");
    assert!(
        matches!(curve, step_core::geom::Curve3::BSpline { .. }),
        "UNIFORM_CURVE must build a B-spline curve"
    );
}

// -------------------------------- degenerate zero-area sliver face is skipped

#[test]
fn degenerate_sliver_face_is_skipped_not_failed() {
    // A planar face bounded by a single edge whose start and end vertex coincide
    // (a LINE cannot close on itself with any area) is a zero-area sliver — CAD
    // kernels emit these from boolean ops. It must be counted as degenerate and
    // skipped quietly, NOT reported as a tessellation failure.
    let sf = load("degenerate_sliver_face.step");
    let (set, stats) = tessellate_all(&sf, &["ADVANCED_FACE"]);
    assert_eq!(
        stats.degenerate_faces, 1,
        "sliver must be flagged degenerate"
    );
    assert_eq!(stats.faces_failed, 0, "a zero-area face is not a failure");
    assert_eq!(stats.faces_ok, 0);
    assert!(set.merged().is_empty(), "degenerate face emits no geometry");
}

// -------------------------------------------- periodic full cylinder band

#[test]
fn full_cylinder_band_handles_the_seam() {
    let sf = load("cylinder_band.step");
    let (set, stats) = tessellate_all(&sf, &["SHELL_BASED_SURFACE_MODEL"]);
    let mesh = set.merged();
    assert_eq!(stats.faces_ok, 1, "seam face must tessellate");
    // lateral area 2*pi*r*h = 2*pi*5*10; chordal mesh slightly underestimates
    let expect = std::f64::consts::TAU * 5.0 * 10.0;
    let area = total_area(&mesh);
    assert!(
        (area - expect).abs() / expect < 0.01,
        "area {} vs {}",
        area,
        expect
    );
    // all points must lie on the cylinder
    for c in mesh.positions.chunks(3) {
        let r = ((c[0] as f64).powi(2) + (c[1] as f64).powi(2)).sqrt();
        assert!((r - 5.0).abs() < 1e-6);
        assert!((-1e-6..=10.0 + 1e-6).contains(&(c[2] as f64)));
    }
    // normals radial and outward
    for i in 0..mesh.vertex_count() {
        let p = V3 {
            x: mesh.positions[i * 3] as f64,
            y: mesh.positions[i * 3 + 1] as f64,
            z: 0.0,
        }
        .norm();
        let n = V3 {
            x: mesh.normals[i * 3] as f64,
            y: mesh.normals[i * 3 + 1] as f64,
            z: mesh.normals[i * 3 + 2] as f64,
        };
        assert!(p.dot(n) > 0.99, "normal not radial/outward");
    }
}

// ------------------------------- two-edge sliver face (line + shallow arc)

#[test]
fn two_edge_arc_sliver_face_keeps_an_arc_point() {
    // Vendor-model excerpt: a planar sliver bounded by exactly two edges, a
    // chord and a ~12.7° arc (r 7.14). At a coarse deflection the arc used to
    // discretize to a single chord, collapsing the closed loop to 2 points
    // and dropping the face; arcs must always keep an interior point.
    let sf = load("two_edge_arc_sliver.step");
    let coarse = TessParams {
        deflection: 1.0,
        max_angle: 25.0_f64.to_radians(),
    };
    let colors = styles::build_color_map(&sf);
    let (set, stats) = tessellate_with(&sf, &coarse, &colors, &["MANIFOLD_SOLID_BREP"]);
    let mesh = set.merged();
    assert_eq!(stats.faces_ok, 1, "sliver face must tessellate");
    assert_eq!(stats.faces_failed, 0);
    // chord 1.584, sagitta 0.044 -> at minimum one triangle of area ~0.035,
    // converging to the lens area ~0.047 as the arc refines
    let area = total_area(&mesh);
    assert!(
        (0.02..=0.06).contains(&area),
        "sliver area out of range: {}",
        area
    );
}

// --------------- cylinder band, closed B-spline rims with off-seam vertices

#[test]
fn closed_bspline_rim_with_offset_seam_vertex_tessellates() {
    // Vendor-model excerpt: a full cylinder band (r 2.5) whose rims are
    // *closed* B-spline edges. The edge vertex sits half-way around the basis
    // curve's own seam; the rim polylines must be re-seamed at the vertex
    // instead of snapping the curve's endpoints across the cylinder (which
    // used to self-intersect the UV contour and drop the face).
    let sf = load("cylinder_offset_seam_rims.step");
    let (set, stats) = tessellate_all(&sf, &["MANIFOLD_SOLID_BREP"]);
    let mesh = set.merged();
    assert_eq!(stats.faces_ok, 1, "band face must tessellate");
    assert_eq!(stats.faces_failed, 0);
    // wavy rims at |y| in 7.6..8.0 -> mean height ~15.6, area ~ 2*pi*2.5*15.6
    let area = total_area(&mesh);
    assert!(
        (220.0..=270.0).contains(&area),
        "band area out of range: {}",
        area
    );
    // every vertex on the cylinder x^2 + (z-958)^2 = 2.5^2, |y| <= 8
    for c in mesh.positions.chunks(3) {
        let r = ((c[0] as f64).powi(2) + (c[2] as f64 - 958.0).powi(2)).sqrt();
        assert!((r - 2.5).abs() < 1e-3, "off-cylinder point {:?}", c);
        assert!((c[1] as f64).abs() <= 8.0 + 1e-3);
    }
}

// -------------------------------------------------- hierarchy + transforms

#[test]
fn assembly_hierarchy_and_instance_transform() {
    let sf = load("assembly.step");
    let asm = hierarchy::build(&sf);

    assert_eq!(asm.roots.len(), 1);
    let root = asm.roots[0];
    assert_eq!(asm.products[&root].name, "ASM");

    let kids = &asm.children[&root];
    assert_eq!(kids.len(), 1);
    assert_eq!(asm.products[&kids[0].child_pd].name, "PART_B");
    // ITEM_DEFINED_TRANSFORMATION: identity -> (100, 0, 0)
    let m = kids[0].transform.0;
    assert!((m[12] - 100.0).abs() < 1e-9, "tx = {}", m[12]);
    assert!((m[13]).abs() < 1e-9 && (m[14]).abs() < 1e-9);

    // part B owns the brep representation
    assert!(!asm.products[&kids[0].child_pd].shape_reps.is_empty());
}

#[test]
fn per_representation_length_unit_is_read_from_its_context() {
    // Some CAD systems mix units across contexts in one file: a mm context and a
    // metre context. Each SHAPE_REPRESENTATION must report its own unit, so a
    // metre-context part in an otherwise-mm file isn't scaled to nothing.
    let src = "DATA;
#1=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));
#2=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT($,.METRE.));
#3=(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.));
#10=(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNIT_ASSIGNED_CONTEXT((#1,#3))REPRESENTATION_CONTEXT('','3D'));
#11=(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNIT_ASSIGNED_CONTEXT((#2,#3))REPRESENTATION_CONTEXT('','3D'));
#20=SHAPE_REPRESENTATION('mm part',(),#10);
#21=SHAPE_REPRESENTATION('metre part',(),#11);
ENDSEC;";
    let sf = StepFile::parse(src.as_bytes().to_vec()).expect("parse");
    use step_core::model::{rep_unit_factor, representation_length_scale};
    assert_eq!(representation_length_scale(&sf, 20), Some(0.001));
    assert_eq!(representation_length_scale(&sf, 21), Some(1.0));
    // against a mm global: the mm part is unchanged, the metre part scales 1000x
    assert!((rep_unit_factor(&sf, 20, 0.001) - 1.0).abs() < 1e-9);
    assert!((rep_unit_factor(&sf, 21, 0.001) - 1000.0).abs() < 1e-6);
}

#[test]
fn ap242_ed2_triangulated_face_decodes_with_geometric_link_slot() {
    // ed2 TRIANGULATED_FACE inserts a geometric_link ($) between normals and
    // pnindex; the reader must detect the one-slot shift (off=1) and still read
    // the triangle list. Unit-square quad -> 2 triangles, area 1.
    let src = "DATA;
#1=COORDINATES_LIST('',4,((0.,0.,0.),(1.,0.,0.),(1.,1.,0.),(0.,1.,0.)));
#2=TRIANGULATED_FACE('',#1,4,(),$,(),((1,2,3),(1,3,4)));
ENDSEC;";
    let sf = StepFile::parse(src.as_bytes().to_vec()).expect("parse");
    let (set, _) = tessellate_all(&sf, &["TRIANGULATED_FACE"]);
    assert_eq!(set.merged().triangle_count(), 2);
    assert!(
        (total_area(&set.merged()) - 1.0).abs() < 1e-6,
        "area {}",
        total_area(&set.merged())
    );
}

#[test]
fn ap242_ed1_triangulated_face_set_still_decodes_without_geometric_link() {
    // the ed1 *_SET form has no geometric_link: get(4) is pnindex (off=0).
    let src = "DATA;
#1=COORDINATES_LIST('',4,((0.,0.,0.),(1.,0.,0.),(1.,1.,0.),(0.,1.,0.)));
#2=TRIANGULATED_FACE_SET('',#1,4,(),(),((1,2,3),(1,3,4)));
ENDSEC;";
    let sf = StepFile::parse(src.as_bytes().to_vec()).expect("parse");
    let (set, _) = tessellate_all(&sf, &["TRIANGULATED_FACE_SET"]);
    assert_eq!(set.merged().triangle_count(), 2);
    assert!((total_area(&set.merged()) - 1.0).abs() < 1e-6);
}

#[test]
fn ap242_complex_triangulated_face_decodes_strips_and_fans() {
    // a triangle_strip [1,2,3,4] -> 2 triangles (alternating winding, area 1)
    // and a triangle_fan [1,2,3,4] -> 2 triangles (shared first vertex, area 1):
    // 4 triangles total, total triangle area 2, exercising both decoders.
    let src = "DATA;
#1=COORDINATES_LIST('',4,((0.,0.,0.),(1.,0.,0.),(1.,1.,0.),(0.,1.,0.)));
#2=COMPLEX_TRIANGULATED_FACE('',#1,4,(),$,(),((1,2,3,4)),((1,2,3,4)));
ENDSEC;";
    let sf = StepFile::parse(src.as_bytes().to_vec()).expect("parse");
    let (set, _) = tessellate_all(&sf, &["COMPLEX_TRIANGULATED_FACE"]);
    assert_eq!(set.merged().triangle_count(), 4);
    assert!(
        (total_area(&set.merged()) - 2.0).abs() < 1e-6,
        "area {}",
        total_area(&set.merged())
    );
}

#[test]
fn geometric_curve_set_becomes_line_geometry() {
    // a GEOMETRIC_CURVE_SET of datum/reference curves must become a wireframe
    // (line-topology) bucket, not be skipped as an unsupported item.
    let src = "DATA;
#1=CARTESIAN_POINT('',(0.,0.,0.));
#2=CARTESIAN_POINT('',(10.,0.,0.));
#3=CARTESIAN_POINT('',(10.,10.,0.));
#4=POLYLINE('',(#1,#2,#3));
#5=GEOMETRIC_CURVE_SET('',(#4));
ENDSEC;";
    let sf = StepFile::parse(src.as_bytes().to_vec()).expect("parse");
    let (set, stats) = tessellate_all(&sf, &["GEOMETRIC_CURVE_SET"]);
    assert!(
        stats.unsupported_items.is_empty(),
        "handled, not flagged unsupported"
    );
    let line_parts: Vec<_> = set.parts.iter().filter(|(_, m)| m.lines).collect();
    assert_eq!(line_parts.len(), 1, "one wireframe bucket");
    let m = &line_parts[0].1;
    // a 3-point polyline -> 2 line segments -> 4 indices, and no normals
    assert_eq!(m.indices.len(), 4);
    assert!(m.normals.is_empty(), "line geometry is position-only");
    // it must not be counted as triangles
    assert_eq!(m.triangle_count(), 0);
}

#[test]
fn rectangular_trimmed_surface_resolves_to_curved_basis() {
    // a RECTANGULAR_TRIMMED_SURFACE over a cylinder must resolve to the cylinder
    // (so its face tessellates as curved geometry), NOT fall through to None and
    // get flattened to a plane.
    let src = "DATA;
#1=CARTESIAN_POINT('',(0.,0.,0.));
#2=DIRECTION('',(0.,0.,1.));
#3=DIRECTION('',(1.,0.,0.));
#4=AXIS2_PLACEMENT_3D('',#1,#2,#3);
#5=CYLINDRICAL_SURFACE('',#4,10.);
#6=RECTANGULAR_TRIMMED_SURFACE('',#5,0.,1.5707963,0.,5.,.T.,.T.);
ENDSEC;";
    let sf = StepFile::parse(src.as_bytes().to_vec()).expect("parse");
    let surf = step_core::model::surface(&sf, 6).expect("resolves to a surface");
    match surf {
        step_core::geom::Surface::Cylinder(_, r) => assert!((r - 10.0).abs() < 1e-9, "radius {r}"),
        _ => panic!("expected the basis cylinder, got a different surface kind"),
    }
}

#[test]
fn rectangular_trimmed_plane_face_is_not_flattened_as_fallback() {
    // a planar face whose face_geometry is a RECTANGULAR_TRIMMED_SURFACE over a
    // PLANE must tessellate through the real (resolved) plane, not the
    // approximated-as-plane error path.
    let src = "DATA;
#1=CARTESIAN_POINT('',(0.,0.,0.));
#2=CARTESIAN_POINT('',(10.,0.,0.));
#3=CARTESIAN_POINT('',(10.,10.,0.));
#4=CARTESIAN_POINT('',(0.,10.,0.));
#5=POLY_LOOP('',(#1,#2,#3,#4));
#6=FACE_OUTER_BOUND('',#5,.T.);
#7=DIRECTION('',(0.,0.,1.));
#8=DIRECTION('',(1.,0.,0.));
#9=AXIS2_PLACEMENT_3D('',#1,#7,#8);
#10=PLANE('',#9);
#11=RECTANGULAR_TRIMMED_SURFACE('',#10,0.,10.,0.,10.,.T.,.T.);
#12=FACE_SURFACE('',(#6),#11,.T.);
#13=CLOSED_SHELL('',(#12));
#14=MANIFOLD_SOLID_BREP('',#13);
ENDSEC;";
    let sf = StepFile::parse(src.as_bytes().to_vec()).expect("parse");
    let (set, stats) = tessellate_all(&sf, &["MANIFOLD_SOLID_BREP"]);
    assert_eq!(stats.faces_ok, 1);
    assert!(
        stats.approximated_surfaces.is_empty(),
        "resolved, not plane-approximated"
    );
    assert!(
        (total_area(&set.merged()) - 100.0).abs() < 1e-6,
        "area {}",
        total_area(&set.merged())
    );
}

#[test]
fn composite_curve_edge_is_discretized_not_chorded() {
    // A triangle whose A->B edge is a COMPOSITE_CURVE that detours through the
    // apex M=(5,5,0) (two POLYLINE segments), closed by a straight B->A edge.
    // Discretized correctly the loop is the triangle A,M,B (area 25); if the
    // composite fell back to a straight chord the loop A->B->A is degenerate
    // (zero area) and the face would be lost.
    let src = "DATA;
#1=CARTESIAN_POINT('',(0.,0.,0.));
#2=CARTESIAN_POINT('',(10.,0.,0.));
#3=CARTESIAN_POINT('',(5.,5.,0.));
#4=VERTEX_POINT('',#1);
#5=VERTEX_POINT('',#2);
#10=POLYLINE('',(#1,#3));
#11=POLYLINE('',(#3,#2));
#12=COMPOSITE_CURVE_SEGMENT(.CONTINUOUS.,.T.,#10);
#13=COMPOSITE_CURVE_SEGMENT(.DISCONTINUOUS.,.T.,#11);
#14=COMPOSITE_CURVE('',(#12,#13),.F.);
#15=EDGE_CURVE('',#4,#5,#14,.T.);
#16=DIRECTION('',(-1.,0.,0.));
#17=VECTOR('',#16,1.);
#18=LINE('',#2,#17);
#19=EDGE_CURVE('',#5,#4,#18,.T.);
#20=ORIENTED_EDGE('',*,*,#15,.T.);
#21=ORIENTED_EDGE('',*,*,#19,.T.);
#22=EDGE_LOOP('',(#20,#21));
#23=FACE_OUTER_BOUND('',#22,.T.);
#25=DIRECTION('',(0.,0.,1.));
#26=DIRECTION('',(1.,0.,0.));
#24=AXIS2_PLACEMENT_3D('',#1,#25,#26);
#27=PLANE('',#24);
#28=ADVANCED_FACE('',(#23),#27,.T.);
#29=CLOSED_SHELL('',(#28));
#30=MANIFOLD_SOLID_BREP('',#29);
ENDSEC;";
    let sf = StepFile::parse(src.as_bytes().to_vec()).expect("parse");
    let (set, stats) = tessellate_all(&sf, &["MANIFOLD_SOLID_BREP"]);
    assert_eq!(stats.faces_ok, 1);
    assert!(
        stats.unsupported_curves.get("COMPOSITE_CURVE").is_none(),
        "composite handled"
    );
    assert!(
        (total_area(&set.merged()) - 25.0).abs() < 1e-6,
        "area {}",
        total_area(&set.merged())
    );
}

#[test]
fn parabola_and_hyperbola_edges_match_their_analytic_area() {
    // PARABOLA P(u)=C+f*u^2*x+2f*u*y with f=1: the arc u in [-1,1] (from
    // (1,-2) through the vertex (0,0) to (1,2)) closed by the chord x=1 bounds
    // area integral(-2..2)(1 - y^2/4) dy = 8/3.
    let para = "DATA;
#1=CARTESIAN_POINT('',(1.,-2.,0.));
#2=CARTESIAN_POINT('',(1.,2.,0.));
#3=VERTEX_POINT('',#1);
#4=VERTEX_POINT('',#2);
#5=CARTESIAN_POINT('',(0.,0.,0.));
#6=DIRECTION('',(0.,0.,1.));
#7=DIRECTION('',(1.,0.,0.));
#8=AXIS2_PLACEMENT_3D('',#5,#6,#7);
#9=PARABOLA('',#8,1.0);
#10=EDGE_CURVE('',#3,#4,#9,.T.);
#11=DIRECTION('',(0.,-1.,0.));
#12=VECTOR('',#11,1.);
#13=LINE('',#2,#12);
#14=EDGE_CURVE('',#4,#3,#13,.T.);
#15=ORIENTED_EDGE('',*,*,#10,.T.);
#16=ORIENTED_EDGE('',*,*,#14,.T.);
#17=EDGE_LOOP('',(#15,#16));
#18=FACE_OUTER_BOUND('',#17,.T.);
#19=PLANE('',#8);
#20=ADVANCED_FACE('',(#18),#19,.T.);
#21=CLOSED_SHELL('',(#20));
#22=MANIFOLD_SOLID_BREP('',#21);
ENDSEC;";
    // a fine deflection so the inscribed-polygon area converges to the analytic
    // value — this validates the parameterization, not just that it tessellates
    let fine = TessParams {
        deflection: 0.002,
        max_angle: 5.0_f64.to_radians(),
    };
    let cols = ColorMap::new();
    let sf = StepFile::parse(para.as_bytes().to_vec()).expect("parse");
    let (set, stats) = tessellate_with(&sf, &fine, &cols, &["MANIFOLD_SOLID_BREP"]);
    assert_eq!(stats.faces_ok, 1);
    assert!(stats.unsupported_curves.get("PARABOLA").is_none());
    assert!(
        (total_area(&set.merged()) - 8.0 / 3.0).abs() < 0.01,
        "parabola area {}",
        total_area(&set.merged())
    );

    // HYPERBOLA P(u)=C+a*cosh(u)*x+b*sinh(u)*y with a=b=1: arc u in [-1,1]
    // (vertex (1,0)) closed by the chord x=cosh(1) bounds area sinh(1)*cosh(1)-1.
    let hyp = "DATA;
#1=CARTESIAN_POINT('',(1.5430806348,-1.1752011936,0.));
#2=CARTESIAN_POINT('',(1.5430806348,1.1752011936,0.));
#3=VERTEX_POINT('',#1);
#4=VERTEX_POINT('',#2);
#5=CARTESIAN_POINT('',(0.,0.,0.));
#6=DIRECTION('',(0.,0.,1.));
#7=DIRECTION('',(1.,0.,0.));
#8=AXIS2_PLACEMENT_3D('',#5,#6,#7);
#9=HYPERBOLA('',#8,1.0,1.0);
#10=EDGE_CURVE('',#3,#4,#9,.T.);
#11=DIRECTION('',(0.,-1.,0.));
#12=VECTOR('',#11,1.);
#13=LINE('',#2,#12);
#14=EDGE_CURVE('',#4,#3,#13,.T.);
#15=ORIENTED_EDGE('',*,*,#10,.T.);
#16=ORIENTED_EDGE('',*,*,#14,.T.);
#17=EDGE_LOOP('',(#15,#16));
#18=FACE_OUTER_BOUND('',#17,.T.);
#19=PLANE('',#8);
#20=ADVANCED_FACE('',(#18),#19,.T.);
#21=CLOSED_SHELL('',(#20));
#22=MANIFOLD_SOLID_BREP('',#21);
ENDSEC;";
    let sf = StepFile::parse(hyp.as_bytes().to_vec()).expect("parse");
    let (set, stats) = tessellate_with(&sf, &fine, &cols, &["MANIFOLD_SOLID_BREP"]);
    let expect = 1.0_f64.sinh() * 1.0_f64.cosh() - 1.0;
    assert_eq!(stats.faces_ok, 1);
    assert!(stats.unsupported_curves.get("HYPERBOLA").is_none());
    assert!(
        (total_area(&set.merged()) - expect).abs() < 0.01,
        "hyperbola area {} (expected {expect})",
        total_area(&set.merged())
    );
}

#[test]
fn poly_loop_face_recovers_from_an_inconsistent_declared_plane() {
    // A faceted-export quirk: a FACE_SURFACE has an explicit POLY_LOOP polygon
    // (a unit square in the XZ plane, normal +Y) but its declared PLANE has an
    // orthogonal normal (+Z). Projected onto the wrong plane the polygon
    // collapses to a zero-area line and used to fail as a "slit". The polygon is
    // authoritative, so the face must recover by re-fitting the plane to it.
    let src = "DATA;
#1=CARTESIAN_POINT('',(0.,0.,0.));
#2=CARTESIAN_POINT('',(10.,0.,0.));
#3=CARTESIAN_POINT('',(10.,0.,10.));
#4=CARTESIAN_POINT('',(0.,0.,10.));
#5=POLY_LOOP('',(#1,#2,#3,#4));
#6=FACE_OUTER_BOUND('',#5,.T.);
#10=CARTESIAN_POINT('',(0.,0.,0.));
#11=DIRECTION('',(0.,0.,1.));
#12=DIRECTION('',(1.,0.,0.));
#13=AXIS2_PLACEMENT_3D('',#10,#11,#12);
#14=PLANE('',#13);
#15=FACE_SURFACE('',(#6),#14,.T.);
#16=CLOSED_SHELL('',(#15));
#17=MANIFOLD_SOLID_BREP('',#16);
ENDSEC;";
    let sf = StepFile::parse(src.as_bytes().to_vec()).expect("parse");
    let (set, stats) = tessellate_all(&sf, &["MANIFOLD_SOLID_BREP"]);
    assert_eq!(
        stats.faces_ok, 1,
        "the planar polygon is recovered, not skipped"
    );
    assert_eq!(stats.faces_failed, 0);
    // the unit-square (10x10) area is reproduced from the polygon's own plane
    assert!(
        (total_area(&set.merged()) - 100.0).abs() < 1e-6,
        "area {}",
        total_area(&set.merged())
    );
}

#[test]
fn entity_filter_resolves_owner_and_closure() {
    // `--filter #<id>` for a geometry entity (e.g. a face from `--split`): the
    // id must resolve to the product that owns it, and its reference closure
    // must be a small self-contained fragment, not the whole file.
    let sf = load("as1_pe_203.stp");
    let asm = hierarchy::build(&sf);
    let face = *sf
        .of_type("ADVANCED_FACE")
        .first()
        .expect("the fixture has faces");

    // owning_product points at a real product whose rep reaches the face
    let (pd, rep) = hierarchy::owning_product(&sf, &asm, face).expect("face has an owning part");
    assert!(asm.products.contains_key(&pd), "owner is a known product");
    assert!(sf
        .entity_type(rep)
        .is_some_and(|t| t.contains("REPRESENTATION")));

    // the closure contains the face and pulls in its geometry (surface/edges),
    // but stays far smaller than the whole file
    let closure = hierarchy::reference_closure(&sf, &[face]);
    assert!(closure.contains(&face));
    assert!(closure.len() > 3, "closure pulls in the face's geometry");
    assert!(
        closure.len() < sf.entities.len() / 2,
        "a single face is a focused fragment, not half the model ({} of {})",
        closure.len(),
        sf.entities.len()
    );
}

#[test]
fn unsupported_curve_and_item_types_are_recorded() {
    // A planar triangle whose middle edge uses an OFFSET_CURVE_3D (a curve type
    // we do not discretize) plus a standalone SWEPT_AREA_SOLID (an item we do
    // not tessellate). Both must be tallied so the gaps surface in the console,
    // the benign AXIS2_PLACEMENT_3D datum must NOT be flagged, and the face must
    // still tessellate (the unsupported edge falls back to a straight chord).
    let src = "DATA;
#1=CARTESIAN_POINT('',(0.,0.,0.));
#2=CARTESIAN_POINT('',(10.,0.,0.));
#3=CARTESIAN_POINT('',(0.,10.,0.));
#4=VERTEX_POINT('',#1);
#5=VERTEX_POINT('',#2);
#6=VERTEX_POINT('',#3);
#7=DIRECTION('',(1.,0.,0.));
#8=VECTOR('',#7,1.);
#9=LINE('',#1,#8);
#31=OFFSET_CURVE_3D('',#9,1.0,.F.,#7);
#11=EDGE_CURVE('',#4,#5,#9,.T.);
#12=EDGE_CURVE('',#5,#6,#31,.T.);
#13=EDGE_CURVE('',#6,#4,#9,.T.);
#14=ORIENTED_EDGE('',*,*,#11,.T.);
#15=ORIENTED_EDGE('',*,*,#12,.T.);
#16=ORIENTED_EDGE('',*,*,#13,.T.);
#17=EDGE_LOOP('',(#14,#15,#16));
#18=FACE_OUTER_BOUND('',#17,.T.);
#22=AXIS2_PLACEMENT_3D('',#1,#20,#21);
#20=DIRECTION('',(0.,0.,1.));
#21=DIRECTION('',(1.,0.,0.));
#23=PLANE('',#22);
#24=ADVANCED_FACE('',(#18),#23,.T.);
#25=CLOSED_SHELL('',(#24));
#26=MANIFOLD_SOLID_BREP('',#25);
#40=SWEPT_AREA_SOLID('',#9,#7);
ENDSEC;";
    let sf = StepFile::parse(src.as_bytes().to_vec()).expect("parse");
    let (set, stats) = tessellate_all(&sf, &["MANIFOLD_SOLID_BREP", "SWEPT_AREA_SOLID"]);
    assert_eq!(stats.unsupported_curves.get("OFFSET_CURVE_3D"), Some(&1));
    assert_eq!(stats.unsupported_items.get("SWEPT_AREA_SOLID"), Some(&1));
    assert!(stats.unsupported_items.get("AXIS2_PLACEMENT_3D").is_none());
    // the face is not lost — the unsupported edge degrades to a chord
    assert_eq!(stats.faces_ok, 1);
    assert!(!set.merged().is_empty());
}

#[test]
fn split_units_enumerate_solids_shells_and_faces() {
    use step_core::tessellate::{split_units, SplitLevel};
    // a brep-with-voids (outer shell + one void shell) plus a standalone
    // shell-model with two shells, to exercise each split granularity
    let src = "DATA;
#10=ADVANCED_FACE('',(),#100,.T.);
#11=ADVANCED_FACE('',(),#100,.T.);
#12=ADVANCED_FACE('',(),#100,.T.);
#20=CLOSED_SHELL('',(#10,#11));
#21=CLOSED_SHELL('',(#12));
#22=ORIENTED_CLOSED_SHELL('',*,#21,.F.);
#30=BREP_WITH_VOIDS('',#20,(#22));
#40=OPEN_SHELL('',(#10));
#41=OPEN_SHELL('',(#11));
#50=SHELL_BASED_SURFACE_MODEL('',(#40,#41));
ENDSEC;";
    let sf = StepFile::parse(src.as_bytes().to_vec()).expect("parse");

    // solid: the brep is one unit; a shell-model's shells count individually
    assert_eq!(split_units(&sf, 30, SplitLevel::Solid), vec![30]);
    assert_eq!(split_units(&sf, 50, SplitLevel::Solid), vec![40, 41]);

    // shell: brep outer shell + resolved void shell; model shells pass through
    assert_eq!(split_units(&sf, 30, SplitLevel::Shell), vec![20, 21]);
    assert_eq!(split_units(&sf, 50, SplitLevel::Shell), vec![40, 41]);

    // face: every ADVANCED_FACE under the item (outer #10,#11 + void #12)
    assert_eq!(split_units(&sf, 30, SplitLevel::Face), vec![10, 11, 12]);
    assert_eq!(split_units(&sf, 50, SplitLevel::Face), vec![10, 11]);
}

#[test]
fn filter_roots_by_name_and_id() {
    let sf = load("assembly.step");
    let asm = hierarchy::build(&sf);

    // case-insensitive substring on the product name
    let by_name = hierarchy::filter_roots(&asm, "part_b");
    assert_eq!(by_name.len(), 1, "PART_B matches once");
    let pd = by_name[0];
    assert_eq!(asm.products[&pd].name, "PART_B");

    // explicit PRODUCT_DEFINITION id, with and without '#'
    assert_eq!(hierarchy::filter_roots(&asm, &format!("#{pd}")), vec![pd]);
    assert_eq!(hierarchy::filter_roots(&asm, &pd.to_string()), vec![pd]);

    // filtering to the assembly root yields exactly the root set
    assert_eq!(hierarchy::filter_roots(&asm, "ASM"), asm.roots);

    // no match -> empty (caller turns this into an error)
    assert!(hierarchy::filter_roots(&asm, "no-such-part").is_empty());
}

#[test]
fn filter_subtree_entities_reach_geometry() {
    let sf = load("assembly.step");
    let asm = hierarchy::build(&sf);
    let roots = hierarchy::filter_roots(&asm, "PART_B");
    assert_eq!(roots.len(), 1);

    let ids = hierarchy::subtree_entities(&sf, &asm, &roots);
    assert!(ids.contains(&roots[0]), "excerpt includes the matched PD");
    let ty =
        |pred: &dyn Fn(&str) -> bool| ids.iter().any(|&id| sf.entity_type(id).is_some_and(pred));
    assert!(
        ty(&|t| t.contains("SHAPE_REPRESENTATION")),
        "closure must reach the shape representation"
    );
    assert!(
        ty(&|t| t.contains("BREP")),
        "closure must reach the brep geometry"
    );

    // deterministic: the extraction must not depend on hash iteration order
    assert_eq!(
        ids,
        hierarchy::subtree_entities(&sf, &asm, &roots),
        "subtree_entities must be deterministic"
    );
}

#[test]
fn as1_real_world_assembly() {
    let sf = load("as1_pe_203.stp");
    let asm = hierarchy::build(&sf);

    assert_eq!(asm.roots.len(), 1);
    let root_name = &asm.products[&asm.roots[0]].name;
    assert_eq!(root_name, "AS1_PE_ASM");

    // canonical structure: plate + 2 bracket assemblies + rod assembly
    let top = &asm.children[&asm.roots[0]];
    assert_eq!(top.len(), 4);
    let names: Vec<&str> = top.iter().map(|i| i.name.as_str()).collect();
    assert!(names.contains(&"PLATE"));
    assert_eq!(
        names
            .iter()
            .filter(|n| **n == "L_BRACKET_ASSEMBLY_ASM")
            .count(),
        2
    );

    // 18 mesh-bearing leaf instances overall (plate, 2 brackets, rod,
    // 8 bolts/nuts in brackets x..., 2 rod nuts): count leaves
    fn leaves(asm: &hierarchy::Assembly, pd: u32) -> usize {
        match asm.children.get(&pd) {
            None => 1,
            Some(k) if k.is_empty() => 1,
            Some(k) => k.iter().map(|i| leaves(asm, i.child_pd)).sum(),
        }
    }
    assert_eq!(leaves(&asm, asm.roots[0]), 18);
}

#[test]
fn as1_tessellation_and_dedup() {
    let sf = load("as1_pe_203.stp");
    let asm = hierarchy::build(&sf);
    let mut stats = TessStats::default();

    // tessellate every product with shape reps; hash for dedup
    let mut hashes = std::collections::HashSet::new();
    let mut meshes = 0;
    for node in asm.products.values() {
        let tp = tp();
        let colors = ColorMap::new();
        let cx = Ctx {
            sf: &sf,
            tp: &tp,
            colors: &colors,
            threads: 1,
        };
        let mut m = MeshSet::default();
        for &sr in &node.shape_reps {
            if let Some(p) = sf.params(sr) {
                if let Some(items) = p.get(1).and_then(|v| v.as_list()) {
                    for it in items {
                        if let Some(r) = it.as_ref_id() {
                            tessellate::tessellate_item(&cx, r, None, &mut m, &mut stats);
                        }
                    }
                }
            }
        }
        if !m.is_empty() {
            m.optimize();
            meshes += 1;
            hashes.insert(m.content_hash());
            // optimization must keep valid index buffers
            let flat = m.merged();
            assert!(flat
                .indices
                .iter()
                .all(|&i| (i as usize) < flat.vertex_count()));
            assert_eq!(flat.indices.len() % 3, 0);
        }
    }
    assert_eq!(stats.faces_failed, 0, "as1 has only planes and cylinders");
    // 5 distinct parts carry geometry: plate, bracket, bolt, nut, rod
    assert_eq!(meshes, 5);
    assert_eq!(hashes.len(), 5);
}

// --------------------------------------------------------------- GLB output

#[test]
fn glb_roundtrip_of_fixture_geometry() {
    let sf = load("triangle.step");
    let (mut set, _) = tessellate_all(&sf, &["MANIFOLD_SOLID_BREP"]);
    set.optimize();

    let bytes = one_mesh_glb(set, "tri");

    // container sanity
    assert_eq!(&bytes[0..4], b"glTF");
    let total = u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize;
    assert_eq!(total, bytes.len());

    // JSON chunk parses and references the binary chunk consistently
    let jlen = u32::from_le_bytes(bytes[12..16].try_into().unwrap()) as usize;
    let json: serde_json::Value = serde_json::from_slice(&bytes[20..20 + jlen]).unwrap();
    let blen = json["buffers"][0]["byteLength"].as_u64().unwrap() as usize;
    let bin_declared = u32::from_le_bytes(bytes[20 + jlen..24 + jlen].try_into().unwrap()) as usize;
    assert_eq!(blen, bin_declared);
    for view in json["bufferViews"].as_array().unwrap() {
        let off = view["byteOffset"].as_u64().unwrap_or(0) as usize;
        let len = view["byteLength"].as_u64().unwrap() as usize;
        assert!(off + len <= blen, "bufferView overruns the BIN chunk");
    }
}

// ====================================================== new surface features

#[test]
fn bspline_patch_parses_and_trims_via_newton() {
    let sf = load("bspline_patch.step");
    // parsing: surface entity becomes a B-spline surface
    let sid = sf.of_type("B_SPLINE_SURFACE_WITH_KNOTS")[0];
    let surf = step_core::model::surface(&sf, sid).expect("parsed");
    match &surf {
        step_core::geom::Surface::BSpline(b) => {
            assert_eq!((b.deg_u, b.deg_v, b.nu, b.nv), (1, 1, 2, 2));
            assert!(surf.uses_newton());
        }
        other => panic!("expected BSpline surface, got {:?}", other),
    }
    // tessellation: triangle trim of the flat patch -> exact area 50, +z
    let (set, stats) = tessellate_all(&sf, &["SHELL_BASED_SURFACE_MODEL"]);
    assert_eq!((stats.faces_ok, stats.faces_failed), (1, 0));
    let mesh = set.merged();
    assert!(
        (total_area(&mesh) - 50.0).abs() < 0.05,
        "area {}",
        total_area(&mesh)
    );
    for n in mesh.normals.chunks(3) {
        assert!(n[2] > 0.99, "normal {:?}", n);
    }
    for c in mesh.positions.chunks(3) {
        assert!(c[2].abs() < 1e-4, "point off the patch: {:?}", c);
        assert!(c[0] >= -1e-4 && c[1] >= -1e-4 && c[0] + c[1] <= 10.0 + 1e-3);
    }
}

#[test]
fn extrusion_surface_face() {
    let sf = load("extrusion_face.step");
    let sid = sf.of_type("SURFACE_OF_LINEAR_EXTRUSION")[0];
    let surf = step_core::model::surface(&sf, sid).expect("parsed");
    assert!(
        matches!(surf, step_core::geom::Surface::Extrusion { .. }),
        "B-spline directrix must stay a general extrusion, got {:?}",
        surf
    );
    // zigzag length 20 extruded by 5 -> exact area 100
    let (set, stats) = tessellate_all(&sf, &["SHELL_BASED_SURFACE_MODEL"]);
    assert_eq!((stats.faces_ok, stats.faces_failed), (1, 0));
    let mesh = set.merged();
    assert!(
        (total_area(&mesh) - 100.0).abs() < 0.2,
        "area {}",
        total_area(&mesh)
    );
    // all points on the two wall planes y=0 (x in 0..10) or x=10 (y in 0..10)
    for c in mesh.positions.chunks(3) {
        let on_wall1 = c[1].abs() < 1e-3;
        let on_wall2 = (c[0] - 10.0).abs() < 1e-3;
        assert!(on_wall1 || on_wall2, "off the extrusion: {:?}", c);
        assert!((-1e-3..=5.0 + 1e-3).contains(&c[2]));
    }
}

#[test]
fn revolution_reduces_to_cylinder_and_band_tessellates() {
    let sf = load("revolution_cylinder.step");
    let sid = sf.of_type("SURFACE_OF_REVOLUTION")[0];
    let surf = step_core::model::surface(&sf, sid).expect("parsed");
    match &surf {
        step_core::geom::Surface::Cylinder(_, r) => assert!((r - 5.0).abs() < 1e-9),
        other => panic!(
            "line parallel to axis must reduce to a cylinder, got {:?}",
            other
        ),
    }
    assert!(!surf.uses_newton());
    let (set, stats) = tessellate_all(&sf, &["SHELL_BASED_SURFACE_MODEL"]);
    assert_eq!((stats.faces_ok, stats.faces_failed), (1, 0));
    let mesh = set.merged();
    let expect = std::f64::consts::TAU * 5.0 * 10.0;
    let area = total_area(&mesh);
    assert!(
        (area - expect).abs() / expect < 0.01,
        "area {} vs {}",
        area,
        expect
    );
    for c in mesh.positions.chunks(3) {
        let r = ((c[0] as f64).powi(2) + (c[1] as f64).powi(2)).sqrt();
        assert!((r - 5.0).abs() < 1e-6);
    }
}

#[test]
fn sphere_cap_face_closes_at_the_pole() {
    let sf = load("sphere_cap.step");
    let (set, stats) = tessellate_all(&sf, &["SHELL_BASED_SURFACE_MODEL"]);
    assert_eq!(
        (stats.faces_ok, stats.faces_failed),
        (1, 0),
        "single-circle spherical cap must tessellate"
    );
    let mesh = set.merged();
    // spherical cap area = 2*pi*r*h with r=5, h=5-3=2
    let expect = std::f64::consts::TAU * 5.0 * 2.0;
    let area = total_area(&mesh);
    assert!(
        (area - expect).abs() / expect < 0.015,
        "cap area {} vs {}",
        area,
        expect
    );
    let mut zmax = f64::MIN;
    for c in mesh.positions.chunks(3) {
        let r = ((c[0] as f64).powi(2) + (c[1] as f64).powi(2) + (c[2] as f64).powi(2)).sqrt();
        assert!((r - 5.0).abs() < 1e-5, "off the sphere: {:?}", c);
        assert!(c[2] as f64 >= 3.0 - 1e-5, "below the cap boundary: {:?}", c);
        zmax = zmax.max(c[2] as f64);
    }
    assert!(zmax > 5.0 - 1e-6, "the pole itself must be part of the cap");
}

// ===================================== parameterization singularities on rim

#[test]
fn half_cone_with_apex_on_boundary() {
    // a 180° cone face whose boundary passes through the apex (screw tips,
    // countersinks split in half): u is undefined at the apex, the
    // tessellator must follow both meridians instead of cutting across
    let sf = load("half_cone_apex.step");
    let (set, stats) = tessellate_all(&sf, &["SHELL_BASED_SURFACE_MODEL"]);
    assert_eq!((stats.faces_ok, stats.faces_failed), (1, 0));
    let mesh = set.merged();
    // half lateral cone area = pi * r * slant / 2, r = 5, slant = 5*sqrt(2)
    let expect = std::f64::consts::PI * 5.0 * (50.0_f64).sqrt() / 2.0;
    let area = total_area(&mesh);
    assert!(
        (area - expect).abs() / expect < 0.01,
        "area {} vs {}",
        area,
        expect
    );
    // every point on the cone: radius == -z for z in [-5, 0]
    for c in mesh.positions.chunks(3) {
        let r = ((c[0] as f64).powi(2) + (c[1] as f64).powi(2)).sqrt();
        assert!((r - (c[2] as f64 + 5.0)).abs() < 1e-4, "off cone: {:?}", c);
        assert!(c[1] >= -1e-4, "wrong half: {:?}", c);
    }
}

#[test]
fn cone_frustum_beyond_the_apex_tessellates() {
    // a conical frustum band whose rims sit PAST the apex (signed radius
    // r + v·tan(a) negative, the far nappe): a valid CONICAL_SURFACE face the
    // cone uv inverse must map correctly — not reject as "boundary off surface"
    let sf = load("cone_frustum_past_apex.step");
    let (set, stats) = tessellate_all(&sf, &["SHELL_BASED_SURFACE_MODEL"]);
    assert_eq!((stats.faces_ok, stats.faces_failed), (1, 0));
    let mesh = set.merged();
    // frustum lateral area = pi*(r1+r2)*slant, r1=3.2 r2=4.0, slant=0.8*sqrt(2)
    let expect = std::f64::consts::PI * (3.2 + 4.0) * 0.8 * (2.0_f64).sqrt();
    let area = total_area(&mesh);
    assert!(
        (area - expect).abs() / expect < 0.02,
        "area {area} vs {expect}"
    );
    // every vertex on the cone: radial distance from the axis (line y=15.3,
    // z=278 along X) equals |3.6 + v|, with v = -(x + 35.2)
    for c in mesh.positions.chunks(3) {
        let (x, y, z) = (c[0] as f64, c[1] as f64, c[2] as f64);
        let radial = ((y - 15.3).powi(2) + (z - 278.0).powi(2)).sqrt();
        let v = -(x + 35.2);
        assert!((radial - (3.6 + v).abs()).abs() < 1e-3, "off cone: {c:?}");
    }
}

#[test]
fn hemisphere_bounded_through_both_poles() {
    // half sphere whose boundary great circle passes through both poles
    // (dome split in two): both pole singularities sit on the boundary
    let sf = load("hemisphere_poles.step");
    let (set, stats) = tessellate_all(&sf, &["SHELL_BASED_SURFACE_MODEL"]);
    assert_eq!((stats.faces_ok, stats.faces_failed), (1, 0));
    let mesh = set.merged();
    let expect = 2.0 * std::f64::consts::PI * 25.0;
    let area = total_area(&mesh);
    assert!(
        (area - expect).abs() / expect < 0.02,
        "area {} vs {}",
        area,
        expect
    );
    for c in mesh.positions.chunks(3) {
        let r = ((c[0] as f64).powi(2) + (c[1] as f64).powi(2) + (c[2] as f64).powi(2)).sqrt();
        assert!((r - 5.0).abs() < 1e-4, "off sphere: {:?}", c);
        assert!(c[0] >= -1e-3, "wrong hemisphere: {:?}", c);
    }
}

#[test]
fn full_sphere_with_slit_boundary() {
    // a full sphere written as one face whose boundary is a single meridian
    // edge walked forward and back (a seam slit enclosing no area)
    let sf = load("sphere_slit.step");
    let (set, stats) = tessellate_all(&sf, &["SHELL_BASED_SURFACE_MODEL"]);
    assert_eq!((stats.faces_ok, stats.faces_failed), (1, 0));
    let mesh = set.merged();
    let r = 0.689462533607661_f64;
    let expect = 4.0 * std::f64::consts::PI * r * r;
    let area = total_area(&mesh);
    assert!(
        (area - expect).abs() / expect < 0.03,
        "area {} vs {}",
        area,
        expect
    );
    // every point on the sphere (center (0, 2.5, 0))
    for c in mesh.positions.chunks(3) {
        let d =
            ((c[0] as f64).powi(2) + (c[1] as f64 - 2.5).powi(2) + (c[2] as f64).powi(2)).sqrt();
        assert!((d - r).abs() < 1e-4, "off sphere: {:?}", c);
    }
}

#[test]
fn cone_face_bounded_by_complex_rational_bspline_curve() {
    // a cone sliver bounded by a circle arc and a rational B-spline conic in
    // the complex-instance form (degree + control points in the
    // B_SPLINE_CURVE leaf, knots in B_SPLINE_CURVE_WITH_KNOTS)
    let sf = load("cone_complex_curve.step");
    let (set, stats) = tessellate_all(&sf, &["SHELL_BASED_SURFACE_MODEL"]);
    assert_eq!((stats.faces_ok, stats.faces_failed), (1, 0));
    let mesh = set.merged();
    assert!(!mesh.is_empty());
    // every point on the cone: radius == z + 1.1547 (45° half-angle,
    // r = 1.1547 at z = 0), z in [apex region, 0]
    for c in mesh.positions.chunks(3) {
        let r = ((c[0] as f64).powi(2) + (c[1] as f64).powi(2)).sqrt();
        assert!(
            (r - (c[2] as f64 + 1.15470053837925)).abs() < 1e-3,
            "off cone: {:?}",
            c
        );
        assert!((-1.16..=1e-3).contains(&(c[2] as f64)), "z range: {:?}", c);
    }
}

// ============================================================ parallelism

#[test]
fn parallel_tessellation_is_byte_identical_to_serial() {
    let sf = load("as1_pe_203.stp");
    let tp = tp();
    let colors = styles::build_color_map(&sf);
    let run = |threads: usize| {
        let cx = Ctx {
            sf: &sf,
            tp: &tp,
            colors: &colors,
            threads,
        };
        let mut set = MeshSet::default();
        let mut stats = TessStats::default();
        for &id in sf.of_type("MANIFOLD_SOLID_BREP") {
            tessellate::tessellate_item(&cx, id, None, &mut set, &mut stats);
        }
        (set.content_hash(), stats.faces_ok, stats.faces_failed)
    };
    let serial = run(1);
    assert_eq!(serial, run(4), "4 threads must match serial output");
    assert_eq!(serial, run(2), "2 threads must match serial output");
    assert!(serial.1 > 0);
}

// ======================================================= styles / materials

#[test]
fn styled_item_colors_reach_mesh_buckets_and_glb_materials() {
    let sf = load("colored.step");
    let colors = styles::build_color_map(&sf);
    assert_eq!(
        colors.get(&23),
        Some(&[1.0, 0.0, 0.0, 1.0]),
        "solid #23 is red"
    );

    let tp = tp();
    let (mut set, stats) = tessellate_with(&sf, &tp, &colors, &["MANIFOLD_SOLID_BREP"]);
    assert_eq!(stats.faces_failed, 0);
    set.optimize();
    assert_eq!(set.parts.len(), 1);
    assert_eq!(set.parts[0].0, Some([1.0, 0.0, 0.0, 1.0]));

    let bytes = one_mesh_glb(set, "red");
    let jlen = u32::from_le_bytes(bytes[12..16].try_into().unwrap()) as usize;
    let json: serde_json::Value = serde_json::from_slice(&bytes[20..20 + jlen]).unwrap();
    let mat = json["meshes"][0]["primitives"][0]["material"]
        .as_u64()
        .unwrap();
    let base = &json["materials"][mat as usize]["pbrMetallicRoughness"]["baseColorFactor"];
    assert_eq!(base[0], 1.0);
    assert_eq!(base[1], 0.0);
}

// ==================================================== merged (rvm-style) GLB

fn glb_json(bytes: &[u8]) -> serde_json::Value {
    assert_eq!(&bytes[0..4], b"glTF");
    let jlen = u32::from_le_bytes(bytes[12..16].try_into().unwrap()) as usize;
    serde_json::from_slice(&bytes[20..20 + jlen]).expect("valid GLB JSON")
}

/// Build a one-mesh, single-root hierarchical GLB and return its bytes. The
/// streaming builder spills geometry into the temp handle as `add_mesh` runs,
/// so a `MemTemp` is threaded through and `finish` reads it back.
fn one_mesh_glb(set: MeshSet, name: &str) -> Vec<u8> {
    use step_core::io::{MemSink, MemTemp};
    let mut tmp = MemTemp::default();
    let mut out = MemSink::default();
    let mut b = glb::GlbBuilder::default();
    let mi = b.add_mesh(set, name.into(), &mut tmp);
    let n = b.add_node("root".into(), None, Some(mi));
    b.root_nodes = vec![n];
    b.finish("test", &mut out, &mut tmp)
        .expect("in-memory GLB write is infallible");
    out.0
}

fn build_merged_with(
    name: &str,
    cleanup: Option<merge::Cleanup>,
) -> (serde_json::Value, hierarchy::Assembly) {
    let sf = load(name);
    let asm = hierarchy::build(&sf);
    let tp = tp();
    let colors = styles::build_color_map(&sf);
    let cx = Ctx {
        sf: &sf,
        tp: &tp,
        colors: &colors,
        threads: 1,
    };
    let mut stats = TessStats::default();
    let opts = merge::MergeOptions {
        unit_scale: 1.0,
        file_unit_scale: 1.0,
        rotate_z_up: true,
        optimize: true,
        drop_normals: false,
        cleanup,
        simplify: None,
    };
    let (merged, _unique) = merge::build(&cx, &asm, opts, &mut stats, &mut |_| {});
    assert!(merged.bucket_count() > 0);
    (glb_json(&merged.write("test")), asm)
}

fn build_merged(name: &str) -> (serde_json::Value, hierarchy::Assembly) {
    build_merged_with(name, None)
}

#[test]
fn merged_as1_draw_ranges_tile_the_index_buffer() {
    let (json, asm) = build_merged("as1_pe_203.stp");

    // one node + mesh + material per color bucket, nodes flat under the
    // scene with no transform (world space is baked in)
    let nodes = json["nodes"].as_array().unwrap();
    let n_colors = nodes.len();
    assert_eq!(json["meshes"].as_array().unwrap().len(), n_colors);
    assert_eq!(json["materials"].as_array().unwrap().len(), n_colors);
    for (i, n) in nodes.iter().enumerate() {
        assert_eq!(n["name"], format!("node{}", i));
        assert_eq!(n["mesh"], i);
        assert!(n.get("matrix").is_none());
        assert_eq!(json["scenes"][0]["nodes"][i], i);
    }

    // per color mesh: ranges are disjoint, 3-aligned and tile the index
    // accessor exactly; across all meshes the 18 geometry-bearing leaf
    // instances each own at least one range
    let extras = &json["scenes"][0]["extras"];
    let mut all_ids = std::collections::HashSet::new();
    for i in 0..n_colors {
        let ranges = extras[&format!("draw_ranges_node{}", i)]
            .as_object()
            .unwrap();
        assert!(!ranges.is_empty());
        all_ids.extend(ranges.keys().cloned());
        let idx_acc = json["meshes"][i]["primitives"][0]["indices"]
            .as_u64()
            .unwrap() as usize;
        let total = json["accessors"][idx_acc]["count"].as_u64().unwrap();
        let mut spans: Vec<(u64, u64)> = ranges
            .values()
            .map(|v| (v[0].as_u64().unwrap(), v[1].as_u64().unwrap()))
            .collect();
        spans.sort_unstable();
        let mut at = 0u64;
        for (start, count) in spans {
            assert_eq!(start, at, "ranges must be contiguous");
            assert!(count > 0 && count % 3 == 0);
            at = start + count;
        }
        assert_eq!(at, total, "ranges must cover the whole index buffer");
    }
    assert_eq!(all_ids.len(), 18);

    // id_hierarchy holds every expanded instance (groups included)
    fn count_instances(asm: &hierarchy::Assembly, pd: u32) -> usize {
        1 + asm
            .children
            .get(&pd)
            .map(|k| k.iter().map(|i| count_instances(asm, i.child_pd)).sum())
            .unwrap_or(0)
    }
    let expected: usize = asm.roots.iter().map(|&r| count_instances(&asm, r)).sum();
    let idh = extras["id_hierarchy"].as_object().unwrap();
    assert_eq!(idh.len(), expected);

    // the root entry is the assembly, parent "*"; every range id and every
    // parent id resolves within id_hierarchy
    let roots: Vec<&str> = idh
        .values()
        .filter(|v| v[1] == "*")
        .map(|v| v[0].as_str().unwrap())
        .collect();
    assert_eq!(roots, ["AS1_PE_ASM"]);
    for id in &all_ids {
        assert!(
            idh.contains_key(id),
            "draw range id {} not in hierarchy",
            id
        );
    }
    for v in idh.values() {
        let p = v[1].as_str().unwrap();
        assert!(p == "*" || idh.contains_key(p), "dangling parent {}", p);
    }

    assert_eq!(json["asset"]["extras"]["web3dversion"], 2);
}

#[test]
fn merged_colored_part_gets_red_material_bucket() {
    let (json, _) = build_merged("colored.step");
    assert_eq!(json["meshes"].as_array().unwrap().len(), 1);
    let base = &json["materials"][0]["pbrMetallicRoughness"]["baseColorFactor"];
    assert_eq!(base[0], 1.0);
    assert_eq!(base[1], 0.0);
    // no product structure -> single fallback part "geometry" with id 1
    let extras = &json["scenes"][0]["extras"];
    assert!(extras["draw_ranges_node0"]["1"].is_array());
    assert_eq!(extras["id_hierarchy"]["1"][0], "geometry");
    assert_eq!(extras["id_hierarchy"]["1"][1], "*");
}

#[test]
fn merged_output_is_y_up() {
    // cylinder along +z (r=5, z in 0..10) must come out along +y
    let (json, _) = build_merged("cylinder_band.step");
    let pos_acc = json["meshes"][0]["primitives"][0]["attributes"]["POSITION"]
        .as_u64()
        .unwrap() as usize;
    let acc = &json["accessors"][pos_acc];
    // recentring puts the scene's bbox centre on the node translation —
    // compose it back so the assertions stay in world coordinates
    let t = |i: usize| json["nodes"][0]["translation"][i].as_f64().unwrap_or(0.0);
    let g = |k: &str, i: usize| acc[k][i].as_f64().unwrap() + t(i);
    // chord vertices lie on the cylinder but not exactly at angle pi, so the
    // radial extents carry the chordal sag; the axial extent (now y) is exact
    assert!((g("min", 0) - -5.0).abs() < 0.1 && (g("max", 0) - 5.0).abs() < 0.1);
    assert!((g("min", 1) - 0.0).abs() < 1e-3 && (g("max", 1) - 10.0).abs() < 1e-3);
    assert!((g("min", 2) - -5.0).abs() < 0.1 && (g("max", 2) - 5.0).abs() < 0.1);
}

#[test]
fn merged_without_rotation_keeps_z_up() {
    // --up-axis y: the cylinder must stay along +z
    let sf = load("cylinder_band.step");
    let asm = hierarchy::build(&sf);
    let tp = tp();
    let colors = styles::build_color_map(&sf);
    let cx = Ctx {
        sf: &sf,
        tp: &tp,
        colors: &colors,
        threads: 1,
    };
    let mut stats = TessStats::default();
    let opts = merge::MergeOptions {
        unit_scale: 1.0,
        file_unit_scale: 1.0,
        rotate_z_up: false,
        optimize: true,
        drop_normals: false,
        cleanup: None,
        simplify: None,
    };
    let (merged, _) = merge::build(&cx, &asm, opts, &mut stats, &mut |_| {});
    let json = glb_json(&merged.write("test"));
    let pos_acc = json["meshes"][0]["primitives"][0]["attributes"]["POSITION"]
        .as_u64()
        .unwrap() as usize;
    let acc = &json["accessors"][pos_acc];
    let t = |i: usize| json["nodes"][0]["translation"][i].as_f64().unwrap_or(0.0);
    let g = |k: &str, i: usize| acc[k][i].as_f64().unwrap() + t(i);
    assert!((g("min", 2) - 0.0).abs() < 1e-3 && (g("max", 2) - 10.0).abs() < 1e-3);
}

#[test]
fn merged_cleanup_position_drops_normals_and_keeps_valid_ranges() {
    let cleanup = merge::Cleanup {
        precision: 3,
        threshold: 0.75,
        target_error: 0.0,
    };
    let (json, _) = build_merged_with("as1_pe_203.stp", Some(cleanup));
    let (plain, _) = build_merged("as1_pe_203.stp");

    // positions-only output, exactly like rvm_parser_glb with
    // --cleanup-position on: no NORMAL attribute anywhere
    let extras = &json["scenes"][0]["extras"];
    let meshes = json["meshes"].as_array().unwrap();
    for (i, m) in meshes.iter().enumerate() {
        let attrs = m["primitives"][0]["attributes"].as_object().unwrap();
        assert!(attrs.contains_key("POSITION"));
        assert!(!attrs.contains_key("NORMAL"), "mesh {} kept normals", i);

        // ranges still tile the (simplified) index buffer exactly
        let idx_acc = m["primitives"][0]["indices"].as_u64().unwrap() as usize;
        let total = json["accessors"][idx_acc]["count"].as_u64().unwrap();
        let mut spans: Vec<(u64, u64)> = extras[&format!("draw_ranges_node{}", i)]
            .as_object()
            .unwrap()
            .values()
            .map(|v| (v[0].as_u64().unwrap(), v[1].as_u64().unwrap()))
            .collect();
        spans.sort_unstable();
        let mut at = 0u64;
        for (start, count) in spans {
            assert_eq!(start, at);
            assert!(count > 0 && count % 3 == 0);
            at = start + count;
        }
        assert_eq!(at, total);
    }

    // the simplify + weld pass must not grow the output
    let count = |j: &serde_json::Value, ty: &str| -> u64 {
        j["accessors"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|a| a["type"] == ty)
            .map(|a| a["count"].as_u64().unwrap())
            .sum()
    };
    assert!(count(&json, "SCALAR") <= count(&plain, "SCALAR"));
    assert!(count(&json, "VEC3") < count(&plain, "VEC3"));
}

#[test]
fn hierarchical_cleanup_writes_position_only_glb() {
    // --cleanup-position without --merged: weld + simplify per unique mesh,
    // normals dropped, classic node hierarchy kept
    let sf = load("colored.step");
    let (mut set, _) = tessellate_all(&sf, &["MANIFOLD_SOLID_BREP"]);
    set.optimize();
    set.cleanup_positions(3, 0.75, 0.0);

    let json = glb_json(&one_mesh_glb(set, "part"));

    let attrs = json["meshes"][0]["primitives"][0]["attributes"]
        .as_object()
        .unwrap();
    assert!(attrs.contains_key("POSITION"));
    assert!(!attrs.contains_key("NORMAL"));
    // still the hierarchical layout: named nodes, no scene draw-range extras
    assert_eq!(json["nodes"][0]["name"], "root");
    assert!(json["scenes"][0].get("extras").is_none());
    // index buffer stays valid
    let idx_acc = json["meshes"][0]["primitives"][0]["indices"]
        .as_u64()
        .unwrap() as usize;
    assert_eq!(json["accessors"][idx_acc]["count"].as_u64().unwrap() % 3, 0);
}

#[test]
fn rational_complex_form_bspline_surface_parses() {
    // uniform weights = same geometry as the unweighted bilinear patch
    let src = "DATA;
#1=CARTESIAN_POINT('',(0.,0.,0.));
#2=CARTESIAN_POINT('',(0.,10.,0.));
#3=CARTESIAN_POINT('',(10.,0.,0.));
#4=CARTESIAN_POINT('',(10.,10.,0.));
#5=(B_SPLINE_SURFACE(1,1,((#1,#2),(#3,#4)),.UNSPECIFIED.,.F.,.F.,.F.)
B_SPLINE_SURFACE_WITH_KNOTS((2,2),(2,2),(0.,1.),(0.,1.),.UNSPECIFIED.)
BOUNDED_SURFACE()GEOMETRIC_REPRESENTATION_ITEM()
RATIONAL_B_SPLINE_SURFACE(((2.,2.),(2.,2.)))REPRESENTATION_ITEM('')SURFACE());
ENDSEC;";
    let sf = StepFile::parse(src.as_bytes().to_vec()).unwrap();
    let surf = step_core::model::surface(&sf, 5).expect("complex rational surface parses");
    match &surf {
        step_core::geom::Surface::BSpline(b) => {
            assert!(b.weights.is_some());
            let p = b.point(0.3, 0.7);
            assert!((p.x - 3.0).abs() < 1e-9 && (p.y - 7.0).abs() < 1e-9);
        }
        other => panic!("expected BSpline, got {:?}", other),
    }
}

// ===================================================== geometry coverage audit

#[test]
fn coverage_reaches_every_face_in_a_well_formed_assembly() {
    // a clean AP203 assembly: every B-rep face must be reachable from a product,
    // and (here) every reached face also tessellates — so reached == file == ok.
    let sf = load("as1_pe_203.stp");
    let asm = hierarchy::build(&sf);
    let cov = tessellate::geometry_coverage(&sf, &asm);
    assert!(cov.file_faces >= 53, "fixture carries B-rep faces");
    assert!(
        cov.unreached.is_empty(),
        "every face should be reachable from a product; unreached: {:?}",
        cov.unreached
    );
    assert_eq!(cov.reached_faces, cov.file_faces);
}

#[test]
fn coverage_flags_faces_no_product_reaches() {
    // sever every product's shape-representation link: now no product references
    // any geometry, so every face is unreachable — the silent-miss case the
    // audit exists to surface. (Reached-but-unmeshable faces are a different
    // bucket, tracked in TessStats, not here.)
    let sf = load("as1_pe_203.stp");
    let mut asm = hierarchy::build(&sf);
    for node in asm.products.values_mut() {
        node.shape_reps.clear();
    }
    let cov = tessellate::geometry_coverage(&sf, &asm);
    assert!(cov.file_faces > 0);
    assert_eq!(cov.reached_faces, 0, "no product reaches anything now");
    assert_eq!(
        cov.unreached.len(),
        cov.file_faces,
        "all faces flagged as unreached"
    );
}

// ============================================ winding faces through polar caps

/// Sum of triangle areas of a mesh (3D), for coverage/area sanity checks.
fn tri_area(m: &TriMesh) -> f64 {
    let p = |i: u32| {
        let i = i as usize * 3;
        v3(
            m.positions[i] as f64,
            m.positions[i + 1] as f64,
            m.positions[i + 2] as f64,
        )
    };
    m.indices
        .chunks(3)
        .filter(|t| t.len() == 3)
        .map(|t| 0.5 * p(t[1]).sub(p(t[0])).cross(p(t[2]).sub(p(t[0]))).len())
        .sum()
}

#[test]
fn sphere_lune_winding_through_both_poles_tessellates() {
    // A half-sphere "lune" bounded by a meridian great circle (which passes
    // through BOTH poles, verified n·axis ≈ 0) plus two latitude arcs. The
    // boundary genuinely winds once around the polar axis, so the band path —
    // which models a winding curve as an iso-v latitude band — can't pair it;
    // the winding fallback closes it against the polar cap (a singular point, so
    // the fan adds no spurious area). Regression guard: it must tessellate to
    // ~half the sphere (r=8 → full area 804), not be skipped or blow up.
    let sf = load("sphere_lune_through_poles.step");
    let (set, stats) = tessellate_all(&sf, &["ADVANCED_FACE"]);
    assert_eq!(stats.faces_failed, 0, "the lune must not be skipped");
    assert!(stats.faces_ok >= 1, "the lune face tessellates");
    let m = set.merged();
    assert!(!m.is_empty(), "non-empty mesh");
    // half the sphere minus the small bulge bite ≈ 45% of 804 (observed ~360);
    // a wide band guards the fix without pinning the exact tessellation.
    let area = tri_area(&m);
    assert!(
        (300.0..430.0).contains(&area),
        "lune area {area} should be ~half the sphere (402)"
    );
}

#[test]
fn cone_winding_loop_closes_to_apex() {
    // A conical face bounded by a single loop that winds once around the axis
    // (a near-full circle with a small notch). On a cone only the tip side —
    // toward the apex — is finite, so the winding fallback must close the loop
    // against the apex cap (a point), producing a cone tip; the band path can't
    // pair a single winding curve with no second rim. Regression guard: it must
    // tessellate (not skip) to a sane cone-tip area, not blow up or over-cover.
    let sf = load("cone_winding_to_apex.step");
    let (set, stats) = tessellate_all(&sf, &["ADVANCED_FACE"]);
    assert_eq!(stats.faces_failed, 0, "the cone tip must not be skipped");
    assert!(stats.faces_ok >= 1, "the cone face tessellates");
    let m = set.merged();
    assert!(!m.is_empty(), "non-empty mesh");
    // R≈10.94 at the loop, slant to apex ≈ 15.5 → lateral area ≈ 530, minus the
    // notch (observed ~486); a wide band guards the fix without over-pinning.
    let area = tri_area(&m);
    assert!(
        (380.0..620.0).contains(&area),
        "cone-tip area {area} should be ~500 (π·R·slant to the apex)"
    );
}

// ====================================================== plane-angle unit (deg)

#[test]
fn cone_semi_angle_honours_a_degree_plane_angle_unit() {
    // Some exporters declare plane angles in DEGREES via a CONVERSION_BASED_UNIT.
    // A CONICAL_SURFACE's semi_angle is then in degrees; read as radians, a 45°
    // cone (0.785 rad) becomes 45 rad — tan(45 rad) ≈ 1.6, a near-flat cone that
    // tessellates as a giant disk. file_plane_angle_scale must convert it.
    let step = concat!(
        "ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n",
        "#1=(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.));\n",
        "#2=PLANE_ANGLE_MEASURE_WITH_UNIT(PLANE_ANGLE_MEASURE(0.0174533),#1);\n",
        "#3=DIMENSIONAL_EXPONENTS(0.,0.,0.,0.,0.,0.,0.);\n",
        "#4=(CONVERSION_BASED_UNIT('DEGREE',#2)NAMED_UNIT(#3)PLANE_ANGLE_UNIT());\n",
        "#5=(NAMED_UNIT(*)LENGTH_UNIT()SI_UNIT(.MILLI.,.METRE.));\n",
        "#6=(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNIT_ASSIGNED_CONTEXT((#4,#5))REPRESENTATION_CONTEXT('',''));\n",
        "#10=CARTESIAN_POINT('',(0.,0.,0.));\n",
        "#11=DIRECTION('',(0.,0.,1.));\n",
        "#12=DIRECTION('',(1.,0.,0.));\n",
        "#13=AXIS2_PLACEMENT_3D('',#10,#11,#12);\n",
        "#14=CONICAL_SURFACE('',#13,10.,45.);\n",
        "ENDSEC;\nEND-ISO-10303-21;\n",
    );
    let sf = StepFile::parse(step.as_bytes().to_vec()).expect("parse");
    assert!(
        (step_core::model::file_plane_angle_scale(&sf) - std::f64::consts::PI / 180.0).abs() < 1e-9,
        "a DEGREE context is π/180 rad per unit, got {}",
        step_core::model::file_plane_angle_scale(&sf)
    );
    match step_core::model::surface(&sf, 14).expect("cone surface") {
        step_core::geom::Surface::Cone(_, r, a) => {
            assert!((r - 10.0).abs() < 1e-9, "radius unchanged");
            assert!(
                (a - std::f64::consts::FRAC_PI_4).abs() < 1e-6,
                "45° must convert to π/4 rad, got {a}"
            );
        }
        _ => panic!("expected a cone surface"),
    }
}

#[test]
fn face_with_off_surface_boundary_is_rejected() {
    // A malformed export: a radius-3.5 CYLINDRICAL_SURFACE face whose loop
    // carries an edge (a circle, r≈3.85) centred ~1400 units away — the
    // boundary doesn't lie on the surface. Projecting it onto the cylinder maps
    // the stray edge to a wild parameter (~1000× the radius) and explodes the
    // face into a spike. The quadric on-surface guard must reject it (skip),
    // not emit the spike.
    let sf = load("malformed_offsurface_boundary.step");
    let (set, stats) = tessellate_all(&sf, &["ADVANCED_FACE"]);
    assert!(
        set.merged().is_empty(),
        "malformed face must produce no geometry"
    );
    assert_eq!(
        stats.faces_ok, 0,
        "the off-surface face must not tessellate"
    );
}

#[test]
fn cylinder_winding_band_closes_to_v_extreme() {
    // A cylindrical face whose loop winds once around (a full-circle rim) plus
    // axial lines and a partial arc — a near-full tube with a small notch. A
    // cylinder has no cap, but v (axial) is open, so the loop's own v-extent
    // bounds the face: the winding fallback closes the rim against its far
    // v-extreme. Regression guard: it tessellates (not skips) to ~the tube's
    // lateral area (R≈0.5, length≈16 → ~50, +notch; observed ~58), not a spike.
    let sf = load("cylinder_winding_notch.step");
    let (set, stats) = tessellate_all(&sf, &["ADVANCED_FACE"]);
    assert_eq!(stats.faces_failed, 0, "the tube face must not be skipped");
    assert!(stats.faces_ok >= 1, "the cylinder face tessellates");
    let area = tri_area(&set.merged());
    assert!(
        (35.0..80.0).contains(&area),
        "tube area {area} should be ~the cylinder's lateral area (~58)"
    );
}

#[test]
fn torus_winding_band_closes_to_v_extreme() {
    // A toroidal face whose loop winds once around the major axis while the tube
    // angle stays within one period (v doesn't wrap) — a thin ring/washer-edge
    // band. v is periodic, but the bounded tube-angle extent means the loop's
    // own v-extreme still bounds it (like a cylinder). Regression guard: it
    // meshes to ~the ring's area (2π·R·minor-arc; observed ~61), not skipped.
    let sf = load("torus_winding_ring.step");
    let (set, stats) = tessellate_all(&sf, &["ADVANCED_FACE"]);
    assert_eq!(stats.faces_failed, 0, "the ring face must not be skipped");
    assert!(stats.faces_ok >= 1, "the torus face tessellates");
    let area = tri_area(&set.merged());
    assert!(
        (40.0..90.0).contains(&area),
        "ring area {area} should be ~the torus band (~61)"
    );
}

#[test]
fn zero_area_slit_plane_is_degenerate_not_failed() {
    // A planar face whose loop is two out-and-back slit "spokes" from one vertex
    // (two coincident edges between the same pair, plus an edge used forward and
    // reversed) encloses no area. It carries zero surface, so it must be
    // classified degenerate and skipped quietly — not flagged a tessellation
    // failure (which would wrongly imply a converter bug worth chasing).
    let sf = load("degenerate_plane_slit.step");
    let (set, stats) = tessellate_all(&sf, &["ADVANCED_FACE"]);
    assert!(
        set.merged().is_empty(),
        "zero-area face produces no geometry"
    );
    assert_eq!(stats.faces_failed, 0, "degenerate, not a failure");
    assert!(
        stats.degenerate_faces >= 1,
        "the slit face is counted degenerate"
    );
}

// ------------------------------------------------------- swept-area solids

#[test]
fn extruded_area_solid_makes_a_closed_cylinder() {
    // circle profile r=5 on z=0 extruded +z by 10: caps 2·π·25, wall 2π·5·10
    let sf = load("extruded_area_solid.step");
    let (set, stats) = tessellate_all(&sf, &["EXTRUDED_AREA_SOLID"]);
    assert_eq!(stats.faces_ok, 1, "extrusion should tessellate");
    assert!(
        stats.unsupported_items.is_empty(),
        "{:?}",
        stats.unsupported_items
    );
    let m = &set.parts[0].1;
    let (mn, mx) = m.bounds();
    assert!((mn[0] as f64 + 5.0).abs() < 0.1 && (mx[0] as f64 - 5.0).abs() < 0.1);
    assert!((mn[1] as f64 + 5.0).abs() < 0.1 && (mx[1] as f64 - 5.0).abs() < 0.1);
    assert!((mn[2] as f64).abs() < 1e-6 && (mx[2] as f64 - 10.0).abs() < 1e-6);
    let want = 2.0 * std::f64::consts::PI * 25.0 + 2.0 * std::f64::consts::PI * 5.0 * 10.0;
    let got = total_area(m);
    assert!(
        (got - want).abs() / want < 0.02,
        "area {got} vs analytic {want}"
    );
}

#[test]
fn revolved_area_solid_makes_a_square_section_ring() {
    // 4x6 rectangle at r=10..14 revolved a full turn around z
    let sf = load("revolved_area_solid.step");
    let (set, stats) = tessellate_all(&sf, &["REVOLVED_AREA_SOLID"]);
    assert_eq!(stats.faces_ok, 1, "revolution should tessellate");
    assert!(
        stats.unsupported_items.is_empty(),
        "{:?}",
        stats.unsupported_items
    );
    let m = &set.parts[0].1;
    let (mn, mx) = m.bounds();
    assert!((mn[0] as f64 + 14.0).abs() < 0.2 && (mx[0] as f64 - 14.0).abs() < 0.2);
    assert!((mn[1] as f64 + 14.0).abs() < 0.2 && (mx[1] as f64 - 14.0).abs() < 0.2);
    assert!((mn[2] as f64).abs() < 1e-6 && (mx[2] as f64 - 6.0).abs() < 1e-6);
    // walls: 2π·14·6 + 2π·10·6, caps: 2·π·(14²−10²)
    let tau = std::f64::consts::TAU;
    let want = tau * 14.0 * 6.0 + tau * 10.0 * 6.0 + tau * (14.0 * 14.0 - 10.0 * 10.0);
    let got = total_area(m);
    assert!(
        (got - want).abs() / want < 0.02,
        "area {got} vs analytic {want}"
    );
}

#[test]
fn hierarchical_recentring_moves_bbox_centre_to_node_translation() {
    // a triangle sited far from the origin must come out with near-origin
    // vertex data; the offset rides on a node transform instead
    let sf = load("triangle.step");
    let (set, _) = tessellate_all(&sf, &["ADVANCED_FACE"]);
    let mut set = set;
    let c = set.recenter();
    let m = &set.parts[0].1;
    let (mn, mx) = m.bounds();
    for k in 0..3 {
        assert!(
            (mn[k] + mx[k]).abs() < 1e-3,
            "recentred bbox not centred on origin: {mn:?} {mx:?}"
        );
    }
    // original triangle spans 0..10 in x/y -> centre (5, 5, 0)
    assert!((c.x - 5.0).abs() < 1e-6 && (c.y - 5.0).abs() < 1e-6 && c.z.abs() < 1e-6);
}

#[test]
fn pcurve_only_edges_tessellate_through_the_surface() {
    // a plane triangle whose edges carry only 2D p-curves (no 3D geometry)
    let sf = load("pcurve_edges.step");
    let (set, stats) = tessellate_all(&sf, &["ADVANCED_FACE"]);
    assert_eq!(stats.faces_ok, 1);
    assert!(
        stats.unsupported_curves.is_empty(),
        "{:?}",
        stats.unsupported_curves
    );
    let got = total_area(&set.parts[0].1);
    assert!((got - 50.0).abs() < 1e-6, "area {got} vs 50");
}

#[test]
fn offset_surface_face_tessellates_at_the_offset() {
    // 10x10 square on OFFSET_SURFACE(plane z=0, d=5): area 100 at z=5
    let sf = load("offset_surface.step");
    let (set, stats) = tessellate_all(&sf, &["ADVANCED_FACE"]);
    assert_eq!(stats.faces_ok, 1);
    let m = &set.parts[0].1;
    let (mn, mx) = m.bounds();
    assert!(
        (mn[2] - 5.0).abs() < 1e-9 && (mx[2] - 5.0).abs() < 1e-9,
        "z {mn:?} {mx:?}"
    );
    let got = total_area(m);
    assert!((got - 100.0).abs() < 1e-6, "area {got} vs 100");
}

#[test]
fn rts_window_without_loops_trims_the_surface() {
    // quarter cylinder r=5, v 0..10, no boundary loops: area r·(π/2)·10
    let sf = load("rts_window.step");
    let (set, stats) = tessellate_all(&sf, &["ADVANCED_FACE"]);
    assert_eq!(stats.faces_ok, 1);
    let m = &set.parts[0].1;
    let want = 5.0 * std::f64::consts::FRAC_PI_2 * 10.0;
    let got = total_area(m);
    assert!((got - want).abs() / want < 0.01, "area {got} vs {want}");
    let (mn, mx) = m.bounds();
    assert!(
        mn[0] > -0.1 && (mx[0] - 5.0).abs() < 0.1,
        "x range {mn:?} {mx:?}"
    );
    assert!((mx[2] - 10.0).abs() < 1e-6 && mn[2].abs() < 1e-6);
}

#[test]
fn csg_half_space_cuts_a_block_in_half() {
    // 10³ block minus the half-space above z=5 (agreement .F. → material on
    // the +normal side) leaves the lower 10x10x5 half
    let sf = load("csg_halfspace_cut.step");
    let (set, stats) = tessellate_all(&sf, &["BOOLEAN_RESULT"]);
    assert_eq!(stats.faces_ok, 1, "{:?}", stats.unsupported_items);
    let m = &set.parts[0].1;
    let vol = signed_volume(m);
    assert!((vol - 500.0).abs() < 1.0, "volume {vol} vs 500");
    let (mn, mx) = m.bounds();
    assert!(
        (mx[2] - 5.0).abs() < 1e-6 && mn[2].abs() < 1e-6,
        "z {mn:?} {mx:?}"
    );
}

#[test]
fn csg_right_angular_wedge_has_trapezoid_volume() {
    // x=10, y=6, z=4, ltx=3: profile area 4·(10+3)/2 = 26, volume 156
    let sf = load("csg_wedge.step");
    let (set, stats) = tessellate_all(&sf, &["RIGHT_ANGULAR_WEDGE"]);
    assert_eq!(stats.faces_ok, 1, "{:?}", stats.unsupported_items);
    let vol = signed_volume(&set.parts[0].1);
    assert!((vol - 156.0).abs() < 1e-6, "volume {vol} vs 156");
}

#[test]
fn extruded_face_solid_makes_a_closed_box() {
    // 8x6 rectangular face extruded +z by 5: area 2·48 + 2·(8+6)·5 = 236
    let sf = load("extruded_face_solid.step");
    let (set, stats) = tessellate_all(&sf, &["EXTRUDED_FACE_SOLID"]);
    assert_eq!(stats.faces_ok, 1, "{:?}", stats.unsupported_items);
    let got = total_area(&set.parts[0].1);
    assert!((got - 236.0).abs() < 1e-6, "area {got} vs 236");
}

#[test]
fn poisoned_inner_loop_is_salvaged_not_fatal() {
    // the cylinder band plus a third loop whose circle sits 200 units off the
    // surface (a leaked edge from another face): the bad loop is dropped and
    // the band still tessellates with its full area
    let sf = load("cylinder_band_poisoned_loop.step");
    let (set, stats) = tessellate_all(&sf, &["SHELL_BASED_SURFACE_MODEL"]);
    assert_eq!(stats.faces_ok, 1, "failed: {:?}", stats.failed_surfaces);
    let want = std::f64::consts::TAU * 5.0 * 10.0;
    let got = total_area(&set.parts[0].1);
    assert!((got - want).abs() / want < 0.02, "area {got} vs {want}");
}

#[test]
fn surface_style_rendering_resolves_color_and_transparency() {
    // SURFACE_STYLE_RENDERING_WITH_PROPERTIES: blue at 25% transparency
    let sf = load("rendering_style.step");
    let colors = styles::build_color_map(&sf);
    let c = colors.get(&23).expect("solid #23 should be styled");
    assert_eq!(&c[..3], &[0.0, 0.0, 1.0]);
    assert!((c[3] - 0.75).abs() < 1e-6, "alpha {}", c[3]);
}

#[test]
fn torus_elbow_meshes_the_segment_not_the_donut() {
    // a quarter elbow on a torus (major 50, tube 5) bounded by its two tube
    // end-circles (loops that wind the v period, not u). Exact patch area:
    // r·Δu·2πR = 5·(π/2)·(2π·50) = 250π². A full donut would be 4x that and
    // span ±55 in both x and y.
    let sf = load("torus_elbow.step");
    let (set, stats) = tessellate_all(&sf, &["SHELL_BASED_SURFACE_MODEL"]);
    assert_eq!(stats.faces_ok, 1, "failed: {:?}", stats.failed_surfaces);
    let m = &set.parts[0].1;
    let want = 250.0 * std::f64::consts::PI * std::f64::consts::PI;
    let got = total_area(m);
    assert!((got - want).abs() / want < 0.02, "area {got} vs {want}");
    let (mn, mx) = m.bounds();
    assert!(
        mn[0] > -6.0 && mn[1] > -6.0,
        "spills past the elbow: {mn:?} {mx:?}"
    );
    assert!((mx[0] - 55.0).abs() < 0.5 && (mx[1] - 55.0).abs() < 0.5);
}

#[test]
fn torus_elbow_complement_takes_the_long_way_around() {
    // same two end-circles, orientations flipped: the face interior is the
    // *other* three-quarter turn. Area r·(3π/2)·2πR = 750π².
    let sf = load("torus_elbow_complement.step");
    let (set, stats) = tessellate_all(&sf, &["SHELL_BASED_SURFACE_MODEL"]);
    assert_eq!(stats.faces_ok, 1, "failed: {:?}", stats.failed_surfaces);
    let want = 750.0 * std::f64::consts::PI * std::f64::consts::PI;
    let got = total_area(&set.parts[0].1);
    assert!((got - want).abs() / want < 0.02, "area {got} vs {want}");
}
