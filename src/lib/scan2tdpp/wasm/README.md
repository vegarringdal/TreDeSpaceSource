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
scripts/build-scan-wasm.sh
```

(builds this module and the Navisworks one; needs wasm-pack and a wasm-capable
`clang` for the bundled C++ meshoptimizer). Afterwards keep this README, run
`npm run gen:notices` and `npx vitest run tests/wasmSmoke.test.ts`.
