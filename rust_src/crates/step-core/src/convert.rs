//! High-level one-call conversion: STEP bytes → GLB. The embeddable entry point
//! the wasm and C-ABI shells build on (and a convenience for tests). It runs the
//! *merged* pipeline (world-baked, color-grouped) — the simplest complete path —
//! reading the input through an [`InputHandle`], spilling the binary chunk
//! through a [`TempHandle`], and streaming the container to an [`OutputHandle`].
//!
//! The CLI keeps its own richer driver (hierarchical mode, filters, `--split`,
//! cleanup passes); this is the small, dependency-light API for embedding.
//!
//! Two shapes of the same pipeline: the one-call [`convert`] family, and the
//! split [`prepare`] → [`Prepared::tessellate_jobs`] → [`Prepared::finish`]
//! session the browser uses to fan tessellation out over several workers and
//! keep the coordinator's heap small (see [`crate::merge::MergeMode`]).

use std::collections::HashMap;

use crate::geom::{M4, V3};
use crate::hierarchy::Assembly;
use crate::io::{InputHandle, OutputHandle, TempHandle};
use crate::merge::{ExternalMeshes, MergeMode, MergeOptions};
use crate::mesh::MeshSet;
use crate::model::TessParams;
use crate::progress::{FaceProgress, NoProgress, Phase, ProductsOnly, ProgressSink};
use crate::styles::ColorMap;
use crate::tessellate::{Ctx, TessStats};
use crate::{glb, hierarchy, merge, model, step::StepFile, styles, tessellate};

/// Options for [`convert`]; `Default` mirrors the CLI defaults (1 mm deflection,
/// Z-up → Y-up, scale to metres).
#[derive(Clone)]
pub struct ConvertOptions {
    /// chordal deflection in millimetres (converted to the file's unit)
    pub deflection_mm: f64,
    /// max chord turn angle in degrees
    pub max_angle_deg: f64,
    /// rotate Z-up (STEP) to glTF's Y-up
    pub rotate_z_up: bool,
    /// bake the file's length unit to metres in the output
    pub unit_scale_to_meters: bool,
    /// run the meshoptimizer pass (no-op without the `optimize` feature)
    pub optimize: bool,
    /// drop vertex normals (smaller output; viewer computes flat normals)
    pub drop_normals: bool,
    /// rvm-style position cleanup (quantized weld + simplify; always drops
    /// normals). Without the `optimize` feature the simplify step is skipped —
    /// the weld + degenerate drop still apply.
    pub cleanup: bool,
    /// merged output (one node/mesh per color, baked to world space) vs the
    /// hierarchical per-part node tree with instance transforms.
    pub merged: bool,
    /// glTF `asset.generator` string
    pub generator: String,
}

impl Default for ConvertOptions {
    fn default() -> Self {
        ConvertOptions {
            deflection_mm: 1.0,
            max_angle_deg: 25.0,
            rotate_z_up: true,
            unit_scale_to_meters: true,
            optimize: cfg!(feature = "optimize"),
            drop_normals: true,
            cleanup: false,
            merged: true,
            generator: concat!("step2glb-core ", env!("CARGO_PKG_VERSION")).to_string(),
        }
    }
}

/// What happened during a conversion: the geometry tally, the issues worth
/// surfacing (skipped / unsupported / approximated entities) and the defaults
/// that were assumed (notably the length unit). Returned by [`convert`] and
/// serialised to JSON for the wasm/UI via [`ConvertReport::to_json`].
pub struct ConvertReport {
    pub stats: TessStats,
    /// number of color meshes emitted (0 ⇒ nothing tessellatable)
    pub color_meshes: usize,
    /// no length unit was declared, so millimetres were assumed
    pub unit_assumed_mm: bool,
    /// metres per file length unit (the scale baked into the output)
    pub unit_scale_to_meters: f64,
    /// the chordal deflection requested, in millimetres
    pub deflection_mm: f64,
    /// parser warnings (malformed records etc.), capped
    pub warnings: Vec<String>,
}

impl ConvertReport {
    /// Hand-rolled JSON (no serde dependency) for the wasm/UI: counts, the
    /// assumed-unit / deflection defaults, and the per-type issue tables.
    pub fn to_json(&self) -> String {
        let s = &self.stats;
        format!(
            "{{\"facesOk\":{},\"facesSkipped\":{},\"degenerateFaces\":{},\
             \"colorMeshes\":{},\"unitAssumedMillimetres\":{},\
             \"unitScaleToMetres\":{},\"deflectionMm\":{},\
             \"unsupportedSurfaces\":{},\"unsupportedCurves\":{},\
             \"unsupportedItems\":{},\"approximatedSurfaces\":{},\
             \"skippedSurfaces\":{},\"warnings\":[{}]}}",
            s.faces_ok,
            s.faces_failed,
            s.degenerate_faces,
            self.color_meshes,
            self.unit_assumed_mm,
            self.unit_scale_to_meters,
            self.deflection_mm,
            json_count_map(&s.unsupported_surfaces),
            json_count_map(&s.unsupported_curves),
            json_count_map(&s.unsupported_items),
            json_count_map(&s.approximated_surfaces),
            json_failed_map(&s.failed_surfaces),
            self.warnings
                .iter()
                .map(|w| json_str(w))
                .collect::<Vec<_>>()
                .join(","),
        )
    }
}

fn json_str(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn json_count_map(m: &HashMap<String, usize>) -> String {
    let mut entries: Vec<_> = m.iter().collect();
    entries.sort_by(|a, b| b.1.cmp(a.1).then(a.0.cmp(b.0)));
    let body = entries
        .iter()
        .map(|(k, v)| format!("{}:{}", json_str(k), v))
        .collect::<Vec<_>>()
        .join(",");
    format!("{{{}}}", body)
}

fn json_failed_map(m: &HashMap<String, (usize, Vec<u32>)>) -> String {
    let mut entries: Vec<_> = m.iter().collect();
    entries.sort_by(|a, b| b.1 .0.cmp(&a.1 .0).then(a.0.cmp(b.0)));
    let body = entries
        .iter()
        .map(|(k, (n, _))| format!("{}:{}", json_str(k), n))
        .collect::<Vec<_>>()
        .join(",");
    format!("{{{}}}", body)
}

/// Convert a STEP source to a merged GLB. Single-threaded (wasm-safe). Returns a
/// [`ConvertReport`] (stats + issues + assumed defaults), or an error string on
/// parse/IO failure.
pub fn convert(
    input: Box<dyn InputHandle>,
    out: &mut dyn OutputHandle,
    tmp: &mut dyn TempHandle,
    opts: &ConvertOptions,
) -> Result<ConvertReport, String> {
    let p = prepare(input, opts, &NoProgress)?;
    p.finish(out, tmp, None, TessStats::default(), None, &NoProgress)
}

/// Cook hook: turns the merged export (in memory, no GLB) into the bytes to
/// write. See [`convert_cooked`].
pub type CookHook<'a> = &'a dyn Fn(glb::MergedData) -> Result<Vec<u8>, String>;

/// Like [`convert`], but writes a cooked `.tdp`: the merged export is handed to
/// `cook` in memory, so no GLB is built or parsed. Only the merged (non
/// hierarchical) path can cook — it is the one carrying draw ranges; a
/// hierarchical build falls back to writing its GLB. The world-baked buckets
/// spill through `tmp` while the walk runs ([`MergeMode::Spill`]).
pub fn convert_cooked(
    input: Box<dyn InputHandle>,
    out: &mut dyn OutputHandle,
    tmp: &mut dyn TempHandle,
    opts: &ConvertOptions,
    cook: CookHook,
) -> Result<ConvertReport, String> {
    convert_cooked_with(input, out, tmp, opts, cook, &NoProgress)
}

/// [`convert_cooked`] with a phase-aware progress sink.
pub fn convert_cooked_with(
    input: Box<dyn InputHandle>,
    out: &mut dyn OutputHandle,
    tmp: &mut dyn TempHandle,
    opts: &ConvertOptions,
    cook: CookHook,
    progress: &(dyn ProgressSink + Sync),
) -> Result<ConvertReport, String> {
    let p = prepare(input, opts, progress)?;
    p.finish(out, tmp, None, TessStats::default(), Some(cook), progress)
}

/// [`convert`] with a product-progress callback. `progress(done, total)` fires
/// as product nodes are processed, throttled to ~5% steps (plus a 0/total at
/// the start and a total/total at the end). `total` is the product count — a
/// single-solid file simply reports one step. For the phase-aware form use
/// [`prepare`] + [`Prepared::finish`] with a [`ProgressSink`].
pub fn convert_with_progress(
    input: Box<dyn InputHandle>,
    out: &mut dyn OutputHandle,
    tmp: &mut dyn TempHandle,
    opts: &ConvertOptions,
    progress: &mut (dyn FnMut(u32, u32) + Send),
) -> Result<ConvertReport, String> {
    let sink = ProductsOnly(std::sync::Mutex::new(progress));
    let p = prepare(input, opts, &sink)?;
    p.finish(out, tmp, None, TessStats::default(), None, &sink)
}

// ------------------------------------------------------------------ session

/// Entity types counted as "faces" for the tessellation progress bar (an upper
/// bound: faces of products that are never placed are never tessellated).
const FACE_TYPES: &[&str] = &["ADVANCED_FACE", "FACE_SURFACE"];

/// What tessellation jobs are keyed by.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum JobKind {
    /// keys are PRODUCT_DEFINITION ids ([`merge::tessellate_product`])
    Products = 0,
    /// no product structure: keys are standalone solid ids
    /// ([`merge::tessellate_solid`], in [`merge::fallback_solids`] order)
    Solids = 1,
}

impl JobKind {
    pub fn code(self) -> u8 {
        self as u8
    }
    pub fn from_code(c: u8) -> JobKind {
        if c == 1 {
            JobKind::Solids
        } else {
            JobKind::Products
        }
    }
}

/// The independent units of tessellation work in a file: every key can be
/// tessellated on its own (by any worker, in any order) and the merge walk
/// only needs the results.
pub struct Jobs {
    pub kind: JobKind,
    pub keys: Vec<u32>,
}

/// A parsed, indexed file with its colour map and assembly — everything the
/// walk needs, held between the session's calls.
pub struct Prepared {
    sf: StepFile,
    colors: ColorMap,
    asm: Assembly,
    tp: TessParams,
    opts: ConvertOptions,
    file_unit_scale: f64,
    unit_assumed_mm: bool,
    /// faces tessellated so far by [`Self::tessellate_jobs`] (so a worker's
    /// face ticks keep counting up across batches)
    faces_done: u64,
}

/// Index the input (reporting [`Phase::Index`]), resolve the length unit, and
/// build the colour map and assembly. Nothing is tessellated yet.
pub fn prepare(
    input: Box<dyn InputHandle>,
    opts: &ConvertOptions,
    progress: &(dyn ProgressSink + Sync),
) -> Result<Prepared, String> {
    let sf = StepFile::from_input_with_progress(input, progress)?;
    prepare_file(sf, opts)
}

/// [`prepare`] from an index another session already built
/// ([`Prepared::index_blob`]) and a handle on the same bytes — a tessellation
/// sub-worker's entry: no scan, no [`Phase::Index`].
pub fn prepare_from_index(
    input: Box<dyn InputHandle>,
    blob: &[u8],
    opts: &ConvertOptions,
) -> Result<Prepared, String> {
    let sf = StepFile::from_index_blob(input, blob)?;
    prepare_file(sf, opts)
}

/// [`prepare_from_index`] with the index read by range from a handle — the
/// temp file the coordinator streamed with [`Prepared::write_index`].
pub fn prepare_from_index_file(
    input: Box<dyn InputHandle>,
    index: &dyn InputHandle,
    opts: &ConvertOptions,
) -> Result<Prepared, String> {
    let sf = StepFile::read_index(input, index)?;
    prepare_file(sf, opts)
}

fn prepare_file(sf: StepFile, opts: &ConvertOptions) -> Result<Prepared, String> {
    // length unit: deflection is given in mm and converted into the file's unit
    // so the physical tolerance is unit-independent; the same scale takes the
    // output to metres. A missing unit is a *default* worth reporting.
    let detected = model::file_length_scale(&sf);
    let unit_assumed_mm = detected.is_none();
    let file_unit_scale = detected.unwrap_or(0.001);
    let mm_per_unit = file_unit_scale * 1000.0;
    let deflection_file = if (mm_per_unit - 1.0).abs() < 1e-9 {
        opts.deflection_mm
    } else {
        opts.deflection_mm / mm_per_unit
    };

    let colors = styles::build_color_map(&sf);
    let asm = hierarchy::build(&sf);
    let tp = TessParams {
        deflection: deflection_file,
        max_angle: opts.max_angle_deg.to_radians(),
    };
    Ok(Prepared {
        sf,
        colors,
        asm,
        tp,
        opts: opts.clone(),
        file_unit_scale,
        unit_assumed_mm,
        faces_done: 0,
    })
}

impl Prepared {
    /// The file's index, serialised for [`prepare_from_index`].
    pub fn index_blob(&self) -> Vec<u8> {
        self.sf.index_blob()
    }

    /// Stream the file's index to `out` in bounded pieces, for
    /// [`prepare_from_index_file`] on the sub-workers.
    pub fn write_index(&self, out: &mut dyn OutputHandle) -> std::io::Result<()> {
        self.sf.write_index(out)
    }

    /// The tessellation work units (see [`Jobs`]).
    pub fn jobs(&self) -> Jobs {
        if self.asm.roots.is_empty() {
            return Jobs {
                kind: JobKind::Solids,
                keys: merge::fallback_solids(&self.sf),
            };
        }
        let mut keys: Vec<u32> = self.asm.products.keys().copied().collect();
        keys.sort_unstable();
        Jobs {
            kind: JobKind::Products,
            keys,
        }
    }

    /// Faces in the file — the denominator of [`Phase::Faces`].
    pub fn face_count(&self) -> u64 {
        FACE_TYPES
            .iter()
            .map(|t| self.sf.of_type(t).len() as u64)
            .sum()
    }

    pub fn product_count(&self) -> u64 {
        self.asm.products.len() as u64
    }

    pub fn warnings(&self) -> &[String] {
        &self.sf.warnings
    }

    fn output_scale(&self) -> f64 {
        if self.opts.unit_scale_to_meters {
            self.file_unit_scale
        } else {
            1.0
        }
    }

    fn merge_options(&self) -> MergeOptions {
        MergeOptions {
            unit_scale: self.output_scale(),
            file_unit_scale: self.file_unit_scale,
            rotate_z_up: self.opts.rotate_z_up,
            optimize: self.opts.optimize,
            drop_normals: self.opts.drop_normals,
            cleanup: self.opts.cleanup.then_some(merge::Cleanup {
                precision: 3,
                threshold: 0.75,
                target_error: 0.0,
            }),
            simplify: None,
        }
    }

    /// Tessellate a batch of jobs and hand each result to `sink` as a
    /// [`MeshSet::encode`] record (`key`, bytes) — what a sub-worker appends to
    /// its cache file. Face ticks go to `progress`; `stats` accumulates.
    pub fn tessellate_jobs(
        &mut self,
        kind: JobKind,
        keys: &[u32],
        stats: &mut TessStats,
        progress: &(dyn ProgressSink + Sync),
        sink: &mut dyn FnMut(u32, &[u8]) -> Result<(), String>,
    ) -> Result<(), String> {
        let fp = FaceProgress::new(self.face_count(), progress).starting_at(self.faces_done);
        let cx = Ctx {
            sf: &self.sf,
            tp: &self.tp,
            colors: &self.colors,
            threads: 1,
            faces: Some(&fp),
        };
        let mopts = self.merge_options();
        let mut bytes = Vec::new();
        for &key in keys {
            let set = match kind {
                JobKind::Products => merge::tessellate_product(&cx, &self.asm, key, &mopts, stats),
                JobKind::Solids => merge::tessellate_solid(&cx, key, stats),
            };
            bytes.clear();
            set.encode(&mut bytes);
            sink(key, &bytes)?;
        }
        self.faces_done = fp.done();
        Ok(())
    }

    /// Run the merge walk and write the output. With `cook`, the merged
    /// buckets spill through `tmp` and the cooked bytes go to `out`; the
    /// entity index is dropped before cooking so the cooker gets the heap.
    /// `external` supplies tessellated products from a fanned-out run (their
    /// tallies in `external_stats`); without it the walk tessellates here.
    /// Without `cook`, a merged build streams its GLB (in RAM) and a
    /// hierarchical build writes its per-part GLB.
    pub fn finish(
        self,
        out: &mut dyn OutputHandle,
        tmp: &mut dyn TempHandle,
        external: Option<&ExternalMeshes>,
        external_stats: TessStats,
        cook: Option<CookHook>,
        progress: &(dyn ProgressSink + Sync),
    ) -> Result<ConvertReport, String> {
        let output_scale = self.output_scale();
        let mopts = self.merge_options();
        let Prepared {
            sf,
            colors,
            asm,
            tp,
            opts,
            file_unit_scale,
            unit_assumed_mm,
            ..
        } = self;
        let warnings: Vec<String> = sf.warnings.iter().take(10).cloned().collect();
        let face_total = FACE_TYPES.iter().map(|t| sf.of_type(t).len() as u64).sum();
        let fp = FaceProgress::new(face_total, progress);
        let mut stats = external_stats;
        let total = asm.products.len().max(1) as u32;
        progress.report(Phase::Products, 0, total as u64);
        // throttle the per-node ticks to ~5% so a huge assembly doesn't spend
        // its time in the callback
        let step = (total / 20).max(1);
        let mut last = 0u32;
        let mut on_node = |done: u32| {
            if done >= last + step || done >= total {
                last = done;
                progress.report(Phase::Products, done as u64, total as u64);
            }
        };

        let color_meshes = if opts.merged {
            let merged = {
                let cx = Ctx {
                    sf: &sf,
                    tp: &tp,
                    colors: &colors,
                    threads: 1,
                    faces: Some(&fp),
                };
                let mode = match (cook.is_some(), external) {
                    (false, _) => MergeMode::InRam,
                    (true, None) => MergeMode::Spill { tmp: &mut *tmp },
                    (true, Some(meshes)) => MergeMode::External {
                        meshes,
                        tmp: &mut *tmp,
                    },
                };
                let (merged, _unique) =
                    merge::build(&cx, &asm, mopts, &mut stats, &mut on_node, mode);
                merged
            };
            if external.is_none() {
                fp.finish();
            }
            // the index and assembly are dead weight from here on: free them
            // before the cooker allocates
            drop(sf);
            drop(colors);
            drop(asm);
            let n = merged.bucket_count();
            match cook {
                // Direct cook: hand the buckets over and write the .tdp — no
                // GLB is assembled or streamed.
                Some(cook) => {
                    progress.report(Phase::Cook, 0, 1);
                    let data = merged.into_merged_spill(&*tmp).map_err(|e| e.to_string())?;
                    let bytes = cook(data)?;
                    progress.report(Phase::Write, 0, 1);
                    out.write(&bytes).map_err(|e| e.to_string())?;
                }
                None => merged
                    .write_stream(&opts.generator, out, tmp)
                    .map_err(|e| e.to_string())?,
            }
            n
        } else {
            // geometry spills into `tmp` as meshes are tessellated, so peak RAM
            // is one mesh — not the whole model; `finish` reads it back.
            let cx = Ctx {
                sf: &sf,
                tp: &tp,
                colors: &colors,
                threads: 1,
                faces: Some(&fp),
            };
            let builder = build_hierarchical(
                &cx,
                &asm,
                &opts,
                file_unit_scale,
                output_scale,
                &mut stats,
                &mut on_node,
                tmp,
            );
            fp.finish();
            let n = builder.mesh_count();
            builder
                .finish(&opts.generator, out, tmp)
                .map_err(|e| e.to_string())?;
            n
        };
        progress.report(Phase::Products, total as u64, total as u64);

        Ok(ConvertReport {
            stats,
            color_meshes,
            unit_assumed_mm,
            unit_scale_to_meters: file_unit_scale,
            deflection_mm: opts.deflection_mm,
            warnings,
        })
    }
}

/// Per-mesh finishing for the hierarchical path (mirrors the merged `prepare`):
/// drop normals, the meshoptimizer pass, then the optional position cleanup.
fn prepare_mesh(tm: &mut MeshSet, opts: &ConvertOptions) {
    if tm.is_empty() {
        return;
    }
    if opts.drop_normals {
        tm.drop_normals();
    }
    if opts.optimize {
        tm.optimize();
    }
    if opts.cleanup {
        tm.cleanup_positions(3, 0.75, 0.0);
    }
}

/// Build the hierarchical (per-part node tree, instanced) GLB: each product is
/// tessellated once (deduped by content hash), and instances become nodes with
/// their transforms — the same shape as the CLI's default output, minus the
/// `--split`/`--filter` machinery.
#[allow(clippy::too_many_arguments)]
fn build_hierarchical(
    cx: &Ctx,
    asm: &Assembly,
    opts: &ConvertOptions,
    file_unit_scale: f64,
    output_scale: f64,
    stats: &mut TessStats,
    progress: &mut dyn FnMut(u32),
    tmp: &mut dyn TempHandle,
) -> glb::GlbBuilder {
    let mut builder = glb::GlbBuilder::default();
    // pd -> (mesh index, bbox centre removed by recenter — goes back on the node)
    let mut mesh_of_pd: HashMap<u32, Option<(usize, V3)>> = HashMap::new();
    let mut mesh_of_hash: HashMap<[u8; 16], usize> = HashMap::new();
    let mut processed = 0u32;

    // tessellate + dedup one product definition's geometry into a mesh index
    let mut build_pd = |pd: u32,
                        builder: &mut glb::GlbBuilder,
                        tmp: &mut dyn TempHandle,
                        stats: &mut TessStats|
     -> Option<(usize, V3)> {
        if let Some(&cached) = mesh_of_pd.get(&pd) {
            return cached;
        }
        let mut tm = MeshSet::default();
        let name = asm
            .products
            .get(&pd)
            .map(|n| n.name.clone())
            .unwrap_or_else(|| format!("PD#{pd}"));
        if let Some(node) = asm.products.get(&pd) {
            for &sr in &node.shape_reps {
                // honour each representation's own length unit (some CAD systems
                // mix mm and metre contexts): tessellate in the rep's unit, scale in
                let factor = model::rep_unit_factor(cx.sf, sr, file_unit_scale);
                let rep_tp = TessParams {
                    deflection: cx.tp.deflection / factor,
                    max_angle: cx.tp.max_angle,
                };
                let rep_cx = cx.with_params(&rep_tp);
                let mut sub = MeshSet::default();
                if let Some(p) = cx.sf.params(sr) {
                    if let Some(list) = p.get(1).and_then(|v| v.as_list()) {
                        for it in list {
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
        prepare_mesh(&mut tm, opts);
        // tick after the product is tessellated (not before), so progress
        // never reads 100% while faces are still being worked
        processed += 1;
        progress(processed);
        let mi = if tm.is_empty() {
            None
        } else {
            // recenter before hashing: keeps f32 precision near the origin
            // (the centre rides on the node) and lets translated duplicates
            // dedup into one instanced mesh
            let center = tm.recenter();
            let h = tm.content_hash();
            let i = match mesh_of_hash.get(&h) {
                Some(&i) => i,
                None => {
                    let i = builder.add_mesh(tm, name, tmp);
                    mesh_of_hash.insert(h, i);
                    i
                }
            };
            Some((i, center))
        };
        mesh_of_pd.insert(pd, mi);
        mi
    };

    let mut budget: i64 = 2_000_000; // instance-explosion guard
    let mut top: Vec<usize> = Vec::new();
    for &root in &asm.roots {
        let name = asm
            .products
            .get(&root)
            .map(|n| n.name.clone())
            .unwrap_or_else(|| format!("PD#{root}"));
        if let Some(n) = expand(
            asm,
            root,
            &name,
            None,
            &mut builder,
            &mut build_pd,
            tmp,
            stats,
            0,
            &mut budget,
        ) {
            top.push(n);
        }
    }

    // no product structure: dump every standalone solid as one node
    if top.is_empty() {
        let mut tm = MeshSet::default();
        for ty in merge::FALLBACK_TYPES {
            for &id in cx.sf.of_type(ty) {
                tessellate::tessellate_item(cx, id, None, &mut tm, stats);
            }
        }
        prepare_mesh(&mut tm, opts);
        if !tm.is_empty() {
            let center = tm.recenter();
            let mi = builder.add_mesh(tm, "geometry".into(), tmp);
            let m = Some(M4::translate(center)).filter(|m| !m.is_identity(0.0));
            top.push(builder.add_node("root".into(), m, Some(mi)));
        }
    }

    // root transform: unit scale to metres + Z-up → Y-up
    let mut root_m = M4::scale_uniform(output_scale);
    if opts.rotate_z_up {
        root_m = M4::Z_UP_TO_Y_UP.mul(root_m);
    }
    if !root_m.is_identity(1e-12) {
        let root = builder.add_node("root_transform".into(), Some(root_m), None);
        builder.nodes[root].children = top;
        builder.root_nodes = vec![root];
    } else {
        builder.root_nodes = top;
    }
    builder
}

/// Recursively add a product node (with its mesh) and its child instances.
#[allow(clippy::too_many_arguments, clippy::type_complexity)]
fn expand(
    asm: &Assembly,
    pd: u32,
    name: &str,
    transform: Option<M4>,
    builder: &mut glb::GlbBuilder,
    build_pd: &mut dyn FnMut(
        u32,
        &mut glb::GlbBuilder,
        &mut dyn TempHandle,
        &mut TessStats,
    ) -> Option<(usize, V3)>,
    tmp: &mut dyn TempHandle,
    stats: &mut TessStats,
    depth: usize,
    budget: &mut i64,
) -> Option<usize> {
    if depth > 64 || *budget <= 0 {
        return None;
    }
    *budget -= 1;
    // Recentring moved each mesh's bbox centre off the vertices and onto the
    // node: compose it to the right of the placement (local -> recentred
    // local -> world).
    let (mesh, node_m) = match build_pd(pd, builder, tmp, stats) {
        Some((mi, center)) => {
            let t = M4::translate(center);
            let m = match transform {
                Some(m) => Some(m.mul(t)),
                None => Some(t).filter(|m| !m.is_identity(0.0)),
            };
            (Some(mi), m)
        }
        None => (None, transform),
    };
    let node = builder.add_node(name.to_string(), node_m, mesh);
    let mut children: Vec<usize> = Vec::new();
    if let Some(kids) = asm.children.get(&pd) {
        for k in kids {
            if let Some(c) = expand(
                asm,
                k.child_pd,
                &k.name,
                Some(k.transform),
                builder,
                build_pd,
                tmp,
                stats,
                depth + 1,
                budget,
            ) {
                children.push(c);
            }
        }
    }
    builder.nodes[node].children = children;
    Some(node)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::io::{MemSink, MemTemp};
    use std::sync::Mutex;

    struct Rec(Mutex<Vec<(Phase, u64, u64)>>);
    impl ProgressSink for Rec {
        fn report(&self, phase: Phase, done: u64, total: u64) {
            self.0.lock().unwrap().push((phase, done, total));
        }
    }

    /// Everything the cooker would see, flattened, for equality checks.
    fn fingerprint(m: &glb::MergedData) -> Vec<u8> {
        let mut out = Vec::new();
        for n in &m.nodes {
            for c in n.base_color {
                out.extend_from_slice(&c.to_le_bytes());
            }
            for p in &n.positions {
                out.extend_from_slice(&p.to_le_bytes());
            }
            for i in &n.indices {
                out.extend_from_slice(&i.to_le_bytes());
            }
            for (a, b, c) in &n.draw_ranges {
                out.extend_from_slice(&a.to_le_bytes());
                out.extend_from_slice(&b.to_le_bytes());
                out.extend_from_slice(&c.to_le_bytes());
            }
        }
        for (id, name, parent) in &m.hierarchy {
            out.extend_from_slice(&id.to_le_bytes());
            out.extend_from_slice(name.as_bytes());
            out.extend_from_slice(&parent.to_le_bytes());
        }
        out
    }

    fn fixture(name: &str) -> Vec<u8> {
        std::fs::read(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("tests/fixtures")
                .join(name),
        )
        .expect("fixture")
    }

    /// In-RAM merged buckets vs the spilled walk, for one file.
    fn in_ram_vs_spill(bytes: Vec<u8>) {
        let opts = ConvertOptions::default();
        let p = prepare(Box::new(bytes.clone()), &opts, &NoProgress).expect("prepare");
        let mopts = p.merge_options();
        let cx = Ctx {
            sf: &p.sf,
            tp: &p.tp,
            colors: &p.colors,
            threads: 1,
            faces: None,
        };
        let mut st = TessStats::default();
        let (ram, _) = merge::build(&cx, &p.asm, mopts, &mut st, &mut |_| {}, MergeMode::InRam);
        let mut tmp = MemTemp::default();
        let mut st2 = TessStats::default();
        let (spilled, _) = merge::build(
            &cx,
            &p.asm,
            mopts,
            &mut st2,
            &mut |_| {},
            MergeMode::Spill { tmp: &mut tmp },
        );
        assert_eq!(st.faces_ok, st2.faces_ok);
        let a = fingerprint(&ram.into_merged());
        let b = fingerprint(&spilled.into_merged_spill(&tmp).expect("read back"));
        assert!(!a.is_empty());
        assert!(a == b, "spilled buckets must match the in-RAM buckets");
    }

    #[test]
    fn spill_mode_matches_in_ram_buckets() {
        in_ram_vs_spill(fixture("as1_pe_203.stp"));
        in_ram_vs_spill(fixture("csg_block_minus_cylinder.step"));
    }

    /// Two "workers" tessellate alternating jobs into their own slots; the
    /// coordinator's walk must produce what the in-process walk produces.
    fn external_vs_in_process(bytes: Vec<u8>) {
        let opts = ConvertOptions::default();
        let sink_cook = |m: glb::MergedData| -> Result<Vec<u8>, String> { Ok(fingerprint(&m)) };

        // in-process (spill) reference
        let mut out_a = MemSink::default();
        let mut tmp_a = MemTemp::default();
        let rep_a = convert_cooked(
            Box::new(bytes.clone()),
            &mut out_a,
            &mut tmp_a,
            &opts,
            &sink_cook,
        )
        .expect("in-process");

        // fanned out: the coordinator indexes, the two "workers" are built
        // from its index blob (as the browser does) and tessellate alternate jobs
        let p = prepare(Box::new(bytes.clone()), &opts, &NoProgress).expect("prepare");
        let blob = p.index_blob();
        let jobs = p.jobs();
        let mut workers: Vec<Prepared> = (0..2)
            .map(|_| prepare_from_index(Box::new(bytes.clone()), &blob, &opts).expect("from blob"))
            .collect();
        assert_eq!(
            workers[0].jobs().keys,
            jobs.keys,
            "a blob-built session sees the same jobs"
        );
        assert_eq!(workers[0].face_count(), p.face_count());
        let mut slots: Vec<MemTemp> = vec![MemTemp::default(), MemTemp::default()];
        let mut records = HashMap::new();
        let mut stats = TessStats::default();
        for (i, chunk) in jobs.keys.chunks(1).enumerate() {
            let slot = (i % 2) as u32;
            let mut st = TessStats::default();
            let mut sink = |key: u32, rec: &[u8]| -> Result<(), String> {
                let t = &mut slots[slot as usize];
                let offset = t.len();
                t.write_at(offset, rec).map_err(|e| e.to_string())?;
                records.insert(
                    key,
                    merge::ExternalRecord {
                        slot,
                        offset,
                        len: rec.len() as u32,
                    },
                );
                Ok(())
            };
            workers[slot as usize]
                .tessellate_jobs(jobs.kind, chunk, &mut st, &NoProgress, &mut sink)
                .expect("tessellate batch");
            stats.merge(&st);
        }
        let external = ExternalMeshes {
            records,
            reader: &slots,
        };
        let mut out_b = MemSink::default();
        let mut tmp_b = MemTemp::default();
        let rep_b = p
            .finish(
                &mut out_b,
                &mut tmp_b,
                Some(&external),
                stats,
                Some(&sink_cook),
                &NoProgress,
            )
            .expect("external finish");
        assert!(!out_a.0.is_empty());
        assert!(
            out_a.0 == out_b.0,
            "external tessellation must merge identically"
        );
        assert_eq!(
            rep_a.stats.faces_ok, rep_b.stats.faces_ok,
            "worker tallies fold in"
        );
        assert_eq!(rep_a.color_meshes, rep_b.color_meshes);
    }

    #[test]
    fn external_meshes_match_in_process_walk() {
        external_vs_in_process(fixture("as1_pe_203.stp"));
        // no product structure → solid jobs
        external_vs_in_process(fixture("csg_block_minus_cylinder.step"));
    }

    #[test]
    fn phase_progress_covers_index_faces_products_cook_write() {
        let rec = Rec(Mutex::new(Vec::new()));
        let mut out = MemSink::default();
        let mut tmp = MemTemp::default();
        convert_cooked_with(
            Box::new(fixture("as1_pe_203.stp")),
            &mut out,
            &mut tmp,
            &ConvertOptions::default(),
            &|m| Ok(fingerprint(&m)),
            &rec,
        )
        .expect("convert");
        let ticks = rec.0.lock().unwrap();
        for phase in [
            Phase::Index,
            Phase::Faces,
            Phase::Products,
            Phase::Cook,
            Phase::Write,
        ] {
            assert!(ticks.iter().any(|t| t.0 == phase), "{phase:?} reported");
        }
        let faces: Vec<_> = ticks.iter().filter(|t| t.0 == Phase::Faces).collect();
        assert!(
            faces.windows(2).all(|w| w[1].1 >= w[0].1),
            "faces non-decreasing"
        );
        assert_eq!(
            faces.last().unwrap().1,
            faces.last().unwrap().2,
            "faces end full"
        );
        let idx: Vec<_> = ticks.iter().filter(|t| t.0 == Phase::Index).collect();
        assert_eq!(idx.first().unwrap().1, 0);
        assert_eq!(idx.last().unwrap().1, idx.last().unwrap().2);
    }

    #[test]
    fn convert_step_bytes_to_a_valid_glb_with_report() {
        // a CSG block-minus-cylinder (no product structure → merged fallback)
        let bytes = include_bytes!("../tests/fixtures/csg_block_minus_cylinder.step").to_vec();
        let mut out = MemSink::default();
        let mut tmp = MemTemp::default();
        let report = convert(
            Box::new(bytes),
            &mut out,
            &mut tmp,
            &ConvertOptions::default(),
        )
        .expect("convert succeeds");
        assert!(report.stats.faces_ok > 0, "geometry was produced");
        assert!(report.color_meshes > 0);
        assert!(
            report.unit_assumed_mm,
            "fixture declares no unit → mm assumed"
        );
        assert_eq!(&out.0[0..4], b"glTF", "valid GLB magic");
        let total = u32::from_le_bytes(out.0[8..12].try_into().unwrap()) as usize;
        assert_eq!(total, out.0.len(), "GLB total length matches");

        // the JSON report is well-formed-ish and carries the headline fields
        let json = report.to_json();
        assert!(json.contains("\"facesOk\":"));
        assert!(json.contains("\"unitAssumedMillimetres\":true"));
        assert!(json.starts_with('{') && json.ends_with('}'));
    }

    #[test]
    fn progress_callback_fires_monotonically_start_to_end() {
        let bytes = include_bytes!("../tests/fixtures/as1_pe_203.stp").to_vec();
        let opts = ConvertOptions {
            merged: false, // hierarchical → per-node ticks
            ..ConvertOptions::default()
        };
        let mut out = MemSink::default();
        let mut tmp = MemTemp::default();
        let mut ticks: Vec<(u32, u32)> = Vec::new();
        convert_with_progress(Box::new(bytes), &mut out, &mut tmp, &opts, &mut |d, t| {
            ticks.push((d, t))
        })
        .expect("convert");
        assert!(ticks.len() >= 2, "at least a start and an end tick");
        assert_eq!(ticks.first().unwrap().0, 0, "starts at 0");
        let total = ticks[0].1;
        assert_eq!(*ticks.last().unwrap(), (total, total), "ends at total");
        assert!(
            ticks.windows(2).all(|w| w[1].0 >= w[0].0),
            "done is non-decreasing"
        );
    }

    #[test]
    fn hierarchical_mode_also_produces_a_valid_glb() {
        // merged = false exercises the hierarchical (per-part node) path
        let bytes = include_bytes!("../tests/fixtures/as1_pe_203.stp").to_vec();
        let opts = ConvertOptions {
            merged: false,
            ..ConvertOptions::default()
        };
        let mut out = MemSink::default();
        let mut tmp = MemTemp::default();
        let report =
            convert(Box::new(bytes), &mut out, &mut tmp, &opts).expect("hierarchical convert");
        assert!(report.stats.faces_ok > 0);
        assert_eq!(&out.0[0..4], b"glTF");
        let total = u32::from_le_bytes(out.0[8..12].try_into().unwrap()) as usize;
        assert_eq!(total, out.0.len());
    }
}
