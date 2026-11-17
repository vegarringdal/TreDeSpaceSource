# step-wasm (built wasm artifact)

Prebuilt wasm-pack package of the STEP converter, whose source lives in-tree
at [`rust_src/crates/step-wasm`](../../../../rust_src/crates/step-wasm)
(kernel in `step-core`). Only the built output is committed here; rebuild from
the source when it changes.

It converts a `.step`/`.stp` into one cooked `.tdp` plus its coarse variant
and a JSON diagnostics report. The app drives the streaming `StepSession`
(input read by range through OPFS sync handles, tessellation fanned out over
sub-workers, geometry spilled to disk — see `step2glbWorker.ts`); the one-shot
`convert_step_to_tdp` (whole file in RAM) is kept for the tests (`wasmSmoke`);
the app never calls it.

**It cooks the `.tdp` itself** — the merged model goes straight into
`cooker-core`, so no GLB is built, serialised or parsed on the import path. The
GLB writer is still there for the CLI and for debugging; `direct_cook.rs` in the
wasm crate asserts both paths cook byte-identical output.

## How to update

```
node scripts/build-wasm.mjs step2glb
```

(`npm run build:wasm` rebuilds all six modules.) It needs the Rust toolchain,
wasm-pack and a wasm-capable `clang` + `llvm-ar` — the bundled C++
meshoptimizer. The script copies the result here, keeps this README,
refreshes the copied manifests (the fallback source for the Settings → About
third-party notices) and writes `build-info.json`: a fingerprint of the Rust
sources the binary was built from and a hash of the binary.
`tests/wasmSources.test.ts` recomputes both, so **a change to the Rust
sources needs a rebuild before the tests pass**.

Afterwards run `npx vitest run tests/wasmSmoke.test.ts tests/wasmSources.test.ts`
— the smoke test checks the new binary against the other committed ones; add
`-u` only when the cooked bytes changed on purpose — and `npm run gen:notices`
if a dependency changed.
