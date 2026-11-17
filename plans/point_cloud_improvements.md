# POINT_CLOUD_IMPROVEMENTS — memory, performance and visuals for laser scans

> **Status: IN PROGRESS.** Built 2026-11-15: phase 0's measuring rows and
> offline baseline (the in-app numbers are still to be taken), and **4A + 4B**
> (the filter default and the "Show points" radio, with the memory release),
> **4C** (a setup is a "scan sphere" in all user text), 2B's 4-vertex
> strip and **2H** (only the part of a node in view is drawn). The director's GPU numbers are in — see "Phase 0 — in-app numbers"
> and the revised priorities there. The rest is not built.
> Follows the scan viewer as built (the "Laser-scan point clouds — BUILT"
> bullet in `DESIGN.md`). Triggered by an external review of the repo (a ChatGPT answer, read 2026-11-15); what was
> kept, reshaped and rejected from it is listed at the end.
> File references were checked on 2026-11-15.
> Every cost or gain below marked *estimate* comes from reading the code, not
> from a measurement — phase 0 exists to replace them with numbers.
>
> **Revised 2026-11-15 (director feedback on the Scans panel):** "only the
> entered setup's points" becomes the default, "Show points" becomes a
> three-way radio, and the word "setup" is up for renaming — phase 4. Because
> the filter is now the normal case, the point record in 1A keeps the setup
> byte so entering and leaving does not restream.

## Goals

1. **Memory** — fewer GPU bytes per point, less garbage per streamed node.
2. **Performance** — no main-thread hitches while streaming, less vertex work
   per frame, less load/evict churn.
3. **Visuals** — depth cues and colour modes that make a cloud readable.
   Anything that costs frame time is a **toggle, off by default**, so the
   plain cloud never gets slower than it is today.

Not goals: a new file format, a new LOD scheme, or a second renderer. The
`.tdpp` v1 file, the additive octree and the best-first walk stay.

## Where we are (verified in the code)

| Area | Today | Where |
|---|---|---|
| GPU point record | 16 B: x, y, z as f32 + `r,g,b,grey` | `shaders/points.ts`, `tdpp/pointPack.ts` |
| File point record | 12 B before the codec: u16 x, y, z, intensity + u8 r, g, b, setup | `TDPP_FORMAT.md` |
| GPU buffers | one storage buffer + one bind group **per node**, created and destroyed as nodes stream | `render/pointsLayer.ts` `createNode` |
| Draw | one `draw(6, count)` per node; 6 vertex invocations per point; nodes drawn whole | `pointsLayer.ts` `draw` |
| Culling | per node on the CPU (frustum, max distance, clip). Nothing per cluster; the 256-point clusters in the file are unused by the renderer | `tdpp/pointLod.ts` |
| Decode | `decodeNode` + `packNodePoints` run on the **main thread**, up to 4 nodes in flight | `state/scans/scanPoints.ts` `load` |
| Selection | full best-first walk on the main thread on every frame the view key changes; 64-sample share estimate per picked node when in-view charging, max distance or clipping is on | `pointLod.ts` `selectNodes`, `rangeShare` |
| Hysteresis | none — a node at the budget edge flips with every small move (the cache softens the reloads) | `pointLod.ts` |
| Setup filter | off by default; changing it (so every enter / exit while it is on) drops the whole GPU cache and restreams, because the filter is applied when a node is packed | `scanPoints.ts` `applyFilter` |
| Show points off | clears the draw list only — the streamed nodes stay in GPU memory | `scanPoints.ts` `hide` |
| Point settings | not persisted: every session starts from the defaults in the store | `scans.state.ts` |
| Shading | unlit colour or intensity grey, camera-facing normal, square points | `shaders/points.ts` |
| AO | VBAO runs on every pixel with depth, **point pixels included** (no point exemption in the compute or in the composite) | `shaders/post.ts` |
| EDL | not built | — |
| GPU timing | points share the scene pass slot; no number of their own | `render/gpuTimings.ts` |

Sizes that matter: an LGSX node holds up to ~302 k points, an E57 node up to
65,536. With the defaults (budget 5 M, in-view charging on, cache 50 %) the
streamer may hold `2 × budget` drawn plus `0.5 × budget` cached = 12.5 M
points = **200 MB** of GPU memory; at the panel's maximum budget of 50 M that
is 2 GB.

Per streamed node the main thread allocates about 42 B per point of
short-lived arrays (8 + 4 decode, 12 + 2 dequantized, 16 packed) — roughly
12.7 MB for one full LGSX node — and `writeBuffer` copies the 16 B again.

## Phase 0 — measure before changing anything

No behaviour change; numbers only. Without these the rest is ordered by guess.

- **Streamer counters** in the Statistics panel (dev rows): selection walk ms
  per round, decode ms and pack ms per node, nodes and bytes uploaded per
  frame, loads finished that were no longer wanted.
- **Frame cost of points**: scene-pass GPU time with points on vs off at the
  same camera (A/B through the existing "Show points" toggle and the GPU
  timings), at 1 M / 5 M / 10 M / 20 M drawn, MSAA on and off.
- **Cluster fill**: average points per 256-slot cluster in a cooked LGSX and
  E57 (decides whether cluster-granular drawing wastes vertex work).
- **Fixed scenes**: two camera poses per sample (outside overview, inside a
  room) on one LGSX and one E57 from `scanSamples/`, written down so every
  later phase is compared against the same views. Record on the director's
  GPU and on one low-end / UMA device — the original scan design named UMA
  vertex and fill rate as the ceiling.

Outcome: one table in this file. It decides whether phase 2C is built at all.

### Phase 0 — done so far (2026-11-15)

**In the app** — three rows in Settings → Stats and the viewport overlay,
fed by `state/scans/pointPerf.ts` (plain counters, nothing re-renders):

| Row | Shows |
|---|---|
| scan select | selection rounds in the last second the camera moved: the LOD walk and the whole round, average and maximum ms, nodes picked |
| scan stream (last burst) | from the first fetch until nothing is wanted: nodes, points, MB, wall time, and the summed read / decode / pack / upload-call ms |
| scan stream peaks | the heaviest frame (main-thread ms, nodes, MB that landed between two frames), the heaviest node, nodes that arrived after the view had moved on, nodes thrown away |

**Offline baseline** — the app's own `decodeNodeSync`, `packNodePoints` and
`selectNodes` run in Node 24 on three files cooked with the native `scan`
CLI (Ryzen 7 255, one thread). Main-thread CPU only: no GPU, no browser.

| | office (LGSX) | bridge (LGSX) | bridge (E57, 3 M chunks) |
|---|---|---|---|
| points / nodes | 3.9 M / 35 | 58.4 M / 546 | 58.9 M / 3,139 |
| node size, median / max | 80,899 / 262,144 | 64,827 / 301,647 | 16,668 / 61,057 |
| cluster fill (of 256) | 99.9 % | 99.9 % | 99.3 % |
| file payload | 5.45 B/pt | 4.78 B/pt | 4.65 B/pt |
| decode per 100 k points | 1.36 ms | 1.22 ms | 1.13 ms |
| pack per 100 k points | 0.88 ms | 0.72 ms | 0.70 ms |
| largest node, warm | 9.3 ms | 6.4 ms | 1.1 ms |
| largest node, first run | 17.5 ms | 11.2 ms | 2.6 ms |
| LOD walk, overview / inside, defaults | 0.02 / 0.03 ms | 0.01 / 0.07 ms | 0.11 / 0.18 ms |
| LOD walk, worst seen (50 M, detail 8 ×) | 0.29 ms | 0.24 ms | 0.62 ms |
| inside view at 5 M: charged / held | 0.5 M / 2.3 M | 2.5 M / 10.0 M | 2.1 M / 3.6 M |

What this already settles:

- **The LOD walk is not a cost** — well under a millisecond in every case.
  **2D and 1D are dropped** (kept below for the record, struck from the order).
- **Streaming a node is ≈ 2 ms of main thread per 100 k points**, decode the
  larger part. One full LGSX node is 6–9 ms (up to 17 ms the first time) and
  four can land in one frame: more than a 60 Hz frame. An E57 node is about
  1 ms. So **2A matters for LGSX and hardly for E57** — confirm with the
  "scan stream peaks" row before building it.
- **Clusters are full** (99 %+), so cluster-granular drawing (2C) wastes no
  vertex work.
- **In-view charging holds far more than it charges inside an LGSX scan**:
  2.5 M in view, 10.0 M drawn (the 2 × cap). That is the vertex work 2C
  would remove; whether it is the bottleneck is the GPU A/B below.
- **1A's 18 bits do not cover the top nodes of this bridge**: it spans 524 m,
  so its first levels use the scaled step (2 mm on points that sit decimetres
  apart). Expected, but it is the common case for a site, not a rare one.

### Phase 0 — in-app numbers (director, 2026-11-15)

One LGSX scan of 415 M points, no model, adapter "amd rdna-3" (the
machine's integrated Radeon 780M, so this *is* the UMA case), viewport about
1390 × 810, point size 1 px, in-view charging on. MSAA is read off the
render-target memory (103 MB with, 47 MB without). The 5 M rows are a wider
view than the others, so compare rows per point only within a view.

| Budget | MSAA 4× | Drawn | Nodes | Points on GPU | Scene pass | Total GPU | fps |
|---|---|---|---|---|---|---|---|
| 5 M | on | 9.85 M | 50 | 186 MB | 34.4 ms | 35.4 ms | (idle) |
| 5 M | off | 9.83 M | 49 | 186 MB | 33.2 ms | 33.7 ms | (idle) |
| 12 M | off | 23.90 M | 149 | 409 MB | 38.3 ms | 38.7 ms | (idle) |
| 12 M | on | 23.74 M | 143 | 425 MB | 51.9 ms | 52.7 ms | 15 |
| 20 M | off | 39.92 M | 242 | 703 MB | 63.2 ms | 63.7 ms | 14 |
| 20 M | on | 39.92 M | 239 | 689 MB | 88.6 ms | 89.3 ms | 10 |

CPU side in the same shots: frame CPU 0.4–0.5 ms; selection walk 0.2–0.6 ms
average, whole round at most 1.2 ms; streaming 2.5 ms decode + 1.1 ms pack
per 100 k points, heaviest node 10 ms, heaviest frame 14 ms (2 nodes).

What this settles:

- **Scans are GPU-bound, and by a wide margin.** The scene pass is the whole
  frame; everything on the main thread is under 1.5 ms. At the default
  budget this GPU already runs at about 30 fps.
- **The budget is not what is drawn.** With in-view charging the app draws
  twice the budget in every shot (the `MAX_DRAWN_BUDGETS` cap): "5 M" is
  9.8 M points through the vertex stage, "20 M" is 39.9 M and 700 MB.
- **Cost per drawn point is about 1.6 ms per million** (20 M, no MSAA):
  40 M points are 240 M vertex invocations and 80 M one-pixel triangles in
  63 ms, which is near what this GPU can set up at all. 60 fps leaves room
  for roughly 5–10 M *drawn* points.
- **MSAA 4× costs about 40 % more** with points at 12–20 M.
- **The main thread is not the problem.** A 10 ms node or a 14 ms frame of
  streaming work disappears inside frames that take 35–90 ms. **2A (worker
  decode) is demoted**: do it only if hitches are felt once the frame is
  fast.

**Revised priorities** (replaces the order at the end of this file):

0. **2H — draw only the part of a node that is in view** — BUILT; 2.5–3 ×
   fewer points through the vertex stage at the default budget inside an
   LGSX scan, expected to be worth 10–30 % of the scene pass (see 2H).
1. **2B — a cheaper point primitive.** Six vertices and two triangles per
   point is the cost. The 4-vertex strip removes a third of the vertex work
   (built 2026-11-15, see 2B). The next experiment is **one triangle per
   point** (3 vertices, 1 triangle, the corners cut in the fragment shader):
   half the vertex work and half the triangles, at twice the rasterised area.
2. **2F — lighter while moving**, promoted: it is the direct lever on fps
   during navigation, where 10–15 fps is felt.
3. **2C — per-cluster culling**, promoted from "maybe" to planned: about half
   of what is drawn lies outside the view.
4. **1A + 1B — memory**: unchanged (700 MB → about 525 MB at a 20 M budget).
5. **2G — compute rasteriser** (new, below): the large option if 1–3 are not
   enough on this class of GPU.

**Still open**: one reading that splits vertex / triangle cost from fragment
cost — same view and budget, point size 1 px against 4 px. If the scene pass
barely moves, the fragment side is free and everything above stands.

**Originally asked for** (the GPU table above replaces most of it):

1. Fixed views on one LGSX and one E57: an overview from outside and one
   inside a room. For each, jump to the view and read "scan stream (last
   burst)" and "scan stream peaks" once loading stops.
2. GPU A/B: Settings → Stats → GPU timings on, same view, "Show points" on
   vs off; note the scene pass times. Repeat at budgets 5 / 12 / 20 M and
   with MSAA on and off.
3. The same on one low-end / UMA device.

## Phase 1 — memory

**1A. 12 B point record (−25 % GPU memory).** *Estimate: 200 MB → 150 MB at
the defaults.* Three words per point instead of four:

```text
w0, w1 : x, y, z as 18-bit integers (54 bits) | setup byte (8 bits) | 2 spare
w2     : r | g << 8 | b << 16 | intensity8 << 24      (unchanged)
node header grows from 4 to 8 words: spacing, quantization min xyz, step xyz
```

The integers are cook-grid units from the node's tight minimum: 18 bits cover
262 m at the 1 mm grid — the size of an LGSX root — so positions stay exact.
A node that spans more (the top levels of a very large E57) falls back to a
scaled step: a few millimetres of display error on its sparse, far-away
points only. The vertex shader rebuilds `min + q · step`. Measuring is not
touched — the snap reads decoded f32 from the file (`snapNode`), not the GPU.
The record stays one contiguous run per cluster, which is what 2C needs.

**The setup byte on the GPU** is what phase 4 needs. The setup filter becomes
a test in the vertex shader instead of a re-pack, so entering, leaving and
stepping between scan positions no longer drops the cache and restreams, and
colour-by-setup (3C) is free. Nodes that hold none of the filtered setup's
points are still not loaded (the node `setupMask`, as today). The price: a
node that mixes setups is resident whole instead of filtered down — which is
what the budget already charges for it (`cost` in `selectRound`), so the
budget's meaning does not change; only the memory actually used rises to
match it.

Follow-ups in the same change: `POINT_GPU_BYTES` in `state/viewer/statsRows.ts`,
the Budget tooltip ("≈ 16 B per point"), `pointStats.state.ts` comment.

**1B. Decode straight into the GPU layout.** Skip the intermediate
`Float32Array` positions and `Uint16Array` intensity for the streaming path:
decode → integer rebase → packed words. *Estimate: ~42 B → ~24 B of
transient memory per point*, and it is the body of 2A's worker. `decodeNode`
stays as it is for the snap and the tests.

**1C. Cache under pressure (small).** Today the cache is a fixed share of the
budget. Option: shrink it to 0 while the model VRAM budget
(`state/viewer/residency.ts`) reports pressure, so scans give memory back before models
are unloaded. Only worth doing if the director sees scans and models compete.

**1D. Hierarchy as typed arrays — dropped after phase 0** (the walk it
would speed up costs under a millisecond). Original note: ~10 MB of JS objects per
23 k-node scan (*estimate*). Struct-of-arrays would cut that and speed the
walk, but it touches every reader of `TdppNode`. Do it only if many scans are
open at once or 2D shows the walk is hot.

Not available as a lever: holding **part** of a node. A node's streams are
codec-compressed whole, so it is decoded and resident whole; the 2 × cap
(`MAX_DRAWN_BUDGETS`) is the price of in-view charging and stays.

## Phase 2 — performance

**2A. Decode and pack in workers.** The largest smoothness item (*estimate:
several ms per LGSX node on the main thread today, up to 4 landing together*).
A small pool (2–4 plain workers, not Comlink) takes `(node record, payload
bytes)` and returns the packed `ArrayBuffer` as a transferable; the main
thread only creates the buffer and uploads. The OPFS range read can move into
the worker too. The first scan viewer design already called for this; it was
not built. Keep the stale checks in `load` (renderer replaced, scan closed, filter
changed).

**2B. Cheap draw and upload wins.**
- **4-vertex triangle strip** per point instead of 6 list vertices: −33 %
  vertex invocations, and the per-vertex clip / max-distance test runs 4×
  instead of 6×. **BUILT 2026-11-15** — same picture, to be re-measured at
  the phase 0 views.
- **One triangle per point** (experiment, not built): 3 vertices and one
  triangle that covers the point's square; the fragment shader discards what
  lies outside it. Halves vertex work and triangle setup, doubles the
  rasterised area, and under MSAA the square's edge is decided per pixel
  instead of per sample — so it needs an A/B on the real GPU before it
  replaces the strip.
- **Upload budget per frame** (bytes), so a burst of finished nodes spreads
  over frames instead of landing in one.
- **Drop stale results**: a node that is no longer wanted when its decode
  finishes is not uploaded.
- **`mappedAtCreation`** for the node buffer to save the `writeBuffer` copy
  (only if phase 0 shows upload time matters).

**2H. Draw only the part of a node that is in view — BUILT 2026-11-15**
(after the director asked how much of the budget goes outside the view).
As built: `lib/tdpp/pointRanges.ts`, ranges of at most 8,192 points,
neighbours joined (about 175 draws at 5 M and 420 at 20 M on the rotterdam
scan — the draw counts in the table below are before joining), the frustum
widened by the point size so a point just outside still shows its half;
`draw(4, count, 0, first)` checked on a headless WebGPU device. The stats
row "scan points" shows the draws. To be measured in the app.

**What to expect from it, after the strip numbers.** The 4-vertex strip
(a third less vertex work) was re-measured by the director on the same scan:

| Budget, MSAA | Scene pass before | After the strip | |
|---|---|---|---|
| 20 M, off | 63.2 ms | 52.3 ms | −17 % |
| 20 M, on | 88.6 ms | 81.1 ms | −8 % |
| 12 M, on | 51.9 ms | 47.3 ms | −9 % |
| 12 M, off (idle readings) | 38.3 ms | 35.1 ms | −8 % |

(The viewport was about 15 % larger in the second set, so the gain is
slightly understated.) A third less vertex work bought 8–17 %: **the vertex
stage is roughly a quarter to a half of the point pass, and the rest is
rasterising the points that are in view** — tens of millions of one-pixel
triangles. 2H removes the out-of-view share of the vertex work only, so
expect it to take another 10–30 % off the scene pass, most at low budgets
where three quarters of the points are outside the view — not the 2–3 ×
that the point counts alone suggest. What is left after it is the in-view
raster cost: one triangle per point (2B), fewer points while moving (2F),
or the compute rasteriser (2G).

**Measured in the app (director, 2026-11-15, same scan, MSAA off):**

| Budget | Drawn before → after | Draws | Scene pass before → after |
|---|---|---|---|
| 12 M | 24.0 M → 11.0 M | 391 | 35.1 ms → 33.4 ms (−5 %) |
| 20 M | 39.8 M → 22.1 M | 588 | 52.3 ms → 40.2 ms (−23 %) |
| 20 M, clip plane | → 21.2 M | 645 | 36.4 ms |
| 20 M, clip box | → 3.3 M | 278 | 15.9 ms |

Frame CPU stayed at 0.5 ms, the round at 1–2.4 ms: the extra draws cost
nothing. The pairs mix readings taken while orbiting with readings taken
still, and the views differ a little, so read them as rough. They agree with
the forecast: the out-of-view half was the cheap half. The cost does not
fall in step with the points drawn (3.3 M: 15.9 ms; 11 M: 33 ms; 22 M:
40 ms) — what limits the frame now is the points in view, and something
that does not scale with their number. Two readings would name it: the scene
pass with "Show points" off, and point size 1 px against 4 px.
Clip plane and clip box draw correctly with the ranges. fps moves in whole
screen refreshes: 33.4 ms is 20 fps where 33.3 ms would be 30.

**Adaptive size fixed alongside** (the director's third picture: a close-up
covered in blocks). Not caused by the ranges: every node was sized by its
own spacing, so near the camera the points of the coarse nodes were squares
of up to 24 px over the fine ones. Now per octant, by the finest level drawn
there — `lib/tdpp/pointSizes.ts`, node header 4 → 12 words.

**Max distance and what is loaded (director, 2026-11-15: "I would expect
max distance to affect loaded more like clipping did").** Both already go
through the same walk; measured offline on the same scan at a 20 M budget,
millions of points per view:

| Max dist | Loaded (whole nodes) | Drawn (ranges) | In range and in view |
|---|---|---|---|
| none | 29.0 | 15.0 | 13.2 |
| 20 m | 25.5 | 10.9 | 9.1 |
| 10 m | 17.5 | 5.7 | 4.6 |
| 5 m | 10.8 | 2.0 | 1.4 |

Two things kept "loaded" from following: (1) the cache was counted from the
budget, so memory never fell under 1.5 budgets once loaded — **fixed**: it is
counted from what is wanted; (2) a node is loaded whole. For (2), uploading
only the ranges within the max distance was measured and **rejected**: it
would hold 12.8 M instead of 17.5 M at 10 m and 6.0 M instead of 10.8 M at
5 m, because what is loaded is mostly near the camera in the directions it
is not looking — not beyond the distance. The waste is in the view
direction, so the memory lever stays the "second step" below (upload only
the ranges in view), with its cost: turning the camera streams.

Original proposal and measurement:

Measured offline with the app's own selection on cooked files: views from
scanner positions, four directions each, 1390 × 810, in-view charging on.
Millions of points per view:

| Scan, budget | Drawn today | Truly in view | Per 256-pt cluster | Ranges ≤ 32,768 | Ranges ≤ 8,192 |
|---|---|---|---|---|---|
| rotterdam LGSX, 5 M | 9.92 | 2.46 (25 %) | 2.66 | 4.03 (357 draws) | 3.29 (1,052 draws) |
| rotterdam LGSX, 12 M | 21.58 | 8.35 (39 %) | 8.73 | 11.27 (855) | 9.88 (2,564) |
| rotterdam LGSX, 20 M | 28.98 | 13.15 (45 %) | 13.62 | 16.67 (1,093) | 15.01 (3,340) |
| bridge LGSX, 5 M | 9.54 | 2.62 (27 %) | 2.82 | 4.21 (337) | 3.40 (1,057) |
| bridge E57, 5 M | 5.55 | 3.26 (59 %) | 3.46 | 4.80 (366) | 4.06 (797) |

So inside an LGSX scan **55–75 % of what is drawn is outside the picture**
(40 % for an E57, whose nodes are four times smaller). The budget's own
estimate of the in-view share is accurate to a few percent; the waste is
that a node cut by the view edge — nearly every node — is drawn whole.

The fix, without a compute pass, pooled buffers or a format change:

- **Ranges.** When a node is packed, its 256-point clusters are grouped by
  position (the node cube split by octant of the cluster centre until a
  group holds at most N points) and the points are written group by group,
  so each group is one contiguous run of the node's buffer with a tight box.
  About 32 B per range; a full LGSX node has roughly 10 (N = 32,768) to 40
  (N = 8,192) of them.
- **Draw.** Each selection round: a node wholly inside the view is one draw
  as today; a node cut by the view edge draws only the ranges whose box
  touches the view (and passes the clip volume and the max distance),
  neighbouring ranges merged — `draw(4, count, 0, first)`, the instance index
  already includes the first instance.
- **Gain.** At the default budget the GPU draws 3.3–4.0 M points instead of
  9.9 M (2.5–3 × less vertex work); at 20 M, 15–17 M instead of 29 M. Same
  picture.
- **Cost.** A few thousand box tests per round (well under a millisecond)
  and more draw calls — the table's counts are before merging neighbours.
  What a draw call costs here is not measured; N is the knob (32,768 keeps
  it near 1,000 draws at 20 M). 2C would get the last few percent (the
  per-cluster column) with one draw, at far more work.
- **Readout.** "Drawn" becomes what is actually drawn; the 2 × cap
  (`MAX_DRAWN_BUDGETS`) then bounds memory only, and whether it still needs
  to stop the walk that early is a follow-up question.

**Second step — BUILT 2026-11-15 as the toggle "Load only what is in view"**
(director: "a nice toggle we could have"; off by default, ALT 1770). As
built: a node keeps the ranges within the view widened by 60 % of the half
view (`LOAD_GUARD`) and is fetched again when a range it lacks comes within
25 % (`NEED_GUARD`); the replaced buffer is destroyed after the next round.
Offline estimate on the rotterdam scan: 9.9 M → 4.8 M points held at a 5 M
budget, 29.0 M → 22.0 M at 20 M; 5.55 M → 5.17 M on the E57 bridge. The
margin is the knob: smaller holds less and reloads sooner. Reloads decode on
the main thread, so this is what would make worker decode (2A) worth
building. Not seen in the app yet. Original note: upload only
the ranges in view plus a margin, and fetch the rest of a node when the
view turns. That would cut the points held on the GPU by about the same
factor, but a node's streams are compressed whole: every top-up is a
re-read and re-decode of the node. Turning the camera would then stream,
which is where worker decode (2A) and the cache come back in. Decide after
the first step is measured.

Note on the "3 M" figure: that is the cook's chunk size for building an E57
octree, not what is loaded. A node is at most about 300 k points (LGSX) or
65 k (E57); the cost is that it is all-or-nothing.

**2G. Compute rasteriser (new after phase 0 — candidate, not planned).**
A rasteriser pays per vertex and per triangle: 6 (or 4, or 3) shader runs
and 1–2 triangle setups for one pixel. A compute pass pays once per point:
project, then `atomicMin` a depth word per pixel, a second pass writes the
colour of the winning point, and a full-screen pass merges the result into
the scene targets with the model's depth. The original scan design deferred this
as "v2 — decide only if quad throughput fails on UMA"; 30 fps at the default
budget on a 780M is that case. Costs: WebGPU has no 64-bit atomics (hence
two passes), points larger than 1 px need a loop per point, and points lose
MSAA (TAA still applies). Large; decide after 2B and 2C are measured.

**2C. Pooled buffers, per-cluster GPU culling, multi-draw indirect.** The
design the first scan viewer plan called for and the current build skipped.
Nodes live in a few large buffers behind one bind group (no create / destroy
per node); a compute pass tests each cluster (frustum, clip volume, max
distance) and writes one indirect draw per surviving cluster; one
multi-draw-indirect call draws the cloud. It reuses the CAD cull machinery
and the device feature the viewer already requires.
*Gain (estimate)*: the vertex stage stops paying for the out-of-view share of
whole nodes — up to half of what is drawn today. It saves no memory.
**Build only if phase 0 shows the vertex stage is the bottleneck**; this is
the one large item in the plan.

**2D. Selection walk — dropped after phase 0** (measured at 0.01–0.6 ms).
Original note: if hot: test a node's cube
fully inside the frustum before sampling its share (skips the 64 samples for
most nodes), reuse the round's arrays instead of rebuilding sets and the draw
key string, and cap the walk to one run per N ms while the camera moves.

**2E. Hysteresis.** Refine at `minPx`, drop only below `minPx × 0.8` (and the
same band at the budget edge), so a slow orbit stops loading and evicting the
same nodes. Fewer pops is a visual gain too. Needs the previous round's set
as an input to `selectNodes`; `tests/pointLod.test.ts` gets the cases.

**2F — BUILT 2026-11-15** as the toggle "Lighter while moving" (on by
default since the director's ruling the same evening, ALT 1771): while the view changes and for 200 ms after, the draw
list is the most urgent prefix of the picks up to 30 % of the budget;
loading and the cache are untouched. Not seen in the app yet. Original note:
**2F. Lighter while moving (toggle, off).** While the camera moves, draw with
a reduced budget (for example half) and refine when it stops — standard in
point viewers and a fit for the one-frame-in-flight pacing. Off by default:
the picture changes during navigation.

**HiZ occlusion for scans — not planned.** Points are drawn after the HiZ
pyramid is built and are poor occluders (holes); only CAD could hide scan
clusters, and in the overlay use the scan lies *on* the CAD surfaces, not
behind them. Revisit only inside 2C, where the test is nearly free, and only
with a measured scene that benefits.

## Phase 3 — visuals

All shader work here stays in the existing passes: no new render targets.

**3A. Eye-dome lighting (toggle, off).** Depth-only shading that gives
unlit points edges and shape — the single biggest readability gain. In the
post fragment shader, for point pixels: compare linear depth against 4 or 8
neighbours at a pixel radius, darken by the summed positive difference.
Settings: on/off, strength, radius. *Cost (estimate)*: 4–8 depth loads per
point pixel in a pass that already runs. Applied before TAA accumulation,
skipped in sketch mode.
Two things it forces a decision on (see Decisions): how the post pass knows a
pixel is a point, and what VBAO does on point pixels.

**3B. Round points (toggle, off).** Discard outside the circle in the
fragment shader. Only visible from about 3 px up; costs early-Z on point
fragments.

**3C. Colour modes (no frame cost).** Added to the Colour / Intensity switch:
- **Elevation** — a ramp over a height range (default the cloud's bounds,
  two number inputs to override). Computed in the shader from the position.
- **Intensity window** — low / high limits (and gamma) for the intensity
  grey; raw scanner intensity is often compressed into a dark band.
- **By scan position** — one palette colour per scanner position, picked in
  the shader from the setup byte the record carries (1A): no restream.

**3D. Depth bias against CAD (toggle, to confirm first).** Where a scan lies
on a model surface, points and triangles fight for the same depth. A small
"points in front / behind the model" bias would settle it. Confirm in-app
that the flicker is a real problem before building.

**Deferred, not designed here:** lighting from stored normals (LGSX only,
needs `--normals` at cook time and +2–4 B per point on the GPU; EDL covers
most of the gain), screen-space hole filling, fade-in of newly loaded nodes,
paraboloid point depth.

## Phase 4 — Scans panel: defaults, the points radio, wording

Director feedback of 2026-11-15 on the "Point cloud" group of the Scans panel.

**4A. "Only the entered setup's points" on by default — BUILT 2026-11-15**
(ahead of 1A at the director's request, so every enter and exit restreams
until 1A lands). `onlySetupPoints`
starts `true`. It only acts inside a scan position, so the free view is
unchanged; inside, the cloud is what that scanner saw, which is what lines up
with its photo. Today this default would make every enter and exit restream
the whole cloud (see the table at the top) — it should land **with or after
1A**, where the filter becomes a shader test. Landing it alone first is
possible but makes stepping between positions slower than it is now.

**4B. "Show points" becomes a radio — BUILT 2026-11-15** (`RadioGroup`,
already in `@treDeSpaceUI`), replacing the checkbox. As built: state
`pointsMode` (`state/scans/pointsMode.ts`), default Always, release after
5 s (`RELEASE_HIDDEN_MS`), hotkeys ALT 1764–1766 plus the old ALT 1710 as
the off / back toggle. Not persisted (4D).
**Revised the same day (director): four options.** *Off (unload)* frees the
points at once — a scan is then its scan spheres and photos only; *Hidden
(keep loaded)* (ALT 1767) keeps what is loaded; ALT 1710 now toggles hidden /
last shown. The 5 s grace applies only to the free view of "only inside".

| Option | Points are streamed and drawn |
|---|---|
| Off | never |
| Always | in the free view and inside a scan position (today's "on") |
| Only inside a scan position | only while a position is entered |

- State: `showPoints: boolean` → a string union, e.g.
  `pointsMode: 'off' | 'always' | 'entered'`. Proposed default: **Always**
  (today's behaviour) — see Decisions.
- With 4A on, "Only inside" + the filter is the light mode: nothing is
  streamed while flying around, and inside only one scanner's points are.
- **Memory**: whenever points are not shown (Off, or "Only inside" while
  outside) the streamed nodes are released, not just hidden as today — after
  a short grace period, so a quick off / on does not restream.
- Hotkeys: the existing `scans.points` binding keeps its id and toggles
  between Off and the last shown mode; each radio option gets its own
  binding and tooltip (house rule).

**4C. Wording: "setup" — BUILT 2026-11-15 as "scan sphere"** (the
director's choice). The marker checkbox became "Show scan spheres" and its
opacity box "Spheres", which avoids "scan sphere marker spheres". Done in
the panel, the Import Manager, the hotkey labels and descriptions, the
console line at open, the SDK's JSDoc for `'points'` assets and the guide
text; the guide screenshots and their label data need `npm run docs:shots`.
The rest of this plan still says "setup" / "scan position" where it was
written before the ruling. The candidates as they were weighed:

| Term | For | Against |
|---|---|---|
| **Scan position** (recommended) | Says what it is — where the scanner stood; works for a position without a photo; reads well in every label ("Enter scan position", "Next scan position", "Only this scan position's points") | Longer |
| Scan sphere (director's suggestion) | Matches the marker in the scene and the look-around photo | LGSX photos are cube panoramas and the file format already uses "sphere" for one panorama kind; "scan sphere markers" / "opacity of the scan sphere marker spheres" read badly; a position without a panorama is not a sphere of anything |
| Station | Common survey term | Unfamiliar to CAD users |

Scope whichever is chosen — **user-facing text only**: the Scans panel
labels and tooltips (`components/panels/scans/*`), the hotkey labels and
descriptions (`hotkeys/scanBindings.ts`, about 14), the Import Manager scan
options tooltip, and the user guide (`docs/guide/panel-scans.html`,
`a01-assets.html`, `data/scans.json`). Code identifiers, store keys, hotkey
**ids** (users' saved key overrides hang on them) and the `.tdpp` metadata
key `setups` keep "setup". `EVENTS.md` and `api/tredespace-client.ts` contain
the word too — check at implementation time whether those uses are about
scans at all.

**4D. Persist the point settings — BUILT 2026-11-15** (director: yes, with
a reset button per section like Settings has, under Photo too). As built:
`state/scans/scanSettings.ts`, storage name `scans`, one reset button in the
Point cloud header and one in the Photo header (ALT 1768 / 1769). Original
note: they reset every session
today, so a default is all a user ever gets. If the radio and the filter
should stick, persist them in `scans.actions.ts` (localStorage, like other
domains). Not asked for — listed because 4A/4B make the defaults matter more.

## Toggles and defaults

| Setting | Default | Frame cost | Phase |
|---|---|---|---|
| Show points: Off / Always / Only inside a scan position | Always | "Only inside" streams nothing in the free view | 4B |
| Only the entered scan position's points | **on** (was off) | none after 1A | 4A |
| Eye-dome lighting (+ strength, radius) | off | small, per point pixel | 3A |
| Round points | off | small | 3B |
| Colour mode: elevation / by setup, intensity window | Colour | none | 3C |
| Lighter while moving | off | saves time, changes the picture | 2F |
| Points depth bias | off | none | 3D |

Everything in phases 1, 2A–2E has no setting: it is how the streamer works.
Every new control gets a hotkey binding and a tooltip (house rule), lives in
`scans.state.ts` / `scans.actions.ts` beside the existing point settings, and
goes into `ScanPointControls.tsx` (already near the 120-line guide — split a
"shading" group out).

## Suggested order

1. Phase 0 — measurements, the baseline table.
2. 4C — the rename, text only; independent of everything else, can go first.
3. 1A + 1B + 2A together (they rewrite the same path: payload → packed words
   → GPU buffer) — memory and hitches in one step — and with them 4A + 4B,
   which depend on the shader-side filter.
4. 2B — strip, upload budget, stale drop.
5. 3A + 3B + 3C — the visible gains, all optional or free.
6. 2E, then 2F — churn and navigation feel.
7. 2C — only on the evidence of phase 0's GPU A/B; 1C, 3D, 4D as measured
   need. (2D and 1D are dropped — see the phase 0 results.)

Each step is its own change with a CHANGELOG entry, the `DESIGN.md` laser-scan
bullet kept current, the user guide's Scans page (`docs/guide/panel-scans.html`)
updated for new controls, a shader-pin update (`tests/shaders.pin.test.ts`)
where WGSL changes, `npm run test:boot`, and a WebGPU
validation run on the standalone harness (test:boot does not see validation
errors).

## From the external review — kept, reshaped, rejected

| Suggestion | Verdict |
|---|---|
| EDL | Kept — 3A. Already listed as not built in DESIGN.md. |
| Round / soft points, better point size | Round points kept (3B). Adaptive size from measured spacing already exists. |
| Colour modes | Kept in part (3C). Classification and distance modes dropped: the file has no classification, distance adds little over EDL. |
| Screen-space LOD prioritisation | Already built (best-first on projected spacing, focus distance, in-view charging). Hysteresis is the missing part — 2E. |
| HiZ occlusion for scan clusters | Not planned — see phase 2. |
| Cache and prefetch, pooled buffers, batched uploads | Pooled buffers → 2C; upload budget → 2B. Motion prefetch dropped: the cache setting already covers moving back. |
| TAA tuning for points | Not applicable as written — to be checked against how accumulation behaves in motion before any work. |
| Adaptive cook chunk size | **Rejected.** The chunk size decides where the octree is cut, so it is part of the output; a per-device size breaks byte-identical cooks and pinned hashes. |
| More point attributes (return number, classification, time) | Out of scope — a format change with no memory, speed or visual gain. |
| Progressive import | Out of scope — the hierarchy is written last; showing a partial cook is a cook and format redesign. |
| Station visualisation and navigation | Already built (setup markers, enter, panoramas, per-setup filter). |
| Scan-vs-CAD deviation colouring | A product feature of its own; not part of this plan. |

## Built 2026-11-15, last round (director: "ok, lets go for it")

- **2A — worker decode: BUILT.** Up to 4 plain workers; verified in headless
  Chrome (27 jobs, identical words, all off the main thread) and in a
  production build. Not seen on a real scan.
- **1A — 12-byte point record: BUILT**, as planned except for one thing:
  **the setup filter stays at pack time.** Moving it into the shader (so
  entering a scan sphere would not reload) was dropped: inside a sphere it
  would run the vertex stage every frame for all the other spheres' points,
  on a GPU-bound pass. The setup byte is in the record, so colour-by-sphere
  and a shader filter remain possible later. 1B (decode straight into the
  record) was not done: the decode now runs on workers, where its temporary
  arrays no longer cost the main thread.
- **Reload loop of "Load only what is in view": FIXED** (found by the
  director: endless loading while standing still). Offline, about one view
  in ten among the geometry had a range the need test accepted and the load
  test rejected.

## Rulings of 2026-11-15 (late)

- Adaptive max size: first left at 24 px, then (director, after seeing noise
  near the camera as big squares) a "Max size" setting, **2 px by default** (3 px for an hour),
  2–24 px — built.
- Persist the point settings: yes, with a reset per section, Photo too — built.
- Load only what is in view: yes, as a toggle — built; **on by default**
  (director, same evening). A browser that already saved the setting keeps
  its saved value until the Point cloud section is reset.
- Lighter while moving: yes, as a toggle — built, **on by default**.
- Guide screenshots: taken once everything is in.
- Enter is disabled while inside the selected scan sphere — built.

## Decisions needed

1. **Order.** Is the suggested order right, or do the visuals (3A–3C) go
   first because they are what users see?
2. **How post recognises a point pixel** (needed for EDL): spend one of the
   three free G-buffer tag bits (8, 32, 64 — `DESIGN.md` holds them for a
   per-model edge strength), or test for the exact tag value points write
   today (no bit spent, more fragile).
3. **VBAO on points.** Today AO darkens point pixels. Keep it, switch it off
   for points always, or off only while EDL is on? Needs a look in-app with
   AO on to see what it does to a cloud now.
4. **Shader-side setup filter** (1A): a node that mixes scan positions stays
   resident whole while filtered, in exchange for instant enter / exit.
   Agreed, or keep today's smaller-but-restreaming re-pack?
5. **2C** — agree that it waits for phase 0 numbers.
6. **Low-end test device** for phase 0: which one.
7. **The word for "setup"** (4C): scan position (recommended), scan sphere,
   or station.
8. **Default of the points radio** (4B): Always (proposed, today's
   behaviour) or "Only inside a scan position".
9. **4A before 1A?** Turn the filter default on right away and accept the
   restream on every enter / exit until 1A lands, or wait for 1A.
10. **Persist the point settings** (4D): yes or no.
