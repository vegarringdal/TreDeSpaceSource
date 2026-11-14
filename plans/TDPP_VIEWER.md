# TDPP_VIEWER — laser scans in the viewer (panoramas first, then points)

> **Status: APPROVED 2026-11-13** (director: A → B → C, NumberInput for the
> opacity, shared meshopt crate bumped to 1.3; then "one source to rule it
> all": the scan and NWD converters move INTO this repo, phase 0 / D below).
> Implements the parked `plans/E57_POINTS.md` on top of the `.tdpp` format
> produced by the separate `trueview` project
> (`/home/dev/Documents/github/trueview`, branch `lgsx-e57-readers`):
> LGSX / E57 → `.tdpp` (spec `docs/TDPP_FORMAT.md`, TS reference reader
> `ts/tdpp.ts`, verified lossless against both sample sources).
> File references below were checked on 2026-11-13.

## What `.tdpp` gives us (already done, in trueview)

- One range-addressable file: 128 B header (f64 `origin`), node payloads,
  panorama JPEG blobs, a breadth-first hierarchy (96 B/node: cube, tight
  bounds, `spacing` LOD metric, setup mask), JSON metadata (setups, poses,
  cube faces). Fits OPFS `File.slice` and HTTP Range reads unchanged.
- **Additive LOD** (each point stored once; children refine parents) —
  exactly the E57_POINTS.md design; the LGSX octree maps 1:1.
- Node payload = 256-point clusters from `meshopt_spatialClusterPoints`, each
  with its own u16 quantization box (`p = cube_min + c.min + q·c.step`, the
  same rebase-then-dequantize pattern as `MeshletDesc`); streams
  `u16 x,y,z,intensity` + `u8 r,g,b,setup` (+ optional `u16` normal ring
  code), meshopt vertex codec v1 — decodes with the **existing**
  `MeshoptDecoder` (npm meshoptimizer 1.2.0); verified bit-identical to the
  Rust decoder.
- Setups: pose (setup → source frame), six 90° cube faces (camera looks down
  −Z, +Y up), each a JPEG mip chain (LGSX: 3072² → 1²).
- `trueview cook in.lgsx|in.e57 -o out.tdpp` today (CLI); the same cook is
  ready as a wasm module (`trueview-wasm`, IO contract like rvm2glb but with
  write-at-offset) once a wasm-capable clang is available to build it.

## Phase 0 — one source: converters move into `rust_src`

- `crates/meshopt`: vendored meshoptimizer 1.2 → **1.3** (shared by the
  cooker and the new crates; existing bindings are unchanged in 1.3).
  Committed wasm in `src/lib/*/wasm/` is rebuilt when a wasm-capable clang
  is available (smoke-test MD5s re-pinned then).
- `crates/scan-core` (LGSX / E57 readers), `crates/scan-cook` (`.tdpp`
  writer/reader/verify, LGSX + out-of-core E57 cooks), `crates/scan-cli`
  (`scan` binary: info / points / pano / cook / verify), `crates/scan-wasm`
  (`info` + `cook` over a read/write-at IO) — ported from the trueview
  project, format specs alongside (`crates/scan-core/docs/`).
- New deps → `npm run gen:notices`.

## Phase D — NWD import (Navisworks), cooked straight to .tdp

- `crates/nwd-core` (port of nwd2glb's reader/converter, its spec docs
  alongside), `crates/nwd-cli`, `crates/nwd-wasm`: the merged per-root
  output maps onto `cooker_core::MergedModel` exactly like
  `rvm-wasm::to_cooker_model`, so NWD → .tdp without a GLB round trip.
- Import Manager "Import NWD" section + worker (`src/lib/nwd2tdp/`), same
  IO contract as RVM.

## Phase A — panorama slice (the director's stated first slice)

**A1. Asset kind "points" (.tdpp) — import pre-cooked files**
- `AssetEntry.kind` gains `'points'` (`src/state/assets/assets.state.ts`);
  file at `model_assets/<store>/<id>.tdpp`.
- Import Manager: a `TdppSection` that stages the picked File into OPFS with
  a Blob write (never `src.bytes()` — files are GBs) and hashes it
  incrementally (`src/lib/md5.ts`), validates the `TDPP` magic + version.
- Branches for `kind === 'points'` where `.tdp` is hard-coded:
  `modelAssetPath` (`src/lib/opfs/opfs.ts:64`), `deleteAssetFiles`,
  `readAssetBytes` (range reads instead of whole-file), `exportSelected`,
  the CADM check in `importSourcesLocked`, `residency.register`,
  `gpuRecovery.ts`. Points never go through `parseModel`/modeldb.

**A2. `src/lib/tdpp/` — reader**
- Port `ts/tdpp.ts` to house style (Result types, no `as`, section
  headers); readers take a `readRange(offset, len)` so OPFS and HTTP Range
  share one path.

**A3. Scans state, panel, hotkeys**
- `src/state/scans/` (`scans.state.ts` / `scans.actions.ts`): loaded scan
  assets, setup list, selected/active setup, pano opacity, pano mode
  (`background` | `over`).
- `src/components/panels/scans/` (`Scans.tsx` + `scansPanel.ts`,
  `definePanel`, `home: 'right'`): setup list per asset, enter/exit, opacity,
  mode. Panel toggle in `PANEL_TOGGLES` (free ALT code, e.g. 693).
- Hotkeys in `src/hotkeys/bindings.ts` + tooltips on every control:
  enter selected scan, exit (Esc), next/previous scan, opacity ±, toggle
  mode. Opacity control: see decision 2.

**A4. Renderer**
- **Markers**: one marker sphere per setup via the existing
  `setMarkerSpheres` path (`components/panels/viewport/markerLines.ts`).
  Picking: CPU ray–sphere test on `screenRay()` against the depth probe,
  routed before `selectFromPick` (markers stay out of the id G-buffer).
- **Pano pass** (`src/lib/render/panoPass.ts` + `shaders/pano.ts`):
  fullscreen triangle, world ray from the inverse view-projection, rotated
  into the setup frame; face = dominant axis; per-face
  `uv = (½ + ½·x/−z, ½ − ½·y/−z)` in that face's camera frame (avoids
  cube-map orientation conventions); faces in a `texture_2d_array` (6
  layers, mips from the stored chain, uploaded with
  `copyExternalImageToTexture` from `createImageBitmap`).
  - *background*: drawn at the end of the last scene pass with
    `depthCompare 'equal'` at depth 0 (background pixels only), G-buffer
    masked, `HELPER_TAG_BIT` so sketch mode keeps it.
  - *over*: after post, before outline, onto the swapchain with
    `alpha = opacity` (like `viewCubePass`), redrawn on hold frames.
  - Pano state (asset, setup, mode, opacity, texture ready) goes into the
    idle `key`.
  - VRAM: 6 × 1536² RGBA8 + mips ≈ 75 MB per entered scan; 3072² (≈ 300 MB)
    only on demand.
- **Scan camera** (`src/lib/render/camera.ts`): a `navMode` / lock where the
  eye is pinned at the setup position — orbit = look around, wheel = `fovY`
  zoom, pan/dolly/WASD ignored; enter animates `flyTo`, Esc restores the
  previous pose.

**A5. Tests / docs**: `tests/tdpp.test.ts` (parse + decode a small
synthetic `.tdpp` checked in under `tests/fixtures`), shader pin update,
CHANGELOG entry, `docs/` notes; widget gallery only if a widget is added.

## Phase B — point streaming and rendering

- **Registry** `src/lib/points/` separate from models (points are not
  items): per asset the header + hierarchy stay resident; a streaming
  manager ticks next to `residency.tick()` (`viewport.ts` ~L969): SSE
  traversal (`spacing / distance · projScale`), global point budget shared by
  all loaded scans (the "combined index" from E57_POINTS.md), hysteresis,
  priority queue, decode in a worker (`decodeNode`), uploads throttled per
  frame, LRU eviction with its own VRAM accounting.
- **GPU**: pooled buffers (positions u16x4, rgb/setup u8x4, cluster table:
  rebased min/step + tight bounds) with a free-list allocator; one bind group.
- **Cull + draw** (reuses the VP machinery): per-cluster compute — frustum,
  `clip_culled`, HZB — appends visible clusters; `drawIndirect` with
  `6 × 256` vertices per instance (`vid / 6` = point, corners from `vid % 6`),
  screen-space point size from node spacing; writes the shared reversed-Z
  depth (mutual occlusion with CAD), `clip_discard` per fragment.
- **Shading**: RGB / intensity / per-setup colour; G-buffer tag bit 32
  ("point") so edges/outline/AO skip points; EDL as a later post option;
  normals (when present) via the 65 144-entry ring table for lighting.
- **Interaction**: depth probe/measure work as-is (points write depth);
  per-setup visibility via the node `setup_mask` + per-point setup byte.

## Phase C — in-app cook (LGSX / E57 → .tdpp in the browser)

- New Import Manager section "Laser scan (LGSX / E57)": stage input in
  OPFS, `trueviewWorker.ts` runs `trueview-wasm` `cook(io, opts)` with
  `io.read` / `io.write(offset, bytes)` on two sync access handles; output
  becomes a `points` asset. Progress via `io.progress`.
- Third-party notices: add the wasm package to `WASM_WORKSPACES` and the
  vendored meshoptimizer 1.3 to `VENDORED`; `tests/wasmSmoke.test.ts` gets a
  `describe` with a pinned MD5 (the cook is byte-deterministic).

## Decisions needed

1. **First scene texture.** DESIGN.md scopes textures out of the material
   set; the pano is a dedicated pass, not a material. OK?
2. **Opacity control.** `NumberInput` (0–100 %, steppers + hotkeys) now, or
   add a `Slider` widget to `@treDeSpaceUI` (JSDoc + gallery tab + README)?
3. **meshoptimizer version.** TreDeSpace vendors 1.2 (`rust_src/crates/meshopt`),
   trueview vendors 1.3. For phase C either keep trueview-wasm self-contained
   (its own meshopt 1.3 inside its wasm) or bump the shared crate to 1.3
   (re-pins other cookers' smoke-test MD5s).
4. **Order.** A (import pre-cooked `.tdpp` + panoramas) → B (points) → C
   (in-app cook). C needs clang with the wasm32 target on the build machine.
