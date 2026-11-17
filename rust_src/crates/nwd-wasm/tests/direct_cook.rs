//! The direct path must cook to the SAME bytes as the GLB path.
//!
//! NWD → merged GLB → `cook_glb()` is what the app shipped before; NWD →
//! merged model → `cook_merged()` is the GLB-free path it uses now. Both walk
//! the identical weld / meshlet / quantise / pack pipeline, so a difference
//! here is a bug in the bridge (axis flip, colour, draw-range or hierarchy
//! mapping), not a tolerated variation. Every committed sample is checked;
//! a missing one is skipped.

use std::path::PathBuf;

use nwd_core::convert::{convert_stream, convert_stream_cooked, ConvertOptions};
use nwd_wasm::{cook_glb, cook_merged, to_cooker_model};

const SAMPLES: [&str; 9] = [
    "huldra/HDA-ASB-CD2.nwd",
    "huldra/HDA-ASB-HA.nwd",
    "huldra/Huldra_Asbuilt.nwd",
    "aps-params-test-desks/params_test_desks.nwd",
    "clash-detection-matrix-automation/Architectural.nwc",
    "clash-detection-matrix-automation/Structural.nwc",
    "clash-detection-matrix-automation/Mechanical.nwc",
    "clash-detection-matrix-automation/Plumbing.nwc",
    "clash-detection-matrix-automation/Electrical.nwc",
];

fn sample(rel: &str) -> Option<Vec<u8>> {
    std::fs::read(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../convertSamples/nwd")
            .join(rel),
    )
    .ok()
}

/// Every file a conversion emits, in order: `(name, bytes)`.
type Files = Vec<(String, Vec<u8>)>;

/// Path A: NWD → merged GLB per root → the cooker's GLB path.
fn via_glb(nwd: &[u8], name: &str, opts: &ConvertOptions) -> Files {
    let mut out = Files::new();
    convert_stream(nwd, opts, name, &mut |file, data| {
        if let Some(stem) = file.strip_suffix(".glb") {
            let (full, coarse) = cook_glb(data, false, true).expect("cook glb");
            out.push((
                format!("{stem}.coarse.tdp"),
                coarse.expect("coarse requested"),
            ));
            out.push((format!("{stem}.tdp"), full));
        }
        Ok(())
    })
    .expect("convert to glb");
    out
}

/// Path B: NWD → merged model per root → the cooker, no GLB. Returns the
/// cooked files and the status file's `models[].file_name` list.
fn direct(nwd: &[u8], name: &str, opts: &ConvertOptions) -> (Files, Vec<String>) {
    let mut out = Files::new();
    let mut status = Vec::new();
    convert_stream_cooked(
        nwd,
        opts,
        name,
        &mut |merged, stem| {
            let (full, coarse) = cook_merged(to_cooker_model(merged), false, true)?;
            Ok(vec![
                (
                    format!("{stem}.coarse.tdp"),
                    coarse.expect("coarse requested"),
                ),
                (format!("{stem}.tdp"), full),
            ])
        },
        &mut |file, data| {
            if file == "status_file.json" {
                status = data.to_vec();
            } else {
                out.push((file.to_string(), data.to_vec()));
            }
            Ok(())
        },
    )
    .expect("convert cooked");
    let doc: serde_json::Value = serde_json::from_slice(&status).expect("status json");
    let names = doc["models"]
        .as_array()
        .expect("models")
        .iter()
        .map(|m| m["file_name"].as_str().expect("file_name").to_string())
        .collect();
    (out, names)
}

fn assert_same(rel: &str, opts: &ConvertOptions) {
    let Some(nwd) = sample(rel) else {
        eprintln!("{rel} missing — skipping");
        return;
    };
    let a = via_glb(&nwd, rel, opts);
    let (b, status_names) = direct(&nwd, rel, opts);
    assert_eq!(
        a.iter().map(|f| &f.0).collect::<Vec<_>>(),
        b.iter().map(|f| &f.0).collect::<Vec<_>>(),
        "{rel}: the two paths emit different files"
    );
    for ((name, via), (_, dir)) in a.iter().zip(&b) {
        assert!(
            via == dir,
            "{rel}: {name} differs ({} bytes via GLB, {} direct)",
            via.len(),
            dir.len()
        );
    }
    // the status file names the cooked file of every root
    let cooked: Vec<&String> = b
        .iter()
        .map(|f| &f.0)
        .filter(|n| !n.ends_with(".coarse.tdp"))
        .collect();
    assert_eq!(
        cooked,
        status_names.iter().collect::<Vec<_>>(),
        "{rel}: status models"
    );
}

#[test]
fn direct_cook_matches_glb_cook() {
    for rel in SAMPLES {
        assert_same(rel, &ConvertOptions::default());
    }
}

/// The options the app's import can change: lines, weld precision, units.
#[test]
fn direct_cook_matches_glb_cook_with_import_options() {
    let opts = ConvertOptions {
        include_line: true,
        line_width: 0.01,
        cleanup_precision: 3,
        ..ConvertOptions::default()
    };
    for rel in [
        "huldra/HDA-ASB-HA.nwd",
        "aps-params-test-desks/params_test_desks.nwd",
    ] {
        assert_same(rel, &opts);
    }
}
