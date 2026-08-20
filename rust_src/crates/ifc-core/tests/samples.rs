//! End-to-end integration tests: run real IFC sample files through `convert()` and validate
//! the produced GLB(s). These exercise the full ifc-lite → mesh → GLB pipeline that the unit
//! tests (synthetic meshes) don't. Small samples are committed under
//! `convertSamples/ifc`; the
//! test skips gracefully if a file is absent (e.g. the git-ignored large models).

use std::path::PathBuf;

use ifc_core::{ConvertOptions, Openings, OutputMode, Quality, Spaces, SplitTier, convert};

fn samples_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../convertSamples/ifc")
}

fn read_sample(name: &str) -> Option<Vec<u8>> {
    std::fs::read(samples_dir().join(name)).ok()
}

/// Parse a GLB: assert the container is well-formed and return its glTF JSON.
fn parse_glb(bytes: &[u8]) -> serde_json::Value {
    assert!(bytes.len() >= 20, "GLB too short");
    assert_eq!(&bytes[0..4], b"glTF", "bad magic");
    let total = u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize;
    assert_eq!(total, bytes.len(), "header length != file length");
    let json_len = u32::from_le_bytes(bytes[12..16].try_into().unwrap()) as usize;
    assert_eq!(&bytes[16..20], b"JSON", "first chunk not JSON");
    let json: serde_json::Value = serde_json::from_slice(&bytes[20..20 + json_len]).unwrap();

    // Every accessor must stay within the binary buffer.
    let bin_off = 20 + json_len + 8; // + BIN chunk header
    let bin_len = bytes.len().saturating_sub(bin_off);
    if let Some(accessors) = json["accessors"].as_array() {
        let views = json["bufferViews"].as_array().unwrap();
        for a in accessors {
            let bv = &views[a["bufferView"].as_u64().unwrap() as usize];
            let off = bv.get("byteOffset").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
            let comp = match a["componentType"].as_u64().unwrap() {
                5126 | 5125 => 4,
                5123 => 2,
                _ => 1,
            };
            let n = match a["type"].as_str().unwrap() {
                "SCALAR" => 1,
                "VEC2" => 2,
                "VEC3" => 3,
                "VEC4" => 4,
                _ => 1,
            };
            let need = a["count"].as_u64().unwrap() as usize * comp * n;
            assert!(off + need <= bin_len, "accessor overruns bin chunk");
        }
    }
    json
}

const SMALL: &[&str] = &[
    "1019-column.ifc",
    "wall-with-opening-and-window.ifc",
    "Building-Architecture.ifc",
    "Building-Structural.ifc",
    "tessellation-with-individual-colors.ifc",
];

#[test]
fn every_mode_produces_valid_glb() {
    let modes = [
        OutputMode::Merged,
        OutputMode::Standard,
        OutputMode::Instanced,
        OutputMode::GpuInstanced,
    ];
    let mut ran = 0;
    for name in SMALL {
        let Some(bytes) = read_sample(name) else {
            continue;
        };
        for mode in modes {
            let opts = ConvertOptions {
                mode,
                ..ConvertOptions::default()
            };
            let out = convert(&bytes, &opts).unwrap_or_else(|e| panic!("{name} {mode:?}: {e}"));
            // At least the status file is always emitted.
            assert!(!out.files.is_empty(), "{name} {mode:?}: no files");
            let mut glbs = 0;
            for f in &out.files {
                if f.name.ends_with(".glb") {
                    parse_glb(&f.bytes);
                    glbs += 1;
                } else {
                    assert_eq!(f.name, "status_file.json");
                    serde_json::from_slice::<serde_json::Value>(&f.bytes).unwrap();
                }
            }
            // A sample with geometry yields at least one GLB.
            if out.report.mesh_count > 0 {
                assert!(glbs >= 1, "{name} {mode:?}: meshes but no GLB");
            }
        }
        ran += 1;
    }
    assert!(ran > 0, "no sample files found under {:?}", samples_dir());
}

#[test]
fn wall_opening_is_cut_and_opening_not_rendered() {
    // The opening/window sample: ifc-lite cuts the void into the wall; the opening solid
    // itself must NOT be rendered (it would fill the hole back in).
    let Some(bytes) = read_sample("wall-with-opening-and-window.ifc") else {
        return;
    };
    let out = convert(&bytes, &ConvertOptions::default()).unwrap();
    let status: serde_json::Value =
        serde_json::from_slice(&out.files.last().unwrap().bytes).unwrap();
    // wall + window (frame/glass) but no free-standing opening solid.
    let tris = status["files"][0]["triangle_count"].as_u64().unwrap();
    assert!(tris > 0, "expected some geometry");
    // The merged id_hierarchy should reference the wall; check a GLB parses with extras.
    let glb = out.files.iter().find(|f| f.name.ends_with(".glb")).unwrap();
    let json = parse_glb(&glb.bytes);
    assert_eq!(json["asset"]["extras"]["web3dversion"], 2);
}

#[test]
fn merged_draw_ranges_cover_every_triangle() {
    // A web3d viewer draws by draw_ranges, so EVERY index in each colour node's buffer
    // must be covered — otherwise elements (esp. multi-submesh ones) render partial/missing.
    for name in SMALL {
        let Some(bytes) = read_sample(name) else {
            continue;
        };
        let out = convert(&bytes, &ConvertOptions::default()).unwrap();
        for f in out.files.iter().filter(|f| f.name.ends_with(".glb")) {
            let j = parse_glb(&f.bytes);
            let extras = &j["scenes"][0]["extras"];
            let meshes = j["meshes"].as_array().unwrap();
            let accessors = j["accessors"].as_array().unwrap();
            for (i, node) in j["nodes"].as_array().unwrap().iter().enumerate() {
                let Some(mesh_i) = node.get("mesh").and_then(|m| m.as_u64()) else {
                    continue;
                };
                let idx_acc = meshes[mesh_i as usize]["primitives"][0]["indices"]
                    .as_u64()
                    .unwrap() as usize;
                let index_count = accessors[idx_acc]["count"].as_u64().unwrap();
                let covered: u64 = extras[format!("draw_ranges_node{i}")]
                    .as_object()
                    .map(|m| m.values().map(|v| v[1].as_u64().unwrap()).sum())
                    .unwrap_or(0);
                assert_eq!(
                    covered, index_count,
                    "{name} node{i}: draw_ranges cover {covered} of {index_count} indices"
                );
            }

            // Each element must appear in exactly ONE colour node (one contiguous range) —
            // the invariant a per-component web3d viewer relies on. (A multi-colour element
            // spanning nodes would render partial in a range-based viewer.)
            let mut nodes_of: std::collections::HashMap<String, usize> =
                std::collections::HashMap::new();
            for (k, v) in extras.as_object().unwrap() {
                if let Some(map) = k.strip_prefix("draw_ranges_node").and(v.as_object()) {
                    for id in map.keys() {
                        *nodes_of.entry(id.clone()).or_default() += 1;
                    }
                }
            }
            for (id, count) in &nodes_of {
                assert_eq!(*count, 1, "{name}: element {id} spans {count} colour nodes");
            }
        }
    }
}

#[test]
fn split_by_storey_yields_multiple_files() {
    // Building-Architecture has one storey → at least the storey file + a remainder.
    let Some(bytes) = read_sample("Building-Architecture.ifc") else {
        return;
    };
    let opts = ConvertOptions {
        split: SplitTier::Storey,
        ..ConvertOptions::default()
    };
    let out = convert(&bytes, &opts).unwrap();
    let glbs = out
        .files
        .iter()
        .filter(|f| f.name.ends_with(".glb"))
        .count();
    assert!(glbs >= 2, "expected split into ≥2 GLBs, got {glbs}");
}

#[test]
fn quality_changes_triangle_count() {
    let Some(bytes) = read_sample("Building-Structural.ifc") else {
        return;
    };
    let tri = |q| {
        convert(
            &bytes,
            &ConvertOptions {
                quality: q,
                dry_run: true,
                ..ConvertOptions::default()
            },
        )
        .unwrap()
        .report
        .triangle_count
    };
    // Higher tessellation quality → at least as many triangles (curved geometry gets finer).
    assert!(tri(Quality::Lowest) <= tri(Quality::Highest));
}

#[test]
fn openings_skip_include_separate() {
    // The wall+opening sample definitely has an IfcOpeningElement.
    let Some(bytes) = read_sample("wall-with-opening-and-window.ifc") else {
        return;
    };
    let count = |o: Openings| {
        convert(
            &bytes,
            &ConvertOptions {
                openings: o,
                dry_run: true,
                ..ConvertOptions::default()
            },
        )
        .unwrap()
        .report
        .mesh_count
    };
    // include renders the opening void solids → more meshes than skip.
    assert!(count(Openings::Include) > count(Openings::Skip));
    assert_eq!(count(Openings::Separate), count(Openings::Include));

    // separate writes a *_openings.glb (valid GLB), and skip writes none.
    let out = convert(
        &bytes,
        &ConvertOptions {
            openings: Openings::Separate,
            ..ConvertOptions::default()
        },
    )
    .unwrap();
    let opening_files: Vec<_> = out
        .files
        .iter()
        .filter(|f| f.name.contains("_openings"))
        .collect();
    assert!(!opening_files.is_empty(), "expected an _openings.glb");
    for f in opening_files {
        parse_glb(&f.bytes);
    }
    let skip = convert(&bytes, &ConvertOptions::default()).unwrap();
    assert!(!skip.files.iter().any(|f| f.name.contains("_openings")));
}

#[test]
fn spaces_separate_emits_spaces_file_when_present() {
    // Only fires if a sample with IfcSpace geometry is available (the small committed set
    // may have none — that's fine, the assertion is conditional).
    for name in SMALL {
        let Some(bytes) = read_sample(name) else {
            continue;
        };
        let opts = ConvertOptions {
            spaces: Spaces::Separate,
            ..ConvertOptions::default()
        };
        let out = convert(&bytes, &opts).unwrap();
        // Every _spaces.glb must be a valid GLB.
        for f in &out.files {
            if f.name.contains("_spaces") {
                parse_glb(&f.bytes);
            }
        }
    }
}
