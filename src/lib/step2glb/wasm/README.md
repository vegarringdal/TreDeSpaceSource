# step-wasm (built wasm artifact)

Prebuilt wasm-pack package of the STEP converter, whose source lives in-tree
at [`rust_src/crates/step-wasm`](../../../../rust_src/crates/step-wasm)
(kernel in `step-core`). Only the built output is committed here; rebuild from
the source when it changes.

It converts a `.step`/`.stp` into one cooked `.tdp` plus its coarse variant
and a JSON diagnostics report. The app drives the streaming `StepSession`
(input read by range through OPFS sync handles, tessellation fanned out over
sub-workers, geometry spilled to disk — see `step2glbWorker.ts`); the one-shot
`convert_step_to_tdp` (whole file in RAM) is kept for tests and small inputs.

**It cooks the `.tdp` itself** — the merged model goes straight into
`cooker-core`, so no GLB is built, serialised or parsed on the import path. The
GLB writer is still there for the CLI and for debugging; `direct_cook.rs` in the
wasm crate asserts both paths cook byte-identical output.

## How to update

```
cd rust_src
CC=clang AR=llvm-ar wasm-pack build crates/step-wasm --target web --release \
  --out-dir ../../../src/lib/step2glb/wasm
```

A wasm-capable `clang` is needed (the bundled C++ meshoptimizer). Afterwards: delete the `.gitignore` wasm-pack writes into the out-dir,
keep this README, and refresh the copied manifests (they are the fallback source
for the Settings → About third-party notices):

```
cp crates/step-core/Cargo.toml ../src/lib/step2glb/wasm/step-core.Cargo.toml
cp crates/step-wasm/Cargo.toml ../src/lib/step2glb/wasm/step-wasm.Cargo.toml
```

Then regenerate notices: `npm run gen:notices`.
