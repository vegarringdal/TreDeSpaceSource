// Tree / naming domain: tree nodes for the hierarchy panel, name search, the
// fullname resolvers over the global index, and root→leaf path helpers.
import { type DbModel, models, NO_PARENT, type TreeNode } from './dbState';
import { ensureGlobalIndex, firstLiveHit, hitEntry, hitModel, liveHits } from './globalNameIndex';
import { ensureNames, entryName, itemForId, itemsUnder } from './hierarchyIndex';
import { transforms } from './transformPool';

/** Label-anchor snap: if `c` lies inside NO item's AABB (a bent run whose
 *  union-box center hangs in empty air), return the center of the item whose
 *  box is nearest to `c`; `c` unchanged when some item contains it. */
/** Effective world AABB of one item: its static bounds pushed through the
 *  item's live transform slot (labels must anchor where the item IS, not
 *  where it was cooked). False when the item has no finite bounds. */
function itemWorldBounds(m: DbModel, it: number, out: number[]): boolean {
  const b = it * 6;
  if (!Number.isFinite(m.itemBounds[b])) {
    return false;
  }
  const slot = m.tidx[it];
  if (slot === 0) {
    for (let a = 0; a < 6; a++) {
      out[a] = m.itemBounds[b + a];
    }
    return true;
  }
  const t = transforms.subarray(slot * 16, slot * 16 + 16);
  out[0] = out[1] = out[2] = Infinity;
  out[3] = out[4] = out[5] = -Infinity;
  for (let corner = 0; corner < 8; corner++) {
    const x = m.itemBounds[b + (corner & 1 ? 3 : 0)];
    const y = m.itemBounds[b + 1 + (corner & 2 ? 3 : 0)];
    const z = m.itemBounds[b + 2 + (corner & 4 ? 3 : 0)];
    const px = t[0] * x + t[4] * y + t[8] * z + t[12];
    const py = t[1] * x + t[5] * y + t[9] * z + t[13];
    const pz = t[2] * x + t[6] * y + t[10] * z + t[14];
    out[0] = Math.min(out[0], px);
    out[1] = Math.min(out[1], py);
    out[2] = Math.min(out[2], pz);
    out[3] = Math.max(out[3], px);
    out[4] = Math.max(out[4], py);
    out[5] = Math.max(out[5], pz);
  }
  return true;
}

const boundsScratch: number[] = [0, 0, 0, 0, 0, 0];

function snapCenterToItems(m: DbModel, items: Uint32Array, c: [number, number, number]): [number, number, number] {
  let bestItem = -1;
  let bestD = Infinity;
  for (const it of items) {
    if (!itemWorldBounds(m, it, boundsScratch)) {
      continue;
    }
    let d = 0;
    for (let a = 0; a < 3; a++) {
      const g = Math.max(boundsScratch[a] - c[a], c[a] - boundsScratch[a + 3], 0);
      d += g * g;
    }
    if (d === 0) {
      return c; // an item contains the center — it already points at geometry
    }
    if (d < bestD) {
      bestD = d;
      bestItem = it;
    }
  }
  if (bestItem < 0 || !itemWorldBounds(m, bestItem, boundsScratch)) {
    return c;
  }
  return [
    (boundsScratch[0] + boundsScratch[3]) / 2,
    (boundsScratch[1] + boundsScratch[4]) / 2,
    (boundsScratch[2] + boundsScratch[5]) / 2,
  ];
}

export const treeApi = {
  /** Fullnames for the given entries (viewpoints: capture the selection roots
   *  as names so they can be re-selected later via findEntriesByNames). */
  entryNames(pairs: { model: number; entry: number }[]): string[] {
    const out: string[] = [];
    for (const p of pairs) {
      const m = models[p.model];
      if (!m || m.removed) {
        continue;
      }
      const name = entryName(m, p.entry);
      if (name) {
        out.push(name);
      }
    }
    return out;
  },

  /** Ancestor chain for one entry, root→self (names + has-children), plus the
   *  model's import folder — payload source for the tree.select host event. */
  entryChain(model: number, entry: number): { group: string; nodes: { name: string; hasChildren: boolean }[] } {
    const m = models[model];
    if (!m || m.removed) {
      return { group: '', nodes: [] };
    }
    const h = m.hierarchy;
    const ids: number[] = [];
    for (let e = entry; e !== NO_PARENT; e = h.entryParent[e]) {
      ids.push(e);
    }
    ids.reverse();
    return {
      group: m.group,
      nodes: ids.map((e) => ({ name: entryName(m, e), hasChildren: m.childStart[e + 1] > m.childStart[e] })),
    };
  },

  /** Root entries of every model in a group (the folder's children). */
  groupRoots(group: string): { model: number; node: TreeNode }[] {
    const out: { model: number; node: TreeNode }[] = [];
    models.forEach((m, i) => {
      if (m.removed || m.group !== group) {
        return;
      }
      for (const e of m.roots) {
        out.push({ model: i, node: treeApi.node(i, e) });
      }
    });
    out.sort((a, b) => a.node.name.localeCompare(b.node.name));
    return out;
  },

  roots(model: number): TreeNode[] {
    const m = models[model];
    return Array.from(m.roots, (e) => treeApi.node(model, e));
  },

  children(model: number, entry: number): TreeNode[] {
    const m = models[model];
    const out: TreeNode[] = [];
    for (let c = m.childStart[entry]; c < m.childStart[entry + 1]; c++) {
      out.push(treeApi.node(model, m.childList[c]));
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  },

  node(model: number, entry: number): TreeNode {
    const m = models[model];
    return {
      entry,
      name: entryName(m, entry),
      hasChildren: m.childStart[entry + 1] > m.childStart[entry],
      item: itemForId(m.hierarchy, m.hierarchy.entryId[entry]),
    };
  },

  /** Case-insensitive name search. mode "contains" or "equals"; results are
   * sorted shallowest-first (highest hierarchy level wins) and capped. */
  search(
    text: string,
    mode: 'contains' | 'equals' = 'contains',
    limit = 10,
  ): { model: number; entry: number; name: string; path: number[]; depth: number; group?: string }[] {
    let q = text.trim().toLowerCase();
    if (q.replaceAll('*', '').length < 2) {
      return [];
    }
    // equals mode supports * wildcards: "*86A" ends-with, "86A*" starts-with,
    // "*86A*" contains, plain = exact match
    const startsWild = q.startsWith('*');
    const endsWild = q.endsWith('*');
    if (mode === 'equals') {
      q = q.replace(/^\*+|\*+$/g, '');
    }
    const matches = (n: string): boolean => {
      if (mode === 'contains') {
        return n.includes(q);
      }
      if (startsWild && endsWild) {
        return n.includes(q);
      }
      if (startsWild) {
        return n.endsWith(q);
      }
      if (endsWild) {
        return n.startsWith(q);
      }
      return n === q;
    };
    const found: { model: number; entry: number; name: string; path: number[]; depth: number; group?: string }[] = [];
    // import folders first: every path level of every group is searchable, so
    // "TP000" finds the TP000-ELECTRO folder as well as items named that way
    const groupPaths = new Set<string>();
    for (const m of models) {
      if (m.removed) {
        continue;
      }
      let p = '';
      for (const seg of m.group.split('/')) {
        p = p ? `${p}/${seg}` : seg;
        groupPaths.add(p);
      }
    }
    for (const p of groupPaths) {
      const seg = p.split('/').pop() ?? p;
      if (matches(seg.toLowerCase()) || matches(p.toLowerCase())) {
        found.push({ model: -1, entry: -1, name: p, path: [], depth: 0, group: p });
      }
    }
    const SCAN_CAP = 5000; // enough candidates to pick the 10 shallowest from
    for (let mi = 0; mi < models.length && found.length < SCAN_CAP; mi++) {
      const m = models[mi];
      const namesLower = ensureNames(m);
      for (let e = 0; e < namesLower.length && found.length < SCAN_CAP; e++) {
        if (!matches(namesLower[e])) {
          continue;
        }
        const path: number[] = [];
        let p = e;
        while (p !== NO_PARENT) {
          path.unshift(p);
          p = m.hierarchy.entryParent[p];
        }
        found.push({ model: mi, entry: e, name: entryName(m, e), path, depth: path.length });
      }
    }
    found.sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name));
    return found.slice(0, limit);
  },

  /** Label import: resolve pasted tag names to world anchor points (subtree
   * AABB center). Each name is tried as-is, then with the leading '/' toggled
   * (this loose match lives HERE only). `name` in the result is the MODEL's
   * actual fullname for the matched entry — so the label GUI shows the real
   * name and later colour/select-by-fullname match it exactly.
   * `snapToItem`: when the union center lies inside NO child item's AABB
   * (bent pipe runs — the box center hangs in empty air), anchor on the
   * nearest child item's center instead. */
  findLabelAnchors(
    names: string[],
    snapToItem = false,
    onlyModels?: number[],
  ): {
    found: { name: string; center: [number, number, number] }[];
    notFound: string[];
  } {
    const found: { name: string; center: [number, number, number] }[] = [];
    const notFound: string[] = [];
    ensureGlobalIndex();
    for (const raw of names) {
      const base = raw.trim().toLowerCase();
      if (!base) {
        continue;
      }
      // candidates across all models: exact name + the '/'-toggled variant,
      // ordered by model (exact first within a model — the old loose per-model
      // resolve), first candidate with finite bounds wins
      const alt = base.startsWith('/') ? base.slice(1) : `/${base}`;
      const allowed = onlyModels ? new Set(onlyModels) : null;
      const cands: { p: number; exact: boolean }[] = [];
      const take = (p: number, exact: boolean) => {
        if (allowed === null || allowed.has(hitModel(p))) {
          cands.push({ p, exact });
        }
      };
      liveHits(base, (p) => take(p, true));
      liveHits(alt, (p) => take(p, false));
      cands.sort((a, b) => hitModel(a.p) - hitModel(b.p) || Number(b.exact) - Number(a.exact));
      // EVERY model carrying the name gets an anchor — the same structure
      // loaded from two stores labels each plant's copy (one try per model,
      // like the old per-model loose resolve)
      let hits = 0;
      let lastModel = -1;
      for (const c of cands) {
        const mi = hitModel(c.p);
        if (mi === lastModel) {
          continue;
        }
        lastModel = mi;
        const m = models[mi];
        const e = hitEntry(c.p);
        const items = itemsUnder(m, e);
        const min = [Infinity, Infinity, Infinity];
        const max = [-Infinity, -Infinity, -Infinity];
        for (const it of items) {
          // transform-aware: a moved plant's labels anchor where it stands
          if (!itemWorldBounds(m, it, boundsScratch)) {
            continue;
          }
          for (let a = 0; a < 3; a++) {
            if (boundsScratch[a] < min[a]) {
              min[a] = boundsScratch[a];
            }
            if (boundsScratch[a + 3] > max[a]) {
              max[a] = boundsScratch[a + 3];
            }
          }
        }
        if (Number.isFinite(min[0])) {
          const c0: [number, number, number] = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
          found.push({
            name: entryName(m, e), // the model's real fullname, not the input
            center: snapToItem ? snapCenterToItems(m, items, c0) : c0,
          });
          hits++;
        }
      }
      if (hits === 0) {
        notFound.push(raw.trim());
      }
    }
    return { found, notFound };
  },

  /** Resolve fullnames to hierarchy entries (case-insensitive equals, exact
   * match). Unresolvable names are dropped. O(names) via the GLOBAL fullname
   * index — one lookup per name, however many models are loaded. */
  findEntriesByNames(names: string[]): { name: string; model: number; entry: number }[] {
    const out: { name: string; model: number; entry: number }[] = [];
    ensureGlobalIndex();
    for (const raw of names) {
      const trimmed = raw.trim();
      const base = trimmed.toLowerCase();
      if (!base) {
        continue;
      }
      const p = firstLiveHit(base); // first model with a hit wins
      if (p !== undefined) {
        out.push({ name: trimmed, model: hitModel(p), entry: hitEntry(p) });
      }
    }
    return out;
  },

  /** World-space AABB of the subtree(s) named by `names` — WITHOUT touching
   *  selection (host API nav.flyTo / nav.orbit for a fullname). Same
   *  transform-aware union as selectionBounds. */
  boundsForNames(names: string[]): { min: [number, number, number]; max: [number, number, number] } | null {
    const hits = treeApi.findEntriesByNames(names);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    let any = false;
    for (const h of hits) {
      const m = models[h.model];
      if (!m || m.removed) {
        continue;
      }
      for (const it of itemsUnder(m, h.entry)) {
        const b = it * 6;
        if (!Number.isFinite(m.itemBounds[b])) {
          continue;
        }
        any = true;
        const slot = m.tidx[it];
        if (slot === 0) {
          for (let a = 0; a < 3; a++) {
            if (m.itemBounds[b + a] < min[a]) {
              min[a] = m.itemBounds[b + a];
            }
            if (m.itemBounds[b + 3 + a] > max[a]) {
              max[a] = m.itemBounds[b + 3 + a];
            }
          }
          continue;
        }
        const t = transforms.subarray(slot * 16, slot * 16 + 16);
        for (let corner = 0; corner < 8; corner++) {
          const x = m.itemBounds[b + (corner & 1 ? 3 : 0)];
          const y = m.itemBounds[b + 1 + (corner & 2 ? 3 : 0)];
          const z = m.itemBounds[b + 2 + (corner & 4 ? 3 : 0)];
          const p = [
            t[0] * x + t[4] * y + t[8] * z + t[12],
            t[1] * x + t[5] * y + t[9] * z + t[13],
            t[2] * x + t[6] * y + t[10] * z + t[14],
          ];
          for (let a = 0; a < 3; a++) {
            if (p[a] < min[a]) {
              min[a] = p[a];
            }
            if (p[a] > max[a]) {
              max[a] = p[a];
            }
          }
        }
      }
    }
    return any ? { min: min as [number, number, number], max: max as [number, number, number] } : null;
  },

  /** Entry chain from root to the leaf entry owning this item (tree reveal). */
  pathForItem(model: number, item: number): number[] {
    const m = models[model];
    let e = m.itemToEntry[item];
    if (e === NO_PARENT) {
      return [];
    }
    const path: number[] = [];
    while (e !== NO_PARENT) {
      path.unshift(e);
      e = m.hierarchy.entryParent[e];
    }
    return path;
  },

  /** The clicked item's fullname hierarchy, root→leaf — each ancestor entry's
   *  full name (the same strings findEntriesByNames matches). Feeds the SQL
   *  Detail panel's TREE_VIEW_ARGS so a report can key off any level. */
  itemFullnamePath(model: number, item: number): string[] {
    const m = models[model];
    if (!m || m.removed) {
      return [];
    }
    let e = m.itemToEntry[item];
    if (e === NO_PARENT) {
      return [];
    }
    const names: string[] = [];
    while (e !== NO_PARENT) {
      const n = entryName(m, e);
      if (n) {
        names.unshift(n);
      }
      e = m.hierarchy.entryParent[e];
    }
    return names;
  },

  /** Root→entry chain for a hierarchy entry (drives U/P nav from a tree click). */
  pathForEntry(model: number, entry: number): number[] {
    const m = models[model];
    if (!m) {
      return [];
    }
    const path: number[] = [];
    let e = entry;
    while (e !== NO_PARENT && e !== undefined) {
      path.unshift(e);
      e = m.hierarchy.entryParent[e];
    }
    return path;
  },
};
