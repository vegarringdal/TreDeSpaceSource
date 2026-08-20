// The VRAM-budget decision core, as a PURE function: given a snapshot of the
// tracked zones plus budget/camera/settings, it returns the single action to
// take (or none). No GPU, no worker, no clock — so the whole coarse/mixed/
// full/unloaded state machine is unit-testable (tests/residency.plan.test.ts).
//
// residency.ts owns the side effects: it builds the snapshot, executes the
// returned action, and keeps the bookkeeping (timestamps, cooldowns).

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
  /** GPU bytes it occupies right now. */
  bytesNow: number;
  hasCoarse: boolean;
  coarseBroken: boolean;
  /** Coarse pack's hidden/cut set is out of date (hide/unhide happened). */
  coarseStale: boolean;
  /** Distance to the nearest non-hidden item (Infinity = unknown/none). */
  nearestDist: number;
  /** Fraction of items with geometry that are not hidden. */
  visibleFrac: number;
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
  starveCount: number;
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
  | { kind: 'demote'; slot: number; reason: string; detail: string }
  | { kind: 'promote-coarse'; slot: number; reason: string; detail: string }
  | { kind: 'promote-full'; slot: number; reason: string; detail: string }
  | { kind: 'promote-mixed'; slot: number; targetBytes: number; reason: string; detail: string }
  | { kind: 'park'; slot: number; untilT: number; reason: string };

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
/** Promotions must land at or under this fraction of the budget. */
export const PROMOTE_HEADROOM = 0.9;
/** Plain full (rather than a mixed pack) once the zone fits this comfortably. */
export const FULL_COMFORT_FACTOR = 2;
/** Rebalances spent on one starving zone before parking it. */
export const STARVE_CAP = 4;
export const STARVE_PARK_MS = 20000;
/** Pressure inversion: a SEEN coarse zone may be stripped (unloaded) to fund
 * a needy zone that outranks it by at least this priority factor. This is the
 * controlled exception to the no-holes floor — at starvation budgets the
 * floor itself consumes everything and the zone 2 m from the camera sits
 * unloaded while a zone 26 m away keeps its coarse (observed at 256 MB).
 *
 * 2 ≈ "the victim is ~1.4× farther away". Any value above 1 is churn-safe:
 * dominance is strict, so a stripped zone can never out-rank its own funder
 * and cascades only flow downhill — a repair may push the hole one ring
 * outward, whose repair pushes it further, until it leaves the strip radius.
 * That migration is the nearest-first ring behaviour. (20 was tried first
 * and froze holes in the 16–25 m band: the observed mid-band ratios are only
 * 2.2–3.6×, so a conservative guard refuses exactly the trades that matter.) */
export const COARSE_STRIP_RATIO = 2;

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

/** Priority = pure proximity to the nearest visible item, bounded to (0, 1].
 * Box distance is unusable: one outlier item inflates a far zone's box until
 * it contains the camera. Fully hidden or distance-unknown zones score 0. */
export function priority(z: ZoneView, now: number): number {
  if (z.visibleFrac === 0 || !Number.isFinite(z.nearestDist)) {
    return 0;
  }
  const base = 1 / (1 + z.nearestDist) ** 2;
  return now - z.lastSeenT > OFFSCREEN_GRACE_MS ? base * OFFSCREEN_FACTOR : base;
}

const isResident = (v: Variant) => v === 'full' || v === 'mixed';

/** Lowest-priority zone worth demoting: a full/mixed zone, or failing that an
 * OFFSCREEN coarse zone (which unloads outright). On-screen coarse zones are
 * never victims — coarse is the no-holes floor. `honorDwell` skips zones that
 * changed level recently; the over-budget path retries without it. */
function pickVictim(input: PlanInput, honorDwell: boolean): { z: ZoneView; p: number } | null {
  const { zones, now } = input;
  let victim: ZoneView | null = null;
  let worst = Infinity;
  for (const z of zones) {
    if (!isResident(z.variant) || now < z.cooldownUntil || z.inFlight) {
      continue;
    }
    if (honorDwell && now - z.lastPromoteT < MIN_DWELL_MS) {
      continue;
    }
    const p = priority(z, now);
    if (p < worst) {
      worst = p;
      victim = z;
    }
  }
  if (victim) {
    return { z: victim, p: worst };
  }
  // stage two: coarse zones that cannot draw at all — clipped away, or long
  // off screen — give up their remaining bytes entirely
  for (const z of zones) {
    if (
      z.variant !== 'coarse' ||
      (!z.clipCulled && now - z.lastSeenT <= OFFSCREEN_GRACE_MS) ||
      now < z.cooldownUntil ||
      z.inFlight
    ) {
      continue;
    }
    if (honorDwell && now - z.lastDemoteT < MIN_DWELL_MS) {
      continue;
    }
    const p = priority(z, now);
    if (p < worst) {
      worst = p;
      victim = z;
    }
  }
  return victim ? { z: victim, p: worst } : null;
}

/**
 * Victim for a REBALANCE: among zones whose priority is safely below the needy
 * zone's, the one that frees the MOST bytes.
 *
 * `pickVictim` minimises priority, which is right when merely shedding bytes
 * (stage 3) but wrong here: the lowest-priority zone is almost always a tiny
 * one, so a big needy zone starves behind a run of evictions that cannot close
 * its gap. Observed: needing 12 MB, the planner freed 0.6 MB then 0.1 MB —
 * two swaps, two zones dropped, no progress. Selecting by bytes turns that
 * into one eviction that actually serves the promote.
 *
 * The margin test is applied during selection (not after), so a big zone is
 * only ever taken when it is genuinely far below the needy zone.
 *
 * Stage two — pressure inversion: when no full/mixed victim exists (the floor
 * has consumed the budget), a SEEN coarse zone may be stripped instead, under
 * the much stronger COARSE_STRIP_RATIO guard. Demoting depth beats holing a
 * zone out, so residents are always preferred.
 */
function pickRebalanceVictim(input: PlanInput, needyP: number, needySlot: number): ZoneView | null {
  const { zones, now, pacing } = input;
  let best: ZoneView | null = null;
  for (const z of zones) {
    if (!isResident(z.variant) || now < z.cooldownUntil || z.inFlight || z.slot === needySlot) {
      continue;
    }
    if (now - z.lastPromoteT < MIN_DWELL_MS) {
      continue;
    }
    if (priority(z, now) * pacing.margin >= needyP) {
      continue;
    }
    if (!best || z.bytesNow > best.bytesNow) {
      best = z;
    }
  }
  if (best) {
    return best;
  }
  for (const z of zones) {
    if (z.variant !== 'coarse' || now < z.cooldownUntil || z.inFlight || z.slot === needySlot) {
      continue;
    }
    if (now - z.lastDemoteT < MIN_DWELL_MS || now - z.lastPromoteT < MIN_DWELL_MS) {
      continue;
    }
    if (priority(z, now) * COARSE_STRIP_RATIO >= needyP) {
      continue;
    }
    if (!best || z.bytesNow > best.bytesNow) {
      best = z;
    }
  }
  return best;
}

/** Per-zone minimum for a mixed pack: MIXED_MIN_BYTES at comfortable sizes,
 * scaled down to a quarter of the zone's full size, never below the absolute
 * floor. See MIXED_MIN_ZONE_FRAC for why the fixed floor was wrong. */
export function mixedFloor(z: ZoneView): number {
  return Math.max(MIXED_MIN_ABS_BYTES, Math.min(MIXED_MIN_BYTES, z.bytesFull * MIXED_MIN_ZONE_FRAC));
}

const mb = (b: number) => (b / 1048576).toFixed(1);

/** Full-detail byte target for one mixed pack: the free headroom, minus slack
 * for the coarse remainder, capped so a single zone cannot claim the whole
 * budget and leave every other visible zone with nothing. */
const mixedTarget = (avail: number, budget: number) => Math.min(avail * MIXED_FILL_FACTOR, budget * MIXED_MAX_SHARE);

// -----------------------------------------------------------------------------
// the planner
// -----------------------------------------------------------------------------

/**
 * Decide the ONE action to take this evaluation. Stages, in order:
 *   0. budget off  → restore every zone to full
 *   1. stale coarse pack (hide/unhide) → refresh in place
 *   2. proactive demote: offscreen too long, or beyond the cut-distance exit
 *   3. over budget → demote the lowest-priority zone
 *   4. serve the highest-priority zone that still needs geometry (full, mixed,
 *      or rebalance for it — capped so an un-fittable zone parks instead of
 *      evicting the scene)
 *   5. re-pack mixed zones whose view moved/turned, or whose budget grew
 */
export function planResidency(input: PlanInput): PlanAction {
  const { zones, now, budgetMb, used, cuts, eye, fwd } = input;

  // 0. feature off — undo it rather than stranding zones where they were
  if (budgetMb === 0) {
    for (const z of zones) {
      if (z.variant !== 'full' && !z.inFlight) {
        return { kind: 'restore-full', slot: z.slot, reason: 'budget-off-restore-full' };
      }
    }
    return { kind: 'none', settled: true };
  }

  const budget = budgetMb * 1048576;

  // 1. a coarse pack whose hidden/cut set went stale
  if (cuts.dropHidden) {
    for (const z of zones) {
      if (z.variant === 'coarse' && z.coarseStale && now >= z.cooldownUntil && !z.inFlight) {
        return { kind: 'refresh-coarse', slot: z.slot, reason: 'coarse-refresh-stale' };
      }
    }
  }

  // 2a. clipped away — demote AT ONCE (no grace, no dwell). Activating or
  // editing a clipping box is a deliberate action, and everything outside it
  // is unrenderable, so its detail should be reclaimed immediately.
  for (const z of zones) {
    if (isResident(z.variant) && z.clipCulled && now >= z.cooldownUntil && !z.inFlight) {
      return { kind: 'demote', slot: z.slot, reason: 'clip-culled', detail: 'outside the clipping volume' };
    }
  }

  // 2b. outside the frustum (or beyond the cut distance), coarse is the default
  for (const z of zones) {
    if (!isResident(z.variant) || now - z.lastPromoteT <= MIN_DWELL_MS || now < z.cooldownUntil || z.inFlight) {
      continue;
    }
    if (!Number.isFinite(z.nearestDist)) {
      continue; // distance unknown until the first visibility refresh lands
    }
    const offscreen = now - z.lastSeenT > PROACTIVE_GRACE_MS;
    const beyondCutDist = cuts.distM > 0 && z.nearestDist > cuts.distM * DIST_EXIT_FACTOR;
    if (offscreen || beyondCutDist) {
      return {
        kind: 'demote',
        slot: z.slot,
        reason: offscreen ? 'phase1-offscreen' : 'phase1-beyond-cut-dist',
        detail: `unseen ${((now - z.lastSeenT) / 1000).toFixed(1)}s, dist ${z.nearestDist.toFixed(0)}m`,
      };
    }
  }

  // 3. hard over budget
  if (used > budget) {
    const victim = pickVictim(input, true) ?? pickVictim(input, false);
    if (!victim) {
      return { kind: 'none', settled: true };
    }
    return {
      kind: 'demote',
      slot: victim.z.slot,
      reason: 'over-budget',
      detail: `used ${mb(used)}/${budgetMb} MB, prio ${victim.p.toExponential(2)}`,
    };
  }

  // in-flight promotes already claim their full-detail bytes
  let pending = 0;
  for (const z of zones) {
    if (z.inFlight) {
      pending += z.bytesFull;
    }
  }

  // promotable = visible RIGHT NOW, continuously for a moment, within the cut
  // distance, dwelt since its last demote, off cooldown
  // A zone blocked ONLY by a cooldown or the post-demote dwell is not
  // "settled" — it is waiting. Reporting settled here made the activity chip
  // go green with work outstanding, and split one convergence burst into
  // several in the measurement.
  let waiting = false;
  const cands: { z: ZoneView; p: number }[] = [];
  for (const z of zones) {
    if (z.variant === 'full' || z.inFlight) {
      continue;
    }
    if (now < z.cooldownUntil || now - z.lastDemoteT < MIN_DWELL_MS) {
      // would it otherwise be promotable?
      if (
        now - z.lastSeenT <= SEEN_GAP_MS &&
        now - z.seenStreakT >= SEEN_STREAK_MS &&
        !(cuts.distM > 0 && z.nearestDist > cuts.distM) &&
        !z.clipCulled &&
        priority(z, now) > 0
      ) {
        waiting = true;
      }
      continue;
    }
    if (now - z.lastSeenT > SEEN_GAP_MS || now - z.seenStreakT < SEEN_STREAK_MS) {
      continue;
    }
    if (cuts.distM > 0 && z.nearestDist > cuts.distM) {
      continue;
    }
    if (z.clipCulled) {
      continue; // nothing of it can draw — coarse is its level
    }
    const p = priority(z, now);
    if (p > 0) {
      cands.push({ z, p });
    }
  }
  if (cands.length === 0) {
    return { kind: 'none', settled: !waiting };
  }
  cands.sort((a, b) => b.p - a.p);

  // 4a. repair: a SEEN unloaded zone with a working coarse variant gets its
  // coarse back BEFORE anything gets sharper — existence beats sharpness.
  // This is the ladder rung that was missing at starvation budgets: the only
  // ways up were full (too big) and mixed (floor too high), so a zone
  // touching the camera sat invisible while far zones held coarse bytes.
  const holed = cands.find(
    (c) => c.z.variant === 'unloaded' && c.z.hasCoarse && !c.z.coarseBroken && c.z.bytesCoarse > 0,
  );
  if (holed) {
    const z = holed.z;
    const avail = budget * PROMOTE_HEADROOM - (used + pending);
    if (z.bytesCoarse <= avail) {
      return {
        kind: 'promote-coarse',
        slot: z.slot,
        reason: 'repair-coarse',
        detail: `prio ${holed.p.toExponential(2)}, ${mb(z.bytesCoarse)}/${mb(avail)} MB`,
      };
    }
    if (z.starveCount >= STARVE_CAP) {
      return {
        kind: 'park',
        slot: z.slot,
        untilT: now + STARVE_PARK_MS,
        reason: `coarse repair could not fit after ${STARVE_CAP} rebalances`,
      };
    }
    const victim = pickRebalanceVictim(input, holed.p, z.slot);
    if (victim) {
      return {
        kind: 'demote',
        slot: victim.slot,
        reason: 'rebalance',
        detail:
          `for slot ${z.slot} (repair, ${holed.p.toExponential(2)} vs ${priority(victim, now).toExponential(2)}), ` +
          `frees ${mb(victim.bytesNow)} MB, needs ${mb(z.bytesCoarse)} MB, avail ${mb(avail)} MB`,
      };
    }
    // unrepairable right now — fall through so the rest of the scene is served
  }

  // 4. serve the highest-priority zone that still needs geometry — and ONLY
  // that one, or a lower-priority zone would eat the headroom a rebalance
  // just freed and the top zone would starve forever.
  const needy = cands.find((c) => c.z.variant === 'coarse' || c.z.variant === 'unloaded');
  if (needy) {
    const z = needy.z;
    const avail = budget * PROMOTE_HEADROOM - (used + pending) + z.bytesNow;
    const comfortable = z.bytesFull * FULL_COMFORT_FACTOR <= avail;
    const fullOnly = !z.hasCoarse || z.coarseBroken;
    // A mixed pack is only worth its two parses above the zone's mixed floor.
    // Below that there is no mixed fallback, so "not comfortable" must not
    // veto a full promote that FITS — otherwise headroom between bytesFull
    // and FULL_COMFORT_FACTOR x bytesFull is unusable by EITHER path and the
    // scene settles with memory to spare (observed: settled at 445/512 MB
    // with zones 13 m from the camera still coarse). Fitting is what bounds
    // the budget; the comfort factor only decides full-vs-mixed.
    const noMixedAffordable = mixedTarget(avail, budget) < mixedFloor(z);
    if (z.bytesFull <= avail && (comfortable || fullOnly || z.fullyInFrustum || noMixedAffordable)) {
      return {
        kind: 'promote-full',
        slot: z.slot,
        reason: 'promote-full',
        detail: `prio ${needy.p.toExponential(2)}, ${mb(z.bytesFull)}/${mb(avail)} MB`,
      };
    }
    if (!fullOnly && mixedTarget(avail, budget) >= mixedFloor(z)) {
      const target = mixedTarget(avail, budget);
      return {
        kind: 'promote-mixed',
        slot: z.slot,
        targetBytes: target,
        reason: 'promote-mixed',
        detail: `prio ${needy.p.toExponential(2)}, target ${mb(target)} MB`,
      };
    }
    if (z.starveCount >= STARVE_CAP) {
      return {
        kind: 'park',
        slot: z.slot,
        untilT: now + STARVE_PARK_MS,
        reason: `could not fit after ${STARVE_CAP} rebalances`,
      };
    }
    const victim = pickRebalanceVictim(input, needy.p, z.slot);
    if (victim) {
      return {
        kind: 'demote',
        slot: victim.slot,
        reason: 'rebalance',
        detail:
          `for slot ${z.slot} (${needy.p.toExponential(2)} vs ${priority(victim, now).toExponential(2)}), ` +
          `frees ${mb(victim.bytesNow)} MB, needs ${mb(z.bytesFull)} MB, avail ${mb(avail)} MB`,
      };
    }
    return { kind: 'none', settled: !waiting }; // nothing worth evicting for it
  }

  // 5. every visible zone is served — re-pack mixed zones whose view changed
  for (const c of cands) {
    const z = c.z;
    if (z.variant !== 'mixed' || !z.hasCoarse || z.coarseBroken) {
      continue;
    }
    const avail = budget * PROMOTE_HEADROOM - (used + pending) + z.bytesNow;
    if (mixedTarget(avail, budget) < mixedFloor(z)) {
      continue;
    }
    // the move threshold scales with distance: walking 10 m barely changes
    // what a zone 40 m away should hold
    const repackDist = Math.max(10, 0.3 * z.nearestDist);
    const pe = z.packedEye;
    const moved = !pe || Math.hypot(eye[0] - pe[0], eye[1] - pe[1], eye[2] - pe[2]) > repackDist;
    const pd = z.packedDir;
    const turned = !pd || fwd[0] * pd[0] + fwd[1] * pd[1] + fwd[2] * pd[2] < MIXED_REPACK_DOT;
    const targetBytes = mixedTarget(avail, budget);
    // a saturated pack (every in-view item already full) cannot grow, so
    // re-packing it on headroom noise would be pure churn
    const regrown =
      z.packLimited &&
      targetBytes > z.packedTarget * MIXED_REGROW_FACTOR &&
      targetBytes - z.packedTarget > MIXED_REGROW_MIN_BYTES;
    if (moved || turned || regrown) {
      return {
        kind: 'promote-mixed',
        slot: z.slot,
        targetBytes,
        reason: `mixed-repack-${moved ? 'moved' : turned ? 'turned' : 'regrown'}`,
        detail: `target ${mb(targetBytes)} MB, prev ${mb(z.packedTarget)} MB`,
      };
    }
  }

  return { kind: 'none', settled: !waiting };
}
