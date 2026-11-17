// The Hierarchy's "Model order": below the zones (model level 3 and deeper)
// children come in the model file's own order; sites and zones, and
// everything when the toggle is off, stay A–Z.
import { describe, expect, it } from 'vitest';
import { treeApi } from '../src/lib/modeldb/apiTree';
import { models } from '../src/lib/modeldb/dbState';
import { makeModel } from './helpers/testModel';

//  /SITE               level 1
//    /ZONE-B           level 2   (file order: B before A)
//      /PIPE-9         level 3   (file order: 9, 1, 5)
//        /PIPE-9/Z     level 4   (file order: Z, A)
//        /PIPE-9/A
//      /PIPE-1
//      /PIPE-5
//    /ZONE-A
const m = makeModel(
  [
    ['/SITE', -1],
    ['/ZONE-B', 0],
    ['/PIPE-9', 1],
    ['/PIPE-9/Z', 2],
    ['/PIPE-9/A', 2],
    ['/PIPE-1', 1],
    ['/PIPE-5', 1],
    ['/ZONE-A', 0],
  ],
  [3, 4, 5, 6, 7],
);
models.push(m);
const mi = models.indexOf(m);

/** The child names of the entry called `name`, with or without model order. */
const childNames = (name: string, fileOrderFromLevel?: number): string[] => {
  const entry = [0, 1, 2].find((e) => treeApi.node(mi, e).name === name) ?? -1;
  return treeApi.children(mi, entry, fileOrderFromLevel).map((n) => n.name);
};

describe('Hierarchy children order', () => {
  it('A–Z by default, at every level', () => {
    expect(childNames('/SITE')).toEqual(['/ZONE-A', '/ZONE-B']);
    expect(childNames('/ZONE-B')).toEqual(['/PIPE-1', '/PIPE-5', '/PIPE-9']);
    expect(childNames('/PIPE-9')).toEqual(['/PIPE-9/A', '/PIPE-9/Z']);
  });

  it('model order from level 3: zones stay A–Z, what is below them keeps the file order', () => {
    expect(childNames('/SITE', 3)).toEqual(['/ZONE-A', '/ZONE-B']);
    expect(childNames('/ZONE-B', 3)).toEqual(['/PIPE-9', '/PIPE-1', '/PIPE-5']);
    expect(childNames('/PIPE-9', 3)).toEqual(['/PIPE-9/Z', '/PIPE-9/A']);
  });
});
