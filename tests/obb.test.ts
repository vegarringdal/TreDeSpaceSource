// clip.box.get hands hosts the world AABB of the (possibly rotated) default
// clipping box; a wrong envelope silently loads the wrong models.
import { describe, expect, it } from 'vitest';
import { obbWorldBounds } from '../src/lib/math/obb';
import { QUAT_IDENTITY, quatFromAxisAngle } from '../src/lib/math/quat';

const near = (v: number[], want: number[]) => {
  for (let k = 0; k < 3; k++) {
    expect(v[k]).toBeCloseTo(want[k], 9);
  }
};

describe('obbWorldBounds', () => {
  it('identity rotation is center ± size/2', () => {
    const { min, max } = obbWorldBounds([1, 2, 3], [10, 4, 2], QUAT_IDENTITY);
    near(min, [-4, 0, 2]);
    near(max, [6, 4, 4]);
  });

  it('90° about Z swaps the x/y extents', () => {
    const q = quatFromAxisAngle([0, 0, 1], Math.PI / 2);
    const { min, max } = obbWorldBounds([0, 0, 0], [10, 2, 4], q);
    near(min, [-1, -5, -2]);
    near(max, [1, 5, 2]);
  });

  it('45° about Z grows x/y to the corner envelope, z untouched', () => {
    const q = quatFromAxisAngle([0, 0, 1], Math.PI / 4);
    const { min, max } = obbWorldBounds([0, 0, 0], [2, 2, 2], q);
    near(min, [-Math.SQRT2, -Math.SQRT2, -1]);
    near(max, [Math.SQRT2, Math.SQRT2, 1]);
  });
});
