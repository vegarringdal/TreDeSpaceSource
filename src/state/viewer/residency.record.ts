// The residency manager's per-zone bookkeeping record and the pacing presets —
// shared by residency.ts (orchestration) and residency.commit.ts (the swap
// prepare/commit path) so neither imports the other for a type.
import type { Pacing, Variant } from './residency.plan';

export interface ResidencyRecord {
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
  /** Consecutive coarse-file failures; COARSE_FAIL_PERMANENT gives up for the
   * session (an item-table mismatch is permanent at once). */
  coarseFails: number;
  /** No coarse attempt before this time (exponential back-off after a
   * transient failure — an OPFS hiccup must not cost the coarse tier forever). */
  coarseRetryAt: number;
  /** World AABB [minx,miny,minz,maxx,maxy,maxz] from the asset entry. */
  bounds: readonly number[];
  /** AABB of the currently VISIBLE (non-hidden) items — null when everything
   * is hidden. Refreshed from the worker; priority uses this so hiding half a
   * zone shrinks the box the camera is measured against. */
  liveBounds: readonly number[] | null;
  /** Outlier-resistant box of the visible items (sigma-clipped mean ± 2σ of
   * their centres, clamped to the union). Every frustum/clip decision uses
   * THIS, not the union: one item parked far away must not inflate a zone
   * until it swallows the camera, the frustum or the clip volume. */
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

/** Settings → VRAM budget → Swap speed presets. `maxInFlight` bounds how
 * many swaps prepare at once; the modeldb worker is single-threaded, so
 * higher values group commits (one accumulation reset for the batch) rather
 * than speeding parses. */
export const PACING: Record<'relaxed' | 'normal' | 'fast', Pacing> = {
  relaxed: { evalMs: 600, idleMs: 800, cooldownMs: 6000, maxInFlight: 2, margin: 2 },
  normal: { evalMs: 250, idleMs: 400, cooldownMs: 3000, maxInFlight: 4, margin: 1.5 },
  // Speed presets vary how OFTEN the planner acts, never how flimsy a
  // rebalance's justification may be: `margin` is the anti-churn guard. Fast
  // ran at 1.25 and converged in 113 s / 268 swaps / 550 MB against Normal's
  // 33 s / 176 / 261 MB (v1) — evicting on a 25% priority edge made the
  // evicted zone the next needy one, and the pair ping-ponged. Never take it
  // below Normal's.
  fast: { evalMs: 0, idleMs: 200, cooldownMs: 1500, maxInFlight: 6, margin: 1.5 },
};

export const FAIL_COOLDOWN_MS = 30000;
/** Coarse failures before the coarse tier is given up for the session. */
export const COARSE_FAIL_PERMANENT = 3;
const COARSE_RETRY_CAP_MS = 5 * 60 * 1000;

/** Whether the coarse tier is currently unusable for this zone: given up, or
 * inside the back-off after a transient failure. */
export function isCoarseBroken(rec: ResidencyRecord, now: number): boolean {
  return rec.coarseFails >= COARSE_FAIL_PERMANENT || now < rec.coarseRetryAt;
}

/** Record a coarse-file failure: an item-table mismatch can never succeed
 * (permanent at once); anything else backs off exponentially from
 * FAIL_COOLDOWN_MS, capped at five minutes, permanent after
 * COARSE_FAIL_PERMANENT tries. */
export function noteCoarseFailure(rec: ResidencyRecord, err: unknown, now: number): void {
  if (String(err).includes('itemcount-mismatch')) {
    rec.coarseFails = COARSE_FAIL_PERMANENT;
    return;
  }
  rec.coarseFails++;
  rec.coarseRetryAt = now + Math.min(COARSE_RETRY_CAP_MS, FAIL_COOLDOWN_MS * 2 ** (rec.coarseFails - 1));
}

/** The box residency decisions are made against: the outlier-resistant dense
 * box when the worker has produced one, else the union. */
export const decisionBox = (rec: ResidencyRecord): readonly number[] => rec.denseBounds ?? rec.liveBounds ?? rec.bounds;

/** Diagonal of a box — the debug dump prints dense/union so an outlier-
 * inflated zone is obvious at a glance. */
export const spanOf = (b: readonly number[]): number => Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]);
