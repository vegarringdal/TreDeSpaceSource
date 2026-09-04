// "Select Inside / Select Intersecting" geometry: a world AABB against the
// clip volumes. Pins the exactness claims — a rotated box is tested with the
// separating-axis theorem (no false hits in the corners of its world
// envelope), a cylinder's disc is a disc (not its bounding square).
import { describe, expect, it } from 'vitest';
import { quatFromAxisAngle } from '../src/lib/math/quat';
import { aabbInsideShape, aabbIntersectsShape, type SelectShape } from '../src/lib/math/shapeBounds';

const aabb = (min: [number, number, number], max: [number, number, number]) => [...min, ...max];

describe('box', () => {
  const box: SelectShape = { kind: 'box', center: [0, 0, 0], half: [5, 5, 5], rotation: [0, 0, 0, 1] };

  it('inside, straddling, outside', () => {
    const inner = aabb([-1, -1, -1], [1, 1, 1]);
    expect(aabbInsideShape(inner, box)).toBe(true);
    expect(aabbIntersectsShape(inner, box)).toBe(true);
    const straddle = aabb([4, -1, -1], [6, 1, 1]);
    expect(aabbInsideShape(straddle, box)).toBe(false);
    expect(aabbIntersectsShape(straddle, box)).toBe(true);
    const outside = aabb([6, -1, -1], [8, 1, 1]);
    expect(aabbInsideShape(outside, box)).toBe(false);
    expect(aabbIntersectsShape(outside, box)).toBe(false);
  });

  it('rotated: no hit in the envelope corner, hit through the diagonal', () => {
    const turned: SelectShape = {
      kind: 'box',
      center: [0, 0, 0],
      half: [1, 1, 1],
      rotation: quatFromAxisAngle([0, 0, 1], Math.PI / 4),
    };
    // beyond the box's world x-extent (√2) — the box-axis intervals alone
    // would overlap, the world x axis separates
    expect(aabbIntersectsShape(aabb([1.5, -0.5, -0.5], [2, 0.5, 0.5]), turned)).toBe(false);
    // the diagonal corner region of the envelope, outside the turned box
    expect(aabbIntersectsShape(aabb([1.3, 1.3, -0.1], [1.4, 1.4, 0.1]), turned)).toBe(false);
    // touches the turned box's edge along the diagonal
    expect(aabbIntersectsShape(aabb([1.2, -0.1, -0.1], [1.6, 0.1, 0.1]), turned)).toBe(true);
    // fully inside the turned box only when within its rotated faces
    expect(aabbInsideShape(aabb([-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]), turned)).toBe(true);
    expect(aabbInsideShape(aabb([-0.9, -0.9, -0.5], [0.9, 0.9, 0.5]), turned)).toBe(false);
  });
});

describe('sphere', () => {
  const sphere: SelectShape = { kind: 'sphere', center: [0, 0, 0], radius: 2 };

  it('inside, touching, outside', () => {
    expect(aabbInsideShape(aabb([-1, -1, -1], [1, 1, 1]), sphere)).toBe(true);
    expect(aabbInsideShape(aabb([-1.5, -1.5, -1.5], [1.5, 1.5, 1.5]), sphere)).toBe(false);
    expect(aabbIntersectsShape(aabb([-1.5, -1.5, -1.5], [1.5, 1.5, 1.5]), sphere)).toBe(true);
    expect(aabbIntersectsShape(aabb([1.9, -0.1, -0.1], [3, 0.1, 0.1]), sphere)).toBe(true);
    // in the corner of the bounding cube but outside the ball
    expect(aabbIntersectsShape(aabb([1.5, 1.5, 1.5], [2, 2, 2]), sphere)).toBe(false);
  });
});

describe('cylinder', () => {
  const upright: SelectShape = { kind: 'cylinder', base: [0, 0, 0], axis: [0, 0, 1], radius: 1, height: 2 };

  it('inside, straddling the disc, outside the slab', () => {
    expect(aabbInsideShape(aabb([-0.5, -0.5, 0.2], [0.5, 0.5, 1.8]), upright)).toBe(true);
    expect(aabbInsideShape(aabb([-0.5, -0.5, -0.2], [0.5, 0.5, 1.8]), upright)).toBe(false);
    expect(aabbIntersectsShape(aabb([-0.5, -0.5, -0.2], [0.5, 0.5, 1.8]), upright)).toBe(true);
    expect(aabbIntersectsShape(aabb([-0.5, -0.5, 2.5], [0.5, 0.5, 3]), upright)).toBe(false);
  });

  it('disc, not bounding square: envelope corner misses, axis-crossing hits', () => {
    expect(aabbIntersectsShape(aabb([0.8, 0.8, 0.5], [1, 1, 1]), upright)).toBe(false);
    expect(aabbIntersectsShape(aabb([0.9, -0.1, 0.5], [1.5, 0.1, 1]), upright)).toBe(true);
    expect(aabbIntersectsShape(aabb([-2, -2, 0.5], [2, 2, 1]), upright)).toBe(true);
    expect(aabbInsideShape(aabb([-2, -2, 0.5], [2, 2, 1]), upright)).toBe(false);
  });

  it('tilted axis', () => {
    const along: SelectShape = { kind: 'cylinder', base: [0, 0, 0], axis: [1, 0, 0], radius: 1, height: 4 };
    expect(aabbInsideShape(aabb([1, -0.3, -0.3], [2, 0.3, 0.3]), along)).toBe(true);
    expect(aabbIntersectsShape(aabb([5, -0.3, -0.3], [6, 0.3, 0.3]), along)).toBe(false);
    expect(aabbIntersectsShape(aabb([1, 0.9, -0.1], [2, 1.5, 0.1]), along)).toBe(true);
    expect(aabbIntersectsShape(aabb([1, 1.1, -0.1], [2, 1.5, 0.1]), along)).toBe(false);
  });
});
