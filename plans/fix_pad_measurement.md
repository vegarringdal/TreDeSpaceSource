# fix_pad_measurement — tablet loupe places the measure point behind the crosshair

> **Status:** ROOT CAUSE FOUND AND FIXED 2026-09-17 (§10): the tablet's
> Adreno driver miscompiles the snap shader's dequantization when the info
> record is a struct parameter; the shader now reads raw words and passes
> scalars. VERIFIED by the director on the tablet 2026-09-17 ("looks like
> its working now"). Earlier theories: §3 (per-request resolvers)
> implemented and reverted; §7 (encode-time view) kept — correct, but not
> this bug. DONE.
> **Last updated:** 2026-09-17 · **Plan version:** 4.1
> **Related:** memory note `touch-measure-model` (earlier, different cause:
> snap radii vs pixel ratio — NOT this one).
> File/line references were checked against the repo on 2026-09-17 (branch
> `measure02`) — **re-verify at implementation time.**

## 1. Symptom

On a tablet, the press-and-hold loupe (`src/components/panels/viewport/measureAim.ts`)
raises a crosshair that is meant to be the placement point. The placed
measurement point does not land in the crosshair; it lands a little behind
where the crosshair was moving.

Director's observations (2026-09-17): it works on the PC in touch mode, with
MSAA off, with edited pixel ratios and with the pixel ratio forced to 1. Only
the pad shows it. So the pixel ratio is not the differentiator; the pad's
slower GPU is (see "Why the PC does not show it" below).

Second symptom (director, same day): on the pad the point sometimes does not
hit a surface at all — it floats in the air where there is nothing. That is
the depth-fallback branch of the same design, see §2 "Second branch".

## 2. Root cause

The renderer keeps ONE resolver slot per probe kind and resolves whichever
promise currently sits in it, regardless of which pick produced the result.

- `probeMeasureAsync` (`src/lib/render/renderer.ts` ~L620) resolves the previous
  promise with null, stores the new resolver in `this.measureResolve`, and
  overwrites `this.pendingPick`.
- `encodeDepthPick` (~L3283) dequeues the pick and sets `pickInFlight`.
- `resolvePick` (~L2048) clears `pickInFlight` right after the depth readback,
  then awaits `raycastMeasure` (two more GPU round trips), and finally calls
  `this.measureResolve?.(m)` — the slot, not the requester.

Sequence on the tablet:

1. While aiming, `refresh()` in measureAim runs a hover probe at crosshair
   position A and sets `busy`; the finger keeps dragging the crosshair (no new
   probes are issued while busy).
2. The finger lifts at position B. `placeAndLeave()` calls `probe(B)`: the
   hover promise is resolved null (harmless, the `.then` sees `aimId === -1`),
   the resolver slot now holds the PLACEMENT promise, `pendingPick = B`.
3. The probe for A is still in flight. When its raycast finishes,
   `measureDone()` resolves the slot — i.e. the placement promise — with the
   hit at A. `measurementsActions.addPoint` stores A.
4. The pick for B is encoded on a later frame, finds the slot null, and its
   result is dropped.

So the point lands where the crosshair was when the last hover probe STARTED.
On a tablet that is several frames of finger travel behind the lift point.
With a mouse the last hover position and the click position coincide, so the
same race is invisible on desktop. `probeWorldAsync` / `this.probeResolve`
has the identical slot design (label placement, label reposition,
move-to-click).

### Why the PC does not show it

The displacement equals the finger travel during ONE probe. A probe is: wait
for the next rendered frame (the depth pick is only encoded inside `frame()`),
depth readback (`mapAsync`), then `raycastMeasure` = two `castSnapRay` calls,
each a Möller–Trumbore compute over EVERY meshlet of EVERY model plus its own
`mapAsync`. On a desktop GPU that is ~20–30 ms, so the stale position is at
most a few px behind, and zero once the finger pauses. On a tablet GPU with a
heavy scene it is easily 150–400 ms: the frame itself is slow and the raycast
over the whole scene is much slower, so the last hover probe is still in
flight when the finger lifts and the placement takes its position. Pixel
ratio, MSAA and touch emulation on the PC all keep the PC's probe latency,
which is why none of them reproduce it. (Earlier note that DevTools touch
emulation reproduces it was wrong in practice: the race exists there, its
magnitude does not.)

### Second branch: the placement skips the raycast and takes the depth fallback

`resolvePick` clears `pickInFlight` right after the depth readback, BEFORE
`raycastMeasure` runs, so the next pick is encoded on the very next frame
while the previous raycast is still on the GPU. `raycastMeasure` starts with
`if (this.snapInFlight || ...) return null` (~L2118), and `resolvePick` then
substitutes `{ point: depth-unprojected, kind: 'face' }` (~L2095). On the pad
the raycast spans several frames, so the placement pick (issued at lift while
the last hover probe's raycast is still running) usually ends up on this
branch — and because its depth readback is faster than the hover probe's
raycast, it is often the one that resolves the placement promise.

That fallback point is different in kind from a raycast hit:

- It is never snapped (no corner/edge), so it cannot land on the vertex the
  crosshair is over.
- It reads one depth texel that was rendered with the TAA jitter (`vp` gets
  `jx/jy` at ~L2738; `lastVP` is un-jittered), so at a silhouette — a pipe
  edge, a corner, exactly where one aims a measurement — the texel can belong
  to the surface BEHIND or to the background. Behind → the point sits on the
  far surface and looks like it floats in the air in front of nothing when
  the view is orbited. Background → `depth <= BACKDROP_DEPTH_MAX` →
  `measureDone(null)` → nothing is placed ("does not even hit a surface").
- It is unprojected through an `invert4` of the f32 `lastVP`, so on a scene
  far from the origin it carries extra error along the sight line.

On the PC the raycast finishes within the next frame, `snapInFlight` is
already false when the following pick reaches it, and the exact mesh hit is
used. Fix item 4 in §3 (keep `pickInFlight` set until the raycast is done)
closes this branch; items 1–3 close the stale-result branch.

### Ruled out

- Pixel ratio: every CSS→render conversion goes through the renderer's own
  `dpr` getter (canvas sizing in `frame()`, `queuePick`, `screenRay`,
  `worldToPixel`); nothing reads `window.devicePixelRatio` directly outside
  the Settings labels.
- Overlay placement: the aim SVG and `MeasureOverlay` both sit at `inset:0`
  in the host, the canvas is 100% of the host, no padding/border; overlays
  project with the host rect and the un-jittered absolute `lastVP`.
- No coarse-pointer CSS scales or offsets the panel (`dockable.css` only
  widens splitter/close hit areas).
- `lock` defaults to `'none'` and `perp` to false; neither persists.
- Camera: `claimPointer` removes the touch from the gesture set and freezes
  all touch gestures while anything is claimed; release moves nothing.

### Secondary, by-design effects (leave alone)

- Corner/edge snap of up to `cornerPx`/`edgePx` = 12/8 RENDER px, which at
  pixelRatio 1 is 12/8 CSS px on a tablet (6/4 on a dpr-2 desktop). Do not
  widen or narrow — see memory `touch-measure-model`. The hover glyph shows
  the snap target before lift.
- The finger's small roll on lift-off moves the crosshair a few px right
  before `pointerup`. Could be softened later by ignoring moves in the last
  ~80 ms before lift; not part of this fix.

## 3. Fix — tie each probe result to its own request

All in `src/lib/render/renderer.ts`:

1. Extend `PendingPick` (~L102) with the request's own callbacks and config:
   `resolveMeasure?: (m: MeasureProbe | null) => void`,
   `resolveWorld?: (p: [number, number, number] | null) => void`,
   `snap?: MeasureSnap`. Remove the `measureResolve`, `probeResolve` and
   `measureSnap` fields.
2. `probeMeasureAsync` / `probeWorldAsync` build the pick with their resolver
   and hand it to `queuePick`. `queuePick` resolves the resolvers of a pick
   still waiting in `pendingPick` (superseded, never encoded) with null before
   replacing it. A pick already dequeued keeps its own resolver and resolves
   itself when it finishes.
3. `resolvePick(p)` calls `p.resolveMeasure?.(m)` / `p.resolveWorld?.(pt)`
   instead of the slots, and passes `p.snap` into `raycastMeasure` (make
   `snap` a parameter of `raycastMeasure`, drop `this.measureSnap`).
4. Keep `pickInFlight` true until `resolvePick` has fully finished: move the
   reset into a `finally` at the end of `resolvePick` (replacing the
   `.catch(() => (this.pickInFlight = false))` at ~L3304). This is the fix
   for the floating / not-placed symptom: it guarantees every measure pick
   reaches the mesh raycast instead of the `snapInFlight` early return and
   the jitter-sensitive, unsnapped depth fallback. The fallback stays only
   for a genuine raycast miss or failure. Since `queuePick` keeps just the
   newest pick, the extra wait costs one probe of latency, nothing more.

Optional, same family, `measureAim.ts` `refresh()`: when a probe finishes and
the crosshair has moved since it was issued, re-probe immediately instead of
waiting for the next `pointermove`, so the preview glyph catches up when the
finger pauses.

No API, EVENTS.md or widget-gallery changes. CHANGELOG entry under a fresh
heading (re-read `package.json` and the date at write time). After the
director confirms on the tablet, update memory `touch-measure-model` with
this second cause.

## 4. Verification

### Confirming the cause on the pad without any code change

- Drag the crosshair, then hold the finger completely still for a full
  second before lifting → the point should land in the crosshair (the stale
  probe has finished, the placement probe is the only one).
- Drag and lift immediately, or lift mid-drag → the point lands behind the
  crosshair, along the path the crosshair took.
- While dragging on the pad, the snap glyph / rubber band should visibly lag
  behind the crosshair; the point lands where the glyph was, not where the
  crosshair was.

- The floating / nothing-placed cases should only happen when lifting soon
  after a move (overlapping probes). After a still second they should not
  occur; if they still do, the cause is elsewhere.

If the first case is also wrong, the cause is something else and this plan
needs revisiting.

### After the fix

- `npm run build`, `npm run test` (`tests/measureSeam.test.ts` still passes;
  the renderer itself is not unit-testable).
- PC repro needs a slow probe: load the heaviest model available (raycast
  cost scales with meshlet count), DevTools device mode, arm Line,
  long-press, drag the crosshair fast and lift mid-drag. Before the fix the
  point lands behind the crosshair; after, in it.
- Director confirms on the tablet — treat as unverified until then.
- Desktop regressions: hover glyph, click placement, label placement and
  reposition, "move selection to click" (world-probe path) still resolve; a
  fast mouse move followed by a click places at the click.

## 5. Tasks

- [ ] `PendingPick` carries resolvers + snap; slots removed
- [ ] `queuePick` nulls a superseded, never-encoded pick
- [ ] `resolvePick` resolves the pick's own callbacks; `pickInFlight` reset in `finally`
- [ ] `raycastMeasure(px, py, snap)` parameter
- [ ] (optional) measureAim `refresh()` trailing re-probe
- [ ] CHANGELOG entry
- [ ] Tablet confirmation → update memory note

## 6. Frame pacing — where the lag on a slow GPU comes from

Checked 2026-09-17 on the director's question "do we call frame() before the
last one finished / run frames ahead?".

- **Yes, always, by design of the loop.** `tick` in `viewport.ts` (~L897)
  re-arms `requestAnimationFrame` and calls `renderer.frame(canvas)`
  synchronously; `frame()` encodes, calls `queue.submit` (~L3251) and
  returns. There is no `onSubmittedWorkDone`, no fence and no
  frames-in-flight counter anywhere in `src/`. The FPS limiter (~L906) is
  CPU-clock pacing only and knows nothing about GPU completion.
- **What caps the pile-up is the browser, not us.** Chrome stops issuing
  animation frames once the compositor holds about two unpresented canvas
  frames, so the GPU queue runs roughly 2–3 frames deep. On a GPU that needs
  50–100 ms per frame that is 100–300 ms of input-to-photon lag with nothing
  in our code to shorten it.
- **Every readback queues behind those frames.** `mapAsync` resolves in
  submission order, so the depth pick, the cap-budget read (every culled
  frame, ~L3222), the stats read, the item pick and the two `castSnapRay`
  submits of a measure probe each wait for all frames already queued. That
  is the multiplier behind the §2 probe latency: a probe is depth pick +
  two casts, each paying the queue wait plus its own full-scene compute.
- **Held frames keep probing cheap only when post is on.** A pending pick
  keeps the loop out of idle (~L2666); with `usePost` (fastAA / edges / MSAA
  / AO) the frame becomes a cheap `hold` re-present (~L2688), without it
  every tick during aim renders the full scene and the probe competes with
  it.
- Other post-stop work that keeps a weak GPU busy: the two-pass settle until
  pass 2 reports zero new meshlets (or the ceiling), then TAA/AO
  accumulation for `aaMax` frames.

Possible follow-up, NOT part of this fix: an explicit in-flight cap. Keep the
promise from `device.queue.onSubmittedWorkDone()` per submit and skip the
tick while `inFlight >= MAX_IN_FLIGHT` (1 = lowest latency, no CPU/GPU
overlap; 2 = the usual compromise). Cost: a few percent of throughput on
fast GPUs; gain: bounded lag on slow ones and probes that resolve a queue
sooner. Also worth a Stats row so the depth can be seen rather than guessed.
Measure first: Stats → GPU timings (timestamp-query, may be unavailable on
Android) against the frame interval; GPU ms above the interval means the
queue, not the CPU, is the lag.

## 7. The real cause: picks resolved through a later camera (2026-09-17)

Found after §3 was reverted, from the director's clue that SELECTION at the
same tap is right while the measure point is not. Selection reads an id
texel; measuring reads a depth texel and then does geometry with a matrix.

- `resolvePick` unprojected the depth texel through `this.lastVP` **at
  resolve time** — after the readback's `mapAsync`, one or more frames after
  the pick was encoded. `raycastMeasure` built its sight line from `lastVP`
  later still (after the readback, before the casts), and `worldToPixel` for
  the snap radii used it again after both casts.
- `camera.update()` eases azimuth / elevation / distance toward their targets
  with `s = 1 - exp(-10 dt)` and **clamps dt to 33 ms** (native clamp). The
  tail down to the 1e-5 settle threshold is ~35 frames: ~0.5 s at 60 fps, but
  3–4 s of wall-clock at 10 fps because each slow frame only advances the
  ease by 33 ms. On the pad every tap within seconds of the last swipe — and
  every loupe probe, since the 450 ms hold does not outlast the tail — was
  resolved with a matrix that differed from the one its depth was rendered
  with.
- Consequences: the unprojected point leaves the surface (the "floating"
  point), and the ray through the later camera hits a different spot (the
  "not where I tapped" point). The frame-pacing change of the same day did
  not cause this; it made the frames fewer, not the tail shorter.

**Fix:** `PickView` — the stable view-projection and target size captured in
`encodeDepthPick`, carried with the pick, and used for the unprojection, the
sight line (`rayThroughPixel`) and the snap-radius projection. `screenRay`
(ClipGizmo) keeps using the current view through the same helper. The
unprojection now accumulates in f64 (it was `Float32Array`).

**Not changed, for the director to decide:** the 33 ms dt clamp. On a slow
GPU it makes every eased camera motion (and WASD travel) run at a fraction of
real time and keeps the renderer re-rendering through the whole tail —
part of "it keeps rendering after I stop". Raising the clamp to ~100 ms
would keep the protection against a stalled tab while letting a 10 fps
device settle in wall-clock time.

**Verify on the pad:** orbit, then tap immediately — before the fix the point
is off, after it lands on the tapped spot. Tap after standing still for 5 s
— right both before and after. Loupe: hold, drag, lift — lands in the
crosshair even right after a swipe.

## 8. Measure-probe trace (2026-09-17) — get the numbers from the pad

Settings → Stats → "Verbose trace" (hotkey `stats.trace`), open the Console
panel, arm a measure tool, tap once. Lines, in order:

- `measure tap: css=(x,y) client=(x,y) target=CANVAS pointer=touch
  canvasRect=(l,t wxh) hostRect=(l,t wxh) canvas=WxH css=WxH
  devicePixelRatio=… visualViewport=scale @(x,y)` — the input. `css` must
  equal `client − canvasRect.left/top`; `canvasRect` and `hostRect` must
  coincide; `canvas` should be `css × pixel ratio`; `visualViewport` scale
  must be 1 (pinch-zoomed page otherwise).
- `pick#N encode measure px=(x,y) target=WxH dpr=… msaa=… cull=… models=…
  gpuError=…` — the device pixel the renderer reads; `px ≈ css × dpr`.
- `pick#N depth=… +ms` then `pick#N unproject=(x,y,z)` — the depth texel and
  the point on the surface under it (or `background`).
- `pick#N ray origin dir`, `cast1 hit t=… item=… uv=… A/B/C` or `miss`,
  `classify kind point snap=…`, `cast2 …`, `seam …` — the mesh raycast.
- `pick#N result kind point=… Δdepth=…m reproj@encode=(px,py) Δ…px
  reproj@now=(px,py) Δ…px total=…ms gpuError=…` — the answer. `Δdepth` is
  the distance between the raycast point and the depth point (same surface:
  small). `reproj@encode Δ` is how far from the tapped pixel the answer
  projects in the frame it was picked in — must be within the snap radius.
  `reproj@now Δ` is the same through the current camera: large only if the
  camera moved since.
- `measure tap: kind point=… drawAt=(x,y) Δ…px from input` — the CSS pixel
  MeasureOverlay draws the marker at, from the host rect and the current
  view. Small Δ with a marker visibly elsewhere means the overlay's
  placement (CSS), not the pick.

The first line where a number is wrong names the stage. Selection uses the
same `css` / `px`, so with a correct input line the fault is between
`encode` and `drawAt`.

## 9. What the pad's trace showed (2026-09-17, evening)

Every one of 42 measure raycasts hit the same triangle: A=(99.8, 277.35,
24.0), B=(6540493, 277.35, 65436.5), C=(99.8, 277.35, 65436.5) — a plane at
y = 277.35, 6.5 million metres wide, about 10 m in front of the camera. The
depth texel under the same pixel was 14–21 m further along the ray, and the
result re-projected onto the tapped pixel exactly. So the point is on the
sight line but at the wrong depth: it floats in the air. The depth pick, the
item pick and the bounds all agree with the data.

The cooked data does not contain that triangle: the STRU sample converted
and cooked locally (`rvm` CLI → `cookGlb` → `parseModel`, and the same
through `coarsenTdp`) has 0 of 9144 full / 4214 coarse meshlets with an
extent over 1 km. The phantom's `aabb_scale` = (99.8, ?, 0.998) is not in
any record. Conclusion: the snap compute shader (`shaders/snap.ts`) reads
one of its buffers wrongly on the tablet's Adreno driver — the vertex-pull
render shader decodes the same buffers with the same formulas and draws
correctly on the same device.

Next: the shader now reports what the winning invocation read
(meshlet, triangle, local indices, raw vertex words, `aabb_scale` bits) and
the trace prints it next to a CPU readback of the same GPU buffers
(`traceCastReads`). The column that disagrees names the misread; the fix
then restructures that read (raw word reads instead of the `vec3f` struct,
explicit counts instead of `arrayLength`, no `select`) or, failing that,
rejects triangles outside the meshlet's bounding sphere.

## 10. Root cause — Adreno miscompiles the struct-parameter dequantization

The read cross-check (§9's next step) on the pad, one representative pair:

```
gpu read:  idx=(0,1,2) scale=(0.00007829, 0.000002289, 0.000008850) rawv C=0000ffff/00000000
           → GPU C = (6554255.5, 286.675, 24.410)
cpu read:  idx=(0,1,2) scale=(0.00007829, 0.000002289, 0.000008850) q_C=(65535,0,0)
           min=(100.010, 286.675, 24.410) → CPU C = (105.141, 286.675, 24.410)
```

Every input the shader read matched the CPU readback — local indices, raw
vertex words, and the AABB scale when stored component-wise with `bitcast`.
The dequantized vertex was still `min + q * min`: 100.01 + 65535 × 100.01 =
6554255, and for A's z axis 24.41 + 1695 × 24.41 = 41399. So the driver
substitutes the struct's first `vec3f` member (`aabb_min`) for its second
(`aabb_scale`) inside `vert_world`, which took the whole `MeshletInfo`
struct as a parameter. `skip_item` took the same struct by value and read
`info.item` from it, which is why the seam cast's exclusion never matched
(cast2 always re-hit cast1's item). The vertex-pull render shader evaluates
the same expression on the loaded struct directly, with no struct parameter,
and renders correctly on the same device — that is why only measuring broke.

**Fix (`shaders/snap.ts`, 2026-09-17):** records are read as raw `u32` words
(`geo_*`, `info_*` helpers, like cull.ts) into plain `vec3f` / scalar locals;
every helper takes scalars and vectors, never a struct; and a bounding-sphere
sanity net (`outside_sphere`, radius × 1.25 + 5 cm) drops any triangle whose
decoded vertex lies outside its meshlet — a real vertex cannot, so only a
misread lands there. The read diagnostics (§8) stay in the result words.

**Rule for every WGSL file in this project:** do not pass structs with
`vec3` members by value to functions, and prefer raw-word reads for records
that mix `vec3f` and `u32`. The cull shader already does this; the scene
shaders use the struct only on the loaded value.

**Verify on the pad:** trace on, one tap: `cast1` must report a triangle
whose vertices are within centimetres of the `unproject` point (Δdepth
small), the `gpu read`/`cpu read` A/B/C must agree, and `cast2` must report
a different item than `cast1` or a miss. The loupe crosshair and the placed
point should coincide.
