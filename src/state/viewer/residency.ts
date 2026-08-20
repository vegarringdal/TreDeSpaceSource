// VRAM-budget residency manager (DESIGN.md "VRAM budget & residency", v1).
//
// When `maxVramMb` is set and tracked VRAM exceeds it, the lowest-priority
// loaded models (smallest projected screen size) are DEMOTED to their coarse
// cooked variant — or fully unloaded when no coarse file exists — and PROMOTED
// back to full detail when the camera comes near and headroom allows.
// Invariants: exclusive residency (a model's coarse and full geometry are
// never on the GPU together), swaps only while the camera is idle, one swap in
// flight, and swaps never touch the modeldb hierarchy/states — the renderer
// slot is rebuilt in place with its itemBase preserved, then the item states
// are re-pushed. Manager state is main-thread only; `maxVramMb === 0` makes
// every tick a no-op.
import { transfer } from 'comlink';
import { boxFullyInFrustum, boxInFrustum } from '../../lib/math/frustum';
import { modelStoreDir, readFile } from '../../lib/opfs/opfs';
import { clipCulledSphere } from '../../lib/render/clipCull';
import type { Renderer } from '../../lib/render/renderer';
import type { AssetEntry } from '../assets/assets.state';
import { db } from './db';
import {
  type Cuts,
  type Pacing,
  type PlanAction,
  planResidency,
  priority,
  SEEN_GAP_MS,
  type Variant,
  type ZoneView,
} from './residency.plan';
import { applyStateUpdates } from './viewer.actions';
import { viewerState } from './viewer.state';

// -----------------------------------------------------------------------------
// types + constants
// -----------------------------------------------------------------------------

interface ResidencyRecord {
  slot: number;
  assetId: string;
  /** folder/name — the readable identity in the debug event log. */
  label: string;
  store: string;
  edges: boolean;
  variant: Variant;
  /** GPU bytes at full detail (measured at registration; promote headroom). */
  bytesFull: number;
  /** GPU bytes of the coarse pack (file-ratio estimate until first measured);
   * 0 without a coarse variant. Budgets the repair promote. */
  bytesCoarse: number;
  hasCoarse: boolean;
  /** Coarse file failed to read/parse — demote falls back to unload. */
  coarseBroken: boolean;
  /** World AABB [minx,miny,minz,maxx,maxy,maxz] from the asset entry. */
  bounds: readonly number[];
  /** AABB of the currently VISIBLE (non-hidden) items — null when everything
   * is hidden. Refreshed periodically from the worker; priority uses this so
   * hiding half a zone shrinks the box the camera is measured against. */
  liveBounds: readonly number[] | null;
  /** Outlier-resistant box of the visible items (mean ± 2σ of their centres,
   * clamped to the union). Every frustum/clip decision uses THIS, not the
   * union: one item parked far away must not inflate a zone until it swallows
   * the camera, the frustum or the clip volume. */
  denseBounds: readonly number[] | null;
  /** Fraction of items (with geometry) currently visible, 0..1. */
  visibleFrac: number;
  /** Distance to the NEAREST visible item at the last refresh — priority's
   * distance term. The union box is useless here: one outlier item makes a
   * distant zone's box swallow the camera and hijack every decision. */
  nearestDist: number;
  /** Last time this zone was on screen: drew meshlets (resident — i.e. passed
   * frustum + HiZ occlusion) or intersected the frustum (unloaded). */
  lastSeenT: number;
  /** Start of the current CONTINUOUS on-screen streak (promotion gate). */
  seenStreakT: number;
  /** Camera eye at the last MIXED pack — moving far enough from it re-packs
   * so the sharp region follows the camera through the zone. */
  packedEye: readonly [number, number, number] | null;
  /** Camera forward at the last MIXED pack — packs are view-dependent
   * (in-frustum items get the budget first), so TURNING far enough re-packs
   * even when standing on the same spot. */
  packedDir: readonly [number, number, number] | null;
  /** Byte budget the last MIXED pack was built with — when the available
   * headroom outgrows it (rebalancing freed memory while the camera stood
   * still), the zone re-packs to spend the new room. */
  packedTarget: number;
  /** The coarse pack's hidden/cut set is outdated (visibility changed) —
   * re-pack it on the next opportunity. */
  coarseStale: boolean;
  /** Completion times of the last promote/demote — minimum-dwell hysteresis
   * so an edge-of-view zone cannot cycle promote↔demote on small orbits. */
  lastPromoteT: number;
  lastDemoteT: number;
  /** The last mixed pack ran out of budget before covering every in-view
   * item — only then can a bigger budget grow it (regrow guard: re-packing a
   * saturated pack produces an identical result, i.e. pure churn). */
  packLimited: boolean;
  /** Consecutive rebalances performed FOR this zone that still did not make
   * it fit — past a cap it is parked so it stops evicting the scene. */
  starveCount: number;
  cooldownUntil: number;
  /** Items the CURRENT pack has no geometry for that are not hidden/clip-cut
   * (cooker-cut tiny items in a coarse variant, residency cuts, …). Such a
   * pack can draw nothing where the user looks, so a zero draw count is NOT
   * proof the zone is off screen — refreshSeen falls back to a CPU frustum
   * test for it. */
  packDropped: number;
  /** Eye position at the last demote of a resident zone that was drawing
   * nothing — from that viewpoint the zone is either occluded or absent, and
   * re-promoting it via the CPU fallback would just cycle. The fallback is
   * suppressed until the camera moves away or the GPU actually draws it. */
  deadviewEye: readonly [number, number, number] | null;
}

/** Settings → VRAM budget → Swap speed presets. */
const PACING: Record<'relaxed' | 'normal' | 'fast', Pacing> = {
  relaxed: { evalMs: 600, idleMs: 800, cooldownMs: 6000, maxInFlight: 1, margin: 2 },
  normal: { evalMs: 250, idleMs: 400, cooldownMs: 3000, maxInFlight: 2, margin: 1.5 },
  // Speed presets vary how OFTEN the planner acts, never how flimsy a
  // rebalance's justification may be: `margin` is the anti-churn guard. Fast
  // ran at 1.25 and converged in 113 s / 268 swaps / 550 MB against Normal's
  // 33 s / 176 / 261 MB — evicting on a 25% priority edge made the evicted
  // zone the next needy one, and the pair ping-ponged. Never take it below
  // Normal's.
  fast: { evalMs: 0, idleMs: 200, cooldownMs: 1500, maxInFlight: 4, margin: 1.5 },
};

const FAIL_COOLDOWN_MS = 30000;
/** How often the per-zone visible-item bounds are re-read from the worker. */
const VIS_REFRESH_MS = 2000;

// -----------------------------------------------------------------------------
// state
// -----------------------------------------------------------------------------

const bySlot = new Map<number, ResidencyRecord>();
let pauseCount = 0;
/** Slots with a swap currently in flight (bounded by the pacing preset). */
const inFlight = new Set<number>();
let nextEvalAt = 0;
let visRefreshAt = 0;
let visRefreshBusy = false;
/** Clip uniform seen at the last evaluation — a change invalidates every
 * pack's clip-based cut set, so packs are re-taken. */
let lastClipKey = '';
/** The last idle evaluation found nothing actionable (activity HUD state).
 * Cleared whenever a swap launches. */
let settled = false;
/** Convergence measurement: when the current burst of work started, how many
 * swaps it took and how many bytes it moved. Logged on settle so runs can be
 * compared across pacing presets (the v9 experiment). */
let burstStartT = 0;
let burstSwaps = 0;
let burstBytes = 0;
let burstParseMs = 0;
/** Settle reports kept separately from the event log so the debug dump can
 * print them at the TOP — the event list is long enough to be truncated when
 * pasted, and these lines are the measurement. */
const settleReports: string[] = [];
const SETTLE_REPORT_CAP = 12;

// -----------------------------------------------------------------------------
// debug event log (Settings → VRAM budget → Copy event log)
// -----------------------------------------------------------------------------

const LOG_CAP = 400;
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

// -----------------------------------------------------------------------------
// wake-up guard
// -----------------------------------------------------------------------------

/** A tick gap longer than this means the loop stopped, not that a frame ran late. */
const WAKE_GAP_MS = 2000;
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
  logEvent(`WAKE · ${(gap / 1000).toFixed(1)}s tick gap — re-baselined seen clocks, burst discarded`);
}

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

/** The box residency decisions are made against: the outlier-resistant dense
 * box when the worker has produced one, else the union. */
const decisionBox = (rec: ResidencyRecord): readonly number[] => rec.denseBounds ?? rec.liveBounds ?? rec.bounds;

/** Diagonal of a box — the debug dump prints dense/union so an outlier-
 * inflated zone is obvious at a glance. */
const spanOf = (b: readonly number[]): number => Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]);

/** Is this box provably outside every active clipping volume? Mirrors the
 * cull shader (clipCull.ts), conservatively: partial overlap counts as
 * visible, so a zone is only ever demoted for clipping when nothing of it
 * could draw. */
function isClipCulled(r: Renderer, b: readonly number[]): boolean {
  if (!r.clipData || !r.clipDataU32) {
    return false;
  }
  const center: [number, number, number] = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
  const radius = Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) / 2;
  return clipCulledSphere(r.clipData, r.clipDataU32, center, radius);
}

/** A demoted-while-drawing-nothing zone must move this far out of the failed
 * viewpoint before the CPU fallback may mark it seen again. */
const DEADVIEW_CLEAR_M = 5;

/** Update every record's lastSeenT: resident zones from the GPU's culled draw
 * counts (frustum + HiZ occlusion + clip, ~2 Hz readback); zones whose draw
 * counts cannot be trusted fall back to a CPU frustum + clip test. That is
 * unloaded slots (nothing to draw, by definition) and DEFICIENT packs — a
 * coarse/mixed pack that dropped visible items (cooker-cut tiny items,
 * residency cuts) can draw nothing where the user looks, so a zero draw count
 * proves nothing. Without the fallback such a zone reads permanently
 * offscreen and never promotes, at any budget (observed: a gutted zone in
 * plain view at 2 GB). The deadview guard keeps the fallback from cycling an
 * occluded zone: once it was resident here and drew nothing, it stays unseen
 * until the camera moves. */
function refreshSeen(r: Renderer, now: number): void {
  const vp = r.viewProjMatrix;
  const eye = r.camera.eye();
  for (const rec of bySlot.values()) {
    let seen = false;
    const drawn = r.drawnPerModel[rec.slot] > 0;
    const deficient = rec.variant !== 'full' && rec.packDropped > 0 && !drawn;
    if (r.modelMeshletCount(rec.slot) === 0 || deficient) {
      const de = rec.deadviewEye;
      const moved = !de || Math.hypot(eye[0] - de[0], eye[1] - de[1], eye[2] - de[2]) > DEADVIEW_CLEAR_M;
      if (moved) {
        rec.deadviewEye = null;
        const b = decisionBox(rec);
        if (b && boxInFrustum(vp, b)) {
          seen = true;
          if (r.clipData && r.clipDataU32) {
            const center: [number, number, number] = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
            const radius = Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) / 2;
            if (clipCulledSphere(r.clipData, r.clipDataU32, center, radius)) {
              seen = false; // provably clipped away — not seen
            }
          }
        }
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

/** Throttled worker round-trip pulling each zone's visible-item AABB +
 * visible fraction into the records (single flight, off the swap path). */
function refreshVisibility(now: number, eye: readonly [number, number, number]): void {
  if (now < visRefreshAt || visRefreshBusy || bySlot.size === 0) {
    return;
  }
  visRefreshAt = now + VIS_REFRESH_MS;
  visRefreshBusy = true;
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
        if (Math.abs(row.visibleFrac - rec.visibleFrac) > 0.005 || shifted) {
          logEvent(
            `VIS-CHANGE ${rec.label} · ${shifted ? 'box moved' : ''}` +
              `${shifted && Math.abs(row.visibleFrac - rec.visibleFrac) > 0.005 ? ' + ' : ''}` +
              `${Math.abs(row.visibleFrac - rec.visibleFrac) > 0.005 ? `visible ${(rec.visibleFrac * 100).toFixed(0)}%→${(row.visibleFrac * 100).toFixed(0)}%` : ''}`,
          );
          rec.packedEye = null;
          if (rec.variant === 'coarse') {
            rec.coarseStale = true;
          }
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

/** Load variant bytes, repack in the worker (all fallible work up front), then
 * atomically rebuild the renderer slot and re-push item states. The dead slot
 * is only observable within one task, so no frame renders a hole. */
async function swapVariant(r: Renderer, rec: ResidencyRecord, file: string, to: Variant): Promise<void> {
  const bytes = await readFile(await modelStoreDir(rec.store), file);
  const packed = await db.repackModel(rec.slot, transfer(bytes, [bytes]));
  if (!bySlot.has(rec.slot)) {
    return; // unloaded/cleared while we were parsing — drop the swap
  }
  r.removeModels([rec.slot]);
  r.reviveModel(rec.slot, packed, { edges: rec.edges });
  applyStateUpdates(await db.statesFor([rec.slot]));
  rec.variant = to;
  rec.packedEye = null;
  rec.packedDir = null;
  rec.packedTarget = 0;
  rec.packDropped = packed.packDropped;
}

/** Mixed promote (tier 2.5): the items nearest the camera come from the full
 * file — greedily up to `targetBytes` — and the remainder from the coarse
 * file, packed into one slot. The sharp region is re-centered by re-packing
 * when the camera moves far enough from `packedEye`. */
async function promoteMixed(
  r: Renderer,
  rec: ResidencyRecord,
  eye: readonly [number, number, number],
  fwd: readonly [number, number, number],
  targetBytes: number,
  cuts: Cuts,
): Promise<void> {
  rec.lastPromoteT = performance.now();
  const dir = await modelStoreDir(rec.store);
  const fullBytes = await readFile(dir, `${rec.assetId}.tdp`);
  const coarseBytes = await readFile(dir, `${rec.assetId}.coarse.tdp`);
  const packed = await db.repackModelMixed(
    rec.slot,
    transfer(fullBytes, [fullBytes]),
    transfer(coarseBytes, [coarseBytes]),
    eye,
    targetBytes,
    cuts,
    r.viewProjMatrix,
    r.clipData,
  );
  if (!bySlot.has(rec.slot)) {
    return; // unloaded/cleared while we were parsing — drop the swap
  }
  r.removeModels([rec.slot]);
  r.reviveModel(rec.slot, packed, { edges: rec.edges });
  applyStateUpdates(await db.statesFor([rec.slot]));
  rec.variant = 'mixed';
  rec.packedEye = [eye[0], eye[1], eye[2]];
  rec.packedDir = [fwd[0], fwd[1], fwd[2]];
  rec.packedTarget = targetBytes;
  rec.packLimited = packed.fullBudgetLimited;
  rec.packDropped = packed.packDropped;
}

/** Build (or rebuild) this zone's COARSE pack with the current cut set. Also
 * the refresh path for a stale coarse pack after hide/unhide — that must NOT
 * go through demote(), whose stage-two rule would unload the zone instead
 * (the promote→coarse→unload→promote churn the director reported). */
async function packCoarse(
  r: Renderer,
  rec: ResidencyRecord,
  eye: readonly [number, number, number],
  cuts: Cuts,
): Promise<void> {
  const bytes = await readFile(await modelStoreDir(rec.store), `${rec.assetId}.coarse.tdp`);
  const packed = await db.repackModelCoarse(rec.slot, transfer(bytes, [bytes]), eye, cuts, r.clipData);
  if (!bySlot.has(rec.slot)) {
    return; // unloaded/cleared while we were parsing — drop the swap
  }
  r.removeModels([rec.slot]);
  r.reviveModel(rec.slot, packed, { edges: rec.edges });
  applyStateUpdates(await db.statesFor([rec.slot]));
  rec.variant = 'coarse';
  rec.packedEye = null;
  rec.packedDir = null;
  rec.packedTarget = 0;
  rec.coarseStale = false;
  rec.packDropped = packed.packDropped;
  // measured is better than the file-ratio estimate; cut-dependent, so only
  // ever grow the estimate (a heavily cut pack must not shrink the budget
  // the next repair plans with)
  rec.bytesCoarse = Math.max(rec.bytesCoarse, r.modelBytes(rec.slot));
}

/** Refresh a stale coarse pack in place (hide/unhide changed its dropped-item
 * set). Never changes the residency level, so it is not a demote. */
async function refreshCoarse(
  r: Renderer,
  rec: ResidencyRecord,
  eye: readonly [number, number, number],
  cuts: Cuts,
): Promise<void> {
  try {
    await packCoarse(r, rec, eye, cuts);
  } catch (e) {
    rec.coarseStale = false; // don't retry in a loop; the old pack still draws
    console.warn(`residency: coarse refresh failed for ${rec.assetId}:`, e);
  }
}

async function demote(
  r: Renderer,
  rec: ResidencyRecord,
  eye: readonly [number, number, number],
  cuts: Cuts,
): Promise<void> {
  rec.lastDemoteT = performance.now();
  // demoted while drawing nothing → from THIS viewpoint the zone is occluded
  // or absent; the CPU seen-fallback must not re-promote it until we move
  if (r.drawnPerModel[rec.slot] === 0) {
    rec.deadviewEye = [eye[0], eye[1], eye[2]];
  }
  const unload = () => {
    r.removeModels([rec.slot]);
    rec.variant = 'unloaded';
    rec.coarseStale = false;
    rec.packedEye = null;
    rec.packedDir = null;
    rec.packedTarget = 0;
    rec.packDropped = 0; // unloaded zones use the 0-meshlet CPU path anyway
  };
  // a fully hidden zone renders nothing from either variant — unload outright
  // (frees ALL its VRAM); unhiding raises its priority and promotes it back
  if (rec.visibleFrac === 0) {
    unload();
    return;
  }
  // second demote stage: an already-coarse zone can only give up more by
  // unloading — callers only pick coarse victims while they are offscreen
  if (rec.variant === 'coarse') {
    unload();
    return;
  }
  if (rec.hasCoarse && !rec.coarseBroken) {
    try {
      await packCoarse(r, rec, eye, cuts);
      return;
    } catch (e) {
      rec.coarseBroken = true;
      console.warn(`residency: coarse swap failed for ${rec.assetId}, falling back to unload:`, e);
    }
  }
  // no/broken coarse: free the GPU slot, keep the DbModel (tree/states live)
  unload();
}

async function promote(r: Renderer, rec: ResidencyRecord): Promise<void> {
  rec.lastPromoteT = performance.now();
  await swapVariant(r, rec, `${rec.assetId}.tdp`, 'full');
  rec.bytesFull = r.modelBytes(rec.slot);
}

function runSwap(
  r: Renderer,
  rec: ResidencyRecord,
  action: (r: Renderer, rec: ResidencyRecord) => Promise<void>,
  cooldownMs: number,
  reason: string,
  detail = '',
): void {
  settled = false;
  const from = rec.variant;
  const t0 = performance.now();
  if (burstStartT === 0) {
    burstStartT = t0; // first swap of a burst — start the convergence clock
    burstSwaps = 0;
    burstBytes = 0;
    burstParseMs = 0;
  }
  burstSwaps++;
  const mb = (b: number) => (b / 1048576).toFixed(1);
  logEvent(`START ${rec.label} [slot ${rec.slot}] ${from} · ${reason}${detail ? ` (${detail})` : ''}`);
  inFlight.add(rec.slot);
  action(r, rec)
    .then(() => {
      rec.cooldownUntil = performance.now() + cooldownMs;
      const dt = performance.now() - t0;
      burstBytes += r.modelBytes(rec.slot);
      burstParseMs += dt;
      logEvent(
        `  END ${rec.label} ${from}→${rec.variant} · ${mb(r.modelBytes(rec.slot))} MB · ` +
          `${(dt / 1000).toFixed(2)}s`,
      );
    })
    .catch((e) => {
      // a revive failure after the slot was freed leaves it dead — record that
      // honestly so the manager retries it as a promote later
      if (r.modelBytes(rec.slot) === 0) {
        rec.variant = 'unloaded';
      }
      rec.cooldownUntil = performance.now() + FAIL_COOLDOWN_MS;
      logEvent(`  FAIL ${rec.label} ${from} · ${e}`);
      console.warn(`residency: swap failed for ${rec.assetId}:`, e);
    })
    .finally(() => {
      inFlight.delete(rec.slot);
      nextEvalAt = 0; // keep swapping back-to-back while the camera stays idle
    });
}

/** One record → the plain view the pure planner (and the debug dump) sees. */
function zoneOf(rec: ResidencyRecord, r: Renderer | null): ZoneView {
  return {
    slot: rec.slot,
    variant: rec.variant,
    bytesFull: rec.bytesFull,
    bytesCoarse: rec.bytesCoarse,
    bytesNow: r?.modelBytes(rec.slot) ?? 0,
    hasCoarse: rec.hasCoarse,
    coarseBroken: rec.coarseBroken,
    coarseStale: rec.coarseStale,
    nearestDist: rec.nearestDist,
    visibleFrac: rec.visibleFrac,
    fullyInFrustum: r ? boxFullyInFrustum(r.viewProjMatrix, decisionBox(rec)) : false,
    clipCulled: r ? isClipCulled(r, decisionBox(rec)) : false,
    lastSeenT: rec.lastSeenT,
    seenStreakT: rec.seenStreakT,
    lastPromoteT: rec.lastPromoteT,
    lastDemoteT: rec.lastDemoteT,
    cooldownUntil: rec.cooldownUntil,
    packedEye: rec.packedEye,
    packedDir: rec.packedDir,
    packedTarget: rec.packedTarget,
    packLimited: rec.packLimited,
    starveCount: rec.starveCount,
    inFlight: inFlight.has(rec.slot),
  };
}

const snapshotZones = (r: Renderer): ZoneView[] => [...bySlot.values()].map((rec) => zoneOf(rec, r));

/** Execute the planner's decision (the only place that mutates residency). */
function applyAction(
  r: Renderer,
  action: PlanAction,
  eye: readonly [number, number, number],
  fwd: readonly [number, number, number],
  cuts: Cuts,
  pacing: Pacing,
): void {
  if (action.kind === 'none') {
    // Convergence report — the v9 experiment's measurement. Wall time is what
    // you feel; the swap-time sum against it shows whether the run was limited
    // by the worker (sum ≈ wall × concurrency) or by policy throttles
    // (sum ≪ wall, i.e. mostly waiting).
    if (action.settled && burstStartT !== 0 && inFlight.size === 0) {
      const wall = performance.now() - burstStartT;
      const speed = viewerState.get().vramSwapSpeed;
      const line =
        `SETTLED [${speed}] after ${(wall / 1000).toFixed(2)}s · ${burstSwaps} swaps · ` +
        `${(burstBytes / 1048576).toFixed(0)} MB · swap-time sum ${(burstParseMs / 1000).toFixed(2)}s ` +
        `(${((burstParseMs / Math.max(wall, 1)) * 100).toFixed(0)}% busy)`;
      logEvent(line);
      settleReports.push(line);
      if (settleReports.length > SETTLE_REPORT_CAP) {
        settleReports.shift();
      }
      burstStartT = 0;
    }
    settled = action.settled;
    return;
  }
  const rec = bySlot.get(action.slot);
  if (!rec) {
    return;
  }
  switch (action.kind) {
    case 'restore-full':
      runSwap(r, rec, promote, 0, action.reason);
      return;
    case 'refresh-coarse':
      runSwap(r, rec, (rr, rc) => refreshCoarse(rr, rc, eye, cuts), pacing.cooldownMs, action.reason);
      return;
    case 'demote':
      if (action.reason === 'rebalance') {
        // the starving zone paid for this eviction — count it against its cap
        for (const z of bySlot.values()) {
          if (action.detail.startsWith(`for slot ${z.slot} `)) {
            z.starveCount++;
          }
        }
      }
      runSwap(r, rec, (rr, rc) => demote(rr, rc, eye, cuts), pacing.cooldownMs, action.reason, action.detail);
      return;
    case 'promote-coarse':
      // the repair rung: unloaded → coarse (existence beats sharpness)
      rec.starveCount = 0;
      runSwap(
        r,
        rec,
        async (rr, rc) => {
          rc.lastPromoteT = performance.now();
          try {
            await packCoarse(rr, rc, eye, cuts);
          } catch (e) {
            rc.coarseBroken = true; // don't retry a broken coarse file forever
            throw e;
          }
        },
        pacing.cooldownMs,
        action.reason,
        action.detail,
      );
      return;
    case 'promote-full':
      rec.starveCount = 0;
      runSwap(r, rec, promote, pacing.cooldownMs, action.reason, action.detail);
      return;
    case 'promote-mixed': {
      rec.starveCount = 0;
      const target = action.targetBytes;
      runSwap(
        r,
        rec,
        (rr, rc) => promoteMixed(rr, rc, eye, fwd, target, cuts),
        pacing.cooldownMs,
        action.reason,
        action.detail,
      );
      return;
    }
    case 'park':
      rec.starveCount = 0;
      rec.cooldownUntil = action.untilT;
      logEvent(`PARK ${rec.label} · ${action.reason}`);
      return;
  }
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
      coarseBroken: false,
      bounds,
      liveBounds: bounds,
      denseBounds: bounds,
      visibleFrac: 1,
      nearestDist: Infinity, // real value arrives with the first refresh
      lastSeenT: performance.now(),
      seenStreakT: performance.now(),
      packedEye: null,
      packedDir: null,
      packedTarget: 0,
      coarseStale: false,
      // a freshly loaded zone starts its dwell now — it must not be demoted
      // before it has been resident for a while
      lastPromoteT: performance.now(),
      lastDemoteT: 0,
      packLimited: true,
      starveCount: 0,
      cooldownUntil: 0,
      packDropped,
      deadviewEye: null,
    });
    visRefreshAt = 0; // pick up this zone's real visibility on the next tick
  },

  /** Manual unload of these slots — stop managing them. */
  unregister(indices: number[]): void {
    for (const i of indices) {
      bySlot.delete(i);
    }
  },

  /** Scene cleared — forget everything. */
  reset(): void {
    bySlot.clear();
  },

  /** Suspend swaps (bulk loads, imports) — calls nest. */
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
      return;
    }
    handleWake(now);
    if (s.maxVramMb > 0) {
      refreshVisibility(now, r.camera.eye()); // cheap + throttled; runs even while swaps queue
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
        logEvent('CLIP-CHANGE · invalidated every pack');
      }
    }
    if (inFlight.size >= pacing.maxInFlight || now < nextEvalAt) {
      return;
    }
    nextEvalAt = now + pacing.evalMs;
    if (!isIdle(r, now, pacing.idleMs)) {
      return;
    }

    const eye = r.camera.eye();
    const fwd = r.camera.forward();
    const cuts: Cuts = { sizeM: s.vramCutSizeM, distM: s.vramCutDistM, dropHidden: s.vramDropHidden };
    const action = planResidency({
      zones: snapshotZones(r),
      now,
      budgetMb: s.maxVramMb,
      used: r.vramBuffers + r.vramTextures,
      eye,
      fwd,
      cuts,
      pacing,
    });
    applyAction(r, action, eye, fwd, cuts, pacing);
  },

  /** Activity snapshot for the viewport chip: swaps in flight + whether the
   * last idle evaluation found nothing left to do. */
  activity(): { inFlight: number; settled: boolean } {
    return { inFlight: inFlight.size, settled };
  },

  /** Debug dump: current per-zone state + the recent swap event log, as text
   * for the clipboard (Settings → VRAM budget → Copy event log). */
  debugDump(r: Renderer | null): string {
    const now = performance.now();
    const s = viewerState.get();
    const eye = r?.camera.eye() ?? [0, 0, 0];
    const lines: string[] = [
      `VRAM budget debug — ${new Date().toISOString()}`,
      `budget ${s.maxVramMb} MB · speed ${s.vramSwapSpeed} · cut ${s.vramCutSizeM} m / ${s.vramCutDistM} m · ` +
        `dropHidden ${s.vramDropHidden}`,
      r
        ? `used ${((r.vramBuffers + r.vramTextures) / 1048576).toFixed(0)} MB ` +
          `(buf ${(r.vramBuffers / 1048576).toFixed(0)} + tex ${(r.vramTextures / 1048576).toFixed(0)}) · ` +
          `eye ${eye.map((v) => v.toFixed(1)).join(', ')}`
        : 'no renderer',
      `tracked ${bySlot.size} · inFlight ${inFlight.size} · settled ${settled} · paused ${pauseCount}`,
      '',
      `CONVERGENCE (${settleReports.length} recent, newest last):`,
      ...(settleReports.length ? settleReports : ['  (none yet — settle once with a budget set)']),
      '',
      'ZONES (variant, prio, dist, unseen, dwell since promote/demote, cooldown, packTarget, limited):',
    ];
    for (const rec of bySlot.values()) {
      lines.push(
        `  ${rec.label} [slot ${rec.slot}] ${rec.variant.padEnd(8)} ` +
          `prio ${priority(zoneOf(rec, r), now).toExponential(2)} ` +
          `near ${rec.nearestDist.toFixed(0)}m vis ${(rec.visibleFrac * 100).toFixed(0)}% ` +
          `span ${spanOf(decisionBox(rec)).toFixed(0)}/${spanOf(rec.liveBounds ?? rec.bounds).toFixed(0)}m ` +
          `meshlets ${r?.modelMeshletCount(rec.slot) ?? 0} ` +
          `unseen ${((now - rec.lastSeenT) / 1000).toFixed(1)}s streak ${((now - rec.seenStreakT) / 1000).toFixed(1)}s ` +
          `sincePromote ${((now - rec.lastPromoteT) / 1000).toFixed(1)}s sinceDemote ${((now - rec.lastDemoteT) / 1000).toFixed(1)}s ` +
          `cooldown ${Math.max(0, (rec.cooldownUntil - now) / 1000).toFixed(1)}s ` +
          `bytes ${(r?.modelBytes(rec.slot) ?? 0) / 1048576 > 0 ? ((r?.modelBytes(rec.slot) ?? 0) / 1048576).toFixed(1) : '0'} MB ` +
          `packTarget ${(rec.packedTarget / 1048576).toFixed(0)} MB limited ${rec.packLimited} stale ${rec.coarseStale} ` +
          `dropped ${rec.packDropped}${rec.deadviewEye ? ' deadview' : ''}`,
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
