# scan-wasm (built wasm artifact)

Prebuilt wasm-pack package of the laser-scan converter, whose source lives
in-tree at [`rust_src/crates/scan-wasm`](../../../../rust_src/crates/scan-wasm)
(readers in `scan-core`, the cook in `scan-cook`). Only the built output is
committed here; rebuild from the source when it changes.

It cooks a Leica `.lgsx` or an `.e57` into one `.tdpp` (octree point cloud,
scanner setups, panorama photos). The input is pulled in byte ranges and the
output streamed through the `io` object — see `scan2tdppWorker.ts`.

## How to update

```
node scripts/build-wasm.mjs scan2tdpp
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
