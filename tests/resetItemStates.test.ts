import { describe, expect, it } from 'vitest';
import { HAS_COLOR_OVERRIDE, IS_HIDDEN, NO_ITEM_EDGES, resetItemStates } from '../src/lib/modeldb/dbState';
import { makeModel } from './helpers/testModel';

describe('resetItemStates', () => {
  it('drops every flag, restores the base color, zeroes transforms and selection', () => {
    const m = makeModel(
      [
        ['root', -1],
        ['a', 0],
        ['b', 0],
      ],
      [1, 2],
    );
    m.baseColor.set([0x11223344, 0x55667788]);
    m.states.set([IS_HIDDEN | HAS_COLOR_OVERRIDE, 0xff0000ff, NO_ITEM_EDGES, 0x00ff00ff]);
    m.tidx.set([3, 0]);
    m.selected = new Uint32Array([1]);
    m.stateVersion = 7;

    resetItemStates(m);

    expect([...m.states]).toEqual([0, 0x11223344, 0, 0x55667788]);
    expect([...m.tidx]).toEqual([0, 0]);
    expect(m.selected.length).toBe(0);
    expect(m.stateVersion).toBe(8);
  });
});
