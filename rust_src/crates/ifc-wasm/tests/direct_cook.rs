//! IFC: the direct path must cook to the SAME bytes as the GLB path.
//!
//! Same contract as the RVM test — IFC → merged GLB → `cook()` versus
//! IFC → merged model → `cook_model()`. A difference means the bridge (axis
//! flip, colour, draw ranges, hierarchy) diverged from what the GLB carried.

use std::path::PathBuf;

use cooker_core::{cook, cook_model, CookOptions};
use ifc_core::{convert, convert_cooked, ConvertOptions, OutputMode};
use ifc_wasm::to_cooker_model;

const OPTS: CookOptions = CookOptions {
    compute_normals: false,
    dense_bounds: true,
    coarsen: None,
    spatial_order: true,
};

fn samples_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../convertSamples/ifc")
}

#[test]
fn direct_cook_matches_glb_cook() {
    let Ok(entries) = std::fs::read_dir(samples_dir()) else {
        eprintln!("IFC samples missing — skipping");
        return;
    };
    let mut checked = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("ifc") {
            continue;
        }
        let Ok(bytes) = std::fs::read(&path) else { continue };
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        let opts = ConvertOptions {
            mode: OutputMode::Merged,
            source_name: name.clone(),
            ..Default::default()
        };

        let via_glb = convert(&bytes, &opts).expect("convert to glb");
        let cooked_via_glb: Vec<Vec<u8>> = via_glb
            .files
            .iter()
            .filter(|f| f.name.ends_with(".glb"))
            .map(|f| {
                cook(&f.bytes, OPTS)
                    .unwrap_or_else(|e| panic!("{name}/{}: cook: {e}", f.name))
                    .bytes
            })
            .collect();
        if cooked_via_glb.is_empty() {
            continue;
        }

        let direct = convert_cooked(&bytes, &opts, &|merged, _stem| {
            cook_model(to_cooker_model(merged), OPTS)
                .map(|o| o.bytes)
                .map_err(|e| e.to_string())
        })
        .expect("convert cooked");
        let cooked_direct: Vec<Vec<u8>> = direct
            .files
            .iter()
            .filter(|f| f.name.ends_with(".tdp"))
            .map(|f| f.bytes.clone())
            .collect();

        assert_eq!(
            cooked_via_glb.len(),
            cooked_direct.len(),
            "{name}: output count"
        );
        for (i, (a, b)) in cooked_via_glb.iter().zip(cooked_direct.iter()).enumerate() {
            assert_eq!(a.len(), b.len(), "{name}[{i}]: cooked size");
            assert!(a == b, "{name}[{i}]: cooked bytes differ (GLB vs direct)");
        }
        checked += 1;
    }
    assert!(checked > 0, "no IFC sample produced geometry to compare");
    eprintln!("{checked} IFC sample(s) cooked identically both ways");
}
