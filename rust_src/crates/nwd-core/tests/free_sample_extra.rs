//! Regression tests on the extra freely licensed samples in
//! `convertSamples/nwd/<dir>/` (see each folder's README for source + licence).

use nwd_core::convert::{convert_stream, ConvertOptions, ConvertReport, UnitScale, FEET_TO_METRES};
use nwd_core::Result;

fn load(rel: &str) -> Vec<u8> {
    let p = format!(
        "{}/../../../convertSamples/nwd/{rel}",
        env!("CARGO_MANIFEST_DIR")
    );
    std::fs::read(&p).unwrap_or_else(|e| panic!("{p}: {e}"))
}

/// Scene-extras JSON of a merged GLB.
fn glb_extras(glb: &[u8]) -> serde_json::Value {
    let jl = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
    let doc: serde_json::Value = serde_json::from_slice(&glb[20..20 + jl]).unwrap();
    doc["scenes"][0]["extras"].clone()
}

/// Parse the scene tree and the placement frames of a non-RVM file.
fn tree_and_frames(
    bytes: &[u8],
) -> (
    nwd_core::hierarchy::Tree,
    Vec<nwd_core::fragments::InternedFrag>,
    u32,
) {
    let c = nwd_core::Container::parse(bytes).unwrap();
    let (mut tree, mut frames, mut declared) = (None, Vec::new(), 0u32);
    for i in 0..c.chunks.len() {
        let d = c.data(i);
        if tree.is_none() && nwd_core::inspect::looks_like_hierarchy(&d) {
            tree = nwd_core::hierarchy::parse_tree(&d);
        }
        if let Some(v) = nwd_core::fragments::interned_placements(&d) {
            if v.len() >= frames.len() {
                declared = u32::from_le_bytes(d[0..4].try_into().unwrap());
                frames = v;
            }
        }
    }
    (tree.expect("the scene tree parses"), frames, declared)
}

/// Convert a sample, keeping every output file.
fn convert_all(
    bytes: &[u8],
    opts: &ConvertOptions,
    name: &str,
) -> (ConvertReport, Vec<(String, Vec<u8>)>) {
    let mut files: Vec<(String, Vec<u8>)> = Vec::new();
    let r = convert_stream(bytes, opts, name, &mut |file, data| {
        files.push((file.to_string(), data.to_vec()));
        Ok(())
    })
    .expect(name);
    (r, files)
}

fn with_units(unit_scale: UnitScale) -> ConvertOptions {
    ConvertOptions {
        unit_scale,
        ..Default::default()
    }
}

fn extent(r: &ConvertReport) -> [f32; 3] {
    [0, 1, 2].map(|k| r.bbox_max[k] - r.bbox_min[k])
}

/// The `notes` array of a conversion's status file (absent = empty).
fn status_notes(files: &[(String, Vec<u8>)]) -> Vec<String> {
    let status = &files
        .iter()
        .find(|(f, _)| f == "status_file.json")
        .expect("status_file.json")
        .1;
    let doc: serde_json::Value = serde_json::from_slice(status).unwrap();
    doc.get("notes")
        .and_then(|n| n.as_array())
        .map(|n| n.iter().map(|s| s.as_str().unwrap().to_string()).collect())
        .unwrap_or_default()
}

/// Revit-loader NWD (MIT, aps-params-test-desks): SIX instances of one
/// M_Desk family (1525 x 762 mm), stored in FEET. The geometry is defined
/// once (3 fragments: top, legs, body); the other five desks are placement
/// frames that REFERENCE those fragments under their own transforms, and tree
/// nodes that reference the first desk's subtree. The default (automatic)
/// unit scale brings it to metres; `Factor(1.0)` keeps the stored feet.
#[test]
fn revit_desk_six_instances_of_one_family() {
    let bytes = load("aps-params-test-desks/params_test_desks.nwd");
    let (r, files) = convert_all(&bytes, &ConvertOptions::default(), "params_test_desks.nwd");
    assert_eq!(r.geometries, 3);
    assert_eq!((r.fragments, r.placed, r.linked), (18, 18, 18), "{r:?}");
    assert_eq!(r.triangles, 6 * 328, "{r:?}");
    // A 3 x 2 grid of desks (glTF axes: x, up, depth). AS STORED, in feet, one
    // desk is 5.128 x 2.5 x 2.688 ft (1563 x 762 x 819 mm — the 1525 x 762 mm
    // desk plus its top overhang); columns are 15.318 ft apart, rows 9.278 ft.
    let feet = [2.0 * 15.318 + 5.128f32, 2.5, 9.278 + 2.688];
    let (stored, stored_files) = convert_all(
        &bytes,
        &with_units(UnitScale::Factor(1.0)),
        "params_test_desks.nwd",
    );
    assert_eq!(stored.unit_scale, 1.0);
    for (got, want) in extent(&stored).iter().zip(feet) {
        assert!((got - want).abs() < 0.01, "stored extent {stored:?}");
    }
    assert!(status_notes(&stored_files).is_empty());
    // AUTOMATIC: the Revit loader is recognised and the output is in metres —
    // the desks are 0.762 m high, the grid spans 10.9 x 3.65 m.
    assert_eq!(r.unit_scale, FEET_TO_METRES);
    let ext = extent(&r);
    assert!((ext[1] - 0.762).abs() < 0.0005, "desk height {ext:?}");
    for (got, want) in ext.iter().zip(feet) {
        assert!((got - want * 0.3048).abs() < 0.004, "extent {ext:?}");
    }
    assert!((r.bbox_min[1]).abs() < 1e-6, "desks stand on the floor");
    assert_eq!(
        status_notes(&files),
        ["Revit export: geometry scaled from feet to metres (× 0.3048)"]
    );
    // One GLB for the single root (the level), with the real tree in it.
    assert!(files.iter().any(|(f, _)| f == "status_file.json"));
    let glb = &files
        .iter()
        .find(|(f, _)| f == "Level_1.glb")
        .expect("Level_1.glb")
        .1;
    let ex = glb_extras(glb);
    let hier = ex["id_hierarchy"].as_object().unwrap();
    assert_eq!(hier.len(), 34); // 4 group nodes + 6 x (instance, composite, 3 solids)
    let named = |n: &str| hier.values().filter(|v| v[0] == n).count();
    assert_eq!(
        (
            named("M_Desk"),
            named("Cherry"),
            named("Steel, Chrome Plated")
        ),
        (7, 6, 6)
    );
    // every one of the 18 solids is its own selectable element
    let ranges: usize = ex
        .as_object()
        .unwrap()
        .iter()
        .filter(|(k, _)| k.starts_with("draw_ranges_"))
        .map(|(_, v)| v.as_object().unwrap().len())
        .sum();
    assert_eq!(ranges, 18);

    // The two streams agree instance by instance: a part's frame translation
    // minus its instance node's translation is the same vector for all six
    // desks (the part's offset inside the family).
    let (tree, frames, declared) = tree_and_frames(&bytes);
    assert_eq!((declared, frames.len(), tree.instance_refs), (18, 18, 5));
    assert_eq!(frames.iter().filter(|f| f.instanced).count(), 15);
    let mut offsets: Vec<[f64; 3]> = Vec::new();
    for (i, t) in tree.translations.iter().enumerate() {
        let Some(t) = t else { continue };
        // the instance's first solid is 2 nodes below it (instance, composite, solid)
        let f = frames
            .iter()
            .find(|f| f.group as usize == i + 3)
            .expect("frame of the first solid");
        offsets.push([
            f.translation[0] - t[0],
            f.translation[1] - t[1],
            f.translation[2] - t[2],
        ]);
    }
    assert_eq!(offsets.len(), 6);
    for o in &offsets {
        for k in 0..3 {
            assert!((o[k] - offsets[0][k]).abs() < 1e-6, "{offsets:?}");
        }
    }
}

/// NWF (CC BY 4.0, zenodo-20765669): no geometry of its own — conversion
/// succeeds with an empty result and the status file names the referenced NWCs.
#[test]
fn nwf_converts_empty_and_names_its_references() {
    let bytes = load("zenodo-20765669/Final-Project_main.nwf");
    let mut status = String::new();
    let mut sink = |name: &str, data: &[u8]| -> Result<()> {
        if name == "status_file.json" {
            status = String::from_utf8_lossy(data).into_owned();
        }
        Ok(())
    };
    let r = convert_stream(
        &bytes,
        &ConvertOptions::default(),
        "Final-Project_main.nwf",
        &mut sink,
    )
    .expect("an NWF must not be an error");
    assert_eq!(r.geometries, 0);
    assert_eq!(r.triangles, 0);
    assert!(status.contains("Str_Plans_951028.nwc"), "{status}");
    assert!(status.contains("ARCH_ARC_F2_951128.nwc"), "{status}");
}

/// Five Revit-loader NWCs of one building (BSD-2,
/// clash-detection-matrix-automation). Every placement FRAME the header
/// declares is read — including the frames that re-use an earlier fragment
/// (instanced families: 4,487 of the structure's 4,706 placements) — each
/// lands on a geometry leaf of the scene tree, and every leaf of the tree
/// owns at least one frame. All disciplines stay in one vertical envelope
/// (the structure is 0–74 ft high). Frames of LINE records are placed only
/// with `include_line`; the default conversion leaves them out.
#[test]
fn revit_building_frames_and_tree_agree() {
    // (file, frames, instanced frames, expanded leaves, min up, max up, GLBs,
    //  line frames)
    let cases = [
        ("Structural.nwc", 4706, 4487, 638, 0.0f32, 74.0f32, 5, 0),
        ("Architectural.nwc", 4732, 1893, 1826, -11.0, 76.3, 8, 96),
        ("Mechanical.nwc", 191, 40, 147, 8.0, 78.4, 2, 0),
        ("Plumbing.nwc", 172, 34, 125, -13.2, 75.0, 2, 1),
        ("Electrical.nwc", 48, 0, 48, 0.0, 10.3, 1, 0),
    ];
    for (name, n_frames, n_inst, n_leaves, lo, hi, n_glb, n_lines) in cases {
        let bytes = load(&format!("clash-detection-matrix-automation/{name}"));
        let (tree, frames, declared) = tree_and_frames(&bytes);
        assert_eq!(
            (declared as usize, frames.len()),
            (n_frames, n_frames),
            "{name}"
        );
        assert_eq!(
            frames.iter().filter(|f| f.instanced).count(),
            n_inst,
            "{name}"
        );
        let mut owned = vec![false; tree.nodes.len()];
        for f in &frames {
            let leaf = tree.nodes.get(f.group as usize - 1).filter(|n| n.geometry);
            assert!(
                leaf.is_some(),
                "{name}: frame group {} is not a leaf",
                f.group
            );
            owned[f.group as usize - 1] = true;
        }
        let leaves = tree.nodes.iter().filter(|n| n.geometry).count();
        assert_eq!(leaves, n_leaves, "{name}");
        assert_eq!(
            owned.iter().filter(|o| **o).count(),
            leaves,
            "{name}: a leaf without a frame"
        );

        let mut glbs = 0;
        let mut sink = |f: &str, _: &[u8]| -> Result<()> {
            glbs += f.ends_with(".glb") as usize;
            Ok(())
        };
        let with_lines = ConvertOptions {
            include_line: true,
            ..Default::default()
        };
        let r = convert_stream(&bytes, &with_lines, name, &mut sink).expect(name);
        assert_eq!(
            (r.fragments, r.placed, r.linked, r.lines),
            (n_frames, n_frames, n_frames, n_lines),
            "{name}: {r:?}"
        );
        assert_eq!(glbs, n_glb, "{name}: one GLB per level");
        // Lines are opt-in: the default conversion places every frame but
        // the line ones (and still links all of them).
        let off = convert_stream(&bytes, &ConvertOptions::default(), name, &mut |_, _| Ok(()))
            .expect(name);
        assert_eq!(
            (off.fragments, off.placed, off.linked, off.lines),
            (n_frames, n_frames - n_lines, n_frames, 0),
            "{name}: {off:?}"
        );
        assert_eq!(off.triangles < r.triangles, n_lines > 0, "{name}");
        // All five are recognised as Revit exports (four name the file reader
        // `lcldrevit`, `Structural.nwc` the exporter add-in `nwexportrevit`)
        // and come out in metres; the table above is in the stored feet.
        assert_eq!(r.unit_scale, FEET_TO_METRES, "{name}");
        let (min_ft, max_ft) = (r.bbox_min[1] / r.unit_scale, r.bbox_max[1] / r.unit_scale);
        assert!(
            (min_ft - lo).abs() < 0.1 && (max_ft - hi).abs() < 0.1,
            "{name}: {r:?}"
        );
        // inside the building's vertical envelope (structure top + parapet)
        assert!(min_ft > -15.0 && max_ft < 80.0, "{name}: {r:?}");
    }
}

/// Triangles a GLB actually stores (after the weld dropped the degenerate ones).
fn glb_triangles(glb: &[u8]) -> usize {
    let jl = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
    let doc: serde_json::Value = serde_json::from_slice(&glb[20..20 + jl]).unwrap();
    let meshes = doc["meshes"].as_array().cloned().unwrap_or_default();
    meshes
        .iter()
        .flat_map(|m| m["primitives"].as_array().unwrap())
        .map(|p| {
            let accessor = p["indices"].as_u64().unwrap() as usize;
            doc["accessors"][accessor]["count"].as_u64().unwrap() as usize / 3
        })
        .sum()
}

/// "Include lines" with every other option at its default (weld on, default
/// precision and line width): the option changes the output, and the weld
/// drops none of the line crosses' triangles.
#[test]
fn revit_lines_are_opt_in_and_survive_the_default_weld() {
    let bytes = load("clash-detection-matrix-automation/Architectural.nwc");
    // (triangles placed, triangles stored in the GLBs)
    let run = |opts: &ConvertOptions| -> (usize, usize) {
        let mut stored = 0;
        let mut sink = |f: &str, d: &[u8]| -> Result<()> {
            if f.ends_with(".glb") {
                stored += glb_triangles(d);
            }
            Ok(())
        };
        let r = convert_stream(&bytes, opts, "Architectural.nwc", &mut sink).expect("convert");
        (r.triangles, stored)
    };
    let off = run(&ConvertOptions::default());
    let on = run(&ConvertOptions {
        include_line: true,
        ..Default::default()
    });
    let line_triangles = on.0 - off.0;
    assert_eq!(
        line_triangles, 2328,
        "96 line frames, 4 triangles a segment"
    );
    assert_eq!(on.1 - off.1, line_triangles, "the weld ate line triangles");
}

/// The loader signal behind the automatic unit scale: the plugin slots of
/// every sample. Revit files name a Revit plugin and nothing else; the Huldra
/// NWDs name the RVM reader only; an NWF names none.
#[test]
fn loader_plugin_slots_tell_revit_from_rvm() {
    use nwd_core::inspect::{classify_except, geometry_chunks_by_index, Loaders};
    let loaders_of = |rel: &str| -> Loaders {
        let bytes = load(rel);
        let c = nwd_core::Container::parse(&bytes).unwrap();
        let geom = geometry_chunks_by_index(&c).map_or(Vec::new(), |(idxs, _)| idxs);
        classify_except(&c, &geom)
            .iter()
            .fold(Loaders::default(), |acc, i| acc.merge(i.loaders))
    };
    for rel in [
        "aps-params-test-desks/params_test_desks.nwd",
        "clash-detection-matrix-automation/Architectural.nwc",
        "clash-detection-matrix-automation/Electrical.nwc",
        "clash-detection-matrix-automation/Mechanical.nwc",
        "clash-detection-matrix-automation/Plumbing.nwc",
        "clash-detection-matrix-automation/Structural.nwc",
    ] {
        let l = loaders_of(rel);
        assert!(l.revit && !l.other && l.revit_only(), "{rel}: {l:?}");
    }
    for rel in [
        "huldra/HDA-ASB-CD2.nwd",
        "huldra/HDA-ASB-HA.nwd",
        "huldra/Huldra_Asbuilt.nwd",
    ] {
        let l = loaders_of(rel);
        assert!(!l.revit && l.other && !l.revit_only(), "{rel}: {l:?}");
    }
    for rel in [
        "clash-detection-matrix-automation/Coordination.nwf",
        "zenodo-20765669/Final-Project_main.nwf",
    ] {
        assert_eq!(loaders_of(rel), Loaders::default(), "{rel}");
    }
}

/// An RVM-loader file is metres already: the automatic unit scale leaves it
/// alone — factor 1, no status note, and every output byte equal to the
/// explicit "as stored" conversion.
#[test]
fn huldra_is_left_as_stored_by_the_automatic_unit_scale() {
    for name in ["HDA-ASB-CD2.nwd", "HDA-ASB-HA.nwd"] {
        let bytes = load(&format!("huldra/{name}"));
        let (auto, auto_files) = convert_all(&bytes, &ConvertOptions::default(), name);
        let (stored, stored_files) = convert_all(&bytes, &with_units(UnitScale::Factor(1.0)), name);
        assert_eq!((auto.unit_scale, stored.unit_scale), (1.0, 1.0), "{name}");
        assert_eq!(
            (auto.bbox_min, auto.bbox_max),
            (stored.bbox_min, stored.bbox_max)
        );
        assert!(auto_files == stored_files, "{name}: outputs differ");
        assert!(status_notes(&auto_files).is_empty(), "{name}");
    }
}

/// An explicit factor scales everything positional linearly — the report
/// bbox, the status-file bbox and the GLB accessor bounds — on both placement
/// paths (RVM fragments, Revit frames) and in both output modes; it is not
/// announced by a status note. The report bbox is of the placed points; the
/// other two are of the WELDED output, so they follow to within half a cell
/// of the 1 mm weld grid. A factor that is not a positive number is ignored.
#[test]
fn explicit_unit_factor_scales_linearly() {
    use nwd_core::convert::OutputMode;
    let close = |a: f32, b: f32| (a - b).abs() <= 1e-4 * b.abs().max(1.0);
    let welded = |a: f32, b: f32| (a - b).abs() <= 0.0006 + 1e-4 * b.abs();
    for (rel, name) in [
        ("huldra/HDA-ASB-CD2.nwd", "HDA-ASB-CD2.nwd"),
        (
            "aps-params-test-desks/params_test_desks.nwd",
            "params_test_desks.nwd",
        ),
    ] {
        let bytes = load(rel);
        for mode in [OutputMode::Merged, OutputMode::Standard] {
            let opts = |unit_scale| ConvertOptions {
                mode,
                unit_scale,
                ..Default::default()
            };
            let (base, base_files) = convert_all(&bytes, &opts(UnitScale::Factor(1.0)), name);
            for factor in [0.001f32, 0.0254, 2.0, 1000.0] {
                let (r, files) = convert_all(&bytes, &opts(UnitScale::Factor(factor)), name);
                assert_eq!(r.unit_scale, factor, "{name}");
                assert_eq!(
                    (r.placed, r.linked, r.triangles),
                    (base.placed, base.linked, base.triangles)
                );
                for k in 0..3 {
                    assert!(
                        close(r.bbox_min[k], base.bbox_min[k] * factor)
                            && close(r.bbox_max[k], base.bbox_max[k] * factor),
                        "{name} x{factor}: {r:?} vs {base:?}"
                    );
                }
                assert!(status_notes(&files).is_empty(), "{name}");
                // status-file bbox of every root, and its GLB's POSITION bounds
                let status = |f: &[(String, Vec<u8>)]| -> serde_json::Value {
                    serde_json::from_slice(&f.iter().find(|x| x.0 == "status_file.json").unwrap().1)
                        .unwrap()
                };
                let (st, st_base) = (status(&files), status(&base_files));
                let models = st["models"].as_array().unwrap();
                assert_eq!(models.len(), st_base["models"].as_array().unwrap().len());
                for (m, mb) in models.iter().zip(st_base["models"].as_array().unwrap()) {
                    for key in ["min_x", "min_y", "min_z", "max_x", "max_y", "max_z"] {
                        let (v, vb) = (m[key].as_f64().unwrap(), mb[key].as_f64().unwrap());
                        assert!(
                            welded(v as f32, vb as f32 * factor),
                            "{name} {key}: {v} vs {vb}"
                        );
                    }
                }
                let top = |f: &[(String, Vec<u8>)]| -> f64 {
                    f.iter()
                        .filter(|x| x.0.ends_with(".glb"))
                        .flat_map(|x| glb_position_max(&x.1))
                        .fold(f64::NEG_INFINITY, f64::max)
                };
                assert!(
                    welded(top(&files) as f32, top(&base_files) as f32 * factor),
                    "{name} x{factor}: accessor bounds"
                );
            }
            for bad in [0.0f32, -1.0, f32::NAN, f32::INFINITY] {
                let (r, files) = convert_all(&bytes, &opts(UnitScale::Factor(bad)), name);
                assert_eq!(r.unit_scale, 1.0, "{name}: factor {bad}");
                assert!(
                    files == base_files,
                    "{name}: factor {bad} changed the output"
                );
            }
        }
    }
}

/// The largest `max` component over a GLB's POSITION accessors.
fn glb_position_max(glb: &[u8]) -> Vec<f64> {
    let jl = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
    let doc: serde_json::Value = serde_json::from_slice(&glb[20..20 + jl]).unwrap();
    doc["accessors"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|a| a["type"] == "VEC3")
        .filter_map(|a| a["max"].as_array())
        .flatten()
        .filter_map(|v| v.as_f64())
        .collect()
}

/// Lengths are OUTPUT units. The automatic conversion of a Revit file equals
/// an explicit `ft` one byte for byte (GLBs; only the status note differs).
/// And the line crosses come out `line_width` METRES wide whatever the
/// factor: with a model scaled down a hundredfold, crosses built 5 mm wide in
/// MODEL units would be 50 µm in the output and vanish in the 1 mm weld —
/// built at the output width, every line triangle is still stored.
#[test]
fn revit_weld_and_line_width_are_in_output_units() {
    let bytes = load("clash-detection-matrix-automation/Plumbing.nwc");
    let opts = |include_line, unit_scale| ConvertOptions {
        include_line,
        unit_scale,
        ..Default::default()
    };
    let glbs = |f: &[(String, Vec<u8>)]| -> Vec<(String, Vec<u8>)> {
        f.iter()
            .filter(|x| x.0.ends_with(".glb"))
            .cloned()
            .collect()
    };
    let stored =
        |f: &[(String, Vec<u8>)]| -> usize { glbs(f).iter().map(|x| glb_triangles(&x.1)).sum() };
    let (auto, auto_files) = convert_all(&bytes, &opts(true, UnitScale::Auto), "Plumbing.nwc");
    let (feet, feet_files) = convert_all(
        &bytes,
        &opts(true, UnitScale::Factor(FEET_TO_METRES)),
        "Plumbing.nwc",
    );
    assert_eq!(
        (auto.unit_scale, feet.unit_scale),
        (FEET_TO_METRES, FEET_TO_METRES)
    );
    assert!(
        glbs(&auto_files) == glbs(&feet_files),
        "auto != explicit ft"
    );
    assert_eq!(status_notes(&auto_files).len(), 1);
    assert!(status_notes(&feet_files).is_empty());

    for factor in [FEET_TO_METRES, 0.01] {
        let unit_scale = UnitScale::Factor(factor);
        let (on, on_files) = convert_all(&bytes, &opts(true, unit_scale), "Plumbing.nwc");
        let (off, off_files) = convert_all(&bytes, &opts(false, unit_scale), "Plumbing.nwc");
        let line_triangles = on.triangles - off.triangles;
        // one line frame of eight segments, 4 triangles a segment
        assert_eq!((on.lines, line_triangles), (1, 32), "x{factor}");
        assert_eq!(
            stored(&on_files) - stored(&off_files),
            line_triangles,
            "x{factor}: the weld ate line triangles"
        );
    }
}

/// Its NWF names the five NWCs it federates.
#[test]
fn revit_building_nwf_names_the_five_nwcs() {
    let bytes = load("clash-detection-matrix-automation/Coordination.nwf");
    let mut status = String::new();
    let mut sink = |name: &str, data: &[u8]| -> Result<()> {
        if name == "status_file.json" {
            status = String::from_utf8_lossy(data).into_owned();
        }
        Ok(())
    };
    let r = convert_stream(
        &bytes,
        &ConvertOptions::default(),
        "Coordination.nwf",
        &mut sink,
    )
    .expect("nwf");
    assert_eq!(r.triangles, 0);
    for n in [
        "Architectural.nwc",
        "Structural.nwc",
        "Mechanical.nwc",
        "Plumbing.nwc",
        "Electrical.nwc",
    ] {
        assert!(status.contains(n), "{status}");
    }
}
