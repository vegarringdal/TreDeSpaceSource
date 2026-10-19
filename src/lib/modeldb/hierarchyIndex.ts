// Per-model hierarchy indexes and state packing: the children CSR, item↔entry
// maps, cached name arrays, and the interleaved GPU state upload.
import * as Comlink from 'comlink';
import type { Hierarchy } from '../model/format';
import {
  type DbModel,
  IS_SELECTED,
  isEffectivelyHidden,
  modelHasTransparency,
  models,
  NO_PARENT,
  type StateUpdate,
} from './dbState';

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

/** Per-entry subtree sums of EVERY `weight(item)` over the items beneath the
 *  entry (its own included). One post-order pass over the children CSR for all
 *  the weights at once — O(entries + items) however many are asked for, and
 *  the entry→item lookup is the prebuilt table, not a binary search per entry. */
function subtreeSums(m: DbModel, weights: readonly ((item: number) => number)[]): Uint32Array[] {
  const n = m.hierarchy.entryParent.length;
  const outs = weights.map(() => new Uint32Array(n));
  // own weight first
  for (let e = 0; e < n; e++) {
    const item = m.entryToItem[e];
    if (item >= 0) {
      for (let w = 0; w < weights.length; w++) {
        outs[w][e] = weights[w](item);
      }
    }
  }
  // post-order: push children onto parents, deepest first
  const order: number[] = [];
  const stack: number[] = Array.from(m.roots);
  while (stack.length) {
    const e = stack.pop()!;
    order.push(e);
    for (let c = m.childStart[e]; c < m.childStart[e + 1]; c++) {
      stack.push(m.childList[c]);
    }
  }
  for (let i = order.length - 1; i >= 0; i--) {
    const e = order[i];
    const p = m.hierarchy.entryParent[e];
    if (p !== NO_PARENT) {
      for (let w = 0; w < outs.length; w++) {
        outs[w][p] += outs[w][e];
      }
    }
  }
  return outs;
}

/** `hiddenUnder` + `selectedUnder`, refreshed when the model's states changed
 *  since they were last computed. Every state mutation is uploaded through
 *  packStates (which bumps `stateVersion`), so no hide/select site needs to
 *  know about this — the cost is one O(entries + items) pass per changed
 *  model, on the next tree fetch. */
export function stateAggregates(m: DbModel): { hidden: Uint32Array; selected: Uint32Array } {
  const v = m.stateVersion ?? 0;
  if (!m.hiddenUnder || !m.selectedUnder || m.hiddenAggVersion !== v) {
    // both aggregates in ONE traversal — they walk the same tree and read the
    // same state words, and this runs on every state-version bump
    const [hidden, selected] = subtreeSums(m, [
      (item) => (isEffectivelyHidden(m.states[item * 2], m.states[item * 2 + 1]) ? 1 : 0),
      (item) => ((m.states[item * 2] & IS_SELECTED) !== 0 ? 1 : 0),
    ]);
    m.hiddenUnder = hidden;
    m.selectedUnder = selected;
    m.hiddenAggVersion = v;
  }
  return { hidden: m.hiddenUnder, selected: m.selectedUnder };
}

export function hiddenAggregate(m: DbModel): Uint32Array {
  return stateAggregates(m).hidden;
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

  // entry -> dense item (-1 when the entry owns no geometry) and its inverse,
  // both from ONE binary search per entry. Everything downstream — the subtree
  // aggregates, the item collection — reads these instead of searching the
  // id table again per entry, per pass.
  const entryToItem = new Int32Array(n);
  m.itemToEntry = new Uint32Array(m.itemCount).fill(NO_PARENT);
  for (let e = 0; e < n; e++) {
    const item = itemForId(h, h.entryId[e]);
    entryToItem[e] = item;
    if (item >= 0) {
      m.itemToEntry[item] = e;
    }
  }
  m.entryToItem = entryToItem;

  m.itemsUnder = subtreeSums(m, [() => 1])[0];
  m.hiddenUnder = undefined;
  m.hiddenAggVersion = undefined;
}

/** GPU upload layout: interleaved [flags, colorRGBA8, transform_idx] — the
 * 12-byte native MeshItem struct (item_state.rs). */
export function interleaveStates(m: DbModel): Uint32Array<ArrayBuffer> {
  const out = new Uint32Array(m.itemCount * 3);
  for (let i = 0; i < m.itemCount; i++) {
    out[i * 3] = m.states[i * 2];
    out[i * 3 + 1] = m.states[i * 2 + 1];
    out[i * 3 + 2] = m.tidx[i];
  }
  return out;
}

/** One model's full upload array, stamped with a new stateVersion. The
 *  transfer mark goes on the value RETURNED across the worker boundary (see
 *  transferUpdates) — Comlink never looks inside an array for marks. */
export function packStates(m: DbModel, modelIdx: number): StateUpdate {
  m.stateVersion = (m.stateVersion ?? 0) + 1;
  return { model: modelIdx, states: interleaveStates(m), transparent: modelHasTransparency(m) };
}

/** Per model, the item intervals a change touched: flat [lo, hi) pairs. */
export type DirtyRanges = Map<number, number[]>;

/** Changed items below this share of their model upload on their own. */
const PARTIAL_UPLOAD_SHARE = 0.25;
/** Runs this close are written as one (fewer, slightly longer writes). */
const RUN_GAP = 16;
/** More runs than this upload the whole model instead. */
const MAX_RUNS = 64;

/** Model `mi` changed items [lo, hi). */
export function markDirty(d: DirtyRanges, mi: number, lo: number, hi: number): void {
  const pairs = d.get(mi);
  if (pairs) {
    pairs.push(lo, hi);
  } else {
    d.set(mi, [lo, hi]);
  }
}

/** Model `mi` changed these (ascending) items — marked as runs. */
export function markItems(d: DirtyRanges, mi: number, items: ArrayLike<number>): void {
  let i = 0;
  while (i < items.length) {
    const lo = items[i];
    let hi = lo + 1;
    while (i + 1 < items.length && items[i + 1] <= hi + RUN_GAP) {
      i++;
      hi = items[i] + 1;
    }
    markDirty(d, mi, lo, hi);
    i++;
  }
}

/** The span [min lo, max hi) of a model's dirty intervals, or null. */
export function dirtyBounds(d: DirtyRanges, mi: number): { lo: number; hi: number } | null {
  const pairs = d.get(mi);
  if (!pairs || pairs.length === 0) {
    return null;
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (let k = 0; k < pairs.length; k += 2) {
    lo = Math.min(lo, pairs[k]);
    hi = Math.max(hi, pairs[k + 1]);
  }
  return { lo, hi };
}

/** Sorted, merged runs of flat [lo, hi) pairs (RUN_GAP apart at least). */
function mergeRuns(pairs: readonly number[]): [number, number][] {
  const runs: [number, number][] = [];
  for (let k = 0; k < pairs.length; k += 2) {
    runs.push([pairs[k], pairs[k + 1]]);
  }
  runs.sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1] + RUN_GAP) {
      last[1] = Math.max(last[1], r[1]);
    } else {
      out.push([r[0], r[1]]);
    }
  }
  return out;
}

/** Items [lo, hi) of one model, stamped with a new stateVersion — the upload
 *  of a change confined to a few items (an actor's colour fade), where the
 *  whole model would cost 12 B per item every frame. */
export function packStateRange(
  m: DbModel,
  modelIdx: number,
  lo: number,
  hi: number,
  transparent = modelHasTransparency(m),
): StateUpdate {
  m.stateVersion = (m.stateVersion ?? 0) + 1;
  const a = Math.max(0, lo);
  const b = Math.min(m.itemCount, hi);
  const out = new Uint32Array(Math.max(0, b - a) * 3);
  for (let i = a; i < b; i++) {
    const o = (i - a) * 3;
    out[o] = m.states[i * 2];
    out[o + 1] = m.states[i * 2 + 1];
    out[o + 2] = m.tidx[i];
  }
  return { model: modelIdx, states: out, transparent, first: a };
}

/** The uploads for `d`: per model its changed runs on their own while they
 *  are few and a small part of it, else the whole model. */
export function packDirty(d: DirtyRanges): StateUpdate[] {
  const out: StateUpdate[] = [];
  for (const [mi, pairs] of d) {
    const m = models[mi];
    if (!m || m.removed) {
      continue;
    }
    const runs = mergeRuns(pairs);
    const covered = runs.reduce((n, r) => n + (r[1] - r[0]), 0);
    if (runs.length > MAX_RUNS || covered >= m.itemCount * PARTIAL_UPLOAD_SHARE) {
      out.push(packStates(m, mi));
      continue;
    }
    const transparent = modelHasTransparency(m);
    for (const [lo, hi] of runs) {
      out.push(packStateRange(m, mi, lo, hi, transparent));
    }
  }
  return out;
}

/** Buffers of a StateUpdate list, for the transfer mark on a wrapper object
 *  (`{ updates, … }`) — list them together with the wrapper's own buffers. */
export function updateBuffers(updates: StateUpdate[]): ArrayBuffer[] {
  return updates.map((u) => u.states.buffer);
}

/** Mark a StateUpdate list for zero-copy transfer. Every API that returns
 *  updates goes through this at its return: Comlink reads the mark on the
 *  returned value only, so without it each array is structured-cloned
 *  (12 B per item of every touched model, copied on both threads). */
export function transferUpdates(updates: StateUpdate[]): StateUpdate[] {
  return Comlink.transfer(updates, updateBuffers(updates));
}

/** Collect all dense items under an entry (subtree walk over the CSR). */
export function itemsUnder(m: DbModel, entry: number): Uint32Array {
  const out: number[] = [];
  const stack = [entry];
  while (stack.length) {
    const e = stack.pop()!;
    const item = m.entryToItem[e];
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
