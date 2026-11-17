import { beforeEach, describe, expect, it } from 'vitest';
import {
  ANIM_BAND_FIRST,
  ANIM_BAND_SIZE,
  allocAnimSlot,
  allocTransformSlot,
  animSlotsUsed,
  clearSweptBounds,
  COMMITTED_SLOTS,
  itemWorldBounds,
  resetAnimBand,
  resetTransformPool,
  setSweptBounds,
  TRANSFORM_POOL,
  transforms,
  transformsSnapshot,
} from '../src/lib/modeldb/transformPool';

describe('transform pool animation band', () => {
  beforeEach(() => {
    resetTransformPool();
    resetAnimBand();
    clearSweptBounds();
  });

  it('reserves the top of the pool', () => {
    expect(ANIM_BAND_FIRST).toBe(COMMITTED_SLOTS);
    expect(TRANSFORM_POOL - ANIM_BAND_FIRST).toBe(ANIM_BAND_SIZE);
    expect(ANIM_BAND_SIZE).toBeGreaterThanOrEqual(16384);
  });

  it('wraps the committed allocator before the band', () => {
    let maxSeen = 0;
    for (let i = 0; i < COMMITTED_SLOTS + 10; i++) {
      maxSeen = Math.max(maxSeen, allocTransformSlot());
    }
    expect(maxSeen).toBe(COMMITTED_SLOTS - 1);
    // the GPU upload of committed slots never reaches the band
    expect(transformsSnapshot().length).toBeLessThanOrEqual(ANIM_BAND_FIRST * 16);
  });

  it('hands out band slots until full, then null', () => {
    expect(allocAnimSlot()).toBe(ANIM_BAND_FIRST);
    expect(animSlotsUsed()).toBe(1);
    for (let i = 1; i < TRANSFORM_POOL - ANIM_BAND_FIRST; i++) {
      allocAnimSlot();
    }
    expect(allocAnimSlot()).toBeNull();
    resetAnimBand();
    expect(allocAnimSlot()).toBe(ANIM_BAND_FIRST);
  });

  it('answers world bounds of a band slot: the pose, or the swept box for residency', () => {
    const slot = ANIM_BAND_FIRST + 3;
    transforms.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1], slot * 16);
    const itemBounds = new Float32Array([0, 0, 0, 1, 1, 1]);
    const tidx = new Uint32Array([slot]);
    const out = new Float32Array(6);
    itemWorldBounds(itemBounds, tidx, 0, out);
    expect(Array.from(out)).toEqual([5, 0, 0, 6, 1, 1]);
    setSweptBounds(slot, new Float32Array([-1, -1, -1, 20, 2, 2]));
    itemWorldBounds(itemBounds, tidx, 0, out, true);
    expect(Array.from(out)).toEqual([-1, -1, -1, 20, 2, 2]);
    // selection, fit, explode: where it is now, not the whole path
    itemWorldBounds(itemBounds, tidx, 0, out);
    expect(Array.from(out)).toEqual([5, 0, 0, 6, 1, 1]);
  });
});
