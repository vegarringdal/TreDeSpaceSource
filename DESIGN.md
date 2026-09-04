# TreDeSpace Web Viewer — design notes

What has been built, how it fits together, and what is planned. Rendering
features were ported from a native Rust/Vulkan renderer (now removed — see
"Native reference (removed)" below); we ported its implementation rather than
inventing substitutes.

## Native reference (removed)

The app began as a WebGPU port of an in-house native **Rust/Vulkan** renderer
that used to live in `vulkan_reference/`. That folder (~1 GB with build
artifacts) has been removed from the repo now that the web viewer stands on its
own. Key facts, kept here so the port history isn't lost:

- **What it was:** a GPU-driven Vulkan renderer + a cooking pipeline
  (`cad-cooker`) that produced the CADM `.model` format, its own WGSL/Slang
  shaders, `cad-format` crate, and a native app (`cad-app`). Its design lived
  in its own `DESIGN.md` / `DECISIONS.md`.
- **What we ported from it:** the clip system, TAA, MSAA per-sample edges,
  VBAO, the camera controller, and the cooked-model format — see "Rendering
  features" and "Cooked format (CADM)" below. Source comments still name the
  original modules (`cad-cooker`, `cad-format`, `cad-app`) as attribution;
  those are historical pointers, not live paths.
- **Cooking today is in-repo:** the reference `cad-cooker` was reimplemented as
  a Rust **wasm cooker** (`rust_src/` → `src/lib/cooker/wasm/`), byte-identical
  to the native output, plus a TS fallback (`src/lib/cooker/cook.ts`). No native
  toolchain is needed to cook; the Import Manager does it in the browser.
- **`rust_src/` still references the reference** in a golden test
  (`crates/cooker-core/tests/golden.rs`) and PLAN/Cargo comments; its fixtures
  (`glb_sample1/`) were never committed, so that test is already inert in a
  clean checkout. Left as-is — a separate Rust-side cleanup for the director.
- **Not ported / native-only** capabilities are catalogued under "Not yet
  ported from native" and "Backlog in native too" further down.

## Architecture

- **React 19 + a self-built dockable shell** (`src/treDeSpaceUI/dockable/`):
  framework-free DockManager (lit-html chrome), tabs/splits/floating windows,
  collapse strips, per-panel min sizes, auto-persisted layout (`dock-layout`),
  soft-home nodes — a panel homed at `right` recreates the right column when
  it was closed away (never falls back to the left side).
  - *Why lit-html and not React for the shell:* the dock needs three things
    React actively withholds. (1) **Persistent panel elements** — each panel's
    host `HTMLElement` is created once and reparented forever
    (`DockManager.ts`); React ties DOM identity to tree position, so moving a
    panel between groups would unmount/remount it — fatal for a WebGPU canvas
    (surface + swapchain lost). (2) **Frame-exact rendering** — drags/resizes
    coalesce pointermoves into one rAF-batched `renderNow()`, not scheduler
    passes. (3) **Imperative layout tree** — splits/drops/cascade resizes are
    mutations on a data structure followed by one render, not immutable state
    transitions. lit-html renders the chrome declaratively while panel content
    stays plain DOM. The cost (DockManager owns all its own state/lifecycle)
    is contained behind the thin React boundary in `react.tsx`; the rest of
    the app stays React. Don't "React-ify" the shell, and don't grow new
    lit-html islands unless they share these constraints.
- **Renderer as a library** (`src/lib/render/renderer.ts`, WGSL in
  `src/lib/render/shaders.ts`): GPU-driven — cull compute → multi-draw indexed
  indirect (`chromium-experimental-multi-draw-indirect`), vertex-pull fallback,
  two-pass HiZ occlusion, TAA (Halton jitter + accumulation), MSAA per-sample
  edges, VBAO. Within 5–10 % of the native Vulkan renderer.
- **Worker model DB** (`src/lib/modeldb/modeldbWorker.ts` via comlink): cooked `.tdp`
  parsing (CADM v7/v8, meshopt-decoded), item states (12 B: flags/color/
  transform idx), transform pool, selection ops, hierarchy paths, bounds.
- **State**: tiny `createStore` (useSyncExternalStore) stores per domain,
  localStorage persistence where it matters; actions modules own mutation.
  Panel-local abilities are exposed to global hotkeys through small
  register-callback modules (`registerRenderer`, `registerHierarchyCollapse`,
  `registerMeasurementsLoad`, …).

## Rendering features (ported from native)

- **Clip system** (`clip.slang` port): 8 hardware-style planes + **8
  tagged-union clip shapes** (box / sphere / cylinder). Slot 0 is the default
  Clipping-Box ribbon box; user shapes fill slots 1–7. Combine semantics:
  inverted shapes are holes (AND), normal shapes are keep-volumes (UNION).
  Mirrored conservatively in the cull compute. Ribbon `Enable` (Z) is the
  global clip switch; `Hide main box` disables only the default box.
- **Pick pass** (`mesh_pick.frag.slang` port): dedicated id-only render pass
  with the opacity rule — plain click selects `opacity ≥ threshold`
  (default 10.1 %, Settings → Rendering → Picking); Shift inverts the band
  (faint selectable, glass pass-through, opaque blocks).
- **Measurement snap** (`measure_snap.slang` port): compute-shader
  Möller–Trumbore ray-cast over the meshlet-packed geometry (two-pass u32
  atomic arg-min), CPU classification corner/edge/face by screen-pixel
  distance to the hit triangle's vertices/edges (sensitivity in px,
  Settings in the Measurements panel).
- **Transparency**: alpha-hash (converges under TAA) or unsorted blend pass;
  per-item opacity overrides.
- **Dark-colour lift** (Settings → Rendering → Dark colours, 2026-09-04): a
  black material shows no shading, so cooked colours below a luma floor
  (`origin.w` of the Frame uniform, `lift_dark` in `shaders/scene.ts`) blend
  toward a grey of that luma before the item state is applied. Rendering
  only — colour overrides, exports and the hierarchy keep the true colours.

## Feature panels

- **Measurements** (native `measurements.rs`/`overlays.rs` port): Point / Line
  / Path / Area / Diameter / Angle tools (Angle + Point go beyond native's
  four), snap glyphs (face disc + normal arrow, edge bar,
  corner X), Shift = perpendicular placement with dashed helper + right-angle
  mark, ΔXYZ staircase legs + labels, SVG overlay (projection-correct for
  perspective and ortho), list panel with per-row collapsibles, JSON
  save/load, mute, decimals.
- **Clip Shapes**: add sphere/cylinder/box (fits the selection on add),
  per-shape gizmo (move/rotate/scale mapped per kind), Fit Sel / +2m /
  Center, outline helpers, ShapeSet JSON save/load.
- **Clip gizmo rules** (2026-09-04): one SVG gizmo (`ClipGizmo.ts`) serves
  the main box, the armed clip shape (which wins the box slot) and every
  enabled plane whose Gizmo toggle is on (each plane has its own handles). `M` cycles move → rotate → scale on whatever it targets
  (off → on at the last mode); `X` hides it and brings it back where it was —
  the armed shape, or the main box when that shape is gone — at its last mode,
  without touching clipping itself (Z). `6 Axis` defaults on for the main box
  and for shapes: a box gets six face handles, a cylinder its three special
  handles (one diameter handle scaling the radius symmetrically, top and
  bottom handles moving one end only — `mode: 'cylinder'`). The plane's
  gizmo has its own per-axis toggle, independent of the Helper marker.
  Ribbon `Resize (main)` / `Move (main)` say which box they act on.
- **Selection transforms**: move/rotate/scale gizmo with custom pivot
  (lock/adjust/item-pivot), nudge/rotate-90° grids, move-to-click,
  per-domain undo/redo.
- **Coloring**: quick swatches + Color Panel (manual color, color opacity),
  opacity overrides, per-domain undo/redo.
- **Hierarchy**: worker-built tree, name search (plain contains / equals via
  the worker's `db.search`), reveal-on-select, U/P navigation, collapse-all.
- **Scene Labels** (`LabelOverlay.ts`, `labels/` panel): world-anchored,
  draggable DOM text labels with leader lines (same projection path as the
  measurement overlay). Native has this only as backlog (its 8.3 labels item);
  the web viewer shipped it.
- **View cube** (`viewCubeGpu.ts` + `ViewGizmo.ts`): GPU-drawn orientation
  cube with a label atlas; DOM hit-test for face/edge/corner click-to-snap.
- **Assets / Import**: Model Assets + Import Manager panels over OPFS-persisted
  projects (`opfs.ts`, `project.ts`) — load/stage cooked models, save/load the
  whole project. The Model Assets search is the `&` / `|` / parentheses
  expression engine (`searchExpr.ts`); its grammar and how matches imply
  parent folders/stores are written up in `docs/search-expressions.md`.

## UI conventions

- Square corners everywhere; slate/blue/amber palette; themes are CSS
  variable remaps keyed by `data-theme` (light remaps include the amber
  accents). Flat "floating" scrollbars (webkit-styled; standard properties
  scoped to Firefox — Chrome would drop the webkit styling otherwise).
- **Every button/checkbox/number-stepper gets a hotkey binding + tooltip**
  (`data-shortcut` renders the combo in the tooltip footer).
- Self-built hotkey engine (`src/treDeSpaceUI/hotkeys/engine.ts`, app bindings
  in `src/hotkeys/bindings.ts`): `&` together, `+` then,
  `[X]` hold, runs (`101` = 1,0,1), double-tap, modifier-only leaders
  (`ALT&SHIFT + 2`), per-binding timeout/context, record UI, JSON
  export/import, exact-duplicate validation at boot, suspend-while-recording,
  Console logging of fired shortcuts.
- Biome for format+lint (Tailwind class sorting via `useSortedClasses`;
  `cn()` = clsx + tailwind-merge). Prefer `?.` in UI code; `!` only for GPU
  invariants (Biome's autofix for that rule is disabled — it breaks both).

## Cooked format (CADM)

- v7 = the reference cooker's output; **v8** (our wasm cooker,
  `rust_src/`) appends the 10th–90th percentile "dense bounds" to the
  header (+24 B — every v7 field offset unchanged). The loader accepts
  both. First-load view frames the dense box (Settings → Navigation
  toggle); asset imports store both boxes in the OPFS index so
  "Load selected" fits the just-loaded batch ("Keep camera" checkbox
  skips all fitting).
- **v9** appends a spatial **cell table** (+16 B header pointer): at cook time
  items are binned into a fixed 2-level octree (2x2x2 then 4x4x4, <=73 cells)
  and the DENSE item indices are renumbered so each cell owns a **contiguous
  id range**; draw ranges are sorted `(cell, id)` too, so a cell's meshlet /
  vertex / index runs are contiguous and derivable at parse. The table stores
  per-cell AABB + item start/count. Source ids and the id->item table are
  untouched, so hierarchy, selection and colour semantics do not change — only
  packing order. Always on (the wasm cooker passes `spatial_order: true`),
  ~2 KB/model, free at runtime; the loader accepts v7-v9
  (`src/lib/model/format.ts`).
- **In-browser cooking is live** (`src/lib/cooker/cookerWorker.ts` → the Rust wasm
  cooker in `src/lib/cooker/wasm/`, byte-identical to the reference cooker):
  a plain GLB is cooked to CADM on a worker, no offline `cad-cook` step. The
  wasm entry point is `cook(glb, compute_normals, coarsen)`: `compute_normals`
  is the import option (keep/derive vertex normals → smooth shading, tracked as
  `hasNormals` per asset) and `coarsen` writes the extra `<id>.coarse.tdp`
  variant for the VRAM budget. A second entry point `coarsenTdp(tdp)` rebuilds
  that coarse variant from an already-cooked `.tdp` when no sibling exists
  (see "Coarse from `.tdp` alone" under the VRAM budget section).
- **RVM → GLB import** (`src/lib/rvm2glb/rvm2glbWorker.ts`, `rvmWriter.ts`, wasm
  `rvm2glb`): import raw RVM in the browser (streaming to OPFS, per-zone
  split) → merged GLB → cook. Native has no equivalent — it consumes GLB from
  an external `rvm_parser_glb` tool.
- **Cooker source & build** (`rust_src/`): a workspace of `cooker-core` (the
  pipeline as a lib — CADM writer, GLB parse/flatten, meshlet build + quantize +
  meshopt vertex/index encode, and a `blake3(glb) + COOKER_VERSION` cache key),
  `crates/meshopt` (vendored C++ meshoptimizer FFI, patched with freestanding
  wasm32 math/shim), and `cooker-wasm` (the wasm-bindgen shell built into
  `src/lib/cooker/wasm/`). ~4× faster than the retired TS cooker on a 35 MB GLB.
  Rebuild needs a wasm-capable clang (plain `clang` works — the meshopt crate
  ships freestanding wasm32 headers, no WASI sysroot):
  `CC=clang AR=llvm-ar wasm-pack build crates/cooker-wasm --target web --release --out-dir ../../../src/lib/cooker/wasm`
- **Diverged from the original cook plan** (`rust_src/PLAN.md`, since folded
  into this doc and deleted): it envisioned an in-browser **Folders** auto-cook
  flow (scan a GLB folder, `blake3` vs a `.cache/manifest.json`, cook
  stale/missing in place) plus a native `cooker-cli`. The app took a different
  route — the
  **Import Manager** cooks single files / folders into the OPFS asset store —
  so the manifest flow and the native CLI were never built. New import FORMATS
  are added Rust-side.

## Import converters (`rust_src/crates/{rvm,ifc,step}-*`)

Three converters — RVM, IFC, STEP — living in the **single `rust_src` Cargo
workspace** alongside the cooker (they were separate GitHub projects with a
workspace each until 2026-08-20; each crate family keeps its licence and a
provenance note in `<name>-core/LICENSE`). Each is built to wasm
(`src/lib/<name>/wasm/`) and driven by its own comlink import worker.

**They cook straight to `.tdp` — no GLB in the middle.** The converter builds
its merged model in memory (positions, indices, per-item draw ranges,
hierarchy) and hands it to `cooker_core::cook_model`, so the old
converter → merged GLB → parse → cook round trip is gone: no glTF JSON with a
draw-range entry per item, no second copy of every buffer, one worker instead
of two, and the coarse VRAM-budget variant falls out of the same pass. Each
core keeps its GLB writer for the CLI and for debugging, and a `convert_cooked`
entry point that takes a cook hook (the cooker lives outside those crates).
Byte-parity with the old path is enforced by a test per format
(`crates/{rvm,ifc,step}-wasm/tests/direct_cook.rs`): the same input cooked both
ways must produce identical bytes.

Sample models for the converter tests live in `convertSamples/{rvm,ifc}`
(STEP fixtures sit in `crates/step-core/tests/fixtures`).

| converter | converts | wired into the app? |
|---|---|---|
| `rvm` | PDMS/E3D **RVM** plant models → GLB | yes — `src/lib/rvm2glb/rvm2glbWorker.ts` + `src/lib/rvm2glb/wasm` |
| `ifc` | **IFC** 2X3 / 4 / 4X3 → GLB | yes — `src/lib/ifc2glb/ifc2glbWorker.ts` + `src/lib/ifc2glb/wasm` |
| `step` | **STEP** B-rep → GLB (proof-of-concept parser) | yes — `src/lib/step2glb/step2glbWorker.ts` + `src/lib/step2glb/wasm` |

## Data / SQL subsystem

A shipped feature that predates this doc: an in-browser SQLite workbench over
the same OPFS store registry the model assets use — so a "store" is one
project's cooked models *and* its databases (shared `stores.json`).

- **SQLite in a worker** (`src/lib/sqlite/`): `@sqlite.org/sqlite-wasm` driven
  through a **custom sync OPFS VFS** (`SyncOpfsVfs.ts`) that needs no COOP/COEP
  headers (ported from a reference `sqllitedebug` project). Databases are real
  files under `sql_assets/<store>/<file>.db`, keyed by full OPFS path so nested
  `ATTACH DATABASE 'sql_assets/<store>/<file>'` resolves against a plain path.
  A fresh VFS is registered per run and freed after — piled-up registrations
  under one name hand back a stale, handles-closed VFS → `SQLITE_CANTOPEN`.
- **No WAL.** The OPFS sync VFS is **shm-less**, so a WAL database fails
  shared-read (`CANTOPEN`); the worker opens `locking_mode=exclusive` +
  `journal_mode=TRUNCATE`, and imports normalise DBs out of WAL on the way in.
- **SQL Assets panel** (`sql-assets/`): the DB library — import / delete only
  (unlike models, these are few real files, so no folder tree or Import
  Manager).
- **SQL Editor panel** (`sql-editor/`): pick a main DB, `ATTACH` others; an
  exact scan of the ATTACH string literals (`sqlAttach.ts`, comment-stripped
  first) decides which files get Web-Locked before a run — `shared` = several
  read-only readers, `exclusive` = writes. Results go to the Console panel.
  The editor is a report draft (name, types, filters) — see "SQL Editor
  draft & SQL Table export" below.

### Packed SQL results (coloring / selection)

A COLORING run (`fullname[, fullname_color]`) never becomes row arrays. The SQL
worker collects it with `collect: 'packedNames'` into a `PackedNames` set
(`src/lib/color/packedNames.ts`): every name lowercased + trimmed into ONE
UTF-8 blob, an offsets array, and per-row color (`Float64Array` — packed RGBA8
is unsigned, an Int32 lane would sign-flip alpha-255 colors; `COLOR_DEFAULT` /
`PACKED_NO_COLOR` sentinels are negative) and opacity (0-100, 255 = none).
The worker posts it with the buffers as transferables; the main thread keeps
only the handle (the Color/White/Hidden/Selection buttons can re-apply it) and
hands it to the model-db worker as a `mode: 'packed'` filter. There
`packedMatcher` decodes one name at a time into per-model entry lists plus
per-model `[entry, color|opacity]` lists — the same shape a Multi paste's
`perNameColor` resolves to — so the flood / deepest-level-wins / write code is
shared and `tests/colorRulesPacked.test.ts` pins the parity. Selection goes
through `selectPacked` (worker resolves + marks items, returns flat
(model, entry) pairs). Cost: ~45 B/row instead of ~1 KB/row of duplicated
strings/objects/Records (a 4M-row result ≈ 200 MB peak, was ≈ 4 GB). The
main → worker hop is a structured clone, not a transfer, on purpose — the UI
retains the result for repeated apply. Table / API results stay row arrays,
capped INSIDE the worker (`Statement.maxRows`, true total in `rowCounts`).
Follow-up if decode time ever matters: key the global name index by a 64-bit
hash (the snapshot `hashIndex` already uses fnv1a64) and ship 12 B/row.

### SQL Editor draft & SQL Table export (2026-09-04)

The SQL Editor holds a **report draft** (`draft: ReportDef` in
`sqlEditor.state.ts`): name, description, output types and filters, exactly
the SQL Reports editor's fields (shared `ReportMetaFields` /
`ReportTypeToggles` / `ReportFiltersEditor`). The six action buttons run the
draft WITH its filters, and Run seeds FILTER_ARGS too (`filterArgsStatements`).
Decisions:

- **No Save / Cancel / Delete in the editor.** Persistence is the host's:
  `sql.editor.get` returns the draft and `sql.editor` takes the same fields
  back (`title` = the report name — `name` already titles an appended block).
  **Save Local** adds the draft to SQL Reports as a NEW report in the Main
  db's store (the db decides the store; disabled without one); **Set editor**
  in the reports editor is the reverse, after a confirm. Clear keeps the
  Main db.
- **Types gate the buttons** (COLORING off dims the four color buttons, TABLE
  As Table, DETAIL As Detail — hotkeys included), listed COLORING, TABLE,
  DETAIL to match the button rows.
- **SQL Table export is dependency-free**: `src/lib/xlsx.ts` writes one sheet
  (inline strings, typed numbers/booleans, frozen header) into the STORED
  zip of `src/lib/zip.ts`; no npm dep, so no notices churn. A deflated
  container (`CompressionStream('deflate-raw')`) is the follow-up if 250k-row
  files prove too large. Clipboard copy is TSV with a header row.
- **"All" means as shown** — column filters and sort applied; "selected"
  keeps the shown order. The corner cell toggles every row shown, so a
  filtered view selects only its rows. Hotkeys Alt&652–661 belong to this
  work (table 652–657, editor 658–660, reports 661).
- Validation of the `sql.editor` payload lives in a pure module
  (`sqlEditorPayload.ts`) returning `{ error }` — vitest has no
  `@treDeSpaceUI` alias, so a test cannot import `protocol.ts`.

## postMessage host API

Shipped: the viewer embeds (iframe or `window.open`) and is driven by a host
page over `postMessage`. `src/lib/messageApi.ts` is the whole app side — one
message listener installed from `App.tsx`: origin allowlist → envelope check →
per-command payload validation → a call into the SAME action the UI uses (async
commands hold the same Web-Locks import lock). Responses go to `event.source`;
app→host events (`tree.select`, `instance.changed`, `assets.importUrl:progress`)
are posted unsolicited with `id: null`.

- **Protocol & catalog** — `EVENTS.md` is canonical: envelope, `app.ready`
  handshake, the security allowlist, every `### command`, and the events.
  Commands span selection, labels, measurements, color rules, settings, stores,
  model + SQL assets, import (bytes, chunk-streamed, or **viewer-downloaded by
  URL**), and view/UI control (sketch, kiosk, **theme**, **screenshot**).
- **Copy-paste SDK** — `api/tredespace-client.ts`: dependency-free, fully typed,
  one method per command, `Result<T>` (never throws), correlation ids + ready
  handshake + timeouts + transferables handled. NOT part of the app build.
- **Docs can't drift** — `scripts/gen-api-docs.mjs` (the `apiDocs()` Vite
  plugin) derives `docs/generated/apiData.json` from the SDK's per-command JSDoc
  *plus* the EVENTS.md payload/response examples; `vite build` FAILS if a
  command lacks either. `EVENTS.md` is the protocol narrative, the JSDoc the
  per-command description.
- **Two host pages** — `/demo/` (`demo/`) is the API playground: every command
  with a request/response log, and `?dialog=1` runs the same page hosted
  *inside* the viewer as an External app. `/docs/demo.html` (`docs/`) is the
  marketing live demo — loads the Huldra sample and drives the SDK.
- **Demo sample assets** live in `/samples` (NOT `public/`, so Vite's public
  copy never touches the ~10 MB GLB). `vite.config.ts` `sampleAssets` ships
  `HuldraDemo.glb` **gzipped-only** (the demo gunzips it in-browser with
  `DecompressionStream`) and the license PDF raw; a dev middleware serves both
  from `/samples` at their root URLs.

## Startup

- Console banner (pinned): app name, author, copyright. Console keeps the
  first 10 lines forever, rotates the rest above 50.
- First model load sets the default view: from the top, halfway between
  FRONT and RIGHT (az 3π/4, el −35°), then fits the scene bounds.
- **Storage namespace** (`src/lib/storageKeys.ts`, 2026-09-04): every
  localStorage / sessionStorage key is `tds:<name>` and a store must be in
  `VIEWER_STORAGE_NAMES` to get one. `globalReset.ts` (the first import)
  copies the pre-0.0.85 bare-name values under the prefix once, guarded by a
  `tds:migrated` marker so a later reset is not undone by re-copying, and
  leaves the bare keys alone (on a path-proxied viewer they may be the
  host's). Clear all local data removes only `tds:` keys and the viewer's
  own OPFS entries (`VIEWER_OPFS_ENTRIES`), never the origin's whole storage
  — the fix for a host page losing its keys to the viewer. The hotkeys
  library keeps its own default key and is pointed at `tds:hotkeys` by
  `installHotkeys`.

## Not yet ported from native

Genuine parity gaps — features the native renderer ships that the web viewer
does not (verified by a full feature diff, 2026-07-18):

- **Smooth / computed vertex normals.** Native shades with per-vertex normals
  (`--compute-normals`, for weldable `_nor` models) and falls back to flat.
  The web viewer is **flat-only**: `fs` in `shaders.ts` always derives the
  normal from `cross(dpdx, dpdy)`. The plumbing to change this mostly exists —
  `format.ts` already decodes an octahedral normal stream and the wasm cooker
  takes a `compute_normals` flag — but the cooker is called with `false` and
  the render pipeline never binds/consumes the normal stream. Wiring smooth
  normals through is the missing piece (and it feeds edge quality, below).
- **Hover highlighting of the item under the cursor.** Native has two hover
  effects computed off the id buffer — an inline id-neighbour outline (in
  `taa.slang`) and a depth-off **x-ray silhouette** (`hover_xray.frag.slang`,
  see-through highlight behind occluders). The web viewer highlights only
  *selection*; there is no per-item hover feedback. (The only "hover" in the
  web shaders is the view-cube zone.)
- **VR / OpenXR walkthrough.** Native has the `desk3d-xr` crate (per-eye
  poses, controller locomotion). The web viewer has no WebXR path.

## Backlog in native too (not web-specific gaps)

These are unbuilt on both sides — porting is blocked on native building them
first, per the "port, don't invent" rule:

- **Edge-detection quality at shallow (~70°) creases** — native's `edge.slang`
  and the web `postWgsl` share the same `cull = max(edge_fade, 0.04)`
  pre-threshold multiply that crushes weak creases (native WIP item 8.8). Fix
  lands native-side first.
- **Vector / hidden-line export** (SVG/DXF blueprints — native 8.7).
- **Instancing import** — TRIED AND REJECTED 2026-07-24; see "Instancing
  experiment" below for the data and why it cannot deliver VRAM savings at
  this meshlet granularity. Do not revisit without new evidence.
- **Textures / UVs / non-flat materials** — scoped out of native's closed
  material set; a deliberate direction call, not a port.

## Instancing experiment — tried and rejected (2026-07-24)

We built GPU instancing end-to-end (a "CADM v9" format revision, since
reverted — the code is NOT in the tree) and A/B-tested it against the merged
pipeline on a real 136-model RVM import. Verdict: **instancing halves the GLB
on disk but does not save VRAM and costs 30% frame time.** It is a *transport*
win, not a rendering win. Recording it here so the idea isn't re-tried without
new evidence.

### What was built (design sketch, for the record)

- rvm2glb/ifc2glb already emit `EXT_mesh_gpu_instancing` (`--mode
  gpu-instanced`); the TS generic cooker preserved it instead of baking every
  instance out: shape geometry cooked ONCE (shape-local meshlets/quantization),
  plus an instance table (sorted dense item indices + column-major 4×3 f32
  matrices) behind a v9 header extension. Non-instanced input still cooked
  byte-identical v7.
- Identity: one item per instance (selection/hide/color/gizmo unchanged).
  Placement rode the existing per-item transform slot: `tidx >= 4096`
  (= TRANSFORM_POOL) indexed a per-model immutable instance-matrix buffer
  (new binding 8 in render/cull/measure-snap); gizmo edits composed
  `edit × placement` into normal pool slots, reset restored the instance slot.
- pack.ts expanded the per-meshlet cull/info records per instance, so the
  cull/draw record layout was identical to baked — only vertex/index bytes
  were shared.

### The A/B numbers (RDNA-3, vertex-pull culling, same source RVM)

|                       | merged (baked) | gpu-instanced |
| --------------------- | -------------- | ------------- |
| source GLBs           | 1 GB (245 MB gz) | 500 MB (87 MB gz) |
| meshlet records       | 788,224        | 1,250,956 (+59%) |
| triangles             | 55.7 M         | 59.7 M (+7%) |
| tris/meshlet fill     | 70.7           | 47.7 |
| VRAM (tracked)        | 723 MB         | 711 MB (−12 MB) |
| drawn pass 1          | 229,959        | 330,201 (+44%) |
| GPU frame total       | 29.3 ms        | 38.3 ms (+30%) |

### Why there are no VRAM savings

Sharing happens at the vertex/index level, but every **per-(meshlet ×
instance)** cost remains: ~116 B/record of VRAM (cull 36 B packed + meshlet-info
32 B + vis 4 B + 2 × 20 B draw-record buffers + 4 B full-list) regardless of
whether the geometry behind it is shared. rvm2glb instances at the *primitive*
level, so shapes are tiny; each unique shape's last meshlet is part-empty and
a ~30-tri shape still occupies a whole 124-tri meshlet slot per instance.
Result: +59% records ≈ +67 MB of record tax, cancelling the ~80 MB of shared
vertex bytes → net −12 MB. The +7% triangles (gpu-instanced mode appears to
skip the merged path's weld/simplify) ate part of the margin too.

Frame time: vertex-pull draws a fixed 372 vertices per meshlet regardless of
fill, so +44% drawn meshlets ≈ the observed +28% scene-pass cost; both cull
passes also scale with record count.

### What could have changed the verdict (untested, on record only)

Dense VRAM-bound model (the 3–4 GB one) was never tested; MDI mode (draw cost
∝ triangles, not meshlet count) would shrink the frame-time penalty;
part-level instead of primitive-level shapes in rvm2glb would fix meshlet
fill; cull indirection (records per shape-meshlet, instances iterated in the
dispatch) would recover ~96 of the 116 B/record (the cull-record s8 cone compression, 64 -> 36 B, is DONE). None of these change the
fundamental: at CAD-plant shape sizes, per-meshlet-instance overhead is the
same order as the geometry being shared.

### Conclusion

For scenes that exceed VRAM, **model loading/unloading (streaming models in
and out of the viewer on demand) is the realistic lever** (since built — see
"VRAM budget & residency" below) — geometry-side
tricks have now both failed on this data: meshlet LOD+streaming made VRAM
~1 GB *worse* on the dense plant model (4 GB vs 3 GB, since it kept LOD
resident alongside full geometry — only viable with a ≥6 GB VRAM budget;
shelved 2026-06-20) and instancing broke even at best. Keep gpu-instanced GLB in mind purely as a
download/storage format if network size ever matters (bake it out at cook
time), noting the baked-out result inherits the per-primitive item
granularity and its worse meshlet fill.

## VRAM budget & residency — LIVE (v2, 2026-09)

The distance-based load/unload lever — v1 built 2026-08-04 (web180),
director-verified in-app 2026-08-07; v2 (target-set planner, batched and
quiet commits, burst hold) landed 2026-09-03 — its plan file is folded into
this section. Both
geometry-side tricks had failed on this data (meshlet LOD+streaming made VRAM
worse; instancing broke even — see the experiment sections above), so paging
whole zones in and out at the asset level is the lever that shipped.

**What it is.** Settings → Rendering → VRAM budget: an **Enabled** switch
(`vramBudgetOn`, off by default — everything loads full detail exactly like
before) and a ceiling `maxVramMb` (default 2048 MB; readers take the pair
through `vramBudgetMb`, 0 while off). With the budget enabled, a residency
manager keeps tracked VRAM under it by holding far zones as
a **coarse variant** and promoting near zones to full detail, swapping
**only while the camera is idle**. Loads are coarse-first under a budget, so
the ceiling is never overshot at load time.

**The invariant** (the lesson from the failed LOD+streaming attempt, which
kept LOD resident *alongside* full geometry): **exclusive residency — for
any zone, coarse or full geometry is on the GPU, never both** (per item in
mixed packs); the only overlap is the single zone mid-swap, bounded by
headroom.

**Pieces:**

- **Coarse cook at import**: the wasm cooker's 3-arg `cook(glb, normals,
  coarsen)` writes a second `<id>.coarse.tdp` per zone (Rust
  `CoarsenOptions`: simplify ratio 0.05 / error 0.15 / tiny-item cut
  0.005×model-diag). Same item table as the full cook — slot, `item_base`,
  selection, hide state and colors survive swaps untouched (the revive path
  rebuilds the renderer slot in place and re-pushes item states).
- **Coarse from `.tdp` alone** (`cooker-core/src/tdp.rs`, wasm
  `coarsenTdp(tdp)`): a bare `.tdp` (viewer export, hosted file, panel import
  without its sibling) gets its coarse variant rebuilt at import time —
  geometry is dequantized from the meshlet streams, re-welded on a 1 mm grid,
  then run through the same coarsen→meshletize→pack pipeline; the item table,
  hierarchy, cell table and header bounds are copied from the input verbatim,
  so the output is a valid swap partner by construction. This makes the full
  `.tdp` the ONLY file that ever needs to travel (its md5 is the sync key;
  `.coarse.tdp` is a locally derived cache), and coarse settings can change
  without a format bump. Structure parity is enforced by
  `coarsen_tdp_matches_glb_coarse_structure` in cooker-core's golden test.
- **Residency manager** (`src/state/viewer/residency.ts`, records and
  pacing in `residency.record.ts`, the swap path in `residency.commit.ts`):
  main-thread bookkeeping + side effects. Every swap is an async PREPARE
  (OPFS read, worker repack, item-state fetch) and a synchronous COMMIT;
  prepared swaps commit in one batch per tick (frees before allocations), so
  N swaps cost one re-render, and the slot is rebuilt with its states in
  hand — no frame ever renders a zero-initialised state buffer. A demote of
  a zone whose draw count is 0 (counts maintained, read after the camera
  stopped and after the last loud commit, pack not deficient) commits
  QUIETLY: no re-render, no accumulation reset. With "Pause AO / TAA while
  optimizing" (default on) the renderer's `holdAccumulation` is set for the
  burst — single-sample frames, no AO — and one convergence follows it. The
  per-zone visible-bounds / nearest-visible-item worker round trip is
  trigger-based (eye moved 2 m or turned, an item state changed outside
  residency, a zone registered, 10 s safety when idle) — an idle camera
  during a burst issues none. `maxInFlight` is 2 / 4 / 6 per pacing preset;
  the worker is single-threaded, so it groups commits rather than speeding
  parses.
- **Pure planner** (`src/state/viewer/residency.plan.ts`): `planTargets`
  computes the TARGET level of every zone once per camera rest and the
  ordered steps that reach it (refreshes, unloads, coarse demotes, shrinks,
  repairs, promotes, mixed re-packs) — unit-tested in
  `tests/residency.plan.test.ts` (74 cases, incl. idempotence, "each zone
  at most once", and a ping-pong regression built from the v9 measurement).
  Priority = projected coverage `(R / (R + d))²` — R the half diagonal of the
  sigma-clipped dense box, d the nearest-visible-item distance — times the
  off-screen factor after a grace period, so zone size counts and one
  parked item cannot inflate it. The fill runs floors (coarse) first, then
  detail, in rank order; the anti-churn `margin` and `COARSE_STRIP_RATIO`
  are rank BONUSES for residents and holders, and a needy zone reclaims a
  lower zone's bytes only when that reaches a better level for it —
  residents' detail before coarse floors ("depth before holes"), never a
  pointless eviction (v1's `park` cap is gone). Promotion gated on a
  continuous on-screen streak, clip-culled zones demote immediately, a
  mixed zone never rises to full (a saturated pack already holds every
  in-view item sharp). `planResidency` remains as the first-step view. A
  measured occlusion factor (`drawnPerModel / meshletCount`) was considered
  and NOT shipped: the seen-decay already covers a fully occluded zone, and
  a term that moves with the 2 Hz readback is the one input that could
  reopen the ping-pong.
- **Mixed packs** (tier 2.5, no format change): `packModelMixed` (pack.ts) /
  `repackModelMixed` (modeldb worker) fill the nearest in-frustum items from
  the FULL parse up to byte headroom, remainder from the COARSE parse — one
  slot, complete item table, no holes. The sharp region re-packs when the
  camera moves or turns far enough.
- **Cut rules**: items smaller than "Cut size" (default 0.5 m) beyond "Cut
  distance" (default 200 m) are dropped from budget packs; "Drop hidden"
  (default on) drops hidden items — unhide triggers a re-pack. Cuts apply to
  mixed and coarse packs only, never to plain full loads.
- **UI/debug**: swap-speed radio (relaxed/normal/fast idle pacing), activity
  chip (blue swapping / green settled / grey waiting), residency-box overlay
  (`ResidencyBoxOverlay.ts` — green full, purple mixed, orange coarse, red
  unloaded, blue swapping), copyable per-zone event log with reasons.

**Accepted costs**: pop on swap (hidden by the idle gate), one re-render and
accumulation restart per COMMIT BATCH (none for a quiet commit; with the
burst hold, single-sample frames until the burst ends), and coarse-resident
zones degrade the GPU-readback features that read the LIVE slot —
measurement snap and picking see coarse geometry (exports do not; they read
the full cook from disk). A revived slot's visibility buffer starts at 0, so its
first frame is discovered by cull pass 2 against the other zones' HZB (its
own occluders are not in the pyramid yet — over-draw only, never under-draw,
and ≤ what the old all-1 seed drew in pass 1). Render targets count against
the ceiling (Stats shows `models + targets/other`); a hi-res screenshot
pauses swaps so its transient 4K targets never evict geometry. Assets
imported before coarse variants existed have no coarse file and fall back to
full unload when demoted.

**Not done / future**: TS coarse pass for standard GLBs. The
export-from-coarse fallback shipped 2026-09-03: GLB / IFC / TDP export reads
the full `.tdp` from OPFS for every zone the budget holds coarse, mixed or
unloaded (parsed and packed in the modeldb worker, `FileGeom` in
`apiExport.ts`), unloaded zones included, with the manager paused for the
export's duration — an export never inherits the budget's cuts.
Cross-item-meshlet v9 was REJECTED (director ruling 2026-08-04).

**Range-based swaps ("v9-RANGES") — measured and dropped (2026-08-06).** The
cook side SHIPPED (spatial ordering + the v9 cell table, see "Cooked format");
the streaming phases built on top of it were dropped after measuring a full
convergence run: it is **97 % idle** (normal pacing 32.7 s wall / 176 swaps /
261 MB / 1.69 s decode; "fast" 112.8 s / 268 swaps / 550 MB / 3.61 s decode),
so cutting decode cost cannot move the wall — planner POLICY (cooldowns,
dwell, one swap per tick, rebalance margin) is the wall, and that is free to
tune. The same run showed "fast" running 3.5× SLOWER than normal: its lower
rebalance `margin` (1.25) evicted zones on a 25 % priority edge and the evicted
zone became the next needy one — a ping-pong; `margin` is now held at ≥ 1.5 for
every preset. The cell table stays because it is cheap and it is the
prerequisite for **fly-streaming** (continuous repacking while the camera
flies, where whole-group decode ≈ 21 ms/zone would become the wall); reviving
that means per-cell compressed slices in cooker + parser plus one re-import.
Re-measure the "% busy" line before believing any of this has changed.

**v2 — what the "97 % idle" hid (2026-09-03).** Idle for the worker was not
idle for the GPU: every v1 swap reset `lastKey`, restarting the 32-sample
TAA/AO accumulation, so the 32.7 s convergence rendered on the order of
1000 full-scene frames for a camera that never moved (and every swap flashed
hidden items for a frame, the states landing one task after the revive).
v2 attacks both the count and the cost of swaps: the target-set planner
moves each zone at most once per rest, commits land in batches (one restart
per batch), off-screen demotes commit quietly (no restart), and the burst
hold makes the remaining frames single-sample. The SETTLED line now carries
the evidence — `N commits (Q quiet) · F frames (S scene, R accum resets,
H held) · gpu Σ` — so the numbers above are to be re-measured with it before
being quoted again.

**Measurement protocol (v2 numbers still pending).** Kept from the v2 plan
so a re-measure stays comparable. The baseline must come from a PRE-v2
build (an older commit), read off the v1 SETTLED line — the v2 counters do
not exist there. Fixed conditions: same model set, page reload
(coarse-first load), budget 512 MB, normal pacing, `aaSamples` 32,
`fpsLimit` 30, GPU timings on; do not touch the camera until SETTLED, then
Copy event log. Three runs, compare medians; record per run: wall, swaps,
MB, % busy, frames, scene frames, accumulation resets, gpu Σ s, commits,
quiet commits, visibility refreshes. Scenario 2: orbit 90° and stop, wait
for SETTLED — swaps and repeated slots (≤ 1 per zone). Scenario 3: hide half
of a visible zone, unhide it — refreshes and swaps. Visual pass with the
residency boxes: a quiet demote shows no change, and the vis = 0 seed gives
an identical first frame (`drawn p1 / p2` in Stats).

**Shipped differently from the v2 plan** (plan file removed 2026-09-04):
the occlusion factor was not shipped (above); the burst hold defaults ON
rather than opt-in; a stale coarse pack that is about to be promoted is
promoted directly instead of refreshed first (one swap, not two). Guards to
respect when touching the commit path: a quiet commit needs a fresh draw
count and never applies to a promote; a flush frees before it
allocates; `pause()` lets in-flight prepares commit on resume; a failed demote invalidates the plan instead
of stalling a waiting promote; the coarse-first `bytesFull` is a file-ratio
guess, so one over-budget correction, bounded by dwell, is expected.

## Other TODO / future
- **E57 laser-scan point clouds — PARKED** (`plans/E57_POINTS.md`, design capture
  only). The domain where streaming LOD is *mandatory* rather than an
  emergency lever: in-app E57 cook → chunk-addressable octree (Potree-2.0
  shaped; inner-node subsamples via `meshopt_simplifyPoints`, streams via the
  meshopt vertex codec) → screen-space-error streaming from OPFS **or a blob
  store via HTTP Range**, multiple E57s unified by a combined loading index →
  vertex-pull point quads + EDL inside the existing WebGPU pipeline (shared
  depth/clip/TAA — the product value is scan/CAD *overlay*, one scene).
  potree-core evaluated and rejected as a dependency (three.js/WebGL, needs
  desktop PotreeConverter); Potree's format/heuristics kept as reference.
  Epic-sized; don't build until scan overlay is a product need.
- **Multi-tab external panels — PARKED** (`plans/MULTI_TAB.md`, design capture
  only). Pop a *deliberately small* set of panels into real browser tabs:
  v1 = **SQL editor** (each tab an independent SQL workspace — own worker
  via Web Locks + shared OPFS; the window is a tabbed dock where every
  "as table"/"as detail" click opens a new instance-scoped tab beside the
  editor; nothing synced with main) and **external-app `ext:` iframe
  panels** (fresh instance; their viewer-API postMessage forwarded to main
  over the channel). Triggered by an explicit "Open external" action button
  in the SQL editor toolbar (per-app action for ext apps) — deliberately NOT
  dock-level, no float/dialog interaction. Slim `?external=` child shell,
  BroadcastChannel with an authoritative main window, global
  blocking overlays, non-closable "main window closed" modal in children.
  Viewport and other panels stay in main (widening later = the extension
  layer sketched in the doc). Delayed until the main app settles — the doc
  lists structural prep edits (panel-registry extraction, local-manager
  discipline in SQL panels, unified blocking-UI store, SQL-worker
  lifecycle, messageApi forwarding seam) to land as normal refactors first.
- **WebXR VR/AR — PLANNED, not scheduled** (`plans/XR.md`, design capture only).
  VR model review first (desktop Chrome + PCVR headset, e.g. Quest 3 over
  Link/Virtual Desktop), on-site passthrough-AR alignment later. Unblocked by
  the WebXR/WebGPU Binding (`XRGPUBinding` + projection layers; Editor's
  Draft June 2026) — behind Chrome flags on Windows/Android XR as of 2026-07,
  shipped only on Vision Pro Safari, **absent from the Quest standalone
  browser** (which also lacks multi-draw indirect → untethered/AR is blocked
  on Meta, not us). three.js dev's `XRManager.js` is the reference impl.
  Renderer seams (per-view render fn, per-eye cull incl. both cull pushes,
  TAA off/MSAA resolve into layer, no hold path, Z-up↔Y-up root transform)
  and the alignment "lock button" (`M = H · H0⁻¹ · M0` while held) are pinned
  in the doc. Phase-1 spike is small and schedulable any time; the Home
  ribbon's placeholder "Enter VR" button was removed 2026-07-26 until then.
- **Surface-area "painting" for estimates — PARKED** (design capture only).
  Mark a sub-region of a surface and read its **developed m²** for takeoffs:
  profiled/ribbed panels have far more area than their flat footprint, and
  merged items often get painted on only part of a face, so item-level
  selection is too coarse. Must be derived from triangles alone — the cooked
  format has no BREP curves or edge/adjacency data. Clip-based (a box cutter's
  6 planes, not freehand), area from a GPU clip-count compute, paint stored
  per-triangle, persisted into GLB/IFC export only. Don't build until the core
  viewer is done and the need is confirmed.
- **"High-end render" snapshot — PARKED** (design capture only, 2026-08-02).
  A button that freezes the camera and spends **2–5 s** on one still: smooth
  (true) normals instead of flat facets, raycast sun shadows + ground-truth AO
  instead of VBAO, fp16 G-buffer, 4–8K with progressive accumulation of
  jittered frames. Deliberately non-interactive (no ids, no edges, no TAA/MSAA,
  no picking); draws current colours minus selection, clips still applied. A
  small standalone renderer that borrows the loaded model buffers — the meshlet
  layout is already a two-level BVH for the ray queries, and passes must be
  chunked around the browser GPU watchdog. The hard part is normals, since the
  cook is optimised for flat shading: first dodge is a bake into the existing
  authored-normals slot (weld by position hash, area-weighted, ~40° crease)
  plus a per-fragment fallback to the derivative face normal beyond the crease
  angle, so hard edges stay hard without adding a vertex. Position precision is
  NOT a lever (u16 against the per-meshlet AABB is sub-millimetre).
- Measurement snap onto occluded corners would need the pick ray to ignore
  the front surface (native has the same limitation).
- LOD + streaming shelved (needs ≥6 GB VRAM budget — see the "Conclusion"
  under the instancing experiment above for the A/B result).
- **glTF animation import (rigid node TRS only).** The cook bakes node
  transforms into world-space positions, which is exactly what animation
  must NOT do — supporting it means keeping animated subtrees in local
  space and driving them through the existing per-item transform pool (the
  4096-slot gizmo system: rendering, culling, selection and outline already
  respect it). Scope for a v1: detect animated nodes in the generic cook →
  skip baking their animated transform + record channels (times, TRS,
  linear/step interpolation) and the node→item mapping; store as a sidecar
  `<id>.anim.json` in OPFS (CADM has no animation section), tag the asset
  like `hasNormals`; rAF playback engine sampling into DEDICATED transform
  slots (kept apart from the undo allocator); small Animations UI with
  play/pause/loop/speed per clip. Accepted side effect: TAA/alpha-hash
  never converge while playing (same as camera motion). Explicitly OUT of
  scope: skinning (no vertex weights in the format/pipeline) and morph
  targets — both would be bigger projects than textures.
- **Per-model edge tag / edge strength (reconsider when textures land).**
  The G-buffer normal's alpha is a BIT FIELD (quantized 8-bit, decoded with
  `round(w * 255)`): bit 1 = authored normals (own edge thresholds), bit 2 =
  edge lines off (asset import option), bit 4 = ITEM edges off for this
  item (item-state flag `NO_ITEM_EDGES`, Hierarchy context menu → set on the
  selection, undoable like a hide). The scene fragment shader folds the
  per-item bit in at zero cost (it already reads the item state); the post
  pass gates the id-boundary detector per pixel and lets the LOWER-id side
  draw the silhouette when the higher side has edges off. Five bits free.
  Considered follow-up: a second, opt-in encoding where the byte carries a
  continuous per-model **edge STRENGTH** instead of on/off — e.g. split the
  range (0–0.45 = flat + strength, 0.55–1.0 = smooth + strength, ~100
  levels per category) and composite `edge * strength` in the post pass, so
  e.g. textured meshes can have faint edges rather than none. Keep the
  current binary mode as the default and the strength mode as an option;
  decide when texture support is designed (CADM v9).
- **Click-pick buffer race — CONFIRMED in the wild.** Observed on a real
  machine while rapid-clicking: `[Buffer "itemPickBuf"] used in submit while
  pending map. — While calling [Queue].Submit(...)` (the labels added for
  diagnostics named the culprit directly). Dawn classifies it as a
  **Validation** error, so the bad submit is dropped CPU-side — console spam +
  a lost pick that frame, NOT a GPU hang. This is hazard #1 below, confirmed.
  Fix LANDED: the `pickItemInFlight` guard in `renderer.ts` (rapid clicks
  queue latest-wins in `pendingItemPick` until the readback buffer frees).
  Tracked separately from the device-hung below, which is a *different*
  failure ("unexpected error type Internal", `DXGI_ERROR_DEVICE_HUNG
  0x887A0006`) — a genuine D3D12 device removal seen on only one PC, most
  likely an Intel/Chromium driver TDR rather than our code. Our uncapped pick
  passes (hazard #2) could aggravate a marginal GPU but are not the root
  cause; the same guard caps that load.
- **Click-pick robustness under rapid clicking (status 2026-07-26: both
  hazards addressed).** Historical analysis kept for context; the item-pick
  path now gates on `pickItemInFlight` (mirroring the depth path's
  `pickInFlight`), `pendingItemPick` stays a latest-wins supersession slot,
  the pick pass scissors to the 1×1 cursor texel (fragment/depth work capped;
  vertex work remains), and the depth-probe path copies a single texel
  instead of the whole HZB mip 0 / depth surface. The original hazards:
  1. **Shared readback buffer.** `itemPickBuf` is one buffer reused every
     pick, and `itemPickJob` (the `mapAsync` readback) is fire-and-forget
     (not awaited — `itemPickJob?.()` after submit). If frame N+1 encodes a
     `copyTextureToBuffer` into `itemPickBuf` while frame N's `mapAsync` is
     still pending, the buffer is in `pending` map state → validation error
     at submit. Because the pick copy shares the *main* frame command
     encoder, that error can poison the whole frame's submit. On a validating
     build this is a dropped frame + console error; under the **"Unsafe
     WebGPU"** flag (which relaxes validation) a genuine read/write hazard
     could reach the driver — a plausible, unproven contributor to observed
     Intel iGPU "GPU busy" / context-loss.
  2. **Uncapped pick work.** `encodeItemPick` re-renders the *entire* scene
     through the pick pipelines (all models, both cull passes). With no
     in-flight guard, a rapid click burst fires one full extra geometry pass
     per frame — a load spike that can push a weak Intel iGPU past the OS
     watchdog (TDR).
  Hazard #1 is fixed by the in-flight guard; hazard #2 is mitigated by the
  scissor (a click burst still costs the scene's vertex work, but no fragment
  or ROP work). Still open if ever needed: double-buffer / ring the pick
  buffer. Separately, a `device.lost`
  handler logging `reason` + `message` would turn "Intel just died" into a
  named pass — cheap diagnostics. **Already landed as diagnostics:** every
  WebGPU resource in `renderer.ts` now carries a `label:` (buffers, textures,
  bind groups, pipelines, shader modules), so Dawn validation / device-lost
  messages name the culprit instead of `[Buffer]`.

## Camera-relative rendering (far-from-origin precision)

Models placed far from the world origin (plant coordinates, 10 km+) speckled:
an absolute f32 coordinate resolves to only ~1 mm at 9 km (vs 7.6 µm at 100 m),
which is enough to z-fight coincident faces AND to wreck the screen-space
derivative the flat shading derives its face normal from. The depth buffer was
never the problem — it is already reverse-Z `depth32float` with an infinite far
plane.

The GPU is therefore handed the world REBASED on a per-frame origin: `clip =
view_proj * (world_abs - origin)`, with `origin` = the camera position rounded
to whole units (rounded so it only changes on real camera motion, which keeps
TAA from seeing the rebase as movement). Two details make it work:

- The camera builds the rebased matrix from its **f64** state
  (`viewProjRelative`), so the translation terms are small before they are
  narrowed to f32 — rebasing an already-f32 absolute matrix would keep the
  cancellation.
- The vertex shader rebases **before** dequantizing:
  `(aabb_min - origin) + q * aabb_scale`. `aabb_min - origin` is an exact f32
  subtraction (nearby magnitudes), so the sum lands in small-number space.
  Items with a committed/live transform still go through their absolute-space
  matrix and rebase after — as precise as before, no worse.

Everything the vertex stage interpolates (`world`, `eye`) is in rebased space;
the clip box/planes convert back (`world + origin`) since their uniforms are
absolute. `lastVP` / `lastView` stay ABSOLUTE — host-side picking, the label
overlay and the cull pass all work in world space, where mm precision is
irrelevant. `tests/cameraRelative.test.ts` pins both properties.

Every pass that patches a copy of the frame data (pick @512, outline @768)
indexes it through `frameLayout.ts` — adding `origin` shifted the members and
broke both passes, because their byte size and slot numbers were duplicated as
magic numbers. Keep them there.

Residual (not fixed by this): `aabb_min` is still stored as an absolute f32,
so a meshlet's base is on that ~1 mm grid. Vertices are offsets from that base,
so reconstruction stays sub-mm — but a cook-side recentering (geometry relative
to a per-model origin) is the lever if anything remains.

## Near plane (derived, not stored)

`CameraController.near` is a GETTER over the orbit distance
(`orbitDistance / 12500`, floored at 1 mm), not a value stamped by `fit()`.
The old rule took it from the fitted scene RADIUS (`radius / 5000`), which had
two failure modes: one model 12.6 km out made the union radius ~6.3 km, so the
near plane became ~1.26 m and clipped anything within arm's reach; and the
value then went STALE — unloading that model left the huge near plane behind
until the next fit.

Reverse-Z on `depth32float` has near-uniform relative precision, so the near
plane can hug the camera however large the scene is; that is the whole reason
the projection is reverse-Z. The ratio reproduces what the radius rule gave
immediately after a fit (orbitDistance ≈ 2.5 × radius at the default 55° fov),
so framing behaves as before while flying in close now actually gets close.
Anything reading `camera.near` (the cull params, HiZ, the projection) picks the
same value up automatically. Pinned in `tests/cameraRelative.test.ts`.
