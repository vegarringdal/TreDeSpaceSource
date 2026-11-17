# nwd-wasm (built wasm artifact)

Prebuilt wasm-pack package of the Navisworks converter, whose source lives
in-tree at [`rust_src/crates/nwd-wasm`](../../../../rust_src/crates/nwd-wasm)
(parser in `nwd-core`). Only the built output is committed here; rebuild from
the source when it changes.

It converts a `.nwd` / `.nwc` into one cooked `.tdp` per model root plus its
coarse variant. **It cooks the `.tdp` itself** — each root's merged model goes
straight into `cooker-core`, no GLB is built, not even in memory
(`nwd2tdpWorker.ts`; `rust_src/crates/nwd-wasm/tests/direct_cook.rs` asserts
the bytes equal the GLB path's).

## How to update

```
node scripts/build-wasm.mjs nwd2tdp
```

(`npm run build:wasm` rebuilds all six modules.) It needs the Rust toolchain,
wasm-pack and a wasm-capable `clang` + `llvm-ar` — the bundled C++
meshoptimizer. The module is built with `--features optimize` (set in `scripts/wasm-units.mjs`): that compiles the mesh simplification pass in, which the import's **Simplify** option needs — `tests/wasmSmoke.test.ts` fails on a module built without it. The script copies the result here, keeps this README,
refreshes the copied manifests (the fallback source for the Settings → About
third-party notices) and writes `build-info.json`: a fingerprint of the Rust
sources the binary was built from and a hash of the binary.
`tests/wasmSources.test.ts` recomputes both, so **a change to the Rust
sources needs a rebuild before the tests pass**.

Afterwards run `npx vitest run tests/wasmSmoke.test.ts tests/wasmSources.test.ts`
— the smoke test checks the new binary against the other committed ones; add
`-u` only when the cooked bytes changed on purpose — and `npm run gen:notices`
if a dependency changed.
