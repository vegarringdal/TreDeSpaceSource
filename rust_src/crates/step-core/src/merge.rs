//! rvm_parser_glb-style merged export: walk the assembly, bake every instance
//! to world space (meters, Y-up) and merge all geometry sharing a color into
//! one mesh, recording per-part draw ranges and the instance tree for the
//! scene `extras`. See [`crate::glb::MergedBuilder`] for the output layout.
//!
//! Three [`MergeMode`]s feed the walk. [`MergeMode::InRam`] is the original
//! all-on-the-heap build (the GLB writer and CLI). [`MergeMode::Spill`] keeps
//! the same tessellation but parks every world-baked bucket — and the local
//! mesh of any product used more than once — in a temp handle, so the heap
//! holds one product at a time. [`MergeMode::External`] additionally takes the
//! tessellated products from records other workers produced (see
//! [`crate::convert::Prepared::tessellate_jobs`]), so the walk itself never
//! tessellates. All three produce byte-identical buckets.

use std::collections::HashMap;

use crate::geom::M4;
use crate::glb::MergedBuilder;
use crate::hierarchy::Assembly;
use crate::io::{read_all_at, SlotReader, TempHandle};
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

/// One tessellated product (or standalone solid) another worker produced:
/// where its [`MeshSet::encode`] record sits in that worker's cache slot.
#[derive(Clone, Copy, Debug)]
pub struct ExternalRecord {
    pub slot: u32,
    pub offset: u64,
    pub len: u32,
}

/// The tessellation results of a fanned-out run, keyed by product definition
/// id (or standalone solid id in the no-structure fallback).
pub struct ExternalMeshes<'r> {
    pub records: HashMap<u32, ExternalRecord>,
    pub reader: &'r dyn SlotReader,
}

impl ExternalMeshes<'_> {
    /// Decode one record; `None` when the key is unknown or the record is
    /// unreadable (both mean "no geometry").
    pub fn read(&self, key: u32) -> Option<MeshSet> {
        let rec = *self.records.get(&key)?;
        let bytes = read_all_at(
            |o, b| self.reader.read_at(rec.slot, o, b),
            rec.offset,
            rec.len as usize,
        );
        if bytes.len() != rec.len as usize {
            return None;
        }
        MeshSet::decode(&bytes)
    }
}

/// Where the walk gets product meshes from and where the buckets go.
pub enum MergeMode<'m> {
    /// tessellate here; buckets and the instance cache live on the heap
    InRam,
    /// tessellate here; buckets and multi-instance meshes spill to `tmp`
    Spill { tmp: &'m mut dyn TempHandle },
    /// products were tessellated elsewhere; buckets spill to `tmp`
    External {
        meshes: &'m ExternalMeshes<'m>,
        tmp: &'m mut dyn TempHandle,
    },
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
    mode: MergeMode,
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
        refs: instance_counts(asm),
        out: MergedBuilder::default(),
        next_id: 1,
        budget: INSTANCE_BUDGET,
        mode,
        hot: HotMeshes::default(),
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
        match &w.mode {
            MergeMode::External { meshes, .. } => {
                for &id in &fallback_solids(cx.sf) {
                    if let Some(sub) = meshes.read(id) {
                        tm.append(&sub);
                    }
                }
            }
            _ => {
                for &id in &fallback_solids(cx.sf) {
                    tessellate::tessellate_item(cx, id, None, &mut tm, w.stats);
                }
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
    let unique = w
        .cache
        .values()
        .filter(|m| !matches!(m, Cached::Empty))
        .count();
    let mut out = w.out;
    // world-baked buffers: pull the scene's bbox centre out of the f32
    // positions and onto the bucket nodes (f32 precision + viewer stability
    // for models sited far from the origin)
    out.recenter();
    (out, unique)
}

/// Standalone solids of every [`FALLBACK_TYPES`] type, in the order the
/// no-structure fallback tessellates them.
pub fn fallback_solids(sf: &crate::step::StepFile) -> Vec<u32> {
    let mut ids = Vec::new();
    for ty in FALLBACK_TYPES {
        ids.extend_from_slice(sf.of_type(ty));
    }
    ids
}

/// Instance-explosion guard: the walk places at most this many nodes.
const INSTANCE_BUDGET: i64 = 2_000_000;
/// Deepest assembly nesting the walk follows.
const MAX_DEPTH: usize = 64;

/// How many times the walk will visit each product definition — the number of
/// placement *paths*, not tree edges (a part placed twice under a sub-assembly
/// that is itself placed twice is visited four times). Mirrors [`Walk::rec`]'s
/// depth and budget cut-offs exactly, so a product counted once is never
/// asked for a second time and needs no cache entry.
fn instance_counts(asm: &Assembly) -> HashMap<u32, u32> {
    fn rec(asm: &Assembly, pd: u32, depth: usize, budget: &mut i64, refs: &mut HashMap<u32, u32>) {
        if depth > MAX_DEPTH || *budget <= 0 {
            return;
        }
        *budget -= 1;
        *refs.entry(pd).or_insert(0) += 1;
        if let Some(kids) = asm.children.get(&pd) {
            for k in kids {
                rec(asm, k.child_pd, depth + 1, budget, refs);
            }
        }
    }
    let mut refs: HashMap<u32, u32> = HashMap::new();
    let mut budget = INSTANCE_BUDGET;
    for &root in &asm.roots {
        rec(asm, root, 0, &mut budget, &mut refs);
    }
    refs
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

/// Tessellate one product definition into its local-space, prepared mesh:
/// every shape representation in its own length unit (deflection rescaled to
/// match), scaled into the global unit, then the per-part cleanup pipeline.
/// The unit of work a tessellation sub-worker performs; the walk's cache
/// holds exactly this.
pub fn tessellate_product(
    cx: &Ctx,
    asm: &Assembly,
    pd: u32,
    opts: &MergeOptions,
    stats: &mut TessStats,
) -> MeshSet {
    let mut tm = MeshSet::default();
    if let Some(node) = asm.products.get(&pd) {
        for &sr in &node.shape_reps {
            // SHAPE_REPRESENTATION('', (items), context). Tessellate in
            // this representation's own unit (deflection scaled to match),
            // then scale the geometry into the global unit — so a
            // metre-context part in an otherwise-mm file is neither shrunk
            // away nor under-tessellated.
            let factor = crate::model::rep_unit_factor(cx.sf, sr, opts.file_unit_scale);
            let rep_tp = crate::model::TessParams {
                deflection: cx.tp.deflection / factor,
                max_angle: cx.tp.max_angle,
            };
            let rep_cx = cx.with_params(&rep_tp);
            let mut sub = MeshSet::default();
            if let Some(p) = cx.sf.params(sr) {
                if let Some(items) = p.get(1).and_then(|v| v.as_list()) {
                    for it in items {
                        if let Some(r) = it.as_ref_id() {
                            tessellate::tessellate_item(&rep_cx, r, None, &mut sub, stats);
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
    prepare(&mut tm, opts);
    tm
}

/// Tessellate one standalone solid (the no-structure fallback's unit of
/// work). Raw — the fallback runs `prepare` once over all solids together.
pub fn tessellate_solid(cx: &Ctx, id: u32, stats: &mut TessStats) -> MeshSet {
    let mut sub = MeshSet::default();
    tessellate::tessellate_item(cx, id, None, &mut sub, stats);
    sub
}

/// Byte budget of the hot cache of decoded instance meshes (see
/// [`HotMeshes`]); the working set of a bolt placed ten thousand times.
const HOT_CACHE_BYTES: usize = 64 * 1024 * 1024;

/// A small, byte-bounded cache of decoded meshes in front of the spill/cache
/// files: a product placed many times is read from disk and decoded once per
/// eviction, not once per placement. Evicts oldest-inserted first (FIFO is
/// enough — placements of one product cluster in the walk).
#[derive(Default)]
struct HotMeshes {
    meshes: HashMap<u32, MeshSet>,
    order: std::collections::VecDeque<u32>,
    bytes: usize,
}

impl HotMeshes {
    fn get(&self, key: u32) -> Option<&MeshSet> {
        self.meshes.get(&key)
    }

    fn insert(&mut self, key: u32, set: &MeshSet) {
        let size = mesh_bytes(set);
        if size > HOT_CACHE_BYTES / 4 {
            return;
        }
        while self.bytes + size > HOT_CACHE_BYTES {
            let Some(old) = self.order.pop_front() else {
                break;
            };
            if let Some(m) = self.meshes.remove(&old) {
                self.bytes -= mesh_bytes(&m);
            }
        }
        self.bytes += size;
        self.order.push_back(key);
        self.meshes.insert(key, set.clone());
    }
}

fn mesh_bytes(set: &MeshSet) -> usize {
    set.parts
        .iter()
        .map(|(_, m)| m.positions.len() * 8 + m.normals.len() * 4 + m.indices.len() * 4)
        .sum()
}

/// What the walk remembers about a product it has already met.
enum Cached {
    /// tessellated to nothing
    Empty,
    /// kept on the heap (in-RAM mode)
    Ram(MeshSet),
    /// parked in the temp handle (spill mode; multi-instance products only)
    Spilled { offset: u64, len: u32 },
    /// external mode: already read once (progress bookkeeping only)
    Seen,
}

struct Walk<'a, 'b, 'm> {
    cx: &'a Ctx<'a>,
    asm: &'a Assembly,
    opts: MergeOptions,
    stats: &'b mut TessStats,
    /// per-node progress hook (running count of product nodes visited)
    progress: &'b mut dyn FnMut(u32),
    processed: u32,
    /// tessellated once per PRODUCT_DEFINITION; instances clone + transform
    cache: HashMap<u32, Cached>,
    /// placements per product definition (see [`instance_counts`])
    refs: HashMap<u32, u32>,
    out: MergedBuilder,
    next_id: u32,
    budget: i64,
    mode: MergeMode<'m>,
    /// decoded meshes of recently placed multi-instance products
    hot: HotMeshes,
}

impl Walk<'_, '_, '_> {
    fn rec(&mut self, pd: u32, name: &str, parent: u32, world: M4, depth: usize) {
        if depth > MAX_DEPTH || self.budget <= 0 {
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
            let Walk { out, mode, .. } = self;
            match mode {
                MergeMode::InRam => out.add_bucket(did, *color, mesh),
                MergeMode::Spill { tmp } | MergeMode::External { tmp, .. } => {
                    // a temp write failure is unrecoverable for the run; the
                    // truncated chunk surfaces as an error at read-back
                    let _ = out.add_bucket_spill(did, *color, mesh, *tmp);
                }
            }
        }
    }

    /// One product tessellated (or fetched) — the progress unit.
    fn tick(&mut self) {
        self.processed += 1;
        (self.progress)(self.processed);
    }

    fn pd_mesh(&mut self, pd: u32) -> Option<MeshSet> {
        if let Some(set) = self.hot.get(pd) {
            return Some(set.clone());
        }
        match self.cache.get(&pd) {
            Some(Cached::Empty) => return None,
            Some(Cached::Ram(set)) => return Some(set.clone()),
            Some(Cached::Spilled { offset, len }) => {
                let (offset, len) = (*offset, *len as usize);
                let tmp: &dyn TempHandle = match &self.mode {
                    MergeMode::Spill { tmp } | MergeMode::External { tmp, .. } => &**tmp,
                    MergeMode::InRam => return None,
                };
                let bytes = read_all_at(|o, b| tmp.read_at(o, b), offset, len);
                let set = MeshSet::decode(&bytes)?;
                self.hot.insert(pd, &set);
                return Some(set);
            }
            Some(Cached::Seen) | None => {}
        }
        if let MergeMode::External { meshes, .. } = &self.mode {
            let set = meshes.read(pd).filter(|s| !s.is_empty());
            if !matches!(self.cache.get(&pd), Some(Cached::Seen)) {
                self.cache.insert(pd, Cached::Seen);
                self.tick();
            }
            if let Some(set) = &set {
                if self.refs.get(&pd).copied().unwrap_or(1) > 1 {
                    self.hot.insert(pd, set);
                }
            }
            return set;
        }
        let tm = tessellate_product(self.cx, self.asm, pd, &self.opts, self.stats);
        // tick after the product is actually tessellated (a cache miss = one
        // unique product's worth of work just finished), so progress never
        // shows 100% while a product's faces are still being tessellated
        self.tick();
        if tm.is_empty() {
            self.cache.insert(pd, Cached::Empty);
            return None;
        }
        let multi = self.refs.get(&pd).copied().unwrap_or(1) > 1;
        match &mut self.mode {
            MergeMode::InRam => {
                self.cache.insert(pd, Cached::Ram(tm.clone()));
            }
            MergeMode::Spill { tmp } if multi => {
                let mut bytes = Vec::new();
                tm.encode(&mut bytes);
                let offset = tmp.len();
                if tmp.write_at(offset, &bytes).is_ok() {
                    self.cache.insert(
                        pd,
                        Cached::Spilled {
                            offset,
                            len: bytes.len() as u32,
                        },
                    );
                }
            }
            // a single-use product is never asked for again
            _ => {}
        }
        Some(tm)
    }
}
