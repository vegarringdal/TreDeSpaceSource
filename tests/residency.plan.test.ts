// State-machine tests for the VRAM-budget planner: which zone ends up full /
// mixed / coarse / unloaded, and why. Pure logic — no GPU, no worker, no
// rendering. Every case here is a rule the director asked for, or a loop that
// was observed in a real session and must not come back.
import { describe, expect, it } from 'vitest';
import {
  type Cuts,
  MIN_DWELL_MS,
  MIXED_MAX_SHARE,
  type Pacing,
  type PlanInput,
  planResidency,
  PROACTIVE_GRACE_MS,
  STARVE_CAP,
  type Variant,
  type ZoneView,
} from '../src/state/viewer/residency.plan';

// -----------------------------------------------------------------------------
// fixtures
// -----------------------------------------------------------------------------

const MB = 1048576;
const NOW = 1_000_000; // far enough in that "now - 0" satisfies every dwell

const FAST: Pacing = { evalMs: 100, idleMs: 200, cooldownMs: 1500, maxInFlight: 2, margin: 1.25 };
const CUTS: Cuts = { sizeM: 0.5, distM: 125, dropHidden: true };

/** A zone that is visible, settled, and eligible for anything. */
function zone(slot: number, over: Partial<ZoneView> = {}): ZoneView {
  return {
    slot,
    variant: 'coarse',
    bytesFull: 10 * MB,
    bytesCoarse: 1 * MB,
    bytesNow: 1 * MB,
    hasCoarse: true,
    coarseBroken: false,
    coarseStale: false,
    nearestDist: 10,
    visibleFrac: 1,
    fullyInFrustum: false,
    clipCulled: false,
    lastSeenT: NOW, // seen right now
    seenStreakT: NOW - 10_000, // long continuous streak
    lastPromoteT: NOW - 60_000,
    lastDemoteT: NOW - 60_000,
    cooldownUntil: 0,
    packedEye: null,
    packedDir: null,
    packedTarget: 0,
    packLimited: false,
    starveCount: 0,
    inFlight: false,
    ...over,
  };
}

function plan(zones: ZoneView[], over: Partial<PlanInput> = {}) {
  return planResidency({
    zones,
    now: NOW,
    budgetMb: 512,
    used: 50 * MB,
    eye: [0, 0, 0],
    fwd: [1, 0, 0],
    cuts: CUTS,
    pacing: FAST,
    ...over,
  });
}

// -----------------------------------------------------------------------------
// budget off
// -----------------------------------------------------------------------------

describe('budget off', () => {
  it('restores demoted zones to full instead of stranding them', () => {
    const a = plan([zone(1, { variant: 'full' }), zone(2, { variant: 'coarse' })], { budgetMb: 0 });
    expect(a).toMatchObject({ kind: 'restore-full', slot: 2 });
  });

  it('settles once everything is full', () => {
    const a = plan([zone(1, { variant: 'full' }), zone(2, { variant: 'full' })], { budgetMb: 0 });
    expect(a).toMatchObject({ kind: 'none', settled: true });
  });

  it('restores even zones that are far, hidden and off screen', () => {
    const far = zone(1, { variant: 'unloaded', nearestDist: 9999, visibleFrac: 0, lastSeenT: 0 });
    expect(plan([far], { budgetMb: 0 })).toMatchObject({ kind: 'restore-full', slot: 1 });
  });
});

// -----------------------------------------------------------------------------
// promotion: full vs mixed
// -----------------------------------------------------------------------------

describe('promotion level', () => {
  it('loads FULL when the zone fits with room to spare', () => {
    const a = plan([zone(1, { bytesFull: 10 * MB })], { budgetMb: 512, used: 50 * MB });
    expect(a).toMatchObject({ kind: 'promote-full', slot: 1 });
  });

  it('loads FULL when entirely in frustum even without spare room', () => {
    // avail ≈ 50 MB — above the mixed floor, so a mixed pack IS affordable and
    // 30 MB is not "comfortable" (2x). Only the fully-in-frustum rule can pick
    // full here, which is exactly what this asserts.
    const a = plan([zone(1, { bytesFull: 30 * MB, bytesNow: 0, fullyInFrustum: true })], {
      budgetMb: 200,
      used: 130 * MB,
    });
    expect(a).toMatchObject({ kind: 'promote-full', slot: 1 });
  });

  it('spends dead-band headroom on the zone one way or the other', () => {
    // The observed dead band: avail ≈ 17.8 MB is enough for this zone's 16 MB
    // yet below the comfort bar. Before the fixes NEITHER path fired and the
    // scene settled with the headroom unspent, the zone still coarse 13 m
    // from the camera. Full or mixed are both acceptable — never nothing.
    const a = plan([zone(1, { variant: 'coarse', bytesNow: 2 * MB, bytesFull: 16 * MB, fullyInFrustum: false })], {
      budgetMb: 512,
      used: 445 * MB,
    });
    expect(['promote-full', 'promote-mixed']).toContain(a.kind);
  });

  it('never promotes FULL a zone bigger than the headroom (mixed instead)', () => {
    // same tight headroom, zone bigger than it — fitting is what keeps a full
    // promote under budget, so the serve must degrade to a partial (mixed)
    const a = plan([zone(1, { variant: 'coarse', bytesNow: 2 * MB, bytesFull: 40 * MB, fullyInFrustum: false })], {
      budgetMb: 512,
      used: 445 * MB,
    });
    expect(a.kind).not.toBe('promote-full');
    expect(a).toMatchObject({ kind: 'promote-mixed', slot: 1 });
  });

  it('never promotes full past the headroom line', () => {
    // sweep the band: whenever full is chosen, the result must still fit
    for (let need = 4; need <= 40; need += 2) {
      const z = zone(1, { variant: 'coarse', bytesNow: 2 * MB, bytesFull: need * MB, fullyInFrustum: false });
      const a = plan([z], { budgetMb: 512, used: 445 * MB });
      if (a.kind === 'promote-full') {
        const avail = 512 * MB * 0.9 - 445 * MB + z.bytesNow;
        expect(z.bytesFull).toBeLessThanOrEqual(avail);
      }
    }
  });

  it('loads MIXED for a partially visible zone when the budget is tight', () => {
    // avail ≈ 51 MB: enough for a real mixed pack, not enough to be comfortable
    const a = plan([zone(1, { bytesFull: 40 * MB, fullyInFrustum: false })], { budgetMb: 200, used: 130 * MB });
    expect(a).toMatchObject({ kind: 'promote-mixed', slot: 1 });
  });

  it('makes a small mixed pack when it still covers a real share of the zone', () => {
    // avail ≈ 31 MB → target ≈ 26 MB = 66% of a 40 MB zone. The old fixed
    // 32 MB floor refused this; the adaptive floor (quarter of the zone, min
    // 4 MB) is what makes starvation budgets serve the nearest zones at all.
    const a = plan([zone(1, { bytesFull: 40 * MB, fullyInFrustum: false })], { budgetMb: 100, used: 60 * MB });
    expect(a.kind).toBe('promote-mixed');
  });

  it('caps one zone at a share of the budget so others still get targets', () => {
    const a = plan([zone(1, { bytesFull: 900 * MB, fullyInFrustum: false })], { budgetMb: 512, used: 0 });
    expect(a.kind).toBe('promote-mixed');
    if (a.kind === 'promote-mixed') {
      expect(a.targetBytes).toBeLessThanOrEqual(512 * MB * MIXED_MAX_SHARE + 1);
    }
  });

  it('loads FULL when the zone has no coarse variant, even if it must starve others later', () => {
    const a = plan([zone(1, { bytesFull: 25 * MB, hasCoarse: false })], { budgetMb: 100, used: 60 * MB });
    expect(a).toMatchObject({ kind: 'promote-full', slot: 1 });
  });

  it('never asks for a mixed pack with a useless (sub-24 MB) target', () => {
    // avail ≈ 11 MB: too small for a mixed pack, too small for full
    const a = plan([zone(1, { bytesFull: 40 * MB })], { budgetMb: 100, used: 80 * MB });
    expect(a.kind).not.toBe('promote-mixed');
  });
});

// -----------------------------------------------------------------------------
// candidacy: what may be promoted at all
// -----------------------------------------------------------------------------

describe('promotion candidacy', () => {
  const cases: [string, Partial<ZoneView>][] = [
    ['off screen right now', { lastSeenT: NOW - 5000 }],
    ['seen only for an instant (no streak)', { seenStreakT: NOW - 100 }],
    ['demoted moments ago (dwell)', { lastDemoteT: NOW - 1000 }],
    ['beyond the cut distance', { nearestDist: 200 }],
    ['entirely hidden', { visibleFrac: 0 }],
    ['on cooldown', { cooldownUntil: NOW + 5000 }],
    ['already swapping', { inFlight: true }],
    ['distance not known yet', { nearestDist: Number.POSITIVE_INFINITY }],
  ];
  for (const [why, over] of cases) {
    it(`does not promote a zone that is ${why}`, () => {
      expect(plan([zone(1, over)])).toMatchObject({ kind: 'none' });
    });
  }

  it('promotes a zone that just became visible after the streak builds', () => {
    expect(plan([zone(1)])).toMatchObject({ kind: 'promote-full', slot: 1 });
  });
});

// -----------------------------------------------------------------------------
// demotion
// -----------------------------------------------------------------------------

describe('demotion', () => {
  it('demotes a resident zone that has been off screen too long', () => {
    const z = zone(1, { variant: 'full', lastSeenT: NOW - PROACTIVE_GRACE_MS - 1 });
    expect(plan([z])).toMatchObject({ kind: 'demote', slot: 1, reason: 'phase1-offscreen' });
  });

  it('waits out the dwell before demoting a freshly promoted zone', () => {
    const z = zone(1, {
      variant: 'full',
      lastSeenT: NOW - PROACTIVE_GRACE_MS - 1,
      lastPromoteT: NOW - MIN_DWELL_MS + 500,
    });
    expect(plan([z])).toMatchObject({ kind: 'none' });
  });

  it('demotes a resident zone beyond the cut-distance exit line', () => {
    const z = zone(1, { variant: 'full', nearestDist: 125 * 1.25 + 1 });
    expect(plan([z])).toMatchObject({ kind: 'demote', reason: 'phase1-beyond-cut-dist' });
  });

  it('leaves the dead band between the promote and demote distance lines alone', () => {
    const z = zone(1, { variant: 'full', nearestDist: 140 }); // >125 (no promote), <156 (no demote)
    expect(plan([z])).toMatchObject({ kind: 'none' });
  });

  it('demotes the lowest-priority zone when over budget', () => {
    const near = zone(1, { variant: 'full', nearestDist: 5 });
    const far = zone(2, { variant: 'full', nearestDist: 80 });
    expect(plan([near, far], { budgetMb: 100, used: 200 * MB })).toMatchObject({
      kind: 'demote',
      slot: 2,
      reason: 'over-budget',
    });
  });

  it('never picks an ON-SCREEN coarse zone as a victim (coarse is the floor)', () => {
    const coarseVisible = zone(1, { variant: 'coarse' });
    expect(plan([coarseVisible], { budgetMb: 100, used: 200 * MB })).toMatchObject({ kind: 'none' });
  });

  it('unloads an OFF-SCREEN coarse zone when nothing better can be freed', () => {
    const coarseOffscreen = zone(1, { variant: 'coarse', lastSeenT: NOW - 30_000 });
    expect(plan([coarseOffscreen], { budgetMb: 100, used: 200 * MB })).toMatchObject({ kind: 'demote', slot: 1 });
  });
});

describe('settled vs waiting', () => {
  // Observed in a real dump: the NEAREST zone was still coarse while the
  // planner reported "settled", because every candidate happened to be inside
  // a cooldown or the post-demote dwell. Green then means "done" when it is
  // really "hold on" — and it split one convergence burst into several.
  it('reports waiting, not settled, when a candidate is only on cooldown', () => {
    const z = zone(1, { variant: 'coarse', nearestDist: 4, cooldownUntil: NOW + 2400 });
    expect(plan([z])).toMatchObject({ kind: 'none', settled: false });
  });

  it('reports waiting when a candidate is only inside its post-demote dwell', () => {
    const z = zone(1, { variant: 'coarse', nearestDist: 4, lastDemoteT: NOW - 1000 });
    expect(plan([z])).toMatchObject({ kind: 'none', settled: false });
  });

  it('still settles when the blocked zone could never be promoted anyway', () => {
    // off screen AND on cooldown → not waiting on anything worth doing
    const z = zone(1, { variant: 'coarse', cooldownUntil: NOW + 2400, lastSeenT: NOW - 60_000 });
    expect(plan([z])).toMatchObject({ kind: 'none', settled: true });
  });

  it('still settles when everything is genuinely served', () => {
    expect(plan([zone(1, { variant: 'full' })])).toMatchObject({ kind: 'none', settled: true });
  });
});

describe('clipping volumes', () => {
  it('demotes a clipped zone AT ONCE — no offscreen grace, no dwell', () => {
    const z = zone(1, { variant: 'full', clipCulled: true, lastSeenT: NOW, lastPromoteT: NOW });
    expect(plan([z])).toMatchObject({ kind: 'demote', slot: 1, reason: 'clip-culled' });
  });

  it('never promotes a clipped zone, however near it is', () => {
    const z = zone(1, { variant: 'coarse', clipCulled: true, nearestDist: 1 });
    expect(plan([z])).toMatchObject({ kind: 'none' });
  });

  it('unloads a clipped coarse zone under budget pressure without waiting', () => {
    const z = zone(1, { variant: 'coarse', clipCulled: true, lastSeenT: NOW });
    expect(plan([z], { budgetMb: 100, used: 200 * MB })).toMatchObject({ kind: 'demote', slot: 1 });
  });

  it('prefers the clipped zone over an on-screen coarse one when freeing memory', () => {
    const clipped = zone(1, { variant: 'coarse', clipCulled: true, nearestDist: 5 });
    const visible = zone(2, { variant: 'coarse', nearestDist: 50 });
    expect(plan([clipped, visible], { budgetMb: 100, used: 200 * MB })).toMatchObject({ kind: 'demote', slot: 1 });
  });
});

// -----------------------------------------------------------------------------
// rebalance + starvation (the loops that were observed in production logs)
// -----------------------------------------------------------------------------

describe('rebalance', () => {
  const tight = { budgetMb: 100, used: 89 * MB };

  it('evicts a far zone so a near one can load', () => {
    const near = zone(1, { variant: 'coarse', nearestDist: 2, bytesFull: 60 * MB, bytesNow: 0 });
    const far = zone(2, { variant: 'full', nearestDist: 90, lastPromoteT: NOW - 60_000 });
    expect(plan([near, far], tight)).toMatchObject({ kind: 'demote', slot: 2, reason: 'rebalance' });
  });

  it('does not evict a zone that is not clearly lower priority', () => {
    const a = zone(1, { variant: 'coarse', nearestDist: 10, bytesFull: 60 * MB, bytesNow: 0 });
    const b = zone(2, { variant: 'full', nearestDist: 10.1 });
    expect(plan([a, b], tight)).toMatchObject({ kind: 'none' });
  });

  it('does NOT rebalance when a satisfied mixed zone is top priority (observed churn)', () => {
    // TT100-SCE in the real log: mixed, not budget-limited → wants nothing,
    // yet it demoted the whole scene for itself, over and over.
    const satisfied = zone(1, { variant: 'mixed', nearestDist: 1, packLimited: false, packedEye: [0, 0, 0], packedDir: [1, 0, 0], packedTarget: 100 * MB });
    const other = zone(2, { variant: 'full', nearestDist: 50 });
    expect(plan([satisfied, other], tight)).toMatchObject({ kind: 'none' });
  });

  it('parks a zone that still does not fit after the rebalance cap', () => {
    const huge = zone(1, { variant: 'coarse', nearestDist: 2, bytesFull: 5000 * MB, bytesNow: 0, starveCount: STARVE_CAP });
    const far = zone(2, { variant: 'full', nearestDist: 90 });
    expect(plan([huge, far], tight)).toMatchObject({ kind: 'park', slot: 1 });
  });

  it('evicts the victim that frees the MOST bytes, not the lowest-priority one', () => {
    // The observed futile pattern: short ~12 MB, the planner evicted a 0.6 MB
    // zone then a 0.1 MB one — two swaps, two zones dropped, no progress.
    // Both victims here are far below the needy zone, so byte yield decides.
    const near = zone(1, { variant: 'coarse', nearestDist: 2, bytesFull: 60 * MB, bytesNow: 0 });
    const tiny = zone(2, { variant: 'full', nearestDist: 90, bytesNow: 0.6 * MB, lastPromoteT: NOW - 60_000 });
    const fat = zone(3, { variant: 'full', nearestDist: 80, bytesNow: 20 * MB, lastPromoteT: NOW - 60_000 });
    expect(plan([near, tiny, fat], tight)).toMatchObject({ kind: 'demote', slot: 3, reason: 'rebalance' });
  });

  it('will not take a fat victim that is too close in priority', () => {
    // byte yield must never override the anti-churn margin
    const near = zone(1, { variant: 'coarse', nearestDist: 10, bytesFull: 60 * MB, bytesNow: 0 });
    const fatButClose = zone(2, { variant: 'full', nearestDist: 10.1, bytesNow: 40 * MB, lastPromoteT: NOW - 60_000 });
    const tinyFar = zone(3, { variant: 'full', nearestDist: 200, bytesNow: 0.5 * MB, lastPromoteT: NOW - 60_000 });
    expect(plan([near, fatButClose, tinyFar], tight)).toMatchObject({ kind: 'demote', slot: 3 });
  });

  it('never evicts a zone still inside its post-promote dwell', () => {
    const near = zone(1, { variant: 'coarse', nearestDist: 2, bytesFull: 60 * MB, bytesNow: 0 });
    const justPromoted = zone(2, { variant: 'full', nearestDist: 90, bytesNow: 30 * MB, lastPromoteT: NOW });
    expect(plan([near, justPromoted], tight).kind).not.toBe('demote');
  });

  it('serves only the top-priority needy zone (no headroom stealing)', () => {
    // the small far zone WOULD fit, but taking the headroom would starve the
    // near zone forever — the loop seen at 256 MB in the real session
    const nearBig = zone(1, { variant: 'coarse', nearestDist: 2, bytesFull: 60 * MB, bytesNow: 0 });
    const farSmall = zone(2, { variant: 'coarse', nearestDist: 40, bytesFull: 1 * MB, bytesNow: 0 });
    const victim = zone(3, { variant: 'full', nearestDist: 95 });
    const a = plan([nearBig, farSmall, victim], tight);
    expect(a.kind).not.toBe('promote-full');
    expect(a).toMatchObject({ kind: 'demote', slot: 3, reason: 'rebalance' });
  });
});

// -----------------------------------------------------------------------------
// mixed re-packing
// -----------------------------------------------------------------------------

describe('mixed re-pack triggers', () => {
  const settledMixed = (over: Partial<ZoneView> = {}) =>
    zone(1, {
      variant: 'mixed',
      nearestDist: 20,
      packedEye: [0, 0, 0],
      packedDir: [1, 0, 0],
      packedTarget: 100 * MB,
      packLimited: false,
      ...over,
    });

  it('does nothing while the camera has not moved or turned', () => {
    expect(plan([settledMixed()])).toMatchObject({ kind: 'none', settled: true });
  });

  it('re-packs after a large enough move', () => {
    expect(plan([settledMixed()], { eye: [50, 0, 0] })).toMatchObject({ kind: 'promote-mixed', reason: 'mixed-repack-moved' });
  });

  it('ignores a small move relative to the zone distance', () => {
    // 5 m move, zone 20 m away → threshold is max(10, 6) = 10 m
    expect(plan([settledMixed()], { eye: [5, 0, 0] })).toMatchObject({ kind: 'none' });
  });

  it('re-packs after turning past ~26°', () => {
    expect(plan([settledMixed()], { fwd: [0, 1, 0] })).toMatchObject({ kind: 'promote-mixed', reason: 'mixed-repack-turned' });
  });

  it('does NOT re-grow a pack that was never budget-limited (identical result = churn)', () => {
    const z = settledMixed({ packedTarget: 1 * MB, packLimited: false });
    expect(plan([z])).toMatchObject({ kind: 'none' });
  });

  it('re-grows a budget-limited pack once real headroom appears', () => {
    const z = settledMixed({ packedTarget: 1 * MB, packLimited: true });
    expect(plan([z])).toMatchObject({ kind: 'promote-mixed', reason: 'mixed-repack-regrown' });
  });
});

// -----------------------------------------------------------------------------
// hide / unhide
// -----------------------------------------------------------------------------

describe('hidden items', () => {
  it('refreshes a stale coarse pack in place (never demotes/unloads it)', () => {
    const z = zone(1, { variant: 'coarse', coarseStale: true });
    expect(plan([z])).toMatchObject({ kind: 'refresh-coarse', slot: 1 });
  });

  it('skips the refresh when the drop-hidden rule is off', () => {
    const z = zone(1, { variant: 'coarse', coarseStale: true });
    const a = plan([z], { cuts: { ...CUTS, dropHidden: false } });
    expect(a.kind).not.toBe('refresh-coarse');
  });

  it('gives a fully hidden zone no priority, so it is never promoted', () => {
    expect(plan([zone(1, { visibleFrac: 0 })])).toMatchObject({ kind: 'none' });
  });
});

// -----------------------------------------------------------------------------
// floor repair & pressure inversion (the 256 MB starvation session)
// -----------------------------------------------------------------------------

describe('floor repair & pressure inversion', () => {
  it('repairs a seen unloaded zone to coarse before sharpening anyone', () => {
    // existence beats sharpness: the near coarse zone wants full and the
    // budget is roomy, but the hole gets its coarse first
    const wantsFull = zone(1, { variant: 'coarse', nearestDist: 2 });
    const hole = zone(2, { variant: 'unloaded', bytesNow: 0, nearestDist: 30 });
    expect(plan([wantsFull, hole], { budgetMb: 512, used: 50 * MB })).toMatchObject({
      kind: 'promote-coarse',
      slot: 2,
      reason: 'repair-coarse',
    });
  });

  it('does not repair a zone without a working coarse variant', () => {
    const hole = zone(1, { variant: 'unloaded', bytesNow: 0, hasCoarse: false });
    const a = plan([hole], { budgetMb: 512, used: 50 * MB });
    expect(a.kind).not.toBe('promote-coarse');
    expect(a).toMatchObject({ kind: 'promote-full', slot: 1 });
  });

  it('funds a repair by stripping a far coarse zone (the 2m-hole deadlock)', () => {
    // the observed deadlock: budget saturated by the coarse floor, zone 2 m
    // from the camera unloaded, a far zone holding bytes — ratio ~1100x
    const hole = zone(1, { variant: 'unloaded', bytesNow: 0, nearestDist: 2 });
    const farCoarse = zone(2, { variant: 'coarse', nearestDist: 100, bytesNow: 8 * MB });
    const a = plan([hole, farCoarse], { budgetMb: 100, used: 90 * MB });
    expect(a).toMatchObject({ kind: 'demote', slot: 2, reason: 'rebalance' });
    if (a.kind === 'demote') {
      expect(a.detail).toContain('repair');
    }
  });

  it('never strips a coarse zone of comparable priority', () => {
    // ratio guard: 10 m vs 12 m is ~1.4x — same ring, no trade. The hole
    // stays where it is instead of hopping between near-equal zones.
    const hole = zone(1, { variant: 'unloaded', bytesNow: 0, nearestDist: 10 });
    const nearCoarse = zone(2, { variant: 'coarse', nearestDist: 12, bytesNow: 8 * MB });
    expect(plan([hole, nearCoarse], { budgetMb: 100, used: 90 * MB }).kind).toBe('none');
  });

  it('migrates a hole outward: repairing near strips the next ring, not nothing', () => {
    // the observed 256 MB mid-band freeze: a 16 m hole vs a 30 m holder is a
    // ~3.3x ratio — the guard must allow this trade or the hole never heals
    const hole = zone(1, { variant: 'unloaded', bytesNow: 0, nearestDist: 16 });
    const farther = zone(2, { variant: 'coarse', nearestDist: 30, bytesNow: 5 * MB });
    const a = plan([hole, farther], { budgetMb: 100, used: 90 * MB });
    expect(a).toMatchObject({ kind: 'demote', slot: 2, reason: 'rebalance' });
  });

  it('prefers demoting a resident over holing out a coarse zone', () => {
    // both victims are far below the needy zone; the FULL one is taken even
    // though the coarse one frees more bytes — depth before holes
    const needy = zone(1, { variant: 'coarse', nearestDist: 2, bytesFull: 60 * MB, bytesNow: 0 });
    const farFull = zone(2, { variant: 'full', nearestDist: 90, bytesNow: 2 * MB, lastPromoteT: NOW - 60_000 });
    const farCoarse = zone(3, { variant: 'coarse', nearestDist: 95, bytesNow: 8 * MB });
    expect(plan([needy, farFull, farCoarse], { budgetMb: 100, used: 89 * MB })).toMatchObject({
      kind: 'demote',
      slot: 2,
    });
  });

  it('makes a tiny mixed pack for a small zone at a starvation budget', () => {
    // the 256 MB dump: ~6 MB of headroom. A 12 MB zone's floor is 4 MB, so a
    // ~5 MB pack (≈45% of the zone) is worth it — the old 32 MB floor said no
    const a = plan([zone(1, { bytesFull: 12 * MB, bytesNow: 1 * MB })], { budgetMb: 256, used: 225 * MB });
    expect(a.kind).toBe('promote-mixed');
    if (a.kind === 'promote-mixed') {
      expect(a.targetBytes).toBeLessThan(8 * MB);
    }
  });

  it('still refuses a mixed pack that would be noise for a huge zone', () => {
    // 200 MB zone, ~19 MB headroom → target under the 32 MB cap-floor
    const a = plan([zone(1, { bytesFull: 200 * MB, bytesNow: 1 * MB })], { budgetMb: 512, used: 443 * MB });
    expect(a.kind).not.toBe('promote-mixed');
  });

});

// -----------------------------------------------------------------------------
// convergence: the whole point — a scene must reach a stable state
// -----------------------------------------------------------------------------

describe('convergence', () => {
  /** Run the planner repeatedly, applying decisions to a toy scene, and check
   * that it stops asking for work (no infinite promote/demote loop). */
  function converge(zones: ZoneView[], input: Partial<PlanInput> = {}, maxSteps = 200) {
    const state = zones.map((z) => ({ ...z }));
    let used = (input.used as number) ?? state.reduce((n, z) => n + z.bytesNow, 0);
    const steps: string[] = [];
    for (let i = 0; i < maxSteps; i++) {
      const a = planResidency({
        zones: state,
        now: NOW,
        budgetMb: 512,
        used,
        eye: [0, 0, 0],
        fwd: [1, 0, 0],
        cuts: CUTS,
        pacing: FAST,
        ...input,
        used,
      });
      if (a.kind === 'none') {
        return { settled: true, steps, state };
      }
      steps.push(`${a.kind}:${'slot' in a ? a.slot : '-'}`);
      const z = state.find((s) => s.slot === ('slot' in a ? a.slot : -1));
      if (!z) {
        break;
      }
      // apply, mimicking what residency.ts does
      const setBytes = (b: number) => {
        used += b - z.bytesNow;
        z.bytesNow = b;
      };
      if (a.kind === 'promote-full' || a.kind === 'restore-full') {
        z.variant = 'full';
        setBytes(z.bytesFull);
        z.lastPromoteT = NOW;
      } else if (a.kind === 'promote-coarse') {
        z.variant = 'coarse';
        setBytes(z.bytesCoarse);
        z.lastPromoteT = NOW;
      } else if (a.kind === 'promote-mixed') {
        z.variant = 'mixed';
        setBytes(Math.min(z.bytesFull, a.targetBytes));
        z.packedEye = [0, 0, 0];
        z.packedDir = [1, 0, 0];
        z.packedTarget = a.targetBytes;
        z.packLimited = z.bytesFull > a.targetBytes;
        z.lastPromoteT = NOW;
      } else if (a.kind === 'demote') {
        z.variant = z.variant === 'coarse' ? 'unloaded' : 'coarse';
        setBytes(z.variant === 'unloaded' ? 0 : 1 * MB);
        z.lastDemoteT = NOW;
        z.starveCount = 0;
      } else if (a.kind === 'refresh-coarse') {
        z.coarseStale = false;
      } else if (a.kind === 'park') {
        z.cooldownUntil = a.untilT;
      }
    }
    return { settled: false, steps, state };
  }

  it('settles a roomy scene with every zone at full detail', () => {
    const zones = [1, 2, 3, 4].map((i) => zone(i, { variant: 'unloaded', bytesNow: 0, nearestDist: i * 5 }));
    const r = converge(zones, { budgetMb: 512, used: 0 });
    expect(r.settled).toBe(true);
    expect(r.state.map((z) => z.variant)).toEqual(['full', 'full', 'full', 'full']);
  });

  it('settles a scene that cannot fit, without looping forever', () => {
    const zones = [1, 2, 3, 4, 5, 6].map((i) =>
      zone(i, { variant: 'unloaded', bytesNow: 0, bytesFull: 40 * MB, nearestDist: i * 4 }),
    );
    const r = converge(zones, { budgetMb: 100, used: 0 });
    expect(r.settled).toBe(true);
  });

  it('prefers the nearest zones when the budget is tight', () => {
    const zones = [1, 2, 3, 4, 5, 6].map((i) =>
      zone(i, { variant: 'unloaded', bytesNow: 0, bytesFull: 40 * MB, nearestDist: i * 10 }),
    );
    const r = converge(zones, { budgetMb: 128, used: 0 });
    const nearest = r.state[0];
    const farthest = r.state[r.state.length - 1];
    expect(nearest.variant === 'full' || nearest.variant === 'mixed').toBe(true);
    expect(farthest.variant).not.toBe('full');
  });

  it('converges the starvation scene to nearest-first rings (no near holes)', () => {
    // a floor-saturated scene must end with: every seen zone at least coarse,
    // and remaining bytes on the nearest zones — never a hole near the camera
    const zones = [1, 2, 3, 4, 5].map((i) =>
      zone(i, {
        variant: i <= 2 ? 'unloaded' : 'coarse',
        bytesNow: i <= 2 ? 0 : 8 * MB,
        bytesCoarse: 2 * MB,
        bytesFull: 30 * MB,
        nearestDist: i * i * 8, // 8, 32, 72, 128, 200 — steep priority falloff
      }),
    );
    const r = converge(zones, { budgetMb: 40, used: 24 * MB });
    expect(r.settled).toBe(true);
    // the nearest zones (the ones that were holes) must exist again
    expect(r.state[0].variant).not.toBe('unloaded');
    expect(r.state[1].variant).not.toBe('unloaded');
  });

  it('does not thrash when a zone sits exactly at the cut-distance ring', () => {
    const onRing = zone(1, { variant: 'full', nearestDist: 130 }); // inside the dead band
    const r = converge([onRing], { budgetMb: 512, used: 10 * MB });
    expect(r.settled).toBe(true);
    expect(r.steps).toEqual([]);
  });
});
