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
cd rust_src
wasm-pack build crates/ifc-wasm --target web --release \
  --out-dir ../../../src/lib/ifc2glb/wasm
```

No C toolchain needed (pure-Rust front end). Afterwards: delete the `.gitignore` wasm-pack writes into the out-dir,
keep this README, and refresh the copied manifests (they are the fallback source
for the Settings → About third-party notices):

```
cp crates/ifc-core/Cargo.toml ../src/lib/ifc2glb/wasm/ifc-core.Cargo.toml
cp crates/ifc-wasm/Cargo.toml ../src/lib/ifc2glb/wasm/ifc-wasm.Cargo.toml
```

Then regenerate notices: `npm run gen:notices`.
