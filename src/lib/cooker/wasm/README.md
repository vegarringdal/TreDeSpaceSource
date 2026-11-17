# cooker-wasm (built wasm artifact)

Prebuilt wasm-pack package of the cooker, whose source lives in-tree at
[`rust_src/crates/cooker-wasm`](../../../../rust_src/crates/cooker-wasm) (the
pipeline is `cooker-core`, the header types `cad-format`). Only the built
output is committed here; rebuild from the source when it changes.

`cookerWorker.ts` drives it:

- `cook(glb, compute_normals, coarsen)` — a merged GLB (rvm2glb web3dversion
  2) to CADM, plus the `<id>.coarse.tdp` variant from the same parse when
  `coarsen` is set. The app always passes `compute_normals = false`; a standard
  GLB goes to the TS cook (`../cook.ts`) instead, which keeps authored normals.
- `coarsenTdp(tdp)` — rebuilds the coarse variant from an already-cooked
  `.tdp` (an import that ships no sibling).
- `cookMergedModel(...)` — cooks the viewer's own geometry straight to CADM
  (the `.tdp` export) without writing a GLB first.
- `cookerVersion()` — the cooker version.

The RVM / IFC / STEP / NWD converters embed the same `cooker-core` in their
own wasm modules, so a change to `cooker-core` needs all five rebuilt.

## How to update

```
node scripts/build-wasm.mjs cooker
```

(`npm run build:wasm` rebuilds all six modules.) It needs the Rust toolchain,
wasm-pack and a wasm-capable `clang` + `llvm-ar` — the bundled C++
meshoptimizer. The script copies the result here, keeps this README and writes
`build-info.json`: a fingerprint of the Rust sources the binary was built from
and a hash of the binary. `tests/wasmSources.test.ts` recomputes both, so **a
change to the Rust sources needs a rebuild before the tests pass**.

Afterwards run `npx vitest run tests/wasmSmoke.test.ts tests/wasmSources.test.ts`
— the smoke test checks the new binary against the other committed ones; add
`-u` only when the cooked bytes changed on purpose — and `npm run gen:notices`
if a dependency changed.
