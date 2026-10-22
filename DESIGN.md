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
  `src/lib/render/shaders/`): GPU-driven — cull compute → multi-draw indexed
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
  Settings in the Measurements panel). **Layout rule for this shader
  (2026-09-17):** it reads the cull and info records as raw `u32` words into
  plain `vec3f` locals and passes only scalars/vectors to its helpers — no
  struct with `vec3` members, none passed by value. Qualcomm Adreno 7xx
  compiled the original `info.aabb_min + q * info.aabb_scale` (struct
  parameter) as `aabb_min + q * aabb_min`, so every cast on a tablet hit a
  phantom triangle millions of metres wide in front of the camera; the same
  expression in the vertex-pull render shader was fine. A bounding-sphere
  sanity net rejects any decoded vertex outside its meshlet as a last resort.
  This is the known Adreno GLSL-compiler flaw with sequential `vec3` struct
  members (the fix is the usual "flatten / read through locals" family).
  scene.ts keeps its `MeshletInfo` struct because it evaluates the loaded
  value directly, never through a parameter copy, and renders correctly on
  the same device; if that ever changes, switch it to raw words as well.
  Full trail: plans/fix_pad_measurement.md §9–10.
- **Seam snap** (2026-09-04): a corner made by one item penetrating another is
  no vertex of either mesh, so the plain snap missed it. When the hit is not a
  real corner, a SECOND cast along the same sight line skips the hit item — and
  every item with an opacity override, transparent counting as not there — to
  find the surface just behind; the two triangle planes' intersection line is
  the seam. Its point nearest the sight line snaps as an edge, where it crosses
  a triangle edge of either hit as a corner; both only when the point lies on
  BOTH triangles (a surface merely hidden behind the hit one cannot fake it).
  Priority: corner > seam corner > edge > seam edge > face. Ribbon: Snapping →
  Seams. Pure math in `measureSnap.ts` (`seamProbe`, unit-tested).
- **Transparency**: alpha-hash (converges under TAA) or a depth-sorted blend
  pass; per-item opacity overrides. An effective opacity of 0 is not
  transparency but invisibility: the cull drops such items exactly like the
  hide flag (`isEffectivelyHidden`, mirrored in cull / snap WGSL) and they do
  not enable the blend pass. A third mode, **background** (2026-09-04),
  renders the items set transparent SOLID as a backdrop layer: the same
  transparent-item pass, but unblended and writing depth, with the pass
  viewport squeezing its depths into (0, 1e-9] so every foreground fragment
  beats them while they still occlude each other (float depth keeps relative
  precision when scaled). The transparency itself disappears; what is left
  opaque always stands in front — the "ghosted context" look. No extra pass,
  shader or culling; picking treats depth ≤ 1e-9 as background, so a click on
  a backdrop item hits nothing. Post sees backdrop pixels as very far geometry
  (AO ≈ 0, no G-buffer ids, so item edges outline only the foreground). The
  backdrop is faded toward the canvas colour by a global amount (Settings →
  Transparency → Background fade, default 70 %) carried in the Frame uniform's
  `backdrop` vec4, so the context recedes and what is left opaque stands out.
- **Sorted blend pass** (2026-09-12, review 5b.1 + 5b.4). Blend mode used to
  replay the ENTIRE visible draw list through the blend pipeline with the
  vertex shader degenerating whichever half did not belong (every visible
  meshlet ran the VS twice), and drew glass in emission order — model load
  order, then cull slot order — so a pipe behind a tank could blend on top of
  it, and a pipe's own far wall over its near wall. Now the cull routes: with
  `sort_mode` on (blend mode + any transparency + culling) `emit()` sends a
  transparent meshlet (explicit opacity / override alpha / baked cg alpha < 1,
  mirroring `item_opacity`) to a per-model candidate list `[meshlet, bucket]`
  and bumps a 2048-bucket histogram; the bucket is the bounding-sphere
  centre's view depth, log-mapped between the near plane and the farthest
  scene corner (linear over the ortho slab), bucket 0 = farthest. After cull 2
  a one-workgroup scan per model turns the histogram into exclusive bases and
  publishes the count (vertex-pull args `[372, 2n, 0, 0]` + the plain count
  at word 4 of the model's third count slot) plus the scatter's dispatch args
  (their own 16 B indirect buffer, in a second compute pass: a buffer cannot
  be writable storage and an indirect source within one pass), then the
  indirect-dispatched scatter writes the list back-to-front into
  `recordBufT`. The blend pass
  draws only that list; the opaque passes draw opaque-only records. Same on
  MDI and vertex-pull (`cullMode: 'full'`, no culling at all, keeps the old
  VS routing over its static list). **Facing split** (5b.4): each transparent
  meshlet draws twice, adjacent in the list — MDI records carry
  `instanceCount 2`, `firstInstance 2i` (every record now uses `2i`; the VS
  reads `instance_index >> 1`), vertex-pull lists two entries `i` and
  `i | 1<<31`. Instance 0 keeps back faces, instance 1 front faces, decided in
  the FS from the flat normal oriented away from the meshlet's AABB centre
  (winding is not enforced anywhere in the cook path, so `cullMode` cannot do
  it); the two-sided lighting flip stays. Keeping a meshlet's halves adjacent
  (rather than all back faces, then all front faces) makes a wall patch whose
  centre lies on the wall harmless — its arbitrary facing never interleaves
  with other meshlets — and orders side-by-side pipes correctly; nested
  single-meshlet parts with the same centre remain arbitrary. The pick
  replays the transparent list too (its frame slot has routing off; the
  second instance degenerates outside the split blend pass), and the
  residency counts include it. The outline mask does not replay the scene
  lists at all: a per-model compute filter (`outlineListWgsl`) emits only the
  outlined items' visible meshlets into a fourth draw slot, and the mask
  draws that — a full replay with a per-fragment discard cost a large slice
  of the scene pass on every frame with a selection. Cost: `N + 2T` vertex work instead of
  `2N`; +28 B per meshlet (`MESHLET_RECORD_BYTES` 116 → 144) and ~8 KB per
  model. Not done: cross-model interleaving (draws are per model, so glass of
  an earlier-loaded model stays under a later one's where they overlap) and a
  "front faces only" variant that would show the true slider opacity at the
  price of the far wall; freeze-cull keeps whatever list the last cull built,
  so switching modes while frozen shows stale routing. **Per-model gate**
  (2026-09-18): every worker `StateUpdate` carries `transparent`
  (`modelHasTransparency`: baked alpha or a live transparent override — the
  same set the cull's `meshlet_transparent` can route), the renderer keeps it
  on the `GpuModel`, and a model with nothing to blend skips the sort clear,
  scan, scatter and the blend draw. Blend mode's fixed per-model toll (a
  clear + two dispatches + a draw per loaded model, each with its barrier) is
  therefore paid only by models that have glass; one transparent item costs
  its own model's commands, not every model's. The gate rides with the
  states rather than the async whole-scene `hasTransparency` refresh because
  a gate that lags the states would route glass to a list nobody scans.
- **Marker spheres** (2026-09-04): labels and measurement points can carry a
  sphere drawn in the scene, depth tested — wireframe rings through the
  clip-helper line list, or `solid` fills as instances of one unit sphere
  (`shaders/marker.ts`, `sphereMesh.ts`) drawn after the helper lines with the
  frame uniform bound to both stages (the fragment shades by eye / headlight):
  opaque instances first with depth writes, translucent
  ones blended on top (scene alpha untouched), G-buffer masked so they get no
  edges or ids. Built by `viewport/markerLines.ts`, re-uploaded only on change.
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
  save/load, mute, decimals. Fixed-count tools (Line / Face / Diameter /
  Angle) stay in progress after their last point until OK, Enter or the
  next placed point (`awaitsOk`, 2026-09-17), so the last point can be undone
  from the on-canvas bar — the only way on a tablet; Point commits at once.
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
  Ribbon `Resize (Main)` / `Move (Main)` say which box they act on.
- **Selection transforms**: move/rotate/scale gizmo with custom pivot
  (lock/adjust/item-pivot), nudge/rotate-90° grids, move-to-click,
  per-domain undo/redo.
- **Coloring**: quick swatches + Color Panel (manual color, color opacity),
  opacity overrides, per-domain undo/redo.
- **Set Color Select** (2026-10-20, both Set Color panels): runs the
  enabled rules through the same matcher as Run (`matchColorRuleItems` in
  `colorRules.ts`; Run and Select share `compileRows` / `appendRowHits` /
  `itemSetMatch`) and selects the hits instead of writing overrides.
  *Generate* (rebuild a rule set from a hand-made look) was built beside it
  and REMOVED on 2026-10-21 by the director's call — rules match by name, so
  the result was odd (long sibling lists, duplicate names, a pipe branch's own
  tubes unreachable) and not worth keeping. The State snapshot is the way to
  keep a hand-made look; don't re-propose Generate.
- **Hierarchy**: worker-built tree, name search (plain contains / equals via
  the worker's `db.search`), reveal-on-select, U/P navigation, collapse-all.
  Children are A–Z; the *Model order* toggle (`viewerState.treeModelOrder`,
  2026-10-21) keeps the model file's order from model level 3 down (below
  site / zone — `MODEL_ORDER_FROM_LEVEL`, passed to `treeApi.children`).
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
  in `src/hotkeys/bindings.ts`): `+` together (`CTRL+Z`), a space or comma then (`G X`),
  `[X]` hold, runs (`101` = 1,0,1), double-tap, modifier-only leaders
  (`ALT+SHIFT 2`), per-binding timeout/context, record UI, JSON
  export/import, exact-duplicate validation at boot, suspend-while-recording,
  Console logging of fired shortcuts. Inside text fields shortcuts are muted
  except pure F-key combos (`allowInInput` defaults to true for those, so the
  layout slots work while typing); a muted press carrying Ctrl/Alt/Meta is
  still matched as a shadow and surfaced as a "muted while typing" toast +
  Console line instead of silently doing nothing.
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

**STEP: streamed, spilled, fanned out (2026-09-11).** A 1 GB STEP used to
blow the wasm32 heap: the input was copied into wasm twice, the entity index
rehashed its way up, every unique product's f64 mesh sat in a cache next to the
world-baked buckets, and the coarse cook cloned the whole cooker model. The
step path now runs as a *session* (`step_core::convert::prepare` →
`Prepared::tessellate_jobs` → `Prepared::finish`, wrapped by the wasm
`StepSession`):

- **Input by range.** The main thread stages the file into OPFS
  `temp/step-import/input.step`; the worker reads it through a sync access
  handle behind a 16×256 KB page cache (`io::CachedInput`). The entity index
  is a dense table (`step::EntityTable`, a `Vec<EntityRec>` indexed by id, 12
  B/slot, pre-sized from the file size at ~64 B per entity) that flips to a
  hash map only when ids are sparse enough to waste more than they save.
- **Index once.** The coordinator scans the file and streams its index
  (table + type names + per-type id lists, ~16 B/entity) to
  `temp/step-import/index.bin` in 1 MB pieces (`StepFile::write_index`);
  sub-workers read that file by range straight into their own table
  (`read_index` / `prepare_from_index_file`) — no second scan, no in-memory
  copy of the index on either side (the first cut passed it as a blob, which
  doubled the per-worker peak: wasm heaps never shrink, so a transient copy
  is a permanent one), and identical `of_type` order, so an index-built
  session tessellates the same bytes (pinned by the convert.rs fan-out test,
  which builds its "workers" from the serialised index). Sub-workers open
  `index.bin` and the STEP with *shared read-only* sync handles (Chrome
  121+, far older than the WebGPU flags this app needs). Designated fallback
  if that mode ever fails: write one index copy per worker (the streaming
  writer can fan out to k handles) and stage per-worker input copies, so the
  parallelism survives instead of dropping to in-process — not built.
- **Tessellation fan-out.** The coordinator worker spawns the number of
  `stepTessWorker.ts` sub-workers the Import STEP section's **Workers**
  option asks for (0–5, default 2; 0 = in-process). Each holds its own copy
  of the entity index, which is what the option trades: a 1 GB file measured
  6–8 GB of RAM with five workers when every worker scanned its own hash-map
  index; the dense shared index roughly halves that. Each opens the staged
  file with a *read-only* sync handle
  (Chrome 121+ allows several), indexes it in its own wasm instance, and
  tessellates the product batches it is handed (dynamic sizing: `remaining /
  (workers × 8)`, ≤32) — appending each product's prepared, local-space mesh as
  a `MeshSet::encode` record to `cache-<k>.bin` and returning `(key, offset,
  len)` triples. Any sub-worker failure discards the partial table and the
  coordinator tessellates in-process (`MergeMode::Spill`).
- **Spilled merge walk.** `MergeMode::External` reads each instance's mesh
  back from the cache files, bakes it to world space, and appends the bucket
  chunk (exact f64 + u32) to `spill.bin`; only the draw-range table and a
  running bbox stay on the heap. Products placed more than once are counted
  by a pre-walk that mirrors the walk's depth/budget cut-offs; single-use
  products are never cached. `into_merged_spill` reads the chunks back
  recentred in f64 and cast to f32 — byte-identical to the in-RAM path
  (`direct_cook.rs` now exercises spill; `convert.rs` tests pin spill vs RAM
  and external vs in-process). A 64 MB FIFO hot cache of decoded meshes sits
  in front of the record reads, so a part placed thousands of times is
  decoded once per eviction. The cooker bridge flips positions to Z-up in
  place (reusing the exactly-sized read-back allocation) rather than copying.
- **Cook.** The index and assembly are dropped before the cooker runs; the
  `.tdp` is written straight to a pre-opened OPFS handle and the coarse
  variant is `coarsen_tdp(full)`, never a model clone.
- **Progress** is phase-tagged (`progress::Phase`: index bytes, faces —
  ticked per face and summed across workers — products, cook, write). The
  cook phase has its own percentage: `cooker_core::cook_model_with_progress`
  / `coarsen_tdp_with_progress` tick per draw range through the simplify and
  meshletize passes (1 % throttle), the shell maps full + coarse onto one bar.

Not done: item-level splitting inside one giant product (a single solid with
a million faces still runs on one worker), the undeclared-duplicate detection
(hash the B-rep subgraph before tessellating) and the off-by-default
"split output per assembly subtree" option — both planned as follow-ups.

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
  filtered view selects only its rows. Hotkeys ALT 652–661 belong to this
  work (table 652–657, editor 658–660, reports 661).
- Validation of the `sql.editor` payload lives in a pure module
  (`sqlEditorPayload.ts`) returning `{ error }` — vitest has no
  `@treDeSpaceUI` alias, so a test cannot import `protocol.ts`.

## Animation — objects and keys, like Navisworks Animator (LIVE, 2026-10)

Built 2026-10-14 → 16 on branch `animation01`, then rebuilt the same week
around one idea: **objects you keyframe on a timeline**, the way Navisworks
Animator works, but simpler (D53). The planning docs are folded into this
section. Code comments cite it as `DESIGN.md › Animation › <subsection>` and
decisions by number (`D27`) — see **Decisions** at the end; numbers of the
first build that the rebuild replaced are kept and marked *superseded*. The
user side is the guide page `docs/guide/f10-animation.html`.

### What it is

Rigid item animation (move + rotate) for assembly / maintenance sequences
and walkthroughs. A file holds **scenes**; a scene holds **objects** (item
sets made from the selection, each with **one row of keys**, under a
foldable **Objects** row), a **Scene** row (its settings), a **Camera**
row, a **Clipping** row (`section` in the file), a **Colour rules** row
(Set Color rules in time), **Labels** and **Measurements** rows (the sets
shown, D76), **steps** (named spans with a card that can pause playback)
and an **Overlays** row (`callouts`: a callout on an object, a title card,
caption or info card on screen, shown for a while). Everything while animating sits
in the **Timeline** (toolbar, rows, transport, export); the **Key** panel
edits what is picked — a key, or the *next* key at the time slider. Video
and step-stills export, a brief for Claude Code, and a host API.

Workspace F10 (Animation): the Animation ribbon (Animation — Animate, the
big **Present** button (ALT 1573), New, Open, Save —, Export — Video, Step
stills, Brief for AI —, Panels — toggles for Timeline, Key, Set Color,
Overlay Editor, Overlay Preview, open = selected, drag to place —, View —
Motion paths, Overlays, Camera keys: follow the camera keys or orbit
freely, ALT 1571 —, Edit — Undo / Redo, and the host's **Bookmark**
section when a host sets one, D73), the Timeline at the bottom, the Key
panel with Overlay Editor and Set Color on the right. **Present** (the
button) puts playback in the Present workspace: the 3D view alone with the
floating play bar (D74); ALT+F2 is only that layout slot — it does not
start the mode. Panels: Key (ALT 691), Timeline (692), Overlay Editor
(695), Overlay Preview (696). Hotkeys: the Animation category — kept
commands keep their ALT 9xx / 13xx / 14xx codes, new ones run from ALT 1505
(to ALT 1663); `K` and a **Space tap** play / pause, `SHIFT+J/L` previous /
next step, `R` returns the camera, and **`I` keys** while authoring
(posing.actions listens for it; the viewer's Invert selection on I is off
by its context meanwhile — both sit on window capture, so the table's
claim could not stop the other listener).

### Rigid only — no scale (D1)

Scale is not an animation transform: (1) a scaled CAD item lies about its
dimensions, measurements and snapping, and a construction sequence never
needs it; (2) the cull moves the bounding-sphere centre by the item matrix
but never scales the radius; (3) authored normals are transformed by the
matrix directly, no inverse-transpose — exact for rigid motion only;
(4) the meshlet cone test stays exact under rotation, not under
non-uniform scale. Uniform scale, if ever demanded, needs radius ×
max-axis-scale in the cull plus a decision about normals. (The Transform
ribbon's gizmo does scale — that is an editing feature, not animation.)

### Data model

`src/lib/animation/types.ts` (pure, JSON-serializable); parse / validate in
`io.ts` — version 2, strict, every error names its JSON path; version 1
files (the parts-and-clips tool) are refused with a clear message (D60).
Units: seconds, metres, degrees in the UI, quaternions in storage.

```
AnimationDoc  (format 'tredespace.animation', version 2)
├── scenes[]              one active (Timeline → Scene ▾)
│   ├── objects[]         name, items (lower-cased fullnames, D11),
│   │                     exclude? (left out, D64), pivot (a side of the
│   │                     box — centre, bottom, top, front, back, left,
│   │                     right — or a point), path (straight | smooth),
│   │                     keys[], muted?
│   ├── camera[]          { t, view, interp }
│   ├── section[]         clipping: { t, value (box, planes, shapes), interp }
│   ├── colorRules[]      { t, mode (reset | append | hide), rules }
│   ├── labels[]          { t, labels } — the label set shown from t on
│   ├── measurements[]    { t, measurements } — the measurement set from t on
│   ├── steps[]           { id, name, text, start, end, card?, pauseAtEnd, notes? }
│   ├── callouts[]        overlays: { id, instance, start, end, enter, exit, keys? }
│   └── loop, pingPong, end?, stepCard, keepOverlaysOnScreen?
├── overlayInstances[]    what callouts show: values, anchor, scale, textScale
└── overlayComponents[] / overlayThemes[]   embedded copies (D14)
```

- **An object key is absolute** (D54): `move` / `rotate` are the object's
  offset from where it stands in the model — about the key's pivot (D75),
  else the object's — never a change from the key before. `interp` is how it arrives at the key: `smooth`
  (eased), `linear`, `hold` (stays, then jumps). `spin` adds whole turns on
  the way (slerp alone cannot pass 180°); `pivot` (`{ at, offset? }`: a
  side of the box or a point) is what the key is about (D75). `visible`,
  `opacity`, `color` are
  **instant** and optional — absent = as the key before.
- **Before an object's first key it stands at that key; after its last it
  stays** — for the instant values too (they are read at
  max(T, first key)).
- Camera: no keys = the view is free, one = set there, more = it glides
  (`hold` = a cut). Clipping keys hold before the first and after the last;
  colour-rules keys apply from their time (before the first: the scene's own
  colours); an Append key builds on the rules before (`rules.ts`).
- Steps may not overlap (the parser refuses it, the editors stop at the
  neighbours). Callout position keys are timed from the callout's start, so
  moving the callout moves them.
- Missing ids of scenes, objects, steps and callouts are made up on load;
  an object key's rotation may be written as `{ axis, degrees }` — both for
  files Claude writes. `stepCard` absent = the built-in step card.
- **An object's items nest** (D64): `items` adds nodes (with what is under
  them), `exclude` leaves nodes out; the worker applies both top down by
  tree depth (`resolveItems`), the deeper one winning and a leave-out
  winning a tie — "the module minus its foundation", and a node listed
  inside a left-out one comes back. Names, not item indices, so a re-cooked
  model keeps the set.
- **An item in two objects follows the first one** (the worker gives each
  item one band slot; the Problems list says so). Navisworks moves it by
  both; composing slots is not worth it for how rarely it is wanted.

### Evaluation

Pure functions in `src/lib/animation/` (`interp.ts`, `scene.ts`,
`evaluate.ts`, `rules.ts`, `clipState.ts`, `overlayKeys.ts`), unit-tested.

- **Pose:** `D(t) = T(move) · T(pivot) · R(rotate) · T(−pivot)`;
  `itemWorld = D · base` (base = the item's committed slot at mode entry).
  Rotation is shortest-path slerp, plus the key's `spin` turned in
  (`AA(axis, deg·e) · slerp(r0, AA(axis, −deg) · r1, e)` lands exactly on
  the key). `path: 'smooth'` is a Hermite curve through the keys with zero
  tangents at holds (D30).
- **A key's pivot** (D75, `pivots.ts`): `pivot` on a key is a side of the
  object's rest box — `center`, `bottom` (−Z), `top`, `front` (−Y), `back`,
  `left` (−X), `right`, the view cube's names — or a point of the object
  where it stands in the model (rest coordinates, a hinge), plus an
  `offset` (m); absent = the object's pivot (itself a side or a point).
  The key's `move` / `rotate` are ABOUT that point q: pose = T(move) · T(q) ·
  R · T(−q), so q's world position at the key is move + q. On the way into a
  key the object turns about that key's q_b: its point travels from where
  the key before puts it (`posePoint`) to move_b + q_b, eased, while R
  slerps — a door keyed open on its hinge swings; when both keys share the
  pivot this is the old lerp of moves (and the smooth path). Sides resolve
  from the rest boxes the session knows (`EvalContext.boxes`).
  `sampleTransform` takes a key → point resolver and returns the pose with
  the pivot it is about. An inserted key takes the pivot of the key it
  heads to, so the motion keeps its shape.
- **One row per object, no composition**: the object's pose is its own row
  sampled at T. `evaluate(view, T, ctx)` returns the same `FrameState` the
  engine always took (poses, visible, opacity, colours, the rules, camera,
  clip, overlays, the step at T) — the engine below did not change.
- **Seeking is stateless:** the frame depends on its arguments only.
- **Per-object caching:** each object's result is kept with the stretch it
  stays valid for (between two keys that do not move it, or before the
  first / after the last), so a still object hands back the same pose
  object and the band skips its write (D47's idea, much simpler now).
- **The scene view** (`scene.ts`, memoized per scene object): the duration
  (pinned `end`, else the last key, step end or callout end) and the steps
  in order; `stepAt` (the step running at T), `lastStepAt` (what
  `{{step.*}}` shows in a gap), `neighbourStep` (◀ goes back to the current
  step's start unless T is within 0.5 s of it).
- **Problems** (`problems.ts`): items not found, items shared by two
  objects, an object moving while hidden, a callout whose overlay or design
  is missing.

### Engine and runtime

- **Transform pool** (`transformPoolLayout.ts`): 32 768 mat4 slots (2 MB);
  the top **16 384 are the animation band**, which the committed allocator
  never enters. One slot per (object, base slot) pair; moving objects get
  slots first (D47). The session captures the **active scene's** objects
  and re-enters when the scene, its objects or the loaded models change.
- **Animation mode owns the scene** (D12, D24, D39): `animEnter` captures
  every model's `tidx` runs, colour / opacity / hidden state and the
  clipping, and starts **clean** — items moved with the Transform ribbon go
  back to their original place too — and the user's own labels and
  measurements are put aside (D76) — so an animation plays the same for
  everyone. `animExit` restores all of it; no undo entries are made. While
  the mode owns slots, the worker **refuses committed transform edits**
  (D22); gizmo drags go to posing.
- **Per frame** (`src/state/animation/runtime.ts`, main thread):
  evaluate → write `D · base` (with a pose not keyed yet on top) into the
  band → `writeTransformSlots`. A full pool upload re-applies the band. A
  paused pose is synced to the worker (`animSyncBand`) so selection bounds,
  fit and the gizmo follow. Visibility / opacity / colour and the colour
  rules go to the worker as diffs (`runtimeVisibility.ts`); the worker
  keeps its look / blend machinery (D23–D26), always at mix 1 now.
- **Residency:** each object's swept bounds over its keys go to residency,
  so an object animated far from its rest box is not evicted.
- **Cull upgrade** (D21) — Settings → Culling → *Occlusion-cull moved
  items*, **off by default**: moved meshlets keep the cone and HiZ tests
  when their matrix is verified rigid; otherwise they are drawn whenever in
  the frustum. Needs the in-app A/B before it becomes the default.

### Authoring

- **Make an object** (D55): select items, **+ Object** — named after the
  selected node, with a key at the time slider holding where it stands. A
  selection that is not an object yet also becomes one when you pose it or
  press Key. The same items reuse their object.
- **The current row** is what Key keys: the row picked in the Timeline (its
  object's items get selected so the gizmo sits on them), or the object
  whose items you select in the 3D view.
- **Pose, then Key** (D56, Blender's way, kept from D52): a gizmo drag only
  poses — a world-space matrix per object (`setPendingPose`) drawn on top of
  the evaluated pose; the Key panel shows the **next key** it would write
  (`posingActions.nextKey`) and typed values pose too (`G = K · D⁻¹`); Time
  moves the slider and carries the pose. **Key** (`I`, the Timeline's Key)
  folds it: `K = G · D` decomposed about the pivot; a key already at that
  time keeps its spin and instant values. Moving the time slider or playing
  drops a pose not keyed (toast); Esc and *Discard* drop it too.
  **Auto-key** (red frame) keys every drag at once.
- **Edit a key** (D57): click its diamond — the time slider jumps there,
  the object is selected, the Key panel shows its values; posing and Key
  re-pose it. Drag diamonds to retime (one undo step per drag — the rows are
  taken at the drag's start), box-select, Ctrl+C / Ctrl+V at the time
  slider, Delete.
- **Items like a Navisworks set — and better** (D64, D65): the Key panel's
  *Items* lists the nodes added (+) and left out (−), each with ×; *Add
  selection* / *Remove selection* (names shown as the tree spells them,
  `animTreeNames`; stored lower-cased) edit the lists hierarchy-aware in the
  worker (`animEditItemSet`): adding drops the entries under the node and
  the leave-outs it overrides, listing it only when no group above holds
  it; removing drops the entries under it and leaves it out when a group
  above still holds it; an object is never emptied. The **closest group**
  (`animClosestGroup`): the lowest named node holding every listed node,
  minus the maximal subtrees not in the set (≤ 12) — suggested under the
  list ("Closest group: X minus N — Use it") only when it is simpler (fewer
  entries) and the set sits in one model. A group follows the model: an
  item added under it later moves with it. The Claude brief asks for the
  highest node plus `exclude` for the same reason.
- **Many objects at once, several posed together** (D78): *+ Object ▾*
  (and the **Objects** row's Key panel) makes one object per child of each
  selected node — a group becomes its parts, in the Hierarchy's order — or
  one per selected node (`objectsActions.fromSelectionParts`, the worker's
  `animSelectionParts`), each keyed at the time slider where it stands, in
  one commit; nodes that are an object already are skipped, more than 50
  ask first. The object rows sit under a collapsible **Objects** group row
  (`@objects`, a UI row only — nothing in the file). Ctrl-click on a row
  name adds / drops that object, Shift-click picks the run from the current
  object (`timelineEditActions.pickRow` mods → `selectObjects`, the union of
  their item sets via `animSelectActors`); `objectSelection` (the objects
  owning selected items, from the selection sync) lights the names up. The
  gizmo already poses every object the selection names and Key keys each,
  so nothing else changes; the Next key header says `+N`.
- **Instant keys:** *Hide / Show / Colour / Own colour from here* put a key
  at the time slider holding where the object stands (an inserted key takes
  the arriving interpolation of the key after it, so a movement keeps its
  shape as far as possible).
- **A key's pivot** (D75, D79): *Pivot* (As the object · Centre · Bottom ·
  Top · Front · Back · Left · Right) and *Offset* sit under Rotate, for a
  picked key and for the next key (`nextPivot`, like `nextInterp`, cleared by
  Key). Changing them keeps the pose — the object stays, Move / Rotate are
  re-said about the new pivot (`rePivot`) — and typed Rotate then turns
  about it. Picking a side starts its Offset at zero. A key whose pivot is a
  point (a file's hinge, or a key from before D79) reads as *Centre* plus
  the offset that reaches the point (`choiceOf(spec, box)`), so the numbers
  say where it is; an edit rewrites it as Centre + offset. A new key takes
  the pivot of the key the object is heading to — the next key, else the
  last (`keyHere`), side and offset. The object's own Pivot (a Select of the
  same sides, or Point) is the default; changing it re-says every key
  without a pivot of its own about the new point, so nothing moves (D84).
- **The gizmo turns about the key's pivot** (D79, `gizmoPivotSync.ts`):
  while authoring with an object row current, the Transform ribbon's pivot
  is put on the picked key's pivot, else the next key's, at the object's
  pose at the time slider (its keys plus a pose not keyed yet — also with a
  key picked, so the gizmo follows the object while scrubbing) — a side is the object's
  own side carried by that pose, so Bottom after a tip-over is the object's
  turned bottom, not the bottom of the box it fills now. Moving that pivot
  by hand (Set pivot → drag, an item's centre) writes the key's Offset from
  its side (`pivotThrough`: K⁻¹·P − side), the side kept; a picked key is
  re-said about it (pose kept). A reset (a new selection, Cancel) puts it
  back; leaving authoring clears a pivot the sync put there. It replaces
  D75's "a locked pivot becomes a new key's Point", the Key panel's *Point*
  choice and the *Pivot gizmo here* / *Point from the set pivot* buttons
  (ALT 1568 / 1569 retired).
- **Slide in** (D58): a side (six), a distance in metres and a time — a
  hidden key at 0 away from place (when nothing keys the object before),
  a shown key away at the time slider (hold), and its place at the end.
- **Camera / Clipping rows**: set up the view / clip the model, then Key.
  Moving the view yourself frees the camera until you Key it or press Play
  (D10). The orbit helper writes eight camera keys; the Camera split
  button keys a saved **viewpoint**'s camera at the time slider (D67). A
  picked camera key shows its **Position** (the eye) and **Target** as
  points in the model, typed values move its view (D69; `cameraEye.ts`, the
  viewer's az / el convention, elevation clamped to ±89°). The row is
  called **Clipping** in the UI; the file keeps `section` (D70).
- **Colour rules row** (D68, replacing D59's round trip): the Key panel
  holds the Set Color rule editor itself (`RuleEditor` bound through
  `MultiColorProvider` to `rulesEditorState`). A picked rules key is edited
  in place — each edit a commit, a burst one undo step, the scene showing it
  at once. With the row current and no key picked the editor is the **next
  rules key**: an Append draft (on top of the rules in force) previewed as
  a pending rule set, dropped like a pose when the time slider moves; Key
  keys it and picks the new key. *Rules in force* starts the draft from the
  composed rules at the time slider; *From Set Color* (and Set Color's Run
  while authoring) brings the big panel's rules in — its Save / Load stay
  there. `rulesEditor.actions` binds it while authoring.
- **Labels and Measurements rows** (D76, `annotations.actions.ts`,
  `lib/animation/annotations.ts`): a key holds the animation's own copy of a
  label set / measurement set (fixed points in the model — they do not
  follow moving objects; Overlays do), shown from its time on, none before
  the first key; each label's mute and colours, each measurement's
  visibility, are part of it. Entering the mode puts the user's sets aside
  (exact, ids kept — so a live viewpoint does not count as edited) and
  un-mutes the stores; leaving puts them back. The runtime's frame handler
  (`setAnnotationsHandler`) shows the key in force when it changes, quietly
  (`labelsActions.replaceQuiet`: no undo step, ids re-based so new labels
  never collide; skipped when the screen already shows it — an edit that
  went into the key, so typing in the Label panel keeps focus). While
  authoring the normal Label panel and measuring tools edit what is on
  screen: with the row's key in force picked the edit goes into it
  (coalesced), otherwise it waits for Key on the row (`previewLabels` /
  `previewMeasurements`, the viewport banner) and a later key coming into
  force drops it. The Key panel lists what is on screen with an on / off
  box each, *From the scene* (the put-aside set) and *None from here*.
  Captures leave muted labels out and use each label's leader colour.
- **Quick colour rules** (D66): the Rules split button's menu keys Set Color
  rules made from the **selection** — any items, not only objects — as one
  `multi` filter of the selected nodes: *colour* (the key colour) /
  *transparent* / *hide* on top of the rules before (Append), *only the
  selection* (Hide mode), plus *hide everything* (Hide, no rules — build up
  from nothing) and *the model's own colours* (Reset). They are ordinary
  rules keys: the Key panel edits them (*Edit the rules in force*). Colour
  belongs to rules, motion to objects — an item that is only coloured needs
  no object.
- **Steps**: Key on the Steps row adds one from the time slider to the next
  step (or 5 s) — never inside another; edges stop at the neighbours.
- **The Timeline** (`src/components/panels/animation-timeline/`): toolbar —
  Scene ▾ (the scene's name; switch, rename…, new…, delete — new and rename
  ask for a name) · + Object · Move Rotate Pivot ▾ · Key · Delete key · ◀
  key ▶ · Auto-key (a record dot, red while on) · the look tools (show /
  hide toggle, key colour — a compact swatch —, Colour ▾ — own colour,
  transparent, opaque, hide, show —, Rules ▾ — the Key panel's rules, quick
  rules) · Overlay ▾ (callout on the selection, title card, caption, info
  card, step card, warning, the user's designs — D71) · Camera ▾
  (viewpoints, orbit, back to the camera keys) · Clipping · time box ·
  ⏮ ◀step ▶/⏸ step▶ ■ ⏭ · Loop · Ping-pong · Snap · Zoom · Present (a
  screen icon) · Export ▾ (a download icon) (D67) — two rows in the F10
  layout's Timeline; the menu buttons open from hotkeys of their own (D83).
  Rows — Scene (a bar with its name over the whole scene: its settings in
  the Key panel), Steps (bars, pause markers), Camera / Clipping (diamonds,
  glide bars), Colour rules, Labels, Measurements, Overlays (a lane per
  overlay, named by its design and title) and the object rows under a
  foldable Objects row (D78; filled diamonds; hollow where the key holds;
  bars between keys that move; hatched where hidden); a dashed end mark
  (the @treDeSpaceUI Timeline's `hollow` points and `endMark`). Playing
  back only, the Timeline is read-only (D82).
- **The Key panel** (`src/components/panels/animation/`, panel id
  `animation`): the picked key; an object row's next key + the object (name,
  its *Items* — added / left out, *Add* / *Remove selection*, *Select*,
  *Update from selection* (keys kept), the closest group —, pivot, path,
  Slide in, mute, delete); the camera (position / target) / clipping row
  and keys; the colour rules (the rule editor itself); a step (name, text,
  start / end, pause, its card, notes); an overlay (design,
  values, anchor, place keys, size, times, effects); or the scene (name,
  end — pinned or not —, loop, ping-pong, step card, labels on screen) and
  the Problems list.

### Steps and callouts

- A **step** is a named span on the Steps row: while it runs its card
  shows — its own (`card`: design, values, place pin, text size, theme),
  the scene's step card (`stepCard`, the built-in Step card by default), or
  none — as a virtual overlay `step:<id>`; playback can wait at its end
  (`pauseAtEnd`; the video holds there). `{{step.name / text / index /
  count}}` fill in; the older `{{part.*}}` / `{{actor.name}}` still resolve
  (designs saved earlier keep working). Previous / next step in the
  transport, the play bar and the host API; one still per step.
- A **callout** shows an overlay instance from `start` to `end` with enter
  / exit effects, hanging from an object (anchor kind `object`) or on
  screen; once it has position keys (or Auto-key is on) a drag in the view
  keys its place at the time slider.

### Player

- **The player never takes the camera back** (D10): any camera input
  switches it to *free*; Return blends back to the camera row (a
  smoothstep onto a moving camera, a fly onto a still one); Play from a stop
  and Continue follow the camera keys again.
- **Space tap** = play / pause (D9): fires on a clean key-up, built as the
  generic hotkey option `trigger: 'tap'`.
- Stops at the end of a step with *pause at end* (status `waiting`;
  Continue goes on), at the end, or loops / plays back (**Loop** and
  **Ping-pong** are the scene's, D61). Scopes: the scene, a step (stops at
  its end), the Timeline's in / out range.
- **Presenting** (D62): the floating play bar over the 3D view (the scene to
  play when there are several, the step number and title, previous / next
  step, a scrubber, the Camera keys toggle — follow the camera keys or orbit
  freely; switched off it stays off through Play, Continue and a restart
  (`cameraOff`), while a mere view move still returns on Play (D10) —,
  Close) shows whenever the mode is on and the Timeline is not
  open.
- **Present** (D74, `present.actions.ts`): the ribbon's big Present, the
  Timeline's screen icon, ALT 1573 and the host's `animation.present` enter
  playback in the built-in Present workspace after taking a snapshot of the
  dock (`layoutsActions.snapshot`: panels, floating windows, active ribbon,
  collapsed or not, selected slot) and the mode. Close on the play bar (and
  ALT 903) restores both — authoring again, or the mode off; pressed again
  while presenting, Present keeps the first snapshot. Leaving another way
  (Animate) just drops it.

### Overlays

- **Rendering** (D15): one `<svg>` under the viewport host; each instance
  is a `<g>` (leader + card) whose card is inline-styled HTML in a
  `<foreignObject>`. Screenshots and video serialize it as a `data:` URL at
  shot resolution. System fonts only.
- **Themes** (D77): an overlay, step card or scene step card without a
  theme is **Auto** — drawn with the Light theme in the app's light theme
  and Dark in the dark one (`autoTheme`, the library's copies, so restyling
  Dark / Light restyles Auto); picking Dark or Light forces it, user themes
  as before. The Overlay Editor's preview has the same picker (Auto by
  default) and its Theme section edits the theme in effect ("Dark (auto)").
  The built-in "Default (dark)" is now named Dark (id `theme.default` kept;
  saved library copies take the new name).
- **Safety** (D13): no raw HTML / CSS from anyone — structured styles
  mapped to CSS in code, escaped text, validated colours, `data:` images
  only (≤ 1 MB), icons from a fixed list. The design parsers live in
  `src/lib/overlay/overlayParse.ts` (shared JSON readers in
  `src/lib/jsonFields.ts`); the library, overlay files and animation files
  all go through them.
- **Components** have parameters and text templates — `{{param}}`,
  `{{step.*}}`, `{{object.name}}`, `{{time}}`, `{{duration}}`; `showIf`
  hides a block. Presets: Step card, Callout, Caption bar, Title card, Info
  card with image, Warning banner. The library is per user in OPFS; an
  animation file embeds the designs it uses (D14).
- **Values drive styles** (D51): a style colour may be `{{key}}` of a
  colour value and a text `size` `{{key}}` of a number value; a design's own
  `textScale` multiplies every text, times the placed card's.
- **Overlay files** (D51): `*.tdoverlay.json` — Overlay Editor Export ▾ /
  Import…; built-in ids are refused; the design JSON Schema is
  `overlaySchema.ts`.
- Effects are computed from the overlay's progress, never CSS transitions,
  so seeking and capture are exact (D18); *Keep labels on screen* flips or
  clamps attached labels (D32).

### Capture: video and step stills

`captureSession.ts` is shared: one render size, view cube hidden, no
selection / hover, residency paused; per frame seek → worker colours
synced → snapshot (converged in Best quality) → overlays composited as
screenshots do → scaled. **Video** (D36, D88, D89): offline, frame by frame;
WebCodecs encodes, Mediabunny packs the MP4 and **streams it into a file**
(OPFS `temp/video`) as it is made — the index reserved at the start
(`fastStart: 'reserve'`, the frame count is known up front), so the file is
Fast Start yet never held in memory; the download reads it from disk, and
the next export clears the folder. What it shows (`videoSegments`): every
scene one after another, each whole (empty ones left out), or one scene —
whole, or a part from Start to End (seconds; filled from the in / out range
or the step at the time slider; an End past the scene's end holds its last
picture). Between scenes the player switches and captures the next scene at
once (`syncSessionNow({ force })`), and goes back to the open scene after.
It waits at steps that pause, their card up. The dialog says how long the
video will be. The camera is the camera row's (without keys the view stays
as it is). A hidden tab stops drawing, so the export waits there (the tab's
title says so). **Step stills** (D49):
one picture per step at its end into a PDF (`pdfWriter.ts`), titled with
its number and name, its text below.

### Files and host API

- `*.tdanim.json` via the ribbon's New / Open / Save (version 2; older or newer → an error, nothing
  changes). OPFS: `animation_draft.json` (autosave every 5 s while dirty;
  an earlier session's draft is offered at the top of the Timeline —
  Recover / Discard, ALT 981 / 982 — and kept untouched until then: no
  autosave over it, no delete on New / Open / Save) and
  `overlay_components.json` (the library).
- **Claude** (D63): the Timeline's Export ▾ → *Brief for AI…* (and the
  ribbon's Export › Brief for AI)
  (`brief.ts`) — what to ask the user (above all what is visible at the
  start), how a scene and every Timeline row plays, several scenes in one
  file (each from the model as loaded, objects per scene, shared overlays),
  every field — camera views (negative elevation looks down, the short-way
  glide), clipping, labels and measurements written by hand —, patterns and
  a two-scene example (each opens as it stands — a test checks), the user's
  cards and themes, custom designs, what the app's Problems list flags, and
  the JSON Schema (`animSchema.ts`, every field the parser reads); the *Item list for AI* shortcuts
  (ALT 1550 / 1551 / 1552 — selected nodes / children / every leaf; not
  in the menu, which keeps just the brief) write `animation-items.csv` — name, fullname,
  parent, depth, items, model, centre, size — with the SQL result's columns
  joined on when it has a fullname column. `npm run anim:check <file>`
  parses a file the way Open does and lists design fields the parser would
  drop.
- postMessage: `animation.load / get / setMode (mode, scene) / present /
  setBookmarkButton / play (scene, range or step) / pause / continue / seek /
  listScenes / setScene / listSteps / playStep / gotoStep / returnCamera /
  getState` and the events `animation.stateChanged (with the active scene) /
  stepStarted / stepEnded / ended / bookmark` — see `EVENTS.md`.
  `listScenes` / `setScene` work with the mode off too (D87).
- **Host presenting and bookmarks** (D73): `animation.present` is one call
  from a file to a running presentation — load the doc (optional), the
  scene, playback, the built-in Present workspace (`presentWorkspace`, not
  the user's ALT+F2 slot; `ribbon: false` collapses the ribbon), `play`.
  `animation.setBookmarkButton` puts a SESSION-ONLY big button in its own
  Bookmark section at the end of the Animation ribbon (`hostBookmark.*`,
  hotkey ALT 1572); a click emits `animation.bookmark` with the doc as Save
  writes it — the twin of the viewpoints bookmark. The demo's Animation
  section picks a file, loads / presents it, sets the button and presents the
  last bookmark.
- A saved dock layout naming a panel the app no longer has loads without it
  (`DockManager.loadLayout` drops unknown panels).

### Testing

`npm run test:anim` (`scripts/anim-e2e.mjs`, scenarios in
`tests/e2e/animation.e2e.mjs`, in-page probe `tests/e2e/animProbe.ts`) boots
the app headless with a sample model and every animation panel open, and
drives each flow through the actions its buttons and hotkeys call — + Object,
posing and Key, editing a picked key, the next-key values and Time, instant
keys, Slide in, the camera / section / colour-rules rows (with Set Color's
Run previewing), steps (filling, pausing, previous / next), callouts,
item sets (a group minus the selection moving without it, add back, the
closest group, hierarchy-aware add / remove), quick colour rules, the show /
hide toggle and viewpoint camera keys, the Key panel's rule editor (in-place
key edits with one undo step, the previewed draft, rules in force), camera
key points, overlay lanes, a key's pivot, and the Labels / Measurements
rows (keyed from the screen, on / off into the key, the user's sets put
aside and restored),
Timeline drags / copy / paste / delete with undo, Auto-key, mute, update
from selection, scenes, loop / ping-pong, the file round trip and the v1
refusal, the host API, and what the panels show — and the review's
regressions (`review:` scenarios): real I and Ctrl+C key presses (`t.press`),
the row-name right-click, step room, auto-key on loose items, typed values
with several objects, rules keys keeping poses, pivots that never move the
object, the waiting step's card, the draft bar, Present over Present, an
exit while entering, menu hotkeys and the read-only playback Timeline. A console error or React
warning fails the scenario. Video and stills need a GPU snapshot and are
not covered. Unit tests (vitest) cover the pure core (`animationModel`,
`animationKeyRows`, `animationInterp`, `animationBrief`).

### What Navisworks users struggle with — and the answer here

From Autodesk forums, AUGI and tutorials, before the rebuild: keys relative
to the key before (objects start in the wrong place) → keys are absolute and
the first key is visible; **no multi-select of keys** → box-select, Shift,
copy / paste; rotations past 180° turn the short way → spin; the pivot does
not stick → the pivot belongs to the object; edits lost when you scrub → the
*not keyed* banner, a toast, and Time carrying the pose; the camera moves
while you scrub object keys → moving the view frees it; no visibility key →
show / hide keys as hatched spans; values only in a modal dialog → the Key
panel, always open; export freezes or drops overlays → offline frame-by-
frame MP4 with overlays.

### Open

- In-app A/B of the cull upgrade before it becomes the default (D21).
- The new tool in-app on a real GPU (the e2e suite is state-level and
  headless): video and step stills, the Timeline at scale (hundreds of
  objects), residency of objects animated far away.
- On host demand: overlay designs and live values over the SDK; a command
  to add keys.
- Not built: per-object loop / ping-pong, an item moved by two objects at
  once, a shared (team) overlay library, a `{{prop.TAG}}` placeholder from
  the model DB, click-to-play triggers.
- **Search-set objects** (Navisworks' search sets): an object defined by
  Set Color filters, so items matching later move too. The matching lives
  inside `applyColorRules`; it would have to be pulled out as a pure
  "fullnames matching these filters" worker call first. Groups with
  `exclude` cover most of it today (a group follows the model).

### Declined — don't re-propose

Scale (D1); item fades and colour / look fades (D5, D53 — instant keys);
ghosting and spotlight (D53); a Bezier / curve editor (D30 — smooth paths);
audio; collision-aware paths; a viewpoint that opens an animation (D34);
the Planner / Storyboard / wizard / parts model (replaced by D53 — don't
bring parts back as containers).

### Decisions

| ID | Decision |
|---|---|
| D1 | Rigid motion only — no scale. |
| D2 | 99 % of use is move + rotate; design around that. |
| D3 | *Superseded by D54.* Keys are deltas from the rest pose. |
| D4 | *Superseded by D53.* Sequences are reusable clips. |
| D5 | No item fade; opacity is an instant value. |
| D6 | 2D overlays as reusable components with an editor, styles and text templates. |
| D7 | *Superseded by D53.* Animations built from linked parts. |
| D8 | Viewer story: play, pause, move the camera freely, continue. |
| D9 | Space tap = play / pause (`trigger: 'tap'`); Space + click stays fly-to; `K` too. |
| D10 | The player never takes the camera back on its own. |
| D11 | Item identity = lower-cased fullname (as viewpoints and `.tdsnap`). |
| D12 | Animation mode does not modify the scene: enter captures, exit restores; no undo entries. |
| D13 | Overlays take no raw HTML / CSS; structured styles, escaped text, `data:` images. |
| D14 | Overlay library per user (OPFS); animation files embed the designs they use. |
| D15 | Overlays are one SVG layer with foreignObject cards; captured as a `data:` URL. |
| D16 | *Superseded by D53* (one row per object, no composition). |
| D17 | *Superseded by D53* (callouts carry their own times). |
| D18 | Overlay enter / exit effects computed per frame, never CSS transitions. |
| D19 | Opacity keys clamp to ≥ 1 % in the worker; hiding is visibility's job. |
| D20 | *Amended:* animation hotkeys keep their ALT codes; new ones from ALT 1505; `I` keys while authoring. |
| D21 | Cull upgrade ships off by default; cone + HiZ only for verified-rigid slots. |
| D22 | The worker refuses committed transform edits while animation mode owns slots. |
| D23 | Colour rules in time are Set Color rule sets (the worker's look machinery). |
| D24 | Animation mode always starts from a clean scene (colours, opacity, hidden). |
| D25 | Layering: clean scene → colour rules → objects' own keys. |
| D26 | *Superseded by D53* (no fades; the worker blends at mix 1). |
| D27 | *Superseded by D59.* |
| D28 | *Superseded by D53* (the wizard is gone). |
| D29 | Picking a key moves the time slider there; the gizmo re-poses it (D57). |
| D30 | Smooth paths (Hermite through the keys); no Bezier handles. |
| D31 | *Superseded by D53* (an object is one set; make one per item if needed). |
| D32 | Callout position keys; keep labels on screen. |
| D33 | Clipping keys: the Clipping row (`section`) glides or switches. |
| D34 | "Save this moment" (viewpoint → animation link) removed. |
| D35–D37 | *Superseded:* the ribbon is now Animation · Export · Panels · View · Edit (D53). |
| D36 | Video export offline, frame by frame; WebCodecs + mp4-muxer (*mp4-muxer superseded by D89*). |
| D38 | Append colour rules build on the rules before. |
| D39 | The clean start covers Transform-ribbon moves too. |
| D40–D46, D48, D50 | *Superseded by D53 / D63* (the Planner and plan files are gone; the brief describes the animation file). |
| D47 | Performance: movers get slots first, per-object result caching, content keys. |
| D49 | Step stills: one picture per step into a PDF. |
| D51 | Custom designs: values drive font sizes and colours, a design's own text size, overlay files. |
| D52 | *Kept as D56.* Posing like Blender. |
| D53 | **Rebuild like Navisworks Animator**: scenes of objects (one key row each), camera / section / colour-rules rows, steps as named spans with a card, callouts; parts, clips, sequences, links, roles, the Planner, Storyboard, wizard, Player panel, ghosting, spotlight and fades go. |
| D54 | Object keys are absolute (offset from the model place); before the first key it stands there, after the last it stays; instant values absent = as before. |
| D55 | An object is made from the selection (named after its node, a key where it stands); a selection that is not an object becomes one when posed or keyed. |
| D56 | Pose, then Key: drags draw a pending pose, Key (`I`) keys it at the time slider, scrubbing drops it; Auto-key is opt-in with a red frame. |
| D57 | The Key panel edits the picked key or the next key at the time slider; the Timeline holds Capture (Key), Move / Rotate and the transport. |
| D58 | Slide in takes a distance in metres, not × the item size. |
| D59 | *Partly superseded by D68:* colour rules keyed on the Colour rules row; no separate animation Set Color panel. |
| D60 | Start fresh: file version 2; version 1 files are refused. |
| D61 | Loop and ping-pong per scene only. |
| D62 | Presenting = the floating play bar (step title, previous / next step); no step-list panel. |
| D63 | The Claude brief, schema and `anim:check` describe the version 2 file; item lists stay. |
| D64 | Objects hold nodes added **and** left out (`exclude`), nested by tree depth, the deeper one winning — a group minus a few, like Navisworks sets with an exclusion they lack. |
| D65 | Add / Remove selection edit the lists hierarchy-aware in the worker (changed the least, kept tidy, never emptied); the closest group is suggested only when it is simpler and in one model. Claude is told to prefer the highest node plus `exclude`. |
| D66 | Quick colour-rules keys from the selection (colour / transparent / hide / only these) and for the whole model (hide everything / own colours) — ordinary rules keys, edited in the Key panel since D68; colour stays the rules' job, motion the objects'. |
| D67 | The Timeline toolbar carries every everyday key: show / hide toggle, key colour, Colour ▾, Rules ▾, Camera ▾ (viewpoints, orbit), Clipping — each with a hotkey (ALT 1553–1565 new). |
| D68 | The Key panel holds the Set Color rule editor: a picked rules key is edited in place, otherwise it is the next rules key (an Append draft previewed, dropped like a pose, Key keys and picks it); Set Color's Run and *From Set Color* feed it. |
| D69 | A camera key shows and takes its eye position and target as points; az / el / distance are derived (elevation ±89°). |
| D70 | "Section" is called **Clipping** in the UI; the file field stays `section` (files keep opening). |
| D71 | The Callouts row is the **Overlays** row (`callouts` in the file): callouts, title cards, captions, info cards, step cards and the user's designs, added from the toolbar's Overlay ▾; lanes are named by design and title. |
| D72 | *Superseded by D75* (a key's pivot only shaped the motion into it; its pose stayed about the object's pivot). |
| D73 | The host presents an animation in one call (`animation.present`) and gets a SESSION-ONLY Bookmark button in its own ribbon section (`animation.setBookmarkButton` → `animation.bookmark` with the doc). |
| D74 | Present remembers the layout and mode it replaced; the play bar's Close restores them. The play bar's camera control is a follow / orbit-freely toggle. |
| D75 | A key's pivot (a side of the object's box, or a point; plus an offset) is what its Move / Rotate are about and what it turns about on the way in; it sits under Rotate in the Key panel, for picked and next keys, and changing it keeps the pose. |
| D76 | Labels and Measurements rows: keys hold the animation's own copy of a set, shown from their time on; the user's sets are put aside while animating; the normal tools edit what is on screen (into the picked key in force, else waiting for Key). |
| D77 | Overlays without a theme are Auto: the app's light / dark theme (Light / Dark); Dark or Light forces one. Callouts get a theme picker; the Overlay Editor previews Auto by default. |
| D78 | + Objects one per child / per selected node (keyed where they stand, existing ones skipped); object rows grouped under a collapsible Objects row; Ctrl / Shift on row names select several objects to pose together. |
| D79 | The gizmo's pivot and the key's are one point while authoring: the ribbon pivot sits on the picked / next key's pivot at the object's pose now (sides are the object's own, turned along), dragging it writes the key's offset from its side; a side starts at offset 0; a point pivot reads as Centre + offset (no Point choice); new keys carry the pivot on. |
| D80 | Authoring folds keys in double precision and "the same place" is 0.1 mm (`SAME_PLACE_M`): a key pressed twice without moving is a pause on the smooth path, far from the origin too; the smooth path rests at keys next to a Hold. |
| D81 | While playback waits at a pausing step's end, that step stays the step and its card stays up (evaluate's `held`); video hold frames and step stills hold their step's card. One step plays once (Loop / Ping-pong are the scene's); a pausing step at the end of a looping scene pauses; `animation.ended` only for the whole scene. |
| D82 | The mode started from the Timeline's workspace (K, an export, with the Timeline or Key panel open) is authoring; playing back only, the Timeline is read-only with a hint and the Key panel waits for Animate. |
| D83 | Menu buttons open from hotkeys of their own (`menuRequests`, the shared `useMenuAnchor(menuId)`); the Overlay Editor's design fields, the preview's toolbar and an overlay's place get hotkeys that press the control on screen (`pressControl`). |
| D84 | Changing an object's pivot keeps every key's pose; Pivot from the gizmo is the point of the object under it where it is drawn now. |
| D85 | Key on several objects is one undo step; a Timeline drag is one undo step however slow (`GESTURE_COALESCE`); keying colour rules keeps object poses and Key on objects keeps a rules preview (pending poses and rules clear separately); the next key's interp / pivot apply to their object only. |
| D86 | An earlier session's unsaved animation is offered at the top of the Timeline (Recover / Discard) and kept untouched until then. |
| D87 | The host gets and sets the active scene: `animation.listScenes` (id, name, duration, steps, objects, and the active one) and `animation.setScene` (with the mode on: stopped at the scene's start); `animation.stateChanged` carries `scene` and goes out when it changes. |
| D88 | Video export: all scenes one after another, or one scene — whole, or a part from Start to End (typed, or from the in / out range or the step at the time slider); replaces "the step at the time slider / the in / out range" choices. |
| D89 | The MP4 is packed by **Mediabunny** (MPL-2.0, unmodified; mp4-muxer is deprecated in its favour) and streams into an OPFS file as it is made (index reserved at the start for the known frame count), downloaded from disk — memory no longer grows with the video's length. The encoder stays ours (codec fallback, hidden-tab recovery); Mediabunny only muxes. |

## postMessage host API

Shipped: the viewer embeds (iframe or `window.open`) and is driven by a host
page over `postMessage`. `src/lib/messageApi/` is the whole app side —
`index.ts` installs the one message listener (from the app startup effect):
origin allowlist (`transport.ts`) → envelope check → per-command payload
validation in the per-domain `handlers*.ts` → a call into the SAME action the
UI uses (async commands hold the same Web-Locks import lock); `registry.ts`
holds the few app hooks (kiosk, panel control, instance data). Responses go to
`event.source`; app→host events (`tree.select`, `instance.changed`,
`theme.changed`, `viewpoints.bookmark`, `dialog.changed`, the `*:progress`
family) are posted unsolicited with `id: null` to the parent, the opener AND
every embedded external-app frame.

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
  host's). Wipe All (Home → Wipe) removes only `tds:` keys and the viewer's
  own OPFS entries (`VIEWER_OPFS_ENTRIES`), never the origin's whole storage
  — the fix for a host page losing its keys to the viewer. The hotkeys
  library keeps its own default key and is pointed at `tds:hotkeys` by
  `installHotkeys`.

### GPU device loss & recovery (2026-09-11)

The WebGPU device can vanish under the app: Chrome's GPU process crashes, or
the driver runs out of video memory (too many models loaded, another
application took the VRAM). The page's own process — and with it the model DB
worker — survives, so hierarchy, item states, colors and transforms are all
still there; only VRAM is gone. `Renderer.onLost` (from `device.lost`, ignoring
the `destroyed` reason our own `dispose()` produces) stops the viewport's frame
loop and hands over to `src/state/viewer/gpuRecovery.ts`, which asks the user
and then:

1. snapshots the camera pose from the dead renderer;
2. remounts the viewport panel in place (`DockManager.remountPanel`) — a fresh
   adapter, device and `Renderer` in the same host; the boot settles a promise
   with the new instance;
3. rebuilds the renderer's model array to line up with the worker's
   (`db.slotSummaries()`): live slots re-read their cooked file from the OPFS
   asset store (coarse first under a VRAM budget, like a fresh load), repack in
   the worker for the SAME slot and upload — sequential uploads reproduce the
   slot indices and item bases — while removed slots get a
   `reserveTombstone(itemCount)`; a model whose file is missing or whose item
   table changed is unloaded in the worker too and named to the user;
4. re-pushes item states and the transform pool, re-registers residency
   records, restores the camera.

Nothing is persisted for this: the worker IS the state. Settings → GPU has a
"Simulate GPU crash" button (`Renderer.simulateDeviceLoss()`, which destroys the
device with a flag so the handler treats it as a real loss); a real GPU-process
crash can be provoked with `chrome://gpucrash`.

## Not yet ported from native

Genuine parity gaps — features the native renderer ships that the web viewer
does not (verified by a full feature diff, 2026-07-18):

- **Smooth / computed vertex normals.** Native shades with per-vertex normals
  (`--compute-normals`, for weldable `_nor` models) and falls back to flat.
  The web viewer is **flat-only**: `fs` in `shaders/scene.ts` always derives the
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
  (default on) drops hidden items — unhide triggers a re-pack. "Hidden" is
  `isEffectivelyHidden` (dbState.ts): the hide flag OR an effective opacity
  of 0 (opacity override 0, colour override alpha 0) — the rule the cull and
  snap shaders mirror, so an invisible item costs no VRAM and no draw. Cuts
  apply to mixed and coarse packs only, never to plain full loads.
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
  draw the silhouette when the higher side has edges off. Bit 16 = the surface
  carries colour, decided in the scene FS from the UNLIT base colour and read
  by the sketch colour-from-mesh composite — asking it in the post pass, of a
  lit colour that arrives through an 8-bit target, made near-grey meshes band
  along the shading gradient. Bit 128 = helper overlay sample: the clip helper
  lines and marker spheres stamp it with an alpha-only `max` blend (the scene's
  bits are dropped at those samples — the helper owns them), and the sketch
  composite keeps those samples' colour, read per sample from the unresolved
  MSAA colour target. It has to be the TOP bit, because `max` is not a bitwise
  OR: the stamp survives only while it outranks every bit a surface can set.
  Three bits free (8, 32, 64).
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
