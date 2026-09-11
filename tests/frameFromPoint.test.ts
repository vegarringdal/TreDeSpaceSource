import { describe, expect, it } from 'vitest';
import { framingDistanceFromPoint } from '../src/lib/math/frameFromPoint';

const FOV = Math.PI / 2; // tan(fov/2) = 1 → distance = 1.3 × farthest-corner radius

describe('framingDistanceFromPoint', () => {
  it('frames the farthest corner from an off-centre pivot with the fit margin', () => {
    const bounds = { min: [0, 0, 0], max: [4, 3, 0] };
    // pivot at the origin corner: farthest corner is (4,3,0) → radius 5
    expect(framingDistanceFromPoint([0, 0, 0], bounds, FOV, 0)).toBeCloseTo(6.5);
    // pivot at the centre: radius 2.5
    expect(framingDistanceFromPoint([2, 1.5, 0], bounds, FOV, 0)).toBeCloseTo(3.25);
  });

  it('never goes closer than the floor, and falls back to it without bounds', () => {
    const tiny = { min: [0, 0, 0], max: [0.1, 0.1, 0.1] };
    expect(framingDistanceFromPoint([0, 0, 0], tiny, FOV, 2)).toBe(2);
    expect(framingDistanceFromPoint([0, 0, 0], null, FOV, 2)).toBe(2);
  });
});
