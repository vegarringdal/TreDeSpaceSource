# fix_pad_measurement — tablet loupe places the measure point behind the crosshair

> **Status:** PLANNED — cause confirmed by reading the code, fix not started
> (director: no edits for now).
> **Last updated:** 2026-09-17 · **Plan version:** 1.0
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
