// The cloud-axes helpers (src/lib/tdpp/cloudFrame.ts): a .tdpp whose source
// has a rotated coordinate system is searched in its own axes and drawn in
// the scene's.
import { describe, expect, it } from 'vitest';
import { axesOfQuat, boxToScene, planesToCloud, toCloud, toScene } from '../src/lib/tdpp/cloudFrame';

const HALF = Math.SQRT1_2;
/** +90° about Z: x → y, y → −x. */
const QUARTER_Z = [HALF, 0, 0, HALF] as const;

describe('cloud axes', () => {
  it('treats the identity as no rotation at all', () => {
    expect(axesOfQuat([1, 0, 0, 0])).toBeNull();
    expect(toScene(null, [1, 2, 3])).toEqual([1, 2, 3]);
    const planes = new Float32Array([1, 0, 0, 5]);
    expect(planesToCloud(null, planes)).toBe(planes);
  });

  it('turns vectors to the scene and back', () => {
    const m = axesOfQuat(QUARTER_Z);
    const s = toScene(m, [1, 0, 0]);
    expect(s[0]).toBeCloseTo(0);
    expect(s[1]).toBeCloseTo(1);
    const back = toCloud(m, s);
    expect(back[0]).toBeCloseTo(1);
    expect(back[1]).toBeCloseTo(0);
  });

  it('keeps a plane test true for the same point in either frame', () => {
    const m = axesOfQuat(QUARTER_Z);
    // scene plane x >= 2, as (n, d): inside = n·p + d >= 0
    const cloud = planesToCloud(m, new Float32Array([1, 0, 0, -2]));
    const inside = (p: readonly [number, number, number]) =>
      cloud[0] * p[0] + cloud[1] * p[1] + cloud[2] * p[2] + cloud[3] >= 0;
    expect(inside(toCloud(m, [3, 0, 0]))).toBe(true);
    expect(inside(toCloud(m, [1, 0, 0]))).toBe(false);
  });

  it('bounds a rotated box in scene axes', () => {
    const b = boxToScene(axesOfQuat(QUARTER_Z), [0, 0, 0], [4, 1, 2]);
    expect(b.min[0]).toBeCloseTo(-1);
    expect(b.max[0]).toBeCloseTo(0);
    expect(b.min[1]).toBeCloseTo(0);
    expect(b.max[1]).toBeCloseTo(4);
    expect(b.max[2]).toBeCloseTo(2);
  });
});
