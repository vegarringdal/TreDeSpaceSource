import { afterEach, describe, expect, it } from 'vitest';
import { models } from '../src/lib/modeldb/dbState';
import { type DirtyRanges, markDirty, markItems, packDirty, packStateRange } from '../src/lib/modeldb/hierarchyIndex';
import { makeModel } from './helpers/testModel';

/** A model of `n` leaf items under one root, states = item index. */
function model(n: number) {
  const entries: [string, number][] = [['/root', -1], ...Array.from({ length: n }, (_, i): [string, number] => [`/i${i}`, 0])];
  const m = makeModel(
    entries,
    Array.from({ length: n }, (_, i) => i + 1),
  );
  for (let i = 0; i < n; i++) {
    m.states[i * 2] = i;
    m.states[i * 2 + 1] = 1000 + i;
    m.tidx[i] = 7;
  }
  return m;
}

describe('partial state uploads', () => {
  afterEach(() => {
    models.length = 0;
  });

  it('packs one range, interleaved, from its first item', () => {
    const m = model(10);
    const u = packStateRange(m, 3, 4, 6);
    expect(u.first).toBe(4);
    expect([...u.states]).toEqual([4, 1004, 7, 5, 1005, 7]);
    expect(u.model).toBe(3);
  });

  it('merges nearby runs and uploads small changes alone, big ones whole', () => {
    models.push(model(100));
    const d: DirtyRanges = new Map();
    markDirty(d, 0, 10, 12);
    markDirty(d, 0, 8, 9);
    const [small] = packDirty(d);
    expect(small.first).toBe(8);
    expect(small.states.length).toBe(4 * 3);
    markDirty(d, 0, 0, 90);
    const [whole, ...rest] = packDirty(d);
    expect(rest).toEqual([]);
    expect(whole.first).toBeUndefined();
    expect(whole.states.length).toBe(100 * 3);
  });

  it('keeps scattered items as separate small writes', () => {
    models.push(model(1000));
    const d: DirtyRanges = new Map();
    markItems(d, 0, [1, 2, 3, 50, 51, 400]);
    const ups = packDirty(d);
    expect(ups.map((u) => [u.first, u.states.length / 3])).toEqual([
      [1, 3],
      [50, 2],
      [400, 1],
    ]);
  });

  it('bumps the state version so the tree aggregates refresh', () => {
    const m = model(4);
    const v = m.stateVersion ?? 0;
    packStateRange(m, 0, 1, 2);
    expect(m.stateVersion).toBe(v + 1);
  });
});
