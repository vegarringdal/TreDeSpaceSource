// The VRAM-budget decision core, as a PURE function: given a snapshot of the
// tracked zones plus budget/camera/settings, it computes the residency level
// every zone SHOULD have (the target set) and the ordered steps that get there.
// No GPU, no worker, no clock — so the whole coarse/mixed/full/unloaded state
// machine is unit-testable (tests/residency.plan.test.ts).
//
// v2 (target set): one evaluation ranks every zone once and fills the budget
// in rank order — floors (coarse) first, then detail — so each zone moves at
// most once per camera rest and the diff is executed as a batch: frees before
// allocations. v1 emitted one greedy action per evaluation and reached the
// same state through hundreds of swaps (176 for the measured convergence).
//
// residency.ts owns the side effects: it builds the snapshot, executes the
// steps, and keeps the bookkeeping (timestamps, cooldowns).

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

export type Variant = 'full' | 'mixed' | 'coarse' | 'unloaded';

/** One zone as the planner sees it — plain data, no renderer/worker handles. */
export interface ZoneView {
  slot: number;
  variant: Variant;
  /** GPU bytes the zone would occupy at full detail (estimated while coarse). */
  bytesFull: number;
  /** GPU bytes its coarse pack occupies (estimated until first measured);
   * 0 when the zone has no coarse variant. The repair promote budgets on it. */
  bytesCoarse: number;
  /** GPU bytes it occupies right now (for an in-flight zone: the bytes its
   * pending commit will leave it with). */
  bytesNow: number;
  hasCoarse: boolean;
  coarseBroken: boolean;
  /** Coarse pack's hidden/cut set is out of date (hide/unhide happened). */
  coarseStale: boolean;
  /** Distance to the nearest non-hidden item (Infinity = unknown/none). */
  nearestDist: number;
  /** Fraction of items with geometry that are not hidden. */
  visibleFrac: number;
  /** Half diagonal of the zone's decision box (the outlier-resistant dense
   * box of its visible items) — the size term of the coverage priority. */
  denseRadius: number;
  /** Whether the zone's visible box lies entirely inside the frustum. */
  fullyInFrustum: boolean;
  /** Provably outside the active clipping volumes — nothing of it can draw.
   * Unlike "unseen", this is a deliberate user action, so it demotes at once
   * instead of waiting out the offscreen grace. */
  clipCulled: boolean;
  lastSeenT: number;
  seenStreakT: number;
  lastPromoteT: number;
  lastDemoteT: number;
  cooldownUntil: number;
  packedEye: readonly [number, number, number] | null;
  packedDir: readonly [number, number, number] | null;
  packedTarget: number;
  packLimited: boolean;
  inFlight: boolean;
}

export interface Cuts {
  sizeM: number;
  distM: number;
  dropHidden: boolean;
}

export interface Pacing {
  evalMs: number;
  idleMs: number;
  cooldownMs: number;
  maxInFlight: number;
  margin: number;
}

export interface PlanInput {
  zones: readonly ZoneView[];
  now: number;
  /** MiB budget; 0 = feature off (restore everything to full). */
  budgetMb: number;
  /** Tracked VRAM bytes in use (all models + textures). */
  used: number;
  eye: readonly [number, number, number];
  fwd: readonly [number, number, number];
  cuts: Cuts;
  pacing: Pacing;
}

export type PlanAction =
  | { kind: 'none'; settled: boolean }
  | { kind: 'restore-full'; slot: number; reason: string }
  | { kind: 'refresh-coarse'; slot: number; reason: string }
  | { kind: 'demote'; slot: number; to: 'coarse' | 'unloaded'; reason: string; detail: string }
  | { kind: 'promote-coarse'; slot: number; reason: string; detail: string }
  | { kind: 'promote-full'; slot: number; reason: string; detail: string }
  | { kind: 'promote-mixed'; slot: number; targetBytes: number; reason: string; detail: string };

/** The level a zone should hold after this rest, and the bytes it reserves. */
export interface ZoneTarget {
  slot: number;
  level: Variant;
  targetBytes: number;
  reason: string;
}

export interface ResidencyPlan {
  targets: ZoneTarget[];
  /** Ordered: refreshes, then frees (unloads before coarse demotes), then
   * promotes (repairs before detail), then mixed re-packs. */
  steps: PlanAction[];
  /** Nothing to do and nothing waiting on a cooldown/dwell. */
  settled: boolean;
  /** A zone would move up but is blocked only by a cooldown or dwell. */
  waiting: boolean;
  /** Bytes the budget leaves for models once render targets and shared
   * buffers are subtracted. */
  modelBudget: number;
}

// -----------------------------------------------------------------------------
// tuning constants
// -----------------------------------------------------------------------------

/** A zone unseen longer than this has its priority scaled down. */
export const OFFSCREEN_GRACE_MS = 4000;
export const OFFSCREEN_FACTOR = 0.1;
/** The proactive offscreen demote waits longer — it is the churn-prone one. */
export const PROACTIVE_GRACE_MS = 10000;
/** Minimum time at a level before the opposite direction may touch a zone. */
export const MIN_DWELL_MS = 8000;
/** Promotion admits zones within cut distance; the demote exit line sits this
 * factor beyond it, so drift around the ring cannot cycle a zone. */
export const DIST_EXIT_FACTOR = 1.25;
/** A zone must be seen this recently (and continuously) to be promotable. */
export const SEEN_GAP_MS = 1500;
export const SEEN_STREAK_MS = 2000;
/** A mixed pack is only worth its parse cost above this much headroom —
 * below it the pack is indistinguishable from plain coarse, so the zone is
 * left coarse rather than paying two file parses for nothing. This is the
 * comfortable-budget CAP; the effective floor scales with the zone (below). */
export const MIXED_MIN_BYTES = 32 * 1048576;
/** Adaptive mixed floor: never below this many bytes… */
export const MIXED_MIN_ABS_BYTES = 4 * 1048576;
/** …and never more than this fraction of the zone's full size — "worth it"
 * depends on the zone: a 4 MB sharp region in a 10 MB zone is 40% of it and
 * plainly visible, while the same 4 MB in a 200 MB zone is noise. The fixed
 * 32 MB floor blocked small zones at small budgets (observed at 256 MB: 4 MB
 * of headroom, nearest zones stuck with no legal move). */
export const MIXED_MIN_ZONE_FRAC = 0.25;
/** No single zone may claim more than this share of the budget for its
 * full-detail region. Without it the nearest zone takes everything and every
 * other visible zone gets a meaningless 1–2 MB target (observed at 256 MB). */
export const MIXED_MAX_SHARE = 0.3;
/** Slack left in the greedy fill for the coarse remainder + estimate error. */
export const MIXED_FILL_FACTOR = 0.85;
/** Re-pack a mixed zone when its budget grew by this factor AND this much. */
export const MIXED_REGROW_FACTOR = 1.15;
export const MIXED_REGROW_MIN_BYTES = 16 * 1048576;
/** Re-pack when the view direction rotated past ~15° (dot below this). The
 * mixed pack's full-detail set is chosen from the frustum, so it must follow
 * the view reasonably closely or it stops matching what you look at. */
export const MIXED_REPACK_DOT = 0.966;
/** Promotions must land at or under this fraction of the budget (the total,
 * render targets included — zones already resident may sit between this
 * line and the ceiling). */
export const PROMOTE_HEADROOM = 0.9;
/** Plain full (rather than a mixed pack) once the zone fits this comfortably. */
export const FULL_COMFORT_FACTOR = 2;
/** Pressure inversion: a zone holding geometry may be stripped of its coarse
 * floor to fund a zone that outranks it by at least this priority factor. In
 * the ranked fill this is the bonus a holder gets over an unloaded competitor
 * for floor bytes — the controlled exception to the no-holes floor. At
 * starvation budgets the floor itself consumes everything and the zone 2 m
 * from the camera sits unloaded while a zone 26 m away keeps its coarse
 * (observed at 256 MB).
 *
 * 2 ≈ "the holder is ~1.4× farther away". Any value above 1 is churn-safe:
 * dominance is strict, so a stripped zone can never out-rank its own funder.
 * (20 was tried first and froze holes in the 16–25 m band: the observed
 * mid-band ratios are only 2.2–3.6×, so a conservative guard refuses exactly
 * the trades that matter.) */
export const COARSE_STRIP_RATIO = 2;
/** The smallest radius the coverage term uses — a zone that is one tiny item
 * must still rank by distance rather than vanish. */
const MIN_RADIUS_M = 1;

const MB = 1048576;

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

/** Priority = projected coverage: (R / (R + d))² for the dense-box radius R
 * and the distance d to the nearest visible item — bounded to (0, 1], 1 with
 * the camera inside the box, size-aware (a 50 m zone at 50 m ranks like a
 * 5 m zone at 5 m). The distance stays the NEAREST-item distance: the box
 * distance is unusable, one outlier item inflates a far zone's box until it
 * contains the camera. Off-screen zones are scaled down after a grace
 * period; fully hidden or distance-unknown zones score 0. */
export function priority(z: ZoneView, now: number): number {
  if (z.visibleFrac === 0 || !Number.isFinite(z.nearestDist)) {
    return 0;
  }
  const r = Math.max(MIN_RADIUS_M, z.denseRadius);
  const coverage = (r / (r + z.nearestDist)) ** 2;
  return now - z.lastSeenT > OFFSCREEN_GRACE_MS ? coverage * OFFSCREEN_FACTOR : coverage;
}

const isResident = (v: Variant) => v === 'full' || v === 'mixed';

const LEVEL_ORDER: Record<Variant, number> = { unloaded: 0, coarse: 1, mixed: 2, full: 3 };

/** Per-zone minimum for a mixed pack: MIXED_MIN_BYTES at comfortable sizes,
 * scaled down to a quarter of the zone's full size, never below the absolute
 * floor. See MIXED_MIN_ZONE_FRAC for why the fixed floor was wrong. */
export function mixedFloor(z: ZoneView): number {
  return Math.max(MIXED_MIN_ABS_BYTES, Math.min(MIXED_MIN_BYTES, z.bytesFull * MIXED_MIN_ZONE_FRAC));
}

const mb = (b: number) => (b / MB).toFixed(1);

/** Full-detail byte target for one mixed pack: the free headroom, minus slack
 * for the coarse remainder, capped so a single zone cannot claim the whole
 * budget and leave every other visible zone with nothing. */
const mixedTarget = (avail: number, budget: number) => Math.min(avail * MIXED_FILL_FACTOR, budget * MIXED_MAX_SHARE);

/** Bytes a mixed pack of this target will occupy: the sharp region plus the
 * coarse remainder, never more than the full pack. */
const mixedBytes = (z: ZoneView, target: number) => Math.min(z.bytesFull, target + z.bytesCoarse);

/** Why a mixed zone re-packs, or null when its pack still matches the view. */
function repackReason(z: ZoneView, input: PlanInput, targetBytes: number): string | null {
  const { eye, fwd } = input;
  // the move threshold scales with distance: walking 10 m barely changes
  // what a zone 40 m away should hold
  const repackDist = Math.max(10, 0.3 * z.nearestDist);
  const pe = z.packedEye;
  if (!pe || Math.hypot(eye[0] - pe[0], eye[1] - pe[1], eye[2] - pe[2]) > repackDist) {
    return 'moved';
  }
  const pd = z.packedDir;
  if (!pd || fwd[0] * pd[0] + fwd[1] * pd[1] + fwd[2] * pd[2] < MIXED_REPACK_DOT) {
    return 'turned';
  }
  // a saturated pack (every in-view item already full) cannot grow, so
  // re-packing it on headroom noise would be pure churn
  const regrown =
    z.packLimited &&
    targetBytes > z.packedTarget * MIXED_REGROW_FACTOR &&
    targetBytes - z.packedTarget > MIXED_REGROW_MIN_BYTES;
  return regrown ? 'regrown' : null;
}

// -----------------------------------------------------------------------------
// the planner
// -----------------------------------------------------------------------------

/** Everything the fill needs to know about one zone, computed once. */
interface Fact {
  z: ZoneView;
  p: number;
  /** Fill order for floor bytes: holders of geometry get COARSE_STRIP_RATIO
   * over an unloaded competitor — a repair must clearly outrank a holder to
   * take its bytes. */
  floorRank: number;
  /** Fill order for detail bytes: residents get the pacing margin — a needy
   * zone must clearly outrank a resident to evict it. */
  detailRank: number;
  coarseUsable: boolean;
  /** Passes the promotion gates (seen now, streak, distance, clip, priority). */
  promotable: boolean;
  canUp: boolean;
  canDown: boolean;
  /** Forced down by clipping or the offscreen/exit-distance rules. */
  forced: { level: Variant; reason: string; detail: string } | null;
  /** Bytes reserved for this zone's floor (0 = none). */
  floor: number;
  /** Decided — later passes leave it alone. */
  done: boolean;
  level: Variant;
  bytes: number;
  targetBytes: number;
  reason: string;
  /** Slot this zone gave its bytes up for (rebalance detail). */
  fundedSlot: number | null;
}

function factOf(z: ZoneView, input: PlanInput): Fact {
  const { now, cuts, pacing } = input;
  const p = priority(z, now);
  const resident = isResident(z.variant);
  const coarseUsable = z.hasCoarse && !z.coarseBroken;
  const offCooldown = now >= z.cooldownUntil;
  const canDown = offCooldown && now - z.lastPromoteT >= MIN_DWELL_MS;
  const canUp = offCooldown && now - z.lastDemoteT >= MIN_DWELL_MS;
  const withinDist = !(cuts.distM > 0 && z.nearestDist > cuts.distM);
  const seenNow = now - z.lastSeenT <= SEEN_GAP_MS && now - z.seenStreakT >= SEEN_STREAK_MS;
  const promotable = seenNow && withinDist && !z.clipCulled && p > 0;

  let forced: Fact['forced'] = null;
  const dropTo: Variant = z.visibleFrac === 0 || !coarseUsable ? 'unloaded' : 'coarse';
  if (resident && z.clipCulled && offCooldown) {
    forced = { level: dropTo, reason: 'clip-culled', detail: 'outside the clipping volume' };
  } else if (resident && canDown && Number.isFinite(z.nearestDist)) {
    const offscreen = now - z.lastSeenT > PROACTIVE_GRACE_MS;
    const beyondExit = cuts.distM > 0 && z.nearestDist > cuts.distM * DIST_EXIT_FACTOR;
    if (offscreen || beyondExit) {
      forced = {
        level: dropTo,
        reason: offscreen ? 'phase1-offscreen' : 'phase1-beyond-cut-dist',
        detail: `unseen ${((now - z.lastSeenT) / 1000).toFixed(1)}s, dist ${z.nearestDist.toFixed(0)}m`,
      };
    }
  }
  return {
    z,
    p,
    floorRank: p * (z.variant === 'unloaded' ? 1 : COARSE_STRIP_RATIO),
    detailRank: p * (resident ? pacing.margin : 1),
    coarseUsable,
    promotable,
    canUp,
    canDown,
    forced,
    floor: 0,
    done: false,
    level: z.variant,
    bytes: z.bytesNow,
    targetBytes: 0,
    reason: 'keep',
    fundedSlot: null,
  };
}

/** The best level a promotable coarse/unloaded zone can reach with `avail`
 * bytes of headroom: full when it fits and is comfortable (or has no coarse,
 * or is fully in view, or no mixed pack is affordable), else a mixed pack
 * above the zone's mixed floor, else nothing more than its floor. */
function bestLevel(f: Fact, avail: number, budget: number): { level: Variant; bytes: number; targetBytes: number } {
  const z = f.z;
  const fullOnly = !f.coarseUsable;
  const comfortable = z.bytesFull * FULL_COMFORT_FACTOR <= avail;
  // A mixed pack is only worth its two parses above the zone's mixed floor.
  // Below that there is no mixed fallback, so "not comfortable" must not
  // veto a full promote that FITS — otherwise headroom between bytesFull
  // and FULL_COMFORT_FACTOR x bytesFull is unusable by EITHER path and the
  // scene settles with memory to spare (observed: settled at 445/512 MB
  // with zones 13 m from the camera still coarse). Fitting is what bounds
  // the budget; the comfort factor only decides full-vs-mixed.
  const target = mixedTarget(avail, budget);
  const noMixedAffordable = target < mixedFloor(z);
  if (z.bytesFull <= avail && (comfortable || fullOnly || z.fullyInFrustum || noMixedAffordable)) {
    return { level: 'full', bytes: z.bytesFull, targetBytes: 0 };
  }
  if (!fullOnly && !noMixedAffordable) {
    return { level: 'mixed', bytes: mixedBytes(z, target), targetBytes: target };
  }
  return f.floor > 0 || z.variant === 'coarse'
    ? { level: 'coarse', bytes: f.floor, targetBytes: 0 }
    : { level: 'unloaded', bytes: 0, targetBytes: 0 };
}

/**
 * Compute the target residency of every zone and the steps that reach it.
 *
 * 1. budget off → every zone full.
 * 2. `modelBudget` = budget minus what is NOT model geometry (render targets,
 *    shared buffers) — the ceiling stays the total, the fill stays honest;
 *    promotions must land under PROMOTE_HEADROOM of the total.
 * 3. Forced drops: clipped residents (at once), residents off screen too long
 *    or beyond the cut-distance exit (after their dwell) → coarse/unloaded.
 *    Pins: a resident inside its post-promote dwell or cooldown keeps its
 *    level; a zone inside its post-demote dwell/cooldown cannot rise (it is
 *    "waiting").
 * 4. Floor pass, by floor rank: every zone that may hold geometry reserves
 *    its coarse bytes. A holder that no longer fits keeps its floor unless a
 *    higher-ranked NEWCOMER took the room or the holder is clipped / long
 *    off screen (the strip rule: existence beats sharpness, but a repair
 *    outranking a holder by COARSE_STRIP_RATIO may displace it).
 * 5. Residents pre-reserve their detail — they keep it unless step 6 or 7
 *    takes it.
 * 6. Detail pass, by detail rank: a promotable coarse/unloaded zone gets the
 *    best level its headroom allows; when that is short it may RECLAIM from
 *    lower-ranked zones it outranks by the margin (residents' detail first,
 *    "depth before holes", then coarse floors under the strip ratio) — but
 *    only if the reclaim actually reaches a better level, never a pointless
 *    eviction. Mixed zones re-pack on the view triggers; they never rise to
 *    full (a saturated mixed pack already holds every in-view item sharp).
 * 7. Over the ceiling → demote residents ascending by priority.
 * 8. Diff → steps: refreshes, unloads, coarse demotes, shrinks, repairs,
 *    promotes, mixed re-packs. Each zone appears at most once.
 */
export function planTargets(input: PlanInput): ResidencyPlan {
  const { zones, now, budgetMb, used, cuts } = input;

  // 1. feature off — undo it rather than stranding zones where they were
  if (budgetMb === 0) {
    const steps: PlanAction[] = [];
    for (const z of zones) {
      if (z.variant !== 'full' && !z.inFlight) {
        steps.push({ kind: 'restore-full', slot: z.slot, reason: 'budget-off-restore-full' });
      }
    }
    return {
      targets: zones.map((z) => ({ slot: z.slot, level: 'full', targetBytes: z.bytesFull, reason: 'budget-off' })),
      steps,
      settled: steps.length === 0,
      waiting: false,
      modelBudget: Infinity,
    };
  }

  // 2. the budget the fill has to work with
  const budget = budgetMb * MB;
  let bytesNowSum = 0;
  for (const z of zones) {
    bytesNowSum += z.bytesNow;
  }
  const overhead = Math.max(0, used - bytesNowSum);
  const modelBudget = Math.max(0, budget - overhead);
  const headroom = Math.max(0, budget * PROMOTE_HEADROOM - overhead);

  const facts = zones.filter((z) => !z.inFlight).map((z) => factOf(z, input));
  // in-flight zones hold their (projected) bytes for the whole plan
  let acc = 0;
  for (const z of zones) {
    if (z.inFlight) {
      acc += z.bytesNow;
    }
  }
  let waiting = false;

  // 3. forced drops and pins
  for (const f of facts) {
    const z = f.z;
    if (f.forced) {
      f.level = f.forced.level;
      f.reason = f.forced.reason;
      f.bytes = f.level === 'coarse' ? z.bytesCoarse : 0;
      f.done = true;
    } else if (isResident(z.variant) && !f.canDown) {
      f.level = z.variant;
      f.bytes = z.bytesNow;
      f.reason = 'pinned';
      f.done = true;
    }
  }

  // 4. floor pass
  const byFloor = [...facts].sort((a, b) => b.floorRank - a.floorRank || a.z.slot - b.z.slot);
  let newcomerTookRoom = false;
  for (const f of byFloor) {
    const z = f.z;
    if (f.done) {
      acc += f.bytes;
      f.floor = f.level === 'unloaded' ? 0 : f.level === 'coarse' ? f.bytes : z.bytesCoarse;
      continue;
    }
    if (!f.coarseUsable) {
      f.floor = 0; // full-only zone: no floor, all or nothing
      continue;
    }
    const holds = z.variant !== 'unloaded';
    if (!holds) {
      if (!f.promotable || z.bytesCoarse <= 0) {
        f.reason = f.promotable ? 'no coarse bytes' : 'not seen';
        f.done = true;
      } else if (!f.canUp) {
        waiting = true;
        f.reason = 'waiting';
        f.done = true;
      } else if (acc + z.bytesCoarse <= headroom) {
        acc += z.bytesCoarse;
        f.floor = z.bytesCoarse;
        f.level = 'coarse';
        f.bytes = z.bytesCoarse;
        f.reason = 'repair-coarse';
        newcomerTookRoom = true;
      } else {
        f.reason = 'no room for floor';
        f.done = true;
      }
      continue;
    }
    // a holder's floor is what it keeps at coarse: measured for a coarse
    // pack, the coarse estimate for a resident
    const floorBytes = z.variant === 'coarse' ? z.bytesNow : z.bytesCoarse;
    const strippable = z.variant === 'coarse' && f.canDown && (z.clipCulled || now - z.lastSeenT > OFFSCREEN_GRACE_MS);
    if (acc + floorBytes <= modelBudget || (!newcomerTookRoom && !strippable)) {
      acc += floorBytes;
      f.floor = floorBytes;
      if (z.variant === 'coarse') {
        f.level = 'coarse';
        f.bytes = floorBytes;
        f.reason = 'floor';
      }
    } else if (z.variant === 'coarse' && f.canDown) {
      f.level = 'unloaded';
      f.bytes = 0;
      f.reason = strippable ? 'over-budget' : 'stripped';
      f.done = true;
    } else {
      acc += floorBytes; // pinned by dwell, or a resident: the floor stays
      f.floor = floorBytes;
    }
  }

  // 5. residents keep their detail unless someone takes it
  for (const f of facts) {
    if (!f.done && isResident(f.z.variant)) {
      acc += f.z.bytesNow - f.floor;
      f.level = f.z.variant;
      f.bytes = f.z.bytesNow;
      f.reason = 'keep';
    }
  }

  // 6. detail pass
  const byDetail = [...facts].sort((a, b) => b.detailRank - a.detailRank || a.z.slot - b.z.slot);
  for (let i = 0; i < byDetail.length; i++) {
    const f = byDetail[i];
    const z = f.z;
    if (f.done) {
      continue;
    }
    // residents that still hold their detail: full has nothing to gain, mixed
    // may re-pack. A resident RECLAIMED for a higher zone (level coarse now)
    // falls through and competes for the leftover like any coarse zone.
    if (z.variant === 'full' && f.level === 'full') {
      f.done = true;
      continue;
    }
    if (z.variant === 'mixed' && f.level === 'mixed') {
      f.done = true;
      if (!f.promotable) {
        continue;
      }
      const avail = headroom - acc + z.bytesNow;
      const target = mixedTarget(avail, budget);
      if (target < mixedFloor(z)) {
        continue;
      }
      const why = repackReason(z, input, target);
      if (why) {
        f.targetBytes = target;
        f.bytes = mixedBytes(z, target);
        f.reason = `mixed-repack-${why}`;
        acc += f.bytes - z.bytesNow;
      }
      continue;
    }
    f.done = true;
    if (!f.promotable) {
      continue; // coarse floor holder off screen / out of range: stays as is
    }
    let best = bestLevel(f, headroom - acc + f.floor, budget);
    if (LEVEL_ORDER[best.level] <= LEVEL_ORDER[f.level]) {
      // short of room: reclaim from zones this one clearly outranks —
      // residents' detail first (depth before holes), then coarse floors
      const victims: { v: Fact; bytes: number; strip: boolean }[] = [];
      for (let j = i + 1; j < byDetail.length; j++) {
        const v = byDetail[j];
        // only untouched zones: a floor granted this plan is never taken back
        // for detail, and a zone already reclaimed once is not reclaimed again
        if (v.done || v.forced || v.reason === 'pinned' || !v.canDown || v.level !== v.z.variant) {
          continue;
        }
        if (isResident(v.z.variant) && v.detailRank < f.p && v.z.bytesNow > v.floor) {
          victims.push({ v, bytes: v.z.bytesNow - v.floor, strip: false });
        } else if (v.z.variant === 'coarse' && v.floorRank < f.p && v.floor > 0) {
          victims.push({ v, bytes: v.floor, strip: true });
        }
      }
      victims.sort((a, b) => Number(a.strip) - Number(b.strip) || b.bytes - a.bytes);
      let reclaimed = 0;
      let taken = 0;
      for (const cand of victims) {
        const trial = bestLevel(f, headroom - acc + f.floor + reclaimed + cand.bytes, budget);
        reclaimed += cand.bytes;
        taken++;
        if (LEVEL_ORDER[trial.level] > LEVEL_ORDER[f.level]) {
          best = trial;
          break;
        }
      }
      if (LEVEL_ORDER[best.level] > LEVEL_ORDER[f.level]) {
        for (const cand of victims.slice(0, taken)) {
          const v = cand.v;
          v.done = cand.strip; // a demoted resident may still win leftover detail below
          v.fundedSlot = z.slot;
          v.level = cand.strip ? 'unloaded' : 'coarse';
          v.bytes = cand.strip ? 0 : v.floor;
          v.reason = cand.strip ? 'stripped' : 'rebalance';
          acc -= cand.bytes;
        }
      } else {
        best = { level: f.level, bytes: f.bytes, targetBytes: 0 };
      }
    }
    if (LEVEL_ORDER[best.level] > LEVEL_ORDER[z.variant] && !f.canUp) {
      waiting = true;
      f.reason = 'waiting';
      continue;
    }
    if (best.level === f.level) {
      continue;
    }
    acc += best.bytes - f.floor;
    f.level = best.level;
    f.bytes = best.bytes;
    f.targetBytes = best.targetBytes;
    f.reason = `promote-${best.level}`;
  }

  // 7. over the ceiling → shed residents, lowest priority first
  if (acc > modelBudget) {
    const residents = facts.filter((f) => isResident(f.level) && now >= f.z.cooldownUntil);
    residents.sort((a, b) => a.p - b.p || a.z.slot - b.z.slot);
    for (const pass of [true, false]) {
      for (const f of residents) {
        if (acc <= modelBudget) {
          break;
        }
        if (LEVEL_ORDER[f.level] < 2 || (pass && !f.canDown)) {
          continue;
        }
        const to: Variant = f.coarseUsable ? 'coarse' : 'unloaded';
        const bytes = to === 'coarse' ? f.floor || f.z.bytesCoarse : 0;
        acc -= f.bytes - bytes;
        f.level = to;
        f.bytes = bytes;
        f.targetBytes = 0;
        f.reason = 'over-budget';
        f.done = true;
      }
    }
  }

  // 8. diff → steps
  const targets: ZoneTarget[] = [];
  for (const z of zones) {
    if (z.inFlight) {
      targets.push({ slot: z.slot, level: z.variant, targetBytes: z.bytesNow, reason: 'in-flight' });
    }
  }
  const gainers = byDetail.filter((f) => LEVEL_ORDER[f.level] > LEVEL_ORDER[f.z.variant]);
  const topGainer = gainers[0] ?? null;
  const refreshes: PlanAction[] = [];
  const frees: { step: PlanAction; bytes: number; p: number; unload: boolean }[] = [];
  const shrinks: PlanAction[] = [];
  const repairs: PlanAction[] = [];
  const promotes: PlanAction[] = [];
  const repacks: PlanAction[] = [];
  for (const f of byDetail) {
    const z = f.z;
    targets.push({ slot: z.slot, level: f.level, targetBytes: f.bytes, reason: f.reason });
    const cur = LEVEL_ORDER[z.variant];
    const next = LEVEL_ORDER[f.level];
    if (f.level === 'coarse' && z.variant === 'coarse') {
      if (z.coarseStale && cuts.dropHidden && now >= z.cooldownUntil) {
        refreshes.push({ kind: 'refresh-coarse', slot: z.slot, reason: 'coarse-refresh-stale' });
      }
      continue;
    }
    if (next < cur) {
      if (f.level === 'mixed') {
        shrinks.push({
          kind: 'promote-mixed',
          slot: z.slot,
          targetBytes: f.targetBytes,
          reason: 'shrink-mixed',
          detail: `target ${mb(f.targetBytes)} MB, was full ${mb(z.bytesNow)} MB`,
        });
        continue;
      }
      const to = f.level === 'coarse' ? 'coarse' : 'unloaded';
      const funded = f.fundedSlot !== null ? byDetail.find((g) => g.z.slot === f.fundedSlot) : null;
      let reason: string;
      let detail: string;
      if (f.forced) {
        reason = f.forced.reason;
        detail = f.forced.detail;
      } else if (funded) {
        reason = 'rebalance';
        detail =
          `for slot ${funded.z.slot} (${funded.level === 'coarse' ? 'repair, ' : ''}` +
          `${funded.p.toExponential(2)} vs ${f.p.toExponential(2)}), frees ${mb(z.bytesNow - f.bytes)} MB`;
      } else if (f.reason === 'stripped' && topGainer) {
        reason = 'rebalance';
        detail =
          `for slot ${topGainer.z.slot} (${topGainer.level === 'coarse' ? 'repair, ' : ''}` +
          `${topGainer.p.toExponential(2)} vs ${f.p.toExponential(2)}), frees ${mb(z.bytesNow - f.bytes)} MB`;
      } else {
        reason = 'over-budget';
        detail = `used ${mb(used)}/${budgetMb} MB, prio ${f.p.toExponential(2)}`;
      }
      frees.push({
        step: { kind: 'demote', slot: z.slot, to, reason, detail },
        bytes: z.bytesNow - f.bytes,
        p: f.p,
        unload: to === 'unloaded',
      });
      continue;
    }
    if (next > cur) {
      const detail = `prio ${f.p.toExponential(2)}, ${mb(f.bytes)} MB of ${mb(modelBudget)} MB model budget`;
      if (f.level === 'coarse') {
        repairs.push({ kind: 'promote-coarse', slot: z.slot, reason: 'repair-coarse', detail });
      } else if (f.level === 'full') {
        promotes.push({ kind: 'promote-full', slot: z.slot, reason: 'promote-full', detail });
      } else {
        promotes.push({
          kind: 'promote-mixed',
          slot: z.slot,
          targetBytes: f.targetBytes,
          reason: 'promote-mixed',
          detail: `prio ${f.p.toExponential(2)}, target ${mb(f.targetBytes)} MB`,
        });
      }
      continue;
    }
    if (f.level === 'mixed' && f.targetBytes > 0) {
      repacks.push({
        kind: 'promote-mixed',
        slot: z.slot,
        targetBytes: f.targetBytes,
        reason: f.reason,
        detail: `target ${mb(f.targetBytes)} MB, prev ${mb(z.packedTarget)} MB`,
      });
    }
  }
  // frees: unloads first, then the biggest yields; ties go to the lowest priority
  frees.sort((a, b) => Number(b.unload) - Number(a.unload) || b.bytes - a.bytes || a.p - b.p);
  const steps: PlanAction[] = [
    ...refreshes,
    ...frees.map((x) => x.step),
    ...shrinks,
    ...repairs,
    ...promotes,
    ...repacks,
  ];
  return { targets, steps, settled: steps.length === 0 && !waiting, waiting, modelBudget };
}

/** Compatibility view of the plan: its first step, or `none` — what a caller
 * that acts one step at a time (and the legacy tests) consume. */
export function planResidency(input: PlanInput): PlanAction {
  const plan = planTargets(input);
  return plan.steps[0] ?? { kind: 'none', settled: plan.settled };
}
