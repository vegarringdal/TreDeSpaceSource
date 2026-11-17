// The dense box must follow the cluster, not the outlier: one item parked a
// kilometre away used to widen a zone's decision box until it contained the
// camera (and, with coverage priority, would rank the zone as filling the
// view). The second sigma-clipping pass is what keeps it tight.
import { describe, expect, it } from 'vitest';
import { DenseBoxAccumulator } from '../src/lib/modeldb/denseBox';

function cube(cx: number, cy: number, cz: number, half = 0.5): number[] {
  return [cx - half, cy - half, cz - half, cx + half, cy + half, cz + half];
}

describe('DenseBoxAccumulator', () => {
  it('is null with nothing added and equals the union for one item', () => {
    const acc = new DenseBoxAccumulator();
    expect(acc.dense()).toBeNull();
    acc.add(cube(5, 5, 5));
    expect(acc.dense()).toEqual(cube(5, 5, 5));
    expect(acc.union()).toEqual(cube(5, 5, 5));
  });

  it('keeps a tight cluster tight', () => {
    const acc = new DenseBoxAccumulator();
    for (let i = 0; i < 10; i++) {
      acc.add(cube(i, 0, 0));
    }
    const d = acc.dense();
    expect(d).not.toBeNull();
    const span = Math.hypot(d![3] - d![0], d![4] - d![1], d![5] - d![2]);
    expect(span).toBeLessThan(20);
  });

  it('excludes a single far outlier from the dense box', () => {
    const acc = new DenseBoxAccumulator();
    for (let i = 0; i < 10; i++) {
      acc.add(cube(i, 0, 0));
    }
    acc.add(cube(1000, 0, 0)); // the parked item
    const d = acc.dense();
    const u = acc.union();
    expect(u?.[3]).toBeGreaterThan(999); // the union still spans it
    // a single mean ± 2σ pass keeps it (σ ≈ 300 m); the clipped pass does not
    expect(d?.[3]).toBeLessThan(50);
    expect(d?.[0]).toBeGreaterThanOrEqual(-5);
  });

  it('never leaves the union', () => {
    const acc = new DenseBoxAccumulator();
    acc.add(cube(0, 0, 0, 10));
    acc.add(cube(1, 0, 0, 10));
    const d = acc.dense();
    const u = acc.union();
    for (let k = 0; k < 3; k++) {
      expect(d![k]).toBeGreaterThanOrEqual(u![k]);
      expect(d![k + 3]).toBeLessThanOrEqual(u![k + 3]);
    }
  });
});
