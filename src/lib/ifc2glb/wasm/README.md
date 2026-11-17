# ifc-wasm (built wasm artifact)

Prebuilt wasm-pack package of the IFC converter, whose source lives in-tree
at [`rust_src/crates/ifc-wasm`](../../../../rust_src/crates/ifc-wasm)
(kernel in `ifc-core`). Only the built output is committed here; rebuild from
the source when it changes.

It converts an `.ifc` file (bytes in RAM) into 1..N cooked `.tdp` files — one per spatial tier when `split` is set — each with its `.coarse.tdp` sibling, plus a `status_file.json`.

**It cooks the `.tdp` itself** — the merged model goes straight into
`cooker-core`, so no GLB is built, serialised or parsed on the import path. The
GLB writer is still there for the CLI and for debugging; `direct_cook.rs` in the
wasm crate asserts both paths cook byte-identical output.

## How to update

```
node scripts/build-wasm.mjs ifc2glb
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
