# nwd-wasm (built wasm artifact)

Prebuilt wasm-pack package of the Navisworks converter, whose source lives
in-tree at [`rust_src/crates/nwd-wasm`](../../../../rust_src/crates/nwd-wasm)
(parser in `nwd-core`). Only the built output is committed here; rebuild from
the source when it changes.

It converts a `.nwd` / `.nwc` into one cooked `.tdp` per model root plus its
coarse variant. **It cooks the `.tdp` itself** — each root's merged model goes
straight into `cooker-core`, no GLB file is written (`nwd2tdpWorker.ts`).

## How to update

```
scripts/build-scan-wasm.sh
```

(builds this module and the laser-scan one; needs wasm-pack and a wasm-capable
`clang` for the bundled C++ meshoptimizer). Afterwards keep this README, run
`npm run gen:notices` and `npx vitest run tests/wasmSmoke.test.ts` — it checks
the new binary against the committed cooker. Add `-u` only when the cooked
bytes changed on purpose.
