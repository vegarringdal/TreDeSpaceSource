# VRAM_V2 — residency v2: fewer swaps, less GPU while optimizing (APPROVED, NOT STARTED)

> **Status: APPROVED 2026-09-03, NOT STARTED.** The director wants all three
> phases below, but another fix comes first — do **not** start building until
> the director says so. File and line references were accurate when written
> (2026-09-03); **re-verify at implementation time.**
>
> **Decisions locked (director, 2026-09-03):**
> - Burst policy: **one TAA/AO re-convergence per commit batch**; quiet swaps
>   never restart accumulation. "Hold accumulation until the burst ends" is
>   NOT the default — it becomes an opt-in setting (1.2b, director suggestion
>   the same day).
> - Budget semantics: **total tracked VRAM stays the ceiling** (render targets
>   keep counting); Stats shows the models/targets split; a hi-res screenshot
>   pauses swaps.
> - Pacing `maxInFlight`: **raise to relaxed 2 / normal 4 / fast 6**.
>
> **How to resume:** land 1.0 (measurement line) alone, capture a 3-run
> baseline on that code, commit the numbers into DESIGN.md, then 1.1 → 1.5,
> re-measure, then Phase 2, re-measure, then Phase 3. Every step gets its own
> CHANGELOG line and its own measurement.

## Context

The VRAM budget (Settings → Rendering, `maxVramMb`, v1 since 2026-08; DESIGN.md
"VRAM budget & residency") keeps tracked GPU memory under a ceiling by holding
far zones coarse and promoting near zones to full while the camera rests. The
director asked three things: can it be improved, can it be smarter, can it use
less GPU while "optimizing". All three: yes.

**What the measured run hides.** DESIGN.md records a convergence of 32.7 s /
176 swaps / 261 MB with only 1.69 s of decode ("97 % idle") and concludes
that planner policy, not decode, is the wall. True — but the idle time is not
GPU-idle. Every swap calls `removeModels` and `reviveModel`
(`src/lib/render/renderer.ts` ~:1497 and ~:1263), each of which sets
`lastKey = ''`, and the states re-push bumps `stateVersion` (`writeItemStates`
~:1306). A changed render key restarts TAA and AO accumulation (`accumIdx = 0`
~:1996). With `aaSamples` 32 and `fpsLimit` 30 one reset is up to ~32
full-scene frames (~1 s of cull 1 / scene 1 / HZB / cull 2 / scene 2 / AO /
post). Swaps chain every 10–250 ms (`nextEvalAt = 0` in `runSwap`), so the
renderer never converges during a burst: the "idle" 32 s is roughly **1000
full-scene frames for a camera that never moved**; fast pacing ≈ 3400.

Other findings this plan fixes (all in `src/state/viewer/residency.ts`,
`residency.plan.ts`, `renderer.ts`, `src/lib/modeldb/apiModels.ts`):

- The states re-push is `applyStateUpdates(await db.statesFor([slot]))`
  AFTER `reviveModel` (`swapVariant` ~:370, also `promoteMixed`, `packCoarse`).
  The `await` is a task boundary: a frame can render the revived slot with a
  zero-initialised item-state buffer (hidden items visible, transforms
  identity, no colour overrides), and the states write then resets
  accumulation a second time.
- `visBuf` is seeded all-1 (`buildModelResources` ~:1083): the first frame
  after every revive draws every in-frustum meshlet of the zone in cull
  pass 1 before HiZ prunes it.
- `refreshVisibility` (~:303-349) is a flat 2 s, O(all items) worker call
  (`apiVisibility.ts`) on the same modeldb worker that parses the swaps, even
  while the camera is idle and nothing it measures can change.
- `priority()` (`residency.plan.ts` ~:162) is pure inverse-square distance to
  the nearest visible item. DESIGN.md says "≈ projected screen coverage"; zone
  size is ignored, so a 50 m zone and a 5 m zone at the same distance tie.
- One greedy action per 250 ms eval, plus dwell / cooldown / rebalance
  sequencing, is what produces a 176-swap run. A planner that computes the
  whole target residency once per rest would swap each zone at most once.
- `used` = `vramBuffers + vramTextures` — all tracked VRAM, including canvas
  targets, the lazily created pick and outline targets, and the transient 4K
  reallocation in `snapshotHiRes` (~:474-486). A screenshot can evict geometry.
- `drawnPerModel` is only written when `cullActive`, never in
  `cullMode === 'full'`, so in that mode resident zones read drawn = 0 forever
  and never promote (the CPU fallback in `refreshSeen` only covers empty or
  deficient packs).
- `estBytes` in `repackModelMixed` (`apiModels.ts` ~:269-285) omits the
  4 B/vertex normal stream, so mixed packs overshoot their target on
  smooth-shaded models.
- `coarseBroken` is sticky for the session: one transient OPFS/worker hiccup
  and the zone never uses its coarse file again.

**Out of scope, permanently** (rejected with evidence in DESIGN.md): meshlet
LOD + streaming, instancing, cross-item meshlets, format changes (v9-RANGES
streaming phases were measured and dropped). Keep the exclusive-residency
invariant: for any zone, coarse or full geometry is on the GPU, never both.

## Phase 1 — measurement, GPU wins, fixes (no planner change)

### 1.0 Measurement line (do first, then baseline)

- `renderer.ts`: public monotonic counters `frameCounter` (next to
  `this.frames++`), `sceneFrames` (incremented when `!hold`), `accumResets`
  (at the `accumIdx = 0` site), `gpuMsTotal` (sum of raw per-frame GPU ms;
  `gpuTimings.ts` `resolve` gains `lastFrameMs` — the unsmoothed sum of sane
  deltas for the encoded slots).
- `residency.ts`: snapshot those counters at burst start (`runSwap`) and
  append to the SETTLED line: `· N frames (M scene, K accum resets) · gpu Σ
  X s · C commits (Q quiet)`. Add a `COMMIT n=… quiet=… Δ±MB` event per flush
  (from 1.1). Same numbers in `debugDump`'s header.
- Expected effect: none on behaviour; it makes every later item measurable.

### 1.1 Batched, synchronous commits (biggest Phase 1 win)

- Split each swap into an async **prepare** (OPFS read, worker repack, AND
  `db.statesFor([slot])`) and a synchronous **commit** (`removeModels →
  reviveModel → writeItemStates`). New `src/state/viewer/residency.commit.ts`
  holds `ReadyCommit { slot, readyT, quiet, deltaBytesEst, apply(r) }`.
  `swapVariant`, `promoteMixed`, `packCoarse`, `demote` become
  `prepareX(): Promise<ReadyCommit>`; record mutations (`variant`,
  `packedEye`, `bytesCoarse = max(...)`, `bytesFull` re-measure) move into
  `apply`. The unload path returns a commit with no parse.
- `runSwap`: a successful prepare pushes to a `ready` queue; the slot stays in
  `inFlight` until commit (the planner must not touch it); `nextEvalAt = 0`
  moves to commit time. Failure handling unchanged.
- `tick`: right after the pause gate, `flushReady()` when nothing else is
  parsing, or `ready.length >= maxInFlight`, or the oldest entry waited more
  than `READY_MAX_WAIT_MS` (300). Apply order inside a flush: unloads, then
  to-coarse demotes, then promotes (free before allocate, never overshoot).
  Guard `bySlot.has(slot)` at apply. One flush = one accumulation reset for N
  swaps, and the zero-states flash disappears because states are in hand
  before the slot dies. A flush never runs inside `renderer.frame` (tick runs
  after it, `viewport.ts`).
- Multi-action per tick: after `applyAction`, re-run `planResidency` on a
  projected snapshot (the acted zone marked `inFlight: true`, `used +=
  deltaBytesEst` for demotes) up to `maxInFlight` times. The planner already
  skips in-flight zones and counts their `bytesFull` as `pending`, so the
  projection is only those two fields. Without this, batches rarely form.
- `PACING.maxInFlight`: relaxed 1→2, normal 2→4, fast 4→6 (decided). The
  worker is single-threaded, so this groups commits rather than speeding
  parses; held packs stay on the main thread for at most ~300 ms.

### 1.2 Quiet swaps (no reset when no pixel can change)

- `renderer.ts`: `removeModels(indices, { quiet })` skips `lastKey = ''`;
  `reviveModel(slot, packed, { edges, quiet })` skips `lastKey` and
  `stateVersion++`; `writeItemStates(model, states, quiet)`;
  `applyStateUpdates(updates, quiet)` in `viewer.actions.ts`. Expose the last
  count-readback time (`lastCountReadT`).
- Residency decides `quiet` at prepare time for **demote/unload only**:
  `cullMode !== 'full' && !freezeCull && drawnPerModel[slot] === 0 &&
  !deficient && countsFresh`, where fresh = the last readback happened after
  the camera went idle and after the last loud commit. Promotes are never
  quiet (they are only issued for seen zones). A flush with any loud commit is
  loud.
- Why pixel-safe: drawn = 0 means every meshlet was frustum-, cone-, clip- or
  HZB-culled from this viewpoint; replacing or removing that geometry cannot
  change the image (up to the coarse simplification error of fully occluded
  geometry, which the next real frame shows anyway). The revived slot's
  zeroed record buffers replay as no-op draws on the hold path.

### 1.2b Opt-in: pause AO / TAA while optimizing (director suggestion, 2026-09-03)

Today nothing lowers quality during a burst — every loud commit restarts the
full 32-sample accumulation and the AO history, and the renderer then spends
~32 frames converging a picture the next commit will throw away. The default
policy stays "one re-convergence per batch" (decision above); this is an
**opt-in setting on top of it** for GPUs where even a handful of
re-convergences is the expensive part — which is exactly the hardware a
budget gets set on (at 10 fps one convergence is ~3 s).

- Setting `vramHoldAccum: boolean` in `viewer.state.ts` (persisted), a
  checkbox in `VramBudgetSection.tsx` ("Pause AO / TAA while optimizing")
  with tooltip + hotkey binding (every checkbox needs both). Default: the
  director's call at implementation time; recommended ON, since the budget
  is only ever enabled on weak GPUs.
- Renderer: public `holdAccumulation: boolean`. While true, `frame()` treats
  every frame as sample 0 — `taaConverged` after the first sample (no history
  blend, the existing `accumIdx === 0` path), AO pass and composite skipped
  (`aoStrength 0` in the post params; one-sample VBAO is speckle, worse than
  none). The flag is NOT part of the render key. When it flips back to false
  the renderer sets `lastKey = ''` once, so exactly one full convergence
  follows the burst.
- Residency drives it: `r.holdAccumulation = s.vramHoldAccum && burstActive`,
  where `burstActive = inFlight.size > 0 || ready.length > 0 || (plan has
  remaining steps)`. Cleared on settled, on camera motion, and by
  `pause()` (so a hi-res screenshot never captures a held frame). The
  activity chip already says "optimizing", so the user knows why edges are
  aliased and AO is off for those seconds.
- Cost during a burst: one single-sample frame per loud batch, then one
  convergence at the end. Combined with 1.1 / 1.2 this makes "optimizing"
  nearly free on the GPU. Measurement: add `heldFrames` to the counters of
  1.0 so the SETTLED line shows how many frames rendered at one sample.
- Visual trade: aliased edges and no AO for the burst's duration (a few
  seconds); the switch back is a single visible "sharpen". Acceptable only as
  an opt-in, hence the setting.

### 1.3 Seed `visBuf` with 0

- `renderer.ts` `buildModelResources`: drop the `.fill(1)`. Verified against
  `src/lib/render/shaders/cull.ts`: pass 1 returns on `vis[i] == 0`; pass 2
  tests all meshlets (frustum + cone + HZB), emits `visible && vis[i] == 0`,
  then persists `vis`. Same-frame picture identical; the first-frame draw
  count is ≤ today's because pass 2 is HiZ-culled by the other zones' depth.
  Applies to fresh uploads too. The pinned shader snapshot test is unaffected.

### 1.4 Trigger-based `refreshVisibility`

- Refresh on: eye moved > 2 m or forward dot < 0.995 since the last refresh;
  `selectionState.stateVersion` changed by something other than residency's
  own push (capture the version right after each commit); `register`; a slow
  safety timer (`VIS_REFRESH_MS` 2000 → 10000). Never while `inFlight > 0`
  unless a trigger fired. Clip changes need no trigger (`visibleBounds` is
  frustum/clip independent). An idle camera during a burst issues zero worker
  calls.

### 1.5 Fixes

- **cull 'full' blind spot** (`refreshSeen`): when `cullMode === 'full' ||
  freezeCull`, every zone takes the CPU frustum + clip branch, not only empty
  or deficient ones. Gate `quiet` (1.2) on the same predicate.
- **`estBytes` normals**: extract `estimateItemFullBytes(parsed, itemCount,
  withNormals)` and `hasAuthoredNormals(full, coarse)` into
  `src/lib/model/pack.ts` (the same predicate `pack.ts` already uses when it
  decides whether to emit a normal stream); add 4 B/vertex when true. Test in
  `tests/packMixed.test.ts` with and without normals.
- **`coarseBroken` retry**: replace the boolean with `coarseFails` +
  `coarseRetryAt`. `itemcount-mismatch` is permanent; anything else backs off
  exponentially from `FAIL_COOLDOWN_MS`, capped at 5 min, permanent after 3.
  `ZoneView.coarseBroken` stays a boolean computed from those, so no planner
  or test change.
- **Budget semantics** (decided: total stays the ceiling): wrap
  `snapshotHiRes` (`ribbonHome.actions.ts`) in `residency.pause()/resume()`;
  renderer gains `modelBytesTotal` (Σ live `m.bytes`); `statsRows.ts` shows
  `vram (tracked) X MB (models A + targets/other B)`; same split in
  `debugDump`. Info text in `VramBudgetSection.tsx`: render targets count
  against the budget (see Stats); a hi-res screenshot pauses swaps.

## Phase 2 — target-set planner (the swap-count win)

### 2.1 `planTargets` in `residency.plan.ts`

- Pure: `planTargets(input): { targets: ZoneTarget[], steps: PlanAction[],
  settled }`. Keep `planResidency(input)` as a wrapper returning the first
  step, so the projection loop from 1.1 and the existing tests keep working.
- Algorithm, reusing the existing predicates and constants:
  1. Budget off → every zone full; steps = `restore-full` per non-full zone.
  2. `overhead = max(0, used − Σ bytesNow)`; `modelBudget = budget − overhead`.
  3. Classify: dead (visibleFrac 0 → unloaded); clipped (→ coarse if usable,
     else unloaded; immediate, no dwell); offscreen (unseen >
     `PROACTIVE_GRACE_MS` or beyond `distM × DIST_EXIT_FACTOR` → coarse /
     unloaded); seen (the current candidacy gates); hold (seen recently but no
     streak, or in the distance dead band → keep level if it fits).
  4. Pins: `lastPromoteT` within `MIN_DWELL_MS` → cannot go down;
     `lastDemoteT` within dwell or `cooldownUntil` → cannot go up (counts as
     waiting); in-flight → held at its projected level.
  5. Floor pass ("existence beats sharpness"): seen zones ranked by
     `p × (has geometry ? COARSE_STRIP_RATIO : 1)` receive `bytesCoarse`
     while it fits `modelBudget × PROMOTE_HEADROOM`.
  6. Detail pass: seen zones ranked by `p × (resident ? pacing.margin : 1)` —
     the margin becomes a resident hysteresis bonus instead of a victim filter;
     `avail = headroom − accumulated + own floor bytes`, then the existing
     full/mixed decision verbatim (`comfortable || fullOnly || fullyInFrustum
     || noMixedAffordable` → full if it fits; else mixed at
     `mixedTarget(avail, budget)` if ≥ `mixedFloor`; else stay at floor).
  7. Hold zones keep their level if the remainder allows (ranked by p after
     the seen set), else demote.
  8. Over-budget fallback: if pinned targets alone exceed `modelBudget`, unpin
     ascending by p.
  9. Diff → steps: `refresh-coarse` for stale coarse zones; mixed re-pack
     only on the existing moved / turned / regrown triggers; then demotes
     (unloads first, then to-coarse, by bytes freed desc); then promotes
     (`promote-coarse` repairs first, then by rank). `settled = steps.length
     === 0 && !waiting`.
  10. Drop `park`, `STARVE_CAP`, `STARVE_PARK_MS`, `starveCount`: an
      unfittable zone simply receives mixed/coarse and the rest of the scene
      is still served, which is what the cap approximated.
- Executor (`residency.ts`): keep `{ steps, cursor }` as the current plan.
  On an idle eval with no valid plan → `planTargets(snapshot)`; log `PLAN n
  steps (d demotes, p promotes) · targets Σ X MB / model budget Y MB`. Issue
  steps in order while `inFlight < maxInFlight`; a promote waits until
  `usedNow + pendingPromoteBytes + step.bytes ≤ budget × PROMOTE_HEADROOM`
  (earlier demotes must have committed through the 1.1 flush). Invalidate on:
  camera not idle, VIS-CHANGE / CLIP-CHANGE, `maxVramMb` / cuts / dropHidden
  change, a swap failure, or completion. After completion re-plan once →
  expect empty → SETTLED. `cooldownMs` stays a per-zone pin at re-plan time;
  `evalMs` only paces re-plans.
- Why ping-pong cannot come back: the target set is a pure function of the
  snapshot, so unchanged inputs give an empty diff. The inputs the plan
  itself changes are `lastSeenT` / `drawnPerModel` (promoted zones become
  drawn, which only raises their rank), measured vs estimated bytes (one
  over-budget correction demotes the lowest rank, whose dwell then pins it),
  and 2.2's occlusion factor. Resident bonus (`margin` ≥ 1.5) + dwell +
  cooldown + trigger-only re-planning absorb all three.
- Tests (`tests/residency.plan.test.ts`, ~55 cases): most pass unchanged
  through the wrapper (budget off, promotion level and candidacy, demotion,
  settled vs waiting, clipping, mixed re-pack, hidden items). Rewrite: the
  park case → "an unfittable zone gets mixed/coarse and lower zones are still
  served"; "evicts the victim that frees the most bytes" → assert the target
  set; "serves only the top-priority needy zone" → the top zone's promote
  precedes every lower promote in `steps`; "migrates a hole outward" → the
  only unloaded seen zone is the farthest. Add: each zone appears at most
  once in `steps`; re-planning after applying the plan yields no steps
  (idempotence); demotes precede promotes; a ping-pong regression built from
  the v9 measurement (two zones on a 25 % priority edge at margin 1.25 →
  the second plan is empty). New `describe('target set')` block asserting
  `targets` for the floor and detail passes.
- Expected: swaps per rest ≤ zones whose level changes (the 176-swap run
  should drop to roughly 40–60 on that model), wall bounded by parse time
  (~2–4 s), and with 1.1 / 1.2 a handful of accumulation resets instead of
  hundreds.

### 2.2 Priority = projected coverage (+ optional occlusion factor)

- `ZoneView` gains `denseRadius` (half diagonal of `decisionBox(rec)`) and
  `drawnFrac` (`drawnPerModel[slot] / modelMeshletCount(slot)` when resident
  and counts usable, else −1).
- `priority = coverage × seenFactor [× occ]`, `coverage = (R / (R +
  nearestDist))²`: bounded to (0, 1], 1 when the camera is inside the dense
  box, monotonic in distance for fixed R, size-aware (a 50 m zone at 50 m
  ranks like a 5 m zone at 5 m). `nearestDist` stays the robust distance term
  the existing comment insists on.
- Outlier guard: `R` comes from the mean ± 2σ box and σ is not robust to one
  far item in a small zone. Add a second sigma-clipping pass in
  `apiVisibility.ts` (recompute mean/σ over items whose centre lies inside the
  first-pass box); extract the maths into a pure `denseBoxOf()` in
  `src/lib/modeldb/denseBox.ts` with a unit test using an outlier fixture.
  Coverage saturates at 1, so an inflated R can at most rank a zone as
  "fills the view", never blow up like the old box-distance term.
- Occlusion factor, shipped and measured separately: `occ = OCC_FLOOR + (1 −
  OCC_FLOOR) × min(1, drawnFrac / DRAWN_FRAC_REF)` with floor 0.25 and ref
  0.1 — for the partially occluded near zone (the fully hidden one is already
  handled by `lastSeenT × OFFSCREEN_FACTOR`). If the ping-pong regression
  cannot pass with it, drop it and keep coverage only.
- Tests: `zone()` fixture gets `denseRadius: 10, drawnFrac: -1`;
  distance-ordering cases still hold; re-derive distances in the three
  ratio-sensitive cases ("not clearly lower priority", "never strips a coarse
  zone of comparable priority", "will not take a fat victim too close in
  priority"). DESIGN.md's coverage claim becomes true.

## Phase 3 — optional: suggested budget hint (never auto-enabled)

- `src/lib/render/vramHint.ts`: pure `suggestVramBudgetMb({ vendor,
  architecture, maxBufferSize, deviceMemoryGb, isMobile }) → number | null`
  + `tests/vramHint.test.ts`. Heuristic, deliberately small: mobile →
  `min(1024, deviceMemoryGb × 256)`; integrated vendors (`intel`, `apple`,
  `arm`, `qualcomm`, `amd` with an integrated architecture string) →
  `deviceMemoryGb × 256` clamped to [1024, 4096]; discrete `nvidia` / `amd` →
  null (VRAM is unknowable from WebGPU; no suggestion beats a wrong one).
- `renderer.ts`: capture the hints next to `adapterInfo` (`adapter.info`,
  `adapter.limits.maxBufferSize`, `navigator.deviceMemory`,
  `isMobileDevice()` from `src/lib/render/device.ts`).
- `VramBudgetSection.tsx`: one row under Max VRAM, "Suggested for this GPU:
  N MB" + a small Use button, rendered only when non-null. `maxVramMb`
  default stays 0.

## Measurement protocol

1. Land 1.0 alone; capture a **baseline** (3 runs) on that code.
2. Fixed conditions: same model set, page reload (coarse-first load), budget
   512 MB, normal pacing, `aaSamples` 32, `fpsLimit` 30, GPU timings on. Do
   not touch the camera until SETTLED, then Copy event log.
3. Record per run: wall, swaps, MB, % busy, frames, scene frames, accum
   resets, gpu Σ s, commits, quiet commits, visibility-refresh count.
4. Scenario 2 (Phase 2): orbit 90° and stop; wait for SETTLED; count swaps
   and repeated slots (≤ 1 per zone). Scenario 3: hide half of a visible zone,
   unhide it; count refreshes and swaps.
5. Visual pass with the residency-boxes overlay: quiet demotes show no
   change; the vis = 0 seed gives an identical first frame (eyeball
   `drawn p1 / p2` in Stats).
6. Compare medians after each phase; update DESIGN.md's numbers each time.
   "Re-measure the % busy line before believing any of this has changed"
   still applies.

## Risks

- Quiet swaps on a stale draw count → a change without a re-render until the
  next key change. Guarded by count freshness, `deficient`, cullMode /
  freezeCull; never for promotes.
- Batching: commit order must free before allocate inside a flush; held
  packs ≤ 300 ms; `pause()` semantics (in-flight prepares still commit on
  resume) need a comment.
- Target planner: estimate-vs-measured bytes (coarse-first `bytesFull` is a
  file-ratio guess) can add one over-budget correction, bounded by dwell; a
  failed demote invalidates the plan rather than stalling a waiting promote.
- Coverage priority: big far zones now rank high and take mixed budget —
  intended, but eyeball it on the large site models.
- Snapshot pause: a screenshot mid-burst waits for in-flight commits (each
  loud commit resets accumulation, delaying the converged capture ~1 s).

## Docs to update when phases land

- DESIGN.md "VRAM budget & residency": manager (batched commits, quiet swaps,
  trigger-based visibility), planner (target set; the coverage claim made
  true), accepted costs (pass-2 discovery instead of the over-draw frame; one
  reset per flush, none for quiet swaps; the states flash removed), the
  v9-RANGES measurement paragraph gets the new numbers, plus a "v2 target-set
  planner" note with the floor / detail passes and the ping-pong argument.
- CHANGELOG.md: one bullet per landed item under the heading current at
  write time.
- `VramBudgetSection.tsx` info text: swaps land in batches while the camera
  rests and the picture re-converges once per batch; render targets count
  (see Stats); hi-res screenshots pause swaps; Phase 3 adds the suggestion.
- No EVENTS.md / SDK / widget-gallery change.

## Verification

- `npm run typecheck`, `npm run check` (Biome), `npm test` (planner,
  packMixed, denseBox, vramHint tests), `npm run test:boot`.
- In app: baseline vs after each phase per the protocol; the SETTLED line
  (frames, resets, gpu Σ, swaps) is the acceptance metric.
