# ANIMATION — static keyframed item animation / construction sequences (PARKED)

> **Status: PARKED / not scheduled.** Design capture from a 2026-08-04
> discussion so we are prepared, not an approved plan. File references were
> accurate when written — **re-verify at implementation time.**

## Goal

Animate items with a matrix we update per frame — translate + rotate — to
show things like a **construction sequence**: assemblies appear at their step,
move/rotate into place, and the timeline can be played or scrubbed. No
vertex-level deformation, no skinning; strictly rigid per-item/per-group
matrices, which is exactly what the existing committed-transform system
already models.

## Decision: rigid only — NO scale

Scale is **not** an allowed animation transform. Reasons, in order:

1. **Semantics.** Scaling a CAD item breaks it — dimensions, measurements and
   snapping all lie about a scaled item. A construction sequence never needs
   it.
2. **Cull correctness.** The cull moves the bounding-sphere *center* by the
   item matrix but never scales the *radius*
   ([cull.ts:255-260](../src/lib/render/shaders/cull.ts)), so a scaled-up item
   would be wrongly frustum/clip-culled. Rigid-only means the radius stays
   valid with zero extra work.
3. **Lighting correctness.** Authored normals are transformed by the matrix
   directly, no inverse-transpose
   ([scene.ts:356-361](../src/lib/render/shaders/scene.ts)) — exact for rigid
   motion, skewed under non-uniform scale.
4. **Cone cull.** The meshlet backface cone stays exact under rotation (rotate
   the axis), but is invalid under non-uniform scale.

If uniform scale is ever demanded (e.g. an "explode" effect that isn't), it
needs radius × max-axis-scale in the cull plus a decision about normals — a
deliberate follow-up, not a default capability. (Note the *gizmo* transform UI
does expose scale today; that is an editing feature, separate from animation.)

## What already exists (the ~90%)

The move-gizmo work built almost all the machinery:

- **Per-item transform slots.** Global pool of 4096 column-major mat4 slots
  ([transformPool.ts](../src/lib/modeldb/transformPool.ts)), slot 0 =
  identity; `item_states[item].tidx` points into it.
- **Shader application.** Both render paths apply the committed transform in
  the vertex shader ([scene.ts:344-347](../src/lib/render/shaders/scene.ts)),
  as do the snap/pick shaders.
- **Transform-aware cull.** Frustum, clip-shape and px-cut tests already move
  the bounding sphere by the item matrix
  ([cull.ts:255-267](../src/lib/render/shaders/cull.ts)); cone and HZB are
  skipped for transformed meshlets (see the cull upgrade below).
- **Upload path.** One `writeBuffer` of the used pool region per frame
  ([renderer.ts:1234](../src/lib/render/renderer.ts)) — 64 B/slot, ≤256 KB,
  trivially per-frame.
- **Render-loop behavior.** Any state change restarts TAA/AO accumulation and
  keeps the renderer out of idle; playback just holds it in "moving" mode
  (same as a gizmo drag), and it reconverges when the timeline stops.
- **Visibility.** Per-item hide/show already exists — "items appear at step
  N" is a visibility key, no new GPU work.

## What must be built

1. **Write-in-place animation slots.** `applyGroupTransform`
   ([apiTransform.ts:129](../src/lib/modeldb/apiTransform.ts)) allocates a
   *new* slot per op and pushes an undo record — per-frame that churns the
   4096-slot pool and floods the undo stack. Animation instead assigns each
   animated group **one slot at setup** (tidx written once), then playback
   rewrites those 16 floats each frame. Playback is not an edit: no undo, no
   allocation. Interaction with the transform-undo domain needs care: a
   committed gizmo edit on an animated item while a sequence exists must not
   fight the animation slot (simplest rule: an item is owned by at most one of
   the two at a time).
2. **Main-thread playback driver.** The modeldb (and apiTransform) lives in
   the worker, but since tidx assignment happens once, the per-frame part is
   just "write floats into `transformsBuf` + bump the render key" — it can
   live next to the renderer with no worker roundtrip.
3. **Sequence data model.** Groups (a saved selection each), keyframe tracks
   (time → position/rotation, interpolated — slerp for rotation), visibility
   keys, easing. 4096 pool slots caps independently-animated groups at ~4000;
   assemblies animating as groups keeps this a non-issue.
4. **Timeline UI.** Play/pause/scrub panel; every control gets a hotkey +
   tooltip (house rule). Scrubbing = evaluate tracks at t, write slots, one
   frame.
5. **Persistence + SDK — open questions.** Where do sequences live (snapshot
   format? per-model sidecar?), and is authoring in-app only or can a host app
   drive it via postMessage? The SDK currently has **no** transform commands
   at all; adding any means JSDoc + EVENTS.md sections per the docs rule.

## Cull upgrade: animated items as first-class cull citizens

Today transformed meshlets skip the cone test and the HZB occlusion test
([cull.ts:356-360](../src/lib/render/shaders/cull.ts)), so an animated item is
drawn whenever in-frustum — even fully behind the plant. Worth fixing before
or alongside animation:

- **Cone test:** rotate the stored axis by the matrix's upper 3×3 — exact
  under rigid motion (which is all we allow). One extra mat3×vec3 per
  transformed meshlet.
- **HZB test:** the skip looks inherited from native `cull.slang` and more
  conservative than this port requires. Here the pyramid is rebuilt **every
  frame** from pass-1 depth ([renderer.ts:9-11](../src/lib/render/renderer.ts)),
  and pass 1 renders with the *current* transforms — so occluders sit at their
  current animated positions and testing a moved sphere against them is
  spatially consistent (including the self-test case; standard niagara-style
  two-pass). Only the occluder *set* is one frame stale, which errs
  false-visible — the safe direction.
- **Caveats:** an occluded moving item re-enters via pass 2 with one frame of
  disocclusion latency (inherent to two-pass, same as static geometry under
  camera motion). And this is theory until verified in-app: put it behind a
  toggle next to `freezeCull`, test a gizmo drag over occluded geometry (the
  live-gizmo path shares the `moved` flag), and keep both cull passes
  consistent — per-pass flag drift has bitten before (two pushes per frame).

~15 lines of WGSL plus the toggle. Payoff: the cost of animating N items
becomes proportional to what's actually visible.

## Suggested build order

1. Cull upgrade behind a toggle (independent, verifiable now, small).
2. Animation slot ownership + main-thread playback driver (no UI: a debug
   "spin the selection" hook proves the loop).
3. Sequence model + timeline UI.
4. Persistence, then SDK exposure if wanted.
