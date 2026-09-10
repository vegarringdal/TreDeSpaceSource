import { describe, expect, it } from 'vitest';
import { visibilityApi } from '../src/lib/modeldb/apiVisibility';
import { HAS_OPACITY_OVERRIDE, IS_HIDDEN, models, OPACITY_SHIFT } from '../src/lib/modeldb/dbState';
import { makeModel } from './helpers/testModel';

describe('visibleWorldBounds (fit visible)', () => {
  const m = makeModel(
    [
      ['/A', -1],
      ['a1', 0],
      ['a2', 0],
      ['a3', 0],
      ['a4', 0],
    ],
    [1, 2, 3, 4],
  );
  // item 0 at the origin, 1 far out, 2 the other way, 3 without geometry
  m.itemBounds.set([0, 0, 0, 1, 1, 1], 0);
  m.itemBounds.set([100, 100, 100, 101, 101, 101], 6);
  m.itemBounds.set([-50, -50, -50, -49, -49, -49], 12);
  m.itemBounds.set([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], 18);
  models.push(m);

  it('spans every visible item that has geometry', () => {
    expect(visibilityApi.visibleWorldBounds()).toEqual({ min: [-50, -50, -50], max: [101, 101, 101] });
  });

  it('skips the hide flag AND an opacity-0 override (Set Color hidden, sql.color default-hidden)', () => {
    m.states[1 * 2] = IS_HIDDEN;
    m.states[2 * 2] = HAS_OPACITY_OVERRIDE; // opacity bits 0 → drawn at zero alpha
    expect(visibilityApi.visibleWorldBounds()).toEqual({ min: [0, 0, 0], max: [1, 1, 1] });
  });

  it('keeps a translucent override in the frame', () => {
    m.states[2 * 2] = (HAS_OPACITY_OVERRIDE | (50 << OPACITY_SHIFT)) >>> 0;
    expect(visibilityApi.visibleWorldBounds()).toEqual({ min: [-50, -50, -50], max: [1, 1, 1] });
  });

  it('is null once nothing visible is left', () => {
    m.states[0] = IS_HIDDEN;
    m.states[2 * 2] = HAS_OPACITY_OVERRIDE;
    expect(visibilityApi.visibleWorldBounds()).toBeNull();
  });
});
