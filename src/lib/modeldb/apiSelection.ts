import * as Comlink from 'comlink';
import { type PackedNames, packedName } from '../color/packedNames';
// Selection domain: subtree/group/item selection, inversion, counts, and the
// transform-aware world bounds of the current selection.
import { IS_SELECTED, models, type StateUpdate } from './dbState';
import { ensureGlobalIndex, firstLiveHit, hitEntry, hitModel } from './globalNameIndex';
import { entryName, interleaveStates, itemsUnder, packStates, stateAggregates } from './hierarchyIndex';
import { transforms } from './transformPool';

export const selectionApi = {
  /** Replace the selection with the subtree under (model, entry).
   * Returns the item-state uploads for every affected model. */
  selectSubtree(model: number, entry: number): StateUpdate[] {
    const updates = selectionApi.clearSelection();
    const m = models[model];
    const items = itemsUnder(m, entry);
    for (const i of items) {
      m.states[i * 2] |= IS_SELECTED;
    }
    m.selected = items;
    const existing = updates.find((u) => u.model === model);
    if (existing) {
      existing.states = interleaveStates(m);
    } else {
      updates.push(packStates(m, model));
    }
    return updates;
  },

  /** Folder click: select EVERY item of every model in the group — including
   *  nested subgroups ("Plant" also covers "Plant/Area 1"). */
  selectGroup(group: string, store?: string): StateUpdate[] {
    const updates = selectionApi.clearSelection();
    models.forEach((m, idx) => {
      if (m.removed || (store != null && m.store !== store)) {
        return;
      }
      if (m.group !== group && !m.group.startsWith(`${group}/`)) {
        return;
      }
      const items = new Uint32Array(m.itemCount);
      for (let i = 0; i < m.itemCount; i++) {
        items[i] = i;
        m.states[i * 2] |= IS_SELECTED;
      }
      m.selected = items;
      const existing = updates.find((u) => u.model === idx);
      if (existing) {
        existing.states = interleaveStates(m);
      } else {
        updates.push(packStates(m, idx));
      }
    });
    return updates;
  },

  /** Root entries of every model in `group` OR any nested subgroup (folder
   *  rows in shift-ranges / ctrl-toggles expand to these). */
  groupRootEntries(group: string, store?: string): { model: number; entry: number }[] {
    const out: { model: number; entry: number }[] = [];
    models.forEach((m, i) => {
      if (m.removed || (store != null && m.store !== store)) {
        return;
      }
      if (m.group !== group && !m.group.startsWith(`${group}/`)) {
        return;
      }
      for (const e of m.roots) {
        out.push({ model: i, entry: e });
      }
    });
    return out;
  },

  /** Ctrl+click on a folder: toggle every item of the group (and subgroups)
   *  in/out of the selection without clearing the rest. */
  modifyGroupSelection(
    group: string,
    store?: string,
  ): {
    updates: StateUpdate[];
    added: boolean;
    roots: { model: number; entry: number }[];
  } {
    const idxs: number[] = [];
    models.forEach((m, i) => {
      if (
        !m.removed &&
        (store == null || m.store === store) &&
        (m.group === group || m.group.startsWith(`${group}/`))
      ) {
        idxs.push(i);
      }
    });
    let allIn = idxs.length > 0;
    for (const i of idxs) {
      if (models[i].selected.length !== models[i].itemCount) {
        allIn = false;
        break;
      }
    }
    const updates: StateUpdate[] = [];
    for (const i of idxs) {
      const m = models[i];
      if (allIn) {
        for (const k of m.selected) {
          m.states[k * 2] &= ~IS_SELECTED;
        }
        m.selected = new Uint32Array(0);
      } else {
        const items = new Uint32Array(m.itemCount);
        for (let k = 0; k < m.itemCount; k++) {
          items[k] = k;
          m.states[k * 2] |= IS_SELECTED;
        }
        m.selected = items;
      }
      updates.push(packStates(m, i));
    }
    return { updates, added: !allIn, roots: selectionApi.groupRootEntries(group, store) };
  },

  /** Add/remove/toggle one subtree in the selection (ctrl+click). Returns the
   * uploads plus whether the subtree ended up selected. */
  modifySubtreeSelection(
    model: number,
    entry: number,
    op: 'add' | 'remove' | 'toggle',
  ): { updates: StateUpdate[]; added: boolean } {
    const m = models[model];
    const items = itemsUnder(m, entry);
    const cur = new Set(m.selected);
    let allIn = items.length > 0;
    for (const it of items) {
      if (!cur.has(it)) {
        allIn = false;
        break;
      }
    }
    const effective = op === 'toggle' ? (allIn ? 'remove' : 'add') : op;
    for (const it of items) {
      if (effective === 'add') {
        cur.add(it);
        m.states[it * 2] |= IS_SELECTED;
      } else {
        cur.delete(it);
        m.states[it * 2] &= ~IS_SELECTED;
      }
    }
    m.selected = Uint32Array.from(cur);
    return { updates: [packStates(m, model)], added: effective === 'add' };
  },

  /** Add several subtrees at once (shift+click range). */
  addSubtrees(pairs: { model: number; entry: number }[]): StateUpdate[] {
    const touched = new Set<number>();
    for (const { model, entry } of pairs) {
      const m = models[model];
      const cur = new Set(m.selected);
      for (const it of itemsUnder(m, entry)) {
        cur.add(it);
        m.states[it * 2] |= IS_SELECTED;
      }
      m.selected = Uint32Array.from(cur);
      touched.add(model);
    }
    return Array.from(touched, (idx) => packStates(models[idx], idx));
  },

  /** Select every subtree named in a packed list (a big SQL result): each
   *  name is decoded once and resolved through the global index (first live
   *  model wins, as findEntriesByNames), items are marked per model in one
   *  pass, and the (model, entry) hits come back as one flat Uint32Array —
   *  no per-hit object for a 4M-row result. */
  selectPacked(p: PackedNames): { updates: StateUpdate[]; matched: number; missed: number; pairs: Uint32Array } {
    ensureGlobalIndex();
    const updates = selectionApi.clearSelection();
    const decoder = new TextDecoder();
    const marks = new Map<number, Uint8Array>();
    let pairs = new Uint32Array(Math.max(2, Math.min(p.count, 1024) * 2));
    let n = 0;
    let missed = 0;
    for (let i = 0; i < p.count; i++) {
      const h = firstLiveHit(packedName(p, i, decoder));
      if (h === undefined) {
        missed++;
        continue;
      }
      const mi = hitModel(h);
      const e = hitEntry(h);
      if (n * 2 + 2 > pairs.length) {
        const grown = new Uint32Array(pairs.length * 2);
        grown.set(pairs);
        pairs = grown;
      }
      pairs[n * 2] = mi;
      pairs[n * 2 + 1] = e;
      n++;
      const m = models[mi];
      let mark = marks.get(mi);
      if (!mark) {
        mark = new Uint8Array(m.itemCount);
        marks.set(mi, mark);
      }
      for (const it of itemsUnder(m, e)) {
        mark[it] = 1;
      }
    }
    for (const [mi, mark] of marks) {
      const m = models[mi];
      let count = 0;
      for (let i = 0; i < mark.length; i++) {
        count += mark[i];
      }
      const sel = new Uint32Array(count);
      let k = 0;
      for (let i = 0; i < mark.length; i++) {
        if (mark[i]) {
          m.states[i * 2] |= IS_SELECTED;
          sel[k++] = i;
        }
      }
      m.selected = sel;
      const existing = updates.find((u) => u.model === mi);
      if (existing) {
        existing.states = interleaveStates(m);
      } else {
        updates.push(packStates(m, mi));
      }
    }
    const out = pairs.slice(0, n * 2);
    return Comlink.transfer({ updates, matched: n, missed, pairs: out }, [out.buffer]);
  },

  selectItems(model: number, items: Uint32Array): StateUpdate[] {
    const updates = selectionApi.clearSelection();
    const m = models[model];
    for (const i of items) {
      m.states[i * 2] |= IS_SELECTED;
    }
    m.selected = items.slice();
    const existing = updates.find((u) => u.model === model);
    if (existing) {
      existing.states = interleaveStates(m);
    } else {
      updates.push(packStates(m, model));
    }
    return updates;
  },

  clearSelection(): StateUpdate[] {
    const updates: StateUpdate[] = [];
    models.forEach((m, idx) => {
      if (m.removed) {
        return;
      }
      if (m.selected.length === 0) {
        return;
      }
      for (const i of m.selected) {
        m.states[i * 2] &= ~IS_SELECTED;
      }
      m.selected = new Uint32Array(0);
      updates.push(packStates(m, idx));
    });
    return updates;
  },

  /** Select everything that is currently NOT selected (per model). */
  invertSelection(): StateUpdate[] {
    const updates: StateUpdate[] = [];
    models.forEach((m, idx) => {
      if (m.removed) {
        return;
      }
      const was = new Uint8Array(m.itemCount);
      for (const it of m.selected) {
        was[it] = 1;
      }
      const inv: number[] = [];
      for (let i = 0; i < m.itemCount; i++) {
        if (was[i]) {
          m.states[i * 2] &= ~IS_SELECTED;
        } else {
          m.states[i * 2] |= IS_SELECTED;
          inv.push(i);
        }
      }
      m.selected = Uint32Array.from(inv);
      updates.push(packStates(m, idx));
    });
    return updates;
  },

  /** Center of one item's world AABB (transformed corners when the item has
   * a committed transform) — the "pivot on clicked item" helper. */
  itemCenter(model: number, item: number): [number, number, number] | null {
    const m = models[model];
    if (!m) {
      return null;
    }
    const b = item * 6;
    if (!Number.isFinite(m.itemBounds[b])) {
      return null;
    }
    const slot = m.tidx[item];
    if (slot === 0) {
      return [
        (m.itemBounds[b] + m.itemBounds[b + 3]) / 2,
        (m.itemBounds[b + 1] + m.itemBounds[b + 4]) / 2,
        (m.itemBounds[b + 2] + m.itemBounds[b + 5]) / 2,
      ];
    }
    const t = transforms.subarray(slot * 16, slot * 16 + 16);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
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
    return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  },

  /** World AABB of the current selection (all models), or null when empty.
   * Items with a committed transform contribute their TRANSFORMED corners,
   * so fit-selection and the transform gizmo follow moved geometry. */
  selectionBounds(): { min: [number, number, number]; max: [number, number, number] } | null {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    let any = false;
    for (const m of models) {
      if (m.removed) {
        continue;
      }
      for (const it of m.selected) {
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

  selectionCount(): number {
    return models.reduce((n, m) => n + m.selected.length, 0);
  },

  /** Every selected NODE's fullname — each hierarchy entry whose items are
   *  all selected: the leaves AND the grouping entries above them (assembly
   *  and frame rows that own no geometry themselves), i.e. every row the tree
   *  highlights — not just the roots. `skip` drops names starting with any
   *  of the given prefixes (lowercased); capped at `maxItems`, `total` is the
   *  count after skipping. */
  selectedNodeNames(maxItems: number, skip: string[]): { names: string[]; total: number; truncated: boolean } {
    const names: string[] = [];
    let total = 0;
    for (const m of models) {
      if (m.removed || m.selected.length === 0) {
        continue;
      }
      const { selected } = stateAggregates(m);
      const itemsUnder = m.itemsUnder;
      if (!itemsUnder) {
        continue;
      }
      for (let e = 0; e < selected.length; e++) {
        if (selected[e] === 0 || selected[e] < itemsUnder[e]) {
          continue;
        }
        const name = entryName(m, e);
        if (skip.length) {
          const lower = name.toLowerCase();
          if (skip.some((p) => lower.startsWith(p))) {
            continue;
          }
        }
        total++;
        if (names.length < maxItems) {
          names.push(name);
        }
      }
    }
    return { names, total, truncated: total > names.length };
  },
};
