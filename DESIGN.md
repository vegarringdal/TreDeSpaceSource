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
  original modules (`cad-cooker`, `cad-app`) as attribution; those are
  historical pointers, not live paths. `cad-format` (the packed header / POD
  types) lives on as `rust_src/crates/cad-format`, used by `cooker-core`.
- **Cooking today is in-repo:** the reference `cad-cooker` was reimplemented as
  a Rust **wasm cooker** (`rust_src/` → `src/lib/cooker/wasm/`), byte-identical
  to the native output, plus a TS fallback (`src/lib/cooker/cook.ts`). No native
  toolchain is needed to cook; the Import Manager does it in the browser.
- **The golden test no longer compares against the reference**
  (`crates/cooker-core/tests/golden.rs`): it runs the committed
  `convertSamples/rvm/HA-STRU.RVM` through RVM → GLB → cook and validates the
  CADM output.
- **Not ported / native-only** capabilities are catalogued under "Not yet
  ported from native" and "Backlog in native too" further down.

## Architecture

- **React 19 + a self-built dockable shell** (`src/treDeSpaceUI/dockable/`):
  framework-free DockManager (lit-html chrome), tabs/splits/floating windows,
  collapse strips, per-panel min sizes, layout slots (the arrangement is NOT
  auto-persisted: boot opens the default layout, then the last selected slot;
  edits stick only when saved to a slot, `tds:layouts`), soft-home nodes — a panel homed at `right` recreates the right column when
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
  indirect (`chromium-experimental-multi-draw-indirect` + `indirect-first-instance`:
  each record carries its meshlet in `firstInstance`, and without the second
  feature WebGPU skips every such draw but meshlet 0's), vertex-pull fallback,
  two-pass HiZ occlusion, TAA (Halton jitter + accumulation), MSAA per-sample
  edges, VBAO. Within 5–10 % of the native Vulkan renderer.
- **Worker model DB** (`src/lib/modeldb/modeldbWorker.ts` via comlink): cooked `.tdp`
  parsing (CADM v7–v9, meshopt-decoded), item states (12 B: flags/color/
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
- **Pick pass** (`mesh_pick.frag.slang` port, `itemPickPass.ts`): an id-only
  render pass with the opacity rule — plain click selects
  `opacity ≥ threshold` (default 10.1 %, Settings → Rendering → Picking);
  Shift inverts the band (faint selectable, glass pass-through, opaque
  blocks). A scene with nothing transparent skips the replay and reads the id
  from the G-buffer (`encodeFast`). The DEPTH pick (Space / Alt / probe /
  measure aim) is a one-workgroup compute that reads the cursor texel of the
  real scene depth target (nearest MSAA sample). It must never read the HZB:
  mip 0 is half resolution and keeps the FARTHEST surface of each 2×2 block,
  so a click on a silhouette landed on whatever was behind it.
- **Measurement snap** (`measure_snap.slang` port): compute-shader
  Möller–Trumbore ray-cast over the meshlet-packed geometry (two-pass u32
  atomic arg-min), CPU classification corner/edge/face by screen-pixel
  distance to the hit triangle's vertices/edges (sensitivity in px, the
  Snapping group on the Measurements ribbon). **Layout rule for this shader
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
  It was confirmed on the tablet with the measure trace (the read diagnostics
  in the snap result words); the earlier theories — per-request pick
  resolvers, picks resolved through a later camera — were not this bug.
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
  Rendering → Transparency → Background fade, default 70 %) carried in the Frame uniform's
  `backdrop` vec4, so the context recedes and what is left opaque stands out.
  The first background version kept the backdrop translucent (blended, only
  kept from covering opaque parts); it read as plain Blend and was replaced by
  the solid, faded backdrop — don't bring the translucent variant back.
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
  outlined items' in-view meshlets into a fourth draw slot, and the mask
  draws that. In view means drawn OR occluded: cull pass 2 marks a meshlet
  that passes frustum + cone but fails the HZB (or the new-meshlet budget)
  `vis = 2` (drawn = 1), pass 1 replays only 1, and the list takes both —
  otherwise the hidden outline of a selection behind other geometry broke
  wherever the HZB culled a meshlet (2026-11-11). A full replay with a per-fragment discard cost a large slice
  of the scene pass on every frame with a selection. Cost: `N + 2T` vertex work instead of
  `2N`; the sorted list and its candidates cost +28 B per meshlet under MDI
  (+16 B on vertex pull) and ~8 KB per model (see *Per-meshlet GPU layout*).
  Not done: cross-model interleaving (draws are per model, so glass of
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
  its own model's commands, not every model's (before the gate, one glass item
  cost ~12 ms on a large multi-model scene on a fast GPU). The gate rides with the
  states rather than the async whole-scene `hasTransparency` refresh because
  a gate that lags the states would route glass to a list nobody scans.
- **Per-meshlet GPU layout** (2026-11-19, `drawLayout.ts`). What a meshlet
  costs on the GPU is decided in one place, which the renderer allocates from
  and the mixed repack's budget estimate uses (`Renderer.gpuSizing`): cull
  record 36 B, info 32 B, visibility word 4 B, the pass-1 / pass-2 / outline
  lists at 4-byte entries on vertex pull or 20-byte draw records under MDI,
  plus the sorted transparent list and its candidates on a culling path or
  the static full list on the no-cull path. That is 100 B per meshlet on
  vertex pull and 160 B under MDI, against the old fixed 164 B. The sorted
  and outline lists are held from upload on purpose: a first version
  allocated them on first use (transparent gate / outline switch) for 20 B
  per meshlet less, but most sessions turn both on, so it only moved the
  allocation into a frame. Indices are u8 meshlet-local (< 64) in the pack
  and on the GPU for vertex pull. MDI needs a u16 hardware index buffer, so
  `ensureLayout` widens a model's indices on the GPU (`shaders/indexWidth.ts`)
  when the path becomes MDI and narrows them when it leaves. No CPU copy is
  kept. The measure snap has a pipeline pair per width. `ensureLayout` runs
  at frame start and is a no-op unless the path changed; a rebuilt list
  starts empty with its count slots zeroed.
- **Cone culling, orthographic** (2026-11-19). Orthographic uses
  meshoptimizer's orthographic form `dot(forward, axis) >= cutoff`; the
  perspective, apex-free form `dot(c - eye, axis) >= cutoff·|c - eye| + r` is
  for perspective only. The orthographic depth slab spans the whole scene
  box, so geometry can sit behind the orbit eye point, and there the
  perspective form inverts and culls the camera-facing side. The s8 cone
  packing (`pack.ts packCone`) is conservative as it stands: the axis
  rounding error is at most √3·0.5/127 on the dot product, and the extra
  +1/127 on the cutoff covers it (a cutoff that clamps to 127 is the
  "skip the test" marker). meshoptimizer's own s8 cutoff adds the
  per-component error sum, which is merely looser.
- **Selection outline and hover** (`outlinePass.ts`, a three.js OutlinePass
  on the native `hover_xray` mask): `selectionStyle` is `tint` (default),
  `outline` or `both`; the outline draws a visible and a hidden (see-through)
  edge. `outlineHover` (off by default) outlines the item under the cursor
  from a throttled item pick (one in flight, ≥ 33 ms apart, `viewport.ts`).
  The mask draws only the outlined items' meshlets (above).
- **Marker spheres** (2026-09-04): labels and measurement points can carry a
  sphere drawn in the scene, depth tested — wireframe rings through the
  clip-helper line list, or `solid` fills as instances of one unit sphere
  (`shaders/marker.ts`, `sphereMesh.ts`) drawn after the helper lines with the
  frame uniform bound to both stages (the fragment shades by eye / headlight):
  opaque instances first with depth writes, translucent
  ones blended on top (scene alpha untouched), G-buffer masked so they get no
  edges or ids. Built by `viewport/markerLines.ts`, re-uploaded only on change.
- **Dark-colour lift** (Settings → Rendering → Dark colours, 2026-09-04): a
  black material shows no shading, so a PURE black cooked colour (every 8-bit
  channel 0) is replaced by a grey of the floor's luma (`origin.w` of the
  Frame uniform, `lift_dark` in `shaders/scene.ts`) before the item state is
  applied. Only exact black: the first version blended every colour below the
  floor toward grey and lightened deliberate dark navies and browns. A user
  override is never lifted. Rendering only — colour overrides, exports and the
  hierarchy keep the true colours.
- **Frame loop: the guards against a GPU hang.** A GPU hang is one frame asked
  to draw everything (a mass unhide against an empty HiZ hung the GPU on a
  6 M-meshlet model), so four defaults work together: one frame in flight
  (`Renderer.gpuBusy`; the tick skips while the GPU is busy — latency over
  throughput); `newMeshletCap` 175 000 new meshlets per frame from the
  occlusion pass; `pxCutAlways` 1 px (a sub-pixel cluster is never drawn);
  and the settle window after a change ends when pass 2 reports nothing new,
  with `settleFrames` 20 and `SETTLE_CEILING_MS` 500 as ceilings only (a fixed
  20-frame settle cost ~0.5 s per camera stop on a fast machine, seconds on a
  slow one). The reasoning sits next to each in `renderer.ts` and
  `viewer.state.ts`.
- **The idle skip.** A frame renders only when its `key` string changes
  (`renderer.ts`, built from the camera and every image-affecting option).
  Every new renderer option that changes the picture must be added to that
  key, or changing it does nothing until the camera moves.
- **Diagnostics without DevTools.** Settings → Stats → *Verbose trace* logs
  phase timings and the measure-probe trace to the app Console (Console →
  Download fetches it from a tablet). It also writes
  `[render] re-render at rest — key segment #N: old → new` to the browser
  console (debug level) whenever a frame renders with the camera still — the
  answer to "why is it still rendering?".

## Feature panels

- **Measurements** (native `measurements.rs`/`overlays.rs` port): Point / Line
  / Path / Area / Face / Diameter / Angle tools (Angle + Point go beyond
  native's four), snap glyphs (face disc + normal arrow, edge bar,
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
- **Transform objects**: New Object makes the selection an object with one
  pose; move/rotate/scale gizmo with custom pivot (lock/adjust/item-pivot),
  nudge/rotate-90° grids, move-to-click, sub-objects that ride on their
  container, a list panel with typed numbers, own undo/redo — see
  **Transform objects**.
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
- **Temporary isolate** (2026-11-18, Hierarchy toolbar, `ALT 805`,
  `modeldb/tempIsolate.ts`): isolates the selection, and switching it off
  puts back exactly what that isolate changed.
  - **How it remembers:** it keeps the state-undo RLE captures from before
    and after the isolate (`captureColorRuns`) and compares their hidden
    bits. What the isolate hid is shown again; selected items it had to
    show are hidden again.
  - **Only the hidden bit changes,** so colours set and parts hidden while
    isolated stay.
  - **Undo:** on and off are one undo step each, like Isolate.
  - **When the record is dropped:** forgetting or clearing models, or
    applying a snapshot, drops it; `viewerActions.syncTempIsolate` keeps the
    button honest.
- **Scene Labels** (`LabelOverlay.ts`, `labels/` panel): world-anchored,
  draggable DOM text labels with leader lines (same projection path as the
  measurement overlay). Native has this only as backlog (its 8.3 labels item);
  the web viewer shipped it. Tag import (`labelTagRows.ts`, pure and unit
  tested) takes one row per label: a name alone is looked up and anchored on
  the item; a name followed by x, y, z in metres (tab, semicolon, comma or
  space separated, decimal comma allowed) stands at that point, linked to the
  item only when the name happens to exist.
- **View cube** (`viewCubeGpu.ts` + `ViewGizmo.ts`): GPU-drawn orientation
  cube with a label atlas; DOM hit-test for face/edge/corner click-to-snap.
- **Navigation gizmo styles** (2026-11-18, `plans/navigation_gizmo.md`):
  - **Two styles.** The cube or **axis balls** (the default), switched by a
    right-click or long-press on the gizmo (`gizmoGestures.ts`, measure aim's
    450 ms hold) or in Settings → Gizmo.
  - **Ball layout.** The balls' geometry lives in one pure module
    (`render/axisGizmo.ts`): ball and snap-dot positions, depth order, the
    near-side fade and picking. The renderer paints from it and the DOM hit
    layer (`AxisBallLayer.ts`) picks with it, so drawn and clicked always
    agree.
  - **Drawing.** `ViewCubePass` paints the balls, and the cube's true-north
    chip, with Canvas 2D into an offscreen canvas the size of the mini
    viewport. It uploads that premultiplied and blits it through the cube's
    blit pipeline, so captures include it with no new shader.
  - **Fade.** The snap dots' fade runs by time in the pass. Its
    `isAnimating` keeps hold frames coming without entering the idle key,
    which would restart TAA every frame.
  - **Snapping.** Picks map to the camera through the pure
    `render/gizmoSnap.ts`: view from / look toward, the flip when already
    there, Shift for the opposite, and the top-view heading.
  - **Ball letters** are the face names' first letters (`faceLetters`).
  - **True north** (`northAngle`, clockwise from +Y) is only ever shown on
    the cube. RVM keeps its axes, so plant north is +Y, the BACK face. The
    marker (`gizmoNorthMarker`, off by default) is a round N chip with a
    ground-plane pointer, painted in the cube palette (face / line / text,
    sketch mode's too), so it never needs its own colour settings.
  - **Ball background:** a see-through sphere behind the balls
    (`gizmoBallsBgColor`, `gizmoBallsBgOpacity` in %), painted as a disc
    with a radial gradient lit from the upper left.
  - **Settings safety:** stored settings and settings files are not
    validated on load, so `navGizmo.ts` reads the gizmo keys through
    `enumOr` and clamps. A bad value falls back to its default instead of
    leaving the drawing and the hit layer disagreeing.
- **Assets / Import**: Model Assets + Import Manager panels over OPFS stores
  (`opfs.ts`; a store is a folder of cooked models, `stores.json`) — import,
  load / unload and organise cooked models. Unloading forgets a model's look
  (colours, hidden items, transforms — `forgetModels`), so a reload starts
  clean. It used to keep the look on purpose; that was reversed because one
  unload then behaved differently from Remove all, and a host had no clean
  reload short of re-importing. A state snapshot is the way to keep a look.
  The VRAM residency evict path is different: it keeps the state. The Model Assets search is the `&` / `|` / parentheses
  expression engine (`searchExpr.ts`); its grammar and how matches imply
  parent folders/stores are written up in `docs/search-expressions.md`.

## UI conventions

- Square corners everywhere; slate/blue/amber palette; themes are CSS
  variable remaps keyed by `data-theme` (light remaps include the amber
  accents). Flat "floating" scrollbars (webkit-styled; standard properties
  scoped to Firefox — Chrome would drop the webkit styling otherwise).
- **Every button/checkbox/number-stepper gets a hotkey binding + tooltip**
  (`data-shortcut` renders the combo in the tooltip footer). One deliberate
  exception: ribbon TABS have no hotkey of their own (per-tab hotkeys were
  built and removed, 2026-11-15) — a tab's tooltip shows the F-key of the
  default layout that opens it, which is why F1–F12 keep a fixed linked ribbon
  and a fixed name (`layouts.state.ts`).
- **Hotkey ids are persisted keys.** A user's rebinds and exported keymaps
  are stored by id, and loading skips unknown ids, so renaming an id silently
  drops every customisation of it. Rename only when the cost is accepted.
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
  invariants (Biome's `noNonNullAssertion` rule is off — its autofix breaks
  both).

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
  GLBs are cooked to CADM on a worker, no offline `cad-cook` step. A merged
  GLB (rvm2glb web3dversion 2) goes to the wasm entry point
  `cook(glb, compute_normals, coarsen)`, always with `compute_normals = false`;
  `coarsen` writes the extra `<id>.coarse.tdp` variant for the VRAM budget.
  Any other (standard) GLB goes to the TS generic cook (`cook.ts`,
  `cookStandardToOpfs`), whose `normals` import option keeps authored normals
  (smooth shading, tracked as `hasNormals` per asset). A second entry point `coarsenTdp(tdp)` rebuilds
  that coarse variant from an already-cooked `.tdp` when no sibling exists
  (see "Coarse from `.tdp` alone" under the VRAM budget section).
- **RVM import** (`src/lib/rvm2glb/rvm2glbWorker.ts`, wasm `rvm2glb`): raw
  RVM in the browser, read from OPFS and cooked per site straight to `.tdp`
  (see "Import converters"). Native has no equivalent — it consumed GLB from
  an external `rvm_parser_glb` tool.
- **Cooker source & build** (`rust_src/`): a workspace of `cooker-core` (the
  pipeline as a lib — CADM writer, GLB parse/flatten, meshlet build + quantize +
  meshopt vertex/index encode; `COOKER_VERSION`), `cad-format` (the header
  types), `crates/meshopt` (vendored C++ meshoptimizer FFI, patched with
  freestanding wasm32 math/shim), and `cooker-wasm` (the wasm-bindgen shell
  built into `src/lib/cooker/wasm/`). ~4× faster than the TS cook on a 35 MB
  GLB. Rebuild with `node scripts/build-wasm.mjs cooker` (see "The committed
  wasm is tied to its source"); it needs a wasm-capable clang (plain `clang`
  works — the meshopt crate ships freestanding wasm32 headers, no WASI
  sysroot).
- **Diverged from the original cook plan:** it envisioned an in-browser
  **Folders** auto-cook flow (scan a GLB folder, `blake3` vs a `.cache/manifest.json`, cook
  stale/missing in place) plus a native `cooker-cli`. The app took a different
  route — the
  **Import Manager** cooks single files / folders into the OPFS asset store —
  so the manifest flow and the native CLI were never built. New import FORMATS
  are added Rust-side.

## Import converters (`rust_src/crates/{rvm,ifc,step,nwd,scan}-*`)

Four model converters — RVM, IFC, STEP, Navisworks NWD — and the laser-scan
cook (`scan-*`, LGSX / E57 → `.tdpp`), living in the **single `rust_src`
Cargo workspace** alongside the cooker (RVM, IFC and STEP were separate
GitHub projects with a workspace each until 2026-08-20; every crate of ours
inherits the TreDeSpace License from the workspace, and only third-party code
keeps its own, e.g. `rvm-core/LICENSE-rvmparser`). Each is built to wasm
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
(`crates/{rvm,ifc,step,nwd}-wasm/tests/direct_cook.rs`): the same input cooked
both ways must produce identical bytes.

Sample models for the converter tests live in `convertSamples/{rvm,ifc,nwd}`
(STEP fixtures sit in `crates/step-core/tests/fixtures`; the multi-GB scan
samples are not committed — `scanSamples/`, gitignored).

| converter | converts | wired into the app? |
|---|---|---|
| `rvm` | PDMS/E3D **RVM** plant models → `.tdp` per site | yes — `src/lib/rvm2glb/rvm2glbWorker.ts` + `src/lib/rvm2glb/wasm` |
| `ifc` | **IFC** 2X3 / 4 / 4X3 → `.tdp` (one per tier when split) | yes — `src/lib/ifc2glb/ifc2glbWorker.ts` + `src/lib/ifc2glb/wasm` |
| `step` | **STEP** B-rep → `.tdp` (proof-of-concept parser) | yes — `src/lib/step2glb/step2glbWorker.ts` + `src/lib/step2glb/wasm` |
| `nwd` | Navisworks **NWD / NWC** → `.tdp` per root | yes — `src/lib/nwd2tdp/nwd2tdpWorker.ts` + `src/lib/nwd2tdp/wasm` |
| `scan` | Leica **LGSX** / **E57** laser scans → `.tdpp` | yes — `src/lib/scan2tdpp/scan2tdppWorker.ts` + `src/lib/scan2tdpp/wasm` |

**NWD import defaults (2026-11-15).** The weld **Precision** is 2 decimals
(1 cm in a metre model). It was 3 for one day after a public sample lost many
of its triangles at 2 (a triangle whose corners share a weld cell is dropped);
2 came back because the files are smaller, and the guide tells the user to
raise it when small parts go missing — don't flip it again without a new
reason. **Simplify** is off since 2026-11-16 (Keep 75 %, Max error 0 when
ticked): at error 0 it saved about 1 % on the samples (0.1 % saved 4–22 %),
and until then it ran without locked borders, so it pulled in the open edges
of NWD parts — a pipe is an open tube with separate cap discs — and opened
gaps between neighbouring parts, even at Keep 95 %. It now locks borders
like the RVM and STEP converters (`glb::finalize_append`).

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
  option asks for (0–5; default every core the machine can spare, at most 5 —
  `stepWorkerDefault()`; 0 = in-process). Each holds its own copy
  of the entity index, which is what the option trades: a 1 GB file measured
  6–8 GB of RAM with five workers when every worker scanned its own hash-map
  index; the dense shared index roughly halves that. Each opens the staged
  file with a *read-only* sync handle
  (Chrome 121+ allows several), rebuilds the index from `index.bin` in its
  own wasm instance (above), and tessellates the product batches it is handed (dynamic sizing: `remaining /
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

### The committed wasm is tied to its source (2026-11-16)

The six modules ship as prebuilt binaries in `src/lib/<unit>/wasm/`, so
nothing used to prove that a binary was built from the committed Rust: a fix
that was never rebuilt passed CI as long as the sample output stayed the
same. A check on 2026-11-16 found exactly that — the cooker, RVM, IFC and
STEP binaries dated from 2026-09-13, before the toolchain was pinned and the
vendored meshoptimizer was updated. Their cooked output was unchanged, but
only the smoke test said so.

- **Not a rebuild-and-diff job.** A binary built on another machine differs:
  the bundled C++ is compiled by the local clang, and rustc embedded the
  builder's `~/.cargo` paths. On ONE machine the build is reproducible (the
  scan module rebuilt byte-identical).
- **A source fingerprint instead** (`scripts/wasm-units.mjs`). For each
  module: the files of every workspace crate in its `Cargo.lock` closure
  (tests, docs, examples and prose left out), the version and checksum of
  every registry or git dependency, the workspace manifest, the pinned
  toolchain, the build script and the module's cargo features. Wider than
  what the wasm build strictly uses, so it may ask for a rebuild too many,
  never one too few.
- **Recorded at build, checked in `npm test`.** `scripts/build-wasm.mjs`
  (`npm run build:wasm`, one recipe for all six) writes `build-info.json`
  next to the binary — that fingerprint and the SHA-256 of the binary — and
  `tests/wasmSources.test.ts` recomputes both without a Rust toolchain. A
  Rust change in a module's closure therefore fails the tests until the
  module is rebuilt; so does a binary swapped in without its record.
- **Paths are remapped** (`--remap-path-prefix`): the home directory no
  longer ends up in the shipped binary's panic messages.
- **Limit:** the record is written by the same script that builds, so it
  catches forgetting, not forgery.

### Where the formats come from, and what is promised

Stated once, in the README under **Supported files**: which formats are
read and how, that the Navisworks and LGSX readers are clean-room work from
files alone, that every converter was tested on few files, and that nothing
is guaranteed. Point there instead of repeating it. The technical record of
each undocumented format stays with its crate
(`rust_src/crates/nwd-core/docs/what_we_know_v1.md`,
`rust_src/crates/scan-core/docs/LGSX_FORMAT.md`); the "VALIDATED" labels in
those documents mean validated on the files at hand, not in general. The
user guide carries one short notice where files are imported (Assets →
Import Manager).

### Whole-file converters and the 4 GB ceiling (NWD, IFC)

The IFC converter needs random access over the whole file, so unlike STEP
(staged in OPFS, read by range) and the scan cooker (read-at / write-at IO)
it holds it in wasm memory, next to the parsed model and each output. The
NWD converter did too; since 2026-11-16 it reads composite models by range
and one root at a time (*NWD streams composite models* below) and holds the
whole file only for the other kinds. A wasm32 module addresses 4 GB; a file
that needs more aborts the module.

- **The failure is named** (`src/lib/worker/converterFailure.ts`). The worker
  catches the trap and reports the wasm memory size with it: a trap with at
  least half the limit in use, or a failed JS allocation, is "too large to
  import in the browser"; a trap with little memory in use is reported as a
  crash with the figures, because size is then not the cause. Errors the
  converter raises itself pass through unchanged.
- **The file is held once, not twice.** The IFC worker frees its JS buffer
  (`ArrayBuffer.transfer(0)`, `releaseBuffer.ts`) at the first progress
  report, once wasm has its own copy. The NWD worker holds no JS copy at all:
  it reads slices from the picked file (`fileInputIo`); the Rust side reads
  a composite model by range (no wasm copy either) and any other file once,
  front to back, into one buffer.
- **Measured (2026-11-16), peak wasm memory in Node** — wasm memory never
  shrinks, so its size after the call is the high-water mark:

  | file | size | peak | ratio |
  |---|---|---|---|
  | `Huldra_Asbuilt.nwd` (22 roots) | 33 MB | 758 MB (1028 MB before the direct cook) | 23× |
  | `HDA-ASB-HA.nwd` | 4 MB | 64 MB | 17× |
  | a Revit-loader `.nwc` | 2 MB | 43 MB | 23× |
  | three IFC buildings | 10–14 MB | 53–78 MB | 5–6× |
  | a tessellation-heavy IFC | 3.6 MB | 62 MB | 17× |

- **Where NWD memory went before streaming** (profiled on a 169 MB
  composite export, 141 roots): 1,214 MB before the first output — the input
  (161 MB), the hierarchy (115 MB: 844 k nodes, 38 MB of names), the
  fragment chunk inflated whole (205 MB, one zlib stream), the fragments
  (192 MB: 1.79 M × 96 B) and every geometry record decoded up front
  (401 MB), all whole-file and all held to the end. The largest root needs
  33 MB of decoded geometry.
- **NWD streams composite models** (`nwd-core/src/direct.rs`, 2026-11-16).
  The per-root direct path (group id = leaf, marker+64 = record — every
  composite RVM-loader export) runs without those tables: the input is read
  by range (`nwd_core::ReadAt`, the worker's `io.read` behind a cache of
  eight 1 MB blocks); the fragment chunk is scanned through a sliding window
  into 32-byte rows; the hierarchy into 32-byte rows plus one name string
  (its chunk freed before the nodes are built); the geometry stream is
  probed once for each record's kind and bounding box. Roots then go out in
  order, in batches: a batch's records are read in ONE sweep of the stream
  (32 MB of stored bytes — root by root, a root's scattered records made
  every chunk inflate ~19 times) and decoded just before their root is
  emitted; a record several roots share is kept until its last root. Every
  record is decoded with exactly the bytes the whole-stream walk had in
  view (`geometry::decode_reach`), so the outputs are byte-identical — the
  old and new wasm give the same files on every sample, and a scratch
  golden run (`nwd-wasm/examples/golden.rs`) checks 770 outputs natively.
  Any other file (Revit/DWG interned streams, no geometry size index, the
  2013 revision, group ids that do not resolve) falls back to the whole-file
  converter, unchanged. Measured on the 169 MB export, wasm in Node: peak
  1,154 → 434 MB with the app's defaults, 1,363 → 701 MB with lines and
  3 decimals; time +5–10 %. What remains is the compact tables (~60 MB of
  nodes and ~60 MB of fragments per 170 MB of file) and the working set of
  the LARGEST root while it is cooked — on that file 300–400 MB for its
  biggest root, now the main term.
- **NWD cooks each root without a GLB** (`nwd_core::glb::build_merged` →
  `nwd_wasm::to_cooker_model` → `cooker_core::cook_model_both`), like RVM,
  IFC and STEP. Before, a root was serialised as a merged GLB in memory and
  the cooker parsed it back, so its geometry existed twice more. The merged
  build shares its weld step with the GLB writer (`finalize_batch`), the
  axis flip is done in place, and `nwd-wasm/tests/direct_cook.rs` holds the
  two paths to the same bytes on every committed sample. The GLB writer
  stays for the CLI and as the reference path. Effect: −26 % peak on the
  33 MB file, slightly faster (no GLB checksum, no JSON).
- **IFC: nothing to stream.** Its outputs are 1–6 MB; the peak is inside the
  ifc-lite kernel's geometry phase, and the kernel takes the file as one
  buffer.
- **No size limit is enforced yet.** An IFC should reach 4 GB around
  600 MB, extrapolated from small files — set a limit only from a real large
  one. Still open for NWD: one giant root cannot be split (its cook is the
  peak), and roots are converted one worker at a time.
- **The NWD worker holds nothing** (`src/lib/nwd2tdp/nwd2tdpWorker.ts`). It
  used to receive the file as one buffer and keep every cooked output until
  the conversion returned (183 MB for the 33 MB sample, each file briefly
  twice), then hand them all to the main thread. Now the converter's
  `io.read` pulls slices straight from the picked file
  (`worker/fileInput.ts`, FileReaderSync — the scan import's reader) and
  `io.write` passes each chunk to a writer sub-worker that appends it to
  OPFS `temp/nwd-import/` while the conversion runs (`opfs/tempFileSink.ts`
  + `tempFileWriter.ts`, the RVM import's writer made shared). The main
  thread terminates the worker, reads the files back one at a time to store
  them, and clears the temp folder before and after. This is JavaScript
  memory only — the wasm ceiling above is unchanged — and it costs a second
  copy of the outputs on disk while they are stored. Output bytes and import
  time are unchanged.

## Several tabs on one library

Two tabs of the viewer share one OPFS, so they share the asset index, the
store registry, the SQL sidecars and the overlay library. Each tab keeps its
own copy in a store; writing that copy back whole let the last tab to save
drop what the other had added — an imported scan missing from the index was
then deleted as an unfinished cook at the next start.

- **Merge, don't overwrite** (`src/lib/opfs/sharedDoc.ts`, bound to the
  browser in `sharedJson.ts`). A shared document remembers the file as its
  tab last saw it. A save takes a Web Lock, reads the file again, applies
  only what this tab changed since (`keyedMerge.ts`: records by id, added /
  edited / removed) and writes the result; the tab then takes over what the
  others changed. This tab's edit wins over another tab's edit of the same
  record, and an edit never brings back a record another tab deleted. A file
  that cannot be read during a save counts as unchanged, so the save never
  writes an empty library.
- **Other tabs follow.** A save posts on a BroadcastChannel and the other
  tabs re-read and merge, keeping their own unsaved changes. Web Locks,
  BroadcastChannel and OPFS are partitioned alike, so exactly the tabs that
  share the files hear each other.
- **Which files.** `model_assets/index.json`, `stores.json` and
  `overlay_components.json` are shared documents. `SQL_Meta.json` and
  `SQL_Reports.json` have no long-lived copy to merge: each change is a
  read-edit-write of one entry under the same kind of lock. The animation
  draft is one document per origin by design and is still last-save-wins.
- **Temp imports belong to a tab** (`src/lib/tabSession.ts`). Every tab holds
  a Web Lock named after its id for as long as the page lives, and a temp
  import carries that id (`tempOwner`). A starting tab purges only the temp
  imports whose tab is gone, so opening a second tab no longer deletes the
  models the first is showing. Holding the lock keeps the page out of the
  back-forward cache.
- **Not covered.** A model that is loaded in one tab and deleted in another
  stays on screen until it is unloaded; its file is gone, so a VRAM-budget
  swap cannot bring it back. A deleted scan is closed in the other tabs.

## Browser storage: persistence and quota

Everything imported lives in OPFS, which is best-effort storage unless the
origin holds a persistence grant: without it the browser may clear the whole
origin — every cooked model, scan and database — under disk pressure.

- **Persistence** (`src/lib/opfs/storageSpace.ts`, `src/state/storage/`):
  `navigator.storage.persist()` is called once per session at the first
  import (both import-lock paths). Chrome decides without a prompt from site
  engagement, a bookmark or an installed app, so a refusal is normal on a
  fresh profile; it is logged, and Settings → Storage shows the state, usage
  and quota with a button (and hotkey) to ask again. The app does not block
  an import on a refusal.
- **Quota check before a conversion**: `prepareSource` compares the source
  size with `quota − usage` from `navigator.storage.estimate()` before any
  RVM / STEP / IFC / NWD / E57 / LGSX import, doubling it for the formats
  that stage a copy of the source in OPFS (RVM, STEP). It is a floor, not a
  verdict — the output size is not known up front — so the Import Manager
  asks and lets the user go on, and a host-driven or quiet import only logs.
  A write that does hit the quota still fails cleanly (`writeFile` aborts
  its stream).

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
  shared-read (`CANTOPEN`); a read-write run sets `locking_mode=exclusive` +
  `journal_mode = DELETE` (the journal is removed after each transaction, not
  left as an empty file in OPFS), and imports normalise DBs out of WAL on the
  way in.
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
  (inline strings, typed numbers/booleans, frozen header) into a DEFLATED zip
  (`src/lib/zip.ts`, `CompressionStream('deflate-raw')`), encoding the sheet
  in row batches straight into the compressor so a 250k-row export never
  builds one huge string; no npm dep, so no notices churn. (The STORED form
  remains for the unit tests.) Clipboard copy is TSV with a header row.
- **"All" means as shown** — column filters and sort applied; "selected"
  keeps the shown order. The corner cell toggles every row shown, so a
  filtered view selects only its rows. Hotkeys ALT 652–661 belong to this
  work (table 652–657, editor 658–660, reports 661).
- Validation of the `sql.editor` payload lives in a pure module
  (`sqlEditorPayload.ts`) returning `{ error }` — vitest has no
  `@treDeSpaceUI` alias, so a test cannot import `protocol.ts`.

## Animation — objects and keys, like Navisworks Animator (LIVE, 2026-10)

Built 2026-10-14 → 16, then rebuilt the same week
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
floating play bar (D74); CTRL+F2 is only that layout slot — it does not
start the mode. Panels: Key (ALT 691), Timeline (692), Overlay Editor
(695), Overlay Preview (696). Hotkeys: the Animation category — kept
commands keep their ALT 9xx / 13xx / 14xx codes, new ones run from ALT 1505
(to ALT 1670, plus 1763 for Object: detach); `K` and a **Space tap** play / pause, `SHIFT+J/L` previous /
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
│   │                     exclude? (left out, D64), parent? (the object it
│   │                     rides on, D90), pivot (a side of the
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
  item one band slot; the Problems list says so) — unless one rides on the
  other.
- **Sub-objects** (D90): an object with `parent` rides on that object of
  the same scene. Its keys are counted from the parent's pose
  (`W = W(parent) · D(own)`), it keeps its items from the parent (it is
  captured before it — `ridersFirst` — so "first" is the sub-object), and
  it takes `visible` / `opacity` / `color` from the nearest object above it
  unless its own keys set them. A file may name the parent by id or by
  name; a parent that is not there, or a loop, does not open. The tree
  walks (`lib/objectTree.ts`) are shared with transform objects.

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
- **One row per object; a sub-object composes** (D90): an object's own
  matrix is its row sampled at T (`FrameState.own`); what is drawn
  (`FrameState.poses`) is that on top of what it rides on, composed in tree
  order (`composePoses`) — a scene without parents hands back the own
  matrices untouched. The composed matrix is reused while neither its own
  nor the one above changed, so the band still skips still objects. A pose
  not keyed yet goes on top the same way (`drawn = pending · drawn(parent) ·
  own`), so a posed container carries its sub-objects before Key.
  `worldPoseAt` samples one object's chain at any time (swept bounds — over
  every time anything in the chain moves — and motion paths). The engine
  below takes the same `FrameState` as before.
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
  selected node, with a key at the time slider holding where it stands.
  The same items reuse their object. Made inside another object's items it
  rides on that one (the smallest that holds it), and objects wholly inside
  it that rode on the same parent ride on it instead (`placeInTree`, via
  the worker's `animItemRelations`) — either order gives the same tree and
  nothing moves when it forms (D90).
- **Only objects move** (D91, replaces the second half of D55): posing or
  keying a selection that is not (part of) an object does nothing but say
  "+ Object first", and the gizmo only shows when an object owns selected
  items (`objectSelection`) — objects appearing on the fly made a mess. An
  object made a moment ago, not captured by the worker yet, is recognised
  by its items. + Callout still makes the object it hangs from.
- **Posing under a parent** (D90): a drag is a world matrix G on top of
  where the object is drawn, `drawn = G · A · D` with A where its parent is
  drawn, so the key is `K = A⁻¹ · G · A · D` (`foldKey`, `objectAboveAt` /
  `objectBaseAt`). A container picked together with its sub-objects takes
  the move alone (`withoutRiders`). **Rides on** in the Key panel
  (`setParent`) and deleting a parent re-say every key so the object stands
  where it stood AT each key; between keys it follows the new parent.
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
  (D10). The orbit helper writes nine camera keys (45° apart, first and last both keyed); the Camera split
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
  the user's CTRL+F2 slot; `ribbon: false` collapses the ribbon), `play`.
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
not covered. Unit tests (vitest, `tests/animation*.test.ts`) cover the pure
core — model, key rows, interpolation, brief, parents, camera, look blend,
pool, partial upload, edge cases and the video plan / frames.

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
| D55 | An object is made from the selection (named after its node, a key where it stands). *Its second half — a selection that is not an object becomes one when posed or keyed — is superseded by D91.* |
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
| D90 | Objects may ride on another object of the scene (`parent`): composed poses, items kept from the parent, look inherited from above unless keyed; + Object and To animation derive the parent from item containment; the Timeline indents sub-objects under a collapsible parent; the Key panel has Rides on. Version stays 2 (the field is optional). |
| D91 | Only objects are posed and keyed: a selection that is not an object is never made one on the fly (replaces that half of D55); + Callout is the one exception. |
| D92 | An object's rest box is of everything it names — also items a sub-object or an earlier object took — so its side pivots do not shift when a sub-object is made. |
| D93 | + Object, the Key panel's Add / Remove / Update from selection (and the transform objects) say an item set the shortest way: the closest group minus a few nodes when that is shorter (`tidyItemSet`); Closest group stays as a suggestion for older lists. |
| D89 | The MP4 is packed by **Mediabunny** (MPL-2.0, unmodified; mp4-muxer is deprecated in its favour) and streams into an OPFS file as it is made (index reserved at the start for the known frame count), downloaded from disk — memory no longer grows with the video's length. The encoder stays ours (codec fallback, hidden-tab recovery); Mediabunny only muxes. |

## Transform objects (LIVE, 2026-11)

What the Transform ribbon moves. Before, a move was an anonymous matrix
baked into a pool slot per (item, slot) — nothing recorded what had moved or
by how much. Now the ribbon moves **objects**, modelled on animation objects
so they can be shown, typed, saved and — later — handed to animation. The
user side is the guide page `docs/guide/f05-transform.html`.

### Model

`src/lib/transform/` (pure, unit-tested in `tests/transformObjects.test.ts`):

```
TransformObject
├── id, name
├── items, exclude?    lower-cased fullnames, the animation objects' rule
│                      (adds and leave-outs nest, the deeper wins)
├── models?           the model files the names are looked up in
│                      ({ store, group, name } — the snapshot identity);
│                      absent = every loaded model (older files)
├── parent?            id of the object it rides on
├── pivot              { at: side | point, offset? } — a KeyPivot
├── move, rotate, scale   ONE absolute pose (m, quaternion, per-axis factor)
└── muted?             shown at rest, the pose kept
```

- **One absolute pose, not a list of steps.** `D = T(move) · T(q) · R ·
  S · T(−q)`, q the pivot in rest coordinates (`poseMatrix`). Two nudges of
  1 m are "moved 2 m". This is an animation object key plus scale.
- **Scale is the object's own** (`S` before `R`): a factor per own axis, so
  a pose never skews. A world-axis stretch from the gizmo is taken along the
  object's own axes — each axis grows by how much the matrix stretches its
  direction (`applyWorld`) — exact for an even scale and for an axis the
  object is lined up with, the closest own-axes scale otherwise. No mirrors
  (`MIN_SCALE`). Animation stays rigid; scale will not travel there.
- **Parents compose**: what is drawn is `W = W(parent) · D`
  (`worldMatrices`; a muted object's own D is left out, a missing parent or
  a loop counts as none). A child's `move` is therefore in its parent's
  frame. Changing the pivot (`rePivot`) or the parent (`reParent`) re-says
  the pose so the object stays where it is drawn; deleting an object hands
  its children to its own parent the same way.
- **A gizmo drag or ribbon step is a world matrix G on top of where the
  object is drawn** (`applyWorld`): the pivot's image travels exactly, the
  turn is G's rotation seen from the parent's frame. Math in float64 (a
  pivot far from the origin), the pool takes float32.
- **Names are looked up only in the object's own files.** The same file
  can be loaded twice (from two stores, or under two names) with the very
  same fullnames; New Object records the files the selection is in, and
  everything that resolves the object — moving its items, Select, the
  relations that find its parent, the shortest-group search — stays in
  them (`resolveItems(…, scope)`). Add selection widens the list. Limit: a
  selection spanning two copies that share a name, picked in only one of
  them, still matches the name in both (it would take per-file item lists).
- File: `{ format: 'tredespace.transforms', version: 1, objects }`
  (`io.ts`; strict, every error names its JSON path, returns `{ error }`).

### Explicit objects, automatic parents

- **Nothing moves without an object** (director's ruling): New Object makes
  the selection one; the ribbon, the gizmo and Move To Click act on the
  **current object**, and with a selection that is not an object they are
  off (a toast says why when a hotkey gets there anyway).
- **The current object is the object the selection is** — exactly its
  items. It is derived from the selection only (`transformSync` asks the
  worker after every selection change), so picking a row = selecting its
  items, and undo never has a "current" to restore.
- **Parents come from containment at New Object**, then are a stored field
  the panel can change (Rides on): a selection inside an object rides on
  the innermost one holding it; objects wholly inside the new one, that
  rode on the same parent, ride on it instead. Either order gives the same
  tree and nothing moves when it forms (the new object starts at rest).
  The same items again pick the existing object.
- **The item list is said the shortest way** (`shortestItemSet`): the
  worker names a selection as every node still wholly selected — hundreds
  of names for a big node with a few parts deselected. When animation's
  `animClosestGroup` finds one group holding them all but a few nodes
  (≤ 12 left-outs, and shorter than the list), the object is that group
  with those left out, checked to resolve to the same item count (the same
  name in another loaded model would widen it). The helper lives in
  `state/viewer/shortestItemSet.ts` (`tidyItemSet` for any item set,
  `shortestItemSet` for a selection); the Timeline's + Object, the Key
  panel's Add / Remove / Update from selection and the transform objects'
  Add / Remove selection all go through it (the Key panel's Closest group
  stays for older objects that list their nodes one by one). New Object and the item
  edits run under a working dialog once they take longer than 250 ms.
- **A partly shared selection is refused** — an item cannot follow two
  poses, and splitting the selection into two objects was not judged worth
  the surprise. Still open; loosening it later is a change in
  `newFromSelection` only.
- **Who owns an item is separate from who rides on whom**: an item follows
  the SMALLEST object holding it (the worker points larger sets first), so
  a detached sub-object still owns its items inside the container, and
  Rides on may name any object (a pipe following a pump it is not under).

### Engine

- **Main thread owns the list** (`src/state/transform/`): `transform.state`
  (objects, `currentId`, the worker's per-object `info` — item count,
  missing names, rest box — and the undo depths), `transform.actions` (every
  edit through `commit`; undo / redo are snapshots of the object list, typed
  fields coalesce into one step), `transformSync` (the worker conversation,
  in order, coalesced).
- **Worker** (`apiTransform.ts`): `transformObjectsSet(specs)` resolves each
  object's names (`itemSets.resolveItems`, shared with animation), puts the
  items of the objects before back to slot 0, and points every object's
  items at ITS slot — one committed slot per object, kept while it lives,
  reused from a free list. `transformObjectsPose(matrices)` writes one world
  matrix per object and returns the pool. A change of pose is one small
  call; names are resolved again only when an object's items change or the
  loaded models do (`modelsVersion`, debounced) — so objects find their
  items again after an unload / load. The old wrapping allocator (a slot per
  nudge per base) is gone from this path.
- **Rest boxes** come back from the worker with the set (cooked bounds, no
  pool matrix) — the pivot's sides resolve from them on the main thread.
- **Gizmo**: `viewer.actions.bakeSelectionTransform` hands a finished drag
  to the animation interceptor first, else to the handler the transform
  objects install at startup (`installTransformObjects` — at import
  `viewer.actions` may still be loading). The preview is dropped only after
  the pose is on the GPU. The gizmo rests on the locked ribbon pivot, else
  the current object's pivot where it is drawn, and is frozen during a drag.
- **One pivot**: outside animation the ribbon's Pivot group edits the
  current object's pivot and holds none of its own. Set Pivot starts the
  placement on the object's pivot (`currentPivotWorld`); Lock / Item Pivot
  give a world point P, written as the offset from the pivot's side that
  puts it there (`setCurrentPivotWorld`: rest point = (A · D)⁻¹ · P, then
  animation's `pivotThrough`), the pose re-said so nothing moves; Reset
  drops the offset. `ribbonSelectionTransformState.pivot` is non-null only
  during a placement — or while animating, where `gizmoPivotSync` owns it
  for the picked key as before (`isAnimating()` picks the branch).
- **Animation mode** is unchanged underneath: `animEnter` captures the slot
  band and starts clean, `animExit` restores it. Edits are refused meanwhile
  (main thread: `resting()`; worker: `refused`) and the UI shows it
  (`useTransformResting`: a notice on the panel, its rows inside a disabled
  `fieldset`, the ribbon's New Object / step / reset / history buttons off —
  the gizmo, Pivot and Move To Click stay on, they pose for a key there), and a set the worker
  refused (a model loaded while animating) is sent at exit
  (`resumeTransformSync`).
- **Loose placement**: items no object holds keep the slot they have — only
  a loaded State snapshot puts any there. A snapshot applied with transforms
  restarts the pool, so the worker forgets every object and the main thread
  empties the list (`dropForSnapshot`); Reset All also clears the loose
  slots. Saved snapshots still record each item's matrix as drawn.

### UI

Transform ribbon: **Object** (New Object, off while the selection is an
object already) · On/Off · Pivot · Options · Quick Move · Step · Move · Scale ·
Rotate · Reset (Reset Obj, Reset All) · **Objects** (List) · History. The Transform
Objects panel (`components/panels/transform-objects/`, id
`transformObjects`, right column of the F5 layout): Objects & files (New
Object, Save…, Load…, Delete all, Collapse all / Expand all) stays in view
and the tree of rows scrolls under it (a `fill` section with its own
scroller). Which rows are open is panel state (`transformObjectsUi.state`,
by object id) so Collapse / Expand all — for the whole list, and for one
container's sub-objects (a pair in its row, a toggle in its header) — can
set it; the current object's row opens and scrolls into view.

**Add / Remove selection** (`editItems`): the selection's nodes go through
animation's `animEditItemSet` (the smallest change to `items` / `exclude`),
the result is checked against every other object (`transformRelations`: a
partial overlap or the same set is refused, as is an empty object) and
committed as one step; the object's items are then selected so it is
current again. The hotkeys act on `lastCurrentId` — the object that was
current before the selection moved on to the items to add or take out.
Parents are not re-derived by an item edit (Rides on is a stored field).

### Testing

`npm run test:transform` (`scripts/anim-e2e.mjs --suite transform`,
scenarios in `tests/e2e/transform.e2e.mjs`, probe
`tests/e2e/transformProbe.ts`): the same headless harness as the animation
suite — a suite file may name its probe, layout and panels. Covers: no
object no move, New Object, ribbon + gizmo moves and the readout, undo /
redo, sub-objects in both orders, the refused partial selection, the
current object following the selection, turns about the pivot, typed
numbers, pivot and parent changes that do not move, the ribbon pivot
writing the object's, delete, mute, scale,
resets, the file round trip and the animation hand-over.

### To animation

`state/animation/fromTransform.actions.ts` — the row's **To animation**
button (ALT 147) copies a transform object into the animation's active
scene: the same items and leave-outs, its pivot (the same side while the
item set is the same, else the point itself, so it is exactly where it was
set), its place in the tree (its transform parent's animation object when
that came along, else found by containment like + Object), and ONE key at
0 s holding its move and rotation — the two models share the pose formula,
so the animation starts where the object was set up. Scale is left behind
with a warning (animation is rigid). **with sub-objects** (a panel choice,
ALT 148): on, everything riding on it comes along as sub-objects with their
own first keys; off, it goes alone and what rides on it is left out of it
(those items then follow whatever animation object above still holds them,
or stand at rest). An object the scene already has (the same items) is
reused. A copy, not a link; one animation undo step. Available while
animating too.

The **AI brief** lists every transform object the same way ("Objects the
user has prepared": ready-made `objects` with id, items, pivot, parent and
the first key), so the item sets, pivots and tree are settled before the AI
writes a single key.

### Not built

- A live link between a transform object and its animation object.
- Host API commands for objects; objects in viewpoints; a snapshot import
  that makes objects out of its matrices.

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
family) are posted unsolicited with `id: null` (`emitApiEvent`,
`transport.ts`): progress carrying a `batchId` goes only to the window that
issued the command; every client that has messaged the viewer gets each event
once, at its exact origin, through its `events.subscribe` filter (`app.*`
always passes); the parent, the opener and opened windows that never messaged
still get the broadcast. EVENTS.md › Events has the full order.

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

## Untrusted input & CSP (2026-11-09)

The viewer origin holds the user's models and SQL databases, and same-origin
messages are API-trusted, so script running there is a full compromise. Files
users share (labels, measurements, viewpoints) and host payloads that replay
stored configs (a bookmark sent to `viewpoints.set`) are untrusted input.

- **Overlays never build markup from data.** Label leader lines render through
  lit-html attribute bindings; the measurement overlay is string-built SVG, so
  its one data-driven attribute (the line colour) must pass `colorToHex` at the
  draw site, and all text goes through `escapeHtml` (which escapes quotes too).
  A new overlay uses lit-html or `createElementNS`, not `innerHTML` with
  interpolated values.
- **Imports read field by field.** `src/state/viewer/annotationInput.ts` is the
  one reader for labels and measurements from files and viewpoint configs:
  hex colours, finite coordinates, known kinds, whitelisted style keys; bad
  entries are dropped or defaulted, never passed through. Pure (vitest-tested,
  `tests/annotationInput.test.ts`). The host API's own validators stay strict
  (they fail the command with a path) and are a separate, earlier gate.
- **CSP on every page, meta tag and header.** `vite.config.ts`
  `contentSecurityPolicy()` writes
  `script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; base-uri 'self'`
  (`scripts/page-csp.mjs`) as a meta tag into EVERY built page — the viewer,
  `/docs/` (incl. the guide) and `/demo/` share the origin, so each one is a
  way in (since 2026-11-16; before, only the viewer had it) — and the
  container's nginx sends the same policy as a header on those pages, next to
  `nosniff` and a referrer policy on every response
  (CONTRIBUTING.md › Container images; `tests/securityHeaders.test.ts` keeps
  header and meta equal). It makes injected inline scripts and `on*=`
  handlers inert; every page was checked on a production build served by
  that nginx — no violations. Deliberately NOT restricted: connect /
  frame / img / style sources (URL imports and external apps reach arbitrary
  origins; React and lit-html set inline styles). Not in dev, since the React
  refresh preamble is an inline script. Workers are unaffected (a meta policy
  does not reach them, and nginx sends the header on documents only);
  `'wasm-unsafe-eval'` is
  for the meshopt decoder on the main thread. Verified on a production build
  (boot, RVM URL import + load, labels / measurements / viewpoints over the
  API): no violations from the app itself.

### `?apiOrigins=` is a request, not a credential (2026-11-16)

The embed URL may name the origins that get the host API, and until now a
framed viewer granted them unasked: "the browser partitions storage per
embedding site, so an embedder only reaches the empty viewer it opened". The
partition is cut per **site** (scheme + registrable domain) plus a cross-site
ancestor bit — not per origin. A page on the viewer's own domain
(`wiki.example.com` framing `viewer.example.com`) therefore frames the viewer
with the user's real OPFS, and so does every page where partitioning is
switched off by enterprise policy. Our own partitioning measurements already
said so ("same-site hosting removes the cross-site ancestor").

- **Rule** (`src/lib/messageApi/urlOrigins.ts`, pure and unit-tested): in a
  frame the named origins are trusted only while the viewer holds no models,
  scans or SQL databases (`src/lib/opfs/storedData.ts`, read straight from
  OPFS; an unreadable storage counts as holding data), and only for the
  session. Otherwise the user gets the Allow / Deny dialog the popup path
  always had, and Allow saves the origin to the settings list.
- **Why the silent grant is never saved:** a page could frame the viewer
  while it is still empty; a saved grant would then cover the data imported
  later. Session-only, it gains that page nothing.
- **`*` is refused from the URL** in every window; only the settings list,
  which the user edits, can hold it.
- **Cost, accepted:** a cross-site host that keeps models in an embedded
  viewer shows its user the question once (the grant lives in that
  partition's settings). Same-origin hosting and settings-listed origins are
  unaffected. The decision is async (it reads OPFS), so the grant can land
  after boot; `app.ready` is announced again when it does.
- **Still open, by design:** every external app is fully API-trusted with no
  per-app scope, and same-origin pages (`/demo/`, `/docs/`) are always
  trusted — they now carry the same CSP as the viewer.

## Startup

- Console banner (pinned): app name, author, copyright. The whole startup
  block (banner, version, GPU checks) is pinned — Clear keeps it — and its
  length is fixed when the viewport marks startup done (the first 10 lines
  stand in until then); past it the console keeps the last 1500 lines
  (`console.actions.ts`).
- First model load sets the default view: from the top, halfway between
  FRONT and RIGHT (az 3π/4, el −35°), then fits the dense bounds (`fitDense`,
  on by default) or the full scene bounds.
- **Storage namespace** (`src/lib/storageKeys.ts`, 2026-09-04): every
  localStorage / sessionStorage key is `tds:<name>` and a store must be in
  `VIEWER_STORAGE_NAMES` to get one. `globalReset.ts` (the first import)
  copies the older bare-name values under the prefix once, guarded by a
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

- **Computed vertex normals.** Native shades with per-vertex normals
  (`--compute-normals`, for weldable `_nor` models) and falls back to flat.
  The web viewer shades with AUTHORED normals when a model carries them (a
  plain GLB import with NORMAL data keeps them: `cookStandardToOpfs(…,
  normals)`; the scene shaders bind them as `vertex_normals`, binding 7) and
  flat from `cross(dpdx, dpdy)` otherwise. What is missing is COMPUTING them:
  the merged-model cook and the converters call the cooker with
  `compute_normals = false` (and it feeds edge quality, below).
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

## Review of 2026-09-12 — what was ruled, not fixed

A six-scope code review (app memory/perf, widgets, import/export, rendering,
transparency, client API), closed 2026-09-15. Everything else it found was
fixed between 2026-09-12 and 09-15. The entries below were closed by a ruling
instead; don't re-propose one unless its re-open condition holds. This
section is the only record of that review that is kept.

**By design**
- **1.9** A multi-instance external panel definition stays registered after
  its tab is closed — the remembered location is the point. A host that does
  not want that unregisters it (`remove === true`).
- **6.1** No per-client command scoping: every allowlisted origin is
  full-trust, and adding it is the grant (see *Untrusted input & CSP*).
  Scoping would be a feature (opt-in restricted apps), for a real untrusted
  panel only.
- **6.9** The API does not mirror the state layer: a command or event lands
  when a host needs it. If the gaps are ever worked through, the missing
  halves of pairs come first (`measurements.get`, `clip.shapes.get / update /
  remove`, `stores.remove`, `viewpoints.activate`); `undo / redo` needs a
  decision first — there are three undo domains (colour / opacity /
  visibility, labels, transforms).
- **6.15** `*Url` commands fetch with default credentials, because a
  self-hosted intranet endpoint needs its session cookie. Re-open for a
  multi-tenant deployment: credentials then become opt-in per app entry.

**Declined — widgets**
- **2a.10** Moving `sql-table/`'s grid into the library as a `DataGrid`. Re-open
  when a second panel needs a grid — that consumer decides the API.

**Declined — rendering**
- **4.2** Per-model cull dispatches share the read-write `countsBuf`, so they
  serialize. Not to be re-proposed: per-model count buffers lose the single
  clear and stats copy, and one flat dispatch needs shared arenas (no bindless).
- **4.3** No render bundles; `cpuMs` stays under 4 ms. Re-open if `cpuMs`
  tracks the number of live models — then bundles per (model set, pipeline,
  sample count), after checking that a bundle encoder takes
  `multiDrawIndexedIndirect`.
- **4.5** The outline mask replayed the whole culled scene. Declined
  2026-09-13, then built anyway on 2026-09-28 once outline was in use and
  measured (the replay cost 8 ms next to a 21 ms scene pass on a dense model):
  a per-model compute filter (`outlineListWgsl`) emits only the outlined
  items' meshlets (+20 B per meshlet). Since 2026-11-11 it also takes the
  occluded ones, so a selection behind other geometry keeps its hidden
  outline (see *Sorted blend pass*).
- **The LOW tail, 4.7–4.18** — small or unmeasured, fix known for each:
  4.7 clip tests have no "clipping off" early-out; 4.8 HZB downsample folds
  3-wide on every texel of an odd-sized source, not only the last row /
  column; 4.9 one HZB dispatch per mip (watch `hzb`); 4.10 one global
  `atomicAdd` per visible meshlet in the cull emit (workgroup aggregation,
  watch `cull 1` / `cull 2`); 4.11 several small `writeBuffer`s per frame, and
  outline rewrites constant params; 4.12 views and outline bind groups are
  recreated per frame; 4.13 `frame()` builds a string key every idle tick;
  4.14 the G-buffer is stored when no post pass reads it; 4.15 the VS
  re-indexes `item_states[info.item]`; 4.16 VBAO runs at full resolution
  (half-res is the option); 4.17 GPU timings steer nothing (could raise
  `pxCut` while moving over budget); 4.18 the canvas size is floored instead
  of taken from `devicePixelContentBoxSize` — re-open that one the moment
  edges look soft at a fractional DPR.

**Declined — transparency**
- **5a.7** The blend sort is per model, so where two models' glass overlaps
  it is ordered by load, not depth (glass behind opaque is still right).
  Re-open on a user complaint on a real scene, and take the free
  model-bounds sort first — it does not help the same model loaded twice. A
  shared record buffer and a bucket-group interleave are dead (per-model
  geometry buffers, VRAM); G filtered blend passes are the real candidate,
  after measuring the MDI-path `blend` span.
- **5a.8** No adaptive fallback when nearly everything is transparent.
  Measured on a ghosted 136-model scene: `blend` 44 of a 50 ms frame, 99.6 %
  of drawn meshlets transparent — on the vertex-pull path, where every meshlet
  draws a flat 372 vertices. The MDI flags (real index counts) and
  `transparencyBlend: false` (hash) already cover it. Re-open if a user hits it
  with the flags on and hash mode rejected on looks; measure MDI `blend` first.
- **5a.5** Edges and AO over glass come from the surface behind it (native
  parity). Re-open if glass-heavy models become a primary use, as a
  deliberate look; first try attenuating the composite by the blended alpha.
- **5a.6** Glass blends over marker spheres (pass order). Re-open if markers
  are used through glass as a workflow.
- **5c.1** Hash mode gains nothing from MSAA (hash per pixel). Re-open only if
  hash becomes the default over the sorted blend pass.

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
the ceiling is never overshot at load time. The ceiling is a plain number the
user sets: a suggested budget was built and removed (2026-09-16) — WebGPU
cannot see a GPU's VRAM, so it guessed from system RAM and said 4 GB+ on
exactly the machines that need a low ceiling. `gpu.info.get` still reports
`deviceMemoryGb` and `isMobile` for a host that wants to reason itself.

Laser scans are **not** part of this budget: streamed points and the entered
setup's photo are limited by the Scans panel (point budget + cache), and the
residency manager can only shrink models — counting scan memory would make a
loaded scan push models to coarse. The budget is measured against
`Renderer.vramBudgeted` (tracked VRAM minus `scanBytes`); the Stats row
"vram (tracked)" still shows everything, scans as their own part.

**The invariant** (the lesson from the failed LOD+streaming attempt, which
kept LOD resident *alongside* full geometry): **exclusive residency — for
any zone, coarse or full geometry is on the GPU, never both** (per item in
mixed packs); the only overlap is the single zone mid-swap, bounded by
headroom.

**Pieces:**

- **Coarse cook at import**: the wasm cooker's 3-arg `cook(glb, normals,
  coarsen)` writes a second `<id>.coarse.tdp` per zone (Rust
  `CoarsenOptions`: simplify ratio 0.05 / absolute error budget 0.03 m /
  tiny-item cut 0.005×model-diag). Same item table as the full cook — slot, `item_base`,
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

**Shipped differently from the v2 plan:** the occlusion factor was not
shipped (above); the burst hold defaults ON rather than opt-in; a stale coarse pack that is about to be promoted is
promoted directly instead of refreshed first (one swap, not two). Guards to
respect when touching the commit path: a quiet commit needs a fresh draw
count and never applies to a promote; a flush frees before it
allocates; `pause()` lets in-flight prepares commit on resume; a failed demote invalidates the plan instead
of stalling a waiting promote; the coarse-first `bytesFull` is a file-ratio
guess, so one over-budget correction, bounded by dwell, is expected.

## Other TODO / future
- **Laser-scan point clouds — BUILT** (LGSX and E57; the file format is
  `rust_src/crates/scan-cook/docs/TDPP_FORMAT.md`, the open work is
  `plans/point_cloud_improvements.md`). What exists:
  - *Cook* (`rust_src/crates/scan-{core,cook,wasm}`, `src/lib/scan2tdpp/`):
    in-app LGSX / E57 → one `.tdpp` — an additive octree of cluster-quantized
    points (inner-node subsamples via `meshopt_simplifyPoints`, clusters via
    `meshopt_spatialClusterPoints`, streams via the meshopt vertex codec v1),
    the setups and their panoramas. The source is read by range straight
    from the picked File and the output streamed into OPFS; the work fans
    out over sub-workers and the coordinator commits in order, so the file
    is the same whatever the worker count. Against the native `scan` CLI
    an LGSX cook is byte-identical; an E57 cook is byte-identical at the
    same chunk size — the chunk size decides where the octree is cut, so
    the payload order — and the app always uses 3 M points
    (`scan cook --chunk-points 3000000`; the CLI's own default is 8 M).
    Each finished scan is written to the asset index before the next one
    starts; a `.tdpp` in a store that the index does not know is the
    leftover of an interrupted cook and is removed at the next start
    (`sweepUnfinishedScans`, skipped while any tab holds the import lock).
    Measured in the browser with the shipped wasm: a 464 M-point LGSX in
    39 s on 3 workers (0.5 GB peak); a 461 M-point E57 in 137 s on 4
    workers (2.0 GB) or 215 s on 2 (1.35 GB) — about 0.35 GB per worker,
    which the Workers tooltip quotes — where the old single-worker E57 cook
    took about half an hour.
  - *Settings*: the Scans panel's point cloud and photo settings are
    remembered (`state/scans/scanSettings.ts`, storage name `scans`; a value
    of the wrong kind falls back to its default) and each of the two sections
    resets on its own.
  - *Streaming* (`src/lib/tdpp/`, `src/state/scans/scanPoints.ts`): per
    frame a best-first walk over projected point spacing under one point
    budget (frustum, optional max distance, focus distance, clip planes and
    boxes), node payloads read by range from OPFS. A node is charged for its
    share in view / in range / unclipped but is resident whole, so the LRU
    cache is measured beyond the wanted nodes: idle nodes are evicted above
    `wanted + budget × cache %` (from what is wanted, not from the budget, so a max
    distance or a clip box that leaves little to draw frees memory too). A node is fetched only when its
    parent is resident or on its way (additive LOD: a child without its
    parent is never drawn), and a failed read is retried a few times, each
    after the view has moved on. The walk refines a node while its spacing
    projects wider than `point size / detail` px; that spacing is measured
    at cook time from the surface the node's points cover
    (`node::measured_spacing`), not assumed from the cube (on a 464 M-point
    indoor scan, nine views: the assumed figure stopped loading at 9–11 M
    points in view, the measured one reaches 14–22 M of a 22 M budget, and
    Detail 2× fills the budget in most views). Because a node
    charged by share is still
    drawn whole, the walk also stops when the picked nodes hold twice the
    budget counted whole (`maxHeld`); the panel shows both figures, "in
    view" (charged) and "drawn". Nothing is held whole.
    When points are shown at all is the panel's radio
    (`state/scans/pointsMode.ts`): *off* — the streamed nodes are destroyed
    at once, a scan is its spheres and photos; *hidden* — nothing is drawn or
    fetched but the resident nodes stay; *always*; *entered* — only while a
    setup is entered, and `RELEASE_HIDDEN_MS` after leaving it the nodes are
    destroyed, late arrivals included. "Only the entered setup's points" is
    on by default; the filter is applied when a node is packed, so entering
    or leaving a setup drops the GPU cache and restreams (why it is not in
    the shader: *Point record* below).
    What the streamer costs the main thread is counted in
    `state/scans/pointPerf.ts` and shown as three Stats rows (selection
    rounds, the last streaming burst, its heaviest frame and node) — the
    baseline for `plans/point_cloud_improvements.md`.
  - *Setups and photos* (a setup is called a **scan sphere** in every text
    a user reads since 2026-11-15; code, store keys, hotkey ids and the file
    format keep "setup"): a setup marker is picked by a CPU ray–sphere test
    and then checked against the depth buffer, so a sphere behind a wall
    does not take the click. Entering a setup pins the camera and loads its
    photo; a later enter or an exit wins over one still loading. A photo is
    a perspective view — entering switches off orthographic, and switching
    it on (or the viewport being remounted, as after a GPU device loss)
    leaves the setup.
  - *Large coordinates*: a scan in survey / national-grid coordinates sits
    millions of metres from the origin, where a float32 resolves 0.5 m. The
    points were always rebased in f64; the camera's orbit pivot is a
    Float64Array too (so the pinned eye is exact), and a marker sphere's
    centre is uploaded as a float32 plus its float32 remainder
    (`markerInstance.ts`) — the shader subtracts the frame origin from the
    first and adds the second.
  - *Rendering* (`src/lib/render/pointsLayer.ts`, `shaders/points.ts`):
    vertex-pull instanced quads (a 4-vertex strip per point) in the scene pass — shared depth, clip
    volume, G-buffer and TAA with the model, so scan and CAD are one scene.
    *Adaptive size* (`lib/tdpp/pointSizes.ts`): the LOD is additive, so up
    close the coarse nodes are drawn together with the fine ones. A point is
    sized by the spacing of the finest level drawn where it lies, not by its
    own node's: the node header carries the cube centre and one spacing per
    octant — the finest spacing drawn in that child's subtree, the node's own
    where no child is drawn — rewritten each round, and the vertex shader
    picks the octant from the point's position. (Sizing every node by its own
    spacing, halved under a drawn child, covered a close-up in 24 px squares.)
    *Lighter while moving* (a Scans toggle, on by default): while the view
    key keeps changing — and for `MOVE_SETTLE_MS` after — the draw list is
    the prefix of the round's picks that fits `MOVING_BUDGET_SHARE` of the
    budget (most urgent first, parents before children, so a prefix is a
    complete coarser picture). What is wanted, loaded and cached is not cut.
    *Point record*: 12 B a point (`shaders/points.ts`, `lib/tdpp/pointPack.ts`)
    — three 18-bit grid coordinates from a per-node base and unit, the setup
    byte, and r, g, b, intensity8; a 16-word header holds the cube centre,
    the octant spacings, the base and the unit. The unit is the cook grid
    when the node's extent fits 18 bits of it (262 m at 1 mm: exact), else
    extent / 2¹⁸. The setup filter is still applied at pack time, not in the
    shader: filtered in the shader every frame inside a setup would run the
    vertex stage for the other setups' points, and the point pass is
    GPU-bound.
    *Decode*: a node's read happens on the main thread (async I/O), its
    decode and pack on a pool of up to 4 plain workers
    (`lib/tdpp/pointDecodePool.ts`, `pointDecodeWorker.ts`, the job in
    `pointNodeJob.ts`); payload and result buffers are transferred. Without
    workers the same job runs on the main thread.
    *Load only what is in view* (a Scans toggle, on by default — on a 415
    M-point scan seen from inside, points held fall from 9.9 M to ~4.8 M at
    a 5 M budget and from 29 M to ~22 M at 20 M; E57 cooks, with small
    blocks, gain little; the cost is the picture's edge filling in a moment
    after the camera turns) uploads a node by range too: packed with a `keep` test, a node holds the ranges in
    the view widened by `LOAD_GUARD` and remembers what it lacks
    (`PartialNode`); when a lacking range comes within `NEED_GUARD` — and a
    load now would keep it, and the view has changed since the node was
    packed (the box tests are conservative: without both conditions a node
    beside the eye reloads forever) — the node is fetched and decoded again — its streams are compressed whole — and the
    new buffer replaces the old, which is destroyed only after the next round
    has rebuilt the draw list (`retired`). Switching the toggle drops the GPU
    cache. Otherwise a node is resident whole.
    A node is resident whole but drawn by **range** (`lib/tdpp/pointRanges.ts`):
    at pack time its 256-point clusters are grouped by octant until a group
    holds at most 8,192 points and written group by group, so a range is one
    contiguous run of the node buffer with a tight box. Each selection round
    a node cut by the view edge draws only the runs whose box touches the
    frustum (widened by the point size), the clip volume and the max
    distance, adjacent ones joined — `draw(4, count, 0, first)`. Seen from
    inside an LGSX scan only a quarter to a half of the points of the drawn
    nodes are in view, and the point pass is GPU-bound (about 1.6 ms per
    million drawn points on an integrated Radeon 780M).
    Panoramas (cube or sphere) are a separate pass with opacity
    (`panoPass.ts`).
  - *Not built*: reading a `.tdpp` over HTTP Range from a blob store, EDL
    shading, a host (postMessage) API for scans.
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
  VR model review first (Chrome on a Windows PC + a headset as display, wired
  or wireless, e.g. Quest 3 over Link/Virtual Desktop or a Steam Frame),
  on-site passthrough-AR alignment later. Unblocked by the WebXR/WebGPU
  Binding (`XRGPUBinding` + projection layers; Editor's Draft June 2026) —
  as of 2026-11 still behind flags in Chrome (Windows / Android XR) and, since
  Quest Browser 146, in the Quest standalone browser; shipped only on Vision
  Pro Safari; no official WebXR in Chrome on Linux. A headset browser has no
  multi-draw indirect, so it would run the vertex-pull path — untethered/AR
  now hangs on an unmeasured mobile frame budget, not on a missing browser
  feature. three.js r185's `XRManager.js` is the reference impl.
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
  space and driving them through the existing per-item transform pool
  (`transformPoolLayout.ts`, 32768 slots: rendering, culling, selection and
  outline already respect it; its top 16384 are already the animation band,
  apart from the undo allocator). Scope for a v1: detect animated nodes in the generic cook →
  skip baking their animated transform + record channels (times, TRS,
  linear/step interpolation) and the node→item mapping; store as a sidecar
  `<id>.anim.json` in OPFS (CADM has no animation section), tag the asset
  like `hasNormals`; playback sampling into the animation band; small UI with
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
  decide when texture support is designed (a CADM version after v9, which
  is the spatial cell table).
- **Click-pick buffer race — CONFIRMED in the wild.** Observed on a real
  machine while rapid-clicking: `[Buffer "itemPickBuf"] used in submit while
  pending map. — While calling [Queue].Submit(...)` (the labels added for
  diagnostics named the culprit directly). Dawn classifies it as a
  **Validation** error, so the bad submit is dropped CPU-side — console spam +
  a lost pick that frame, NOT a GPU hang. This is hazard #1 below, confirmed.
  Fix LANDED: the in-flight guard in `ItemPickPass` (`itemPickPass.ts`,
  `inFlight`; rapid clicks queue latest-wins in `pending` until the readback
  buffer frees).
  Tracked separately from the device-hung below, which is a *different*
  failure ("unexpected error type Internal", `DXGI_ERROR_DEVICE_HUNG
  0x887A0006`) — a genuine D3D12 device removal seen on only one PC, most
  likely an Intel/Chromium driver TDR rather than our code. Our uncapped pick
  passes (hazard #2) could aggravate a marginal GPU but are not the root
  cause; the same guard caps that load.
- **Click-pick robustness under rapid clicking (status 2026-07-26: both
  hazards addressed).** Historical analysis kept for context (the names in
  the hazards are from before the pick moved into `itemPickPass.ts`); the
  item pick now gates on `ItemPickPass.inFlight` (mirroring the depth path's
  `pickInFlight`), `pending` stays a latest-wins supersession slot, a fully
  opaque scene reads the id from the G-buffer instead of re-rendering
  (`encodeFast`), the replay scissors to the 1×1 cursor texel
  (fragment/depth work capped; vertex work remains), and the depth pick reads
  one texel of the real depth target in a compute (see *Pick pass* — never the
  HZB). The original hazards:
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
  buffer. **Landed as diagnostics:** the `device.lost` handler logs
  `reason` + `message` (and starts recovery, see *GPU device loss &
  recovery*), and every WebGPU resource in `renderer.ts` now carries a `label:` (buffers, textures,
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
