// Shared model-DB state: the DbModel record, the append-only `models` array
// every domain module operates on, and the native item-state bit layout.
// Owned by the modeldb worker — nothing outside src/lib/modeldb imports this
// directly (external consumers go through modeldbWorker.ts re-exports).
import type { Hierarchy } from '../model/format';

// item-state flags — same bit layout as the native MeshItem (item_state.rs)
export const IS_HIDDEN = 1 << 0;
export const IS_SELECTED = 1 << 2;
export const HAS_COLOR_OVERRIDE = 1 << 4;
export const HAS_OPACITY_OVERRIDE = 1 << 6;
/** Item-boundary edge lines OFF for this item (Hierarchy context menu). Not
 *  a native bit — the native layout leaves 8-24 unused; the scene shader
 *  folds it into the G-buffer edge tag. */
export const NO_ITEM_EDGES = 1 << 8;
export const OPACITY_SHIFT = 25; // bits 25-31 hold 0-100 (native layout)
export const OPACITY_MASK = 0x7f << OPACITY_SHIFT;

export const NO_PARENT = 0xffffffff;

/** Invisible AS THE USER SEES IT: the hide flag, an explicit opacity override
 *  of 0, or a colour override whose alpha is 0 (the explicit override wins
 *  when both are set, like the scene shader's item_opacity). Set Color's
 *  "hidden" toggle and `sql.color`'s default-hidden base coat hide through
 *  opacity 0, and an item nobody can see must behave like a hidden one
 *  everywhere: the tree badge, fit-visible, the residency budget and —
 *  mirrored in WGSL — the cull and snap shaders. The baked material alpha is
 *  not consulted (the cull cannot see it either). */
export function isEffectivelyHidden(flags: number, color: number): boolean {
  if (flags & IS_HIDDEN) {
    return true;
  }
  if (flags & HAS_OPACITY_OVERRIDE) {
    return (flags & OPACITY_MASK) >>> OPACITY_SHIFT === 0;
  }
  return (flags & HAS_COLOR_OVERRIDE) !== 0 && ((color >>> 24) & 255) === 0;
}

export interface DbModel {
  /** Tombstoned by forgetModels — hidden everywhere, slot kept for index stability. */
  removed?: boolean;
  /** Tables released by forgetModelTables (explicit unload): reviveModel must
   *  rebuild them from the fresh parse instead of reusing them. */
  forgotten?: boolean;
  name: string;
  /** import group (the folder the model came from) — the tree root label */
  group: string;
  /** store (plant) the asset was loaded from ('' = unknown/legacy). Part of
   *  model identity: two stores may hold the SAME folder+name structure. */
  store: string;
  /** any color group carries a baked alpha < 1 (material transparency from the
   *  source file) — drives the blend-pass gate even with no user override. */
  bakedTransparent: boolean;
  itemCount: number;
  hierarchy: Hierarchy;
  /** children CSR over hierarchy entries (built once after load). */
  childStart: Uint32Array;
  childList: Uint32Array;
  roots: Uint32Array;
  /** dense item -> hierarchy entry (leaves), 0xFFFFFFFF when unmapped. */
  itemToEntry: Uint32Array;
  /** Per-entry subtree aggregates for the tree's visibility badges: items in
   *  the subtree (built once with the indexes) and how many of them are
   *  hidden (recomputed lazily — see hiddenAggregate). */
  itemsUnder?: Uint32Array;
  hiddenUnder?: Uint32Array;
  /** selected items in the subtree — the tree's "all / partly selected"
   *  highlight, derived from item state so invert / API / SQL selections show
   *  at every level without expanding (same lazy refresh as hiddenUnder) */
  selectedUnder?: Uint32Array;
  /** Bumped by packStates on EVERY state upload; hiddenUnder is stamped with
   *  the version it was computed for and refreshed when they differ. */
  stateVersion?: number;
  hiddenAggVersion?: number;
  /** lowercase entry names, built on first search */
  namesLower: string[] | null;
  /** per-item state, interleaved [flags, colorRGBA8] (color/select bits). */
  states: Uint32Array;
  /** per-item committed transform slot (0 = identity, native transform_idx). */
  tidx: Uint32Array;
  /** per-item ORIGINAL packed RGBA8 (the color group's color) — captured at
   *  load because cgColors is transferred to the renderer. Snapshot scope
   *  "all" records it so a snapshot can repaint another dataset. */
  baseColor: Uint32Array;
  /** fullname-hash → items index for snapshot import (lazy; names never
   *  change after load so it is built once). Keyed by hashLo; buckets
   *  disambiguate on hashHi (a u64 does not fit a Map number key). */
  hashIndex?: Map<number, { hi: number; items: number[] }[]>;
  /** per-item world AABB (6 floats per item, from the pack step). */
  itemBounds: Float32Array;
  /** currently selected dense item indices (for cheap clear/re-color). */
  selected: Uint32Array;
  /** entries in parent-before-child order (BFS from roots), for top-down color
   *  propagation. Built lazily. */
  bfsOrder?: Uint32Array;
  /** per-entry depth (1 = root entry), for level-restricted filters. Lazy. */
  entryDepth?: Uint16Array;
}

export interface TreeNode {
  entry: number;
  name: string;
  hasChildren: boolean;
  /** dense item index when this entry is a leaf with geometry, else -1 */
  item: number;
  /** items in this entry's subtree, and how many of them are hidden — the
   *  tree's "hidden / partly hidden" badge, O(1) per row */
  itemsUnder: number;
  hiddenUnder: number;
  selectedUnder: number;
}

export type StateUpdate = { model: number; states: Uint32Array<ArrayBuffer> };

function emptyHierarchy(): Hierarchy {
  return {
    namePool: new Uint8Array(0),
    entryId: new Uint32Array(0),
    entryNameOffset: new Uint32Array(0),
    entryParent: new Uint32Array(0),
    entryNameLen: new Uint16Array(0),
    idItemIds: new Uint32Array(0),
    idItemItems: new Uint32Array(0),
  };
}

/** EXPLICIT unload only (GUI / API remove, a recovery slot whose file is
 *  gone): release every table that scales with the model — hierarchy, name
 *  pool, indexes, per-item state, colors, transforms, bounds — so a removed
 *  model costs nothing but its slot until the scene is cleared. Identity and
 *  `itemCount` stay (slot alignment and item bases depend on them) and
 *  `forgotten` tells reviveModel to rebuild from the fresh parse, which also
 *  makes a later load of the same file start clean. NEVER for a residency
 *  evict: that path keeps the DbModel live so the revive restores state. */
export function forgetModelTables(m: DbModel): void {
  m.forgotten = true;
  m.hierarchy = emptyHierarchy();
  m.childStart = new Uint32Array(0);
  m.childList = new Uint32Array(0);
  m.roots = new Uint32Array(0);
  m.itemToEntry = new Uint32Array(0);
  m.itemsUnder = undefined;
  m.hiddenUnder = undefined;
  m.selectedUnder = undefined;
  m.hiddenAggVersion = undefined;
  m.namesLower = null;
  m.states = new Uint32Array(0);
  m.tidx = new Uint32Array(0);
  m.baseColor = new Uint32Array(0);
  m.hashIndex = undefined;
  m.itemBounds = new Float32Array(0);
  m.selected = new Uint32Array(0);
  m.bfsOrder = undefined;
  m.entryDepth = undefined;
}

export const models: DbModel[] = [];
