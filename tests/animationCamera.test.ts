import { describe, expect, it } from 'vitest';
import { eyeOf, viewFromPoints } from '../src/lib/animation/cameraEye';
import type { AnimCamera } from '../src/lib/animation/types';

const view: AnimCamera = { target: [1, 2, 3], azimuth: 0.6, elevation: -0.4, orbitDistance: 12, orthographic: false };

describe('camera key points', () => {
  it('turns a pose into its eye and back', () => {
    const back = viewFromPoints(view, eyeOf(view), view.target);
    expect(back?.azimuth).toBeCloseTo(view.azimuth, 9);
    expect(back?.elevation).toBeCloseTo(view.elevation, 9);
    expect(back?.orbitDistance).toBeCloseTo(view.orbitDistance, 9);
    expect(back?.target).toEqual(view.target);
    expect(back?.orthographic).toBe(false);
  });

  it('looks from the eye at the target, the eye kept when the target moves', () => {
    const v = viewFromPoints(view, [10, 0, 0], [0, 0, 0]);
    expect(v?.azimuth).toBeCloseTo(Math.PI, 9);
    expect(v?.elevation).toBeCloseTo(0, 9);
    expect(v?.orbitDistance).toBeCloseTo(10, 9);
    const eye = eyeOf(v ?? view);
    expect(eye.map((x) => Math.round(x * 1e9) / 1e9 + 0)).toEqual([10, 0, 0]);
  });

  it('clamps straight down like the viewer and refuses one point twice', () => {
    const down = viewFromPoints(view, [0, 0, 10], [0, 0, 0]);
    expect(down?.elevation).toBeCloseTo((-89 * Math.PI) / 180, 9);
    expect(down?.azimuth).toBe(view.azimuth);
    expect(viewFromPoints(view, [1, 1, 1], [1, 1, 1])).toBeNull();
  });
});
