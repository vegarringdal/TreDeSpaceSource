import { describe, expect, it } from 'vitest';
import { modelsApi } from '../src/lib/modeldb/apiModels';
import { treeApi } from '../src/lib/modeldb/apiTree';
import { models } from '../src/lib/modeldb/dbState';
import { makeModel } from './helpers/testModel';

describe('search skips unloaded (tombstoned) models', () => {
  const m = makeModel(
    [
      ['/QZX-ROOT', -1],
      ['/QZX-ROOT/PIPE', 0],
      ['qzx-leaf', 1],
    ],
    [2],
  );
  m.group = 'QZXFOLDER';
  models.push(m);
  const mi = models.length - 1;

  it('finds names and the import folder while the model is live', () => {
    const hits = treeApi.search('qzx', 'contains', 10);
    expect(hits.some((h) => h.model === mi && h.name === '/QZX-ROOT')).toBe(true);
    expect(hits.some((h) => h.model === -1 && h.group === 'QZXFOLDER')).toBe(true);
  });

  it('finds nothing from the model after it is removed', () => {
    modelsApi.forgetModels([mi]);
    const hits = treeApi.search('qzx', 'contains', 10);
    expect(hits.filter((h) => h.model === mi)).toEqual([]);
    expect(hits.some((h) => h.group === 'QZXFOLDER')).toBe(false);
    expect(treeApi.search('/qzx-root', 'equals', 10)).toEqual([]);
  });
});
