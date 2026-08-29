import { describe, expect, it } from 'vitest';
import { treeApi } from '../src/lib/modeldb/apiTree';
import { models } from '../src/lib/modeldb/dbState';
import { makeModel } from './helpers/testModel';

describe('itemFullnamePath', () => {
  const m = makeModel(
    [
      ['/ROOT', -1],
      ['/ROOT/A', 0],
      ['leaf', 1],
    ],
    [2],
  );
  m.group = 'Topside/Deck2';
  models.push(m);

  it('is the tree-view path: folder levels, then the entry chain', () => {
    expect(treeApi.itemFullnamePath(models.length - 1, 0)).toEqual(['Topside', 'Deck2', '/ROOT', '/ROOT/A', 'leaf']);
  });
});
