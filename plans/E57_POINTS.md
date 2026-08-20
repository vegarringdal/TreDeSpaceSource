# E57_POINTS — laser-scan point clouds with streaming LOD (PARKED)

> **Status: PARKED / not scheduled.** Design capture from the 2026-07-24
> instancing/memory discussions, not an approved plan. Do **not** start
> building until scan overlay becomes a product need. File references were
> accurate when written — **re-verify at implementation time**. This is
> epic-sized (comparable to the whole import-manager effort), so it lands as
> its own milestone with a director-approved plan first.
>
> **Director preference (2026-07-24): the PANORAMA slice is the interesting
> part** — E57 image extraction + enter/opacity-compare WITHOUT the heavy
> point-cloud import/convert. If E57 work is ever scheduled, start (and
> possibly stop) there; the point-streaming epic below stays parked on its
> own merits.

## Goal / motivation

**Main goal: load an E57 in-app and cook it into a streamable hierarchy
file** — same contract as every other import (nothing uploaded, cook once,
cache), but the output is designed for *partial* loading, because full-load is
impossible at scan scale (real projects are 10⁸–10¹⁰ points, tens of GB).

The product value is **scan overlay**, not a standalone cloud viewer (Potree
already exists): as-built laser scan and as-designed CAD in ONE scene — one
camera, one depth buffer (mutual occlusion), one clip system, measure from a
model pipe to the scanned flange next to it. That constraint drives the whole
design: points must render inside our WebGPU pipeline, not in a bolted-on
second renderer.

Secondary goals, from the director:

- **Streamable from a blob store, not just OPFS.** The cooked hierarchy must
  be chunk-addressable so nodes can be fetched with HTTP Range requests from
  e.g. Azure Blob / S3, with the same code path as local OPFS reads.
- **Multiple E57 files as one logical cloud.** Load several E57s (or one site
  scanned in campaigns) and have a **combined loading index** so traversal,
  budget, and prioritization treat them as one cloud.

## Why streaming LOD is mandatory here (and was rejected for meshes)

For CAD meshes we measured and rejected both geometry-side memory tricks
(DESIGN.md: "Instancing experiment — tried and rejected", and the shelved
meshlet LOD that made VRAM *worse*), concluding load/unload is the only VRAM
lever — parked behind a trigger current hardware doesn't hit. Point clouds
flip every one of those verdicts:

- There is **no full-load baseline** to compare against — streaming isn't an
  optimization, it's the feature.
- The "feels laggy" objection dies: progressive refinement is the accepted UX
  in every point-cloud viewer ever shipped.
- **Subsampling points is trivial and artifact-free** (no topology to
  preserve), unlike CAD mesh simplification which is where mesh LOD hurt.
- Memory is easy for once: a healthy resident budget of 10–30 M points is only
  ~160–500 MB. Streaming bounds *density*; the real ceiling is vertex/fill
  rate (especially UMA iGPUs).

## Architecture sketch

### Cooked format ("points" asset kind)

Octree, Potree-2.0-shaped (see "Potree" below): a small **hierarchy index**
(node tree: bounds, child mask, point count, byte offset + length into the
data blob, per-node spacing) that loads fully and stays resident, plus one
**data blob** of per-node point payloads addressed by (offset, length).

- Inner nodes hold a **subsample** ("LOD simple"), leaves full density —
  generate inner-node subsamples with **`meshopt_simplifyPoints`**
  (distance- and color-aware, no connectivity needed; already vendored in
  `rust_src/crates/meshopt`). NOT `demo/clusterlod.h` — that is triangle-only
  (needs an index buffer, drives `meshopt_simplify*`/`partitionClusters`) and
  is the Nanite-style *mesh* LOD path we deliberately shelved.
- Per-node payload: positions quantized **u16×3 against the node AABB** (the
  per-meshlet quantization trick from the mesh format, `format.ts` /
  `MeshletDesc`), color RGB8, optional intensity; each stream compressed with
  the **meshopt vertex codec** (same codec as the CADM meshlet streams).
  Ballpark ≤8–10 B/point before codec gains.
- Node size target ~20–100 k points (fewer, larger nodes = fewer requests and
  fewer draws; exact number is a tuning question).

### Cooker (in-app, wasm worker)

- Parse E57 with the pure-Rust **`e57` crate**, streamed through the same
  OPFS sync-access-handle IO-callback pattern `src/lib/rvm2glb/rvm2glbWorker.ts` uses —
  the wasm never holds the whole file (E57s are tens of GB; wasm memory caps
  at 4 GB).
- Two-pass external octree build (Potree-converter style): pass 1 bounds +
  counts; pass 2 distribute into OPFS temp chunks, then per-chunk hierarchical
  build + subsample + encode. Expect minutes for big scans at wasm speed —
  acceptable as a one-time cook, with the usual progress dialog.
- E57 carries **per-scan poses** (and panorama imagery — see Deferred): keep
  scan identity per point run so per-scan visibility works.

### Multi-E57 / combined index

Each E57 cooks to its own octree asset (cheap, incremental — adding a file
never re-cooks the others). On top, a **combined index**: a tiny manifest that
unions the per-file octrees into one logical cloud for the loader — one
traversal pass over all roots, ONE global screen-space-error queue and ONE
point budget shared across files, so a dense area covered by three campaigns
doesn't get 3× the density budget. This is the "expand the E57 index into
something that combines the loading logic" requirement: combination happens at
**load/traversal time**, not cook time. An optional later "bake" that
re-cooks several files into one physical octree (best traversal, expensive,
frozen membership) can be added if federated traversal ever measurably hurts.

### Streaming manager

- Refinement by **screen-space error** (project node spacing to pixels)
  under a global point budget; hysteresis so hovering at a threshold doesn't
  thrash; prioritized load queue (Potree's SSE formula and budget defaults are
  the field-tested reference — port the *numbers*, MIT license → third-party
  notices flow if actual code is ported).
- Decode in a worker (codec decode is ~GB/s), **uploads throttled per frame**
  so refinement is latency, never frame stutter. Unload = drop node buffers
  (evict farthest/lowest-priority first).
- **Chunk source abstraction**: `read(offset, len)` implemented by (a) OPFS
  sync access handle, (b) HTTP **Range** requests against a blob-store URL —
  the blob-store event/URL plumbing can ride the existing assets/postMessage
  import surface (`EVENTS.md`) when designed. Remote chunks get cached into
  OPFS (LRU) so revisits are local. The format is deliberately
  offset+length-addressable to make (b) trivial.

### Rendering (WebGPU, inside the existing pipeline)

- v1: **vertex-pull screen-aligned quads** — one draw per visible node set,
  6 pulled vertices per point (the same vertex-pull pattern as the mesh VP
  path), point size from node spacing + distance. Writes the shared depth
  buffer → CAD/cloud occlusion just works; clip uniforms apply per point; TAA
  helps (points shimmer without it).
- Shading: points have no normals — **Eye-Dome Lighting** as a small pass in
  the existing post chain. Edge detection and AO skip points.
- Culling: frustum + **HiZ** test per octree *node* (a few thousand nodes —
  reuse of the cull pass-2 approach at node granularity).
- Identity: no dense items. The tree panel lists **scan positions** (per-scan
  visibility toggles, resident like the CAD hierarchy); octree nodes are
  tagged by scan. Item-state machinery does NOT map — keep a small separate
  per-scan flags path. Measurement gets a nearest-point variant of the compute
  snap probe (`measureSnapWgsl`) over resident nodes.
- v2 (deferred): compute-shader splatting (Schütz-style atomic rasterization;
  10–100× quad throughput but WebGPU has no 64-bit atomics — needs a two-pass
  u32 depth/color trick). Decide only if quad throughput fails on UMA.

## Panoramas (E57 Image2D) — the cheap slice, possibly first

E57 files embed the scan photos as `Image2D` entries: JPEG/PNG blobs with a
**pose** and a projection model (spherical panorama is the common case; also
pinhole/cylindrical). Director wants: easy extraction, panels/markers showing
the spheres, the ability to **enter** one, and an **opacity slider** to
compare "how it looks in real life" against the model — as-built photo vs
as-designed CAD.

- **Extraction**: at import, pull only the Image2D blobs + poses (the `e57`
  crate exposes them — re-verify coverage) and store them in OPFS alongside
  the asset; skip point data entirely in this mode. Big panos (8–16 k wide)
  may want downscaled levels for fast open.
- **In-scene**: a marker sphere at each scan position, rendered in 3D and
  **selectable like scene objects** (click to select — highlight + shows in
  the scans panel; participates in the pick/id path). A **keyboard shortcut
  "enter selected scan"** (plus double-click on the sphere) snaps the camera
  to that scan's center/viewpoint; a next/previous-scan shortcut pair makes
  walking a corridor of scan positions fast. Inside, the camera is **locked
  to rotation-only** at the scan center — the panorama only lines up with
  geometry from exactly that point; free movement breaks the illusion with
  parallax (either forbid it or fade the pano out with distance from center).
  Esc exits back to the free camera. All of it gets hotkey bindings +
  tooltips per the house rule (`src/hotkeys/bindings.ts`).
- **Rendering**: an equirect-textured sphere around the camera. Two blend
  modes off one opacity slider: pano as *background* (behind all geometry —
  model floats in the photo), and pano *over* the render with alpha — the
  crossfade is the real-vs-design comparison tool. Trivial pass in the
  existing pipeline; TAA should treat it as background (no reprojection
  ghosting concerns at opacity extremes).
- **Why it can come first**: no octree, no streaming, no LOD, no point
  rendering — just E57 image parsing (wasm), OPFS storage, one textured
  sphere + camera lock + a slider. A fraction of the epic, independently
  shippable, and it delivers visible as-built value early. The scans
  panel/markers it introduces are then reused by the point-cloud milestone.

## Potree / potree-core verdict (2026-07-24)

- **Do not depend on `tentone/potree-core`**: it's a three.js/**WebGL**
  renderer (peer-dep three.js) and requires desktop **PotreeConverter**
  pre-conversion (LAS/LAZ input, not E57). A WebGL layer can't share our
  WebGPU depth/clip/TAA — it would be two viewers glued together, killing the
  scan-overlay value that is the point of the feature. It also doesn't cover
  any of the parts we'd actually have to build (WebGPU path, our buffers, EDL
  in our post chain).
- **Do adopt Potree's shape**: the Potree 2.0 single-file octree layout
  (metadata + hierarchy chunks + one data blob) is proven at billions of
  points and is exactly the chunk-addressable form the blob-store requirement
  needs. Two options at implementation time: use Potree 2.0 as our literal
  cooked format (free interop — existing PotreeConverter output drops in), or
  our own CADP layout with codec-compressed streams (smaller), plus a Potree
  *import* path. Leaning: own format for the cook, accept Potree 2.0 as an
  input like any other import.

## What meshoptimizer does and doesn't cover

- **Covers**: `meshopt_simplifyPoints` (inner-node subsample selection) and
  the vertex codec (per-node stream compression). Both callable from the Rust
  wasm cooker via the vendored meshopt.
- **Does not cover**: the octree/hierarchy, SSE selection, streaming,
  rendering. `demo/clusterlod.h` is triangle-cluster LOD only — not
  applicable to points, and re-opening *mesh* cluster LOD is explicitly out
  (see DESIGN.md instancing/LOD post-mortems).

## v1 cut

Single E57 → in-app cook (octree, simplifyPoints subsamples, codec streams) →
OPFS streaming with SSE + budget + hysteresis → vertex-pull quads + EDL,
shared depth/clip/TAA → per-scan visibility in the tree → nearest-point
measure snap. Multi-file combined index and blob-store Range source are v1.5
(the format supports both from day one; the manifest and remote reader are
small once the local path works).

A **panorama-only pre-slice** (see "Panoramas" above) can ship before any of
this: E57 image extraction + scan markers + enter/opacity-compare, no point
streaming involved.

**Deferred**: compute splatting, estimated normals/surfel shading, region/box
selection of points, Potree-2.0 import, EPT/LAS/LAZ inputs, combined-octree
"bake".

## Risks / open questions

- **UMA fill/vertex rate** is the perf ceiling — prototype quad throughput on
  the low-end iGPU early; it decides whether v2 splatting is needed.
- **Cook throughput in wasm** (target ≥0.5–1 M pts/s) and OPFS temp-space
  churn for the external build.
- `e57` crate coverage of real-world scanner output (vendor quirks,
  spherical/Cartesian, scaled-integer encodings).
- SSE tuning for *overlay* use (cloud density needed to judge as-built vs
  CAD is lower than standalone-viewer pretty-picture density — budget can be
  modest).
- Blob-store auth/CORS model for Range requests (host-app concern via the
  postMessage API; needs its own small design).
