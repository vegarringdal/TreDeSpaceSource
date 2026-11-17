import { describe, expect, it } from 'vitest';
import { visibilityApi } from '../src/lib/modeldb/apiVisibility';
import { IS_HIDDEN, models, NO_ITEM_EDGES } from '../src/lib/modeldb/dbState';
import { makeModel } from './helpers/testModel';

describe('setItemEdgesOnSelection', () => {
  const m = makeModel(
    [
      ['/A', -1],
      ['b1', 0],
      ['b2', 0],
      ['b3', 0],
    ],
    [1, 2, 3],
  );
  models.push(m);

  it('sets and clears the flag on the selected items only, keeping other bits', () => {
    m.states[0] = IS_HIDDEN; // item 0 hidden, and part of the selection
    m.selected = Uint32Array.from([0, 1]);
    const off = visibilityApi.setItemEdgesOnSelection(false);
    expect(off.map((u) => u.model)).toEqual([0]);
    expect(m.states[0] & NO_ITEM_EDGES).toBe(NO_ITEM_EDGES);
    expect(m.states[0] & IS_HIDDEN).toBe(IS_HIDDEN);
    expect(m.states[2] & NO_ITEM_EDGES).toBe(NO_ITEM_EDGES);
    expect(m.states[4] & NO_ITEM_EDGES).toBe(0);
    m.selected = Uint32Array.from([1]);
    visibilityApi.setItemEdgesOnSelection(true);
    expect(m.states[0] & NO_ITEM_EDGES).toBe(NO_ITEM_EDGES); // not selected anymore: untouched
    expect(m.states[2] & NO_ITEM_EDGES).toBe(0);
  });

  it('is a no-op without a selection', () => {
    m.selected = new Uint32Array(0);
    expect(visibilityApi.setItemEdgesOnSelection(false)).toEqual([]);
  });
});
