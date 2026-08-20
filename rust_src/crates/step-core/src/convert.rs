//! High-level one-call conversion: STEP bytes → GLB. The embeddable entry point
//! the wasm and C-ABI shells build on (and a convenience for tests). It runs the
//! *merged* pipeline (world-baked, color-grouped) — the simplest complete path —
//! reading the input through an [`InputHandle`], spilling the binary chunk
//! through a [`TempHandle`], and streaming the container to an [`OutputHandle`].
//!
//! The CLI keeps its own richer driver (hierarchical mode, filters, `--split`,
//! cleanup passes); this is the small, dependency-light API for embedding.

use std::collections::HashMap;

use crate::geom::{M4, V3};
use crate::hierarchy::Assembly;
use crate::io::{InputHandle, OutputHandle, TempHandle};
use crate::mesh::MeshSet;
use crate::model::TessParams;
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
    convert_with_progress(input, out, tmp, opts, &mut |_, _| {})
}

/// Cook hook: turns the merged export (in memory, no GLB) into the bytes to
/// write. See [`convert_cooked`].
pub type CookHook<'a> = &'a dyn Fn(glb::MergedData) -> Result<Vec<u8>, String>;

/// Like [`convert`], but writes a cooked `.tdp`: the merged export is handed to
/// `cook` in memory, so no GLB is built or parsed. Only the merged (non
/// hierarchical) path can cook — it is the one carrying draw ranges; a
/// hierarchical build falls back to writing its GLB.
pub fn convert_cooked(
    input: Box<dyn InputHandle>,
    out: &mut dyn OutputHandle,
    tmp: &mut dyn TempHandle,
    opts: &ConvertOptions,
    cook: CookHook,
) -> Result<ConvertReport, String> {
    convert_inner(input, out, tmp, opts, &mut |_, _| {}, Some(cook))
}

/// [`convert`] with a progress callback. `progress(done, total)` fires as
/// product nodes are processed, throttled to ~5% steps (plus a 0/total at the
/// start and a total/total at the end). `total` is the product count — a
/// single-solid file simply reports one step.
pub fn convert_with_progress(
    input: Box<dyn InputHandle>,
    out: &mut dyn OutputHandle,
    tmp: &mut dyn TempHandle,
    opts: &ConvertOptions,
    progress: &mut dyn FnMut(u32, u32),
) -> Result<ConvertReport, String> {
    convert_inner(input, out, tmp, opts, progress, None)
}

#[allow(clippy::too_many_arguments)]
fn convert_inner(
    input: Box<dyn InputHandle>,
    out: &mut dyn OutputHandle,
    tmp: &mut dyn TempHandle,
    opts: &ConvertOptions,
    progress: &mut dyn FnMut(u32, u32),
    cook: Option<CookHook>,
) -> Result<ConvertReport, String> {
    let sf = StepFile::from_input(input)?;

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
    let cx = Ctx {
        sf: &sf,
        tp: &tp,
        colors: &colors,
        threads: 1,
    };
    let output_scale = if opts.unit_scale_to_meters {
        file_unit_scale
    } else {
        1.0
    };
    let mut stats = TessStats::default();
    let total = asm.products.len().max(1) as u32;
    progress(0, total);

    let color_meshes = {
        // throttle the per-node ticks to ~5% so a huge assembly doesn't spend
        // its time in the callback
        let step = (total / 20).max(1);
        let mut last = 0u32;
        let mut on_node = |done: u32| {
            if done >= last + step || done >= total {
                last = done;
                progress(done, total);
            }
        };
        if opts.merged {
            let mopts = merge::MergeOptions {
                unit_scale: output_scale,
                file_unit_scale,
                rotate_z_up: opts.rotate_z_up,
                optimize: opts.optimize,
                drop_normals: opts.drop_normals,
                cleanup: opts.cleanup.then_some(merge::Cleanup {
                    precision: 3,
                    threshold: 0.75,
                    target_error: 0.0,
                }),
                simplify: None,
            };
            let (merged, _unique) = merge::build(&cx, &asm, mopts, &mut stats, &mut on_node);
            let n = merged.bucket_count();
            match cook {
                // Direct cook: hand the buckets over and write the .tdp — no
                // GLB is assembled or streamed.
                Some(cook) => {
                    let bytes = cook(merged.into_merged())?;
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
            let builder = build_hierarchical(
                &cx,
                &asm,
                opts,
                file_unit_scale,
                output_scale,
                &mut stats,
                &mut on_node,
                tmp,
            );
            let n = builder.mesh_count();
            builder
                .finish(&opts.generator, out, tmp)
                .map_err(|e| e.to_string())?;
            n
        }
    };
    progress(total, total);

    Ok(ConvertReport {
        stats,
        color_meshes,
        unit_assumed_mm,
        unit_scale_to_meters: file_unit_scale,
        deflection_mm: opts.deflection_mm,
        warnings: sf.warnings.iter().take(10).cloned().collect(),
    })
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
                let rep_cx = Ctx {
                    sf: cx.sf,
                    tp: &rep_tp,
                    colors: cx.colors,
                    threads: cx.threads,
                };
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
