import { describe, expect, it } from 'vitest';
import { modelsApi } from '../src/lib/modeldb/apiModels';
import { treeApi } from '../src/lib/modeldb/apiTree';
import { models } from '../src/lib/modeldb/dbState';
import { makeModel } from './helpers/testModel';

// Model A: twelve ZQD-PIPE and three zqd-leaf copies (mixed case) at level 3,
// enough to crowd a ten-row plain search. Model B carries zqd-leaf one level
// higher, so B's copy is the shallowest.
const PIPES = 12;

describe('one-per-name hierarchy search', () => {
  const a = makeModel(
    [
      ['/ZQD-ROOT', -1],
      ['/ZQD-A', 0],
      ['/ZQD-B', 0],
      ['ZQD-LEAF', 1],
      ['ZQD-LEAF', 2],
      ['zqd-leaf', 2],
      ...Array.from({ length: PIPES }, (): [string, number] => ['ZQD-PIPE', 1]),
    ],
    [3, 4, 5],
  );
  a.group = 'ZQDFOLDER';
  models.push(a);
  const ai = models.length - 1;
  const b = makeModel(
    [
      ['/ZQD-OTHER', -1],
      ['ZQD-LEAF', 0],
    ],
    [1],
  );
  b.group = 'ZQDFOLDER';
  models.push(b);
  const bi = models.length - 1;

  it('plain search lists every copy, so duplicates crowd the ten rows', () => {
    const hits = treeApi.search('zqd', 'contains', 10);
    expect(hits).toHaveLength(10);
    expect(hits.some((h) => h.name === 'ZQD-PIPE')).toBe(true);
    expect(hits.every((h) => h.count === undefined)).toBe(true);
  });

  it('distinct search collapses names before the cap and counts every copy', () => {
    const hits = treeApi.search('zqd', 'contains', 10, true);
    const names = hits.map((h) => h.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    expect(hits.find((h) => h.name === 'ZQD-PIPE')?.count).toBe(PIPES);
    expect(hits.find((h) => h.name.toLowerCase() === 'zqd-leaf')?.count).toBe(4);
    expect(hits.find((h) => h.name === '/ZQD-ROOT')?.count).toBe(1);
    expect(hits.some((h) => h.group === 'ZQDFOLDER')).toBe(true);
  });

  it('a distinct row stands on the shallowest copy', () => {
    const leaf = treeApi.search('zqd-leaf', 'equals', 10, true);
    expect(leaf).toHaveLength(1);
    expect(leaf[0]).toMatchObject({ model: bi, entry: 1, path: [0, 1], count: 4 });
  });

  it('copies in an unloaded model are not counted', () => {
    modelsApi.forgetModels([bi]);
    const leaf = treeApi.search('zqd-leaf', 'equals', 10, true);
    expect(leaf).toHaveLength(1);
    expect(leaf[0]).toMatchObject({ model: ai, count: 3 });
    expect(leaf[0].path).toHaveLength(3);
  });
});
