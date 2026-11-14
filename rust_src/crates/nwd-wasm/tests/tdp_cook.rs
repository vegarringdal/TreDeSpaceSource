//! NWD → .tdp: every root's merged GLB, cooked in memory, must be a valid
//! CADM file — the same bytes the app would get by importing that GLB
//! (`cook_glb` IS the cooker's GLB path) — and the cook must be deterministic.

use std::path::PathBuf;

use nwd_core::convert::{convert_stream, ConvertOptions};
use nwd_wasm::cook_glb;

fn sample(rel: &str) -> Option<Vec<u8>> {
    std::fs::read(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../convertSamples/nwd")
            .join(rel),
    )
    .ok()
}

/// (root GLB name, full .tdp, coarse .tdp) per root.
fn cook_all(nwd: &[u8], name: &str) -> Vec<(String, Vec<u8>, Vec<u8>)> {
    let mut out = Vec::new();
    convert_stream(nwd, &ConvertOptions::default(), name, &mut |file, data| {
        if let Some(stem) = file.strip_suffix(".glb") {
            let (full, coarse) = cook_glb(data, false, true).expect("cook");
            out.push((stem.to_string(), full, coarse.expect("coarse requested")));
        }
        Ok(())
    })
    .expect("convert");
    out
}

fn assert_cadm(b: &[u8]) {
    assert_eq!(&b[..4], b"CADM", "not a cooked .tdp");
    let version = u32::from_le_bytes(b[4..8].try_into().unwrap());
    assert!((7..=9).contains(&version), "CADM version {version}");
}

#[test]
fn revit_sample_cooks_to_tdp() {
    let Some(nwd) = sample("aps-params-test-desks/params_test_desks.nwd") else {
        eprintln!("sample missing — skipping");
        return;
    };
    let a = cook_all(&nwd, "params_test_desks.nwd");
    assert_eq!(a.len(), 1);
    for (_, full, coarse) in &a {
        assert_cadm(full);
        assert_cadm(coarse);
    }
    let b = cook_all(&nwd, "params_test_desks.nwd");
    assert!(
        a.iter().zip(&b).all(|(x, y)| x.1 == y.1 && x.2 == y.2),
        "cook is not deterministic"
    );
}

#[test]
fn huldra_assembly_cooks_every_root() {
    let Some(nwd) = sample("huldra/HDA-ASB-HA.nwd") else {
        eprintln!("Huldra sample missing — skipping");
        return;
    };
    let roots = cook_all(&nwd, "HDA-ASB-HA.nwd");
    assert!(
        roots.len() > 1,
        "an assembly NWD yields one .tdp per RVM root"
    );
    for (name, full, _) in &roots {
        assert_cadm(full);
        assert!(!name.is_empty());
    }
}
