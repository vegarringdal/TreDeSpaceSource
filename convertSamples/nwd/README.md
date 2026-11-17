# convertSamples/nwd — freely licensed NWD inputs for `cargo test` (nwd-core, nwd-wasm)

The files the test suite reads, committed unpacked so the NWD tests run straight after a clone
(`cargo test --workspace` also needs the IFC samples: run `convertSamples/ifc/fetch-samples.sh`
first). Each folder's README gives source, licence and attribution.

| Folder | Files | Licence | Tests |
|---|---|---|---|
| [`huldra/`](huldra/README.md) | 3 NWDs from Equinor's Huldra plant model (RVM loader) | Equinor open data terms | `rust_src/crates/nwd-core/tests/huldra.rs` + unit tests in `chunk8.rs`, `hierarchy.rs`, `convert.rs` |
| [`aps-params-test-desks/`](aps-params-test-desks/README.md) | 1 small Revit-loader NWD | MIT | `rust_src/crates/nwd-core/tests/free_sample_extra.rs` |
| [`clash-detection-matrix-automation/`](clash-detection-matrix-automation/README.md) | 5 Revit-loader NWCs + their NWF | BSD-2-Clause | `rust_src/crates/nwd-core/tests/free_sample_extra.rs` |
| [`zenodo-20765669/`](zenodo-20765669/README.md) | 1 NWF without geometry | CC BY 4.0 | `rust_src/crates/nwd-core/tests/free_sample_extra.rs` |

How the reader was made, and what it can and cannot promise, is in the repository README
under *Supported files*.

The full Huldra dataset (all 23 NWDs, the source RVMs + attribute `.txt` files and the
Navisworks FBX export, ~600 MB zipped) is not committed — see
[`huldra/README.md`](huldra/README.md) for where to get it. The expected values in the tests
were validated against it; the results are recorded in
`rust_src/crates/nwd-core/docs/what_we_know_v1.md`.
