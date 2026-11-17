# XR — WebXR VR/AR for the WebGPU viewer (PLANNED, not scheduled)

> **Status: design capture, 2026-07-26.** Direction agreed with the director;
> no implementation started. Phase 1 (the spike) is deliberately small and can
> be scheduled any time; phases 2-3 need a director-approved plan first. File
> references were accurate when written — **re-verify at implementation time**.

## Goal / motivation

Two product stories, in priority order:

1. **VR model review** — put the headset on and walk the plant at 1:1. Design
   review, clash discussion, "does the walkway clearance feel right".
   Desktop-tethered (PCVR) is fine for this.
2. **On-site AR alignment** — passthrough AR on location, overlay the CAD
   model on the real construction, and nudge it into alignment with the real
   object (the director's "lock button" idea, below). This is the long-game
   story; it needs untethered hardware (Quest standalone / phone) which our
   renderer can't target yet (see device matrix).

## Platform status (checked 2026-07-26)

WebXR was WebGL-only for years; that has changed:

- The **[WebXR/WebGPU Binding](https://immersive-web.github.io/WebXR-WebGPU-Binding/)**
  is an official Editor's Draft (June 2026). `XRGPUBinding` + WebGPU-backed
  projection layers replace `XRWebGLLayer`. Per-platform (2026-07-26, per
  three.js #32858 + blink-dev): **Vision Pro Safari = shipped** (only
  unflagged impl; irrelevant to us — no multi-draw indirect); **Chrome
  Windows / Android XR = experimental** behind flags ("WebXR Projection
  Layers" + "WebXR/WebGPU Bindings", since Canary 135) — only an Intent to
  Prototype (Aug 2024) exists, **no Intent to Ship filed**, so no stable
  milestone is announced (realistically 2027+); **Meta Quest browser = not
  implemented at all**. We already require experimental flags (multi-draw
  indirect), so flagged Chrome is not a new constraint for v1.
- **three.js dev branch has a native WebGPU XR path** and is our best
  reference implementation: `src/renderers/common/XRManager.js` (session
  lifecycle, layer creation, per-view loop, fallback chain), plus examples
  `webgpu_xr_cubes.html` (controller input) and `webgpu_xr_rollercoaster.html`
  (locomotion/rig transforms). Their recipe, confirmed from source:
  - request session with `optionalFeatures: ['webgpu']`, check
    `session.enabledFeatures.includes('webgpu')`;
  - `new XRGPUBinding(session, device)` →
    `binding.createProjectionLayer({ colorFormat:
    binding.getPreferredColorFormat(), depthStencilFormat: 'depth24plus' })`;
  - per frame, per view: `binding.getViewSubImage(layer, view)` → array-layer
    render target + viewport; view supplies transform + projection matrix.
  - **No multiview in WebGPU** — two passes into a 2-layer array texture.
  - They disable MSAA in the WebGPU XR path (projection-layer textures can't
    be multisampled). Not a blocker for us — see rendering notes.
- The GPU adapter must be requested with `xrCompatible: true`
  (`src/lib/render/renderer.ts` init — harmless when XR unused, set it always).
- Raw-API reference: [toji.dev writeup](https://toji.dev/2025/03/03/experimenting-with-webgpu-in-webxr.html)
  (Brandon Jones, spec author) + the immersive-web explainer/samples.

## Device matrix

| Target | Session | Feasible | Why |
|---|---|---|---|
| Desktop Chrome + PCVR (Quest Link / SteamVR) | `immersive-vr` | **v1** | Full `chromium-experimental-multi-draw-indirect`; the GPU we already target |
| Quest standalone browser | `immersive-vr` / `immersive-ar` passthrough | later | WebGPU/WebXR binding **not implemented at all** (2026-07); plus almost certainly no multi-draw indirect on Adreno — needs both the browser to catch up and our non-MDI fallback draw path |
| Android phone (ARCore Chrome) | `immersive-ar` | later | Same multi-draw problem; phone GPU |
| iOS Safari | — | no | No AR-mode WebXR |

The AR alignment story lands exactly on the hard row(s). **VR-first is the
plan**: it builds all the XR plumbing; AR is then "add a non-MDI draw path +
passthrough session mode", not a rewrite.

## Renderer seams (what actually changes)

Frame loop today: `viewport.ts` tick → `requestAnimationFrame` + fps limiter →
`renderer.frame(canvas)` (`src/components/panels/viewport/viewport.ts:693`,
`src/lib/render/renderer.ts:2067`). Camera: `CameraController.viewProj(aspect)`
(`src/lib/render/camera.ts:361`), plus per-frame uniforms fed from
`camera.eye()/forward()/lastView/lastP00/near` inside `frame()`
(`renderer.ts:2223-2268`).

XR changes, roughly in dependency order:

1. **Loop ownership.** In-session, `xrSession.requestAnimationFrame(cb)` drives
   frames (the `XRFrame` arg carries poses); the window RAF tick pauses (or
   only mirrors). The fps limiter must NOT apply — the compositor paces.
2. **External view/projection.** Extract the inner body of `frame()` into a
   per-view render function that takes (view matrix, projection matrix, target
   texture/layer, viewport) instead of deriving them from `CameraController` +
   canvas. Desktop `frame()` becomes the 1-view caller. XR projection matrices
   are **asymmetric-frustum** — anything assuming a symmetric `p00/p11`-style
   projection (AO/edge unproject constants, `renderer.ts:2258`) must consume
   the full matrix or per-view constants, not recomputed ones.
3. **Culling per eye.** Run the full cull per view (or one pass with a merged
   two-eye frustum — cheaper, slightly conservative; decide in the spike).
   Remember the house invariant: the cull has **TWO pushes per frame**
   (`cull_push` pass 1 + `cull_push2` pass 2) — per-view flags/matrices must be
   set on BOTH or newly-visible meshlets break. HiZ pyramid is per-view state
   (either 2 pyramids or reuse-with-reprojection later; 2 pyramids first).
4. **AA: TAA off, MSAA on.** TAA (`fastAA`) is wrong in a headset — the pose
   changes every frame, accumulation never converges and smears. Force
   `fastAA=false` in-session and prefer the `msaa4x` path. The MSAA caveat
   from three.js doesn't bite us: we already render into our own offscreen
   MSAA targets and post-resolve (`rebuildTargets`, `renderer.ts:1906`) — the
   final post/present pass writes into the projection-layer array slice
   instead of the canvas swapchain. VBAO: its temporal accumulation also never
   converges in XR — run it at reduced quality or off; decide in the spike.
5. **No hold/idle path.** The renderer's converged-idle short-circuit
   (`renderer.ts:2156-2182`) must be bypassed in-session — the head never
   holds still, and re-presenting a stale frame in a headset is nausea.
6. **Targets per eye.** Projection-layer texture is one array texture
   (2 layers). Our offscreen chain (depth, color, HiZ, pick, AO history) needs
   ×2 instances or array-layer views — sized to `layer.textureWidth/Height`,
   NOT the canvas. Resize logic keys on layer size in-session.
7. **Z-up vs Y-up.** Our world is Z-up (`camera.ts` header); WebXR reference
   spaces are Y-up, gravity-aligned, meters. Insert one fixed root transform
   (Z-up→Y-up) between model space and XR space; all XR poses/rays convert
   through it. Units: cooked models are meters (verify per-format at impl
   time — RVM/IFC importers normalise; anything off means the model renders
   at wrong scale in XR, instantly visible).
8. **Desktop mirror (optional, later).** Blit one eye to the canvas while
   in-session so bystanders see something. Not needed for the spike.

## UX design

### Enter/exit VR

The Home ribbon used to carry a disabled placeholder for this — a "VR"
section with an "Enter VR" button (`IconDeviceGamepad2`, stub `enterVr`
action) in `RibbonHome.tsx` — **removed 2026-07-26** so the app doesn't show
a dead button while this doc is parked. Phase 2 restores it in that same
spot (Home ribbon, own "VR" section, gamepad/headset icon).

Toolbar button (headset icon) — hidden or disabled-with-reason when
`navigator.xr` / `webgpu` feature is absent. Per house rule: hotkey binding +
tooltip (`src/hotkeys/bindings.ts`, then `npm run test:boot`). Session end
(user removes headset, browser kills session) must restore the desktop loop
cleanly — `session.onend` is the single teardown point.

### Start from current camera

On entry, the XR viewer should stand where the desktop camera was, looking at
the same thing. Implementation: take the desktop camera eye + forward, strip
roll and pitch-to-horizon as needed (reference space is gravity-aligned — only
yaw + position are free), build an `XRRigidTransform`, and apply it via
`referenceSpace.getOffsetReferenceSpace()`. Equivalent alternative: leave the
reference space alone and set the model root transform — pick whichever
composes better with the lock button (they share the same transform slot).

### Lock button (the alignment tool)

While the lock is **held**, the model rides with the head — frozen relative to
the viewer — so the user can walk/lean to drag the model into alignment with
the real object; on **release** it re-anchors in world space.

Math: on press, save model transform `M0` and head pose `H0`. Each frame while
held: `M = H · H0⁻¹ · M0` (all in XR space, through the Z-up root transform).
On release, keep the current `M`. That's the whole primitive.

Complements for fine alignment (phase 2+, AR-focused):

- **Grip-drag** on a controller: translate; two-hand or thumbstick twist:
  rotate — **yaw only**. Tilting a CAD model off gravity is never wanted on
  site; lock scale at 1:1 for the same reason.
- Small-step nudge (thumbstick taps = cm steps) for the last few millimetres.
- Persist the resulting model↔world transform per model so a re-entered AR
  session on the same site starts aligned (storage story TBD — pairs with the
  postMessage host API if hosts want to own site calibration).

### Controller interaction

- `select` (trigger) = pick: controller ray → part select/highlight. The
  screen-pixel GPU pick path doesn't apply; use a ray variant of the compute
  snap probe (`measureSnapWgsl` machinery) or a 1×1 off-axis pick render along
  the ray. Reuses the picking investment either way.
- Ray + reticle rendered as overlay geometry (line pipeline exists).
- Teleport/locomotion: thumbstick smooth-move is enough for v1 (engineers on
  a review call, not a comfort-critical game); teleport arc later if needed.

## Performance notes

Stereo ≈ 2× cull+draw at 72-90 Hz vs today's 60 Hz monocular target — the
dense-model case will lean hard on occlusion culling. Levers, cheap first:

- `projectionLayer.fixedFoveation` (compositor-side, ~free).
- Layer `scaleFactor` < 1.0 (render below native eye resolution) — the classic
  XR dynamic-resolution lever; can be driven off frame timing later.
- Merged-frustum single cull pass (see seam 3).
- VBAO off / edges off in-session presets.

If PCVR can't hold frame rate on the dense model, that's a finding, not a
blocker — the spike exists to measure it.

## Phases

1. **Spike (small, schedule any time).** Chrome Canary + flags, `xrCompatible`
   adapter, session + `XRGPUBinding` + projection layer, per-view render of
   the existing scene (TAA off, hold path bypassed, per-view cull), head
   tracking only, hardcoded start pose. Deliverable: the dense model in a
   headset + a frame-time number. Answers the only real unknown.
2. **Productize VR.** Enter/exit button (+hotkey/tooltip), start-from-camera,
   in-session settings preset (TAA→MSAA, VBAO/edges policy), controllers
   (pick, locomotion), lock button, desktop mirror, session teardown polish.
3. **AR / untethered (separate plan).** Non-multi-draw fallback draw path
   (big — it's a second draw architecture), `immersive-ar` passthrough,
   phone/Quest profiling, alignment persistence. Do not start without a
   director-approved plan; the fallback path is the real cost.

## Risks / open questions

- **Flag/rollout drift**: which Chrome channel ships `XRGPUBinding` unflagged,
  and does it reach stable while multi-draw indirect is still experimental?
  (Both must be on simultaneously for us.)
- **Frame budget**: 2× scene at 90 Hz on the dense model — spike measures.
- **Texture-copy overhead**: Chrome's early binding impl had an internal copy
  (toji.dev, 2025) — may or may not still exist; shows up in spike numbers.
- **Depth submission**: whether we can hand the compositor our depth (better
  reprojection) given our post chain — `depthStencilFormat` on the layer,
  investigate in spike.
- **Per-view resource cost**: doubled HiZ/AO/depth targets at eye resolution —
  VRAM check on the 3 GB-class dense model.
- **Units/axis audit** (seam 7): one wrong importer and the model is sideways
  or 1000× off in the headset.
- **Reference-space choice**: `local-floor` vs `local` vs `bounded-floor` for
  the start-from-camera math (floor-relative is right for walking, but the
  desktop camera has no floor concept — likely `local` + explicit height).

## References

- Spec: <https://immersive-web.github.io/WebXR-WebGPU-Binding/>
- Explainer + samples: immersive-web GitHub (`WebXR-WebGPU-Binding` repo)
- toji.dev: <https://toji.dev/2025/03/03/experimenting-with-webgpu-in-webxr.html>
- three.js reference impl: `src/renderers/common/XRManager.js` (dev branch),
  examples `webgpu_xr_cubes.html`, `webgpu_xr_rollercoaster.html`
