//! Product structure: PRODUCT / PRODUCT_DEFINITION graph,
//! NEXT_ASSEMBLY_USAGE_OCCURRENCE parent/child edges, and per-instance
//! transforms from CONTEXT_DEPENDENT_SHAPE_REPRESENTATION +
//! REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION.

use std::collections::{HashMap, HashSet};

use crate::geom::M4;
use crate::model;
use crate::step::{StepFile, P, TYPE_COMPLEX};

pub struct ProductNode {
    pub pd: u32,
    pub name: String,
    /// SHAPE_REPRESENTATIONs attached to this product definition (directly and
    /// via SHAPE_REPRESENTATION_RELATIONSHIP).
    pub shape_reps: Vec<u32>,
}

pub struct Instance {
    pub nauo: u32,
    pub child_pd: u32,
    pub name: String,
    pub transform: M4,
}

#[derive(Default)]
pub struct Assembly {
    pub products: HashMap<u32, ProductNode>,
    /// parent PD -> child instances
    pub children: HashMap<u32, Vec<Instance>>,
    pub roots: Vec<u32>,
}

pub fn build(sf: &StepFile) -> Assembly {
    let mut asm = Assembly::default();
    // The file's global length unit. Placement transforms below scale each
    // axis origin by its representation's own unit relative to this, so a
    // metre-context part placed in a mm assembly assembles correctly (its
    // geometry is scaled the same way at tessellation time).
    let global_scale = model::file_length_scale(sf).unwrap_or(0.001);

    // --- products ----------------------------------------------------------
    for &pd in sf.of_type("PRODUCT_DEFINITION") {
        let name = product_name(sf, pd).unwrap_or_else(|| format!("PD#{}", pd));
        asm.products.insert(
            pd,
            ProductNode {
                pd,
                name,
                shape_reps: Vec::new(),
            },
        );
    }

    // --- shapes: PD -> PDS -> SDR -> SR ------------------------------------
    // PRODUCT_DEFINITION_SHAPE('', '', definition)
    let mut pds_of_pd: HashMap<u32, u32> = HashMap::new(); // PDS id -> PD id
    let mut pds_of_nauo: HashMap<u32, u32> = HashMap::new(); // PDS id -> NAUO id
    for &pds in sf.of_type("PRODUCT_DEFINITION_SHAPE") {
        if let Some(p) = sf.params(pds) {
            if let Some(def) = p.get(2).and_then(|v| v.as_ref_id()) {
                match sf.entity_type(def) {
                    Some("PRODUCT_DEFINITION") => {
                        pds_of_pd.insert(pds, def);
                    }
                    Some("NEXT_ASSEMBLY_USAGE_OCCURRENCE") => {
                        pds_of_nauo.insert(pds, def);
                    }
                    _ => {}
                }
            }
        }
    }

    // SHAPE_DEFINITION_REPRESENTATION(definition PDS, used_representation SR)
    let mut sr_of_pd: HashMap<u32, Vec<u32>> = HashMap::new();
    for &sdr in sf.of_type("SHAPE_DEFINITION_REPRESENTATION") {
        if let Some(p) = sf.params(sdr) {
            let pds = p.first().and_then(|v| v.as_ref_id());
            let sr = p.get(1).and_then(|v| v.as_ref_id());
            if let (Some(pds), Some(sr)) = (pds, sr) {
                if let Some(&pd) = pds_of_pd.get(&pds) {
                    sr_of_pd.entry(pd).or_default().push(sr);
                }
            }
        }
    }

    // SHAPE_REPRESENTATION_RELATIONSHIP links SR <-> ADVANCED_BREP_SHAPE_REP etc.
    let mut srr: HashMap<u32, Vec<u32>> = HashMap::new();
    for &r in sf.of_type("SHAPE_REPRESENTATION_RELATIONSHIP") {
        if let Some(p) = sf.params(r) {
            let a = p.get(2).and_then(|v| v.as_ref_id());
            let b = p.get(3).and_then(|v| v.as_ref_id());
            if let (Some(a), Some(b)) = (a, b) {
                srr.entry(a).or_default().push(b);
                srr.entry(b).or_default().push(a);
            }
        }
    }

    for (pd, srs) in &sr_of_pd {
        if let Some(node) = asm.products.get_mut(pd) {
            let mut seen = HashSet::new();
            for &sr in srs {
                if seen.insert(sr) {
                    node.shape_reps.push(sr);
                }
                if let Some(linked) = srr.get(&sr) {
                    for &l in linked {
                        if seen.insert(l) {
                            node.shape_reps.push(l);
                        }
                    }
                }
            }
        }
    }

    // --- transforms per NAUO ------------------------------------------------
    // CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(rep_relation, represented_product_relation)
    let mut xform_of_nauo: HashMap<u32, M4> = HashMap::new();
    for &cdsr in sf.of_type("CONTEXT_DEPENDENT_SHAPE_REPRESENTATION") {
        let p = match sf.params(cdsr) {
            Some(p) => p,
            None => continue,
        };
        let rel = p.first().and_then(|v| v.as_ref_id());
        let pds = p.get(1).and_then(|v| v.as_ref_id());
        let (rel, pds) = match (rel, pds) {
            (Some(a), Some(b)) => (a, b),
            _ => continue,
        };
        let nauo = match pds_of_nauo.get(&pds) {
            Some(&n) => n,
            None => continue,
        };
        if let Some((rep1, rep2, mut m1, mut m2)) = transform_relationship(sf, rel) {
            // Bring each axis origin into the global unit, matching the
            // per-representation scaling applied to that rep's geometry.
            scale_translation(&mut m1, model::rep_unit_factor(sf, rep1, global_scale));
            scale_translation(&mut m2, model::rep_unit_factor(sf, rep2, global_scale));
            // Which rep belongs to the child product of this NAUO?
            let child_pd = nauo_pds(sf, nauo).1;
            let child_reps: HashSet<u32> = child_pd
                .and_then(|pd| asm.products.get(&pd))
                .map(|n| n.shape_reps.iter().copied().collect())
                .unwrap_or_default();
            // The IDT maps axis1 (in rep_1 space) onto axis2 (in rep_2 space):
            // T(rep_1 -> rep_2) = M(axis2) * M(axis1)^-1.
            let fwd = m2.mul(m1.inverse_rigid());
            let t = if child_reps.contains(&rep2) && !child_reps.contains(&rep1) {
                // child geometry lives in rep_2 -> we need rep_2 -> rep_1
                fwd.inverse_rigid()
            } else {
                fwd
            };
            xform_of_nauo.insert(nauo, t);
        }
    }

    // --- assembly edges -----------------------------------------------------
    let mut is_child: HashSet<u32> = HashSet::new();
    for &nauo in sf.of_type("NEXT_ASSEMBLY_USAGE_OCCURRENCE") {
        let (parent, child) = nauo_pds(sf, nauo);
        let (parent, child) = match (parent, child) {
            (Some(a), Some(b)) => (a, b),
            _ => continue,
        };
        let p = sf.params(nauo).unwrap_or_default();
        // Instance label: the child product's name reads best in viewers;
        // fall back to the NAUO's reference designator / name.
        let name = asm
            .products
            .get(&child)
            .map(|n| n.name.clone())
            .or_else(|| {
                p.get(5)
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string())
            })
            .or_else(|| {
                p.get(1)
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string())
            })
            .unwrap_or_else(|| format!("NAUO#{}", nauo));
        let transform = xform_of_nauo.get(&nauo).copied().unwrap_or(M4::IDENTITY);
        is_child.insert(child);
        asm.children.entry(parent).or_default().push(Instance {
            nauo,
            child_pd: child,
            name,
            transform,
        });
    }

    // --- roots ---------------------------------------------------------------
    let mut roots: Vec<u32> = asm
        .products
        .keys()
        .copied()
        .filter(|pd| !is_child.contains(pd))
        .filter(|pd| {
            // only keep roots that own geometry somewhere below them
            subtree_has_shape(&asm, *pd, 0)
        })
        .collect();
    roots.sort_unstable();
    asm.roots = roots;
    asm
}

fn subtree_has_shape(asm: &Assembly, pd: u32, depth: usize) -> bool {
    if depth > 64 {
        return false;
    }
    if asm
        .products
        .get(&pd)
        .map(|n| !n.shape_reps.is_empty())
        .unwrap_or(false)
    {
        return true;
    }
    asm.children
        .get(&pd)
        .map(|kids| {
            kids.iter()
                .any(|k| subtree_has_shape(asm, k.child_pd, depth + 1))
        })
        .unwrap_or(false)
}

/// NAUO('id','name','desc', relating PD, related PD, ref_designator)
fn nauo_pds(sf: &StepFile, nauo: u32) -> (Option<u32>, Option<u32>) {
    match sf.params(nauo) {
        Some(p) => (
            p.get(3).and_then(|v| v.as_ref_id()),
            p.get(4).and_then(|v| v.as_ref_id()),
        ),
        None => (None, None),
    }
}

/// Scale a rigid transform's translation (column-major origin) in place.
fn scale_translation(m: &mut M4, f: f64) {
    if (f - 1.0).abs() > 1e-12 {
        m.0[12] *= f;
        m.0[13] *= f;
        m.0[14] *= f;
    }
}

/// Resolve a (possibly complex) representation relationship with transform.
/// Returns (rep_1, rep_2, M(axis1), M(axis2)).
fn transform_relationship(sf: &StepFile, rel: u32) -> Option<(u32, u32, M4, M4)> {
    let (reps, idt) = if sf.is_complex(rel) {
        let rr = sf.complex_leaf(rel, "REPRESENTATION_RELATIONSHIP")?;
        // could match REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION leaf too;
        // pick the leaf that actually has the two rep refs
        let reps = extract_two_refs(&rr).or_else(|| {
            let alt = sf.complex_leaf(rel, "SHAPE_REPRESENTATION_RELATIONSHIP")?;
            extract_two_refs(&alt)
        })?;
        let with_t = sf.complex_leaf(rel, "WITH_TRANSFORMATION")?;
        let idt = with_t.iter().find_map(|v| v.as_ref_id())?;
        (reps, idt)
    } else {
        // simple REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION
        // ('name','desc', rep_1, rep_2, transformation)
        let p = sf.params(rel)?;
        let r1 = p.get(2).and_then(|v| v.as_ref_id())?;
        let r2 = p.get(3).and_then(|v| v.as_ref_id())?;
        let idt = p.get(4).and_then(|v| v.as_ref_id())?;
        ((r1, r2), idt)
    };

    // ITEM_DEFINED_TRANSFORMATION('name','desc', axis1, axis2)
    let it = sf.params(idt)?;
    let a1 = it.get(2).and_then(|v| v.as_ref_id());
    let a2 = it.get(3).and_then(|v| v.as_ref_id());
    let m1 = a1
        .map(|a| model::axis2_matrix(sf, a))
        .unwrap_or(M4::IDENTITY);
    let m2 = a2
        .map(|a| model::axis2_matrix(sf, a))
        .unwrap_or(M4::IDENTITY);
    Some((reps.0, reps.1, m1, m2))
}

fn extract_two_refs(p: &[P]) -> Option<(u32, u32)> {
    let refs: Vec<u32> = p.iter().filter_map(|v| v.as_ref_id()).collect();
    if refs.len() >= 2 {
        Some((refs[0], refs[1]))
    } else {
        None
    }
}

fn product_name(sf: &StepFile, pd: u32) -> Option<String> {
    // PRODUCT_DEFINITION(id, desc, formation, frame)
    let p = sf.params(pd)?;
    let pdf = p.get(2).and_then(|v| v.as_ref_id())?;
    // PRODUCT_DEFINITION_FORMATION[_*](id, desc, product)
    let f = sf.params(pdf)?;
    let product = f.get(2).and_then(|v| v.as_ref_id())?;
    // PRODUCT(id, name, desc, contexts)
    let pr = sf.params(product)?;
    pr.get(1)
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .or_else(|| pr.first().and_then(|v| v.as_str()).map(|s| s.to_string()))
}

/// Resolve a `--filter` query to subtree-root product-definition ids: `#<n>`
/// or `<n>` matches a PRODUCT_DEFINITION entity id exactly, otherwise it is a
/// case-insensitive substring match on product names. A match that lies in
/// another match's subtree is dropped so a subtree isn't emitted twice.
/// Returns the matched roots (sorted); empty if nothing matched.
pub fn filter_roots(asm: &Assembly, query: &str) -> Vec<u32> {
    let q = query.trim();
    if let Ok(id) = q.strip_prefix('#').unwrap_or(q).parse::<u32>() {
        if asm.products.contains_key(&id) {
            return vec![id];
        }
    }
    let ql = q.to_lowercase();
    let mut hits: Vec<u32> = asm
        .products
        .iter()
        .filter(|(_, n)| n.name.to_lowercase().contains(&ql))
        .map(|(&pd, _)| pd)
        .collect();
    hits.sort_unstable();
    let set: HashSet<u32> = hits.iter().copied().collect();
    hits.retain(|&pd| {
        !set.iter()
            .any(|&a| a != pd && subtree_contains(asm, a, pd, 0))
    });
    hits
}

/// Forward reference closure of `seeds`: the seeds plus every entity reachable
/// by following `#id` references. Used to extract a single geometry entity
/// (e.g. a face found via `--split`) as a self-contained fragment for
/// `--filter #id --extract-step`.
pub fn reference_closure(sf: &StepFile, seeds: &[u32]) -> Vec<u32> {
    let mut seen: HashSet<u32> = HashSet::new();
    let mut stack: Vec<u32> = seeds.to_vec();
    while let Some(id) = stack.pop() {
        if !seen.insert(id) {
            continue;
        }
        for r in sf.entity_refs(id) {
            if !seen.contains(&r) {
                stack.push(r);
            }
        }
    }
    let mut v: Vec<u32> = seen.into_iter().collect();
    v.sort_unstable();
    v
}

/// Does the forward reference closure of `rep` reach `target`? Bounded BFS that
/// short-circuits on the first hit.
fn rep_reaches(sf: &StepFile, rep: u32, target: u32) -> bool {
    let mut seen: HashSet<u32> = HashSet::new();
    let mut stack = vec![rep];
    while let Some(id) = stack.pop() {
        if id == target {
            return true;
        }
        if !seen.insert(id) {
            continue;
        }
        for r in sf.entity_refs(id) {
            if !seen.contains(&r) {
                stack.push(r);
            }
        }
    }
    false
}

/// Find a product that owns `entity` — the first (by id) product whose shape
/// representation reaches `entity` by reference — and that representation.
/// Resolves a geometry-entity `--filter #id` to its part (for `--with-parent`)
/// and to that part's modeling unit. `None` if no product's rep reaches it.
pub fn owning_product(sf: &StepFile, asm: &Assembly, entity: u32) -> Option<(u32, u32)> {
    let mut pds: Vec<u32> = asm.products.keys().copied().collect();
    pds.sort_unstable(); // deterministic when geometry is shared across products
    for pd in pds {
        if let Some(node) = asm.products.get(&pd) {
            for &sr in &node.shape_reps {
                if rep_reaches(sf, sr, entity) {
                    return Some((pd, sr));
                }
            }
        }
    }
    None
}

/// Reachable leaf product-definitions (no child instances) that have no shape
/// representation attached — i.e. parts that show up in the tree but carry no
/// geometry. A strong hint of a geometry linkage we don't follow (a multi-hop
/// representation relationship, a sibling PD of the same product holding the
/// shape, a plain `REPRESENTATION_RELATIONSHIP`, ...). Distinct PDs, sorted.
pub fn parts_missing_geometry(asm: &Assembly) -> Vec<u32> {
    fn walk(asm: &Assembly, pd: u32, depth: usize, seen: &mut HashSet<u32>, out: &mut Vec<u32>) {
        if depth > 64 || !seen.insert(pd) {
            return;
        }
        let kids = asm.children.get(&pd);
        let is_leaf = kids.map(|k| k.is_empty()).unwrap_or(true);
        let has_shape = asm
            .products
            .get(&pd)
            .map(|n| !n.shape_reps.is_empty())
            .unwrap_or(false);
        if is_leaf && !has_shape {
            out.push(pd);
        }
        if let Some(kids) = kids {
            for k in kids {
                walk(asm, k.child_pd, depth + 1, seen, out);
            }
        }
    }
    let (mut out, mut seen) = (Vec::new(), HashSet::new());
    for &r in &asm.roots {
        walk(asm, r, 0, &mut seen, &mut out);
    }
    out.sort_unstable();
    out
}

/// Whether `target` lies in the assembly subtree rooted at `root`.
fn subtree_contains(asm: &Assembly, root: u32, target: u32, depth: usize) -> bool {
    if depth > 64 {
        return false;
    }
    asm.children.get(&root).is_some_and(|kids| {
        kids.iter()
            .any(|k| k.child_pd == target || subtree_contains(asm, k.child_pd, target, depth + 1))
    })
}

/// PRODUCT entity behind a PRODUCT_DEFINITION (PD -> PDF -> PRODUCT).
fn product_of(sf: &StepFile, pd: u32) -> Option<u32> {
    let pdf = sf.params(pd)?.get(2).and_then(|v| v.as_ref_id())?;
    sf.params(pdf)?.get(2).and_then(|v| v.as_ref_id())
}

/// Collect the STEP entity ids that define the subtree rooted at `roots`, for a
/// self-contained `--filter --extract-step` excerpt. Seeds the
/// product-definition closure, the assembly edges (NAUO) and their per-instance
/// transforms, and the shape/representation linkage (PDS, SDR, the resolved
/// shape reps), then **broadens** to where the geometry can actually live but
/// the converter may not look: sibling product-definitions of the same product,
/// and the rep paired with one of our reps by a representation relationship
/// (plain `REPRESENTATION_RELATIONSHIP`, complex `..._WITH_TRANSFORMATION`) —
/// one hop, scoped to our reps, so a hub rep shared across the model can't drag
/// the whole file in. Finally it takes the full forward closure of all of that
/// in one shared traversal — so the brep is captured even when linked
/// indirectly, and the excerpt is deterministic and complete (no cap-based
/// truncation; the closure is naturally bounded by what the subtree reaches).
pub fn subtree_entities(sf: &StepFile, asm: &Assembly, roots: &[u32]) -> Vec<u32> {
    // 1) subtree product-definitions
    fn collect(asm: &Assembly, pd: u32, d: usize, out: &mut HashSet<u32>) {
        if d > 64 || !out.insert(pd) {
            return;
        }
        if let Some(kids) = asm.children.get(&pd) {
            for k in kids {
                collect(asm, k.child_pd, d + 1, out);
            }
        }
    }
    let mut pds: HashSet<u32> = HashSet::new();
    for &r in roots {
        collect(asm, r, 0, &mut pds);
    }

    // 1b) sibling PDs of the same product — geometry is sometimes attached to
    // another definition of the product than the one the NAUO instances
    let products: HashSet<u32> = pds.iter().filter_map(|&pd| product_of(sf, pd)).collect();
    let mut interesting = pds.clone();
    if !products.is_empty() {
        for &pd in asm.products.keys() {
            if product_of(sf, pd).is_some_and(|pr| products.contains(&pr)) {
                interesting.insert(pd);
            }
        }
    }

    // seeds: PDs + their already-resolved shape reps (the converter's view)
    let mut seeds: HashSet<u32> = interesting.clone();
    let mut reps: HashSet<u32> = HashSet::new();
    for &pd in &interesting {
        if let Some(node) = asm.products.get(&pd) {
            reps.extend(node.shape_reps.iter().copied());
        }
    }

    // 2) NAUO edges within the subtree
    let mut nauos: HashSet<u32> = HashSet::new();
    for &n in sf.of_type("NEXT_ASSEMBLY_USAGE_OCCURRENCE") {
        let (a, b) = nauo_pds(sf, n);
        if a.is_some_and(|x| pds.contains(&x)) || b.is_some_and(|x| pds.contains(&x)) {
            nauos.insert(n);
            seeds.insert(n);
        }
    }

    // 3) PRODUCT_DEFINITION_SHAPE for those PDs / NAUOs
    let mut pdss: HashSet<u32> = HashSet::new();
    for &p in sf.of_type("PRODUCT_DEFINITION_SHAPE") {
        if let Some(def) = sf
            .params(p)
            .and_then(|q| q.get(2).and_then(|v| v.as_ref_id()))
        {
            if interesting.contains(&def) || nauos.contains(&def) {
                pdss.insert(p);
                seeds.insert(p);
            }
        }
    }

    // 4) SHAPE_DEFINITION_REPRESENTATION linking those PDS to their SR
    for &sdr in sf.of_type("SHAPE_DEFINITION_REPRESENTATION") {
        if let Some(p) = sf.params(sdr) {
            if p.first()
                .and_then(|v| v.as_ref_id())
                .is_some_and(|d| pdss.contains(&d))
            {
                seeds.insert(sdr);
                if let Some(sr) = p.get(1).and_then(|v| v.as_ref_id()) {
                    reps.insert(sr);
                }
            }
        }
    }

    // 5) CONTEXT_DEPENDENT_SHAPE_REPRESENTATION (per-instance transforms) + rel
    for &cdsr in sf.of_type("CONTEXT_DEPENDENT_SHAPE_REPRESENTATION") {
        if let Some(p) = sf.params(cdsr) {
            if p.get(1)
                .and_then(|v| v.as_ref_id())
                .is_some_and(|x| pdss.contains(&x))
            {
                seeds.insert(cdsr);
                if let Some(rel) = p.first().and_then(|v| v.as_ref_id()) {
                    seeds.insert(rel);
                }
            }
        }
    }

    // 6) representation-relationship closure over `reps`, a few hops, to reach
    // geometry linked by a relationship the converter does not traverse (2+-hop
    // shape relationships, plain/complex REPRESENTATION_RELATIONSHIP). Bounded
    // so a globally-linked rep graph can't drag in the whole model.
    let mut rels: Vec<u32> = Vec::new();
    for ty in [
        "SHAPE_REPRESENTATION_RELATIONSHIP",
        "REPRESENTATION_RELATIONSHIP",
        "REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION",
    ] {
        rels.extend(sf.of_type(ty).iter().copied());
    }
    if let Some(cty) = sf.type_id(TYPE_COMPLEX) {
        if let Some(ids) = sf.by_type.get(&cty) {
            for &id in ids {
                if sf.complex_leaf(id, "REPRESENTATION_RELATIONSHIP").is_some() {
                    rels.push(id);
                }
            }
        }
    }
    let is_rep = |id: u32| {
        sf.entity_type(id).is_some_and(|t| {
            t.contains("REPRESENTATION") && !t.contains("RELATIONSHIP") && !t.contains("DEFINITION")
        })
    };
    let rel_refs: Vec<(u32, Vec<u32>)> = rels
        .iter()
        .map(|&r| {
            (
                r,
                sf.entity_refs(r)
                    .into_iter()
                    .filter(|&x| is_rep(x))
                    .collect(),
            )
        })
        .collect();
    // one hop, scoped to the element's own reps: pull the sibling rep (the
    // brep, typically) that a relationship pairs with one of our reps, plus the
    // relationship itself. We do NOT chase the newly-added reps further — a
    // hub rep shared across the whole model would otherwise drag in everything.
    let base_reps = reps.clone();
    for (rel, refs) in &rel_refs {
        if refs.iter().any(|r| base_reps.contains(r)) {
            seeds.insert(*rel);
            reps.extend(refs.iter().copied());
        }
    }
    seeds.extend(reps);

    // 7) full forward closure of every seed in one shared traversal (geometry,
    // contexts, placements, product chains). One `seen` set, so cost is linear
    // in the entities the subtree reaches — no per-seed re-walk, no cap.
    let mut seen: HashSet<u32> = HashSet::new();
    let mut stack: Vec<u32> = seeds.into_iter().collect();
    while let Some(id) = stack.pop() {
        if !seen.insert(id) {
            continue;
        }
        for r in sf.entity_refs(id) {
            if !seen.contains(&r) {
                stack.push(r);
            }
        }
    }
    let mut v: Vec<u32> = seen.into_iter().collect();
    v.sort_unstable();
    v
}

/// Pretty-print the assembly tree to stdout.
pub fn print_tree(asm: &Assembly) {
    fn rec(asm: &Assembly, pd: u32, name: &str, prefix: &str, last: bool, depth: usize) {
        if depth > 64 {
            return;
        }
        let node = asm.products.get(&pd);
        let geo = node
            .map(|n| {
                if n.shape_reps.is_empty() {
                    ""
                } else {
                    "  [geometry]"
                }
            })
            .unwrap_or("");
        let (tee, pad) = if depth == 0 {
            ("", "")
        } else if last {
            ("└─ ", "   ")
        } else {
            ("├─ ", "│  ")
        };
        println!("{}{}{}{}", prefix, tee, name, geo);
        if let Some(kids) = asm.children.get(&pd) {
            let n = kids.len();
            for (i, k) in kids.iter().enumerate() {
                rec(
                    asm,
                    k.child_pd,
                    &k.name,
                    &format!("{}{}", prefix, pad),
                    i + 1 == n,
                    depth + 1,
                );
            }
        }
    }
    for &r in &asm.roots {
        let name = asm
            .products
            .get(&r)
            .map(|n| n.name.clone())
            .unwrap_or_else(|| format!("PD#{}", r));
        rec(asm, r, &name, "", true, 0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(pd: u32, name: &str, shape_reps: Vec<u32>) -> ProductNode {
        ProductNode {
            pd,
            name: name.into(),
            shape_reps,
        }
    }
    fn inst(child_pd: u32, name: &str) -> Instance {
        Instance {
            nauo: 0,
            child_pd,
            name: name.into(),
            transform: M4::IDENTITY,
        }
    }

    #[test]
    fn parts_missing_geometry_flags_geometryless_leaves() {
        let mut asm = Assembly::default();
        asm.products.insert(1, node(1, "root", vec![])); // container, no shape
        asm.products.insert(2, node(2, "withgeo", vec![100])); // leaf w/ shape
        asm.products.insert(3, node(3, "nogeo", vec![])); // leaf w/o shape
        asm.children
            .insert(1, vec![inst(2, "withgeo"), inst(3, "nogeo")]);
        asm.roots = vec![1];
        // root has children -> not a leaf, not flagged; leaf 2 has a shape; only
        // leaf 3 (in the tree, no geometry) is flagged
        assert_eq!(parts_missing_geometry(&asm), vec![3]);
    }

    #[test]
    fn filter_roots_dedupes_descendants_and_matches_id() {
        let mut asm = Assembly::default();
        asm.products.insert(1, node(1, "Alpha", vec![]));
        asm.products.insert(2, node(2, "Alpha child", vec![100]));
        asm.children.insert(1, vec![inst(2, "Alpha child")]);
        asm.roots = vec![1];
        // "alpha" matches #1 and #2, but #2 is inside #1's subtree -> dropped
        assert_eq!(filter_roots(&asm, "alpha"), vec![1]);
        // explicit id still selects the descendant directly
        assert_eq!(filter_roots(&asm, "#2"), vec![2]);
        assert!(filter_roots(&asm, "nope").is_empty());
    }
}
