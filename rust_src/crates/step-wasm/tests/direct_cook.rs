//! STEP: the direct path must cook to the SAME bytes as the GLB path.
//!
//! Same contract as the RVM and IFC tests — STEP → merged GLB → `cook()` versus
//! STEP → merged model → `cook_model()`. A difference means the bridge (axis
//! flip, colour, draw ranges, hierarchy) diverged from what the GLB carried.

use std::path::PathBuf;

use cooker_core::{cook, cook_model, CookOptions};
use step_core::convert::{convert, convert_cooked, ConvertOptions};
use step_core::io::{MemSink, MemTemp};
use step_wasm::to_cooker_model;

const OPTS: CookOptions = CookOptions {
    compute_normals: false,
    dense_bounds: true,
    coarsen: None,
    spatial_order: true,
};

fn fixtures() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../step-core/tests/fixtures")
}

/// The viewer's settings: merged output, Z-up → Y-up baked in.
fn opts() -> ConvertOptions {
    ConvertOptions {
        rotate_z_up: true,
        ..Default::default()
    }
}

#[test]
fn direct_cook_matches_glb_cook() {
    let Ok(entries) = std::fs::read_dir(fixtures()) else {
        eprintln!("STEP fixtures missing — skipping");
        return;
    };
    let mut paths: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            matches!(
                p.extension().and_then(|e| e.to_str()),
                Some("step") | Some("stp")
            )
        })
        .collect();
    paths.sort();

    let mut checked = 0;
    for path in paths {
        let Ok(bytes) = std::fs::read(&path) else { continue };
        let name = path.file_name().unwrap().to_string_lossy().to_string();

        // Path A: STEP → GLB → cook.
        let mut glb_out = MemSink(Vec::new());
        let mut glb_tmp = MemTemp(Vec::new());
        if convert(
            Box::new(bytes.clone()),
            &mut glb_out,
            &mut glb_tmp,
            &opts(),
        )
        .is_err()
        {
            continue;
        }
        if glb_out.0.is_empty() {
            continue;
        }
        let Ok(from_glb) = cook(&glb_out.0, OPTS) else {
            // fixtures with no draw ranges (wireframe-only) aren't cookable
            continue;
        };

        // Path B: STEP → merged model → cook. No GLB anywhere.
        let mut tdp_out = MemSink(Vec::new());
        let mut tdp_tmp = MemTemp(Vec::new());
        convert_cooked(
            Box::new(bytes),
            &mut tdp_out,
            &mut tdp_tmp,
            &opts(),
            &|merged| {
                cook_model(to_cooker_model(merged), OPTS)
                    .map(|o| o.bytes)
                    .map_err(|e| e.to_string())
            },
        )
        .unwrap_or_else(|e| panic!("{name}: convert cooked: {e}"));

        assert_eq!(
            from_glb.bytes.len(),
            tdp_out.0.len(),
            "{name}: cooked size ({} B via GLB vs {} B direct)",
            from_glb.bytes.len(),
            tdp_out.0.len()
        );
        assert!(
            from_glb.bytes == tdp_out.0,
            "{name}: cooked bytes differ between the GLB path and the direct path"
        );
        checked += 1;
    }
    assert!(checked > 0, "no STEP fixture produced a cookable model");
    eprintln!("{checked} STEP fixture(s) cooked identically both ways");
}
