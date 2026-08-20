// Per-model hierarchy indexes and state packing: the children CSR, item↔entry
// maps, cached name arrays, and the interleaved GPU state upload.
import * as Comlink from 'comlink';
import type { Hierarchy } from '../model/format';
import { type DbModel, NO_PARENT, type StateUpdate } from './dbState';

const decoder = new TextDecoder();

export function entryName(m: DbModel, e: number): string {
  const h = m.hierarchy;
  return decoder.decode(h.namePool.subarray(h.entryNameOffset[e], h.entryNameOffset[e] + h.entryNameLen[e]));
}

/** Sparse id -> dense item via the sorted IdItemEntry table. -1 if absent. */
export function itemForId(h: Hierarchy, id: number): number {
  let lo = 0,
    hi = h.idItemIds.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = h.idItemIds[mid];
    if (v === id) {
      return h.idItemItems[mid];
    }
    if (v < id) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return -1;
}

export function buildIndexes(m: DbModel) {
  const h = m.hierarchy;
  const n = h.entryParent.length;
  // children CSR (counting sort by parent)
  const counts = new Uint32Array(n + 1);
  let rootCount = 0;
  for (let i = 0; i < n; i++) {
    const p = h.entryParent[i];
    if (p === NO_PARENT) {
      rootCount++;
    } else {
      counts[p]++;
    }
  }
  const childStart = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) {
    childStart[i + 1] = childStart[i] + counts[i];
  }
  const childList = new Uint32Array(childStart[n]);
  const roots = new Uint32Array(rootCount);
  const cursor = childStart.slice(0, n);
  let r = 0;
  for (let i = 0; i < n; i++) {
    const p = h.entryParent[i];
    if (p === NO_PARENT) {
      roots[r++] = i;
    } else {
      childList[cursor[p]++] = i;
    }
  }
  m.childStart = childStart;
  m.childList = childList;
  m.roots = roots;

  // item -> leaf entry
  m.itemToEntry = new Uint32Array(m.itemCount).fill(NO_PARENT);
  for (let e = 0; e < n; e++) {
    const item = itemForId(h, h.entryId[e]);
    if (item >= 0) {
      m.itemToEntry[item] = e;
    }
  }
}

/** GPU upload layout: interleaved [flags, colorRGBA8, transform_idx] — the
 * 12-byte native MeshItem struct (item_state.rs). */
export function interleaveStates(m: DbModel): Uint32Array {
  const out = new Uint32Array(m.itemCount * 3);
  for (let i = 0; i < m.itemCount; i++) {
    out[i * 3] = m.states[i * 2];
    out[i * 3 + 1] = m.states[i * 2 + 1];
    out[i * 3 + 2] = m.tidx[i];
  }
  return out;
}

export function packStates(m: DbModel, modelIdx: number): StateUpdate {
  const states = interleaveStates(m);
  return Comlink.transfer({ model: modelIdx, states }, [states.buffer]);
}

/** Collect all dense items under an entry (subtree walk over the CSR). */
export function itemsUnder(m: DbModel, entry: number): Uint32Array {
  const out: number[] = [];
  const stack = [entry];
  while (stack.length) {
    const e = stack.pop()!;
    const item = itemForId(m.hierarchy, m.hierarchy.entryId[e]);
    if (item >= 0) {
      out.push(item);
    }
    for (let c = m.childStart[e]; c < m.childStart[e + 1]; c++) {
      stack.push(m.childList[c]);
    }
  }
  return Uint32Array.from(out);
}

/** Every entry in parent-before-child order (BFS from roots), cached. Lets a
 *  single forward pass propagate a value down the tree (deepest wins) instead
 *  of walking each entry's subtree — O(entries) instead of O(entries × depth). */
export function bfsOrder(m: DbModel): Uint32Array {
  if (m.bfsOrder) {
    return m.bfsOrder;
  }
  const order = new Uint32Array(m.hierarchy.entryParent.length);
  let tail = 0;
  for (const r of m.roots) {
    order[tail++] = r;
  }
  for (let head = 0; head < tail; head++) {
    const e = order[head];
    for (let c = m.childStart[e]; c < m.childStart[e + 1]; c++) {
      order[tail++] = m.childList[c];
    }
  }
  m.bfsOrder = order;
  return order;
}

/** Per-entry hierarchy depth (1 = root entry), cached — one forward pass over
 *  the BFS order (parents resolve before their children). */
export function entryDepths(m: DbModel): Uint16Array {
  if (m.entryDepth) {
    return m.entryDepth;
  }
  const order = bfsOrder(m);
  const parent = m.hierarchy.entryParent;
  const depth = new Uint16Array(parent.length);
  for (const e of order) {
    const p = parent[e];
    depth[e] = p === NO_PARENT ? 1 : depth[p] + 1;
  }
  m.entryDepth = depth;
  return depth;
}

/** Build (lazily, cached) the lowercased name array AND the fullname→entry index
 *  so any resolver can look a fullname up in O(1) instead of scanning entries. */
export function ensureNames(m: DbModel): string[] {
  if (!m.namesLower) {
    m.namesLower = Array.from({ length: m.hierarchy.entryParent.length }, (_, e) => entryName(m, e).toLowerCase());
  }
  return m.namesLower;
}
