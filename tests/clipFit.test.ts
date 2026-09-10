// Fit visible honours the clipping in force: the frame is the visible box cut
// down to the clip volumes and planes, or the volumes themselves in bbox mode.
import { describe, expect, it } from 'vitest';
import { type Aabb, clipAabbByHalfSpace } from '../src/lib/math/aabb';
import { fitBoundsWithClipping } from '../src/lib/math/clipFit';
import { planeWorld } from '../src/lib/math/clipPlane';
import { QUAT_IDENTITY, type V3 } from '../src/lib/math/quat';
import { type SelectShape, shapeWorldBounds } from '../src/lib/math/shapeBounds';

const box = (min: V3, max: V3): Aabb => ({ min, max });
const near = (got: Aabb, want: Aabb) => {
  for (let k = 0; k < 3; k++) {
    expect(got.min[k]).toBeCloseTo(want.min[k], 9);
    expect(got.max[k]).toBeCloseTo(want.max[k], 9);
  }
};
const VISIBLE = box([0, 0, 0], [10, 10, 10]);
const CLIP_BOX: SelectShape = { kind: 'box', center: [2, 2, 2], half: [3, 3, 3], rotation: QUAT_IDENTITY }; // -1..5

describe('fitBoundsWithClipping', () => {
  it('frames the visible box when nothing clips', () => {
    expect(fitBoundsWithClipping(VISIBLE, 'visible', [], [])).toEqual(VISIBLE);
    expect(fitBoundsWithClipping(VISIBLE, 'bbox', [], [])).toEqual(VISIBLE);
  });

  it('visible mode cuts the visible box down to the volume; bbox mode frames the volume itself', () => {
    expect(fitBoundsWithClipping(VISIBLE, 'visible', [CLIP_BOX], [])).toEqual(box([0, 0, 0], [5, 5, 5]));
    expect(fitBoundsWithClipping(VISIBLE, 'bbox', [CLIP_BOX], [])).toEqual(box([-1, -1, -1], [5, 5, 5]));
  });

  it('a volume that misses the model is framed on its own', () => {
    const far: SelectShape = { kind: 'sphere', center: [50, 50, 50], radius: 1 };
    expect(fitBoundsWithClipping(VISIBLE, 'visible', [far], [])).toEqual(box([49, 49, 49], [51, 51, 51]));
  });

  it('unions several volumes: sphere and cylinder envelopes', () => {
    const sphere: SelectShape = { kind: 'sphere', center: [0, 0, 0], radius: 2 };
    const cyl: SelectShape = { kind: 'cylinder', base: [0, 0, 0], axis: [0, 0, 1], radius: 1, height: 5 };
    expect(shapeWorldBounds(cyl)).toEqual(box([-1, -1, 0], [1, 1, 5]));
    expect(fitBoundsWithClipping(VISIBLE, 'bbox', [sphere, cyl], [])).toEqual(box([-2, -2, -2], [2, 2, 5]));
  });

  it('planes trim the box exactly on the normal side; a plane that clears the box is skipped', () => {
    expect(fitBoundsWithClipping(VISIBLE, 'visible', [], [{ n: [1, 0, 0], d: -4 }])).toEqual(
      box([4, 0, 0], [10, 10, 10]),
    );
    const s = Math.SQRT1_2;
    near(clipAabbByHalfSpace(VISIBLE, [s, s, 0], -14 * s) ?? VISIBLE, box([4, 4, 0], [10, 10, 10]));
    expect(clipAabbByHalfSpace(VISIBLE, [1, 0, 0], -20)).toBeNull();
    expect(fitBoundsWithClipping(VISIBLE, 'visible', [], [{ n: [1, 0, 0], d: -20 }])).toEqual(VISIBLE);
  });

  it('planeWorld keeps the normal side, flip negates it, the anchor defaults to the scene centre', () => {
    const spec = { el: 0, az: 0, position: 2, flipped: false, anchor: null };
    const p = planeWorld(spec, [1, 0, 0]);
    expect(p.n).toEqual([1, 0, 0]);
    expect(p.point).toEqual([3, 0, 0]);
    expect(p.d).toBe(-3);
    const f = planeWorld({ ...spec, flipped: true }, [1, 0, 0]);
    expect(f.n).toEqual([-1, -0, -0]);
    expect(f.d).toBe(3);
  });
});
