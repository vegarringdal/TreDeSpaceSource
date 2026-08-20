//! rvm_parser_glb-style merged export: walk the assembly, bake every instance
//! to world space (meters, Y-up) and merge all geometry sharing a color into
//! one mesh, recording per-part draw ranges and the instance tree for the
//! scene `extras`. See [`crate::glb::MergedBuilder`] for the output layout.

use std::collections::HashMap;

use crate::geom::M4;
use crate::glb::MergedBuilder;
use crate::hierarchy::Assembly;
use crate::mesh::MeshSet;
use crate::tessellate::{self, Ctx, TessStats};

/// Standalone solid types used when a file has no product structure.
pub const FALLBACK_TYPES: &[&str] = &[
    "MANIFOLD_SOLID_BREP",
    "BREP_WITH_VOIDS",
    "FACETED_BREP",
    "SHELL_BASED_SURFACE_MODEL",
    "TRIANGULATED_FACE_SET",
    "TESSELLATED_SOLID",
    "CSG_SOLID",
];

#[derive(Clone, Copy)]
pub struct MergeOptions {
    /// scale factor to meters, baked into positions before the Y-up rotation
    pub unit_scale: f64,
    /// the file's global length-unit scale to metres (used to normalize a
    /// representation that declares a different unit, e.g. a part in
    /// a metre context inside an otherwise-mm file)
    pub file_unit_scale: f64,
    /// rotate the Z-up input to glTF's Y-up (`M4::Z_UP_TO_Y_UP`); off when
    /// the input is already Y-up
    pub rotate_z_up: bool,
    /// per-part meshoptimizer pass (weld / degenerates / cache / fetch)
    pub optimize: bool,
    /// drop vertex normals (smaller output, position-only welding)
    pub drop_normals: bool,
    /// rvm_parser_glb `--cleanup-position`: quantized position weld +
    /// meshopt simplification per part; drops normals from the output
    pub cleanup: Option<Cleanup>,
    /// standalone meshopt simplification `(threshold, target_error)` that
    /// keeps normals; ignored when `cleanup` is set (cleanup includes it)
    pub simplify: Option<(f32, f32)>,
}

/// Parameters mirroring rvm_parser_glb's cleanup options (same defaults).
#[derive(Clone, Copy)]
pub struct Cleanup {
    /// quantization decimals in file units (`--cleanup-precision`, 3)
    pub precision: u32,
    /// simplify target = threshold * index count (`--meshopt-threshold`, 0.75)
    pub threshold: f32,
    /// meshopt_simplify target error (`--meshopt-target-error`, 0.0)
    pub target_error: f32,
}

/// Returns the merged model plus the number of unique tessellated meshes
/// behind it — `part_count() / unique` is the instance-expansion factor that
/// baking world space costs compared to the hierarchical (instanced) output.
pub fn build(
    cx: &Ctx,
    asm: &Assembly,
    opts: MergeOptions,
    stats: &mut TessStats,
    progress: &mut dyn FnMut(u32),
) -> (MergedBuilder, usize) {
    let mut base = M4::scale_uniform(opts.unit_scale);
    if opts.rotate_z_up {
        base = M4::Z_UP_TO_Y_UP.mul(base);
    }
    let mut w = Walk {
        cx,
        asm,
        opts,
        stats,
        progress,
        processed: 0,
        cache: HashMap::new(),
        out: MergedBuilder::default(),
        next_id: 1,
        budget: 2_000_000, // instance explosion guard
    };

    for &root in &asm.roots {
        let name = asm
            .products
            .get(&root)
            .map(|n| n.name.clone())
            .unwrap_or_else(|| format!("PD#{}", root));
        w.rec(root, &name, 0, base, 0);
    }

    // Fallback: no product structure -> every standalone solid as one part
    if asm.roots.is_empty() {
        let mut tm = MeshSet::default();
        for ty in FALLBACK_TYPES {
            for &id in cx.sf.of_type(ty) {
                tessellate::tessellate_item(cx, id, None, &mut tm, w.stats);
            }
        }
        prepare(&mut tm, &opts);
        if !tm.is_empty() {
            tm.transform(&base);
            let id = w.next_id;
            w.next_id += 1;
            w.out.add_hierarchy(id, "geometry", 0);
            w.emit_set(id, "geometry", &tm);
            let mut out = w.out;
            out.recenter();
            return (out, 1);
        }
    }
    let unique = w.cache.values().filter(|m| m.is_some()).count();
    let mut out = w.out;
    // world-baked buffers: pull the scene's bbox centre out of the f32
    // positions and onto the bucket nodes (f32 precision + viewer stability
    // for models sited far from the origin)
    out.recenter();
    (out, unique)
}

/// Per-part pipeline: meshopt weld/cache pass, then the optional rvm-style
/// quantized position cleanup + simplification (which drops normals).
fn prepare(tm: &mut MeshSet, opts: &MergeOptions) {
    if tm.is_empty() {
        return;
    }
    if opts.drop_normals {
        tm.drop_normals();
    }
    if opts.optimize {
        tm.optimize();
    }
    if let Some(c) = opts.cleanup {
        tm.cleanup_positions(c.precision, c.threshold, c.target_error);
    } else if let Some((threshold, target_error)) = opts.simplify {
        tm.simplify(threshold, target_error);
    }
}

struct Walk<'a, 'b> {
    cx: &'a Ctx<'a>,
    asm: &'a Assembly,
    opts: MergeOptions,
    stats: &'b mut TessStats,
    /// per-node progress hook (running count of product nodes visited)
    progress: &'b mut dyn FnMut(u32),
    processed: u32,
    /// tessellated once per PRODUCT_DEFINITION; instances clone + transform
    cache: HashMap<u32, Option<MeshSet>>,
    out: MergedBuilder,
    next_id: u32,
    budget: i64,
}

impl Walk<'_, '_> {
    fn rec(&mut self, pd: u32, name: &str, parent: u32, world: M4, depth: usize) {
        if depth > 64 || self.budget <= 0 {
            return;
        }
        self.budget -= 1;
        let id = self.next_id;
        self.next_id += 1;
        self.out.add_hierarchy(id, name, parent);
        if let Some(mut set) = self.pd_mesh(pd) {
            set.transform(&world);
            self.emit_set(id, name, &set);
        }
        if let Some(kids) = self.asm.children.get(&pd) {
            for k in kids {
                self.rec(k.child_pd, &k.name, id, world.mul(k.transform), depth + 1);
            }
        }
    }

    /// Emit one draw call per non-empty color slice of `set`. The first color
    /// reuses the element's `id`; every further color of the same element is
    /// added as its own numbered child node (same name, parented under `id`),
    /// so each draw-range id lands in exactly one color mesh and is never
    /// shared across colors.
    fn emit_set(&mut self, id: u32, name: &str, set: &MeshSet) {
        let mut first = true;
        for (color, mesh) in &set.parts {
            // wireframe (line) geometry is not part of the merged triangle layout
            if mesh.is_empty() || mesh.lines {
                continue;
            }
            let did = if first {
                first = false;
                id
            } else {
                let c = self.next_id;
                self.next_id += 1;
                self.out.add_hierarchy(c, name, id);
                c
            };
            self.out.add_bucket(did, *color, mesh);
        }
    }

    fn pd_mesh(&mut self, pd: u32) -> Option<MeshSet> {
        if let Some(cached) = self.cache.get(&pd) {
            return cached.clone();
        }
        let mut tm = MeshSet::default();
        if let Some(node) = self.asm.products.get(&pd) {
            for &sr in &node.shape_reps {
                // SHAPE_REPRESENTATION('', (items), context). Tessellate in
                // this representation's own unit (deflection scaled to match),
                // then scale the geometry into the global unit — so a
                // metre-context part in an otherwise-mm file is neither shrunk
                // away nor under-tessellated.
                let factor =
                    crate::model::rep_unit_factor(self.cx.sf, sr, self.opts.file_unit_scale);
                let rep_tp = crate::model::TessParams {
                    deflection: self.cx.tp.deflection / factor,
                    max_angle: self.cx.tp.max_angle,
                };
                let rep_cx = Ctx {
                    sf: self.cx.sf,
                    tp: &rep_tp,
                    colors: self.cx.colors,
                    threads: self.cx.threads,
                };
                let mut sub = MeshSet::default();
                if let Some(p) = self.cx.sf.params(sr) {
                    if let Some(items) = p.get(1).and_then(|v| v.as_list()) {
                        for it in items {
                            if let Some(r) = it.as_ref_id() {
                                tessellate::tessellate_item(&rep_cx, r, None, &mut sub, self.stats);
                            }
                        }
                    }
                }
                if (factor - 1.0).abs() > 1e-9 {
                    sub.transform(&M4::scale_uniform(factor));
                }
                tm.append(&sub);
            }
        }
        prepare(&mut tm, &self.opts);
        // tick after the product is actually tessellated (a cache miss = one
        // unique product's worth of work just finished), so progress never
        // shows 100% while a product's faces are still being tessellated
        self.processed += 1;
        (self.progress)(self.processed);
        let result = if tm.is_empty() { None } else { Some(tm) };
        self.cache.insert(pd, result.clone());
        result
    }
}
