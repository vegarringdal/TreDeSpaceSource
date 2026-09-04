// VRAM-budget residency manager (DESIGN.md "VRAM budget & residency", v2).
//
// While the budget is enabled (`vramBudgetOn`, ceiling `maxVramMb`), the
// manager keeps tracked VRAM under it by holding
// far zones as their coarse cooked variant (or unloaded, without a coarse
// file) and near zones at full detail. Once per camera rest the pure planner
// (residency.plan.ts) computes the target level of EVERY zone and the ordered
// steps that reach it; this file executes the steps: swaps PREPARE in the
// worker while the camera stays idle, prepared swaps COMMIT in batches (one
// re-render for the batch), and a swap that cannot change a pixel commits
// QUIETLY with no re-render at all.
//
// Invariants: exclusive residency (a zone's coarse and full geometry are
// never on the GPU together), swaps only while the camera is idle, frees
// before allocations inside a batch, and swaps never touch the modeldb
// hierarchy/states — the renderer slot is rebuilt in place with its itemBase
// preserved, then the item states are re-pushed. Manager state is main-thread
// only; a disabled budget (`vramBudgetMb(s) === 0`) makes every tick a no-op.
import { boxFullyInFrustum, boxInFrustum } from '../../lib/math/frustum';
import { clipCulledSphere } from '../../lib/render/clipCull';
import type { Renderer } from '../../lib/render/renderer';
import type { AssetEntry } from '../assets/assets.state';
import { db } from './db';
import { prepareCoarse, prepareDemote, prepareFull, prepareMixed, type ReadyCommit } from './residency.commit';
import {
  type Cuts,
  type Pacing,
  type PlanAction,
  PROMOTE_HEADROOM,
  planTargets,
  priority,
  SEEN_GAP_MS,
  type Variant,
  type ZoneView,
} from './residency.plan';
import {
  decisionBox,
  FAIL_COOLDOWN_MS,
  isCoarseBroken,
  PACING,
  type ResidencyRecord,
  spanOf,
} from './residency.record';
import { selectionState } from './selection.state';
import { viewerState } from './viewer.state';
import { vramBudgetMb } from './vramBudget';

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

const MB = 1048576;
const mb = (b: number) => (b / MB).toFixed(1);

/** A prepared swap waits at most this long for batch-mates before it commits. */
const READY_MAX_WAIT_MS = 300;
/** Once settled, the planner only re-checks at this pace — every trigger
 * (visibility, clip or settings change, a new zone, camera motion) wakes it
 * at once; re-planning every tick at rest was the idle loop's main cost. */
const SETTLED_RECHECK_MS = 2000;
/** Blocked only by a cooldown or dwell: re-check at this pace at least. */
const WAITING_RECHECK_MS = 250;
/** Visible-bounds refresh triggers: the eye moved this far, or the view
 * turned past this dot, since the last refresh. */
const VIS_MOVE_M = 2;
const VIS_TURN_DOT = 0.995;
/** Never two refreshes closer than this (a flying camera would otherwise
 * queue one per worker round trip); hide/unhide changes bypass it. */
const VIS_MIN_INTERVAL_MS = 1000;
/** Safety refresh while nothing is in flight — transforms and other edits
 * that do not bump the state version still get picked up eventually. */
const VIS_SAFETY_MS = 10000;
/** A demoted-while-drawing-nothing zone must move this far out of the failed
 * viewpoint before the CPU fallback may mark it seen again. */
const DEADVIEW_CLEAR_M = 5;
/** A tick gap longer than this means the loop stopped, not that a frame ran late. */
const WAKE_GAP_MS = 2000;
const LOG_CAP = 400;
const SETTLE_REPORT_CAP = 12;

// -----------------------------------------------------------------------------
// state
// -----------------------------------------------------------------------------

const bySlot = new Map<number, ResidencyRecord>();
let pauseCount = 0;
/** Slots with a swap preparing or prepared-but-uncommitted. */
const inFlight = new Set<number>();
/** Prepared swaps waiting for the next batch commit. */
const ready: ReadyCommit[] = [];
/** Bytes an in-flight swap will leave its slot with (planner projection). */
const pendingBytes = new Map<number, number>();
const startedAt = new Map<number, number>();
/** The current plan's steps and how far issuing got. */
let plan: { steps: PlanAction[]; next: number } | null = null;
/** Something the plan was computed on changed (visibility, clipping, a
 * failure) — drop it at the next evaluation. */
let planDirty = false;
let lastSettingsKey = '';
let nextEvalAt = 0;
/** When the last commit that forced a re-render landed — draw counts read
 * before it describe the old scene. */
let lastLoudCommitT = 0;
let lastClipKey = '';
/** The last idle evaluation found nothing actionable (activity HUD state). */
let settled = false;

// visible-bounds refresh triggers
let visRefreshBusy = false;
let visForce = true;
let visLastT = 0;
let visEye: readonly [number, number, number] | null = null;
let visFwd: readonly [number, number, number] | null = null;
let visStateVersion = -1;

// convergence measurement (logged on settle so runs can be compared)
let burstStartT = 0;
let burstSwaps = 0;
let burstBytes = 0;
let burstParseMs = 0;
let burstCommits = 0;
let burstQuiet = 0;
let burstVisRefreshes = 0;
let burst0 = { frames: 0, scene: 0, resets: 0, held: 0, gpuMs: 0 };
/** Settle reports kept separately from the event log so the debug dump can
 * print them at the TOP — the event list is long enough to be truncated when
 * pasted, and these lines are the measurement. */
const settleReports: string[] = [];

// -----------------------------------------------------------------------------
// debug event log (Settings → VRAM budget → Copy event log)
// -----------------------------------------------------------------------------

const eventLog: string[] = [];
let logT0 = 0;

function logEvent(line: string): void {
  const now = performance.now();
  if (logT0 === 0) {
    logT0 = now;
  }
  eventLog.push(`${((now - logT0) / 1000).toFixed(2).padStart(8)}s  ${line}`);
  if (eventLog.length > LOG_CAP) {
    eventLog.shift();
  }
}

function dropPlan(why: string): void {
  if (plan) {
    logEvent(`PLAN-DROP after ${plan.next}/${plan.steps.length} steps · ${why}`);
  }
  plan = null;
}

// -----------------------------------------------------------------------------
// wake-up guard
// -----------------------------------------------------------------------------

let lastTickT = 0;

/**
 * Re-baseline the seen clocks after the tick loop stops and restarts.
 *
 * rAF does not run while the tab is hidden, so `tick` stops — but
 * `performance.now()` does not. On the first tick back every record looks
 * unseen for as long as the tab slept, and the planner reads that as "the
 * whole scene went off screen": it demotes what is plainly in view, refuses
 * every promotion (the seen gate), and scales all priorities by the offscreen
 * factor. Observed after an 80-minute idle — a visible zone demoted 4.5 s
 * after wake, then re-promoted.
 *
 * After a wake we genuinely do not know what is visible: the GPU draw counts
 * behind `lastSeenT` are as stale as everything else. Stamping every record as
 * seen-now is the safe reading — it costs at most one grace period before a
 * truly off-screen zone is demoted, where the alternative discards the whole
 * resident set. Streaks restart too, so each zone re-earns promotion from the
 * next readback. An in-flight convergence burst is abandoned rather than
 * reported with the sleep counted as work.
 */
function handleWake(now: number): void {
  const gap = now - lastTickT;
  lastTickT = now;
  if (gap <= WAKE_GAP_MS || bySlot.size === 0) {
    return;
  }
  for (const rec of bySlot.values()) {
    rec.lastSeenT = now;
    rec.seenStreakT = now;
  }
  burstStartT = 0;
  dropPlan('wake');
  logEvent(`WAKE · ${(gap / 1000).toFixed(1)}s tick gap — re-baselined seen clocks, burst discarded`);
}

// -----------------------------------------------------------------------------
// what the GPU / worker tell us about each zone
// -----------------------------------------------------------------------------

/** Is this box provably outside every active clipping volume? Mirrors the
 * cull shader (clipCull.ts), conservatively: partial overlap counts as
 * visible, so a zone is only ever demoted for clipping when nothing of it
 * could draw. */
function isClipCulled(r: Renderer, b: readonly number[]): boolean {
  if (!r.clipData || !r.clipDataU32) {
    return false;
  }
  const center: [number, number, number] = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
  return clipCulledSphere(r.clipData, r.clipDataU32, center, spanOf(b) / 2);
}

/** Update every record's lastSeenT: resident zones from the GPU's culled draw
 * counts (frustum + HiZ occlusion + clip, read after every scene change and
 * at ~2 Hz); zones whose draw counts cannot be trusted fall back to a CPU
 * frustum + clip test. That is unloaded slots (nothing to draw, by
 * definition), DEFICIENT packs — a coarse/mixed pack that dropped visible
 * items (cooker-cut tiny items, residency cuts) can draw nothing where the
 * user looks, so a zero draw count proves nothing — and EVERY zone when the
 * renderer keeps no counts at all (no-cull path, frozen cull): a resident
 * zone there read drawn = 0 forever and could never promote. The deadview
 * guard keeps the fallback from cycling an occluded zone: once it was
 * resident here and drew nothing, it stays unseen until the camera moves. */
function refreshSeen(r: Renderer, now: number): void {
  const vp = r.viewProjMatrix;
  const eye = r.camera.eye();
  const countsUsable = r.drawCountsUsable;
  for (const rec of bySlot.values()) {
    let seen = false;
    const drawn = countsUsable && r.drawnPerModel[rec.slot] > 0;
    const deficient = rec.variant !== 'full' && rec.packDropped > 0 && !drawn;
    if (!countsUsable || r.modelMeshletCount(rec.slot) === 0 || deficient) {
      const de = rec.deadviewEye;
      const moved = !de || Math.hypot(eye[0] - de[0], eye[1] - de[1], eye[2] - de[2]) > DEADVIEW_CLEAR_M;
      if (moved) {
        rec.deadviewEye = null;
        const b = decisionBox(rec);
        seen = !!b && boxInFrustum(vp, b) && !isClipCulled(r, b);
      }
    } else {
      seen = drawn;
      if (drawn) {
        rec.deadviewEye = null; // it really draws from here — viewpoint is fine
      }
    }
    if (seen) {
      if (now - rec.lastSeenT > SEEN_GAP_MS) {
        rec.seenStreakT = now; // was off screen a while — streak restarts
      }
      rec.lastSeenT = now;
    }
  }
}

/** Worker round trip pulling each zone's visible-item AABB, dense box,
 * visible fraction and nearest distance into the records. Trigger-based: the
 * eye moved or turned, an item state changed outside residency (hide /
 * unhide / colour pushes bump the selection store's state version; the
 * manager's own state re-pushes do not), a zone registered, or a slow safety
 * timer while nothing is in flight — an idle camera during a swap burst
 * issues no round trips at all, so the worker parses swaps uncontended. */
function refreshVisibility(r: Renderer, now: number): void {
  if (visRefreshBusy || bySlot.size === 0) {
    return;
  }
  const eye = r.camera.eye();
  const fwd = r.camera.forward();
  const sv = selectionState.get().stateVersion;
  const stateChanged = sv !== visStateVersion;
  const moved =
    !visEye ||
    !visFwd ||
    Math.hypot(eye[0] - visEye[0], eye[1] - visEye[1], eye[2] - visEye[2]) > VIS_MOVE_M ||
    fwd[0] * visFwd[0] + fwd[1] * visFwd[1] + fwd[2] * visFwd[2] < VIS_TURN_DOT;
  const busy = inFlight.size > 0 || ready.length > 0;
  const throttled = now - visLastT < VIS_MIN_INTERVAL_MS;
  const due = visForce || stateChanged || (moved && !throttled) || (!busy && now - visLastT > VIS_SAFETY_MS);
  if (!due) {
    return;
  }
  visForce = false;
  visLastT = now;
  visEye = [eye[0], eye[1], eye[2]];
  visFwd = [fwd[0], fwd[1], fwd[2]];
  visStateVersion = sv;
  visRefreshBusy = true;
  burstVisRefreshes++;
  db.visibleBounds([...bySlot.keys()], [eye[0], eye[1], eye[2]])
    .then((rows) => {
      for (const row of rows) {
        const rec = bySlot.get(row.model);
        if (!rec) {
          continue;
        }
        // material visibility change OR the zone's box moved (item transforms
        // — the pack was selected for the old position) → the pack is stale;
        // mixed re-centers via the cleared eye, coarse re-packs when idle
        const b0 = rec.liveBounds;
        const b1 = row.bounds;
        const shifted =
          b0 !== null &&
          b1 !== null &&
          Math.abs(b0[0] + b0[3] - (b1[0] + b1[3])) +
            Math.abs(b0[1] + b0[4] - (b1[1] + b1[4])) +
            Math.abs(b0[2] + b0[5] - (b1[2] + b1[5])) >
            2; // box center moved > ~1 m
        const fracChanged = Math.abs(row.visibleFrac - rec.visibleFrac) > 0.005;
        if (fracChanged || shifted) {
          logEvent(
            `VIS-CHANGE ${rec.label} · ${shifted ? 'box moved' : ''}${shifted && fracChanged ? ' + ' : ''}` +
              `${fracChanged ? `visible ${(rec.visibleFrac * 100).toFixed(0)}%→${(row.visibleFrac * 100).toFixed(0)}%` : ''}`,
          );
          rec.packedEye = null;
          if (rec.variant === 'coarse') {
            rec.coarseStale = true;
          }
          planDirty = true;
        }
        rec.liveBounds = row.bounds;
        rec.denseBounds = row.dense;
        rec.visibleFrac = row.visibleFrac;
        rec.nearestDist = row.nearestDist;
      }
    })
    .catch(() => undefined)
    .finally(() => {
      visRefreshBusy = false;
    });
}

function isIdle(r: Renderer, now: number, idleMs: number): boolean {
  const cam = r.camera;
  if (cam.pointerActive || cam.animating) {
    return false;
  }
  return now - cam.lastInputT > idleMs && now - r.lastMoveT > idleMs;
}

// -----------------------------------------------------------------------------
// the commit queue
// -----------------------------------------------------------------------------

function startBurst(r: Renderer, now: number): void {
  if (burstStartT !== 0) {
    return;
  }
  burstStartT = now;
  burstSwaps = 0;
  burstBytes = 0;
  burstParseMs = 0;
  burstCommits = 0;
  burstQuiet = 0;
  burstVisRefreshes = 0;
  burst0 = {
    frames: r.frameCounter,
    scene: r.sceneFrames,
    resets: r.accumResets,
    held: r.heldFrames,
    gpuMs: r.gpuMsTotal,
  };
}

/** Can this slot be swapped without anyone noticing? Only when the draw
 * counts are maintained, describe the CURRENT scene (read after the camera
 * stopped and after the last loud commit), and say the slot drew nothing —
 * and the pack is not deficient, whose zero count proves nothing. */
function quietOk(r: Renderer, rec: ResidencyRecord): boolean {
  const deficient = rec.variant !== 'full' && rec.packDropped > 0;
  return (
    r.drawCountsUsable &&
    r.drawnPerModel[rec.slot] === 0 &&
    !deficient &&
    r.drawnResolvedT > Math.max(lastLoudCommitT, r.lastMoveT)
  );
}

function burstActive(): boolean {
  return inFlight.size > 0 || ready.length > 0 || (plan !== null && plan.next < plan.steps.length);
}

/** Launch a prepare; the commit lands through flushReady. */
function runSwap(
  r: Renderer,
  rec: ResidencyRecord,
  prepare: Promise<ReadyCommit> | ReadyCommit,
  expectedBytes: number,
  reason: string,
  detail = '',
  onFail?: () => void,
): void {
  const now = performance.now();
  settled = false;
  startBurst(r, now);
  burstSwaps++;
  logEvent(`START ${rec.label} [slot ${rec.slot}] ${rec.variant} · ${reason}${detail ? ` (${detail})` : ''}`);
  inFlight.add(rec.slot);
  pendingBytes.set(rec.slot, expectedBytes);
  startedAt.set(rec.slot, now);
  Promise.resolve(prepare)
    .then((c) => {
      burstParseMs += c.readyT - now;
      ready.push(c);
    })
    .catch((e: unknown) => {
      inFlight.delete(rec.slot);
      pendingBytes.delete(rec.slot);
      startedAt.delete(rec.slot);
      onFail?.();
      // a revive failure after the slot was freed leaves it dead — record that
      // honestly so the next plan retries it as a promote
      if (r.modelBytes(rec.slot) === 0) {
        rec.variant = 'unloaded';
      }
      rec.cooldownUntil = performance.now() + FAIL_COOLDOWN_MS;
      logEvent(`  FAIL ${rec.label} ${rec.variant} · ${e}`);
      console.warn(`residency: swap failed for ${rec.assetId}:`, e);
      planDirty = true;
      nextEvalAt = 0;
    });
}

/** Commit every prepared swap in one go — frees first — once nothing else is
 * parsing, the batch is full, or the oldest has waited long enough. One
 * flush is one re-render (none when every commit was quiet), and the slot
 * never renders with a zero-initialised state buffer. */
function flushReady(r: Renderer, now: number, pacing: Pacing): void {
  if (ready.length === 0) {
    return;
  }
  const parsing = inFlight.size - ready.length;
  const due = parsing <= 0 || ready.length >= pacing.maxInFlight || now - ready[0].readyT > READY_MAX_WAIT_MS;
  if (!due) {
    return;
  }
  const batch = ready.splice(0).sort((a, b) => a.order - b.order);
  let loud = false;
  let quiet = 0;
  let delta = 0;
  for (const c of batch) {
    inFlight.delete(c.slot);
    pendingBytes.delete(c.slot);
    const t0 = startedAt.get(c.slot) ?? c.readyT;
    startedAt.delete(c.slot);
    const rec = bySlot.get(c.slot);
    if (!rec) {
      logEvent(`  DROP ${c.label} · no longer tracked`);
      continue;
    }
    const before = r.modelBytes(c.slot);
    try {
      c.apply(r);
    } catch (e) {
      if (r.modelBytes(c.slot) === 0) {
        rec.variant = 'unloaded';
      }
      rec.cooldownUntil = now + FAIL_COOLDOWN_MS;
      logEvent(`  FAIL ${c.label} ${c.from} · ${e}`);
      console.warn(`residency: commit failed for ${rec.assetId}:`, e);
      planDirty = true;
      continue;
    }
    const after = r.modelBytes(c.slot);
    rec.cooldownUntil = now + c.cooldownMs;
    burstBytes += after;
    delta += after - before;
    if (c.quiet) {
      quiet++;
    } else {
      loud = true;
    }
    logEvent(
      `  END ${c.label} ${c.from}→${rec.variant} · ${mb(after)} MB · ${((c.readyT - t0) / 1000).toFixed(2)}s` +
        `${c.quiet ? ' · quiet' : ''}`,
    );
  }
  if (loud) {
    lastLoudCommitT = now;
  }
  burstCommits++;
  burstQuiet += quiet;
  logEvent(`COMMIT ${batch.length} swap(s) · ${quiet} quiet · ${delta >= 0 ? '+' : ''}${mb(delta)} MB`);
  nextEvalAt = 0; // keep issuing while the camera stays idle
}

// -----------------------------------------------------------------------------
// planning
// -----------------------------------------------------------------------------

/** One record → the plain view the pure planner (and the debug dump) sees. */
function zoneOf(rec: ResidencyRecord, r: Renderer | null, now: number): ZoneView {
  const flying = inFlight.has(rec.slot);
  const box = decisionBox(rec);
  return {
    slot: rec.slot,
    variant: rec.variant,
    bytesFull: rec.bytesFull,
    bytesCoarse: rec.bytesCoarse,
    bytesNow: flying ? (pendingBytes.get(rec.slot) ?? r?.modelBytes(rec.slot) ?? 0) : (r?.modelBytes(rec.slot) ?? 0),
    hasCoarse: rec.hasCoarse,
    coarseBroken: isCoarseBroken(rec, now),
    coarseStale: rec.coarseStale,
    nearestDist: rec.nearestDist,
    visibleFrac: rec.visibleFrac,
    denseRadius: spanOf(box) / 2,
    fullyInFrustum: r ? boxFullyInFrustum(r.viewProjMatrix, box) : false,
    clipCulled: r ? isClipCulled(r, box) : false,
    lastSeenT: rec.lastSeenT,
    seenStreakT: rec.seenStreakT,
    lastPromoteT: rec.lastPromoteT,
    lastDemoteT: rec.lastDemoteT,
    cooldownUntil: rec.cooldownUntil,
    packedEye: rec.packedEye,
    packedDir: rec.packedDir,
    packedTarget: rec.packedTarget,
    packLimited: rec.packLimited,
    inFlight: flying,
  };
}

const snapshotZones = (r: Renderer, now: number): ZoneView[] => [...bySlot.values()].map((rec) => zoneOf(rec, r, now));

/** Bytes a step will leave its slot with — what the budget projection and
 * the planner's in-flight view use. */
function expectedBytesOf(step: PlanAction, rec: ResidencyRecord, r: Renderer): number {
  switch (step.kind) {
    case 'restore-full':
    case 'promote-full':
      return rec.bytesFull;
    case 'promote-coarse':
      return rec.bytesCoarse;
    case 'refresh-coarse':
      return Math.max(rec.bytesCoarse, r.modelBytes(rec.slot));
    case 'promote-mixed':
      return Math.min(rec.bytesFull, step.targetBytes + rec.bytesCoarse);
    case 'demote':
      return step.to === 'coarse' ? rec.bytesCoarse : 0;
    default:
      return r.modelBytes(rec.slot);
  }
}

/** Σ over in-flight swaps of the bytes they are about to add or free. */
function pendingDelta(r: Renderer): number {
  let sum = 0;
  for (const [slot, expected] of pendingBytes) {
    sum += expected - r.modelBytes(slot);
  }
  return sum;
}

function launch(
  r: Renderer,
  step: PlanAction,
  rec: ResidencyRecord,
  eye: readonly [number, number, number],
  fwd: readonly [number, number, number],
  cuts: Cuts,
  pacing: Pacing,
): void {
  const cd = pacing.cooldownMs;
  const expected = expectedBytesOf(step, rec, r);
  switch (step.kind) {
    case 'restore-full':
      runSwap(r, rec, prepareFull(rec, 0), expected, step.reason);
      return;
    case 'promote-full':
      runSwap(r, rec, prepareFull(rec, cd), expected, step.reason, step.detail);
      return;
    case 'promote-coarse':
      runSwap(r, rec, prepareCoarse(r, rec, eye, cuts, 'repair', false, cd), expected, step.reason, step.detail);
      return;
    case 'refresh-coarse':
      // a failed refresh must not retry in a loop; the old pack still draws
      runSwap(
        r,
        rec,
        prepareCoarse(r, rec, eye, cuts, 'refresh', quietOk(r, rec), cd),
        expected,
        step.reason,
        '',
        () => {
          rec.coarseStale = false;
        },
      );
      return;
    case 'promote-mixed':
      runSwap(r, rec, prepareMixed(r, rec, eye, fwd, step.targetBytes, cuts, cd), expected, step.reason, step.detail);
      return;
    case 'demote': {
      const quiet = quietOk(r, rec);
      // demoted while drawing nothing → from THIS viewpoint the zone is occluded
      // or absent; the CPU seen-fallback must not re-promote it until we move
      if (r.drawCountsUsable && r.drawnPerModel[rec.slot] === 0) {
        rec.deadviewEye = [eye[0], eye[1], eye[2]];
      }
      runSwap(r, rec, prepareDemote(r, rec, eye, cuts, step.to, quiet, cd), expected, step.reason, step.detail);
      return;
    }
    default:
      return;
  }
}

/** Issue the plan's next steps while the in-flight cap allows. An allocation
 * waits until the frees before it have committed and its projected total
 * lands under the promote headroom; if nothing is in flight and it still
 * does not fit, the plan was built on estimates that missed — drop it and
 * re-plan on real numbers. */
function issueSteps(
  r: Renderer,
  budgetMb: number,
  eye: readonly [number, number, number],
  fwd: readonly [number, number, number],
  cuts: Cuts,
  pacing: Pacing,
): void {
  while (plan && plan.next < plan.steps.length && inFlight.size < pacing.maxInFlight) {
    const step = plan.steps[plan.next];
    const rec = step.kind === 'none' ? undefined : bySlot.get(step.slot);
    if (!rec) {
      plan.next++;
      continue;
    }
    if (step.kind !== 'demote' && budgetMb > 0) {
      const grow = expectedBytesOf(step, rec, r) - r.modelBytes(rec.slot);
      const projected = r.vramBuffers + r.vramTextures + pendingDelta(r) + Math.max(0, grow);
      if (grow > 0 && projected > budgetMb * MB * PROMOTE_HEADROOM) {
        if (inFlight.size > 0) {
          break; // frees still landing
        }
        dropPlan(`slot ${rec.slot} does not fit (${mb(projected)} MB projected)`);
        break;
      }
    }
    plan.next++;
    launch(r, step, rec, eye, fwd, cuts, pacing);
  }
  if (plan && plan.next >= plan.steps.length && inFlight.size === 0 && ready.length === 0) {
    plan = null; // completed — the next evaluation re-plans (expected: empty → settled)
    nextEvalAt = 0;
  }
}

function reportSettled(r: Renderer, now: number): void {
  const wall = now - burstStartT;
  const s = viewerState.get();
  const frames = r.frameCounter - burst0.frames;
  const scene = r.sceneFrames - burst0.scene;
  const resets = r.accumResets - burst0.resets;
  const held = r.heldFrames - burst0.held;
  const gpu = s.gpuTimings ? `${((r.gpuMsTotal - burst0.gpuMs) / 1000).toFixed(2)}s` : 'off';
  const line =
    `SETTLED [${s.vramSwapSpeed}] after ${(wall / 1000).toFixed(2)}s · ${burstSwaps} swaps · ` +
    `${(burstBytes / MB).toFixed(0)} MB · swap-time sum ${(burstParseMs / 1000).toFixed(2)}s ` +
    `(${((burstParseMs / Math.max(wall, 1)) * 100).toFixed(0)}% busy) · ` +
    `${burstCommits} commits (${burstQuiet} quiet) · ${frames} frames (${scene} scene, ${resets} accum resets, ` +
    `${held} held) · gpu Σ ${gpu} · ${burstVisRefreshes} vis refreshes`;
  logEvent(line);
  settleReports.push(line);
  if (settleReports.length > SETTLE_REPORT_CAP) {
    settleReports.shift();
  }
  burstStartT = 0;
}

/** One idle evaluation: plan if there is no plan, then issue steps. */
function evaluate(r: Renderer, now: number, pacing: Pacing): void {
  const s = viewerState.get();
  const eye = r.camera.eye();
  const fwd = r.camera.forward();
  const cuts: Cuts = { sizeM: s.vramCutSizeM, distM: s.vramCutDistM, dropHidden: s.vramDropHidden };
  if (!plan) {
    if (inFlight.size > 0 || ready.length > 0) {
      return; // let the previous plan's swaps land first
    }
    const res = planTargets({
      zones: snapshotZones(r, now),
      now,
      budgetMb: vramBudgetMb(s),
      used: r.vramBuffers + r.vramTextures,
      eye,
      fwd,
      cuts,
      pacing,
    });
    if (res.steps.length === 0) {
      settled = res.settled;
      if (res.settled && burstStartT !== 0) {
        reportSettled(r, now);
      }
      nextEvalAt = now + (res.settled ? SETTLED_RECHECK_MS : Math.max(pacing.evalMs, WAITING_RECHECK_MS));
      return;
    }
    plan = { steps: res.steps, next: 0 };
    settled = false;
    startBurst(r, now);
    const demotes = res.steps.filter((x) => x.kind === 'demote').length;
    const refreshes = res.steps.filter((x) => x.kind === 'refresh-coarse').length;
    const targetSum = res.targets.reduce((n, t) => n + t.targetBytes, 0);
    logEvent(
      `PLAN ${res.steps.length} steps (${demotes} demotes, ${res.steps.length - demotes - refreshes} promotes, ` +
        `${refreshes} refreshes) · targets Σ ${mb(targetSum)} MB / model budget ${mb(res.modelBudget)} MB`,
    );
  }
  issueSteps(r, vramBudgetMb(s), eye, fwd, cuts, pacing);
}

// -----------------------------------------------------------------------------
// public API
// -----------------------------------------------------------------------------

export const residency = {
  /** Track a loaded asset (called by the assets loader with the slot returned
   * from loadModelBytes and the variant it actually loaded). Assets without
   * cook-time bounds are left untracked — they count toward usage but are
   * never swapped (pinned). For a coarse-first load, full-detail GPU bytes are
   * estimated from the cooked file-size ratio until the first promote measures
   * them exactly. */
  register(
    entry: AssetEntry,
    slot: number,
    renderer: Renderer,
    variant: 'full' | 'coarse' = 'full',
    packDropped = 0,
  ): void {
    const bounds = entry.bounds?.full;
    if (bounds?.length !== 6) {
      return;
    }
    const measured = renderer.modelBytes(slot);
    const fileRatio = entry.coarse && entry.coarse.size > 0 ? entry.size / entry.coarse.size : 1;
    const now = performance.now();
    logEvent(`REGISTER ${entry.folder ? `${entry.folder}/` : ''}${entry.name} [slot ${slot}] as ${variant}`);
    bySlot.set(slot, {
      slot,
      assetId: entry.id,
      label: `${entry.folder ? `${entry.folder}/` : ''}${entry.name}`,
      store: entry.store,
      edges: entry.edges !== false,
      variant,
      bytesFull: variant === 'full' ? measured : Math.round(measured * fileRatio),
      bytesCoarse:
        entry.coarse === undefined
          ? 0
          : variant === 'coarse'
            ? measured
            : Math.max(1, Math.round(measured / fileRatio)),
      hasCoarse: entry.coarse !== undefined,
      coarseFails: 0,
      coarseRetryAt: 0,
      bounds,
      liveBounds: bounds,
      denseBounds: bounds,
      visibleFrac: 1,
      nearestDist: Infinity, // real value arrives with the first refresh
      lastSeenT: now,
      seenStreakT: now,
      packedEye: null,
      packedDir: null,
      packedTarget: 0,
      coarseStale: false,
      // a freshly loaded zone starts its dwell now — it must not be demoted
      // before it has been resident for a while
      lastPromoteT: now,
      lastDemoteT: 0,
      packLimited: true,
      cooldownUntil: 0,
      packDropped,
      deadviewEye: null,
    });
    visForce = true; // pick up this zone's real visibility on the next tick
    planDirty = true;
  },

  /** Manual unload of these slots — stop managing them. */
  unregister(indices: number[]): void {
    for (const i of indices) {
      bySlot.delete(i);
    }
    planDirty = true;
  },

  /** Scene cleared — forget everything. In-flight prepares resolve into a
   * flush that finds no record and drops them. */
  reset(): void {
    bySlot.clear();
    ready.length = 0;
    pendingBytes.clear();
    plan = null;
  },

  /** Suspend swaps (bulk loads, imports, hi-res captures) — calls nest. */
  pause(): void {
    pauseCount++;
  },

  resume(): void {
    pauseCount = Math.max(0, pauseCount - 1);
  },

  /** Per-frame hook (viewport tick, after renderer.frame). Cheap when off. */
  tick(r: Renderer, now: number): void {
    const s = viewerState.get();
    const pacing = PACING[s.vramSwapSpeed] ?? PACING.normal;
    if (pauseCount > 0) {
      r.holdAccumulation = false;
      return;
    }
    handleWake(now);
    if (vramBudgetMb(s) > 0) {
      refreshVisibility(r, now);
      refreshSeen(r, now);
      // a changed clipping volume invalidates every pack's clip-based cut set
      const clipKey = r.clipData ? r.clipData.join(',') : '';
      if (clipKey !== lastClipKey) {
        lastClipKey = clipKey;
        for (const rec of bySlot.values()) {
          rec.packedEye = null; // mixed packs re-centre
          if (rec.variant === 'coarse') {
            rec.coarseStale = true; // coarse packs refresh their cut set
          }
        }
        planDirty = true;
        logEvent('CLIP-CHANGE · invalidated every pack');
      }
    }
    flushReady(r, now, pacing);
    r.holdAccumulation = s.vramHoldAccum && vramBudgetMb(s) > 0 && burstActive();
    const settingsKey = `${vramBudgetMb(s)}|${s.vramCutSizeM}|${s.vramCutDistM}|${s.vramDropHidden}|${s.vramSwapSpeed}`;
    if (settingsKey !== lastSettingsKey) {
      lastSettingsKey = settingsKey;
      dropPlan('settings changed');
      nextEvalAt = 0;
    }
    if (planDirty) {
      planDirty = false;
      dropPlan('scene changed');
      nextEvalAt = 0;
    }
    if (now < nextEvalAt) {
      return;
    }
    nextEvalAt = now + pacing.evalMs;
    if (!isIdle(r, now, pacing.idleMs)) {
      dropPlan('camera moved');
      nextEvalAt = 0; // evaluate as soon as the camera rests
      return;
    }
    evaluate(r, now, pacing);
  },

  /** Activity snapshot for the viewport chip: swaps in flight (preparing or
   * waiting to commit) + whether the last idle evaluation found nothing
   * left to do. */
  activity(): { inFlight: number; settled: boolean } {
    return { inFlight: inFlight.size, settled };
  },

  /** Where an export must take this slot's geometry from: null when the slot
   * holds full detail (or is not budget-managed) and the GPU readback is the
   * truth; else the store + asset id of its full cook, because a coarse,
   * mixed or unloaded slot would export the budget's cuts. Callers pause the
   * manager for the export's duration so the answer stays true. */
  exportSource(slot: number): { store: string; assetId: string } | null {
    const rec = bySlot.get(slot);
    return rec && rec.variant !== 'full' ? { store: rec.store, assetId: rec.assetId } : null;
  },

  /** Tracked zones with no renderer slot right now — an export must still
   * include them (their DbModel and full cook are intact). */
  unloadedSlots(): number[] {
    const out: number[] = [];
    for (const rec of bySlot.values()) {
      if (rec.variant === 'unloaded') {
        out.push(rec.slot);
      }
    }
    return out;
  },

  /** Debug dump: current per-zone state + the recent swap event log, as text
   * for the clipboard (Settings → VRAM budget → Copy event log). */
  debugDump(r: Renderer | null): string {
    const now = performance.now();
    const s = viewerState.get();
    const eye = r?.camera.eye() ?? [0, 0, 0];
    const total = r ? r.vramBuffers + r.vramTextures : 0;
    const lines: string[] = [
      `VRAM budget debug — ${new Date().toISOString()}`,
      `budget ${vramBudgetMb(s)} MB · speed ${s.vramSwapSpeed} · cut ${s.vramCutSizeM} m / ${s.vramCutDistM} m · ` +
        `dropHidden ${s.vramDropHidden} · holdAccum ${s.vramHoldAccum}`,
      r
        ? `used ${(total / MB).toFixed(0)} MB (models ${(r.modelBytesTotal / MB).toFixed(0)} + ` +
          `targets/other ${((total - r.modelBytesTotal) / MB).toFixed(0)}) · eye ${eye.map((v) => v.toFixed(1)).join(', ')}`
        : 'no renderer',
      `tracked ${bySlot.size} · inFlight ${inFlight.size} (ready ${ready.length}) · ` +
        `plan ${plan ? `${plan.next}/${plan.steps.length}` : 'none'} · settled ${settled} · paused ${pauseCount}`,
      '',
      `CONVERGENCE (${settleReports.length} recent, newest last):`,
      ...(settleReports.length ? settleReports : ['  (none yet — settle once with a budget set)']),
      '',
      'ZONES (variant, prio, dist, radius, unseen, dwell since promote/demote, cooldown, packTarget, limited):',
    ];
    for (const rec of bySlot.values()) {
      const z = zoneOf(rec, r, now);
      lines.push(
        `  ${rec.label} [slot ${rec.slot}] ${rec.variant.padEnd(8)} ` +
          `prio ${priority(z, now).toExponential(2)} ` +
          `near ${rec.nearestDist.toFixed(0)}m R ${z.denseRadius.toFixed(0)}m vis ${(rec.visibleFrac * 100).toFixed(0)}% ` +
          `span ${spanOf(decisionBox(rec)).toFixed(0)}/${spanOf(rec.liveBounds ?? rec.bounds).toFixed(0)}m ` +
          `meshlets ${r?.modelMeshletCount(rec.slot) ?? 0} ` +
          `unseen ${((now - rec.lastSeenT) / 1000).toFixed(1)}s streak ${((now - rec.seenStreakT) / 1000).toFixed(1)}s ` +
          `sincePromote ${((now - rec.lastPromoteT) / 1000).toFixed(1)}s sinceDemote ${((now - rec.lastDemoteT) / 1000).toFixed(1)}s ` +
          `cooldown ${Math.max(0, (rec.cooldownUntil - now) / 1000).toFixed(1)}s ` +
          `bytes ${mb(r?.modelBytes(rec.slot) ?? 0)} MB ` +
          `packTarget ${(rec.packedTarget / MB).toFixed(0)} MB limited ${rec.packLimited} stale ${rec.coarseStale} ` +
          `dropped ${rec.packDropped}${rec.deadviewEye ? ' deadview' : ''}` +
          `${rec.coarseFails ? ` coarseFails ${rec.coarseFails}` : ''}${inFlight.has(rec.slot) ? ' in-flight' : ''}`,
      );
    }
    lines.push('', `EVENTS (${eventLog.length}, newest last):`, ...eventLog);
    return lines.join('\n');
  },

  clearLog(): void {
    eventLog.length = 0;
    settleReports.length = 0;
    logT0 = 0;
  },

  /** Debug-overlay snapshot: one entry per tracked zone with the box the
   * priority actually uses (visible items only) and its residency state. */
  debugRecords(): { bounds: readonly number[]; variant: Variant; inFlight: boolean; visibleFrac: number }[] {
    const out: { bounds: readonly number[]; variant: Variant; inFlight: boolean; visibleFrac: number }[] = [];
    for (const rec of bySlot.values()) {
      out.push({
        bounds: decisionBox(rec),
        variant: rec.variant,
        inFlight: inFlight.has(rec.slot),
        visibleFrac: rec.visibleFrac,
      });
    }
    return out;
  },

  /** Stats-panel summary: variant counts (only meaningful when the budget is on). */
  statsSummary(): { full: number; mixed: number; coarse: number; unloaded: number; tracked: number } {
    let full = 0;
    let mixed = 0;
    let coarse = 0;
    let unloaded = 0;
    for (const rec of bySlot.values()) {
      if (rec.variant === 'full') {
        full++;
      } else if (rec.variant === 'mixed') {
        mixed++;
      } else if (rec.variant === 'coarse') {
        coarse++;
      } else {
        unloaded++;
      }
    }
    return { full, mixed, coarse, unloaded, tracked: bySlot.size };
  },
};
