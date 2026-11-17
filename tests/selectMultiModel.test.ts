// The same structure loaded twice: a fullname must resolve in EVERY live model,
// so selecting a name — or framing it — covers both copies, the rule the colour
// rules and the label anchors already follow. Selection used to stop at the
// first model that carried the name.
import { describe, expect, it } from 'vitest';
import { packedFromLines } from '../src/lib/color/packedNames';
import { selectionApi } from '../src/lib/modeldb/apiSelection';
import { treeApi } from '../src/lib/modeldb/apiTree';
import { IS_SELECTED, models } from '../src/lib/modeldb/dbState';
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

describe('fullnames resolve in every loaded model', () => {
  const first = makeModel(ENTRIES, LEAF_ITEMS);
  const second = makeModel(ENTRIES, LEAF_ITEMS);
  // the second copy stands 1000 m away, so a bounds union has to span both
  second.itemBounds.set([1000, 0, 0, 1001, 1, 1], 0);
  models.push(first, second);

  it('findEntriesByNames returns one entry per model carrying the name', () => {
    const hits = treeApi.findEntriesByNames(['/A/B']);
    expect(hits.map((h) => h.model)).toEqual([0, 1]);
    expect(hits.map((h) => h.entry)).toEqual([1, 1]);
  });

  it('selectPacked selects the name in both models and counts hits, not names', () => {
    const r = selectionApi.selectPacked(packedFromLines('/A/B\n/nope\n'));

    expect(r.matched).toBe(2); // one entry per model
    expect(r.missed).toBe(1); // names that resolved nowhere
    expect(Array.from(r.pairs)).toEqual([0, 1, 1, 1]);
    expect(Array.from(first.selected)).toEqual([0]);
    expect(Array.from(second.selected)).toEqual([0]);
    expect(first.states[0] & IS_SELECTED).toBe(IS_SELECTED);
    expect(second.states[0] & IS_SELECTED).toBe(IS_SELECTED);
    expect(r.updates.map((u) => u.model).sort()).toEqual([0, 1]);
  });

  it('boundsForNames frames every copy, so nav.flyTo fits them all', () => {
    const b = treeApi.boundsForNames(['/A/B']);

    expect(b).not.toBeNull();
    expect(b?.min).toEqual([0, 0, 0]);
    expect(b?.max).toEqual([1001, 1, 1]);
  });
});
