# rvm-wasm (built wasm artifact)

Prebuilt wasm-pack package of the RVM converter, whose source lives in-tree
at [`rust_src/crates/rvm-wasm`](../../../../rust_src/crates/rvm-wasm)
(kernel in `rvm-core`). Only the built output is committed here; rebuild from
the source when it changes.

It streams an `.rvm` (via a JS `Io` object over OPFS sync access handles) and writes one cooked `.tdp` per site — plus a `<name>.coarse.tdp` for the VRAM budget — and a `status_file.json`.

**It cooks the `.tdp` itself** — the merged model goes straight into
`cooker-core`, so no GLB is built, serialised or parsed on the import path. The
GLB writer is still there for the CLI and for debugging; `direct_cook.rs` in the
wasm crate asserts both paths cook byte-identical output.

## How to update

```
node scripts/build-wasm.mjs rvm2glb
```

(`npm run build:wasm` rebuilds all six modules.) It needs the Rust toolchain,
wasm-pack and a wasm-capable `clang` + `llvm-ar` — the bundled C++
meshoptimizer. The module is built with `--features optimize` (set in `scripts/wasm-units.mjs`). The script copies the result here, keeps this README,
refreshes the copied manifests (the fallback source for the Settings → About
third-party notices) and writes `build-info.json`: a fingerprint of the Rust
sources the binary was built from and a hash of the binary.
`tests/wasmSources.test.ts` recomputes both, so **a change to the Rust
sources needs a rebuild before the tests pass**.

Afterwards run `npx vitest run tests/wasmSmoke.test.ts tests/wasmSources.test.ts`
— the smoke test checks the new binary against the other committed ones; add
`-u` only when the cooked bytes changed on purpose — and `npm run gen:notices`
if a dependency changed.
