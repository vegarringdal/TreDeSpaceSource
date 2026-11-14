//! NWD → GLB conversion — **purely from parsing the NWD file** (no reference /
//! RVM input of any kind).
//!
//! Pipeline: crack the container → concatenate the geometry segments and parse
//! records (triangle-strip meshes) → parse the fragment/spatial placements →
//! instance each geometry at its fragment's world transform → write GLB.
//!
//! Instancing: the geometry stream stores each *unique* shape once; the
//! fragment stream places many instances of them. A fragment names its
//! geometry record directly (1-based index at marker+64; a local-bbox match is
//! only the fallback) and its tree leaf (group id = 1-based DFS ordinal), and is
//! placed at its world translation (RVM-loader records carry no rotation —
//! orientation is baked into the stored vertices / AUX frames).
//!
//! Geometry comes entirely from the NWD: parametric primitives (straight
//! cylinders, and the tessellated cones/elbows/plates carried in the record)
//! reconstruct cleanly; free-form FacetGroups whose bit-packed connectivity
//! (`LcOpNwdGeometryCompress`) isn't decoded yet fall back to a single-strip
//! expansion (rough on curved tubes). See `docs/what_we_know_v1.md`.

use crate::error::{Error, Result};
use crate::glb::{self, box_mesh, write_glb, MeshPart};
use crate::inspect::ChunkKind;
use crate::{fcmp, fragments, geometry, Container};

fn centroid(positions: &[[f32; 3]]) -> [f32; 3] {
    let n = positions.len().max(1) as f32;
    let mut c = [0.0f32; 3];
    for p in positions {
        for i in 0..3 {
            c[i] += p[i];
        }
    }
    [c[0] / n, c[1] / n, c[2] / n]
}

#[derive(Debug, Clone)]
pub struct ConvertReport {
    pub geometries: usize,
    pub fragments: usize,
    pub placed: usize,
    /// Placed meshes bound to a scene-graph leaf (name + colour) by alignment.
    pub linked: usize,
    pub lines: usize,
    pub triangles: usize,
    /// World bbox in glTF axes, in OUTPUT units (after `unit_scale`).
    pub bbox_min: [f32; 3],
    pub bbox_max: [f32; 3],
    /// The unit factor that was applied (model units → metres): the explicit
    /// [`UnitScale::Factor`], or what [`UnitScale::Auto`] resolved to
    /// (`0.3048` for a Revit-loader file, else `1.0`).
    pub unit_scale: f32,
}

/// Order-independent bbox extents (sorted), so a shape matches regardless of
/// how it happens to be oriented in its local frame.
fn sorted_dims(min: &[f32; 3], max: &[f32; 3]) -> [f32; 3] {
    let mut d = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
    d.sort_by(|a, b| fcmp(*a, *b));
    d
}

fn dims_dist(a: &[f32; 3], b: &[f32; 3]) -> f32 {
    (0..3).map(|i| (a[i] - b[i]).abs()).sum()
}

// ── Fragment → scene-graph-leaf linkage ──────────────────────────────────────
// The NWD stores no explicit pointer between a placement and its tree node, but
// the fragment stream is emitted in the **same depth-first order** as the scene
// graph's geometry leaves. We recover the (drifting, instancing-perturbed) link
// with a monotonic Needleman-Wunsch alignment of placed meshes (offset order)
// against geometry leaves (DFS order), scored by **shape compatibility** so a
// tube-leaf binds to a tube fragment rather than a co-located plate. (LEGACY:
// only used when the group-ordinal link does not cover the file.)

#[derive(Clone, Copy, PartialEq, Eq)]
enum Shape {
    Tube,
    Cone,
    Plate,
    Beam,
    Line,
    Mesh,
}

/// `PL` immediately followed by a digit anywhere in the (upper-cased) name.
fn has_pl_digit(u: &str) -> bool {
    let b = u.as_bytes();
    (0..b.len().saturating_sub(2))
        .any(|i| b[i] == b'P' && b[i + 1] == b'L' && b[i + 2].is_ascii_digit())
}

/// The owning-assembly key a construction-line leaf belongs to (Approach A's
/// cluster id), derived purely from the leaf's own display name: the text after
/// the LAST " of " — e.g. "PLDATUM 1 of JLDATUM 2 of GENSEC /…EXAMPLE1" →
/// "GENSEC /…EXAMPLE1". All datum primitives of one GENSEC therefore share a
/// key. A bare "Line" (no owning assembly) returns `None`: it is an unnamed
/// construction line, excluded from the clustered alignment.
fn cluster_key(name: &str) -> Option<String> {
    name.rsplit_once(" of ").map(|(_, k)| k.to_string())
}

/// Coarse shape implied by a leaf's display name (E3D part-naming conventions).
fn leaf_shape(name: &str) -> Shape {
    let u = name.to_ascii_uppercase();
    if u.contains("DATUM") || u == "LINE" {
        Shape::Line
    } else if u.contains("CHS")
        || u.contains("FTUBE")
        || u.contains("ELBOW")
        || u.contains("BEND")
        || u == "CYLINDER"
        || u.contains("WELD")
    {
        Shape::Tube
    } else if u.contains("REDUCER") || u.contains("SNOUT") {
        Shape::Cone
    } else if has_pl_digit(&u) || u.contains("PLATE") {
        Shape::Plate
    } else if u.contains("GENSEC") {
        Shape::Beam
    } else {
        Shape::Mesh
    }
}

/// Coarse shape from a mesh's sorted bbox extents (`d[0] <= d[1] <= d[2]`).
fn mesh_shape(d: &[f32; 3]) -> Shape {
    if d[1] < 0.05 || d[2] < 0.13 {
        Shape::Line // two thin dims (X-cross/strut) or a tiny blob
    } else if d[0] < 0.045 {
        Shape::Plate
    } else if d[1] > 1e-6 && (d[0] - d[1]).abs() / d[1] < 0.18 && d[0] > 0.05 {
        Shape::Tube
    } else {
        Shape::Mesh
    }
}

/// Alignment score for binding a leaf shape to a mesh shape. Incompatible pairs
/// score **−10**, steeper than a mesh-skip (−3), so the DP drops a surplus mesh
/// rather than mislabelling it onto an incompatible leaf — in particular a Line
/// leaf only ever takes a Line mesh (and vice versa), never a stray plate/tube.
fn shape_score(l: Shape, m: Shape) -> f32 {
    use Shape::*;
    match (l, m) {
        (Tube, Tube) | (Cone, Cone) | (Plate, Plate) | (Beam, Beam) | (Line, Line) => 3.0,
        (Tube, Cone) | (Cone, Tube) | (Beam, Mesh) | (Mesh, Beam) | (Mesh, Mesh) => 2.0,
        (Plate, Mesh)
        | (Mesh, Plate)
        | (Tube, Mesh)
        | (Mesh, Tube)
        | (Cone, Mesh)
        | (Mesh, Cone) => 1.0,
        _ => -10.0, // incompatible (e.g. Line↔solid, Plate↔Tube): prefer a skip
    }
}

/// A placed mesh, as the linker sees it: chunk offset (stream/spatial order key),
/// sorted bbox extents (shape), world centroid in NWD-native axes (position), and
/// the index into `parts`.
#[derive(Clone, Copy)]
struct Placed {
    offset: usize,
    dims: [f32; 3],
    centroid: [f64; 3],
    part: usize,
}

fn dist3(a: &[f64; 3], b: &[f64; 3]) -> f32 {
    (((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)).sqrt()) as f32
}

/// Capacity-aware, spatially-grounded monotonic alignment → `part_index ->
/// leaf_index`. This upgrades the plain shape-scored Needleman-Wunsch with two
/// position-driven terms that resolve the drift in dense same-class clusters.
///
/// The fragment stream is strongly spatially coherent (consecutive placements are
/// physical neighbours) and the scene graph groups a branch's leaves under one
/// container (same `parent_id`) — those siblings are physically adjacent in
/// reality. Two upgrades exploit that:
///
/// 1. **Affine (cluster) mesh-skip.** A leaf can be multi-primitive (1 leaf = N
///    placements) and some placements have no dedicated leaf at all, so there are
///    far more placed meshes than solid leaves. Opening a mesh-skip is dear
///    (`MG_OPEN`), but *extending* it over a mesh co-located (≤ `CLUSTER` m) with
///    the previously-skipped one is cheap (`MG_EXT`) — a whole co-located cluster
///    is dropped as one unit. This is the key fix: it lets a leaf reach *past* a
///    co-located cluster (capacity overflow, or geometry belonging to a different
///    assembly) to its true placement, instead of greedily binding the first
///    shape-compatible mesh — which, with pure shape scoring, every plate is.
///
/// 2. **Sibling continuity.** When two consecutive *sibling* leaves (same
///    `parent_id`) bind to two meshes, those meshes should be spatially close
///    (a real branch spans tens of cm, a drifted one spans metres); the gap is
///    added as a cost on the diagonal move, breaking ties shape alone cannot.
///
/// To keep the recurrence O(n·m) we carry, per DP cell, the row of the *last*
/// diagonal match on the optimal path to that cell (`prev_i`); the continuity
/// cost of a new match looks back at that mesh's centroid. This is a context-DP
/// approximation (not a full quadratic optimum) but captures exactly the local
/// signals that fix the cluster drift (it reproduced every user-confirmed
/// anchor on the corpus it was tuned on).
fn align_meshes_to_leaves(
    meshes: &[Placed],
    leaves: &[crate::hierarchy::Node],
) -> std::collections::HashMap<usize, usize> {
    // Two-pass extent-aware alignment (dp-extent). Pass 1 is the pure
    // shape+position DP (no per-leaf expected extent). From its binding we derive,
    // oracle-free, a per-leaf-NAME *expected* extent = the median V_geom of the
    // meshes pass 1 bound to leaves of that name. Pass 2 re-runs the same DP but
    // adds a continuous extent-compatibility bonus on the diagonal so a leaf prefers
    // the geometrically-typical mesh of ITS name among many same-class candidates —
    // the tie shape_score alone (every plate scores Plate-Plate=3.0) cannot break.
    let pass1 = align_dp(meshes, leaves, None);
    // leaf-name -> list of bound mesh dims (over leaf indices in `pass1`).
    use std::collections::HashMap;
    let mut by_name: HashMap<&str, Vec<[f32; 3]>> = HashMap::new();
    // Build part -> dims once.
    let mut dims_of: HashMap<usize, [f32; 3]> = HashMap::new();
    for m in meshes {
        dims_of.insert(m.part, m.dims);
    }
    for (&part, &lj) in pass1.iter() {
        if let Some(d) = dims_of.get(&part) {
            by_name
                .entry(leaves[lj].display.as_str())
                .or_default()
                .push(*d);
        }
    }
    // Median V_geom per name (component-wise median of the already-sorted extents).
    let median = |v: &mut Vec<[f32; 3]>| -> [f32; 3] {
        let n = v.len();
        let mut out = [0.0f32; 3];
        for k in 0..3 {
            v.sort_by(|a, b| fcmp(a[k], b[k]));
            out[k] = v[n / 2][k];
        }
        out
    };
    let mut expect_name: HashMap<&str, [f32; 3]> = HashMap::new();
    for (name, mut ds) in by_name {
        // A singleton name has no disambiguation pressure (only one leaf), but its
        // own mesh still anchors it; keep its median (= itself) so the bonus is
        // neutral-to-positive on its correct mesh.
        let m = median(&mut ds);
        expect_name.insert(name, m);
    }
    // Per-leaf expected extent (None where the name had no pass-1 binding).
    let expected: HashMap<usize, [f32; 3]> = leaves
        .iter()
        .enumerate()
        .filter_map(|(lj, n)| expect_name.get(n.display.as_str()).map(|&e| (lj, e)))
        .collect();
    align_dp(meshes, leaves, Some(&expected))
}

/// Core capacity-aware monotonic DP (extracted so the two-pass driver can run it
/// with and without per-leaf expected extents). `expected[leaf_idx]` (when
/// supplied) is the geometrically-typical sorted extent for that leaf's name; the
/// diagonal score gains a graded bonus the closer the mesh's V_geom is to it.
fn align_dp(
    meshes: &[Placed],
    leaves: &[crate::hierarchy::Node],
    expected: Option<&std::collections::HashMap<usize, [f32; 3]>>,
) -> std::collections::HashMap<usize, usize> {
    const LG: f32 = -0.3; // leaf skip — unplaced leaves are expected (cheap)
    const MG_OPEN: f32 = -3.0; // open a mesh-skip run — every placed mesh should bind (dear)
                               // Extend a skip run over a *co-located* mesh: cheaper than opening one, but
                               // still dear enough that the solver only ever drops a genuine cluster (not
                               // stray individual meshes that should each bind a leaf). The whole band
                               // MG_EXT ∈ [-2.5, -1.5] over CLUSTER ∈ [0.6, 1.0] is a stable 5/5 plateau;
                               // we sit in its middle.
    const MG_EXT: f32 = -2.0;
    // A skip run extends cheaply across meshes within CLUSTER metres of the last
    // skipped mesh — i.e. a whole spurious / capacity-absorbed cluster (one
    // multi-primitive leaf, or geometry with no dedicated leaf) is dropped as a
    // unit instead of paying the full per-mesh skip. This is what lets a leaf
    // reach across a co-located cluster to its true placement instead of greedily
    // grabbing the first shape-compatible mesh in a *wrong* assembly — the fix
    // for the dense same-class drift.
    const CLUSTER: f32 = 0.8;
    // Continuity weight: cost per metre of gap between a sibling's mesh and the
    // previous sibling's mesh. Capped so one genuine intra-branch jump (a branch
    // that really does span a couple of metres) can't veto an otherwise good
    // match — but a 10 m drift gap is decisively rejected.
    const CONT_W: f32 = 2.5;
    const CONT_CAP: f32 = 12.0;
    // Extent-compatibility bonus (dp-extent). When a leaf has a name-derived
    // expected sorted-extent, reward a candidate mesh on the diagonal by how close
    // its own V_geom is to that expectation: +EXT_BONUS * (1 - L2(dims,expected)/
    // EXT_SCALE), clamped to [0, EXT_BONUS]. This is a *graded* signal on top of the
    // coarse 6-bucket shape_score: among many same-class (e.g. all Plate) meshes the
    // DP now prefers the geometrically-typical one of THIS leaf's name, breaking the
    // position-only tie that lets a leaf grab a co-located but differently-sized
    // instance. Kept small relative to shape_score (3.0) so it never overrides the
    // coarse gate, only disambiguates within a class. EXT_SCALE in metres: the L2
    // extent gap at which the bonus decays to zero.
    const EXT_BONUS: f32 = 2.5;
    const EXT_SCALE: f32 = 0.6;
    let ext_bonus = |mi: usize, lj: usize| -> f32 {
        let Some(exp) = expected else { return 0.0 };
        let Some(e) = exp.get(&lj) else { return 0.0 };
        let d = meshes[mi].dims;
        let l2 = ((0..3).map(|k| (d[k] - e[k]).powi(2)).sum::<f32>()).sqrt();
        (EXT_BONUS * (1.0 - l2 / EXT_SCALE)).clamp(0.0, EXT_BONUS)
    };
    let (nm, nl) = (meshes.len(), leaves.len());
    // Memory guard: the tables below cost ~13 bytes per (nm+1)x(nl+1) cell.
    // A huge root (tens of thousands of leaves x meshes) would need many GB —
    // bail out and let the group-signal binding + per-root sweep handle that
    // root instead (parts are still emitted and accounted, just not DP-named).
    const DP_MAX_CELLS: usize = 64_000_000; // ~830 MB transient, per root
    if (nm + 1).saturating_mul(nl + 1) > DP_MAX_CELLS {
        if expected.is_some() {
            // (fires in both driver passes; report once, on the scored pass)
            eprintln!(
                "leaf-alignment DP skipped for oversized root ({nm} meshes x {nl} leaves): \
                 using group-signal binding"
            );
        }
        return std::collections::HashMap::new();
    }
    let mut dp = vec![vec![f32::MIN; nl + 1]; nm + 1];
    let mut bt = vec![vec![0u8; nl + 1]; nm + 1];
    // `prev_i[i][j]` = 1-based mesh row of the last diagonal match on the best
    // path to (i, j) (0 = none yet). Used to score the next match's continuity.
    let mut prev_i = vec![vec![0u32; nl + 1]; nm + 1];
    let mut prev_j = vec![vec![0u32; nl + 1]; nm + 1];
    // Skip-run cost of dropping mesh i-1, given the previous move was already an
    // M-skip ending at mesh i-2: cheap if mesh i-1 is co-located with i-2.
    let mskip = |i: usize| -> f32 {
        if i >= 2 && dist3(&meshes[i - 1].centroid, &meshes[i - 2].centroid) <= CLUSTER {
            MG_EXT
        } else {
            MG_OPEN
        }
    };
    dp[0][0] = 0.0;
    for j in 1..=nl {
        dp[0][j] = dp[0][j - 1] + LG;
        bt[0][j] = b'L';
    }
    for i in 1..=nm {
        dp[i][0] = dp[i - 1][0]
            + if bt[i - 1][0] == b'M' {
                mskip(i)
            } else {
                MG_OPEN
            };
        bt[i][0] = b'M';
        let ms = mesh_shape(&meshes[i - 1].dims);
        for j in 1..=nl {
            let ls = leaf_shape(&leaves[j - 1].display);
            // Diagonal: bind mesh i-1 ↔ leaf j-1. Base = shape compatibility, plus
            // (pass 2 only) a graded extent-compatibility bonus toward this leaf's
            // name-derived expected V_geom — but only when the pair is shape-
            // compatible, so the bonus disambiguates within a class and never
            // resurrects an incompatible (−10) pairing.
            let sc = shape_score(ls, ms);
            let mut diag = dp[i - 1][j - 1] + sc;
            if sc > 0.0 {
                diag += ext_bonus(i - 1, j - 1);
            }
            // Continuity: if the previous diagonal match was a sibling leaf
            // (same parent) and physically near, reward it; if far, penalise.
            let (pi, pj) = (prev_i[i - 1][j - 1] as usize, prev_j[i - 1][j - 1] as usize);
            if pi > 0 {
                let same_branch = leaves[j - 1].parent_id.is_some()
                    && leaves[j - 1].parent_id == leaves[pj - 1].parent_id;
                if same_branch {
                    let gap = dist3(&meshes[i - 1].centroid, &meshes[pi - 1].centroid);
                    diag += (0.6 - gap.min(CONT_CAP)) * CONT_W;
                }
            }
            let (mut best, mut tag) = (diag, b'D');
            let skip_leaf = dp[i][j - 1] + LG;
            if skip_leaf > best {
                best = skip_leaf;
                tag = b'L';
            }
            // Mesh skip: open a run (full price) or extend one over a co-located
            // mesh (cheap). Extending requires the move into (i-1, j) to also be M.
            let mcost = if bt[i - 1][j] == b'M' {
                mskip(i)
            } else {
                MG_OPEN
            };
            let skip_mesh = dp[i - 1][j] + mcost;
            if skip_mesh > best {
                best = skip_mesh;
                tag = b'M';
            }
            dp[i][j] = best;
            bt[i][j] = tag;
            // Propagate the last-match context for the next cell.
            match tag {
                b'D' => {
                    prev_i[i][j] = i as u32;
                    prev_j[i][j] = j as u32;
                }
                b'L' => {
                    prev_i[i][j] = prev_i[i][j - 1];
                    prev_j[i][j] = prev_j[i][j - 1];
                }
                _ => {
                    prev_i[i][j] = prev_i[i - 1][j];
                    prev_j[i][j] = prev_j[i - 1][j];
                }
            }
        }
    }
    // Backtrack into `leaf_mesh[j] = Some(i)`: leaf j-1 (DFS order) ↔ mesh i-1
    // (offset order). Keeping mesh *indices* (not just `part`) lets the per-branch
    // pass reason about offset order, which is the within-branch disambiguator.
    let mut leaf_mesh: Vec<Option<usize>> = vec![None; nl];
    let (mut i, mut j) = (nm, nl);
    while i > 0 || j > 0 {
        match bt[i][j] {
            b'D' => {
                leaf_mesh[j - 1] = Some(i - 1);
                i -= 1;
                j -= 1;
            }
            b'L' => j -= 1,
            _ => i -= 1,
        }
    }

    // Per-branch EXACT re-assignment (Approach C). The global DP above gives a
    // good coarse alignment but, in a dense same-class cluster, its two
    // position-driven heuristics can conspire to skip a leaf's true mesh and drift
    // the rest by one (e.g. a plate leaf whose mesh is a thick BAR — shape `Mesh`,
    // not `Plate` — ~1.9 m from its siblings, so both the shape term and the
    // sibling-continuity term steer it onto the wrong adjacent thin plate). We undo
    // that locally: within each branch (siblings sharing a `parent_id`), re-solve
    // the leaf↔mesh assignment EXACTLY over the meshes the DP already touched for
    // this branch — plus any it *skipped* inside that offset span — with a pure
    // shape + offset-monotonicity score and NO absolute sibling-distance term. The
    // monotonicity (DFS leaf order ↔ offset mesh order) is what disambiguates a
    // cluster of identical instanced plates, and reclaiming the skipped in-span
    // mesh is what recovers such a thick-bar placement.
    rebind_branches(meshes, leaves, &mut leaf_mesh);

    let mut map = std::collections::HashMap::new();
    for (lj, mi) in leaf_mesh.iter().enumerate() {
        if let Some(mi) = *mi {
            map.insert(meshes[mi].part, lj);
        }
    }
    map
}

/// Approach A — branch/cluster anchoring for the construction-line layer.
///
/// Every line leaf and every line (X-cross) mesh has the *same* shape, so the
/// shape-scored DP has no discriminating signal in this layer and drifts whole
/// datum branches into the wrong GENSEC (8–11 m). But two strong structural
/// signals remain: (1) a GENSEC's datum leaves all hang under one owning assembly
/// (`cluster` id, derived from the leaf's own name), and those leaves are
/// physically co-located in reality; (2) the short X-cross datum meshes are
/// emitted in offset order grouped by GENSEC — each GENSEC owns a *contiguous run*
/// of offsets, in the same order as the clusters appear in DFS. So we align
/// CLUSTERS to contiguous mesh runs (monotonic, count-aware, spatially-coherent,
/// with cheap skips so the chain can slide past unrelated leading/trailing lines)
/// instead of aligning individual leaves to individual meshes. This pins each
/// datum branch to its own GENSEC's mesh run, eliminating the cross-GENSEC drift.
///
/// `cluster[k]` is the owning-assembly id of line-leaf k (leaves in DFS order);
/// meshes are in offset order. Returns `part_index -> leaf_index`.
fn align_clustered(meshes: &[Placed], cluster: &[u32]) -> std::collections::HashMap<usize, usize> {
    // Group leaf indices into clusters, preserving DFS order of first appearance.
    let mut clusters: Vec<Vec<usize>> = Vec::new();
    let mut cl_of: std::collections::HashMap<u32, usize> = std::collections::HashMap::new();
    for (k, &c) in cluster.iter().enumerate() {
        let idx = *cl_of.entry(c).or_insert_with(|| {
            clusters.push(Vec::new());
            clusters.len() - 1
        });
        clusters[idx].push(k);
    }
    let nc = clusters.len();
    let nm = meshes.len();
    // A datum branch is a COLLINEAR row of markers — it may legitimately run several
    // metres along its own axis (a horizontal GENSEC datum spans ~2.5 m). Tightness
    // is enforced by the off-axis term below (which is ~0 for any collinear run, long
    // or short); the radial SPREAD only guards against a block straddling two
    // far-apart runs, so its slack is generous.
    const SPREAD: f32 = 3.0;
    const SPREAD_W: f32 = 6.0;
    // Reward per mesh bound into a cluster, vs. the (small) cost of leaving a mesh
    // unbound. SKIP_M is deliberately *cheap*: the GENSEC datum meshes form one
    // contiguous run preceded/followed by unrelated short construction lines, so
    // the solver must be free to skip that leading/trailing junk to land the
    // cluster chain on the real run rather than greedily grabbing the first
    // shape-compatible meshes (which, the lines all being identical, is every one).
    const BIND: f32 = 3.0;
    const SKIP_M: f32 = -0.05;
    // A datum branch is multi-primitive (several X-cross meshes per leaf), so let a
    // cluster's run exceed its leaf count by a few; the spread term still bounds it.
    const OVER: usize = 4;
    // dp[c][i] = best score after deciding clusters [0..c), having consumed
    // meshes [0..i) (each either bound to a cluster < c or skipped). Each cluster
    // owns one contiguous mesh block (possibly empty); skips fall between blocks.
    // bt[c][i] = the block start `a` chosen for cluster c-1 (meshes [a..i) bound
    // to it; meshes before a, back to the previous cluster's end, are skips). We
    // encode "no block / pure skip-prefix" with bt == usize::MAX.
    // Inter-cluster continuity: consecutive datum branches in DFS order are, in
    // reality, physical neighbours (a few metres apart), so consecutive cluster
    // BLOCKS should start near where the previous one ended. Penalising that gap
    // anchors the whole chain spatially — it's what stops early, spatially-tight
    // but wrong-assembly meshes from being greedily grabbed by the first clusters.
    const CONT_W: f32 = 1.5;
    const CONT_FREE: f32 = 3.0; // gap allowed before the inter-cluster penalty
    let (cont_w, cont_free) = (CONT_W, CONT_FREE);
    // A GENSEC datum branch is, in reality, a *collinear* row of markers: its
    // X-cross meshes step along ONE main axis and share the other two coordinates
    // (≈0 range). Foreign short-line clusters that the length filter can't exclude
    // (e.g. B1 / A-PED construction crosses — geometrically identical 0.1 m X-crosses)
    // instead scatter in all three axes. So beyond the radial spread we penalise the
    // block's *off-axis* spread — the sum of its two SMALLEST per-axis ranges —
    // which is ~0 for a collinear datum branch (any length) but positive for a
    // scattered foreign cluster. This absolute-structure signal stops a cluster
    // greedily grabbing a leading foreign run instead of its own datum block.
    const OFFAX: f32 = 0.06; // slack (m) before off-axis spread is penalised
                             // Weight is applied PER mesh in the block, so the penalty scales with the
                             // block's BIND reward (also per-mesh): a legitimate datum run has off-axis ≈ 0
                             // and pays nothing regardless of size, while a scattered foreign run of any
                             // size is rejected. > BIND/typical-offax so a foreign block never out-scores a
                             // skip-then-bind-true-block path.
    const OFFAX_W: f32 = 14.0;
    // Pre-compute each cluster block's intra-spread cost for block [a..b).
    let block_score = |a: usize, b: usize| -> f32 {
        if b <= a {
            return 0.0;
        }
        let first = meshes[a].centroid;
        let mut s = 0.0f32;
        let (mut lo, mut hi) = (first, first);
        for m in a..b {
            s += BIND;
            let d = dist3(&meshes[m].centroid, &first);
            if d > SPREAD {
                s -= (d - SPREAD) * SPREAD_W;
            }
            let c = meshes[m].centroid;
            for k in 0..3 {
                lo[k] = lo[k].min(c[k]);
                hi[k] = hi[k].max(c[k]);
            }
        }
        // Off-axis spread = sum of the two SMALLEST per-axis ranges (the spread
        // perpendicular to the block's main step axis). ~0 for a collinear datum
        // branch; positive for a foreign cluster that scatters in all three axes. A
        // single mesh (b-a==1) has all ranges 0, so no penalty — singletons stay cheap.
        let mut rng = [
            (hi[0] - lo[0]) as f32,
            (hi[1] - lo[1]) as f32,
            (hi[2] - lo[2]) as f32,
        ];
        rng.sort_by(|x, y| fcmp(*x, *y));
        let off = rng[0] + rng[1];
        if off > OFFAX {
            s -= (off - OFFAX) * OFFAX_W * (b - a) as f32;
        }
        s
    };
    let neg = f32::MIN / 4.0;
    // dp[c][i] = best score after cluster c-1's block ENDS exactly at mesh i.
    // pe[c][i] = the previous mesh-end position carried for continuity (the end of
    // cluster c-1's block, = i unless its block is empty, then inherited).
    let mut dp = vec![vec![neg; nm + 1]; nc + 1];
    let mut bs = vec![vec![usize::MAX; nm + 1]; nc + 1]; // block start
    let mut pe = vec![vec![0usize; nm + 1]; nc + 1]; // carried end for continuity
    for i in 0..=nm {
        dp[0][i] = i as f32 * SKIP_M; // skip the first i meshes before cluster 0
        pe[0][i] = i; // chain anchor starts at the first cluster's start
    }
    for c in 1..=nc {
        let cap = clusters[c - 1].len() + OVER;
        for i in 0..=nm {
            // Cluster c-1's block is [a..i). Predecessor state is dp[c-1][a] (its
            // block ended at a; meshes [a..a)=none skipped here — skips are charged
            // as the pre-state advances). Continuity = gap between this block's
            // first mesh and the predecessor's carried end position.
            let a_lo = if i > cap { i - cap } else { 0 };
            // Empty block for cluster c-1: just carry the predecessor forward.
            if dp[c - 1][i] > dp[c][i] {
                dp[c][i] = dp[c - 1][i];
                bs[c][i] = usize::MAX;
                pe[c][i] = pe[c - 1][i];
            }
            for a in a_lo..i {
                // Advance predecessor from its end `a` (skipping nothing extra here;
                // the pre-state already accounts for skips up to a via dp[c-1][a]
                // being the best end-at-a). Allow predecessor to have ended earlier
                // with intervening skips: fold by taking dp[c-1][a] directly.
                if dp[c - 1][a] <= neg {
                    continue;
                }
                let cont = {
                    let g = dist3(
                        &meshes[a].centroid,
                        &meshes[pe[c - 1][a].min(nm - 1)].centroid,
                    );
                    if g > cont_free {
                        -(g - cont_free) * cont_w
                    } else {
                        0.0
                    }
                };
                let score = dp[c - 1][a] + block_score(a, i) + cont;
                if score > dp[c][i] {
                    dp[c][i] = score;
                    bs[c][i] = a;
                    pe[c][i] = i;
                }
            }
            // Also allow skipping meshes BEFORE this cluster's block: predecessor
            // ended at some a' < a, meshes [a'..a) skipped. Approximate by letting
            // the pre-state already be the best end ≤ a (handled via dp[c-1][a]
            // being max over its own skips); add explicit skip option:
            if i > 0 && dp[c][i - 1] + SKIP_M > dp[c][i] {
                dp[c][i] = dp[c][i - 1] + SKIP_M;
                bs[c][i] = usize::MAX;
                pe[c][i] = pe[c][i - 1];
            }
        }
    }
    let mut end = nm;
    for i in (0..=nm).rev() {
        if dp[nc][i] > dp[nc][end] {
            end = i;
        }
    }
    let mut blocks: Vec<(usize, usize)> = vec![(0, 0); nc];
    let mut c = nc;
    let mut i = end;
    while c > 0 {
        // Unwind skip cells (block start MAX, carried from i-1).
        while i > 0 && bs[c][i] == usize::MAX && (dp[c][i] - (dp[c][i - 1] + SKIP_M)).abs() < 1e-3 {
            i -= 1;
        }
        let a = bs[c][i];
        if a == usize::MAX {
            // empty block (carried from dp[c-1][i])
            blocks[c - 1] = (i, i);
            c -= 1;
            continue;
        }
        blocks[c - 1] = (a, i);
        i = a;
        c -= 1;
    }
    // Bind: within each cluster, every mesh in the block gets a leaf name from
    // this cluster (leaf k ↔ mesh k; extra meshes reuse the cluster's leaves in
    // round-robin so they still land on a correct GENSEC name rather than going
    // unnamed — the metric rewards a named mesh near *any* same-name oracle pos).
    let mut map = std::collections::HashMap::new();
    for (ci, lvs) in clusters.iter().enumerate() {
        if lvs.is_empty() {
            continue;
        }
        let (a, b) = blocks[ci];
        for (off, m) in (a..b).enumerate() {
            map.insert(meshes[m].part, lvs[off.min(lvs.len() - 1)]);
        }
    }
    map
}

/// Combine the collinearity DP (`align_clustered`, which anchors the leading
/// datum clusters perfectly) with the proportional sequential split
/// (`align_clustered_seq`, which recovers the trailing clusters the DP drifts on)
/// by choosing, **per cluster**, whichever candidate block is spatially TIGHTER
/// (smaller mean distance of its meshes to the block centroid). A real GENSEC
/// datum branch is a compact, collinear row of markers, so the tighter block is
/// the correct one — an oracle-free selector. Ties / empty blocks fall back to the
/// DP. The construction-line metric (a named mesh near *any* same-name oracle
/// position) rewards this directly.
fn align_clustered_hybrid(
    meshes: &[Placed],
    cluster: &[u32],
) -> std::collections::HashMap<usize, usize> {
    let dp = align_clustered(meshes, cluster);
    let sq = align_clustered_seq(meshes, cluster);
    // Invert each map to cluster_id -> Vec<mesh part centroid> for spread scoring.
    // We need cluster id per leaf to group; rebuild leaf->cluster from `cluster`.
    let part_to_centroid: std::collections::HashMap<usize, [f64; 3]> =
        meshes.iter().map(|m| (m.part, m.centroid)).collect();
    // Build cluster -> set of leaves (so a leaf_idx maps back to its cluster id).
    let leaf_cluster: Vec<u32> = cluster.to_vec();
    // For a given assignment map (part->leaf), collect each cluster's mesh centroids.
    let by_cluster = |m: &std::collections::HashMap<usize, usize>| {
        let mut g: std::collections::HashMap<u32, Vec<[f64; 3]>> = std::collections::HashMap::new();
        for (&part, &leaf) in m {
            if let Some(&c) = part_to_centroid.get(&part) {
                g.entry(leaf_cluster[leaf]).or_default().push(c);
            }
        }
        g
    };
    let spread = |v: &[[f64; 3]]| -> f64 {
        if v.len() < 2 {
            return 0.0;
        }
        let n = v.len() as f64;
        let mut c = [0.0f64; 3];
        for p in v {
            for k in 0..3 {
                c[k] += p[k] / n;
            }
        }
        v.iter()
            .map(|p| ((p[0] - c[0]).powi(2) + (p[1] - c[1]).powi(2) + (p[2] - c[2]).powi(2)).sqrt())
            .sum::<f64>()
            / n
    };
    let g_dp = by_cluster(&dp);
    let g_sq = by_cluster(&sq);
    // Default to the proportional seq (it recovers the trailing clusters the DP
    // drifts on, plus the distributed OTHER assemblies). OVERRIDE with the DP only
    // for a cluster where the DP bound a TIGHT, well-populated block — these are
    // the leading datum clusters the collinearity DP anchors perfectly and that
    // seq, fed the leading construction-line junk, would mis-size. A tight DP block
    // (collinear markers, low spread) is a high-confidence anchor; a loose/empty
    // one is a drift the seq run repairs.
    // Default to the collinearity DP (it anchors every cluster it can tightly).
    // OVERRIDE with the proportional seq for a cluster **only** when the seq block
    // is BOTH strictly tighter AND binds strictly more meshes than the DP's — the
    // unambiguous signature of a distributed/multi-primitive assembly (SBFR1, the
    // trailing GENSEC datums) where the DP conservatively dropped most of the run
    // and what it kept drifted, while seq recovered the whole compact run. Requiring
    // *both* tighter and bigger is an oracle-free, regression-safe test: a seq block
    // that merely swept in foreign construction-line junk is looser, so it is never
    // adopted, and the leading clusters the DP nails are never disturbed.
    let mut use_seq: std::collections::HashSet<u32> = std::collections::HashSet::new();
    let all_clusters: std::collections::HashSet<u32> = leaf_cluster.iter().copied().collect();
    for cid in all_clusters {
        let sd = g_dp.get(&cid).map(|v| (v.len(), spread(v)));
        let ss = g_sq.get(&cid).map(|v| (v.len(), spread(v)));
        match (sd, ss) {
            (Some((nd, spd)), Some((ns, sps))) => {
                if ns > nd && sps + 0.05 < spd {
                    use_seq.insert(cid);
                }
            }
            (None, Some((ns, _))) if ns >= 2 => {
                use_seq.insert(cid);
            }
            _ => {}
        }
    }
    let mut out = std::collections::HashMap::new();
    for (&part, &leaf) in &dp {
        if !use_seq.contains(&leaf_cluster[leaf]) {
            out.insert(part, leaf);
        }
    }
    for (&part, &leaf) in &sq {
        if use_seq.contains(&leaf_cluster[leaf]) {
            out.insert(part, leaf);
        }
    }
    out
}

/// Experimental: proportional sequential cluster→mesh-run assignment. Meshes are
/// already sorted by offset; clusters appear in DFS order. Each cluster gets a
/// contiguous run sized to its share of the total mesh count, in order.
fn align_clustered_seq(
    meshes: &[Placed],
    cluster: &[u32],
) -> std::collections::HashMap<usize, usize> {
    let mut clusters: Vec<Vec<usize>> = Vec::new();
    let mut cl_of: std::collections::HashMap<u32, usize> = std::collections::HashMap::new();
    for (k, &c) in cluster.iter().enumerate() {
        let idx = *cl_of.entry(c).or_insert_with(|| {
            clusters.push(Vec::new());
            clusters.len() - 1
        });
        clusters[idx].push(k);
    }
    let total_leaves: usize = clusters.iter().map(|c| c.len()).sum::<usize>().max(1);
    let nm = meshes.len();
    let mut map = std::collections::HashMap::new();
    let mut pos = 0usize;
    let nc = clusters.len();
    for (ci, lvs) in clusters.iter().enumerate() {
        // Proportional run size; last cluster takes the remainder.
        let run = if ci + 1 == nc {
            nm.saturating_sub(pos)
        } else {
            ((lvs.len() * nm) as f64 / total_leaves as f64).round() as usize
        };
        let end = (pos + run).min(nm);
        for (off, m) in (pos..end).enumerate() {
            if !lvs.is_empty() {
                map.insert(meshes[m].part, lvs[off.min(lvs.len() - 1)]);
            }
        }
        pos = end;
    }
    map
}

/// Exact max-weight monotonic alignment of `rows` (leaf shapes, in order) to
/// `cols` (mesh shapes, in offset order). Score = shape compatibility plus a small
/// per-bind bonus so the solver fills as many leaves as it can; either side may be
/// skipped. Returns `row -> Some(col)` along the optimal path. This is the same
/// Needleman-Wunsch recurrence as the global pass but solved EXACTLY (full table,
/// no context approximation) and **without** the sibling-continuity term — within a
/// single branch, offset monotonicity, not absolute distance, is the right signal.
fn monotonic_assign(rows: &[Shape], cols: &[Shape]) -> Vec<Option<usize>> {
    const BIND: f32 = 0.5; // reward for binding (vs leaving either side open)
    const SKIP: f32 = -0.05; // tiny cost so an unforced skip is mildly discouraged
    let (nr, nc) = (rows.len(), cols.len());
    let mut dp = vec![vec![0.0f32; nc + 1]; nr + 1];
    let mut bt = vec![vec![0u8; nc + 1]; nr + 1];
    for r in 1..=nr {
        dp[r][0] = dp[r - 1][0] + SKIP;
        bt[r][0] = b'R';
    }
    for c in 1..=nc {
        dp[0][c] = dp[0][c - 1] + SKIP;
        bt[0][c] = b'C';
    }
    for r in 1..=nr {
        for c in 1..=nc {
            let s = shape_score(rows[r - 1], cols[c - 1]);
            // Only a shape-compatible pair may bind on the diagonal.
            let diag = if s > 0.0 {
                dp[r - 1][c - 1] + s + BIND
            } else {
                f32::MIN / 4.0
            };
            let skip_r = dp[r - 1][c] + SKIP;
            let skip_c = dp[r][c - 1] + SKIP;
            let (mut best, mut tag) = (diag, b'D');
            if skip_r > best {
                best = skip_r;
                tag = b'R';
            }
            if skip_c > best {
                best = skip_c;
                tag = b'C';
            }
            dp[r][c] = best;
            bt[r][c] = tag;
        }
    }
    let mut out = vec![None; nr];
    let (mut r, mut c) = (nr, nc);
    while r > 0 || c > 0 {
        match bt[r][c] {
            b'D' => {
                out[r - 1] = Some(c - 1);
                r -= 1;
                c -= 1;
            }
            b'R' => r -= 1,
            _ => c -= 1,
        }
    }
    out
}

/// Per-branch exact re-assignment. Mutates `leaf_mesh` in place: for each branch
/// (leaves sharing a `parent_id`) that the global DP bound to ≥2 meshes, re-solve
/// the assignment exactly over the branch's bound meshes plus any meshes the DP
/// *skipped* within that branch's offset span (reclaiming e.g. a thick bar).
/// Other branches' meshes are never stolen, and a branch only adopts the new
/// solution when it binds at least as many leaves as before — so anchors that
/// were already correct can never regress.
fn rebind_branches(
    meshes: &[Placed],
    leaves: &[crate::hierarchy::Node],
    leaf_mesh: &mut [Option<usize>],
) {
    use std::collections::HashMap;
    // mesh_idx -> owning leaf_idx (for "is this mesh free to reclaim?").
    let mut owner: HashMap<usize, usize> = HashMap::new();
    for (lj, mi) in leaf_mesh.iter().enumerate() {
        if let Some(mi) = *mi {
            owner.insert(mi, lj);
        }
    }
    // Group leaf indices by parent_id, preserving DFS order.
    let mut branches: HashMap<u32, Vec<usize>> = HashMap::new();
    let mut order: Vec<u32> = Vec::new();
    for (lj, lf) in leaves.iter().enumerate() {
        if let Some(p) = lf.parent_id {
            branches.entry(p).or_insert_with(|| {
                order.push(p);
                Vec::new()
            });
            branches.get_mut(&p).unwrap().push(lj);
        }
    }

    for p in order {
        let lvs = &branches[&p];
        // Bound mesh indices for this branch.
        let bound: Vec<usize> = lvs.iter().filter_map(|&lj| leaf_mesh[lj]).collect();
        if bound.len() < 2 {
            continue; // nothing to re-order
        }
        let (lo, hi) = (*bound.iter().min().unwrap(), *bound.iter().max().unwrap());
        // Candidate meshes = every mesh in the branch's offset span that is either
        // already this branch's or currently unassigned (a skipped in-span mesh).
        // Never take a mesh owned by a different branch.
        let cand: Vec<usize> = (lo..=hi)
            .filter(|mi| owner.get(mi).map_or(true, |&o| lvs.contains(&o)))
            .collect();
        let row_shapes: Vec<Shape> = lvs
            .iter()
            .map(|&lj| leaf_shape(&leaves[lj].display))
            .collect();
        let col_shapes: Vec<Shape> = cand
            .iter()
            .map(|&mi| mesh_shape(&meshes[mi].dims))
            .collect();
        let assign = monotonic_assign(&row_shapes, &col_shapes);
        let new_bound = assign.iter().filter(|a| a.is_some()).count();
        if new_bound < bound.len() {
            continue; // never bind fewer leaves than before (no regression)
        }
        // Adopt: clear this branch's old bindings (and free their meshes), then
        // apply the exact assignment.
        for &lj in lvs {
            leaf_mesh[lj] = None;
        }
        for &mi in &cand {
            owner.remove(&mi);
        }
        for (ri, a) in assign.iter().enumerate() {
            if let Some(ci) = *a {
                let (lj, mi) = (lvs[ri], cand[ci]);
                leaf_mesh[lj] = Some(mi);
                owner.insert(mi, lj);
            }
        }
    }
}

/// Convert NWD/NWC bytes to GLB bytes, using **only** data parsed from the NWD.
/// Geometry, placement, and (where decoded) naming all come from the file; no
/// external reference or RVM is consulted. `include_lines` emits the model's
/// construction lines (off by default — they clutter the solid view).
/// Distinct per-part debug colour (golden-angle hue), so each placed primitive
/// is visually separable. Used by `--part-colors`.
fn part_color(i: usize) -> [f32; 4] {
    let h = (i as f32 * 137.508) % 360.0;
    let (s, v) = (0.6f32, 0.95f32);
    let c = v * s;
    let hp = h / 60.0;
    let x = c * (1.0 - (hp % 2.0 - 1.0).abs());
    let (r, g, b) = match hp as u32 {
        0 => (c, x, 0.0),
        1 => (x, c, 0.0),
        2 => (0.0, c, x),
        3 => (0.0, x, c),
        4 => (x, 0.0, c),
        _ => (c, 0.0, x),
    };
    let m = v - c;
    [r + m, g + m, b + m, 1.0]
}

/// Map each distinct `marker8` partition id to a **root index** (0..n_roots), from
/// the marker8 sequence in **placement-stream order**.
///
/// A file holds 1–4 ROOT SITES (depth-0 container nodes); their placements form
/// **root-contiguous blocks** in the stream. Each root owns a disjoint band of
/// marker8 values, but the bands neither reset nor sort cleanly across roots
/// (e.g. one root's bands {485, 521, 599, 917} with a tail value 917 sitting
/// above where the next root's first main value would, so a pure value-gap
/// split misroutes it). The reliable signal is STREAM POSITION + run
/// size:
///   * coalesce the stream into runs of equal marker8;
///   * a **root boundary** is a transition into a run that is BOTH a *permanent
///     up-shift* (every value from there on exceeds every value before — a new
///     base that never returns) AND *major* (`count ≥ MAJOR`, so small noise tails
///     like STRU's 917×4 are absorbed into the enclosing root, not promoted);
///   * take exactly the first `n_roots-1` such boundaries (in stream order). Roots
///     appear in stream order = DFS order, so a placement's root index lines up
///     with the leaf-roots' DFS index.
/// A single-root file produces no boundaries → all values map to root 0,
/// reproducing the single-root pipeline exactly.
fn marker8_to_root(stream: &[u32], n_roots: usize) -> std::collections::HashMap<u32, usize> {
    use std::collections::HashMap;
    let mut map = HashMap::new();
    if stream.is_empty() {
        return map;
    }
    if n_roots <= 1 {
        for &v in stream {
            map.entry(v).or_insert(0usize);
        }
        return map;
    }
    // Coalesce into runs (value, count) in stream order.
    let mut runs: Vec<(u32, usize)> = Vec::new();
    for &v in stream {
        match runs.last_mut() {
            Some((rv, c)) if *rv == v => *c += 1,
            _ => runs.push((v, 1)),
        }
    }
    // A run-start at index i (i>0) is a root boundary iff it is a permanent
    // up-shift (max value of runs[..i] < min value of runs[i..]) and major-sized.
    const MAJOR: usize = 10;
    let n = runs.len();
    let mut suffix_min = vec![u32::MAX; n + 1];
    for i in (0..n).rev() {
        suffix_min[i] = suffix_min[i + 1].min(runs[i].0);
    }
    let mut boundaries: Vec<usize> = Vec::new();
    let mut prefix_max = 0u32;
    for i in 0..n {
        if i > 0 && prefix_max < suffix_min[i] && runs[i].1 >= MAJOR {
            boundaries.push(i);
        }
        prefix_max = prefix_max.max(runs[i].0);
    }
    // Use the first n_roots-1 boundaries (stream order = DFS root order).
    boundaries.truncate(n_roots.saturating_sub(1));
    // Assign each run a root index by walking boundaries in stream order.
    let mut root = 0usize;
    let mut bi = 0usize;
    for (i, &(v, _)) in runs.iter().enumerate() {
        if bi < boundaries.len() && i == boundaries[bi] {
            root += 1;
            bi += 1;
        }
        map.entry(v).or_insert(root);
    }
    map
}

/// Per-root GLB structure (rvm2glb `--mode` contract).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OutputMode {
    /// One mesh per colour with `draw_ranges_nodeK` + `id_hierarchy` scene
    /// extras (`web3dversion: 2`) — smallest, viewer-selectable per element.
    Merged,
    /// Plain glTF: one mesh per placed part, nested under the decoded
    /// scene-graph node tree of that root.
    Standard,
}

/// Feet → metres: Navisworks' Revit loader keeps Revit's internal length unit.
pub const FEET_TO_METRES: f32 = 0.3048;

/// How the stored geometry is brought to metres. NWD files carry no unit
/// factor the converter can rely on; the unit follows the LOADER that wrote
/// the file (RVM / PDMS: metres, Revit: feet).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub enum UnitScale {
    /// [`FEET_TO_METRES`] when the file was written by the Revit loader (every
    /// plugin slot of the file names a Revit plugin — see
    /// [`crate::inspect::loaders`]), otherwise `1.0`: RVM-loader files are
    /// metres already, and the unit of DWG / 3DS-loader files is not known,
    /// so those — and files naming several different loaders — are left as
    /// stored.
    #[default]
    Auto,
    /// An explicit factor, model units → metres (`1.0` = as stored). A value
    /// that is not a positive finite number is ignored (as stored).
    Factor(f32),
}

impl UnitScale {
    fn factor(self, loaders: crate::inspect::Loaders) -> f32 {
        match self {
            UnitScale::Auto if loaders.revit_only() => FEET_TO_METRES,
            UnitScale::Auto => 1.0,
            UnitScale::Factor(f) if f.is_finite() && f > 0.0 => f,
            UnitScale::Factor(_) => 1.0,
        }
    }
}

/// Conversion options — mirrors the rvm2glb CLI contract.
///
/// Lengths (`line_width`, the `cleanup_precision` grid) are in OUTPUT units,
/// i.e. metres after [`ConvertOptions::unit_scale`]: the geometry is scaled
/// first and welded after, so a Revit file (feet) welds on the same 1 mm grid
/// as any other.
#[derive(Clone, Debug)]
pub struct ConvertOptions {
    /// Per-root GLB structure: merged (default) or standard.
    pub mode: OutputMode,
    /// Include Line primitives (construction/datum layer), rendered as "+"
    /// crosses. Off by default (rvm2glb parity).
    pub include_line: bool,
    /// Width (output units = metres) of the line "+" crosses.
    pub line_width: f32,
    /// Emit per-vertex NORMAL accessors (area-weighted smooth normals).
    /// Off by default — viewers regenerate flat normals from positions.
    pub include_normals: bool,
    /// Weld coincident vertex positions per mesh.
    pub cleanup_position: bool,
    /// Decimal places for the vertex-weld grid, in output units (default 3 =
    /// 1 mm; a triangle whose corners share a grid cell is dropped, so 2
    /// visibly eats small parts).
    pub cleanup_precision: u8,
    /// meshopt simplification threshold (fraction of indices to keep;
    /// 1.0 = no simplification). Requires the `optimize` feature.
    pub meshopt_threshold: f32,
    /// meshopt simplification error budget.
    pub meshopt_target_error: f32,
    /// Debug: colour every placed primitive distinctly.
    pub part_colors: bool,
    /// Unit factor for everything positional in the output (vertices,
    /// placements, the report / status-file bounds). Default: automatic.
    pub unit_scale: UnitScale,
}

impl Default for ConvertOptions {
    fn default() -> Self {
        ConvertOptions {
            mode: OutputMode::Merged,
            include_line: false,
            line_width: 0.005,
            include_normals: false,
            cleanup_position: true,
            cleanup_precision: 3,
            meshopt_threshold: 0.75,
            meshopt_target_error: 0.0,
            part_colors: false,
            unit_scale: UnitScale::Auto,
        }
    }
}

impl ConvertOptions {
    /// Writer options, with the RESOLVED unit factor (see [`UnitScale`]).
    pub(crate) fn glb(&self, unit_scale: f32) -> crate::glb::GlbOptions {
        crate::glb::GlbOptions {
            include_normals: self.include_normals,
            cleanup_position: self.cleanup_position,
            cleanup_precision: self.cleanup_precision,
            meshopt_threshold: self.meshopt_threshold,
            meshopt_target_error: self.meshopt_target_error,
            unit_scale,
        }
    }
}

pub fn convert(bytes: &[u8], opts: &ConvertOptions) -> Result<(Vec<u8>, ConvertReport)> {
    let (glb, _outs, report) = convert_inner_sink(bytes, opts, false, "", None)?;
    Ok((glb, report))
}

/// `--split-merge` output: one MERGED GLB per root site (web3d contract —
/// one mesh per colour, `draw_ranges_nodeK` + `id_hierarchy` scene extras)
/// plus a `status_file.json`, mirroring rvm2glb's merged mode. Returns
/// `(file_name, bytes)` pairs; `status_file.json` is the last entry.
pub fn convert_files(
    bytes: &[u8],
    opts: &ConvertOptions,
    source_name: &str,
) -> Result<(Vec<(String, Vec<u8>)>, ConvertReport)> {
    let mut outs: Vec<(String, Vec<u8>)> = Vec::new();
    let report = convert_stream(bytes, opts, source_name, &mut |name, data| {
        outs.push((name.to_string(), data.to_vec()));
        Ok(())
    })?;
    Ok((outs, report))
}

/// Streaming conversion — the DEFAULT contract: one GLB per root site
/// (structure per `opts.mode`: merged or standard), then `status_file.json`
/// last. Each file is handed to `sink` as soon as it is built and freed
/// immediately — nothing accumulates in memory. This is the only way large
/// models fit: per-root GLBs of a multi-GB model must not be held all at
/// once.
pub fn convert_stream(
    bytes: &[u8],
    opts: &ConvertOptions,
    source_name: &str,
    sink: SplitSink<'_>,
) -> Result<ConvertReport> {
    let (_glb, _outs, report) = convert_inner_sink(bytes, opts, true, source_name, Some(sink))?;
    Ok(report)
}

/// Emit one root's GLB in the selected mode and hand it to the emitter.
/// Returns the root's world bbox (output units).
fn emit_root_model(
    em: &mut SplitEmitter<'_>,
    mode: OutputMode,
    gopts: &crate::glb::GlbOptions,
    root_name: &str,
    parts: &[MeshPart],
    items: &[(u32, usize)],
    hier: &[(u32, String, Option<u32>)],
) -> Result<([f32; 3], [f32; 3])> {
    match mode {
        OutputMode::Merged => {
            let (g, mn, mx) = crate::glb::write_glb_merged(parts, items, hier, gopts);
            mem_trace("  root-glb");
            em.model(root_name, g, mn, mx)?;
            Ok((mn, mx))
        }
        OutputMode::Standard => {
            // Plain glTF: one mesh per part, nested under the decoded tree.
            // Each part's ancestor path is rebuilt from the hier rows; the
            // writer reconstructs the node tree from those paths.
            use std::collections::HashMap;
            let by_id: HashMap<u32, (&str, Option<u32>)> = hier
                .iter()
                .map(|(id, n, p)| (*id, (n.as_str(), *p)))
                .collect();
            let chain_of = |mut id: u32| -> Vec<String> {
                let mut v = Vec::new();
                while let Some(&(n, p)) = by_id.get(&id) {
                    v.push(n.to_string());
                    match p {
                        Some(pp) => id = pp,
                        None => break,
                    }
                }
                v.reverse();
                v
            };
            let mut sub: Vec<MeshPart> = Vec::with_capacity(items.len());
            let mut mn = [f32::INFINITY; 3];
            let mut mx = [f32::NEG_INFINITY; 3];
            for &(eid, pi) in items {
                if parts[pi].indices.is_empty() {
                    continue;
                }
                let mut p = parts[pi].clone();
                let mut chain = chain_of(eid);
                if let Some(leaf) = chain.pop() {
                    if p.name.is_empty() {
                        p.name = leaf;
                    }
                }
                p.path = chain;
                for v in p.positions.points().iter() {
                    for k in 0..3 {
                        mn[k] = mn[k].min(v[k]);
                        mx[k] = mx[k].max(v[k]);
                    }
                }
                sub.push(p);
            }
            let g = crate::glb::write_glb(&sub, gopts);
            let (mn, mx) = gopts.scale_bbox(mn, mx);
            em.model(root_name, g, mn, mx)?;
            Ok((mn, mx))
        }
    }
}

/// Receives each `--split-merge` output file (name, bytes) as it is produced.
pub type SplitSink<'s> = &'s mut dyn FnMut(&str, &[u8]) -> Result<()>;

/// Per-model metadata + output routing for `--split-merge`. GLB bytes go to
/// the sink the moment each root is merged; only the status-file metadata
/// (name, md5, bbox) is retained.
struct SplitEmitter<'s> {
    sink: SplitSink<'s>,
    input_md5: String,
    source_name: String,
    /// Informational lines for the status file's `notes` array (not problems
    /// — those are `warnings`).
    notes: Vec<String>,
    model_json: Vec<serde_json::Value>,
    /// GLB checksums still being computed in the background:
    /// (index into `model_json`, the hashing thread).
    #[cfg(not(target_arch = "wasm32"))]
    pending: Vec<(usize, std::thread::JoinHandle<String>)>,
    /// Bytes of finished GLBs currently held by those threads.
    #[cfg(not(target_arch = "wasm32"))]
    pending_bytes: std::sync::Arc<std::sync::atomic::AtomicUsize>,
}

/// A finished GLB up to this size is checksummed on a background thread
/// while the next root is being built (MD5 is the one serial pass left per
/// GLB). The total held this way is capped at the same figure, so the
/// overlap costs at most this much extra memory; larger GLBs are hashed
/// before the next root starts.
#[cfg(not(target_arch = "wasm32"))]
const BACKGROUND_HASH_BYTES: usize = 64 << 20;

impl<'s> SplitEmitter<'s> {
    fn new(input_md5: &str, source_name: &str, notes: &[String], sink: SplitSink<'s>) -> Self {
        SplitEmitter {
            sink,
            input_md5: input_md5.to_string(),
            source_name: source_name.to_string(),
            notes: notes.to_vec(),
            model_json: Vec::new(),
            #[cfg(not(target_arch = "wasm32"))]
            pending: Vec::new(),
            #[cfg(not(target_arch = "wasm32"))]
            pending_bytes: Default::default(),
        }
    }

    /// Emit one per-root GLB (consumed and released here).
    fn model(&mut self, root_name: &str, g: Vec<u8>, mn: [f32; 3], mx: [f32; 3]) -> Result<()> {
        use serde_json::json;
        // Root names are not guaranteed unique (two levels / files of the
        // same name): never let a later root overwrite an earlier file.
        let base = sanitize_filename(root_name);
        let mut file_name = format!("{base}.glb");
        let mut k = 2;
        while self
            .model_json
            .iter()
            .any(|m| m["file_name"] == file_name.as_str())
        {
            file_name = format!("{base}_{k}.glb");
            k += 1;
        }
        #[cfg(not(target_arch = "wasm32"))]
        let glb_md5 = {
            use std::sync::atomic::Ordering;
            let len = g.len();
            if len <= BACKGROUND_HASH_BYTES
                && self.pending_bytes.load(Ordering::Relaxed) + len <= BACKGROUND_HASH_BYTES
            {
                (self.sink)(&file_name, &g)?;
                let held = self.pending_bytes.clone();
                held.fetch_add(len, Ordering::Relaxed);
                let h = std::thread::spawn(move || {
                    let m = format!("{:x}", md5::compute(&g));
                    drop(g);
                    held.fetch_sub(len, Ordering::Relaxed);
                    m
                });
                self.pending.push((self.model_json.len(), h));
                String::new() // filled in by `finish`
            } else {
                // Large GLB: checksum and sink (a file write in the CLI) side
                // by side, both done before the next root is built.
                let (m, sunk) = std::thread::scope(|sc| {
                    let h = sc.spawn(|| format!("{:x}", md5::compute(&g)));
                    let sunk = (self.sink)(&file_name, &g);
                    (h.join().expect("md5 thread"), sunk)
                });
                drop(g);
                sunk?;
                m
            }
        };
        #[cfg(target_arch = "wasm32")]
        let glb_md5 = {
            let m = format!("{:x}", md5::compute(&g));
            (self.sink)(&file_name, &g)?;
            drop(g);
            m
        };
        self.model_json.push(json!({
            "root_name": root_name,
            "source_file_name": self.source_name,
            "md5": self.input_md5,
            "glb_md5": glb_md5,
            "export_lvl": 1,
            "parent": [],
            "parent_hash": "",
            "file_name": file_name,
            "min_x": mn[0], "min_y": mn[1], "min_z": mn[2],
            "max_x": mx[0], "max_y": mx[1], "max_z": mx[2],
        }));
        Ok(())
    }

    /// Emit the trailing `status_file.json`. Its `notes` array (informational,
    /// e.g. the automatic unit rescale) is only present when there is a note,
    /// so the file is unchanged for every conversion without one.
    fn finish(&mut self, warnings: Vec<String>, text_strings: &[String]) -> Result<()> {
        use serde_json::json;
        #[cfg(not(target_arch = "wasm32"))]
        for (i, h) in self.pending.drain(..) {
            self.model_json[i]["glb_md5"] = json!(h.join().expect("md5 thread"));
        }
        // Header fields from the NWD metadata strings (chunk_04/Text chunks):
        // save date ("Fri Jun 19 09:01:05 2026"), user@host, source banner.
        const WEEKDAYS: [&str; 7] = ["Mon ", "Tue ", "Wed ", "Thu ", "Fri ", "Sat ", "Sun "];
        let looks_like_date =
            |s: &str| WEEKDAYS.iter().any(|w| s.starts_with(w)) && s.contains(':');
        let date = text_strings
            .iter()
            .find(|s| looks_like_date(s))
            .map(|s| {
                s.trim_end_matches(|c: char| c.is_ascii_alphabetic())
                    .trim()
                    .to_string()
            })
            .unwrap_or_default();
        let user = text_strings
            .iter()
            .find(|s| s.contains('@') && !s.contains('{'))
            .cloned()
            .unwrap_or_default();
        let info = text_strings
            .iter()
            .find(|s| s.contains("AVEVA") || s.contains("E3D"))
            .cloned()
            .unwrap_or_default();
        let mut doc = json!({
            "models": std::mem::take(&mut self.model_json),
            "warnings": warnings,
            "header": {
                "date": date,
                "encoding": "",
                "info": info,
                "note": "",
                "user": user,
                "version": 1,
            }
        });
        if !self.notes.is_empty() {
            doc["notes"] = json!(std::mem::take(&mut self.notes));
        }
        (self.sink)("status_file.json", &doc.to_string().into_bytes())
    }
}

/// File names of the MODELS listed in the XRefTable JSON chunk (an NWF's
/// referenced NWC/NWD/source files; textures and other assets skipped).
fn xref_models(container: &Container, infos: &[crate::inspect::ChunkInfo]) -> Vec<String> {
    const MODEL_EXT: [&str; 9] = [
        "nwc", "nwd", "nwf", "rvm", "rvt", "dwg", "ifc", "dgn", "3ds",
    ];
    let mut out = Vec::new();
    for i in infos.iter().filter(|i| i.kind == ChunkKind::Json) {
        let d = container.data(i.index);
        let Some(start) = d.iter().position(|&b| b == b'{') else {
            continue;
        };
        // The JSON is followed by non-JSON trailer bytes: read the first value only.
        let Some(Ok(v)) = serde_json::Deserializer::from_slice(&d[start..])
            .into_iter::<serde_json::Value>()
            .next()
        else {
            continue;
        };
        if v.get("Type").and_then(|t| t.as_str()) != Some("XRefTable") {
            continue;
        }
        for e in v
            .get("Table")
            .and_then(|t| t.as_array())
            .into_iter()
            .flatten()
        {
            let Some(p) = e.get("OriginalPath").and_then(|p| p.as_str()) else {
                continue;
            };
            let name = p.rsplit(['\\', '/']).next().unwrap_or(p).to_string();
            let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
            if MODEL_EXT.contains(&ext.as_str()) && !out.contains(&name) {
                out.push(name);
            }
        }
    }
    out
}

/// Date / User / Banner of the NWD's `PDMS File Comments` property block, in
/// that order; empty when absent. Looked up in (1) the `LcOaPartition`
/// metadata chunk — the NWD's own File node `[100][32][0][name]` with an
/// inline property set (single-RVM NWDs) — then (2) the first property chunk
/// (multi-file NWDs: the first appended file's File-node tab).
fn file_comment_strings(container: &Container, infos: &[crate::inspect::ChunkInfo]) -> Vec<String> {
    use crate::properties::{PropBlock, PropReader};
    let rd = |d: &[u8], o: usize| {
        d.get(o..o + 4)
            .map(|b| u32::from_le_bytes(b.try_into().unwrap()))
    };
    let pick = |b: PropBlock| -> Vec<String> {
        ["Date", "User", "Banner"]
            .iter()
            .filter_map(|k| b.props.iter().find(|p| p.0 == *k).map(|p| p.1.to_string()))
            .collect()
    };
    let first_comments = |data: &[u8], from: usize| -> Option<PropBlock> {
        let mut found = None;
        let _ = PropReader::new().feed(&data[from..], |b| {
            if found.is_none() && b.category == "PDMS File Comments" {
                found = Some(b);
            }
        });
        found
    };
    // (1) metadata chunk: small, starts with the File node record.
    for (i, ch) in container.chunks.iter().enumerate() {
        if !(16..=16_384).contains(&ch.inflated_len) {
            continue;
        }
        let d = container.data(i);
        if rd(&d, 0) != Some(100) || rd(&d, 4) != Some(32) || rd(&d, 8) != Some(0) {
            continue;
        }
        let set = (8..d.len().saturating_sub(12))
            .step_by(4)
            .find(|&o| rd(&d, o + 4) == Some(86) && rd(&d, o + 8) == Some(0xFFFF_FFFF));
        if let Some(b) = set.and_then(|o| first_comments(&d, o)) {
            return pick(b);
        }
    }
    // (2) first property chunk.
    let Some(hi) = infos.iter().find(|i| i.kind == ChunkKind::LogicalHierarchy) else {
        return Vec::new();
    };
    let n = crate::hierarchy::header_table(&container.data(hi.index)).len();
    crate::properties::find_chunks(container, hi.index, n)
        .first()
        .and_then(|&c| first_comments(&container.data(c), 0))
        .map(pick)
        .unwrap_or_default()
}

fn convert_inner_sink(
    bytes: &[u8],
    opts: &ConvertOptions,
    split_merge: bool,
    source_name: &str,
    mut sink: Option<SplitSink<'_>>,
) -> Result<(Vec<u8>, Vec<(String, Vec<u8>)>, ConvertReport)> {
    let include_lines = opts.include_line;
    let part_colors = opts.part_colors;
    mem_trace("start");
    // The input checksum (status file) is one serial pass over the file —
    // run it beside the container walk instead of in front of the output.
    #[cfg(not(target_arch = "wasm32"))]
    let (input_md5, container) = rayon::join(
        || {
            if split_merge {
                format!("{:x}", md5::compute(bytes))
            } else {
                String::new()
            }
        },
        || Container::parse(bytes),
    );
    #[cfg(target_arch = "wasm32")]
    let (input_md5, container) = (
        if split_merge {
            format!("{:x}", md5::compute(bytes))
        } else {
            String::new()
        },
        Container::parse(bytes),
    );
    let container = container?;
    mem_trace("container");
    // Geometry chain first: located AUTHORITATIVELY via the geometry
    // size-index chunk (robust across writers whose coordinate ranges defeat
    // the content heuristics). Those chunks — the byte bulk — are then never
    // inflated for classification or the placement scan.
    let geom_index = crate::inspect::geometry_chunks_by_index(&container);
    let infos = crate::inspect::classify_except(
        &container,
        geom_index
            .as_ref()
            .map_or(&[][..], |(idxs, _)| idxs.as_slice()),
    );
    mem_trace("classify");

    // ── Unit factor (model units → metres), resolved ONCE ───────────────────
    // Geometry is scaled where the writer materializes each part's points
    // (`glb::finalize_append`, in front of the weld); every bbox helper below
    // returns output units; and the one length OPTION that shapes geometry
    // before that point — the line-cross width — is divided by the factor
    // here, so it comes out at the requested width in metres. With a factor
    // of 1 all three are no-ops and the output bytes do not move.
    let unit_scale = opts.unit_scale.factor(
        infos
            .iter()
            .fold(Default::default(), |acc: crate::inspect::Loaders, i| {
                acc.merge(i.loaders)
            }),
    );
    let gopts = opts.glb(unit_scale);
    let line_width = opts.line_width / unit_scale;
    let notes: Vec<String> = if opts.unit_scale == UnitScale::Auto && unit_scale != 1.0 {
        vec![format!(
            "Revit export: geometry scaled from feet to metres (× {unit_scale})"
        )]
    } else {
        Vec::new()
    };

    // Full scene-graph tree (depth-first pre-order). `leaves` is the geometry
    // subset we align placed meshes against; `all_nodes` is emitted verbatim as
    // the GLB node hierarchy (containers + named leaves, with colours).
    // The hierarchy chunk is inflated once for both the node parse and its
    // header (below), then released.
    let hier_data: Option<Vec<u8>> = infos
        .iter()
        .find(|i| i.kind == ChunkKind::LogicalHierarchy)
        .map(|i| container.data(i.index));
    let all_nodes: Vec<crate::hierarchy::Node> = hier_data
        .as_deref()
        .map(crate::hierarchy::parse_nodes)
        .unwrap_or_default();

    // Printable strings from the Text/metadata chunks — source of the status
    // header fields (save date, user@host, source banner) in split-merge mode.
    // The exact values of the first `PDMS File Comments` property block (save
    // date, user@host, banner) come first, so the header heuristics in
    // `SplitEmitter::finish` pick them up verbatim; the printable-run scan of
    // the Text chunks is the fallback for files without a property stream.
    let text_strings: Vec<String> = if split_merge {
        let mut v = file_comment_strings(&container, &infos);
        v.extend(
            infos
                .iter()
                .filter(|i| i.kind == ChunkKind::Text)
                .flat_map(|i| crate::inspect::extract_strings(&container.data(i.index), 6, 200)),
        );
        v
    } else {
        Vec::new()
    };

    // Hierarchy chunk header: [flag u32][first_id u32][root_count u32].
    // group value G at marker+100 maps to hierarchy node id = G + hier_first_id.
    // Both tested files have first_id = 100; read defensively.
    let hier_first_id: u32 = hier_data
        .as_deref()
        .map(|d| crate::hierarchy::header(d).1)
        .unwrap_or(100);
    drop(hier_data);

    mem_trace("hierarchy");

    // ── Per-root split (m8split) ──────────────────────────────────────────────
    // A file holds 1–4 ROOT SITES = depth-0 container nodes. Each leaf belongs to
    // exactly one root (walk parent_id to depth 0). The placement stream is
    // root-contiguous, partitioned by marker8 (see `marker8_to_root`). Running the
    // leaf-alignment ONCE PER ROOT (root-leaves × root-placements) removes the
    // cross-root contamination of the single global capacity-DP — within a root it
    // then behaves exactly like that root's own single-root file.
    // `root_order`: depth-0 root ids in DFS order (their root-index = position).
    let root_order: Vec<u32> = all_nodes
        .iter()
        .filter(|n| n.depth == 0)
        .map(|n| n.id)
        .collect();
    let n_roots = root_order.len();
    let root_index: std::collections::HashMap<u32, usize> = root_order
        .iter()
        .enumerate()
        .map(|(i, &id)| (id, i))
        .collect();
    // Root index of every node (walk parent_id to the depth-0 node), resolved
    // once in DFS order: a node's parent precedes it, so each node just reads
    // its parent's answer. `node_idx` = node id -> index in `all_nodes`.
    let node_idx: std::collections::HashMap<u32, usize> = all_nodes
        .iter()
        .enumerate()
        .map(|(i, n)| (n.id, i))
        .collect();
    let root_of_idx: Vec<Option<usize>> = {
        let mut v: Vec<Option<usize>> = Vec::with_capacity(all_nodes.len());
        for (i, n) in all_nodes.iter().enumerate() {
            let r = match n.parent_id {
                None => root_index.get(&n.id).copied(),
                Some(p) => match node_idx.get(&p) {
                    Some(&pi) if pi < i => v[pi],
                    // parent listed later (never in a well-formed DFS stream):
                    // walk the chain explicitly.
                    Some(_) => {
                        let mut id = p;
                        loop {
                            match node_idx.get(&id).map(|&k| all_nodes[k].parent_id) {
                                Some(Some(pp)) => id = pp,
                                Some(None) => break root_index.get(&id).copied(),
                                None => break None,
                            }
                        }
                    }
                    None => None,
                },
            };
            v.push(r);
        }
        v
    };
    let root_of_node =
        |id: u32| -> Option<usize> { node_idx.get(&id).and_then(|&i| root_of_idx[i]) };

    // Geometry chunks: the size-index chain, falling back to the
    // Geometry-classified chunks.
    let geom_chunk_idxs: Vec<usize> = match &geom_index {
        Some((idxs, _)) => idxs.clone(),
        None => infos
            .iter()
            .filter(|i| i.kind == ChunkKind::Geometry && i.inflated_len > 4096)
            .map(|i| i.index)
            .collect(),
    };
    // Old container revision (lichunk-007, ~2013): records have a 5-word header
    // and an uncompressed corner array — walked by the index's record sizes.
    let old_format = container.signature.contains("lichunk-007");
    // `records` = the decoded mesh records in disk order; `geom_on_disk` maps a
    // fragment's `geom_record_idx` (marker+64, 1-based index into the FULL
    // on-disk record array: meshes + AUX slots) to its decoded mesh or its AUX
    // parametric primitive (what_we_know §38).
    let parse_geometry = || -> Result<(Vec<geometry::GeomRecord>, geometry::GeomIndex)> {
        Ok(match (&geom_index, old_format) {
            // Modern file with a size index: decode the stream a chunk group at a
            // time — it is never held inflated in one piece (hundreds of MB on
            // large models), and each record's exact bounds come from the index
            // (a mesh's codec tail then never runs into the AUX records after it).
            (Some((_, sizes)), false) => {
                let lens: Vec<usize> = geom_chunk_idxs
                    .iter()
                    .map(|&i| container.chunks[i].inflated_len)
                    .collect();
                geometry::parse_stream(&lens, |k| container.data(geom_chunk_idxs[k]), sizes)?
            }
            _ => {
                let mut geom_buf: Vec<u8> = Vec::with_capacity(
                    geom_chunk_idxs
                        .iter()
                        .map(|&i| container.chunks[i].inflated_len)
                        .sum(),
                );
                for &i in &geom_chunk_idxs {
                    geom_buf.extend_from_slice(&container.data(i));
                }
                let records = if old_format {
                    match &geom_index {
                        Some((_, sizes)) => geometry::parse_old(&geom_buf, sizes)?,
                        None => Vec::new(),
                    }
                } else {
                    geometry::parse(&geom_buf)?
                };
                let on_disk = geometry::GeomIndex::from_buffer(&geom_buf, &records);
                (records, on_disk)
            }
        })
    };

    // OLD-FORMAT early path: the lichunk-007 placement/hierarchy layers are not
    // decoded yet, and the corner arrays are commonly world-baked. Emit every
    // record directly at identity — full geometry, no names/instancing
    // (instanced models will overlap at origin until the old placement layer
    // is decoded).
    if old_format {
        let (records, _) = parse_geometry()?;
        let mut parts: Vec<MeshPart> = Vec::new();
        let mut triangles = 0usize;
        for rec in &records {
            let Some(tris) = &rec.decoded_tris else {
                continue;
            };
            if tris.is_empty() {
                continue;
            }
            triangles += tris.len() / 3;
            let positions: Vec<[f32; 3]> =
                rec.positions.iter().map(|p| [p[0], p[2], -p[1]]).collect();
            parts.push(MeshPart {
                name: format!("r{}", rec.offset),
                positions: positions.into(),
                indices: std::sync::Arc::new(tris.clone()),
                mode: glb::MODE_TRIANGLES,
                color: [0.62, 0.62, 0.66, 1.0],
                path: Vec::new(),
            });
        }
        let (bbox_min, bbox_max) = parts_bbox(&parts, &gopts);
        let placed = parts.len();
        let glb = if split_merge {
            Vec::new()
        } else {
            write_glb(&parts, &gopts)
        };
        if split_merge {
            let items: Vec<(u32, usize)> = (0..parts.len()).map(|pi| (0u32, pi)).collect();
            let hier = vec![(0u32, "model".to_string(), None)];
            let mut em = SplitEmitter::new(
                &input_md5,
                source_name,
                &notes,
                sink.as_deref_mut().unwrap(),
            );
            emit_root_model(&mut em, opts.mode, &gopts, "model", &parts, &items, &hier)?;
            em.finish(
                vec!["lichunk-007 input: hierarchy/placements not decoded; geometry emitted at identity".into()],
                &text_strings,
            )?;
        }
        let split_outs = Vec::new();
        return Ok((
            glb,
            split_outs,
            ConvertReport {
                geometries: records.len(),
                fragments: 0,
                placed,
                linked: 0,
                lines: 0,
                triangles,
                bbox_min,
                bbox_max,
                unit_scale,
            },
        ));
    }

    // ── Single placement-scan pass ───────────────────────────────────────────
    // Inflate each chunk ONCE and run BOTH placement probes on it: the interned
    // stream (3DS/DWG loaders) and the RVM fragment stream. Geometry chunks are
    // excluded authoritatively (they are known exactly from the size index and
    // are the byte bulk — inflating them here used to dominate large-model
    // conversion time). Ties keep the LAST maximal chunk (max_by_key parity
    // with the old two-pass scan).
    let geom_chunk_set: std::collections::HashSet<usize> =
        geom_chunk_idxs.iter().copied().collect();
    // Per-chunk result: (chunk index, interned placements, (chunk bytes, fragments)).
    type Scan = (
        usize,
        Option<Vec<fragments::InternedFrag>>,
        (Vec<u8>, Vec<fragments::Fragment>),
    );
    let scan_one = |ci: usize| -> Scan {
        let data = container.data(ci);
        let interned = fragments::interned_placements(&data);
        // `placements()` reads the clean type-93 local AABB (at marker+4 — for a
        // datum line that AABB *is* the line, encoding its axis); `parse()`
        // back-scans and yields a shifted/garbled AABB for those same records.
        // Make placements() authoritative and add only the parse-only fragments
        // (matrix-format rotated parts placements() can't see), deduped by offset
        // so each record is processed exactly once.
        let mut f = fragments::placements(&data);
        let seen: std::collections::HashSet<usize> = f.iter().map(|x| x.offset).collect();
        for fr in fragments::parse(&data).unwrap_or_default() {
            if !seen.contains(&fr.offset) {
                f.push(fr);
            }
        }
        (ci, interned, (data, f))
    };
    // Keep, per stream, the chunk with the MOST placements; ties go to the
    // later chunk (what a sequential `>=` scan in chunk order does).
    let merge = |a: Option<Scan>, b: Option<Scan>| -> Option<Scan> {
        let (a, b) = match (a, b) {
            (Some(a), Some(b)) => (a, b),
            (a, b) => return a.or(b),
        };
        let (lo, hi) = if a.0 < b.0 { (a, b) } else { (b, a) };
        let int_hi = match (&lo.1, &hi.1) {
            (Some(l), Some(h)) => h.len() >= l.len(),
            (None, _) => true,
            (Some(_), None) => false,
        };
        let frag_hi = hi.2 .1.len() >= lo.2 .1.len();
        Some((
            hi.0,
            if int_hi { hi.1 } else { lo.1 },
            if frag_hi { hi.2 } else { lo.2 },
        ))
    };
    let scan_chunks: Vec<usize> = (0..container.chunks.len())
        .filter(|ci| !geom_chunk_set.contains(ci))
        .collect();
    #[cfg(not(target_arch = "wasm32"))]
    let best: Option<Scan> = {
        use rayon::prelude::*;
        scan_chunks
            .par_iter()
            .fold(|| None, |acc, &ci| merge(acc, Some(scan_one(ci))))
            .reduce(|| None, merge)
    };
    #[cfg(target_arch = "wasm32")]
    let best: Option<Scan> = scan_chunks
        .iter()
        .fold(None, |acc, &ci| merge(acc, Some(scan_one(ci))));
    let (interned, frag_best) = match best {
        Some((_, i, f)) => (i, f),
        None => (None, (Vec::new(), Vec::new())),
    };
    let (frag_data, frags) = frag_best;
    mem_trace("placement-scan");
    // DIRECT LINK coverage, decided BEFORE any mesh is built: the fraction of
    // fragments whose group id resolves, as a 1-based DFS ordinal
    // (`nodes[g-1]`), to a geometry LEAF. Measured 100% on all 44 Huldra
    // area/discipline NWDs (full dataset, see
    // convertSamples/nwd/huldra/README.md) and validated leaf-by-leaf against
    // the Navisworks FBX export of the same model (docs/what_we_know_v1.md).
    // When it holds, the group id IS the fragment→leaf link and the heuristic
    // alignment machinery (and everything it needs: per-record coarse fits,
    // linker centroids, the fragment chunk bytes) is bypassed.
    let ordinal_coverage = {
        let hit = frags
            .iter()
            .filter(|f| {
                f.group
                    .and_then(|g| all_nodes.get((g as usize).wrapping_sub(1)))
                    .is_some_and(|n| n.geometry)
            })
            .count();
        if frags.is_empty() {
            0.0
        } else {
            hit as f64 / frags.len() as f64
        }
    };
    // Gate purely on the ordinal link's own coverage: the old extra trigger
    // "several roots but few marker8 bands" took files whose group ids do NOT
    // resolve (a partial tree) and then dropped every unrouted fragment.
    let composite_routing = n_roots >= 1 && ordinal_coverage >= 0.99;
    let direct = composite_routing && split_merge && sink.is_some();
    let mut frag_data = frag_data;
    if direct {
        // The legacy linker back-scans the fragment chunk; the direct path
        // never does — release it (tens of MB on plant models).
        frag_data = Vec::new();
    }
    // Geometry is decoded only now — after the placement scan and after the
    // fragment chunk has been released — so the two largest transients never
    // coexist.
    let (records, geom_on_disk) = parse_geometry()?;
    mem_trace("records-parsed");

    // ── INTERNED placement stream (3DS/DWG loaders) ─────────────────────────
    // When present, it is authoritative — instance every fragment by
    // `world = R(q)·(s·v) + t` (validated against a 3DS ground-truth pair:
    // 99.92% of triangles). RVM-loader files never carry this stream.
    if let Some(ifrags) = interned {
        // The scene tree, when the general node grammar parses the hierarchy
        // chunk completely AND the frames' group words resolve onto its
        // geometry leaves (group = 1-based ordinal in the instance-expanded
        // DFS order). Otherwise: one unnamed element, as before.
        let tree = scan_chunks
            .iter()
            .filter(|&&ci| container.chunks[ci].inflated_len >= 24)
            .find_map(|&ci| {
                let d = container.data(ci);
                crate::inspect::looks_like_hierarchy(&d)
                    .then(|| crate::hierarchy::parse_tree(&d))
                    .flatten()
            })
            .filter(|t| {
                let hit = ifrags
                    .iter()
                    .filter(|f| {
                        t.nodes
                            .get((f.group as usize).wrapping_sub(1))
                            .is_some_and(|n| n.geometry)
                    })
                    .count();
                hit * 100 >= ifrags.len() * 99
            });
        let nodes: &[crate::hierarchy::Node] = tree.as_ref().map_or(&[], |t| t.nodes.as_slice());
        // Root (depth-0 node) index of every node, in DFS order.
        let mut root_names: Vec<String> = Vec::new();
        let mut root_ids: Vec<u32> = Vec::new();
        let root_of: Vec<usize> = nodes
            .iter()
            .map(|n| {
                if n.depth == 0 {
                    root_names.push(n.display.clone());
                    root_ids.push(n.id);
                }
                root_names.len().saturating_sub(1)
            })
            .collect();
        let n_groups = root_names.len().max(1);
        // Shared prototypes: one decoded mesh per record, however many frames
        // place it (instanced families are the bulk of a building model).
        type Proto = (std::sync::Arc<Vec<[f32; 3]>>, std::sync::Arc<Vec<u32>>);
        let mut protos: Vec<Option<Proto>> = vec![None; records.len()];
        let mut flipped: std::collections::HashMap<usize, std::sync::Arc<Vec<u32>>> =
            std::collections::HashMap::new();
        let mut per_root: Vec<Vec<(u32, usize)>> = vec![Vec::new(); n_groups];
        let mut parts: Vec<MeshPart> = Vec::new();
        let mut triangles = 0usize;
        let mut lines = 0usize;
        let mut linked = 0usize;
        for (fi, fr) in ifrags.iter().enumerate() {
            let ri = fr.record_idx as usize - 1;
            let Some(rec) = records.get(ri) else { continue };
            let leaf = nodes
                .get((fr.group as usize).wrapping_sub(1))
                .filter(|n| n.geometry);
            let (eid, root) = match leaf {
                Some(n) => (n.id, root_of[fr.group as usize - 1]),
                None => (root_ids.first().copied().unwrap_or(0), 0),
            };
            linked += leaf.is_some() as usize;
            // The frame's own material; else the tree's (inherited) one.
            let color = match (fr.diffuse, leaf) {
                (Some(c), n) => [c[0], c[1], c[2], n.map_or(1.0, |n| n.opacity)],
                (None, Some(n)) => n
                    .color
                    .map_or([0.62, 0.62, 0.66, 1.0], |c| [c[0], c[1], c[2], n.opacity]),
                (None, None) => [0.62, 0.62, 0.66, 1.0],
            };
            let name = if tree.is_some() {
                String::new()
            } else {
                format!("i{fi}")
            };
            if rec.is_line() {
                // Lines are an opt-in layer here too (same gate as the RVM path).
                if !include_lines {
                    continue;
                }
                let place = |p: &[f32; 3]| glb::place_xf(p, &fr.quat, fr.scale, &fr.translation);
                let mut pos = Vec::new();
                let mut idx = Vec::new();
                for (a, b) in rec.segments() {
                    let (sp, si) = geometry::cross_mesh(place(&a), place(&b), line_width);
                    let base = pos.len() as u32;
                    pos.extend_from_slice(&sp);
                    idx.extend(si.iter().map(|k| k + base));
                }
                if !idx.is_empty() {
                    lines += 1;
                    triangles += idx.len() / 3;
                    per_root[root].push((eid, parts.len()));
                    parts.push(MeshPart {
                        name: if tree.is_some() {
                            String::new()
                        } else {
                            format!("i{fi}l")
                        },
                        positions: pos.into(),
                        indices: std::sync::Arc::new(idx),
                        mode: glb::MODE_TRIANGLES,
                        color,
                        path: Vec::new(),
                    });
                }
                continue;
            }
            let (proto, tris) = protos[ri]
                .get_or_insert_with(|| {
                    let (p, i, _clean) = rec.mesh_clean();
                    (std::sync::Arc::new(p), std::sync::Arc::new(i))
                })
                .clone();
            if tris.is_empty() {
                continue;
            }
            // A mirrored instance (negative determinant: s < 0) flips winding;
            // swap two indices per triangle to preserve outward orientation.
            let indices = if fr.scale < 0.0 {
                flipped
                    .entry(ri)
                    .or_insert_with(|| {
                        std::sync::Arc::new(
                            tris.chunks_exact(3)
                                .flat_map(|t| [t[1], t[0], t[2]])
                                .collect(),
                        )
                    })
                    .clone()
            } else {
                tris
            };
            triangles += indices.len() / 3;
            per_root[root].push((eid, parts.len()));
            parts.push(MeshPart {
                name,
                positions: glb::PartPositions::Placed {
                    proto,
                    q: fr.quat,
                    s: fr.scale,
                    t: fr.translation,
                },
                indices,
                mode: glb::MODE_TRIANGLES,
                color,
                path: Vec::new(),
            });
        }
        let (bbox_min, bbox_max) = parts_bbox(&parts, &gopts);
        let placed = parts.len();
        let glb = if split_merge {
            Vec::new()
        } else {
            write_glb(&parts, &gopts)
        };
        if split_merge {
            let mut em = SplitEmitter::new(
                &input_md5,
                source_name,
                &notes,
                sink.as_deref_mut().unwrap(),
            );
            if tree.is_some() {
                // One GLB per root, like the RVM path: the root's subtree as
                // `id_hierarchy`, each leaf's parts as its draw range.
                for (r, items) in per_root.iter_mut().enumerate() {
                    if items.is_empty() {
                        continue;
                    }
                    items.sort();
                    let mut hier: Vec<(u32, String, Option<u32>)> = nodes
                        .iter()
                        .zip(&root_of)
                        .filter(|&(_, &nr)| nr == r)
                        .map(|(n, _)| (n.id, n.display.clone(), n.parent_id))
                        .collect();
                    hier.sort_by_key(|h| h.0);
                    emit_root_model(
                        &mut em,
                        opts.mode,
                        &gopts,
                        &root_names[r],
                        &parts,
                        items,
                        &hier,
                    )?;
                }
                em.finish(Vec::new(), &text_strings)?;
            } else {
                let items: Vec<(u32, usize)> = (0..parts.len()).map(|pi| (0u32, pi)).collect();
                let hier = vec![(0u32, "model".to_string(), None)];
                emit_root_model(&mut em, opts.mode, &gopts, "model", &parts, &items, &hier)?;
                em.finish(
                    vec!["interned-placement input: the scene tree did not parse; parts are not named".into()],
                    &text_strings,
                )?;
            }
        }
        let split_outs = Vec::new();
        return Ok((
            glb,
            split_outs,
            ConvertReport {
                geometries: records.len(),
                fragments: ifrags.len(),
                placed,
                linked,
                lines,
                triangles,
                bbox_min,
                bbox_max,
                unit_scale,
            },
        ));
    }
    // Fragments: the chunk that yields the most placements (keep its bytes so we
    // can back-scan for each fragment's bbox).
    // `candidate_triples` (via parse) catches both record layouts — standard
    // type-93 records and the matrix-format ones (rotated parts, e.g. the CHS
    // tubes) whose translation isn't at the type-93 offset. The exact-duplicate
    // dedup below (keyed on placed centroid+shape) then keeps every distinct
    // instance while collapsing coincident reference records.

    if records.is_empty() {
        // A file can legitimately hold no geometry (Huldra's
        // HDA-ASB-HL_insuobst.nwd: File nodes only — Navisworks' own FBX export
        // of it is empty too). In split mode write an empty status file with a
        // warning instead of failing.
        if let (true, Some(sink)) = (split_merge, sink.as_deref_mut()) {
            let mut warnings = vec!["no geometry records in this file".to_string()];
            let refs = xref_models(&container, &infos);
            if !refs.is_empty() {
                warnings.push(format!(
                    "the file references external models (e.g. an NWF): {} — convert those instead",
                    refs.join(", ")
                ));
            }
            for w in &warnings {
                eprintln!("{w}");
            }
            let mut em = SplitEmitter::new(&input_md5, source_name, &notes, sink);
            em.finish(warnings, &text_strings)?;
            return Ok((
                Vec::new(),
                Vec::new(),
                ConvertReport {
                    geometries: 0,
                    fragments: frags.len(),
                    placed: 0,
                    linked: 0,
                    lines: 0,
                    triangles: 0,
                    bbox_min: [0.0; 3],
                    bbox_max: [0.0; 3],
                    unit_scale,
                },
            ));
        }
        return Err(Error::Decode("no geometry records decoded".into()));
    }

    // Each record's sorted bbox dims + triangulated local mesh (NWD geometry) +
    // the COARSE-mesh local centroid. The rendered `pos`/`idx` are the faithful
    // original-vertex reconstruction; the coarse centroid drives the linker's
    // position scoring so leaf alignment (and its anchors) is invariant to the
    // render path — only the rendered geometry changes, never the linker POSITION.
    // mesh_clean is the CPU bulk on large models (~80 s single-threaded for
    // ~160k records) — records are independent, so
    // reconstruct them in parallel on native targets (sequential on wasm).
    let mut records = records;
    let geom: Vec<(
        [f32; 3],
        std::sync::Arc<Vec<[f32; 3]>>,
        std::sync::Arc<Vec<u32>>,
        [f32; 3],
    )> = {
        // Direct path: MOVE each record's vertices + decoded triangles into the
        // shared prototype (no copy, no second resident mesh) and skip the
        // linker centroid — a coarse primitive FIT per record (PCA / torus LM)
        // that only the legacy alignment reads and that used to be most of the
        // conversion CPU.
        let build_direct = |r: &mut geometry::GeomRecord| {
            let (mn, mx) = r.bbox();
            let (pos, idx) = r.take_mesh_clean();
            (
                sorted_dims(&mn, &mx),
                std::sync::Arc::new(pos),
                std::sync::Arc::new(idx),
                [0.0f32; 3],
            )
        };
        let build = |r: &geometry::GeomRecord| {
            let (mn, mx) = r.bbox();
            let (pos, idx, _clean) = r.mesh_clean();
            (
                sorted_dims(&mn, &mx),
                std::sync::Arc::new(pos),
                std::sync::Arc::new(idx),
                r.linker_centroid(),
            )
        };
        #[cfg(not(target_arch = "wasm32"))]
        {
            use rayon::prelude::*;
            if direct {
                records.par_iter_mut().map(build_direct).collect()
            } else {
                records.par_iter().map(build).collect()
            }
        }
        #[cfg(target_arch = "wasm32")]
        {
            if direct {
                records.iter_mut().map(build_direct).collect()
            } else {
                records.iter().map(build).collect()
            }
        }
    };
    let records = records;

    mem_trace("geom+frags");
    let mut parts: Vec<MeshPart> = Vec::new();
    // One `Placed` per placed mesh (offset, dims, native centroid, parts index) —
    // fed to the leaf alignment once all placements are built. The native centroid
    // gives the linker a POSITION so it can score sibling-continuity. `line_parts`
    // flags the X-cross construction meshes so they align against Line leaves only
    // (a separate layer from the solids, so the dense line set can't perturb them).
    // marker8 partition id -> root index (DFS order). Built from EVERY fragment's
    // marker8 so it is available both for the per-root dedup key (below) and the
    // per-root leaf-alignment (later). Ascending marker8 bands map to roots in the
    // same DFS order the leaves split into → one shared root-index space.
    let m8_root: std::collections::HashMap<u32, usize> = {
        let vals: Vec<u32> = frags.iter().filter_map(|f| f.marker8).collect();
        marker8_to_root(&vals, n_roots.max(1))
    };
    // EXACT fragment-offset -> root index. Primary signal: the marker8 bands
    // (root-contiguous in RVM-loader files). But in COMPOSITE models (many
    // source RVMs merged into hundreds of roots) marker8 values
    // interleave through the whole stream and the band split finds nothing —
    // every placement lands in root 0, which both breaks the per-root
    // alignment and makes one giant GLB. There the per-fragment GROUP id is a
    // complete signal: group + hier_first_id = hierarchy node id; walk to its
    // depth-0 root. Only used when the band split failed, so the validated
    // RVM corpus routing is untouched.
    let frag_root_exact: std::collections::HashMap<usize, usize> = {
        let m8_distinct: std::collections::HashSet<usize> = m8_root.values().copied().collect();
        let use_group = composite_routing;
        let mut map = std::collections::HashMap::new();
        if use_group {
            // group = the node's 1-BASED DFS ORDINAL (every fragment of every
            // Huldra NWD resolves to a geometry LEAF, and the leaves match the
            // Navisworks FBX export — docs/what_we_know_v1.md; the old
            // "group + first_id = interned node id" reading is REFUTED: it
            // hits containers/material records and misattributes elements).
            for f in &frags {
                if let Some(r) = f
                    .group
                    .and_then(|g| all_nodes.get((g as usize).saturating_sub(1)))
                    .and_then(|n| root_of_node(n.id))
                {
                    map.insert(f.offset, r);
                }
            }
            eprintln!(
                "root routing via GROUP ids ({} of {} fragments resolved; marker8 bands gave {} of {} roots)",
                map.len(),
                frags.len(),
                m8_distinct.len(),
                n_roots
            );
        } else {
            for f in &frags {
                if let Some(r) = f.marker8.and_then(|m| m8_root.get(&m).copied()) {
                    map.insert(f.offset, r);
                }
            }
        }
        map
    };
    // Root index of a placement (for the per-root dedup key); -1 = unrouted.
    let placement_root =
        |off: usize| -> i32 { frag_root_exact.get(&off).map(|&r| r as i32).unwrap_or(-1) };

    // ── COMPOSITE fast path (--split-merge): true per-root pipeline ─────────
    // In a composite model the GROUP id IS the leaf link (node id = group +
    // see the ordinal rule above — complete on every file tested), so none
    // of the alignment machinery below is needed. Process ONE ROOT AT A TIME:
    // place its fragments, write its GLB through the sink, free everything —
    // only the shared geometry prototypes stay resident. This is both the
    // memory ceiling fix and the speed fix (no DP, no naming heuristics) —
    // rvm2glb-style direct links. RVM-loader files never take this path.
    if direct {
        use std::collections::HashMap;
        mem_trace("composite-start");
        let node_by_id: HashMap<u32, usize> = all_nodes
            .iter()
            .enumerate()
            .map(|(i, n)| (n.id, i))
            .collect();
        // node id -> root index, computed once (walk each node to depth 0).
        let mut per_root_nodes: Vec<Vec<usize>> = vec![Vec::new(); n_roots];
        for (i, n) in all_nodes.iter().enumerate() {
            if let Some(r) = root_of_node(n.id) {
                per_root_nodes[r].push(i);
            }
        }
        let mut per_root_frags: Vec<Vec<usize>> = vec![Vec::new(); n_roots];
        let mut unrouted = 0usize;
        for (fi, f) in frags.iter().enumerate() {
            match frag_root_exact.get(&f.offset) {
                Some(&r) => per_root_frags[r].push(fi),
                None => unrouted += 1,
            }
        }
        if unrouted > 0 {
            eprintln!("composite: {unrouted} unrouted fragment(s) skipped");
        }
        // Long-axis record index for the (rare) fragments without a read-out.
        let by_d2: Vec<(f32, usize)> = {
            let mut v: Vec<(f32, usize)> = geom
                .iter()
                .enumerate()
                .map(|(gi, g)| (g.0[2], gi))
                .collect();
            v.sort_by(|a, b| fcmp(a.0, b.0));
            v
        };
        let axis_ok = |g: f32, f: f32| -> bool { (g - f).abs() <= 0.01 + 0.02 * f.max(0.05) };
        let mut em = SplitEmitter::new(
            &input_md5,
            source_name,
            &notes,
            sink.as_deref_mut().unwrap(),
        );
        let (mut triangles, mut placed, mut linked, mut lines) = (0usize, 0usize, 0usize, 0usize);
        let mut gmin = [f32::INFINITY; 3];
        let mut gmax = [f32::NEG_INFINITY; 3];
        for r in 0..n_roots {
            let fids = &per_root_frags[r];
            if fids.is_empty() {
                continue;
            }
            let root_node = &all_nodes[node_by_id[&root_order[r]]];
            eprintln!(
                "root {}/{} '{}': {} fragments",
                r + 1,
                n_roots,
                root_node.display,
                fids.len()
            );
            let mut parts: Vec<MeshPart> = Vec::new();
            let mut items: Vec<(u32, usize)> = Vec::new();
            for &fi in fids {
                let fr = &frags[fi];
                let [tx, ty, tz] = fr.translation;
                // group = 1-based DFS node ordinal (see routing note above).
                let leaf = fr
                    .group
                    .and_then(|g| all_nodes.get((g as usize).saturating_sub(1)))
                    .filter(|n| n.geometry);
                let eid = leaf.map(|n| n.id).unwrap_or(root_node.id);
                let color = leaf
                    .and_then(|n| n.color.map(|c| [c[0], c[1], c[2], n.opacity]))
                    .unwrap_or([0.62, 0.62, 0.66, 1.0]);
                if leaf.is_some() {
                    linked += 1;
                }
                let mut gi: Option<usize> = fr
                    .geom_record_idx
                    .filter(|&i| i >= 1)
                    .and_then(|i| geom_on_disk.mesh(i as usize - 1));
                let aux: Option<geometry::AuxPrim> = fr
                    .geom_record_idx
                    .and_then(|i| (i >= 1).then(|| geom_on_disk.aux(i as usize - 1)).flatten());
                // No read-out: windowed exact shape match against the records.
                if gi.is_none() && aux.is_none() {
                    if let Some(bb) = fr.local_bbox {
                        let fdims = sorted_dims(&[bb[0], bb[1], bb[2]], &[bb[3], bb[4], bb[5]]);
                        let tol2 = 0.01 + 0.02 * fdims[2].max(0.05);
                        let lo = by_d2.partition_point(|&(d, _)| d < fdims[2] - tol2);
                        let mut best: Option<(f32, usize)> = None;
                        for &(_, g2) in by_d2[lo..]
                            .iter()
                            .take_while(|&&(d, _)| d <= fdims[2] + tol2)
                        {
                            let gd = &geom[g2].0;
                            if !(0..3).all(|k| axis_ok(gd[k], fdims[k])) {
                                continue;
                            }
                            let l1 = dims_dist(gd, &fdims);
                            if best.map_or(true, |(bl, bg)| l1 < bl || (l1 == bl && g2 < bg)) {
                                best = Some((l1, g2));
                            }
                        }
                        gi = best.map(|(_, g2)| g2);
                    }
                }
                if let Some(gi) = gi {
                    if records[gi].is_line() {
                        if include_lines {
                            let place = |p: &[f32; 3]| -> [f32; 3] {
                                let (wx, wy, wz) =
                                    (p[0] as f64 + tx, p[1] as f64 + ty, p[2] as f64 + tz);
                                [wx as f32, wz as f32, -(wy as f32)]
                            };
                            let mut pos = Vec::new();
                            let mut idx = Vec::new();
                            for (a, b) in records[gi].segments() {
                                let (sp, si) =
                                    geometry::cross_mesh(place(&a), place(&b), line_width);
                                let base = pos.len() as u32;
                                pos.extend_from_slice(&sp);
                                idx.extend(si.iter().map(|k| k + base));
                            }
                            if !idx.is_empty() {
                                lines += 1;
                                triangles += idx.len() / 3;
                                items.push((eid, parts.len()));
                                parts.push(MeshPart {
                                    name: String::new(),
                                    positions: pos.into(),
                                    indices: std::sync::Arc::new(idx),
                                    mode: glb::MODE_TRIANGLES,
                                    color: [0.80, 0.78, 0.42, 1.0],
                                    path: Vec::new(),
                                });
                            }
                        }
                        continue;
                    }
                    let (_, mp, mi, _) = &geom[gi];
                    if mi.is_empty() {
                        continue;
                    }
                    triangles += mi.len() / 3;
                    placed += 1;
                    items.push((eid, parts.len()));
                    parts.push(MeshPart {
                        name: String::new(),
                        positions: crate::glb::PartPositions::Instanced {
                            proto: mp.clone(),
                            t: [tx, ty, tz],
                        },
                        indices: mi.clone(),
                        mode: glb::MODE_TRIANGLES,
                        color,
                        path: Vec::new(),
                    });
                    continue;
                }
                if let Some(p) = aux {
                    if p.is_degenerate() {
                        continue; // no surface (r = 0 / zero frame) — Navisworks emits nothing
                    }
                    // Exact Navisworks tessellation (validated vs its FBX
                    // export): a disc is a flat 32-fan (normal u×v), a
                    // cylinder an OPEN 32-segment tube — its caps are separate
                    // disc fragments of the same leaf.
                    let ci = match p {
                        geometry::AuxPrim::Disc { .. } => aux_disc_idx(),
                        geometry::AuxPrim::Cyl { .. } => aux_tube_idx(),
                    };
                    triangles += ci.len() / 3;
                    placed += 1;
                    items.push((eid, parts.len()));
                    parts.push(MeshPart {
                        name: String::new(),
                        positions: crate::glb::PartPositions::Aux {
                            prim: p,
                            t: [tx, ty, tz],
                        },
                        indices: ci,
                        mode: glb::MODE_TRIANGLES,
                        color,
                        path: Vec::new(),
                    });
                    continue;
                }
                // Honest placeholder from the fragment's own AABB.
                let (mn, mx) = match fr.local_bbox {
                    Some(b) => ([b[0], b[1], b[2]], [b[3], b[4], b[5]]),
                    None => ([0.0; 3], [0.0; 3]),
                };
                let bi = box_idx();
                triangles += bi.len() / 3;
                placed += 1;
                items.push((eid, parts.len()));
                parts.push(MeshPart {
                    name: String::new(),
                    positions: crate::glb::PartPositions::Boxed {
                        mn,
                        mx,
                        th: 0.012,
                        t: [tx, ty, tz],
                    },
                    indices: bi,
                    mode: glb::MODE_TRIANGLES,
                    color,
                    path: Vec::new(),
                });
            }
            if items.iter().all(|&(_, pi)| parts[pi].indices.is_empty()) {
                continue;
            }
            let mut hier: Vec<(u32, String, Option<u32>)> = per_root_nodes[r]
                .iter()
                .map(|&i| {
                    let n = &all_nodes[i];
                    (
                        n.id,
                        n.display.clone(),
                        if n.id == root_node.id {
                            None
                        } else {
                            n.parent_id
                        },
                    )
                })
                .collect();
            items.sort();
            hier.sort_by_key(|h| h.0);
            hier.dedup_by_key(|h| h.0);
            mem_trace("  root-parts");
            let (mn, mx) = emit_root_model(
                &mut em,
                opts.mode,
                &gopts,
                &root_node.display,
                &parts,
                &items,
                &hier,
            )?;
            mem_trace("  root-emitted");
            for k in 0..3 {
                gmin[k] = gmin[k].min(mn[k]);
                gmax[k] = gmax[k].max(mx[k]);
            }
            // parts/items/hier drop here — nothing from this root is retained.
        }
        em.finish(Vec::new(), &text_strings)?;
        mem_trace("composite-done");
        return Ok((
            Vec::new(),
            Vec::new(),
            ConvertReport {
                geometries: geom.len(),
                fragments: frags.len(),
                placed,
                linked,
                lines,
                triangles,
                bbox_min: gmin,
                bbox_max: gmax,
                unit_scale,
            },
        ));
    }
    // Geometry leaves, for the legacy alignment below (the direct path above
    // never needs this copy).
    let leaves: Vec<crate::hierarchy::Node> =
        all_nodes.iter().filter(|n| n.geometry).cloned().collect();

    let mut placements: Vec<Placed> = Vec::new();
    // Dedup-collided SOLID placements (same rounded shape@2cm at the same spot@5cm
    // as an already-placed mesh). Historically these were dropped outright, which
    // is what collapsed 437 placements → ~223 meshes and starved whole branches of
    // their geometry (the "missing/small part" bug). We now EMIT them as meshes so
    // no geometry is dropped, but keep them OUT of `placements` — the leaf-alignment
    // DP is conditioned on the deduped solid set (adding the twins back demonstrably
    // shatters the click-test anchors), so we bind these extras in a separate
    // post-pass that can only ADD links, never move an anchor. `extra` carries
    // (part_index, native_centroid, dims) for that pass.
    let mut extra: Vec<(usize, [f64; 3], [f32; 3], Option<u32>)> = Vec::new();
    // Withheld `unlinked` bbox-cylinder parts (weld/elbow sub-discs): (part_index,
    // native_centroid, marker8). Attached to a bound leaf in their root by the
    // per-root co-primitive sweep so they're accounted for, never seen by the DP.
    let mut extra_unlinked: Vec<(usize, [f64; 3], Option<u32>)> = Vec::new();
    let mut line_parts: std::collections::HashSet<usize> = std::collections::HashSet::new();
    let mut placed = 0usize;
    // Geometry records actually consumed by a placement (marker+64 read-out or
    // bbox match). Drives the low-coverage identity-emission fallback below.
    let mut used_records: std::collections::HashSet<usize> = std::collections::HashSet::new();
    let mut triangles = 0usize;
    let mut lines = 0usize;
    // Placements that match NO geometry record confidently (best rel > 0.1) yet
    // are REAL placements: instead of silently dropping them (the old silent-drop
    // bug lost dozens per file), we emit each as an explicit placeholder box
    // built from the fragment's OWN local AABB (real extents, never an invented
    // primitive), or a tiny point marker when the AABB is degenerate (genuinely no
    // geometry). Counted for reporting; routed `unlinked` so the DP/anchors are
    // untouched and the per-root sweep still accounts for them.
    let mut placeholder_bbox = 0usize; // real own-AABB → box
    let mut placeholder_point = 0usize; // zero-extent → point marker
    let mut skipped_candidates = 0usize; // markerless, geometry-less, extent-less
                                         // Dedup only EXACT duplicate placements: some instances carry coincident
                                         // type-93 records (same shape at the same spot). We key on rounded
                                         // (position @5cm, shape @2cm) so genuinely distinct nearby instances — each
                                         // its own scene-graph leaf — are all kept (the old distance threshold merged
                                         // them, which capped coverage).
                                         // Keyed per-ROOT (7th element = placement's root index): the same rounded
                                         // shape@2cm + spot@5cm appearing in two DIFFERENT root sites is NOT a duplicate
                                         // — the sites overlap spatially (the bbox is not a splitter), so a global dedup
                                         // silently DROPS a STRU mesh that collides with a PIPE/PSUP one, starving STRU's
                                         // per-root alignment of meshes (this broke click-test anchors before the fix).
    let mut placed_keys: std::collections::HashSet<[i32; 7]> = std::collections::HashSet::new();
    // Long-axis index over the records for the shape-match fallback: the per-
    // axis gate requires |gdims[2] - fdims[2]| <= 0.01 + 0.02*max(fdims[2],0.05),
    // so only a narrow dims[2] window can ever be eligible. Scanning that window
    // instead of all records is exact-equivalent (selection is min (L1, gi),
    // order-independent) and turns an O(frags x records) crawl into log-time
    // lookups on large models.
    let by_long_axis: Vec<(f32, usize)> = {
        let mut v: Vec<(f32, usize)> = geom
            .iter()
            .enumerate()
            .map(|(gi, g)| (g.0[2], gi))
            .collect();
        v.sort_by(|a, b| fcmp(a.0, b.0));
        v
    };

    // Instance each fragment by matching a geometry record to it (closest sorted-
    // extents match over the back-scan candidate bboxes). Mesh records become
    // triangles; 2-vertex records become GLB line segments. Rotation is not yet
    // decoded (translation only); see docs/what_we_know_v1.md.
    for (fr_i, fr) in frags.iter().enumerate() {
        if fr_i > 0 && fr_i % 250_000 == 0 {
            eprintln!("placing fragments... {fr_i}/{}", frags.len());
        }
        let mut best: Option<(f32, usize)> = None;
        // ── EXACT fragment→geometry READ-OUT (marker+64) ────────────────────────
        // The fragment's `geom_record_idx` is a 1-based index into the FULL on-disk
        // record array (magic meshes + undecoded AUX slots). Resolve it through the
        // record map: if it lands on a decoded MAGIC record, render THAT record
        // directly (orientation already correct) — `best = Some((0.0, pi))`. If it
        // maps to AUX, is out of range, or absent, leave `best = None` and let the
        // EXISTING bbox/degenerate/cylinder match below run unchanged. (marker+60 is
        // a non-derivable shape hash and is NOT used; the parse output is NOT
        // reordered — `pi` is the record's own index in `records`/`geom`.)
        if let Some(idx1) = fr.geom_record_idx {
            if idx1 >= 1 {
                if let Some(pi) = geom_on_disk.mesh(idx1 as usize - 1) {
                    best = Some((0.0, pi));
                }
            }
        }
        // The type-93 record carries a reliable local AABB; fall back to the
        // back-scan only if it's somehow absent.
        let cands: Vec<[f32; 6]> = match fr.local_bbox {
            Some(bb) => vec![bb],
            None => fragments::candidate_bboxes(&frag_data, fr.offset),
        };
        // PER-AXIS SHAPE GATE (replaces the old single relative-sum threshold).
        //
        // The previous match scored each record by rel = L1(dims)/(1+Σdims) and
        // accepted the global minimum if rel<=0.1. Because that sum is dominated
        // by the long axis, a 2.14 m pipe with a WRONG 0.15 m diameter still
        // scored rel≈0.047 and was accepted — so a pipe element STOLE a 0.15-dia
        // 56-vert record (32 % diameter error) in one file, while in a leaner
        // file the same fragment found no record under 0.1 and fell through to
        // the correct parametric cylinder. Same element, two meshes.
        //
        // Fix: a record is ELIGIBLE only if EVERY sorted axis is within a small
        // per-axis tolerance (1 cm absolute + 2 % relative). This rejects the
        // 0.15-vs-0.22 steal outright. Among eligible records pick the
        // deterministic best — smallest L1 dim distance, tie-broken by smallest
        // record index `gi` (NOT first-seen iteration order, NOT a cross-fragment
        // competition) — so the choice is identical in every file regardless of
        // how many fragments compete. When NO record is eligible, leave
        // `best = None`: the degenerate path below (parametric cylinder / own
        // AABB) fires, never a nearest-but-wrong record.
        //
        // `best.0` is kept as a flag only: `0.0` ("<= 0.1") = a confident match,
        // `None` = no eligible record. The downstream `rel > 0.1` / `rel <= 0.1`
        // gates (degenerate / no_tess / confident) read this contract unchanged.
        let axis_ok = |g: f32, f: f32| -> bool { (g - f).abs() <= 0.01 + 0.02 * f.max(0.05) };
        // EXACT AUX read-out (marker+64 → variant 104/105 record): the stored
        // oriented disc/cylinder definition. When the fragment points at an AUX
        // record, that is the file's own geometry for it — AUTHORITATIVE. The
        // bbox shape match below must not run for these: it could steal a
        // coincidentally-sized tessellated record (e.g. a 2 mm plate record
        // stealing a FLANGE's flat disc → the "fin" artifact).
        let aux_prim: Option<geometry::AuxPrim> = fr
            .geom_record_idx
            .and_then(|i| (i >= 1).then(|| geom_on_disk.aux(i as usize - 1)).flatten());
        // Only run the bbox shape match when the marker+64 read-out did NOT resolve
        // to a decoded record or an AUX primitive (out of range / parse-only).
        if best.is_none() && aux_prim.is_none() {
            let mut best_l1 = f32::INFINITY;
            for bb in cands {
                let fdims = sorted_dims(&[bb[0], bb[1], bb[2]], &[bb[3], bb[4], bb[5]]);
                let tol2 = 0.01 + 0.02 * fdims[2].max(0.05);
                let lo = by_long_axis.partition_point(|&(d, _)| d < fdims[2] - tol2);
                for &(_, gi) in by_long_axis[lo..]
                    .iter()
                    .take_while(|&&(d, _)| d <= fdims[2] + tol2)
                {
                    let (gdims, _, _, _) = &geom[gi];
                    if !(0..3).all(|k| axis_ok(gdims[k], fdims[k])) {
                        continue;
                    }
                    let l1 = dims_dist(gdims, &fdims);
                    // smallest L1, ties → smallest record index (deterministic).
                    if l1 < best_l1 || (l1 == best_l1 && best.map_or(true, |(_, g)| gi < g)) {
                        best_l1 = l1;
                        best = Some((0.0, gi));
                    }
                }
            }
        }
        let [tx, ty, tz] = fr.translation;
        let place = |p: &[f32; 3]| {
            // world_native = local + translation; glTF (Y-up) = (x, z, -y).
            let (wx, wy, wz) = (p[0] as f64 + tx, p[1] as f64 + ty, p[2] as f64 + tz);
            [wx as f32, wz as f32, -(wy as f32)]
        };
        // ── Datum line: orient from the fragment's OWN axis-aligned bbox ─────────
        // A construction/datum line's fragment bbox collapses to a single axis, and
        // that axis IS the per-instance orientation. Matching by *sorted* dims erases
        // it — an X-line, Y-line and Z-line all sort to (0,0,L), so all three match
        // the same single-line record, render along one axis, overlap, and the dedup
        // folds them into one (the "3 datum lines not showing" bug). So when the
        // fragment bbox is a degenerate line we take the segment straight from its raw
        // corners, recovering the true axis with no rotation matrix. The dedup key
        // carries that axis so co-located X/Y/Z datums stay distinct.
        if include_lines {
            if let Some(bb) = fr.local_bbox {
                let ext = [bb[3] - bb[0], bb[4] - bb[1], bb[5] - bb[2]];
                let zeros = ext.iter().filter(|&&e| e < 0.006).count();
                let long = ext.iter().cloned().fold(0.0f32, f32::max);
                if zeros == 2 && long > 0.01 {
                    let wa = place(&[bb[0], bb[1], bb[2]]);
                    let wb = place(&[bb[3], bb[4], bb[5]]);
                    let (cpos, cidx) = geometry::cross_mesh(wa, wb, line_width);
                    if !cidx.is_empty() {
                        let cc = centroid(&cpos);
                        let cn = [cc[0] as f64, -(cc[2] as f64), cc[1] as f64];
                        let axis = if ext[0] >= ext[1] && ext[0] >= ext[2] {
                            1
                        } else if ext[1] >= ext[2] {
                            2
                        } else {
                            3
                        };
                        let key = [
                            (cc[0] / 0.05).round() as i32,
                            (cc[1] / 0.05).round() as i32,
                            (cc[2] / 0.05).round() as i32,
                            axis,
                            (long / 0.02).round() as i32,
                            999, // line tag: never collides with a solid's dims key
                            placement_root(fr.offset),
                        ];
                        if placed_keys.insert(key) {
                            lines += 1;
                            triangles += cidx.len() / 3;
                            let mut ld = [2.0 * line_width, 2.0 * line_width, long];
                            ld.sort_by(|a, b| fcmp(*a, *b));
                            line_parts.insert(parts.len());
                            placements.push(Placed {
                                offset: fr.offset,
                                dims: ld,
                                centroid: cn,
                                part: parts.len(),
                            });
                            parts.push(MeshPart {
                                name: format!("f{}l", fr.offset),
                                positions: cpos.into(),
                                indices: std::sync::Arc::new(cidx),
                                mode: glb::MODE_TRIANGLES,
                                color: [0.80, 0.78, 0.42, 1.0],
                                path: Vec::new(),
                            });
                        }
                        continue;
                    }
                }
            }
        }
        // Take a parametric cylinder only when this fragment's own bbox match is
        // absent or a degenerate line/sliver record — i.e. it is parametric-only
        // (a weld / attachment / pipe with no real tessellated geometry).
        let degenerate = best.map_or(true, |(rel, gi)| rel > 0.1 || geom[gi].0[1] < 0.02);
        // An AUX-targeted fragment renders from its exact stored params — never
        // from the fitted parametric cylinder.
        let cyl =
            fragments::cylinder_param(&frag_data, fr).filter(|_| degenerate && aux_prim.is_none());
        // A tiny solid that has no tessellated record AND no parametric-cylinder
        // match (its radius is below `cylinder_param`'s bound): a multi-primitive
        // weld/elbow sub-disc. Build it straight from its own AABB. Flagged
        // `unlinked` so it is emitted as a mesh node (counts for the oracle) but
        // is kept OUT of the leaf-alignment — the linker is conditioned on the
        // solid set, so injecting these tiny discs there could drift the anchors.
        let no_tess = best.map_or(true, |(rel, _)| rel > 0.1);
        // Mesh for the AUX primitive (computed above; authoritative when present).
        // Disc → a thin (1.2 cm, the codebase flat-thickness convention) cylinder
        // oriented along the disc normal `u × v`; Cyl → cap A at the local origin,
        // cap B at `origin`. Emitted `unlinked` (withheld from the DP) like every
        // parametric primitive, so linker anchors are unaffected.
        let aux_cp: Option<fragments::CylParam> = aux_prim.map(|p| match p {
            geometry::AuxPrim::Cyl { origin, r, .. } => fragments::CylParam {
                a: [0.0, 0.0, 0.0],
                b: origin,
                r,
            },
            geometry::AuxPrim::Disc { u, v, r } => {
                // disc normal = u × v; build a 1.2 cm-thick oriented disc.
                let n = [
                    u[1] * v[2] - u[2] * v[1],
                    u[2] * v[0] - u[0] * v[2],
                    u[0] * v[1] - u[1] * v[0],
                ];
                let l = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt().max(1e-9);
                let t = 0.006; // half of the 1.2 cm flat-thickness convention
                let h = [t * n[0] / l, t * n[1] / l, t * n[2] / l];
                fragments::CylParam {
                    a: [-h[0], -h[1], -h[2]],
                    b: h,
                    r,
                }
            }
        });
        let bbox_cyl = if cyl.is_none() && no_tess {
            aux_cp.or_else(|| fragments::bbox_cylinder(fr))
        } else {
            None
        };
        let mut unlinked = false;
        // `raw_local_c` = the matched record's RAW local centroid (mean of its
        // original vertices), if this is a tessellated-mesh placement. Used for the
        // linker's position so faithful reconstruction can't shift the leaf.
        let mut raw_local_c: Option<[f32; 3]> = None;
        // Mesh source: `Instanced` (a shared record prototype + translation —
        // the common case; nothing materialized until GLB write) or a small
        // generated Owned mesh (cylinder/box/point placeholders).
        enum Src {
            Inst(usize),               // geom index; proto @ fr.translation
            Cyl(fragments::CylParam),  // parametric cylinder, deferred
            Boxed([f32; 3], [f32; 3]), // placeholder AABB, deferred
        }
        let (mesh_src, mesh_idx, dims, is_cyl): (Src, std::sync::Arc<Vec<u32>>, [f32; 3], bool) =
            match cyl.or(bbox_cyl) {
                Some(cp) => {
                    unlinked = bbox_cyl.is_some();
                    let len = ((cp.b[0] - cp.a[0]).powi(2)
                        + (cp.b[1] - cp.a[1]).powi(2)
                        + (cp.b[2] - cp.a[2]).powi(2))
                    .sqrt();
                    let mut d = [2.0 * cp.r, 2.0 * cp.r, len];
                    d.sort_by(|a, b| fcmp(*a, *b));
                    (Src::Cyl(cp), cyl_idx(), d, true)
                }
                None => {
                    // A confident tessellated-record match (best rel <= 0.1) reuses
                    // that record's mesh. Otherwise (no `best`, or rel > 0.1) the
                    // placement has NO geometry record we can trust — but it is a
                    // REAL placement and must never be silently dropped (§28). Emit
                    // an explicit PLACEHOLDER from the fragment's own local AABB:
                    //   * real extents → a faithful box (the file's own size);
                    //   * degenerate/absent AABB → a tiny point marker.
                    // Marked `unlinked` so it is withheld from the DP (anchors/oracle
                    // unchanged) yet accounted for by the per-root co-primitive sweep.
                    let confident = best.filter(|&(rel, _)| rel <= 0.1);
                    match confident {
                        Some((_, gi)) => {
                            used_records.insert(gi);
                            let (gdims, _mp, mi, rc) = &geom[gi];
                            raw_local_c = Some(*rc);
                            (Src::Inst(gi), mi.clone(), *gdims, false)
                        }
                        None => {
                            unlinked = true;
                            let bb = fr.local_bbox;
                            let ext = bb.map(|b| {
                                [
                                    (b[3] - b[0]).abs(),
                                    (b[4] - b[1]).abs(),
                                    (b[5] - b[2]).abs(),
                                ]
                            });
                            let real = ext.map_or(false, |e| e.iter().any(|&x| x > 0.006));
                            // A heuristic back-scan candidate (no `[93]` marker
                            // → no marker8) with no geometry match and no extent
                            // is not a placement at all: in a Revit-loader file
                            // all six such candidates were junk triples that put
                            // "point markers" ~40 m away from the real model.
                            if !real && fr.marker8.is_none() {
                                skipped_candidates += 1;
                                continue;
                            }
                            let (mn, mx) = match bb {
                                Some(b) if real => ([b[0], b[1], b[2]], [b[3], b[4], b[5]]),
                                _ => ([0.0; 3], [0.0; 3]), // degenerate → point marker
                            };
                            // 1.2 cm visible thickness for any flat/degenerate axis.
                            if real {
                                placeholder_bbox += 1;
                            } else {
                                placeholder_point += 1;
                            }
                            let mut d = ext.unwrap_or([0.012; 3]);
                            for x in d.iter_mut() {
                                if *x < 0.012 {
                                    *x = 0.012;
                                }
                            }
                            d.sort_by(|a, b| fcmp(*a, *b));
                            (Src::Boxed(mn, mx), box_idx(), d, false)
                        }
                    }
                }
            };
        let positions: crate::glb::PartPositions = match &mesh_src {
            Src::Inst(gi) => crate::glb::PartPositions::Instanced {
                proto: geom[*gi].1.clone(),
                t: [tx, ty, tz],
            },
            Src::Cyl(cp) => crate::glb::PartPositions::Cyl {
                a: cp.a,
                b: cp.b,
                r: cp.r,
                t: [tx, ty, tz],
            },
            Src::Boxed(mn, mx) => crate::glb::PartPositions::Boxed {
                mn: *mn,
                mx: *mx,
                th: 0.012,
                t: [tx, ty, tz],
            },
        };
        // Linker position: prefer the RAW record centroid (invariant to the
        // reconstruction), placed into world; fall back to the emitted centroid for
        // parametric cylinders that have no record.
        let c = match raw_local_c {
            Some(rc) => place(&rc),
            None => centroid_pp(&positions),
        };
        // Native centroid (invert `place`: glTF (x, z, -y) → native (x, -z, y)).
        let c_native = [c[0] as f64, -(c[2] as f64), c[1] as f64];
        // Skip only an exact-duplicate placement (same shape at the same spot).
        let key = [
            (c[0] / 0.05).round() as i32,
            (c[1] / 0.05).round() as i32,
            (c[2] / 0.05).round() as i32,
            (dims[0] / 0.02).round() as i32,
            (dims[1] / 0.02).round() as i32,
            (dims[2] / 0.02).round() as i32,
            placement_root(fr.offset),
        ];
        let is_dup = !placed_keys.insert(key);

        // Name every mesh with its fragment's chunk-7 byte offset so a rendered
        // mesh is traceable back to its exact fragment record (for decoding the
        // node↔geometry pointer linkage). `c` = cylinder, `m` = matched mesh.
        if !mesh_idx.is_empty() {
            triangles += mesh_idx.len() / 3;
            placed += 1;
            // `c` = cylinder, `m` = matched record mesh, `b` = own-AABB placeholder
            // (no confident record match — an honest box from the file's extents).
            let suffix = if is_cyl {
                "c"
            } else if unlinked {
                "b"
            } else {
                "m"
            };
            let name = format!("f{}{}", fr.offset, suffix);
            // `unlinked` (a bbox-built weld/elbow sub-disc) is emitted as a mesh
            // but withheld from `placements`, so the leaf-alignment never sees it
            // and the anchors stay put. A dedup-collided duplicate is likewise
            // emitted (geometry survives) but withheld from the DP input; it is
            // bound to a still-unbound same-shape leaf in the post-pass below.
            if !unlinked && !is_dup {
                placements.push(Placed {
                    offset: fr.offset,
                    dims,
                    centroid: c_native,
                    part: parts.len(),
                });
            } else if !unlinked {
                // is_dup: dedup-collided co-primitive.
                extra.push((parts.len(), c_native, dims, fr.marker8));
            } else {
                // `unlinked` = a bbox-built weld/elbow sub-disc, withheld from the
                // DP so the anchors stay put. Route it through the same per-root
                // co-primitive sweep (outside the DP) so it is still ACCOUNTED FOR —
                // attached to its nearest bound leaf in its root — instead of left as
                // a bare f<offset> node. Tracked with its marker8 for root routing.
                extra_unlinked.push((parts.len(), c_native, fr.marker8));
            }
            if std::env::var_os("NWD_PART_TRACE").is_some() {
                eprintln!(
                    "PART {} {} dup={} aux={} dims={:?}",
                    parts.len(),
                    name,
                    is_dup,
                    aux_prim.is_some(),
                    dims
                );
            }
            parts.push(MeshPart {
                name,
                positions,
                indices: mesh_idx.clone(),
                mode: glb::MODE_TRIANGLES,
                color: [0.62, 0.62, 0.66, 1.0],
                path: Vec::new(),
            });
        } else if include_lines && positions.len() == 2 {
            // Construction line/datum → X-cross proxy (2 perpendicular quads), the
            // visible "construction layer". Distinct colour; intrinsic line dims
            // (two thin + length) feed the alignment so it binds to a Line leaf.
            let (cpos, cidx) = geometry::cross_mesh(positions.at(0), positions.at(1), line_width);
            if !cidx.is_empty() {
                lines += 1;
                triangles += cidx.len() / 3;
                let len = {
                    let d = positions.at(1);
                    let a = positions.at(0);
                    ((d[0] - a[0]).powi(2) + (d[1] - a[1]).powi(2) + (d[2] - a[2]).powi(2)).sqrt()
                };
                let mut ld = [2.0 * line_width, 2.0 * line_width, len];
                ld.sort_by(|a, b| fcmp(*a, *b));
                line_parts.insert(parts.len());
                placements.push(Placed {
                    offset: fr.offset,
                    dims: ld,
                    centroid: c_native,
                    part: parts.len(),
                });
                parts.push(MeshPart {
                    name: format!("f{}l", fr.offset),
                    positions: cpos.into(),
                    indices: std::sync::Arc::new(cidx),
                    mode: glb::MODE_TRIANGLES,
                    color: [0.80, 0.78, 0.42, 1.0],
                    path: Vec::new(),
                });
            }
        }
    }

    mem_trace("placement-loop");
    // ── Low-coverage fallback (non-RVM writers: DWG/LightWorks/2024 samples) ──
    // In those files the placement stream references only a tiny fraction of the
    // geometry records, but the record coordinates are WORLD-BAKED (verified:
    // gatehouse ~13 m building, 61/1410 records placed). Emit every unreferenced
    // record at identity as an unlinked part so the model is complete. Gated on
    // <20% record coverage so the RVM corpus (fully referenced, LOCAL prototype
    // records placed via fragments) never takes this path.
    if !records.is_empty() && used_records.len() * 5 < records.len() {
        let mut added = 0usize;
        for (gi, rec) in records.iter().enumerate() {
            if used_records.contains(&gi) || rec.is_line() {
                continue;
            }
            let (_, mp, mi, _) = &geom[gi];
            if mi.is_empty() {
                continue;
            }
            triangles += mi.len() / 3;
            parts.push(MeshPart {
                name: format!("r{}", rec.offset),
                positions: crate::glb::PartPositions::Instanced {
                    proto: mp.clone(),
                    t: [0.0; 3],
                },
                indices: mi.clone(),
                mode: glb::MODE_TRIANGLES,
                color: [0.62, 0.62, 0.66, 1.0],
                path: Vec::new(),
            });
            added += 1;
        }
        if added > 0 {
            placed += added;
            eprintln!(
                "low placement coverage ({} of {} records referenced): emitted {added} \
                 unreferenced records at identity (world-baked geometry)",
                used_records.len(),
                records.len()
            );
        }
    }

    // Link each placed mesh to its scene-graph leaf (name + colour) by the
    // shape-scored DFS-order alignment — run as TWO independent layers so the
    // dense construction set can't perturb the solid alignment (and vice versa):
    //   layer 0 = solid meshes ↔ non-Line leaves
    //   layer 1 = X-cross line meshes ↔ Line leaves
    // Matched meshes inherit the leaf's name (+ colour for solids; lines keep
    // their distinct construction colour). Unmatched keep their `f<offset>` name.
    let mut linked = 0usize;
    let mut node_mesh: std::collections::HashMap<u32, usize> = std::collections::HashMap::new();
    // (extra_part_index, owning_leaf_id): dedup-collided co-primitives attached to
    // an already-bound leaf — emitted under that leaf's node so no geometry is lost.
    let mut extra_owner: Vec<(usize, u32)> = Vec::new();
    // Direct group-value lookup: Fragment.offset -> Fragment.group.
    // Used for 1:1 roots' line parts (see line_pend_1to1 below).
    let frag_offset_to_group: std::collections::HashMap<usize, u32> = frags
        .iter()
        .filter_map(|f| f.group.map(|g| (f.offset, g)))
        .collect();
    // Root index for EVERY placement, by part index. A type-93 placement uses its
    // marker8→root; a matrix-format placement (marker8=None — e.g. rotated CHS
    // tubes) has no marker8, so it inherits the
    // root of the nearest type-93 placement by stream OFFSET (the stream is
    // root-contiguous, so an offset uniquely lands in one root's span). Without this
    // the marker8-less placements fall out of every root block and their leaves go
    // unbound — which is exactly what dropped a click-test anchor.
    let placement_root_idx: std::collections::HashMap<usize, usize> = {
        use std::collections::HashMap;
        // Offset -> root for the exactly-routed placements (the anchors of each span).
        let mut anchors: Vec<(usize, usize)> = placements
            .iter()
            .filter_map(|p| frag_root_exact.get(&p.offset).map(|&r| (p.offset, r)))
            .collect();
        anchors.sort_unstable_by_key(|&(o, _)| o);
        let mut map: HashMap<usize, usize> = HashMap::new();
        for p in &placements {
            let r = match frag_root_exact.get(&p.offset).copied() {
                Some(r) => r,
                None => {
                    // Nearest marker8 placement by offset.
                    match anchors.binary_search_by_key(&p.offset, |&(o, _)| o) {
                        Ok(i) => anchors[i].1,
                        Err(i) => {
                            let lo = if i > 0 { Some(anchors[i - 1]) } else { None };
                            let hi = anchors.get(i).copied();
                            match (lo, hi) {
                                (Some((lo_o, lo_r)), Some((hi_o, hi_r))) => {
                                    if p.offset - lo_o <= hi_o - p.offset {
                                        lo_r
                                    } else {
                                        hi_r
                                    }
                                }
                                (Some((_, r)), None) | (None, Some((_, r))) => r,
                                (None, None) => 0,
                            }
                        }
                    }
                }
            };
            map.insert(p.part, r);
        }
        map
    };

    mem_trace("pre-linking");
    // ── VERIFIED group-signal leaf attribution (the per-leaf grouping signal) ──────
    // Per root, `part -> global leaf id` from the GROUP runs (u32 at marker+100): the
    // maximal equal-group runs over a root's solid placements (offset order) map ONE
    // RUN PER GEOMETRY LEAF in DFS pre-order. This is the deterministic grouping that
    // REPLACES the nearest-neighbour relabel. A surplus run (more runs than a root's
    // leaves) maps to the sentinel `u32::MAX` (attributed at branch level, never a
    // wrong leaf); a placement with no group id is absent (DP/nearest fallback).
    //
    // `group_primary_roots` = roots whose grouping is MULTI-PRIMITIVE (at least one
    // group run owns ≥2 placements, e.g. INST/PIPE: a weld/elbow leaf owns 14
    // sub-discs). In those roots the group signal is the authoritative PRIMARY leaf
    // binding (it fixes the dense same-class drift the DP suffers). In a pure 1:1
    // root (STRU/PSUP — every run is a single placement) the run→DFS-leaf alignment
    // is brittle (deep container nesting) and the spatial DP is the proven anchor
    // (the click-test anchors live there), so we DEFER to the DP and use the group signal only as
    // the co-primitive grouping in the sweep — never overriding a confident binding.
    let (group_leaf_of, group_primary_roots): (
        std::collections::HashMap<usize, u32>,
        std::collections::HashSet<usize>,
    ) = {
        use std::collections::{HashMap, HashSet};
        let mut attr: HashMap<usize, u32> = HashMap::new();
        let mut multi: HashSet<usize> = HashSet::new();
        // Root of a fragment: marker8→root, else nearest type-93 by offset (same
        // rule as `placement_root_idx`, but keyed on the raw fragment offset so it
        // covers EVERY emitted solid part — placements, dedup co-primitives, and the
        // withheld bbox-cylinder weld/elbow sub-discs alike).
        let mut anchors: Vec<(usize, usize)> = frags
            .iter()
            .filter_map(|f| frag_root_exact.get(&f.offset).map(|&r| (f.offset, r)))
            .collect();
        anchors.sort_unstable_by_key(|&(o, _)| o);
        let root_of_offset = |off: usize, _m8: Option<u32>| -> Option<usize> {
            if let Some(&r) = frag_root_exact.get(&off) {
                return Some(r);
            }
            if anchors.is_empty() {
                return None;
            }
            match anchors.binary_search_by_key(&off, |&(o, _)| o) {
                Ok(i) => Some(anchors[i].1),
                Err(i) => {
                    let lo = if i > 0 { Some(anchors[i - 1]) } else { None };
                    let hi = anchors.get(i).copied();
                    match (lo, hi) {
                        (Some((lo_o, lo_r)), Some((hi_o, hi_r))) => {
                            Some(if off - lo_o <= hi_o - off { lo_r } else { hi_r })
                        }
                        (Some((_, r)), None) | (None, Some((_, r))) => Some(r),
                        (None, None) => None,
                    }
                }
            }
        };
        // The fragment offset embedded in each emitted SOLID part's name
        // (`f<offset>{m,c,b}`; `l` is the line layer, excluded). Built now, before
        // the binding loop renames parts to leaf names.
        // Includes the LINE-layer parts (`f<offset>l`): a multi-primitive weld disc
        // with a degenerate-line bbox renders as an X-cross proxy yet still belongs to
        // its ELBOW/BEND leaf by the group signal, so it must be attributable. The
        // solid emit/sweep skip line parts via `line_parts`; only the dedicated line
        // pass consumes their group attribution.
        let mut part_of_offset: HashMap<usize, usize> = HashMap::new();
        for (pi, p) in parts.iter().enumerate() {
            let bytes = p.name.as_bytes();
            if bytes.first() == Some(&b'f') {
                let digits: String = p.name[1..]
                    .chars()
                    .take_while(|c| c.is_ascii_digit())
                    .collect();
                if let Ok(off) = digits.parse::<usize>() {
                    part_of_offset.insert(off, pi);
                }
            }
        }
        let mut root_leaf_ids: HashMap<usize, Vec<u32>> = HashMap::new();
        for n in &leaves {
            if let Some(r) = root_of_node(n.id) {
                root_leaf_ids.entry(r).or_default().push(n.id);
            }
        }
        for (&r, leaf_ids) in &root_leaf_ids {
            // EVERY type-93 fragment of this root that has a group id, in stream
            // (offset) order — INCLUDING line/datum fragments that produced no solid
            // part. We must keep them in the run walk so the run index stays aligned
            // with the DFS leaf order (a line leaf owns its own group run); we simply
            // do not ATTRIBUTE a part for them (handled by the line layer). Dropping
            // them here would shift every later solid run by one leaf (an INST-root
            // mis-count in files that mix lines and solids).
            let mut fr_root: Vec<(usize, u32)> = frags
                .iter()
                .filter(|f| f.group.is_some())
                .filter(|f| root_of_offset(f.offset, f.marker8) == Some(r))
                .map(|f| (f.offset, f.group.unwrap()))
                .collect();
            fr_root.sort_unstable_by_key(|&(o, _)| o);
            let n_leaves = leaf_ids.len();
            let mut per_leaf: HashMap<u32, usize> = HashMap::new();
            // GROUP-AUTHORITATIVE map (replaces the drift-prone positional run
            // counter). The marker+100 group value is monotonic per root and each
            // distinct value names ONE geometry leaf in DFS pre-order. So build the
            // map by VALUE: the sorted distinct group values present in this root's
            // fragments, zipped index-aligned to the DFS leaf ids. A leading header
            // group (e.g. INST group 0, which precedes the geometry leaves and owns
            // no leaf) makes distinct.len() > n_leaves; drop the lowest surplus
            // values so the geometry-leaf-aligned tail zips exactly onto the leaves.
            // Keying on the VALUE (not a run ordinal) is robust to header runs and
            // gaps — the exact verified INST map: [5..15] -> FTUBE 1 .. FTUBE 5.
            let mut distinct: Vec<u32> = fr_root.iter().map(|&(_, g)| g).collect();
            distinct.sort_unstable();
            distinct.dedup();
            // The geometry-leaf group values form ONE CONTIGUOUS block (consecutive
            // integers) of length n_leaves: the verified INST root has distinct
            // [5..=15, 20] and the 11 leaves bind to the contiguous run [5..=15]
            // (the stray 20 is a non-geometry header/trailer group). So pick the
            // maximal consecutive-integer run whose length is exactly n_leaves and
            // zip it index-aligned to the DFS leaf ids. This keys on the group VALUE
            // (robust to leading/trailing non-geometry groups and to gaps elsewhere),
            // unlike the old positional run counter that drifted on any header run.
            let group_to_leaf: Option<HashMap<u32, u32>> = if n_leaves > 0 {
                // Find a window of n_leaves consecutive integers within `distinct`.
                let mut window: Option<&[u32]> = None;
                let mut start = 0usize;
                while start < distinct.len() {
                    let mut end = start;
                    while end + 1 < distinct.len() && distinct[end + 1] == distinct[end] + 1 {
                        end += 1;
                    }
                    let run = &distinct[start..=end];
                    if run.len() == n_leaves {
                        window = Some(run);
                        break;
                    }
                    start = end + 1;
                }
                window.map(|w| w.iter().copied().zip(leaf_ids.iter().copied()).collect())
            } else {
                None
            };
            if let Some(map) = group_to_leaf {
                // Authoritative path: leaf is the map entry for the group VALUE;
                // header / surplus groups with no leaf entry -> sentinel u32::MAX.
                for (off, g) in &fr_root {
                    let leaf_id = map.get(g).copied().unwrap_or(u32::MAX);
                    if leaf_id != u32::MAX {
                        *per_leaf.entry(leaf_id).or_default() += 1;
                    }
                    if let Some(&pi) = part_of_offset.get(off) {
                        attr.insert(pi, leaf_id);
                    }
                }
            } else {
                // Fallback (root shape not the clean multi-primitive zip): the
                // original positional run walk; run index = leaf index (DFS order),
                // surplus runs (run >= n_leaves) -> sentinel u32::MAX.
                let mut run_idx = 0usize;
                let mut prev: Option<u32> = None;
                for (off, g) in fr_root {
                    match prev {
                        Some(pg) if pg == g => {}
                        _ => {
                            if prev.is_some() {
                                run_idx += 1;
                            }
                            prev = Some(g);
                        }
                    }
                    let leaf_id = if run_idx < n_leaves {
                        let id = leaf_ids[run_idx];
                        *per_leaf.entry(id).or_default() += 1;
                        id
                    } else {
                        u32::MAX
                    };
                    if let Some(&pi) = part_of_offset.get(&off) {
                        attr.insert(pi, leaf_id);
                    }
                }
            }
            if per_leaf.values().any(|&c| c >= 2) {
                multi.insert(r);
            }
        }
        (attr, multi)
    };
    if std::env::var_os("NWD_LINK_TRACE").is_some() {
        let mut items: Vec<_> = group_leaf_of.iter().collect();
        items.sort();
        for (pi, lid) in items {
            let nm = leaves
                .iter()
                .find(|n| n.id == *lid)
                .map(|n| n.display.as_str())
                .unwrap_or("<sentinel>");
            eprintln!("GROUPATTR part={pi} leaf={lid} ({nm})");
        }
    }

    if !leaves.is_empty() && !placements.is_empty() {
        for line_layer in [false, true] {
            // For the line (Approach A) layer, feed only the SHORT X-cross meshes:
            // a GENSEC datum marker is a small cross (~0.1 m), whereas the bare
            // unnamed construction "Line"s are long spans (~2 m). The long lines
            // carry no oracle name anyway, and they interleave with the datum runs
            // in offset order — dropping them by length (an intrinsic bbox signal)
            // is what makes the datum meshes' offset order line up with the cluster
            // DFS order, so the cluster alignment lands each datum on its GENSEC.
            // A GENSEC datum X-cross is a small marker (~0.1 m); 0.3 m keeps those
            // while discarding the long bare construction lines.
            const LINE_MAX_LEN: f32 = 0.3;
            let mut ms: Vec<Placed> = placements
                .iter()
                .filter(|p| line_parts.contains(&p.part) == line_layer)
                .filter(|p| !line_layer || p.dims[2] <= LINE_MAX_LEN)
                .copied()
                .collect();
            ms.sort_by_key(|p| p.offset);
            // Solids align against ALL leaves (well-conditioned: fewer solid meshes
            // than total leaves → anchors stay put); X-cross lines align against
            // Line leaves only. The −10 incompatibility penalty means a solid mesh
            // can never positively match a Line leaf, so it skips past them rather
            // than mislabelling — no cross-class pollution, conditioning preserved.
            // The line layer aligns only the *named* construction lines (datum
            // branches whose display carries an owning assembly, e.g. "… of GENSEC
            // /…EXAMPLE1"). Generic, suffix-less "Line" leaves are unnamed in the
            // model and never appear in the scene under a useful name, so binding
            // them adds nothing and only pollutes the cluster partition; we drop
            // them. The solid layer keeps every leaf.
            let lv: Vec<crate::hierarchy::Node> = if line_layer {
                leaves
                    .iter()
                    .filter(|n| {
                        leaf_shape(&n.display) == Shape::Line && cluster_key(&n.display).is_some()
                    })
                    .cloned()
                    .collect()
            } else {
                leaves.clone()
            };
            if ms.is_empty() || lv.is_empty() {
                continue;
            }
            // The line layer uses branch/cluster anchoring (Approach A): uniform
            // shapes give the global DP nothing to discriminate on, so we pin each
            // GENSEC datum branch (cluster = its owning assembly, derived from the
            // leaf's own name) to its own contiguous run of co-located meshes. The
            // solid layer keeps the shape-scored capacity DP.
            let assignment = if line_layer {
                let cl: Vec<u32> = {
                    let mut keys: std::collections::HashMap<String, u32> =
                        std::collections::HashMap::new();
                    lv.iter()
                        .map(|n| {
                            let k = cluster_key(&n.display).unwrap_or_default();
                            let next = keys.len() as u32;
                            *keys.entry(k).or_insert(next)
                        })
                        .collect()
                };
                align_clustered_hybrid(&ms, &cl)
            } else if n_roots <= 1 {
                // Single root (or no hierarchy): the global solid alignment IS the
                // per-root alignment — run it once, exactly as the single-root files do.
                align_meshes_to_leaves(&ms, &lv)
            } else {
                // ── Per-root SOLID alignment (m8split) ───────────────────────────
                // Split solid leaves by their depth-0 root and solid meshes by their
                // marker8 partition's root, then run the EXISTING capacity-DP linker
                // independently per (root-leaves, root-meshes). This is the fix:
                // within each root the DP sees only that root's set, so its
                // skip/capacity decisions can't drift against a different root's
                // geometry. Leaf indices are mapped back to the global `lv` so the
                // emit loop below is unchanged; every root-mesh gets assigned.
                let mut assignment: std::collections::HashMap<usize, usize> =
                    std::collections::HashMap::new();
                for r in 0..n_roots {
                    eprintln!("linking root {}/{n_roots}", r + 1);
                    // Global leaf indices (into `lv`) for this root, in DFS order.
                    let root_lv_idx: Vec<usize> = lv
                        .iter()
                        .enumerate()
                        .filter(|(_, n)| root_of_node(n.id) == Some(r))
                        .map(|(i, _)| i)
                        .collect();
                    let root_lv: Vec<crate::hierarchy::Node> =
                        root_lv_idx.iter().map(|&i| lv[i].clone()).collect();
                    // This root's meshes, in offset order (already sorted in `ms`).
                    // Use the per-part root index so marker8-less (matrix-format)
                    // placements are routed by stream offset, not dropped.
                    let root_ms: Vec<Placed> = ms
                        .iter()
                        .filter(|p| placement_root_idx.get(&p.part).copied() == Some(r))
                        .copied()
                        .collect();
                    if root_lv.is_empty() || root_ms.is_empty() {
                        continue;
                    }
                    // `align_meshes_to_leaves` keys its result by `Placed.part`, which
                    // is the GLOBAL part index — so the returned part indices are
                    // already global. Only the leaf index is root-local; map it back.
                    for (part_idx, local_leaf) in align_meshes_to_leaves(&root_ms, &root_lv) {
                        assignment.insert(part_idx, root_lv_idx[local_leaf]);
                    }
                }
                assignment
            };
            // ── Group-signal PRIMARY binding (solid layer only) ───────────────────
            // For the solids, the VERIFIED group runs are the authoritative leaf
            // grouping. We choose each leaf's PRIMARY node mesh from its group run,
            // preferring the DP's bound mesh when it already falls inside that run
            // (so the confident DP anchors — all in the 1:1 STRU root, where a run is
            // a single placement — are kept EXACTLY), else the lowest-offset member
            // of the run. The remaining run members become co-primitives in the
            // sweep below. This replaces the DP's per-leaf primary in multi-primitive
            // roots (INST/PIPE), where shape+position drift mis-attributed dense
            // same-class clusters, while leaving the DP untouched where the group
            // signal is silent. Lines keep the Approach-A cluster assignment.
            if !line_layer {
                use std::collections::HashMap;
                // leaf id -> the DP-chosen primary part (if any).
                let dp_primary: HashMap<u32, usize> =
                    assignment.iter().map(|(&p, &lj)| (lv[lj].id, p)).collect();
                // Gather, per leaf id, all group-attributed solid parts of THIS layer
                // — but only in MULTI-PRIMITIVE roots (group_primary_roots). In a 1:1
                // root we keep the DP's proven primary (anchors) and let the sweep use
                // the group signal only for co-primitive grouping.
                let mut by_leaf: HashMap<u32, Vec<usize>> = HashMap::new();
                for p in &ms {
                    let in_group_root = placement_root_idx
                        .get(&p.part)
                        .map_or(false, |r| group_primary_roots.contains(r));
                    if !in_group_root {
                        continue;
                    }
                    if let Some(&lid) = group_leaf_of.get(&p.part) {
                        if lid != u32::MAX {
                            by_leaf.entry(lid).or_default().push(p.part);
                        }
                    }
                }
                // Leaf ids the group signal covers (their primary comes from group).
                let leaf_group_covered: std::collections::HashSet<u32> =
                    by_leaf.keys().copied().collect();
                // Group-signal primary for every leaf the runs cover (sorted for
                // deterministic emission). Compute these FIRST so the DP-emit pass
                // below can skip any part already claimed as a group primary — a
                // part must be the PRIMARY mesh of at most ONE leaf node, else it is
                // emitted under two nodes (the negative-DROP double-count bug).
                let mut by_leaf: Vec<(u32, Vec<usize>)> = by_leaf.into_iter().collect();
                by_leaf.sort_by_key(|(lid, _)| *lid);
                let mut group_primary_parts: std::collections::HashSet<usize> =
                    std::collections::HashSet::new();
                for (lid, mut members) in by_leaf {
                    members.sort_unstable();
                    let primary = dp_primary
                        .get(&lid)
                        .filter(|p| members.contains(p))
                        .copied()
                        .unwrap_or(members[0]);
                    if let Some(leaf) = lv.iter().find(|n| n.id == lid) {
                        parts[primary].name = leaf.display.clone();
                        if let Some(c) = leaf.color {
                            parts[primary].color = [c[0], c[1], c[2], leaf.opacity];
                        }
                        node_mesh.insert(lid, primary);
                        group_primary_parts.insert(primary);
                    }
                }
                // DP bindings for leaves the group signal does NOT cover (no group id
                // on any of their placements) — pure DP fallback. Skip any part that
                // is already a group primary (it belongs to its group leaf, not this
                // DP leaf) so no part is the primary of two nodes.
                for (&part_idx, &leaf_idx) in &assignment {
                    let leaf = &lv[leaf_idx];
                    if leaf_group_covered.contains(&leaf.id)
                        || group_primary_parts.contains(&part_idx)
                    {
                        continue;
                    }
                    parts[part_idx].name = leaf.display.clone();
                    if let Some(c) = leaf.color {
                        parts[part_idx].color = [c[0], c[1], c[2], leaf.opacity];
                    }
                    node_mesh.insert(leaf.id, part_idx);
                }
            } else {
                // `assignment` maps many parts -> one leaf (align_clustered
                // round-robins surplus datum lines — the 3 axis-lines + per-JLDATUM
                // duplicates — onto the same leaf). The first part for a leaf is its
                // node_mesh primary; every ADDITIONAL part of the SAME leaf is a
                // co-primitive of that leaf node (extra_owner), NOT an orphan. Without
                // this the surplus parts are NAMED but never added to node_mesh or
                // extra_owner, so assembly dumps them under "(unlinked)" with their
                // real display name. Sort for deterministic primary selection.
                let mut asg: Vec<(usize, usize)> = assignment.into_iter().collect();
                asg.sort_unstable();
                for (part_idx, leaf_idx) in asg {
                    // The marker+100 group is the READ-OUT link: if this part carries a
                    // group, the authoritative g+100 resolver (line_pend_1to1, below)
                    // names it to its TRUE node. Never let align_clustered's round-robin
                    // GUESS its leaf — that merged distinct parts onto one leaf (e.g.
                    // a 5-way "FIXING 1 of ... GENSEC" node no placement's group
                    // points at). Skip group-bearing parts here so they stay bare
                    // for the resolver; only group-LESS parts fall back to the cluster.
                    let nm = &parts[part_idx].name;
                    let has_group = nm.as_bytes().first() == Some(&b'f') && {
                        let d: String =
                            nm[1..].chars().take_while(|c| c.is_ascii_digit()).collect();
                        d.parse::<usize>()
                            .ok()
                            .map_or(false, |off| frag_offset_to_group.contains_key(&off))
                    };
                    if has_group {
                        continue;
                    }
                    let leaf = &lv[leaf_idx];
                    parts[part_idx].name = leaf.display.clone();
                    if node_mesh.contains_key(&leaf.id) {
                        if std::env::var_os("NWD_LINK_TRACE").is_some() {
                            eprintln!("LINK CLUSTER part={} owner={}", part_idx, leaf.id);
                        }
                        extra_owner.push((part_idx, leaf.id)); // co-primitive of this leaf
                    } else {
                        node_mesh.insert(leaf.id, part_idx); // first = primary
                    }
                }
            }
        }
        // Post-pass: re-attach the dedup-collided co-primitive meshes. The old
        // pipeline DROPPED these outright (the dedup `continue`), collapsing 437
        // placements → ~223 meshes and leaving multi-primitive branches visibly
        // incomplete. Investigation showed they are NOT starved sibling leaves but
        // additional PRIMITIVES of an already-bound leaf — PIPE/INST branches are
        // multi-fragment-per-leaf, so one FTUBE/BEND/ELBOW leaf owns several
        // coincident-rounded fragments. So we EMIT them (no geometry lost) and attach
        // each to its nearest bound leaf (its DP twin) as a co-primitive: same name +
        // colour, grouped under that leaf's node. This runs ENTIRELY outside the DP
        // (the linker input `placements` is unchanged), so the anchors and the
        // solid alignment are untouchable; it only completes the rendered geometry
        // and names it correctly.
        const EXTRA_RADIUS: f32 = 1.2; // m — a co-primitive sits within its leaf
                                       // Native centroid of each currently-bound leaf's mesh, keyed by leaf id.
        let mut bound_centroid: std::collections::HashMap<u32, [f64; 3]> =
            std::collections::HashMap::new();
        for (&lid, &pi) in node_mesh.iter() {
            let pc = centroid_pp(&parts[pi].positions);
            bound_centroid.insert(lid, [pc[0] as f64, -(pc[2] as f64), pc[1] as f64]);
        }
        // Sort extras by part index for determinism.
        let mut extras = extra.clone();
        extras.sort_by_key(|e| e.0);
        for (part_idx, c_native, dims, _m8) in extras {
            let _ = dims;
            // GROUP-AUTHORITATIVE GUARD: if this dedup co-primitive already carries a
            // valid group leaf in a multi-primitive (group_primary) root, do NOT let
            // the pure-spatial nearest-neighbour radius sweep claim it across a group
            // boundary. Route it (by marker8 -> root, the same rule the per-root sweep
            // uses) and skip — it then flows to the per-root sweep below, which names
            // it from group_leaf_of. This keeps FTUBE 1 at its 4-record group instead
            // of absorbing ELBOW 1's adjacent head records (group 6) by proximity.
            let in_group_root = _m8
                .and_then(|m| m8_root.get(&m).copied())
                .is_some_and(|r| group_primary_roots.contains(&r));
            let has_group_leaf = in_group_root
                && group_leaf_of
                    .get(&part_idx)
                    .is_some_and(|&l| l != u32::MAX && leaves.iter().any(|n| n.id == l));
            if has_group_leaf {
                continue;
            }
            // The dedup-collided meshes turned out to be additional PRIMITIVES of an
            // already-bound leaf (PIPE/INST branches are multi-fragment-per-leaf: an
            // FTUBE/BEND/ELBOW leaf owns several coincident-rounded fragments). They
            // are NOT starved sibling leaves — every leaf they sit on is already
            // bound — so the faithful action is to attach each extra to its nearest
            // bound leaf (its DP twin) as a co-primitive: same name + colour, grouped
            // under that leaf's node in the tree. This keeps all geometry (no drop)
            // and names it correctly, without inventing a leaf binding the model
            // doesn't have (which would corrupt the link metric).
            let twin = node_mesh
                .keys()
                .filter_map(|&lid| bound_centroid.get(&lid).map(|c| (lid, dist3(&c_native, c))))
                .min_by(|a, b| fcmp(a.1, b.1));
            let Some((twin_id, twin_d)) = twin else {
                continue;
            };
            if twin_d > EXTRA_RADIUS {
                continue; // no nearby owner — leave it as an (unlinked) f<offset> mesh
            }
            if let Some(leaf) = leaves.iter().find(|n| n.id == twin_id) {
                parts[part_idx].name = leaf.display.clone();
                if let Some(c) = leaf.color {
                    parts[part_idx].color = [c[0], c[1], c[2], leaf.opacity];
                }
                if std::env::var_os("NWD_LINK_TRACE").is_some() {
                    eprintln!("LINK DEDUP_SPATIAL part={} owner={}", part_idx, twin_id);
                }
                extra_owner.push((part_idx, twin_id));
            }
        }

        // ── Per-root sweep: ACCOUNT FOR EVERY PLACEMENT (m8split, step 5) ──────────
        // The capacity-DP deliberately SKIPS surplus solid meshes (a multi-primitive
        // leaf has more placements than leaves, and some geometry has no dedicated
        // leaf). Those skipped placements were left as bare `f<offset>` nodes — the
        // big unlinked count. Now that meshes are partitioned per ROOT, every solid
        // placement belongs to a known root whose leaves are all in this file, so we
        // can attach each still-unbound solid placement to its nearest DP-bound leaf
        // WITHIN ITS OWN ROOT as a co-primitive (same name + colour, grouped under
        // that leaf's node). This only ADDS co-primitive links — it never moves a
        // DP binding — so the anchors and per-root alignment are untouched; it
        // drives the `f<offset>` unlinked count toward zero (every placement
        // accounted for in its root). Construction-line meshes are excluded (they
        // belong to the Line layer / unnamed lines).
        //
        // Runs on ALL files (single- AND multi-root). For a single-root file every
        // leaf maps to root 0 and `marker8_to_root` sends every placement to root 0,
        // so the per-root structures default correctly. Gating this to multi-root was
        // a BUG: it left single-root files with unlinked multi-primitive solids —
        // e.g. the four parts of one `FTUBE 1 of BRANCH …` element. Sweeping every
        // file accounts for every
        // solid placement within its root, single-root included.
        if n_roots >= 1 {
            // Bound leaves grouped by root, with their mesh native centroid.
            let mut bound_by_root: std::collections::HashMap<usize, Vec<(u32, [f64; 3])>> =
                std::collections::HashMap::new();
            for (&lid, &pi) in node_mesh.iter() {
                if line_parts.contains(&pi) {
                    continue; // line-layer binding: not a solid co-primitive owner
                }
                let Some(r) = root_of_node(lid) else { continue };
                let pc = centroid_pp(&parts[pi].positions);
                bound_by_root
                    .entry(r)
                    .or_default()
                    .push((lid, [pc[0] as f64, -(pc[2] as f64), pc[1] as f64]));
            }
            // Part indices already linked (DP-bound or attached as co-primitives).
            let mut linked_parts: std::collections::HashSet<usize> =
                node_mesh.values().copied().collect();
            for &(pi, _) in &extra_owner {
                linked_parts.insert(pi);
            }
            // Every still-unbound SOLID placement, plus the withheld bbox-cylinder
            // weld/elbow sub-discs (`extra_unlinked`): (part, native_centroid, root).
            // Each is attached to the nearest bound leaf IN ITS OWN ROOT as a
            // co-primitive. Sorted by part index for determinism.
            let mut pend: Vec<(usize, [f64; 3], usize)> = Vec::new();
            for p in &placements {
                if line_parts.contains(&p.part) || linked_parts.contains(&p.part) {
                    continue;
                }
                if let Some(&r) = placement_root_idx.get(&p.part) {
                    pend.push((p.part, p.centroid, r));
                }
            }
            for &(pi, c_native, m8) in &extra_unlinked {
                if linked_parts.contains(&pi) {
                    continue;
                }
                if let Some(r) = m8.and_then(|m| m8_root.get(&m).copied()) {
                    pend.push((pi, c_native, r));
                }
            }
            // Dedup-collided co-primitives the radius pass couldn't reach (nearest
            // bound leaf > EXTRA_RADIUS): route by marker8 → root, attach within-root.
            for &(pi, c_native, _dims, m8) in &extra {
                if linked_parts.contains(&pi) {
                    continue;
                }
                if let Some(r) = m8.and_then(|m| m8_root.get(&m).copied()) {
                    pend.push((pi, c_native, r));
                }
            }
            pend.sort_by_key(|&(pi, _, _)| pi);
            for (pi, c_native, r) in pend {
                // Prefer the VERIFIED group-signal leaf: deterministic, replaces the
                // nearest-neighbour relabel that mis-attributed dense same-class
                // clusters. Falls back to the nearest bound leaf (branch-level) only
                // for surplus runs (sentinel u32::MAX) or placements with no group id.
                let in_group_root = group_primary_roots.contains(&r);
                let group_leaf: Option<u32> = in_group_root
                    .then(|| group_leaf_of.get(&pi).copied())
                    .flatten()
                    .and_then(|lid| {
                        (lid != u32::MAX && leaves.iter().any(|n| n.id == lid)).then_some(lid)
                    });
                let owner_id = match group_leaf {
                    Some(lid) => Some(lid),
                    None => {
                        // Branch-level / nearest-bound-leaf fallback.
                        bound_by_root
                            .get(&r)
                            .and_then(|cands| {
                                cands
                                    .iter()
                                    .map(|&(lid, c)| (lid, dist3(&c_native, &c)))
                                    .min_by(|a, b| fcmp(a.1, b.1))
                            })
                            .map(|(lid, _)| lid)
                    }
                };
                let Some(owner_id) = owner_id else { continue };
                if let Some(leaf) = leaves.iter().find(|n| n.id == owner_id) {
                    parts[pi].name = leaf.display.clone();
                    if let Some(c) = leaf.color {
                        parts[pi].color = [c[0], c[1], c[2], leaf.opacity];
                    }
                    if std::env::var_os("NWD_LINK_TRACE").is_some() {
                        eprintln!("LINK PERROOT_SWEEP part={} owner={}", pi, owner_id);
                    }
                    extra_owner.push((pi, owner_id));
                }
            }

            // ── Group-signal naming of LINE-layer parts in MULTI-PRIMITIVE roots ───
            // Some multi-primitive sub-parts (the weld discs of an INST/PIPE ELBOW)
            // have a degenerate-line local bbox and so render as construction X-cross
            // proxies (`f<offset>l`, line layer) rather than solid discs. The VERIFIED
            // group signal still attributes them to their ELBOW/BEND leaf. We name and
            // group those line parts under their group leaf (keeping their distinct
            // construction colour) so the leaf OWNS its weld run — the structural
            // ELBOW/weld-disc membership the brief checks. This is ADDITIVE: it only
            // names currently-unlinked `f<offset>l` parts, only in group_primary roots
            // (never STRU's datum lines — those stay on the Approach-A cluster layer),
            // so it cannot move an anchor or regress the line layer.
            let mut line_pend: Vec<usize> = parts
                .iter()
                .enumerate()
                .filter(|(pi, _)| line_parts.contains(pi))
                .filter(|(pi, _)| !linked_parts.contains(pi))
                .map(|(pi, _)| pi)
                .collect();
            line_pend.sort_unstable();
            for pi in line_pend {
                let Some(&r) = placement_root_idx.get(&pi) else {
                    continue;
                };
                if !group_primary_roots.contains(&r) {
                    continue;
                }
                let Some(&lid) = group_leaf_of.get(&pi) else {
                    continue;
                };
                if lid == u32::MAX {
                    continue;
                }
                if let Some(leaf) = leaves.iter().find(|n| n.id == lid) {
                    parts[pi].name = leaf.display.clone();
                    // Keep the construction colour so the layer still reads as lines.
                    if std::env::var_os("NWD_LINK_TRACE").is_some() {
                        eprintln!("LINK RESOLVER_LID part={} owner={}", pi, lid);
                    }
                    extra_owner.push((pi, lid));
                }
            }

            // ── Group-authoritative naming of LINE-layer parts in 1:1 roots (STRU/PSUP)
            // The marker+100 group G is the VERIFIED authority for which hierarchy node
            // a line-layer fragment belongs to: node_id = G + hier_first_id (DIRECT
            // lookup on the corpus this path was built for). Every group-bearing line part is named
            // to a REAL hierarchy node — never left bare — by this deterministic
            // resolver (no spatial / nearest-neighbour heuristic):
            //   1. node.geometry==true  -> name = node.display (the exact leaf the
            //      group points at: plate / CHS / Facet Group / AIDLINE / Line / DATUM).
            //      The old `if disp!="LINE" && !disp.contains("DATUM")` guard is GONE —
            //      it wrongly left solid-leaf fragments (thin plates whose 2-zeros bbox
            //      tripped the line heuristic) bare; the group is authoritative, so the
            //      leaf gets its exact element name. Colour is NOT overridden (the layer
            //      keeps the construction-line colour so it still reads as lines).
            //   2. node.geometry==false (container) -> resolve to a truthful node:
            //      a. exactly one geometry child  -> that child leaf (unless the child
            //         is the generic anonymous "Line", in which case PREFER the
            //         container name — "Line" is uninformative);
            //      b. zero OR >=2 geometry children -> the container itself (naming one
            //         of several children would be a fabricated guess; the container is
            //         the truthful node the group resolves to).
            // Net: every group-bearing bare f<off>l gets a real node name; only the
            // group-less placements (Fragment.group==None) fall through, handled below.
            {
                let id_to_node: std::collections::HashMap<u32, &crate::hierarchy::Node> =
                    all_nodes.iter().map(|n| (n.id, n)).collect();
                // (name, node_id) for the truthful target the group resolves to.
                let resolve_line_target = |node: &crate::hierarchy::Node| -> (String, u32) {
                    if node.geometry {
                        return (node.display.clone(), node.id);
                    }
                    let kids: Vec<&crate::hierarchy::Node> = all_nodes
                        .iter()
                        .filter(|n| n.parent_id == Some(node.id) && n.geometry)
                        .collect();
                    if kids.len() == 1 {
                        let child = kids[0];
                        if child.display.eq_ignore_ascii_case("Line") {
                            (node.display.clone(), node.id) // generic child: prefer container
                        } else {
                            (child.display.clone(), child.id)
                        }
                    } else {
                        // 0 or >=2 geometry children: the container is the truthful node.
                        (node.display.clone(), node.id)
                    }
                };
                let line_pend_1to1: Vec<usize> = parts
                    .iter()
                    .enumerate()
                    .filter(|(pi, _)| line_parts.contains(pi) && !linked_parts.contains(pi))
                    .map(|(pi, _)| pi)
                    .collect();
                for pi in line_pend_1to1 {
                    let Some(&r) = placement_root_idx.get(&pi) else {
                        continue;
                    };
                    if group_primary_roots.contains(&r) {
                        continue; // multi-primitive: handled by the block above
                    }
                    let name = parts[pi].name.clone();
                    let bytes = name.as_bytes();
                    if bytes.first() != Some(&b'f') {
                        continue;
                    }
                    let digits: String = name[1..]
                        .chars()
                        .take_while(|c| c.is_ascii_digit())
                        .collect();
                    let Ok(off) = digits.parse::<usize>() else {
                        continue;
                    };
                    // Category 3 (no group / no leaf signal): the fragment has no
                    // marker+100 group value, so no hierarchy node is authoritative.
                    // We DO know its root (marker8 / nearest-offset → root index r), so
                    // the truthful name is that root's branch node — never a fabricated
                    // leaf, never a spatial nearest-neighbour guess. Name it to the
                    // depth-0 root node for r.
                    let (target_name, target_id) = match frag_offset_to_group.get(&off) {
                        Some(&g) => {
                            let node_id = g + hier_first_id;
                            match id_to_node.get(&node_id) {
                                Some(&node) => resolve_line_target(node),
                                None => {
                                    // group resolves to a node absent from the hierarchy:
                                    // fall back to the root branch (truthful container).
                                    match root_order.get(r).and_then(|&rid| id_to_node.get(&rid)) {
                                        // A group-less part: we know its ROOT (marker8) but not
                                        // its leaf. Attach under the root, but NEVER name it the
                                        // bare root display — that produces mesh nodes identical to
                                        // the site node (a "site x5" duplicate-name bug). Mark it an
                                        // unresolved member so it is distinct and honest.
                                        // Relabel honestly by what the record IS (§36): a stride-116
                                        // PARTITION-HEADER (idA=0) is root→leaf-range METADATA, not an
                                        // element → "(partition marker)"; otherwise it is a real placement
                                        // in this root with no marker+100 group → "<root> · unlinked element".
                                        // Name-only; the part stays in the linker (anchors/oracle unchanged).
                                        Some(&rn) => (
                                            if fragments::is_partition_header(&frag_data, off) {
                                                "(partition marker)".to_string()
                                            } else {
                                                format!("{} · unlinked element", rn.display)
                                            },
                                            rn.id,
                                        ),
                                        None => continue,
                                    }
                                }
                            }
                        }
                        None => match root_order.get(r).and_then(|&rid| id_to_node.get(&rid)) {
                            // A group-less part: we know its ROOT (marker8) but not
                            // its leaf. Attach under the root, but NEVER name it the
                            // bare root display — that produces mesh nodes identical to
                            // the site node (a "site x5" duplicate-name bug). Mark it an
                            // unresolved member so it is distinct and honest.
                            // Relabel honestly by what the record IS (§36): a stride-116
                            // PARTITION-HEADER (idA=0) is root→leaf-range METADATA, not an
                            // element → "(partition marker)"; otherwise it is a real placement
                            // in this root with no marker+100 group → "<root> · unlinked element".
                            // Name-only; the part stays in the linker (anchors/oracle unchanged).
                            Some(&rn) => (
                                if fragments::is_partition_header(&frag_data, off) {
                                    "(partition marker)".to_string()
                                } else {
                                    format!("{} · unlinked element", rn.display)
                                },
                                rn.id,
                            ),
                            None => continue,
                        },
                    };
                    parts[pi].name = target_name;
                    // Keep construction colour — no leaf colour override.
                    if std::env::var_os("NWD_LINK_TRACE").is_some() {
                        eprintln!("LINK GROUP_RESOLVER part={} owner={}", pi, target_id);
                    }
                    extra_owner.push((pi, target_id));
                }
            }
        }

        linked = node_mesh.len();
    }

    // Colour fill: an unmatched solid mesh keeps the default grey, but diffuse colour
    // is **system-level** in the scene graph (a leaf inherits its container's colour),
    // so a grey mesh's correct colour ≈ its nearest linked neighbour's. Copy it. This
    // is colour-only — it never touches names/anchors/geometry — and removes the ~22 %
    // washed-out grey. Construction-line meshes keep their distinct colour.
    {
        const GREY: [f32; 4] = [0.62, 0.62, 0.66, 1.0];
        let cen = |p: &MeshPart| -> [f32; 3] {
            let n = p.positions.len().max(1) as f32;
            let mut c = [0.0f32; 3];
            for v in p.positions.points().iter() {
                for k in 0..3 {
                    c[k] += v[k];
                }
            }
            [c[0] / n, c[1] / n, c[2] / n]
        };
        let donors: Vec<([f32; 3], [f32; 4])> = (0..parts.len())
            .filter(|&i| !line_parts.contains(&i) && parts[i].color != GREY)
            .map(|i| (cen(&parts[i]), parts[i].color))
            .collect();
        if !donors.is_empty() {
            let mut fixes: Vec<(usize, [f32; 4])> = Vec::new();
            for i in 0..parts.len() {
                if line_parts.contains(&i) || parts[i].color != GREY {
                    continue;
                }
                let c = cen(&parts[i]);
                let best = donors
                    .iter()
                    .min_by(|a, b| {
                        let da = (a.0[0] - c[0]).powi(2)
                            + (a.0[1] - c[1]).powi(2)
                            + (a.0[2] - c[2]).powi(2);
                        let db = (b.0[0] - c[0]).powi(2)
                            + (b.0[1] - c[1]).powi(2)
                            + (b.0[2] - c[2]).powi(2);
                        fcmp(da, db)
                    })
                    .unwrap();
                fixes.push((i, best.1));
            }
            for (i, col) in fixes {
                parts[i].color = col;
            }
        }
    }

    // Fallback: if matching placed nothing, emit a box per fragment so output is
    // never empty (keeps the pipeline observable while matching is refined).
    if parts.is_empty() {
        for (fi, fr) in frags.iter().enumerate() {
            let t = fr.translation_glb();
            let h = 0.05f32;
            let (positions, indices) = box_mesh(
                [t[0] - h, t[1] - h, t[2] - h],
                [t[0] + h, t[1] + h, t[2] + h],
            );
            triangles += indices.len() / 3;
            parts.push(MeshPart {
                name: format!("fragment_{fi}"),
                positions: positions.into(),
                indices: std::sync::Arc::new(indices),
                mode: glb::MODE_TRIANGLES,
                color: [0.6, 0.6, 0.65, 1.0],
                path: Vec::new(),
            });
        }
    }

    // Debug view: give every placed primitive its own colour so multi-primitive
    // leaves (a weld's disc + 2 cylinders, a datum's 3 lines) are visually
    // separable. Overrides the semantic leaf colours.
    if part_colors {
        for (i, p) in parts.iter_mut().enumerate() {
            p.color = part_color(i);
        }
    }

    let (bbox_min, bbox_max) = parts_bbox(&parts, &gopts);
    // Emit the decoded scene-graph hierarchy as glTF nodes when we have it:
    // every NWD node becomes a glTF node (containers nest their children), each
    // linked mesh + its leaf colour attaches to its node, and any unlinked
    // geometry hangs under a trailing "(unlinked)" group so nothing is dropped.
    // Incremental debug (NWD_FIRST_LEAVES=K): emit ONLY the meshes linked to the
    // first K geometry leaves (DFS order), as a flat GLB each renamed to its leaf —
    // for leaf-by-leaf verification of the inferred linkage. Prints each binding.
    let split_outs: Vec<(String, Vec<u8>)> = Vec::new();
    let glb = if let Ok(fv) = std::env::var("NWD_FRAGS") {
        // Render ONLY the listed chunk-7 fragment offsets as raw facets (the matched
        // record's faithful mesh, no parametric fitting), each a distinct colour —
        // to eyeball a single leaf's multi-mesh group against a reference render.
        let want: std::collections::HashSet<usize> = fv
            .split(',')
            .filter_map(|s| s.trim().parse::<usize>().ok())
            .collect();
        let palette: [[f32; 4]; 8] = [
            [0.95, 0.85, 0.15, 1.0],
            [0.20, 0.70, 0.95, 1.0],
            [0.95, 0.35, 0.35, 1.0],
            [0.45, 0.90, 0.45, 1.0],
            [0.85, 0.45, 0.95, 1.0],
            [0.95, 0.60, 0.20, 1.0],
            [0.55, 0.55, 0.95, 1.0],
            [0.30, 0.85, 0.80, 1.0],
        ];
        if fv.trim() == "list" {
            let mut pls: Vec<&Placed> = placements.iter().collect();
            pls.sort_by_key(|p| p.offset);
            eprintln!(
                "-- NWD_FRAGS=list: {} placements (offset, native centroid, ext) --",
                pls.len()
            );
            for pl in pls {
                eprintln!(
                    "  f{:<6} pos=({:7.2},{:6.2},{:7.2}) ext=({:.3},{:.3},{:.3})",
                    pl.offset,
                    pl.centroid[0],
                    pl.centroid[1],
                    pl.centroid[2],
                    pl.dims[0],
                    pl.dims[1],
                    pl.dims[2]
                );
            }
            write_glb(&[], &gopts)
        } else {
            let mut sub: Vec<MeshPart> = Vec::new();
            eprintln!("-- NWD_FRAGS: {} fragment(s) as raw facets --", want.len());
            for pl in &placements {
                if !want.contains(&pl.offset) {
                    continue;
                }
                let mut p = parts[pl.part].clone();
                let (mut mn, mut mx) = ([f32::MAX; 3], [f32::MIN; 3]);
                for v in p.positions.points().iter() {
                    for a in 0..3 {
                        mn[a] = mn[a].min(v[a]);
                        mx[a] = mx[a].max(v[a]);
                    }
                }
                eprintln!(
                    "  frag {:5} -> tris={:4} verts={:4} ext=({:.3},{:.3},{:.3})",
                    pl.offset,
                    p.indices.len() / 3,
                    p.positions.len(),
                    mx[0] - mn[0],
                    mx[1] - mn[1],
                    mx[2] - mn[2]
                );
                p.color = palette[sub.len() % palette.len()];
                p.name = format!("f{}", pl.offset);
                sub.push(p);
            }
            write_glb(&sub, &gopts)
        }
    } else if let Ok(kv) = std::env::var("NWD_FIRST_LEAVES") {
        let k: usize = kv.parse().unwrap_or(1);
        let mut sub: Vec<MeshPart> = Vec::new();
        eprintln!("-- NWD_FIRST_LEAVES={k}: first {k} geometry leaves (DFS order) --");
        for (n, leaf) in leaves.iter().take(k).enumerate() {
            match node_mesh.get(&leaf.id) {
                Some(&pi) => {
                    let mut p = parts[pi].clone();
                    p.name = leaf.display.clone();
                    let c = centroid_pp(&p.positions);
                    let c_native = [c[0], -c[2], c[1]];
                    eprintln!(
                        "  [{n}] leaf {} '{}' -> tris={} native_pos=({:.2},{:.2},{:.2})",
                        leaf.id,
                        leaf.display,
                        p.indices.len() / 3,
                        c_native[0],
                        c_native[1],
                        c_native[2]
                    );
                    sub.push(p);
                }
                None => eprintln!("  [{n}] leaf {} '{}' -> (UNLINKED)", leaf.id, leaf.display),
            }
        }
        write_glb(&sub, &gopts)
    } else if all_nodes.is_empty() {
        if split_merge {
            // No hierarchy chunk: emit the whole model as a single merged root.
            let items: Vec<(u32, usize)> = (0..parts.len()).map(|pi| (0u32, pi)).collect();
            let hier = vec![(0u32, "model".to_string(), None)];
            let mut em = SplitEmitter::new(
                &input_md5,
                source_name,
                &notes,
                sink.as_deref_mut().unwrap(),
            );
            emit_root_model(&mut em, opts.mode, &gopts, "model", &parts, &items, &hier)?;
            em.finish(Vec::new(), &text_strings)?;
            Vec::new()
        } else {
            write_glb(&parts, &gopts)
        }
    } else {
        use crate::glb::{write_glb_tree, SceneNode};
        let mut id_to_idx: std::collections::HashMap<u32, usize> = std::collections::HashMap::new();
        for (i, n) in all_nodes.iter().enumerate() {
            id_to_idx.insert(n.id, i);
        }
        let mut tree: Vec<SceneNode> = all_nodes
            .iter()
            .map(|n| SceneNode {
                name: n.display.clone(),
                mesh: node_mesh.get(&n.id).copied(),
                children: Vec::new(),
            })
            .collect();
        let mut roots: Vec<usize> = Vec::new();
        for (i, n) in all_nodes.iter().enumerate() {
            match n.parent_id.and_then(|p| id_to_idx.get(&p).copied()) {
                Some(pi) => tree[pi].children.push(i),
                None => roots.push(i),
            }
        }
        let mut linked_set: std::collections::HashSet<usize> =
            node_mesh.values().copied().collect();
        // Attach each dedup-collided co-primitive as a child node of its owner leaf's
        // node (multi-primitive leaf → several mesh nodes), so the geometry renders
        // under the right branch and isn't swept into "(unlinked)".
        for &(part_idx, owner_id) in &extra_owner {
            if let Some(&oi) = id_to_idx.get(&owner_id) {
                // Stay true to the NWD hierarchy: attach the mesh directly to the
                // owner node when it is a geometry LEAF with no mesh yet; otherwise
                // add a child node (glTF allows one mesh per node), UNNAMED when its
                // part name would just repeat the owner's — no invented "Group"/
                // "Cylinder" wrapper labels. Containers/roots never take a mesh
                // themselves (a mesh-bearing root breaks the root-name guard).
                let owner_is_leaf = leaves.iter().any(|n| n.id == owner_id);
                if owner_is_leaf && tree[oi].mesh.is_none() {
                    tree[oi].mesh = Some(part_idx);
                } else {
                    let child_name = if parts[part_idx].name == tree[oi].name {
                        String::new()
                    } else {
                        parts[part_idx].name.clone()
                    };
                    let node = tree.len();
                    tree.push(SceneNode {
                        name: child_name,
                        mesh: Some(part_idx),
                        children: Vec::new(),
                    });
                    tree[oi].children.push(node);
                }
                linked_set.insert(part_idx);
            }
        }
        // ── Final co-primitive re-home (guarantees the (unlinked) guard) ───────────
        // The per-root sweep attaches every surplus solid to a bound leaf IN ITS OWN
        // ROOT, routed by marker8→root. A handful of `extra_unlinked` placeholder
        // discs (a FLANGE/weld sub-disc whose own-AABB box replaced a former record
        // match after the per-axis shape gate) can miss that routing — their marker8
        // resolves to no root with a bound leaf — and would land bare under
        // "(unlinked)". That is the orphan-parenting regression the accounted guard
        // catches. Re-home each still-unlinked SOLID part to its nearest bound leaf
        // GLOBALLY (spatial nearest over all bound leaves). This is purely additive —
        // it attaches a co-primitive, never moves a DP binding or an anchor — and
        // never touches line-layer parts (those have their own naming above). Result:
        // the disc renders under its real element (FLANGE …), guard stays 0.
        {
            let cen_native = |pi: usize| -> [f64; 3] {
                let c = centroid_pp(&parts[pi].positions);
                [c[0] as f64, -(c[2] as f64), c[1] as f64]
            };
            // Bound leaves with their native centroid (solid bindings only).
            let bound: Vec<(u32, [f64; 3])> = node_mesh
                .iter()
                .filter(|(_, &pi)| !line_parts.contains(&pi))
                .map(|(&lid, &pi)| (lid, cen_native(pi)))
                .collect();
            if !bound.is_empty() {
                let mut homes: Vec<(usize, u32)> = Vec::new();
                for pi in 0..parts.len() {
                    if linked_set.contains(&pi) || line_parts.contains(&pi) {
                        continue;
                    }
                    let c = cen_native(pi);
                    if let Some(&(lid, _)) = bound
                        .iter()
                        .min_by(|a, b| fcmp(dist3(&c, &a.1), dist3(&c, &b.1)))
                    {
                        homes.push((pi, lid));
                    }
                }
                homes.sort_by_key(|&(pi, _)| pi);
                for (pi, lid) in homes {
                    if let (Some(&oi), Some(leaf)) =
                        (id_to_idx.get(&lid), leaves.iter().find(|n| n.id == lid))
                    {
                        let nm = leaf.display.clone();
                        let col = leaf.color.map(|c| [c[0], c[1], c[2], leaf.opacity]);
                        parts[pi].name = nm.clone();
                        if let Some(c) = col {
                            parts[pi].color = c;
                        }
                        // Attach to the real hierarchy node directly when free;
                        // otherwise an unnamed extra mesh node (no invented labels).
                        if tree[oi].mesh.is_none() {
                            tree[oi].mesh = Some(pi);
                        } else {
                            let node = tree.len();
                            tree.push(SceneNode {
                                name: String::new(),
                                mesh: Some(pi),
                                children: Vec::new(),
                            });
                            tree[oi].children.push(node);
                        }
                        linked_set.insert(pi);
                    }
                }
            }
        }
        let unlinked: Vec<usize> = (0..parts.len())
            .filter(|i| !linked_set.contains(i))
            .collect();
        if !unlinked.is_empty() {
            let group = tree.len();
            tree.push(SceneNode {
                name: "(unlinked)".into(),
                mesh: None,
                children: Vec::new(),
            });
            for pi in unlinked {
                let leaf = tree.len();
                tree.push(SceneNode {
                    name: parts[pi].name.clone(),
                    mesh: Some(pi),
                    children: Vec::new(),
                });
                tree[group].children.push(leaf);
            }
            roots.push(group);
        }
        // Merge same-named siblings at every level of the tree. Multiple NWD hierarchy
        // nodes can share the same display name under the same parent (e.g. 9 nodes
        // all named "WELD 2 of BRANCH …"), causing the name to repeat in the viewer.
        // Collapse them: keep the first occurrence, move all meshes and children from
        // duplicates into it, and remove the duplicates from their parent's child list.
        {
            let node_count = tree.len();
            for pi in 0..node_count {
                if tree[pi].children.is_empty() {
                    continue;
                }
                let children_snapshot = tree[pi].children.clone();
                let mut first_by_name: std::collections::HashMap<String, usize> =
                    std::collections::HashMap::new();
                let mut merge_into: std::collections::HashMap<usize, usize> =
                    std::collections::HashMap::new();
                const CLASS_LABELS: &[&str] = &[
                    "Group",
                    "Cylinder",
                    "Line",
                    "Facet Group",
                    "Box",
                    "Sphere",
                    "Geometry",
                    "(unlinked)",
                ];
                for &ci in &children_snapshot {
                    let nm = tree[ci].name.clone();
                    // Don't merge anonymous class-label nodes (real NWD leaves like
                    // "Cylinder") or unnamed extra mesh nodes — they're geometry
                    // primitives that should stay as individual children.
                    if nm.is_empty() || CLASS_LABELS.contains(&nm.as_str()) {
                        continue;
                    }
                    match first_by_name.get(&nm).copied() {
                        None => {
                            first_by_name.insert(nm, ci);
                        }
                        Some(keep) => {
                            merge_into.insert(ci, keep);
                        }
                    }
                }
                if merge_into.is_empty() {
                    continue;
                }
                for (&ci, &keep) in &merge_into {
                    let dup_mesh = tree[ci].mesh.take();
                    let dup_children: Vec<usize> = tree[ci].children.drain(..).collect();
                    if tree[keep].mesh.is_none() {
                        tree[keep].mesh = dup_mesh;
                    } else if let Some(m) = dup_mesh {
                        // Extra mesh of a merged same-named node: unnamed child
                        // (the name is already on the kept node).
                        let gc = tree.len();
                        tree.push(crate::glb::SceneNode {
                            name: String::new(),
                            mesh: Some(m),
                            children: Vec::new(),
                        });
                        tree[keep].children.push(gc);
                    }
                    tree[keep].children.extend(dup_children);
                }
                tree[pi].children.retain(|c| !merge_into.contains_key(c));
            }
        }
        // Drop co-prim children whose GEOMETRY is identical to a sibling already
        // kept under the same parent. This removes duplicate FacetGroup records
        // emitted at the same world position (e.g. the same rung appears twice
        // because one copy goes through `extra_owner` and another through the
        // re-home sweep, both landing under the same leaf).
        //
        // The key is the quantised bbox PLUS an order-independent hash of the
        // quantised vertex set — bbox alone is NOT sufficient identity: a weld's
        // two crossing diagonal rods share an identical bbox (same extents, same
        // centre) yet are distinct geometry, and the bbox-only key silently
        // dropped the second rod.
        {
            // Helper: quantised bbox (1 mm grid) + commutative vertex hash.
            let part_geom_key = |pi: usize| -> ([i32; 6], u64, u64) {
                let p = &parts[pi];
                let mut mn = [f32::INFINITY; 3];
                let mut mx = [f32::NEG_INFINITY; 3];
                let (mut sum, mut xor) = (0u64, 0u64);
                for pos in p.positions.points().iter() {
                    for k in 0..3 {
                        mn[k] = mn[k].min(pos[k]);
                        mx[k] = mx[k].max(pos[k]);
                    }
                    let q = |v: f32| (v * 1000.0).round() as i64 as u64;
                    let h = q(pos[0]).wrapping_mul(0x9e3779b97f4a7c15)
                        ^ q(pos[1]).wrapping_mul(0xc2b2ae3d27d4eb4f)
                        ^ q(pos[2]).wrapping_mul(0x165667b19e3779f9);
                    sum = sum.wrapping_add(h);
                    xor ^= h;
                }
                (
                    [
                        (mn[0] * 1000.0).round() as i32,
                        (mn[1] * 1000.0).round() as i32,
                        (mn[2] * 1000.0).round() as i32,
                        (mx[0] * 1000.0).round() as i32,
                        (mx[1] * 1000.0).round() as i32,
                        (mx[2] * 1000.0).round() as i32,
                    ],
                    sum,
                    xor,
                )
            };
            for pi in 0..tree.len() {
                if tree[pi].children.is_empty() {
                    continue;
                }
                let children_snap = tree[pi].children.clone();
                let mut seen_geom: std::collections::HashSet<([i32; 6], u64, u64)> =
                    std::collections::HashSet::new();
                // Seed with the parent's own geometry so a child that duplicates
                // the parent's mesh also gets pruned.
                if let Some(mi) = tree[pi].mesh {
                    seen_geom.insert(part_geom_key(mi));
                }
                for &ci in &children_snap {
                    if let Some(mi) = tree[ci].mesh {
                        let key = part_geom_key(mi);
                        if !seen_geom.insert(key) {
                            // Identical geometry to a sibling already kept — clear
                            // this node's mesh so it isn't emitted twice. The node
                            // itself stays (tree indices are stable) but with no
                            // mesh it is pruned from the children list below.
                            tree[ci].mesh = None;
                        }
                    }
                }
                // Prune children that are now empty (no mesh, no children).
                let emptied: std::collections::HashSet<usize> = children_snap
                    .iter()
                    .copied()
                    .filter(|&c| tree[c].mesh.is_none() && tree[c].children.is_empty())
                    .collect();
                if !emptied.is_empty() {
                    tree[pi].children.retain(|c| !emptied.contains(c));
                }
            }
        }
        if split_merge {
            mem_trace("pre-emit");
            let mut em = SplitEmitter::new(
                &input_md5,
                source_name,
                &notes,
                sink.as_deref_mut().unwrap(),
            );
            let warnings = build_split_merge(
                &parts, &tree, &roots, &all_nodes, &mut em, opts.mode, &gopts,
            )?;
            em.finish(warnings, &text_strings)?;
            Vec::new()
        } else {
            write_glb_tree(&parts, &tree, &roots, &gopts)
        }
    };
    if skipped_candidates > 0 {
        eprintln!("skipped {skipped_candidates} heuristic placement candidate(s) with no marker, geometry or extent");
    }
    if placeholder_bbox + placeholder_point > 0 {
        eprintln!(
            "placeholders emitted (no confident geometry match, kept not dropped): \
             {} from own-AABB box, {} point-marker (degenerate AABB)",
            placeholder_bbox, placeholder_point
        );
    }
    Ok((
        glb,
        split_outs,
        ConvertReport {
            geometries: geom.len(),
            fragments: frags.len(),
            placed,
            linked,
            lines,
            triangles,
            bbox_min,
            bbox_max,
            unit_scale,
        },
    ))
}

/// rvm2glb-compatible file-name sanitizer (anything non-alphanumeric → `_`).
fn sanitize_filename(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

/// Build the per-root MERGED outputs (`--split-merge`): walk each real root's
/// subtree, map every mesh to its element id (synthetic co-prim nodes inherit
/// their nearest real ancestor's id, so an element's meshes share one
/// draw-range), and emit one merged GLB per root. Returns the warnings for
/// the `status_file.json` the caller finishes with.
fn build_split_merge(
    parts: &[MeshPart],
    tree: &[crate::glb::SceneNode],
    roots: &[usize],
    all_nodes: &[crate::hierarchy::Node],
    em: &mut SplitEmitter<'_>,
    mode: OutputMode,
    gopts: &crate::glb::GlbOptions,
) -> Result<Vec<String>> {
    let mut warnings: Vec<String> = Vec::new();
    for &r in roots {
        if r >= all_nodes.len() {
            // Synthetic root (e.g. "(unlinked)") — not part of the NWD tree.
            let mut cnt = 0usize;
            let mut stack = vec![r];
            while let Some(i) = stack.pop() {
                if tree[i].mesh.is_some() {
                    cnt += 1;
                }
                stack.extend(tree[i].children.iter().copied());
            }
            if cnt > 0 {
                warnings.push(format!(
                    "{cnt} unlinked mesh(es) under '{}' not exported (no root site)",
                    tree[r].name
                ));
            }
            continue;
        }
        let root_name = all_nodes[r].display.clone();
        let root_id = all_nodes[r].id;
        let mut items: Vec<(u32, usize)> = Vec::new();
        let mut hier: Vec<(u32, String, Option<u32>)> = Vec::new();
        let mut stack: Vec<(usize, u32)> = vec![(r, root_id)];
        while let Some((i, inherited)) = stack.pop() {
            let eid = if i < all_nodes.len() {
                let n = &all_nodes[i];
                hier.push((
                    n.id,
                    n.display.clone(),
                    if i == r { None } else { n.parent_id },
                ));
                n.id
            } else {
                inherited
            };
            if let Some(pi) = tree[i].mesh {
                items.push((eid, pi));
            }
            for &c in &tree[i].children {
                stack.push((c, eid));
            }
        }
        if items.iter().all(|&(_, pi)| parts[pi].indices.is_empty()) {
            continue;
        }
        items.sort();
        hier.sort_by_key(|h| h.0);
        hier.dedup_by_key(|h| h.0);
        // Hand the GLB to the sink NOW and drop it — per-root outputs of a
        // large model must never accumulate in memory.
        emit_root_model(em, mode, gopts, &root_name, parts, &items, &hier)?;
    }
    Ok(warnings)
}

/// `NWD_MEM_TRACE=1`: print current RSS + elapsed time at stage boundaries.
fn mem_trace(stage: &str) {
    if std::env::var_os("NWD_MEM_TRACE").is_none() {
        return;
    }
    static T0: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();
    let t0 = *T0.get_or_init(std::time::Instant::now);
    let rss = std::fs::read_to_string("/proc/self/status")
        .ok()
        .and_then(|s| {
            s.lines()
                .find(|l| l.starts_with("VmRSS"))
                .and_then(|l| l.split_whitespace().nth(1).map(|v| v.to_string()))
        })
        .unwrap_or_default();
    eprintln!(
        "MEM {stage}: {} MB  (t+{:.2}s)",
        rss.parse::<u64>().unwrap_or(0) / 1024,
        t0.elapsed().as_secs_f64()
    );
}

/// Fixed index topologies for the deferred parametric parts (parameter-
/// independent — see geometry::cylinder_mesh/box_mesh/cross_mesh).
fn cyl_idx() -> std::sync::Arc<Vec<u32>> {
    static I: std::sync::OnceLock<std::sync::Arc<Vec<u32>>> = std::sync::OnceLock::new();
    I.get_or_init(|| std::sync::Arc::new(geometry::cylinder_mesh([0.0; 3], [0.0, 0.0, 1.0], 0.5).1))
        .clone()
}
fn aux_disc_idx() -> std::sync::Arc<Vec<u32>> {
    static I: std::sync::OnceLock<std::sync::Arc<Vec<u32>>> = std::sync::OnceLock::new();
    I.get_or_init(|| std::sync::Arc::new(geometry::aux_disc_indices()))
        .clone()
}
fn aux_tube_idx() -> std::sync::Arc<Vec<u32>> {
    static I: std::sync::OnceLock<std::sync::Arc<Vec<u32>>> = std::sync::OnceLock::new();
    I.get_or_init(|| std::sync::Arc::new(geometry::aux_tube_indices()))
        .clone()
}
fn box_idx() -> std::sync::Arc<Vec<u32>> {
    static I: std::sync::OnceLock<std::sync::Arc<Vec<u32>>> = std::sync::OnceLock::new();
    I.get_or_init(|| std::sync::Arc::new(geometry::box_mesh([0.0; 3], [1.0; 3], 0.012).1))
        .clone()
}

fn centroid_pp(p: &crate::glb::PartPositions) -> [f32; 3] {
    let n = p.len().max(1) as f32;
    let mut c = [0.0f32; 3];
    for v in p.points().iter() {
        c[0] += v[0];
        c[1] += v[1];
        c[2] += v[2];
    }
    [c[0] / n, c[1] / n, c[2] / n]
}

/// World bbox of `parts` in output units.
fn parts_bbox(parts: &[MeshPart], gopts: &crate::glb::GlbOptions) -> ([f32; 3], [f32; 3]) {
    let mut min = [f32::INFINITY; 3];
    let mut max = [f32::NEG_INFINITY; 3];
    for part in parts {
        for p in part.positions.points().iter() {
            for i in 0..3 {
                min[i] = min[i].min(p[i]);
                max[i] = max[i].max(p[i]);
            }
        }
    }
    gopts.scale_bbox(min, max)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// End-to-end on the Huldra sample (`convertSamples/nwd/huldra/`): every
    /// fragment links to its leaf via the group ordinal and the
    /// emitted triangle count equals the Navisworks FBX export of the same file
    /// (32,056 — verified leaf by leaf against that export, see
    /// docs/what_we_know_v1.md).
    #[test]
    fn huldra_cd2_converts_like_the_fbx() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../convertSamples/nwd/huldra/HDA-ASB-CD2.nwd"
        );
        let bytes = std::fs::read(path).unwrap_or_else(|e| panic!("{path}: {e}"));
        let opts = ConvertOptions {
            cleanup_position: false,
            ..Default::default()
        };
        let mut files: Vec<(String, usize)> = Vec::new();
        let mut sink = |name: &str, data: &[u8]| -> Result<()> {
            files.push((name.to_string(), data.len()));
            Ok(())
        };
        let r = convert_stream(&bytes, &opts, "HDA-ASB-CD2.nwd", &mut sink).expect("convert");
        assert_eq!(r.fragments, 852);
        assert_eq!(r.linked, 852);
        assert_eq!(r.triangles, 32_056);
        assert!(files.iter().any(|(n, _)| n == "_CD2-PSUP.glb"));
        assert!(files.iter().any(|(n, _)| n == "status_file.json"));
        // World bbox in glTF axes (native z up -> glTF y up); the low end is
        // the ±1 mm box at z = 0 that the FBX export has as well.
        assert!(r.bbox_min[1] > -0.01 && r.bbox_max[1] < 29.0, "{r:?}");
        assert!(r.bbox_min[0] > 69.0 && r.bbox_max[0] < 90.1, "{r:?}");
    }
}
