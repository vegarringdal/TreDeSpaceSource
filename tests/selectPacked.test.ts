import { describe, expect, it } from 'vitest';
import { packedFromLines } from '../src/lib/color/packedNames';
import { selectionApi } from '../src/lib/modeldb/apiSelection';
import { IS_SELECTED, models } from '../src/lib/modeldb/dbState';
import { makeModel } from './helpers/testModel';

describe('selectPacked', () => {
  const m = makeModel(
    [
      ['/A', -1],
      ['/A/B', 0],
      ['/A/C', 0],
      ['b1', 1],
      ['b2', 1],
      ['c1', 2],
    ],
    [3, 4, 5],
  );
  models.push(m);

  it('selects every subtree named in the list, reports misses, returns flat pairs', () => {
    const r = selectionApi.selectPacked(packedFromLines('/A/B\nC1\n/nope\n'));
    expect(r.matched).toBe(2);
    expect(r.missed).toBe(1);
    expect(Array.from(r.pairs)).toEqual([0, 1, 0, 5]); // /A/B, then the leaf c1
    expect(Array.from(m.selected)).toEqual([0, 1, 2]);
    for (let i = 0; i < 3; i++) {
      expect(m.states[i * 2] & IS_SELECTED).toBe(IS_SELECTED);
    }
    expect(r.updates.map((u) => u.model)).toEqual([0]);
  });

  it('replaces the previous selection', () => {
    const r = selectionApi.selectPacked(packedFromLines('b2'));
    expect(r.matched).toBe(1);
    expect(Array.from(m.selected)).toEqual([1]);
    expect(m.states[0] & IS_SELECTED).toBe(0);
  });
});
