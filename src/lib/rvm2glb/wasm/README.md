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
cd rust_src
CC=clang AR=llvm-ar wasm-pack build crates/rvm-wasm --target web --release \
  --out-dir ../../../src/lib/rvm2glb/wasm --features optimize
```

A wasm-capable `clang` is needed (the bundled C++ meshoptimizer). Afterwards: delete the `.gitignore` wasm-pack writes into the out-dir,
keep this README, and refresh the copied manifests (they are the fallback source
for the Settings → About third-party notices):

```
cp crates/rvm-core/Cargo.toml ../src/lib/rvm2glb/wasm/rvm-core.Cargo.toml
cp crates/rvm-wasm/Cargo.toml ../src/lib/rvm2glb/wasm/rvm-wasm.Cargo.toml
```

Then regenerate notices: `npm run gen:notices`.
