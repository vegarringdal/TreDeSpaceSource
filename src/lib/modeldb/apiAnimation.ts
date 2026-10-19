// -----------------------------------------------------------------------------
// animation mode (DESIGN.md › Animation › Engine)
// -----------------------------------------------------------------------------
// Temporary ownership of the animated items' transform slots. Enter captures
// every touched model's tidx band (the transform-undo RLE) and the actors'
// visibility/opacity bits, then points each (actor, base slot) pair at one
// slot of the reserved animation band. The main thread writes D·base into
// those slots every frame; this worker only keeps the band's matrices in step
// on demand (animSyncBand) so selection bounds, fit and picking helpers see
// the paused pose. Exit restores everything verbatim — the scene is never
// modified and no undo entries are created (D12).

import * as Comlink from 'comlink';
import { type LookRequest, lookEnter, lookExit, lookReset, lookWordsFor, setLook } from './animLook';
import { captureTransformRuns, restoreTransformRuns, type TransformUndoRecord } from './apiTransform';
import { treeApi } from './apiTree';
import { type DbModel, HAS_COLOR_OVERRIDE, IS_SELECTED, models, NO_PARENT, type StateUpdate } from './dbState';
import {
  type DirtyRanges,
  dirtyBounds,
  entryName,
  itemsUnder,
  markItems,
  packDirty,
  packStates,
  stateAggregates,
  transferUpdates,
  updateBuffers,
} from './hierarchyIndex';
import { type ActorColorLayer, type ActorLayer, applyActorLayer, LOOK_BITS } from './lookBlend';
import {
  ANIM_BAND_FIRST,
  allocAnimSlot,
  clearSweptBounds,
  itemWorldBounds,
  resetAnimBand,
  setAnimModeActive,
  setSweptBounds,
  TRANSFORM_POOL,
  transforms,
} from './transformPool';

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

type V3 = [number, number, number];

/** One actor as the main thread knows it: id + lower-cased fullnames (D11). */
export interface AnimActorSpec {
  id: string;
  fullnames: string[];
  /** some transform track moves it (absent = yes): movers get band slots
   *  first; the others only when slots are left (D47) */
  moves?: boolean;
  /** lower-cased fullnames left out of `fullnames` (and what is under them) */
  exclude?: string[];
}

/** A simpler way to name a set of items: one group minus a few nodes. */
export interface ClosestGroup {
  /** lower-cased fullname of the group */
  group: string;
  /** its display name */
  name: string;
  /** lower-cased fullnames to leave out */
  minus: string[];
  /** items the set holds */
  items: number;
}

/** One (actor, base slot) pair: the band slot it owns and the committed
 *  matrix its items had at entry (identity for tidx 0). */
export interface AnimSlotBinding {
  actor: string;
  slot: number;
  base: Float32Array;
}

export interface AnimEnterResult {
  bindings: AnimSlotBinding[];
  /** fullnames that resolved to nothing, per actor */
  unresolved: { actor: string; fullnames: string[] }[];
  /** actor → rest WORLD box [minx,miny,minz,maxx,maxy,maxz] (absent: no geometry) */
  restBounds: Record<string, Float32Array>;
  restCenter: Record<string, V3>;
  /** actor → items it moves (duplicates of a fullname count once per item) */
  itemCounts: Record<string, number>;
  /** the band ran out: actors without a binding do not move */
  bandFull: boolean;
  /** items an actor names that an earlier actor already owns — they follow
   *  the owner only, so the actor's own keys skip them */
  shared: { actor: string; owner: string; items: number }[];
  updates: StateUpdate[];
}

/** Per touched model: the captured slot band and, for every actor item, its
 *  base words — the look layer its own keys are laid over (D25). */
interface ModelCapture {
  runs: TransformUndoRecord;
  /** per item, once captured: base flags (the look band; clean at entry) and
   *  base colour word — typed arrays over the model (D47), allocated on
   *  the first item captured */
  items: { has: Uint8Array; bits: Uint32Array; colors: Uint32Array; list: number[] } | null;
}

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

/** An actor with no keys of its own. */
const NO_LAYER: ActorLayer = { visible: null, opacity: null, color: null };

// -----------------------------------------------------------------------------
// module state
// -----------------------------------------------------------------------------

let captures = new Map<number, ModelCapture>();
/** actor → what its own keys say now (visibility, opacity, colour) */
let actorLayers = new Map<string, ActorLayer>();
/** actor → per model, the items it owns (ascending) */
let actorItems = new Map<string, Map<number, Uint32Array>>();

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

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
function resolveItems(
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

/** The named entries of `fullnames` in model `mi`. */
function entriesIn(mi: number, fullnames: readonly string[]): number[] {
  return fullnames.flatMap((n) => treeApi.findEntriesByNames([n])).flatMap((h) => (h.model === mi ? [h.entry] : []));
}

/** The lowest named entry holding every one of `entries` (null: none). */
function commonAncestor(m: DbModel, entries: readonly number[]): number | null {
  const parent = m.hierarchy.entryParent;
  const chain = (e: number) => {
    const out: number[] = [];
    for (let x = e; x !== NO_PARENT; x = parent[x]) {
      out.push(x);
    }
    return out.reverse();
  };
  let common = chain(entries[0]);
  for (const e of entries.slice(1)) {
    const c = chain(e);
    let k = 0;
    while (k < common.length && k < c.length && common[k] === c[k]) {
      k++;
    }
    common = common.slice(0, k);
  }
  let at = common[common.length - 1] ?? NO_PARENT;
  while (at !== NO_PARENT && !entryName(m, at)) {
    at = parent[at];
  }
  return at === NO_PARENT ? null : at;
}

/** The fewest nodes under `group` holding none of `covered` (maximal
 *  uncovered subtrees), or null when the set cannot be said that way (an
 *  uncovered item sits on a partly covered node itself, a node has no name)
 *  or it takes more than `limit` of them. */
function uncoveredUnder(m: DbModel, group: number, covered: ReadonlySet<number>, limit: number): number[] | null {
  const own = (e: number) => m.entryToItem[e];
  if (own(group) >= 0 && !covered.has(own(group))) {
    return null;
  }
  const out: number[] = [];
  const todo = [group];
  while (todo.length > 0) {
    const e = todo.pop() ?? group;
    for (let c = m.childStart[e]; c < m.childStart[e + 1]; c++) {
      const child = m.childList[c];
      const items = itemsUnder(m, child);
      let n = 0;
      for (const it of items) {
        if (covered.has(it)) {
          n++;
        }
      }
      if (items.length === 0 || n === items.length) {
        continue;
      }
      if (n === 0) {
        if (!entryName(m, child) || out.length >= limit) {
          return null;
        }
        out.push(child);
        continue;
      }
      if (own(child) >= 0 && !covered.has(own(child))) {
        return null;
      }
      todo.push(child);
    }
  }
  return out;
}

/** The lower-cased names of the named nodes above `name` (any model). */
function namedAncestors(name: string): Set<string> {
  const out = new Set<string>();
  for (const h of treeApi.findEntriesByNames([name])) {
    const m = models[h.model];
    if (!m || m.removed) {
      continue;
    }
    for (let x = m.hierarchy.entryParent[h.entry]; x !== NO_PARENT; x = m.hierarchy.entryParent[x]) {
      const n = entryName(m, x);
      if (n) {
        out.add(n.toLowerCase());
      }
    }
  }
  return out;
}

/** Whether the deepest listed node above `name` adds it (an item list
 *  entry), not leaves it out — i.e. `name` is in the set through a group. */
function coveredFromAbove(name: string, items: readonly string[], exclude: readonly string[]): boolean {
  const above = namedAncestors(name);
  let best: { depth: number; add: boolean } | null = null;
  for (const [list, add] of [
    [items, true],
    [exclude, false],
  ] as const) {
    for (const n of list) {
      if (!above.has(n)) {
        continue;
      }
      const depth = namedAncestors(n).size;
      if (!best || depth > best.depth || (depth === best.depth && !add)) {
        best = { depth, add };
      }
    }
  }
  return best?.add ?? false;
}

function growBox(box: Float32Array, wb: Float32Array): void {
  for (let k = 0; k < 3; k++) {
    box[k] = Math.min(box[k], wb[k]);
    box[k + 3] = Math.max(box[k + 3], wb[k + 3]);
  }
}

function emptyBox(): Float32Array {
  return new Float32Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
}

/** Restore every capture taken by the last enter; returns the touched models. */
function restoreCaptures(): number[] {
  const touched: number[] = [];
  for (const [mi, cap] of captures) {
    const m = models[mi];
    if (!m || m.removed || m.tidx.length === 0) {
      continue;
    }
    restoreTransformRuns(cap.runs);
    touched.push(mi);
  }
  // the scene's own colour/opacity/hidden band, actor items included
  touched.push(...lookExit());
  captures = new Map();
  actorItems = new Map();
  actorLayers = new Map();
  resetAnimBand();
  clearSweptBounds();
  transforms.fill(0, ANIM_BAND_FIRST * 16);
  setAnimModeActive(false);
  return [...new Set(touched)];
}

/** Drop animation mode WITHOUT restoring (scene clear: the models are gone). */
export function resetAnimationState(): void {
  captures = new Map();
  actorItems = new Map();
  actorLayers = new Map();
  lookReset();
  resetAnimBand();
  clearSweptBounds();
  transforms.fill(0, ANIM_BAND_FIRST * 16);
  setAnimModeActive(false);
}

/** Capture model `mi` (transform runs once per enter) and the entry flags of
 *  `items` — an item already captured keeps its ORIGINAL bits. */
function captureModel(mi: number, items: Uint32Array): void {
  const m = models[mi];
  let cap = captures.get(mi);
  if (!cap) {
    cap = { runs: captureTransformRuns(mi), items: null };
    captures.set(mi, cap);
  }
  if (items.length === 0) {
    return;
  }
  cap.items ??= {
    has: new Uint8Array(m.itemCount),
    bits: new Uint32Array(m.itemCount),
    colors: new Uint32Array(m.itemCount),
    list: [],
  };
  const { has, bits, colors, list } = cap.items;
  for (const it of items) {
    if (!has[it]) {
      has[it] = 1;
      list.push(it);
      bits[it] = m.states[it * 2] & LOOK_BITS;
      colors[it] = m.states[it * 2 + 1];
    }
  }
}

/** Lay each listed actor's own keys over its base words — only where
 *  `within` changed, when given; returns the item ranges written. */
function applyActors(actors: Iterable<string>, within?: DirtyRanges): DirtyRanges {
  const touched: DirtyRanges = new Map();
  for (const actor of actors) {
    const per = actorItems.get(actor);
    if (!per) {
      continue;
    }
    const layer = actorLayers.get(actor) ?? NO_LAYER;
    for (const [mi, items] of per) {
      const m = models[mi];
      const cap = captures.get(mi);
      const r = within ? dirtyBounds(within, mi) : null;
      const outside = !!within && (!r || items[items.length - 1] < r.lo || items[0] >= r.hi);
      if (!m || m.removed || !cap || items.length === 0 || outside) {
        continue;
      }
      const base = cap.items;
      for (const it of items) {
        const [flags, color] = applyActorLayer(base?.bits[it] ?? 0, base?.colors[it] ?? 0, m.baseColor[it] ?? 0, layer);
        m.states[it * 2] = ((m.states[it * 2] & ~LOOK_BITS) | flags) >>> 0;
        if (flags & HAS_COLOR_OVERRIDE) {
          m.states[it * 2 + 1] = color;
        }
      }
      markItems(touched, mi, items);
    }
  }
  return touched;
}

/** Update the listed actors' layers and re-apply them. */
function setActorLayers<C extends { actor: string }>(
  changes: readonly C[],
  patch: (c: C, layer: ActorLayer) => ActorLayer,
): StateUpdate[] {
  for (const c of changes) {
    actorLayers.set(c.actor, patch(c, actorLayers.get(c.actor) ?? NO_LAYER));
  }
  return transferUpdates(packDirty(applyActors(changes.map((c) => c.actor))));
}

// -----------------------------------------------------------------------------
// api
// -----------------------------------------------------------------------------

type Box6 = [number, number, number, number, number, number];

/** A planner / brief item: name, lower-cased fullname, world box, and its
 *  place in the tree — parent fullname ('' at a root), depth, items under it
 *  and the model it belongs to (D48). */
export interface SelectionPart {
  name: string;
  fullname: string;
  bounds: Box6;
  parent: string;
  depth: number;
  items: number;
  model: string;
}

/** Items a selection hands out at most (a "leaves" brief of a whole plant). */
const MAX_SELECTION_PARTS = 20000;
/** Closest group: at most this many items under the group are looked at,
 *  and at most this many nodes left out. */
const MAX_GROUP_ITEMS = 200_000;
const MAX_GROUP_MINUS = 12;

/** World box of everything under an entry (moved items where they are), or
 *  null when it has no geometry. `wb` is scratch. */
function entryWorldBox(m: DbModel, e: number, wb: Float32Array): Box6 | null {
  const box: Box6 = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const it of itemsUnder(m, e)) {
    if (itemWorldBounds(m.itemBounds, m.tidx, it, wb)) {
      for (let k = 0; k < 3; k++) {
        box[k] = Math.min(box[k], wb[k]);
        box[k + 3] = Math.max(box[k + 3], wb[k + 3]);
      }
    }
  }
  return Number.isFinite(box[0]) ? box : null;
}

export const animationApi = {
  /** Enter (or re-enter, after the doc's actors changed) animation mode. */
  animEnter(actors: AnimActorSpec[]): AnimEnterResult {
    const touched = new Set(restoreCaptures());
    // the clean start (D24): capture the viewer's colours, then clear them —
    // before the actors capture, so their base is the clean scene
    for (const mi of lookEnter()) {
      touched.add(mi);
    }
    // items the viewer moved (Transform ribbon) stand at their original place
    // too (D39): the slot runs are captured here and put back on exit
    models.forEach((m, mi) => {
      if (m.removed || m.tidx.length === 0 || !m.tidx.some((slot) => slot !== 0)) {
        return;
      }
      captureModel(mi, new Uint32Array(0));
      m.tidx.fill(0);
      touched.add(mi);
    });
    const result: AnimEnterResult = {
      bindings: [],
      unresolved: [],
      restBounds: {},
      restCenter: {},
      itemCounts: {},
      bandFull: false,
      shared: [],
      updates: [],
    };
    const owned = new Map<number, Map<number, string>>(); // item → its FIRST actor
    // band slots are handed out after ownership is settled, movers first
    const pending: { actor: string; moves: boolean; m: DbModel; baseSlot: number; list: number[] }[] = [];
    const wb = new Float32Array(6);
    setAnimModeActive(true);
    for (const actor of actors) {
      const { byModel, missing } = resolveItems(actor.fullnames, actor.exclude);
      if (missing.length) {
        result.unresolved.push({ actor: actor.id, fullnames: missing });
      }
      const box = emptyBox();
      const perModel = new Map<number, Uint32Array>();
      const lost = new Map<string, number>(); // owner → items it keeps from this actor
      let count = 0;
      for (const [mi, set] of byModel) {
        const m = models[mi];
        let taken = owned.get(mi);
        if (!taken) {
          taken = new Map();
          owned.set(mi, taken);
        }
        const free: number[] = [];
        for (const it of set) {
          const owner = taken.get(it);
          if (owner === undefined) {
            free.push(it);
          } else {
            lost.set(owner, (lost.get(owner) ?? 0) + 1);
          }
        }
        const items = Uint32Array.from(free).sort();
        if (items.length === 0) {
          continue;
        }
        captureModel(mi, items);
        const bySlot = new Map<number, number[]>();
        for (const it of items) {
          taken.set(it, actor.id);
          if (itemWorldBounds(m.itemBounds, m.tidx, it, wb)) {
            growBox(box, wb);
          }
          const list = bySlot.get(m.tidx[it]);
          if (list) {
            list.push(it);
          } else {
            bySlot.set(m.tidx[it], [it]);
          }
        }
        for (const [baseSlot, list] of bySlot) {
          pending.push({ actor: actor.id, moves: actor.moves !== false, m, baseSlot, list });
        }
        perModel.set(mi, items);
        count += items.length;
        touched.add(mi);
      }
      actorItems.set(actor.id, perModel);
      result.itemCounts[actor.id] = count;
      for (const [owner, items] of lost) {
        result.shared.push({ actor: actor.id, owner, items });
      }
      if (Number.isFinite(box[0])) {
        result.restBounds[actor.id] = box;
        result.restCenter[actor.id] = [(box[0] + box[3]) / 2, (box[1] + box[4]) / 2, (box[2] + box[5]) / 2];
      }
    }
    for (const p of [...pending.filter((x) => x.moves), ...pending.filter((x) => !x.moves)]) {
      const slot = allocAnimSlot();
      if (slot === null) {
        // a still item stays at rest without a slot; a moving one cannot move
        result.bandFull ||= p.moves;
        continue;
      }
      const base = transforms.slice(p.baseSlot * 16, p.baseSlot * 16 + 16);
      transforms.set(base, slot * 16); // worker readers see the rest pose
      for (const it of p.list) {
        p.m.tidx[it] = slot;
      }
      result.bindings.push({ actor: p.actor, slot, base });
    }
    result.updates = Array.from(touched, (mi) => packStates(models[mi], mi));
    const buffers = [
      ...updateBuffers(result.updates),
      ...result.bindings.map((b) => b.base.buffer),
      ...Object.values(result.restBounds).map((b) => b.buffer),
    ];
    return Comlink.transfer(result, buffers);
  },

  /** Leave animation mode: every captured slot run and actor bit restored. */
  animExit(): StateUpdate[] {
    const touched = restoreCaptures();
    return transferUpdates(touched.map((mi) => packStates(models[mi], mi)));
  },

  /** True while animation mode owns band slots. */
  animActive(): boolean {
    return actorItems.size > 0 || captures.size > 0;
  },

  /** Keep the worker's copy of band matrices in step with what the main
   *  thread drew (pause / seek / record), so selection bounds, fit-selection
   *  and the gizmo follow the animated pose. `data` = 16 floats per slot. */
  animSyncBand(firstSlot: number, data: Float32Array): void {
    if (firstSlot < ANIM_BAND_FIRST) {
      return;
    }
    const n = Math.min(data.length, (TRANSFORM_POOL - firstSlot) * 16);
    transforms.set(data.subarray(0, n), firstSlot * 16);
  },

  /** Stepped visibility per actor: true/false, or null = no key (the look's
   *  visibility, D25). */
  animSetVisibility(changes: { actor: string; visible: boolean | null }[]): StateUpdate[] {
    return setActorLayers(changes, (c, l) => ({ ...l, visible: c.visible }));
  },

  /** Stepped opacity per actor (0..1); 1 or null = no key (the look's). An
   *  opacity key is clamped to 1 % — hiding is the visibility key's job. */
  animSetOpacity(changes: { actor: string; value: number | null }[]): StateUpdate[] {
    return setActorLayers(changes, (c, l) => ({ ...l, opacity: c.value === null || c.value >= 1 ? null : c.value }));
  },

  /** Actor colour keys (D26): RGBA8 from/to with a fade, or null = none. */
  animSetColor(changes: { actor: string; color: ActorColorLayer | null }[]): StateUpdate[] {
    return setActorLayers(changes, (c, l) => ({ ...l, color: c.color }));
  },

  /** Show a look (Set Color inside the animation, D23–D26): the scene's look
   *  band is rewritten, every actor rebased on it and its own keys re-laid. */
  animSetLook(req: LookRequest): StateUpdate[] {
    const dirty = setLook(req);
    for (const [mi, cap] of captures) {
      const r = dirtyBounds(dirty, mi);
      if (!r) {
        continue;
      }
      const base = cap.items;
      for (const it of base?.list ?? []) {
        if (base && it >= r.lo && it < r.hi) {
          const [flags, color] = lookWordsFor(mi, it);
          base.bits[it] = flags;
          base.colors[it] = color;
        }
      }
    }
    // the actors' own keys go back over the items the look rewrote
    for (const [mi, pairs] of applyActors(actorItems.keys(), dirty)) {
      dirty.set(mi, [...(dirty.get(mi) ?? []), ...pairs]);
    }
    return transferUpdates(packDirty(dirty));
  },

  /** Conservative swept WORLD boxes per band slot (null clears) — residency
   *  then budgets a moving part over its whole path (DESIGN.md › Animation › Engine). */
  animSetSweptBounds(bySlot: Record<number, Float32Array | null>): void {
    for (const [slot, box] of Object.entries(bySlot)) {
      setSweptBounds(Number(slot), box);
    }
  },

  /** The selection as a new actor: the topmost fully selected entries (the
   *  rows the tree highlights as roots), a name and the rest center. */
  animActorFromSelection(): { name: string; fullnames: string[]; center: V3 } | null {
    const names: string[] = [];
    const labels: string[] = [];
    for (const m of models) {
      if (m.removed || m.selected.length === 0 || !m.itemsUnder) {
        continue;
      }
      const { selected } = stateAggregates(m);
      const parent = m.hierarchy.entryParent;
      const full = (e: number) => selected[e] > 0 && selected[e] >= (m.itemsUnder?.[e] ?? Infinity);
      for (let e = 0; e < selected.length; e++) {
        if (!full(e)) {
          continue;
        }
        const p = parent[e];
        if (p !== NO_PARENT && full(p)) {
          continue; // an ancestor already covers it
        }
        const name = entryName(m, e);
        names.push(name.toLowerCase());
        labels.push(name);
      }
    }
    if (names.length === 0) {
      return null;
    }
    const unique = [...new Set(names)];
    const b = treeApi.boundsForNames(unique);
    const center: V3 = b
      ? [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2]
      : [0, 0, 0];
    const first = displayName(labels[0]);
    const label = unique.length === 1 ? first : `${first} +${unique.length - 1}`;
    return { name: label, fullnames: unique, center };
  },

  /** Build-order items for the assembly wizard (DESIGN.md › Animation › Authoring): one entry per
   *  topmost fully selected node ('nodes'), or per direct child of each
   *  ('children'), in tree order — name, lower-cased fullname and world box. */
  animSelectionParts(mode: 'nodes' | 'children' | 'leaves', limit = MAX_SELECTION_PARTS): SelectionPart[] {
    const out: SelectionPart[] = [];
    const wb = new Float32Array(6);
    for (const m of models) {
      if (m.removed || m.selected.length === 0 || !m.itemsUnder || out.length >= limit) {
        continue;
      }
      const { selected } = stateAggregates(m);
      const parent = m.hierarchy.entryParent;
      const full = (e: number) => selected[e] > 0 && selected[e] >= (m.itemsUnder?.[e] ?? Infinity);
      const roots: number[] = [];
      for (let e = 0; e < selected.length; e++) {
        const p = parent[e];
        if (full(e) && !(p !== NO_PARENT && full(p))) {
          roots.push(e);
        }
      }
      const childrenOf = (e: number): number[] => {
        const kids: number[] = [];
        for (let c = m.childStart[e]; c < m.childStart[e + 1]; c++) {
          kids.push(m.childList[c]);
        }
        return kids;
      };
      /** every entry under e without children (e itself when it has none) */
      const leavesOf = (e: number): number[] => {
        const leaves: number[] = [];
        const todo = [e];
        while (todo.length && leaves.length < limit) {
          const x = todo.pop() ?? e;
          const kids = childrenOf(x);
          if (kids.length) {
            todo.push(...kids.reverse());
          } else {
            leaves.push(x);
          }
        }
        return leaves;
      };
      const entries =
        mode === 'nodes'
          ? roots
          : mode === 'children'
            ? roots.flatMap((e) => {
                // as the Hierarchy lists them
                const kids = childrenOf(e).sort((x, y) => entryName(m, x).localeCompare(entryName(m, y)));
                return kids.length ? kids : [e];
              })
            : roots.flatMap(leavesOf);
      for (const e of entries) {
        if (out.length >= limit) {
          break;
        }
        const bounds = entryWorldBox(m, e, wb);
        if (!bounds) {
          continue; // no geometry under it
        }
        const name = entryName(m, e);
        const p = parent[e];
        let depth = 0;
        for (let x = p; x !== NO_PARENT; x = parent[x]) {
          depth++;
        }
        out.push({
          name: displayName(name),
          fullname: name.toLowerCase(),
          bounds,
          parent: p === NO_PARENT ? '' : entryName(m, p).toLowerCase(),
          depth,
          items: m.itemsUnder?.[e] ?? 0,
          model: m.name,
        });
      }
    }
    return out;
  },

  /** Planner items for these fullnames (a loaded plan, D45): name and world
   *  box of each one found in the loaded models, in the order asked; names
   *  that match nothing with geometry are left out. */
  animPartsByNames(fullnames: string[]): { name: string; fullname: string; bounds: Box6 }[] {
    const wb = new Float32Array(6);
    const out: { name: string; fullname: string; bounds: Box6 }[] = [];
    const seen = new Set<string>();
    for (const raw of fullnames) {
      const fullname = raw.trim().toLowerCase();
      if (seen.has(fullname)) {
        continue;
      }
      seen.add(fullname);
      let box: Box6 | null = null;
      let label = '';
      for (const h of treeApi.findEntriesByNames([fullname])) {
        const m = models[h.model];
        const b = m && !m.removed ? entryWorldBox(m, h.entry, wb) : null;
        if (!m || !b) {
          continue;
        }
        label ||= entryName(m, h.entry);
        box = box
          ? [
              Math.min(box[0], b[0]),
              Math.min(box[1], b[1]),
              Math.min(box[2], b[2]),
              Math.max(box[3], b[3]),
              Math.max(box[4], b[4]),
              Math.max(box[5], b[5]),
            ]
          : b;
      }
      if (box) {
        out.push({ name: displayName(label), fullname, bounds: box });
      }
    }
    return out;
  },

  /** The actors that own selected items, most selected items first — what
   *  Colour key and Add callout act on (needs the mode's capture). */
  animSelectedActors(): string[] {
    const counts: [string, number][] = [];
    for (const [actor, per] of actorItems) {
      let n = 0;
      for (const [mi, items] of per) {
        const m = models[mi];
        if (!m || m.removed || m.selected.length === 0) {
          continue;
        }
        for (const it of items) {
          if (m.states[it * 2] & IS_SELECTED) {
            n++;
          }
        }
      }
      if (n > 0) {
        counts.push([actor, n]);
      }
    }
    return counts.sort((a, b) => b[1] - a[1]).map(([actor]) => actor);
  },

  /** Replace the selection with an object's items (Key panel → Select). */
  animSelectActor(fullnames: string[], exclude: string[] = []): StateUpdate[] {
    return animationApi.animSelectActors([{ fullnames, exclude }]);
  },

  /** Select exactly the items of several objects (their item sets joined);
   *  everything else is deselected. */
  animSelectActors(lists: { fullnames: string[]; exclude?: string[] }[]): StateUpdate[] {
    const touched = new Set<number>();
    models.forEach((m, mi) => {
      if (m.removed || m.selected.length === 0) {
        return;
      }
      for (const it of m.selected) {
        m.states[it * 2] &= ~IS_SELECTED;
      }
      m.selected = new Uint32Array(0);
      touched.add(mi);
    });
    const joined = new Map<number, Set<number>>();
    for (const l of lists) {
      for (const [mi, set] of resolveItems(l.fullnames, l.exclude ?? []).byModel) {
        const all = joined.get(mi) ?? new Set<number>();
        for (const it of set) {
          all.add(it);
        }
        joined.set(mi, all);
      }
    }
    for (const [mi, set] of joined) {
      const m = models[mi];
      for (const it of set) {
        m.states[it * 2] |= IS_SELECTED;
      }
      m.selected = Uint32Array.from(set);
      touched.add(mi);
    }
    return transferUpdates(Array.from(touched, (mi) => packStates(models[mi], mi)));
  },

  /** How many live items each fullname list resolves to (Problems list,
   *  actor item counts without entering the mode). */
  animCountItems(
    lists: { actor: string; fullnames: string[]; exclude?: string[] }[],
  ): { actor: string; items: number; missing: number }[] {
    return lists.map((l) => {
      const { byModel, missing } = resolveItems(l.fullnames, l.exclude);
      let items = 0;
      for (const set of byModel.values()) {
        items += set.size;
      }
      return { actor: l.actor, items, missing: missing.length };
    });
  },

  /** The tree's own spelling of each fullname (objects store them
   *  lower-cased); a name no loaded model has comes back as it is. */
  animTreeNames(fullnames: string[]): string[] {
    return fullnames.map((n) => {
      const [h] = treeApi.findEntriesByNames([n]);
      const m = h ? models[h.model] : undefined;
      return (h && m && !m.removed && entryName(m, h.entry)) || n;
    });
  },

  /** The closest group naming the same items more simply: the lowest named
   *  node holding all of `fullnames` (minus `exclude`), with the few nodes
   *  under it that are not in the set left out — null when there is none,
   *  it is not simpler, or the set spans models. */
  animClosestGroup(fullnames: string[], exclude: string[] = []): ClosestGroup | null {
    const { byModel } = resolveItems(fullnames, exclude);
    const only = byModel.size === 1 ? [...byModel][0] : undefined;
    if (!only) {
      return null;
    }
    const [mi, covered] = only;
    const m = models[mi];
    const entries = entriesIn(mi, fullnames);
    const group = entries.length > 0 ? commonAncestor(m, entries) : null;
    if (group === null || (m.itemsUnder?.[group] ?? 0) > MAX_GROUP_ITEMS) {
      return null;
    }
    const minus = uncoveredUnder(m, group, covered, MAX_GROUP_MINUS);
    const name = entryName(m, group);
    const same = fullnames.length === 1 && exclude.length === 0 && fullnames[0] === name.toLowerCase();
    if (!minus || same || 1 + minus.length >= fullnames.length + exclude.length) {
      return null;
    }
    return {
      group: name.toLowerCase(),
      name: displayName(name),
      minus: minus.map((e) => entryName(m, e).toLowerCase()).sort(),
      items: covered.size,
    };
  },
  /** The item set with the selected `names` added or taken out, changed the
   *  least and kept tidy: adding a node drops the entries under it and the
   *  leave-outs it overrides (listing it only when no group above holds
   *  it); removing one drops the entries under it and leaves it out when a
   *  group above still holds it. Lower-cased fullnames in and out. */
  animEditItemSet(
    items: string[],
    exclude: string[],
    names: string[],
    op: 'add' | 'remove',
  ): { items: string[]; exclude: string[] } {
    let inc = [...items];
    let exc = [...exclude];
    for (const raw of names) {
      const n = raw.toLowerCase();
      const under = (x: string) => namedAncestors(x).has(n);
      inc = inc.filter((x) => x !== n && !under(x));
      exc = exc.filter((x) => (op === 'add' ? x !== n && !under(x) : !under(x)));
      const held = coveredFromAbove(n, inc, exc);
      if (op === 'add' && !held && !inc.includes(n)) {
        inc.push(n);
      }
      if (op === 'remove' && held && !exc.includes(n)) {
        exc.push(n);
      }
    }
    return { items: inc, exclude: exc };
  },
};

/** "/SITE/PUMP-101" → "PUMP-101": the last path segment reads as a name. */
function displayName(fullname: string): string {
  const seg = fullname.split('/').filter((x) => x.length > 0);
  return seg[seg.length - 1] ?? fullname;
}
