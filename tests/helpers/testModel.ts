// A tiny in-memory DbModel for worker-logic tests (no worker, no OPFS).
import type { Hierarchy } from '../../src/lib/model/format';
import type { DbModel } from '../../src/lib/modeldb/dbState';
import { buildIndexes } from '../../src/lib/modeldb/hierarchyIndex';

/** entries: [name, parentIndex (-1 = root)]; `leafItems[item] = entry` gives
 *  the leaves that own geometry (sparse ids 1..n in item order). */
export function makeModel(entries: [string, number][], leafItems: number[]): DbModel {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets = new Uint32Array(entries.length);
  const lens = new Uint16Array(entries.length);
  let at = 0;
  entries.forEach(([name], e) => {
    const b = enc.encode(name);
    chunks.push(b);
    offsets[e] = at;
    lens[e] = b.length;
    at += b.length;
  });
  const namePool = new Uint8Array(at);
  let w = 0;
  for (const c of chunks) {
    namePool.set(c, w);
    w += c.length;
  }
  const entryId = new Uint32Array(entries.length);
  const ids: number[] = [];
  const items: number[] = [];
  leafItems.forEach((entry, item) => {
    entryId[entry] = item + 1;
    ids.push(item + 1);
    items.push(item);
  });
  const hierarchy: Hierarchy = {
    namePool,
    entryId,
    entryNameOffset: offsets,
    entryParent: Uint32Array.from(entries.map(([, p]) => (p < 0 ? 0xffffffff : p))),
    entryNameLen: lens,
    idItemIds: Uint32Array.from(ids),
    idItemItems: Uint32Array.from(items),
  };
  const m: DbModel = {
    name: 'test',
    group: 'test',
    store: '',
    bakedTransparent: false,
    itemCount: leafItems.length,
    hierarchy,
    childStart: new Uint32Array(0),
    childList: new Uint32Array(0),
    roots: new Uint32Array(0),
    itemToEntry: new Uint32Array(0),
    namesLower: null,
    states: new Uint32Array(leafItems.length * 2),
    tidx: new Uint32Array(leafItems.length),
    baseColor: new Uint32Array(leafItems.length),
    selected: new Uint32Array(0),
    itemBounds: new Float32Array(leafItems.length * 6),
  };
  buildIndexes(m);
  return m;
}
