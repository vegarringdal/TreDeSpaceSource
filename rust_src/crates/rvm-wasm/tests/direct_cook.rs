//! The direct path must cook to the SAME bytes as the GLB path.
//!
//! RVM → merged GLB → `cook()` is what the app shipped before; RVM → merged
//! model → `cook_model()` is the GLB-free path. Both walk the identical meshlet
//! / quantise / pack pipeline, so a difference here is a bug in the bridge
//! (axis flip, colour conversion, draw-range or hierarchy mapping), not a
//! tolerated variation. Skips when the Huldra sample is absent.

use std::path::PathBuf;

use cooker_core::{cook, cook_model, CookOptions};
use rvm_core::io::MemSink;
use rvm_core::{convert, convert_cooked, ConvertOptions};
use rvm_wasm::to_cooker_model;

const OPTS: CookOptions = CookOptions {
    compute_normals: false,
    dense_bounds: true,
    coarsen: None,
    spatial_order: true,
};

fn sample() -> Option<Vec<u8>> {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../convertSamples/rvm/HA-STRU.RVM");
    std::fs::read(p).ok()
}

fn opts() -> ConvertOptions {
    ConvertOptions {
        source_name: "HA-STRU.RVM".into(),
        ..Default::default()
    }
}

#[test]
fn direct_cook_matches_glb_cook() {
    let Some(rvm) = sample() else {
        eprintln!("Huldra sample missing — skipping");
        return;
    };

    // Path A: RVM → GLB (serialised) → cook.
    let mut glb_sink = MemSink::new();
    convert(
        Box::new(rvm.clone()),
        &mut glb_sink,
        &opts(),
        &mut |_p| {},
    )
    .expect("convert to glb");
    let cooked_via_glb: Vec<(String, Vec<u8>)> = glb_sink
        .into_files()
        .into_iter()
        .filter(|(name, _)| name.ends_with(".glb"))
        .map(|(name, glb)| {
            let out = cook(&glb, OPTS).unwrap_or_else(|e| panic!("cook {name}: {e}"));
            (name.replace(".glb", ".tdp"), out.bytes)
        })
        .collect();
    assert!(!cooked_via_glb.is_empty(), "no site GLBs produced");

    // Path B: RVM → merged model → cook. No GLB anywhere.
    let mut tdp_sink = MemSink::new();
    convert_cooked(
        Box::new(rvm),
        &mut tdp_sink,
        &opts(),
        &mut |_p| {},
        Box::new(|merged, _name| {
            cook_model(to_cooker_model(merged), OPTS)
                .map(|out| out.bytes)
                .map_err(|e| e.to_string())
        }),
    )
    .expect("convert cooked");
    let cooked_direct: Vec<(String, Vec<u8>)> = tdp_sink
        .into_files()
        .into_iter()
        .filter(|(name, _)| name.ends_with(".tdp"))
        .collect();

    assert_eq!(
        cooked_via_glb.len(),
        cooked_direct.len(),
        "site count differs"
    );
    for ((glb_name, glb_bytes), (direct_name, direct_bytes)) in
        cooked_via_glb.iter().zip(cooked_direct.iter())
    {
        assert_eq!(glb_name, direct_name, "output name");
        assert_eq!(
            glb_bytes.len(),
            direct_bytes.len(),
            "{glb_name}: cooked size ({} B via GLB vs {} B direct)",
            glb_bytes.len(),
            direct_bytes.len()
        );
        assert!(
            glb_bytes == direct_bytes,
            "{glb_name}: cooked bytes differ between the GLB path and the direct path"
        );
    }
    eprintln!("{} site(s) cooked identically both ways", cooked_direct.len());
}
