// -----------------------------------------------------------------------------
// transform objects (DESIGN.md › Transform objects)
// -----------------------------------------------------------------------------
// The main thread owns the object list (names, poses, parents, undo) and
// sends two things here: WHICH items each object holds (transformObjectsSet —
// resolved by name, one pool slot per object) and WHERE each object is drawn
// (transformObjectsPose — one world matrix per object, written into its
// slot). An item in several objects follows the SMALLEST one, so a part
// inside a container can be an object of its own. Items no object holds keep
// the slot they have (a loaded snapshot's placement).

import * as Comlink from 'comlink';
import { IS_SELECTED, models, type StateUpdate } from './dbState';
import { packStates, updateBuffers } from './hierarchyIndex';
import { resolveItems } from './itemSets';
import { allocTransformSlot, isAnimModeActive, transforms, transformsSnapshot } from './transformPool';

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

/** One model's whole per-item slot band as drawrange-style RLE runs — u32
 *  triples [start, count, slot]. Animation mode captures it at entry and
 *  puts it back at exit. */
export interface TransformUndoRecord {
  model: number;
  runs: Uint32Array;
}

/** One object as the main thread names it. */
export interface TransformObjectSpec {
  id: string;
  /** lower-cased fullnames (with what is under them) */
  fullnames: string[];
  /** lower-cased fullnames left out */
  exclude?: string[];
}

/** What the worker found for one object. */
export interface TransformObjectInfo {
  id: string;
  /** live items its names resolve to (those of objects inside it included) */
  items: number;
  /** names no loaded model has */
  missing: number;
  /** its items' box where the model has them [minx..maxz]; null: no geometry */
  restBox: number[] | null;
}

export interface TransformObjectsResult {
  /** animation mode owns the slots: nothing was changed — send again later */
  refused: boolean;
  updates: StateUpdate[];
  info: TransformObjectInfo[];
}

/** How the selection stands to an object's items. */
export type SelectionRelation = 'same' | 'inside' | 'contains' | 'overlap';

interface BoundObject {
  id: string;
  slot: number;
  /** per model, its items (ascending) */
  sets: Map<number, Uint32Array>;
  count: number;
}

// -----------------------------------------------------------------------------
// module state
// -----------------------------------------------------------------------------

/** the objects as last set, in the order the main thread sent them */
let bound: BoundObject[] = [];
/** object id → its pool slot (kept while the object lives) */
const slotOf = new Map<string, number>();
/** slots of removed objects, handed out again before the allocator */
let freeSlots: number[] = [];
/** per model, the items some object holds — put back to rest on the next set */
let owned = new Map<number, Uint32Array>();

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function liveModel(mi: number) {
  const m = models[mi];
  return m && !m.removed && m.tidx.length > 0 ? m : null;
}

/** The slots of objects that are gone go back on the free list. */
function releaseSlots(keep: ReadonlySet<string>): void {
  for (const [id, slot] of slotOf) {
    if (!keep.has(id)) {
      slotOf.delete(id);
      freeSlots.push(slot);
    }
  }
}

function slotFor(id: string): number {
  const have = slotOf.get(id);
  if (have !== undefined) {
    return have;
  }
  const slot = freeSlots.pop() ?? allocTransformSlot();
  transforms.fill(0, slot * 16, slot * 16 + 16);
  transforms[slot * 16] = transforms[slot * 16 + 5] = transforms[slot * 16 + 10] = transforms[slot * 16 + 15] = 1;
  slotOf.set(id, slot);
  return slot;
}

/** The box of `sets` where the model has the items (no pool matrix). */
function restBoxOf(sets: ReadonlyMap<number, Uint32Array>): number[] | null {
  const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const [mi, items] of sets) {
    const b = models[mi].itemBounds;
    for (const it of items) {
      const o = it * 6;
      if (!Number.isFinite(b[o])) {
        continue;
      }
      for (let k = 0; k < 3; k++) {
        box[k] = Math.min(box[k], b[o + k]);
        box[k + 3] = Math.max(box[k + 3], b[o + k + 3]);
      }
    }
  }
  return Number.isFinite(box[0]) ? box : null;
}

/** How many items of `sets` are in `other`. */
function sharedCount(sets: ReadonlyMap<number, Uint32Array>, other: ReadonlyMap<number, Set<number>>): number {
  let n = 0;
  for (const [mi, items] of sets) {
    const set = other.get(mi);
    if (!set) {
      continue;
    }
    for (const it of items) {
      if (set.has(it)) {
        n++;
      }
    }
  }
  return n;
}

// -----------------------------------------------------------------------------
// shared with animation mode + clear / snapshot import
// -----------------------------------------------------------------------------

/** RLE-capture one model's whole transform-slot band. */
export function captureTransformRuns(model: number): TransformUndoRecord {
  const m = models[model];
  const runs: number[] = [];
  if (m.itemCount > 0) {
    let start = 0;
    let slot = m.tidx[0];
    for (let i = 1; i < m.itemCount; i++) {
      if (m.tidx[i] !== slot) {
        runs.push(start, i - start, slot);
        start = i;
        slot = m.tidx[i];
      }
    }
    runs.push(start, m.itemCount - start, slot);
  }
  return { model, runs: Uint32Array.from(runs) };
}

export function restoreTransformRuns(rec: TransformUndoRecord) {
  const m = models[rec.model];
  const runs = rec.runs;
  for (let r = 0; r < runs.length; r += 3) {
    m.tidx.fill(runs[r + 2], runs[r], runs[r] + runs[r + 1]);
  }
}

/** Forget every object binding (clear / a snapshot import that replaces the
 *  transforms — it restarts the pool, so no slot may be remembered). The
 *  item slots themselves are the caller's to reset. */
export function resetTransformObjects(): void {
  bound = [];
  slotOf.clear();
  freeSlots = [];
  owned = new Map();
}

// -----------------------------------------------------------------------------
// api
// -----------------------------------------------------------------------------

export const transformApi = {
  /** The committed transform pool as it stands — GPU recovery re-uploads it
   *  to a fresh renderer's transform buffer. */
  transformsNow(): Float32Array {
    return transformsSnapshot();
  },

  /** Which items each object holds. Items of the objects before go back to
   *  rest, then every object's items point at its slot — larger sets first,
   *  so an item follows the smallest object holding it. `clearLoose` also
   *  puts back every item no object holds (Reset All). The slots' matrices
   *  are not touched: transformObjectsPose follows. */
  transformObjectsSet(specs: TransformObjectSpec[], clearLoose = false): TransformObjectsResult {
    if (isAnimModeActive()) {
      return { refused: true, updates: [], info: [] };
    }
    const touched = new Set<number>();
    if (clearLoose) {
      models.forEach((m, mi) => {
        if (!m.removed && m.tidx.some((slot) => slot !== 0)) {
          m.tidx.fill(0);
          touched.add(mi);
        }
      });
    }
    for (const [mi, items] of owned) {
      const m = liveModel(mi);
      if (!m) {
        continue;
      }
      for (const it of items) {
        m.tidx[it] = 0;
      }
      touched.add(mi);
    }
    releaseSlots(new Set(specs.map((s) => s.id)));
    const info: TransformObjectInfo[] = [];
    bound = specs.map((spec) => {
      const { byModel, missing } = resolveItems(spec.fullnames, spec.exclude);
      const sets = new Map<number, Uint32Array>();
      let count = 0;
      for (const [mi, set] of byModel) {
        const items = Uint32Array.from(set).sort();
        sets.set(mi, items);
        count += items.length;
      }
      info.push({ id: spec.id, items: count, missing: missing.length, restBox: restBoxOf(sets) });
      return { id: spec.id, slot: slotFor(spec.id), sets, count };
    });
    const union = new Map<number, Set<number>>();
    for (const o of [...bound].sort((a, b) => b.count - a.count)) {
      for (const [mi, items] of o.sets) {
        const m = models[mi];
        const all = union.get(mi) ?? new Set<number>();
        for (const it of items) {
          m.tidx[it] = o.slot;
          all.add(it);
        }
        union.set(mi, all);
        touched.add(mi);
      }
    }
    owned = new Map(Array.from(union, ([mi, set]) => [mi, Uint32Array.from(set)]));
    const updates = Array.from(touched, (mi) => packStates(models[mi], mi));
    return Comlink.transfer({ refused: false, updates, info }, updateBuffers(updates));
  },

  /** Where each object is drawn: 16 floats per object, in the order of the
   *  last transformObjectsSet. Returns the pool for the GPU (null when the
   *  list does not match that set, or animation mode owns the slots). */
  transformObjectsPose(matrices: Float32Array): Float32Array | null {
    if (isAnimModeActive() || matrices.length !== bound.length * 16) {
      return null;
    }
    bound.forEach((o, k) => {
      transforms.set(matrices.subarray(k * 16, k * 16 + 16), o.slot * 16);
    });
    const snapshot = transformsSnapshot();
    return Comlink.transfer(snapshot, [snapshot.buffer]);
  },

  /** The object whose items are exactly the selection (null: none). */
  transformObjectForSelection(): string | null {
    let selected = 0;
    for (const m of models) {
      if (!m.removed) {
        selected += m.selected.length;
      }
    }
    if (selected === 0) {
      return null;
    }
    const match = bound.find((o) => {
      if (o.count !== selected) {
        return false;
      }
      for (const [mi, items] of o.sets) {
        const m = liveModel(mi);
        if (!m || items.some((it) => (m.states[it * 2] & IS_SELECTED) === 0)) {
          return false;
        }
      }
      return true;
    });
    return match?.id ?? null;
  },

  /** How an item set (by name) stands to every object it shares items with:
   *  the same items, inside the object, holding all of it, or only partly
   *  shared. Objects it shares nothing with are left out. */
  transformRelations(fullnames: string[], exclude: string[] = []): { id: string; relation: SelectionRelation }[] {
    const { byModel } = resolveItems(fullnames, exclude);
    let size = 0;
    for (const set of byModel.values()) {
      size += set.size;
    }
    const out: { id: string; relation: SelectionRelation }[] = [];
    for (const o of bound) {
      const shared = sharedCount(o.sets, byModel);
      if (shared === 0) {
        continue;
      }
      const holdsAll = shared === o.count;
      const insideAll = shared === size;
      const relation: SelectionRelation =
        holdsAll && insideAll ? 'same' : insideAll ? 'inside' : holdsAll ? 'contains' : 'overlap';
      out.push({ id: o.id, relation });
    }
    return out;
  },
};
