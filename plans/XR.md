# XR — WebXR VR/AR for the WebGPU viewer (PLANNED, not scheduled)

> **Status: design capture, 2026-07-26; platform status re-checked
> 2026-11-17** (from web sources, nothing tested by us). Direction agreed with
> the director; no implementation started. Phase 1 (the spike) is deliberately
> small and can be scheduled any time; phases 2-3 need a director-approved
> plan first. File references were accurate when written — **re-verify at
> implementation time**.

## Goal / motivation

Two product stories, in priority order:

1. **VR model review** — put the headset on and walk the plant at 1:1. Design
   review, clash discussion, "does the walkway clearance feel right".
   Desktop-tethered (PCVR) is fine for this.
2. **On-site AR alignment** — passthrough AR on location, overlay the CAD
   model on the real construction, and nudge it into alignment with the real
   object (the director's "lock button" idea, below). This is the long-game
   story; it needs untethered hardware (Quest standalone / phone). The
   browsers there now have an experimental path and the renderer has a
   fallback draw path, but nobody has measured whether a mobile chip is fast
   enough (see device matrix).

## Platform status (checked 2026-11-17; first written 2026-07-26)

WebXR was WebGL-only for years; that has changed. **Everything we could use
is still behind flags** — nothing below was tested by us.

- The **[WebXR/WebGPU Binding](https://immersive-web.github.io/WebXR-WebGPU-Binding/)**
  is an official Editor's Draft (June 2026). `XRGPUBinding` + WebGPU-backed
  projection layers replace `XRWebGLLayer`. Per platform:
  - **Chrome Windows — behind flags.** Experimental since Canary 135. The
    feature was still `FEATURE_DISABLED_BY_DEFAULT` in Chromium source on
    2026-10-05; only the Intent to Prototype (Aug 2024) exists, **no Intent
    to Ship**. In Chromium 154 it was reported as not listed in
    `chrome://flags` and enabled with
    `--enable-features=WebXRGPUBinding,WebXRLayers` — check the current way
    at spike time.
  - **Chrome Android XR (Galaxy XR) — experimental** (stated January 2026;
    nothing newer found).
  - **Meta Quest browser — behind a flag, no longer absent.** Experimental
    since Quest Browser 146 (spring 2026): turn on *WebXR experimental
    features* (plus the WebGPU entries) in `chrome://flags` and restart the
    browser. A third-party test on a Quest 3 with browser 154 (2026-10-18)
    reports the VR session running on `XRGPUBinding`; without the flags it
    falls back to WebGL 2. (The July version of this plan said "not
    implemented at all" — that was already out of date.)
  - **Steam Frame** (Valve's standalone / streaming headset, launched
    2026-09-14): its own browser got WebXR in the SteamOS 0.5.7 beta
    (Chromium 157+, early November 2026). Nothing found on the WebGPU binding
    there.
  - **Vision Pro Safari — shipped**, the only unflagged implementation;
    irrelevant to us.
  - **Chrome on Linux — no official WebXR at all**; only a community patch
    (`mrxz/webxr-linux`). A PCVR spike needs a Windows PC.
- **Multi-draw indirect is still Chrome-experimental**
  (`chromium-experimental-multi-draw-indirect`, behind "Unsafe WebGPU"). A
  secondary source says the gpuweb standards issue was closed as not planned,
  and survey data shows it on almost no Android device. It is no longer a
  hard requirement for us: the renderer falls back to the **vertex-pull
  path** (GPU culling without multi-draw; what Android tablets already run),
  which is slower per meshlet.
- **Two reference implementations now.** three.js shipped WebXR over WebGPU
  in r185: `src/renderers/common/XRManager.js` (session lifecycle, layer
  creation, per-view loop, fallback chain), plus examples
  `webgpu_xr_cubes.html` (controller input) and `webgpu_xr_rollercoaster.html`
  (locomotion/rig transforms). Babylon.js closed its WebXR-over-WebGPU work on
  2026-09-01 (reported by a tracker, not checked in the repo). The three.js
  recipe, confirmed from source in July:
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
| Windows PC + Chrome, headset as display — wired or **wireless streaming** (Quest 3 / 3S over Air Link, Steam Link or Virtual Desktop; Steam Frame) | `immersive-vr` | **v1** | The browser and GPU are the PC's: full multi-draw indirect, the GPU class we already target. Flags on the PC only. Not on Linux |
| Quest 3 standalone browser | `immersive-vr` / `immersive-ar` passthrough | **possible to try** | Binding behind a flag since Quest Browser 146. No multi-draw indirect on Adreno, so the vertex-pull path. Unknown: stereo at 72-90 Hz on a mobile chip with a dense model, and memory |
| Steam Frame standalone browser | `immersive-vr` | unknown | WebXR only in a beta (Nov 2026); WebGPU binding status not found. As a streaming display it is the first row |
| Galaxy XR (Android XR Chrome) | `immersive-vr` / `immersive-ar` | later | Binding experimental; same mobile-GPU questions as Quest |
| Android phone (ARCore Chrome) | `immersive-ar` | later | Phone GPU; vertex-pull path |
| iOS Safari | — | no | No AR-mode WebXR |

The AR alignment story still lands on the hard rows, but they are no longer
blocked by the browser or by a missing draw path — they are blocked by an
unmeasured frame budget. **VR-first on a PC stays the plan**: it builds all
the XR plumbing. A standalone Quest 3 test then costs little (same code,
flags on the headset) and answers whether untethered is realistic.

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
3. **AR / untethered (separate plan).** Starts with a measurement: the
   phase-1 build in the Quest 3 browser (flags on), on the vertex-pull path —
   frame time on a small and on the dense model. The fallback draw path this
   plan once listed as the big cost already exists; the cost is now making
   stereo fast enough on a mobile chip (resolution scale, foveation, a
   lighter preset, maybe a model-size limit). Then `immersive-ar`
   passthrough, phone profiling, alignment persistence. Do not start without
   a director-approved plan.

## Risks / open questions

- **Flag/rollout drift**: no browser we can use ships `XRGPUBinding`
  unflagged (2026-11), and the way to turn it on has changed between
  versions. On a PC, multi-draw indirect must be on at the same time; a
  headset browser runs without it on the vertex-pull path.
- **Windows only**: Chrome has no official WebXR on Linux, so the spike
  cannot run on a Linux workstation.
- **Standalone frame budget**: stereo at 72-90 Hz on a mobile chip over the
  vertex-pull path (a fixed vertex count per meshlet) — unmeasured; this
  decides the whole untethered / AR story.
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
- three.js reference impl (r185): `src/renderers/common/XRManager.js`,
  examples `webgpu_xr_cubes.html`, `webgpu_xr_rollercoaster.html`
- Status sources, 2026-11-17: three.js issue #32858; immersive-web
  `WebXR-WebGPU-Binding` issue #14 (Quest, closed completed 2026-05-05);
  `Mandalorian007/quest-webgpu-webxr-experiment` (Quest 3, browser 154,
  flags and restart); `davtamay/Godot_WebGPU` landscape watch (Chromium
  source check); web3dsurvey.com (multi-draw indirect per platform);
  `mrxz/webxr-linux` (Linux patch)
