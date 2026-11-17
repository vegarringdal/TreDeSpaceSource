// -----------------------------------------------------------------------------
// item sets by name (DESIGN.md › Animation › Data model, D64)
// -----------------------------------------------------------------------------
// Animation objects and transform objects name their items the same way:
// lower-cased fullnames to add (with what is under them) and to leave out.

import { treeApi } from './apiTree';
import { type DbModel, models, NO_PARENT } from './dbState';
import { itemsUnder } from './hierarchyIndex';

/** Depth of an entry in its model's tree (a root is 0). */
function depthOf(m: DbModel, e: number): number {
  let d = 0;
  for (let x = m.hierarchy.entryParent[e]; x !== NO_PARENT; x = m.hierarchy.entryParent[x]) {
    d++;
  }
  return d;
}

/** Every live item named by `fullnames` (subtree of each hit), minus those
 *  under `exclude`, per model. Adds and leave-outs nest like check boxes in
 *  a tree: they apply from the top down, so a deeper one wins — a node left
 *  out of a group can have one of its own parts added back. */
export function resolveItems(
  fullnames: readonly string[],
  exclude: readonly string[] = [],
): { byModel: Map<number, Set<number>>; missing: string[] } {
  const ops = new Map<number, { depth: number; entry: number; add: boolean }[]>();
  const missing: string[] = [];
  const collect = (names: readonly string[], add: boolean) => {
    for (const name of names) {
      const hits = treeApi.findEntriesByNames([name]);
      if (hits.length === 0 && add) {
        missing.push(name);
      }
      for (const h of hits) {
        const m = models[h.model];
        if (!m || m.removed) {
          continue;
        }
        const list = ops.get(h.model) ?? [];
        list.push({ depth: depthOf(m, h.entry), entry: h.entry, add });
        ops.set(h.model, list);
      }
    }
  };
  collect(fullnames, true);
  collect(exclude, false);
  const byModel = new Map<number, Set<number>>();
  for (const [mi, list] of ops) {
    const m = models[mi];
    const set = new Set<number>();
    // top down; at one depth a leave-out comes after the adds
    list.sort((a, b) => a.depth - b.depth || Number(b.add) - Number(a.add));
    for (const op of list) {
      for (const it of itemsUnder(m, op.entry)) {
        if (op.add) {
          set.add(it);
        } else {
          set.delete(it);
        }
      }
    }
    if (set.size > 0) {
      byModel.set(mi, set);
    }
  }
  return { byModel, missing };
}
