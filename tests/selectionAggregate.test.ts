import { describe, expect, it } from 'vitest';
import { selectionApi } from '../src/lib/modeldb/apiSelection';
import { treeApi } from '../src/lib/modeldb/apiTree';
import { models } from '../src/lib/modeldb/dbState';
import { makeModel } from './helpers/testModel';

describe('selectedUnder aggregate + selectedItemNames', () => {
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
  const mi = models.length - 1;

  it('counts selected items per subtree from item state (invert included)', () => {
    selectionApi.selectSubtree(mi, 1); // /A/B → b1, b2
    expect(treeApi.node(mi, 1).selectedUnder).toBe(2);
    expect(treeApi.node(mi, 0).selectedUnder).toBe(2); // partial at /A (3 items)
    expect(treeApi.node(mi, 2).selectedUnder).toBe(0);
    selectionApi.invertSelection(); // → c1 only
    expect(treeApi.node(mi, 1).selectedUnder).toBe(0);
    expect(treeApi.node(mi, 2).selectedUnder).toBe(1);
    expect(treeApi.node(mi, 0).selectedUnder).toBe(1);
  });

  it('lists every selected NODE (groups and leaves), skips prefixes, caps with the true total', () => {
    selectionApi.selectSubtree(mi, 0);
    const all = selectionApi.selectedNodeNames(10, []);
    expect([...all.names].sort()).toEqual(['/A', '/A/B', '/A/C', 'b1', 'b2', 'c1']);
    expect([all.total, all.truncated]).toEqual([6, false]);
    const skipped = selectionApi.selectedNodeNames(10, ['/a/']);
    expect([...skipped.names].sort()).toEqual(['/A', 'b1', 'b2', 'c1']);
    expect(skipped.total).toBe(4);
    const capped = selectionApi.selectedNodeNames(2, []);
    expect(capped.names).toHaveLength(2);
    expect([capped.total, capped.truncated]).toEqual([6, true]);
    // a partially selected parent is NOT a selected node
    selectionApi.selectSubtree(mi, 1);
    expect([...selectionApi.selectedNodeNames(10, []).names].sort()).toEqual(['/A/B', 'b1', 'b2']);
  });

  it('lists every ancestor of the selection once, partial and full alike, plus the import folder', () => {
    selectionApi.selectSubtree(mi, 1); // b1, b2 → /A/B full, /A partial; the model sits in folder "test"
    expect([...selectionApi.selectedNodeParents([])].sort()).toEqual(['/A', '/A/B', 'test']);
    expect(selectionApi.selectedNodeParents(['/a/', 'te'])).toEqual(['/A']);
    selectionApi.selectSubtree(mi, 0); // whole model: every grouping row, still once each
    expect([...selectionApi.selectedNodeParents([])].sort()).toEqual(['/A', '/A/B', '/A/C', 'test']);
    selectionApi.clearSelection();
    expect(selectionApi.selectedNodeParents([])).toEqual([]);
  });

  it('nested import folders become one cumulative path per level', () => {
    const group = m.group;
    m.group = 'plant/area 1';
    selectionApi.selectSubtree(mi, 2); // c1 → /A/C full, /A partial
    expect([...selectionApi.selectedNodeParents([])].sort()).toEqual(['/A', '/A/C', 'plant', 'plant/area 1']);
    m.group = group;
    selectionApi.clearSelection();
  });
});
