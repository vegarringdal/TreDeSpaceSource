// The same file loaded three times — twice from one store under two names,
// once from another store — carries the very same fullnames. A transform
// object made in one copy names the file it came from, so resolving,
// selecting and grouping its items stay in that copy.
import { beforeAll, describe, expect, it } from 'vitest';
import { animationApi } from '../src/lib/modeldb/apiAnimation';
import { IS_SELECTED, models } from '../src/lib/modeldb/dbState';
import { type ModelRef, resolveItems } from '../src/lib/modeldb/itemSets';
import { makeModel } from './helpers/testModel';

//        /A
//      /    \
//    /A/B   /A/C
//     |       |
//    b1      c1      (leaves = items 0..1)
const ENTRIES: [string, number][] = [
  ['/A', -1],
  ['/A/B', 0],
  ['/A/C', 0],
  ['b1', 1],
  ['c1', 2],
];
const LEAF_ITEMS = [3, 4];

const AA: ModelRef = { store: 'aa', group: 'g', name: 'HA.RVM' };
const BB: ModelRef = { store: 'bb', group: 'g', name: 'HA.RVM' };
const BB2: ModelRef = { store: 'bb', group: 'g', name: 'HA.RVM2' };

describe('item sets limited to model files', () => {
  beforeAll(() => {
    models.length = 0;
    for (const ref of [AA, BB, BB2]) {
      models.push({ ...makeModel(ENTRIES, LEAF_ITEMS), ...ref });
    }
  });

  it('without a scope a name resolves in every copy', () => {
    expect([...resolveItems(['/a/b']).byModel.keys()]).toEqual([0, 1, 2]);
  });

  it('with a scope it resolves only in those files (store is part of the identity)', () => {
    expect([...resolveItems(['/a/b'], [], [BB]).byModel.keys()]).toEqual([1]);
    expect([...resolveItems(['/a/b'], [], [AA, BB2]).byModel.keys()]).toEqual([0, 2]);
  });

  it('selecting an object replaces the selection with its items in its own file only', () => {
    animationApi.animSelectActor(['/a/c'], [], [AA]);
    animationApi.animSelectActor(['/a/b'], [], [BB]);
    expect(models.map((m) => Array.from(m.selected))).toEqual([[], [0], []]);
    expect(models[1].states[0] & IS_SELECTED).toBe(IS_SELECTED);
    expect(models[0].states[2] & IS_SELECTED).toBe(0);
  });

  it('the selection names the file it was made in', () => {
    expect(animationApi.animActorFromSelection()?.models).toEqual([BB]);
  });

  it('the closest group is found within the scope, not given up across copies', () => {
    expect(animationApi.animClosestGroup(['/a/b', '/a/c'])).toBeNull();
    expect(animationApi.animClosestGroup(['/a/b', '/a/c'], [], [BB])?.group).toBe('/a');
  });
});
