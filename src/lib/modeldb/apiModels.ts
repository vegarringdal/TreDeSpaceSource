// Model registry domain: load/parse/pack, tombstone-removal, group listing,
// scene clear (which resets every per-domain store), and scene-wide framing.
import * as Comlink from 'comlink';
import { boxInFrustum } from '../math/frustum';
import { parseModel } from '../model/format';
import {
  estimateItemFullBytes,
  hasAuthoredNormals,
  healItemBounds,
  ITEM_DROP,
  type PackedModel,
  packModel,
  packModelMixed,
} from '../model/pack';
import { clipCulledSphere } from '../render/clipCull';
import { resetTransformUndo } from './apiTransform';
import { resetColorUndo } from './colorUndo';
import { type DbModel, IS_HIDDEN, models, resetItemStates, type StateUpdate } from './dbState';
import { resetGlobalIndex } from './globalNameIndex';
import { buildIndexes, packStates } from './hierarchyIndex';
import { itemWorldBounds, resetTransformPool } from './transformPool';

/** Mark the packed geometry arrays for zero-copy transfer to the main thread. */
function transferPacked<T extends Omit<PackedModel, 'itemBounds'>>(packed: T): T {
  const transfers = [
    packed.positionsQ.buffer,
    packed.indices16.buffer,
    packed.cull,
    packed.meshletInfo,
    packed.cgColors.buffer,
  ];
  if (packed.normalsQ) {
    transfers.push(packed.normalsQ.buffer);
  }
  return Comlink.transfer(packed, transfers);
}

/** Residency cut rules: items entirely below `sizeM` extent AND farther than
 * `distM` from the eye — or hidden, when `dropHidden` — are dropped from
 * budget-mode packs altogether (0 disables the size/distance cut). */
export interface ResidencyCuts {
  sizeM: number;
  distM: number;
  dropHidden: boolean;
}

/** WORLD-space (transform-applied) item boxes for a whole model — the basis
 * for every residency distance/frustum/cut decision, so a MOVED item is
 * budgeted where it actually is. No-geometry items keep the Infinity marker. */
function worldBoundsOf(m: DbModel): Float32Array {
  const out = new Float32Array(m.itemCount * 6);
  const wb = new Float32Array(6);
  for (let i = 0; i < m.itemCount; i++) {
    if (itemWorldBounds(m.itemBounds, m.tidx, i, wb)) {
      out.set(wb, i * 6);
    } else {
      out[i * 6] = Infinity;
    }
  }
  return out;
}

/** Clamped squared distance of world box `i` to `eye` (Infinity = no geometry). */
function boxDistSq(wb: Float32Array, i: number, eye: readonly [number, number, number]): number {
  const o = i * 6;
  if (!Number.isFinite(wb[o])) {
    return Infinity;
  }
  let dsq = 0;
  for (let k = 0; k < 3; k++) {
    const c = Math.min(Math.max(eye[k], wb[o + k]), wb[o + 3 + k]);
    dsq += (eye[k] - c) ** 2;
  }
  return dsq;
}

// Out-of-frustum items are cut harder — geometry behind the camera needs to
// survive a turn-around, not carry small detail. Applied ONLY to mixed packs,
// which re-pack when the view turns; the coarse pack is the stable no-holes
// floor and must stay view-independent (a coarse zone has no turn trigger, so
// view-dependent cuts there would leave permanent holes once you look at it).
const OFFVIEW_DIST_FACTOR = 0.75;
const OFFVIEW_SIZE_FACTOR = 2;
/** Items provably outside the active clipping volumes cannot draw at all, so
 * anything smaller than this in every axis is dropped regardless of distance.
 * Larger pieces stay (coarse) so editing the clip box reveals shapes rather
 * than holes. */
const CLIP_OUTSIDE_SIZE_M = 2.5;

/** True when world box `i` is provably outside every active clip volume. */
function isClipped(wb: Float32Array, i: number, clip: Float32Array | null): boolean {
  if (!clip) {
    return false;
  }
  const o = i * 6;
  if (!Number.isFinite(wb[o])) {
    return false;
  }
  const u = new Uint32Array(clip.buffer, clip.byteOffset, clip.length);
  const center: [number, number, number] = [
    (wb[o] + wb[o + 3]) / 2,
    (wb[o + 1] + wb[o + 4]) / 2,
    (wb[o + 2] + wb[o + 5]) / 2,
  ];
  const radius = Math.hypot(wb[o + 3] - wb[o], wb[o + 4] - wb[o + 1], wb[o + 5] - wb[o + 2]) / 2;
  return clipCulledSphere(clip, u, center, radius);
}

/** Small-item cut for geometry outside the clip volume (distance-independent). */
function isClipCut(wb: Float32Array, i: number): boolean {
  const o = i * 6;
  return (
    wb[o + 3] - wb[o] < CLIP_OUTSIDE_SIZE_M &&
    wb[o + 4] - wb[o + 1] < CLIP_OUTSIDE_SIZE_M &&
    wb[o + 5] - wb[o + 2] < CLIP_OUTSIDE_SIZE_M
  );
}

/** True when world box `i` falls to the tiny-and-far cut (view-dependent). */
function isCut(wb: Float32Array, i: number, distSq: number, cuts: ResidencyCuts, inView: boolean): boolean {
  if (cuts.sizeM <= 0) {
    return false;
  }
  const distM = inView ? cuts.distM : cuts.distM * OFFVIEW_DIST_FACTOR;
  const sizeM = inView ? cuts.sizeM : cuts.sizeM * OFFVIEW_SIZE_FACTOR;
  if (distSq <= distM * distM) {
    return false;
  }
  const o = i * 6;
  return wb[o + 3] - wb[o] < sizeM && wb[o + 4] - wb[o + 1] < sizeM && wb[o + 5] - wb[o + 2] < sizeM;
}

/** Count items a viewer could expect to SEE that this pack has no geometry
 * for: packed bounds non-finite (no meshlets made it in), not hidden, and not
 * deliberately clip-cut. This is the residency manager's "deficient pack"
 * signal — a pack that dropped visible items can draw nothing where the user
 * looks, so GPU draw counts alone cannot prove the zone is off screen. */
function countMissingVisible(m: DbModel, packedBounds: Float32Array, clip: Float32Array | null): number {
  const wb = clip ? worldBoundsOf(m) : null;
  let n = 0;
  for (let i = 0; i < m.itemCount; i++) {
    if (Number.isFinite(packedBounds[i * 6])) {
      continue;
    }
    if ((m.states[i * 2] & IS_HIDDEN) !== 0) {
      continue;
    }
    if (wb && clip && isClipped(wb, i, clip) && isClipCut(wb, i)) {
      continue;
    }
    n++;
  }
  return n;
}

/** Parse+pack variant bytes for an already-registered model, verifying the
 * item table lines up BEFORE any state is mutated. The DbModel keeps its
 * finite itemBounds — a variant's degraded bounds never overwrite them — but
 * non-finite entries (initial coarse load whose cooker cut the item) adopt
 * the incoming bounds; see healItemBounds. */
async function repackForModel(
  index: number,
  bytes: ArrayBuffer,
): Promise<Omit<PackedModel, 'itemBounds'> & { packDropped: number }> {
  const m = models[index];
  if (!m) {
    throw new Error(`repackModel: no model at index ${index}`);
  }
  const parsed = await parseModel(m.name, bytes);
  if (parsed.itemCount !== m.itemCount) {
    throw new Error(`itemcount-mismatch: model ${index} has ${m.itemCount} items, variant has ${parsed.itemCount}`);
  }
  const { itemBounds, ...packed } = packModel(parsed);
  healItemBounds(m.itemBounds, itemBounds);
  const packDropped = countMissingVisible(m, itemBounds, null);
  return { ...transferPacked(packed), packDropped };
}

export const modelsApi = {
  /** Parse + pack a cooked .model; keeps hierarchy/items here, returns the
   * GPU-ready arrays (transferred, zero-copy). `packDropped` counts items with
   * no geometry in THESE bytes — nonzero when the caller loaded the coarse
   * variant, whose cooker cut the tiny items. */
  async addModel(
    name: string,
    bytes: ArrayBuffer,
    group = name,
    store = '',
  ): Promise<Omit<PackedModel, 'itemBounds'> & { packDropped: number }> {
    const parsed = await parseModel(name, bytes);
    const { itemBounds, ...packed } = packModel(parsed);
    // original per-item color, captured now — cgColors is transferred to the
    // renderer below and would need a GPU readback to recover later
    const baseColor = new Uint32Array(parsed.itemCount);
    const cgPacked = parsed.colorGroups.map((cg) => {
      const b = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
      return (b(cg.color[0]) | (b(cg.color[1]) << 8) | (b(cg.color[2]) << 16) | (b(cg.color[3]) << 24)) >>> 0;
    });
    for (let i = 0; i < parsed.itemCount; i++) {
      baseColor[i] = cgPacked[parsed.itemToCg[i]];
    }
    const m: DbModel = {
      name,
      group,
      store,
      bakedTransparent: parsed.colorGroups.some((c) => c.color[3] < 1),
      itemCount: parsed.itemCount,
      hierarchy: parsed.hierarchy,
      childStart: new Uint32Array(0),
      childList: new Uint32Array(0),
      roots: new Uint32Array(0),
      itemToEntry: new Uint32Array(0),
      namesLower: null,
      states: new Uint32Array(parsed.itemCount * 2),
      tidx: new Uint32Array(parsed.itemCount),
      baseColor,
      selected: new Uint32Array(0),
      itemBounds,
    };
    buildIndexes(m);
    models.push(m);
    return { ...transferPacked(packed), packDropped: countMissingVisible(m, m.itemBounds, null) };
  },

  /** Parse+pack a geometry variant of an already-registered LIVE model (full↔
   * coarse swap). No DbModel mutation — hierarchy/states/selection stay as-is.
   * Throws `itemcount-mismatch:` if the variant's item table differs. */
  async repackModel(
    index: number,
    bytes: ArrayBuffer,
  ): Promise<Omit<PackedModel, 'itemBounds'> & { packDropped: number }> {
    return repackForModel(index, bytes);
  },

  /** Un-tombstone a removed model with fresh bytes (reload / promote from
   * unloaded), keeping hierarchy, states, colors, and item bounds. `removed`
   * is cleared only after the item-table check passes — a mismatch leaves the
   * tombstone untouched so the caller can fall back to a fresh addModel. */
  async reviveModel(
    index: number,
    bytes: ArrayBuffer,
  ): Promise<Omit<PackedModel, 'itemBounds'> & { packDropped: number }> {
    const packed = await repackForModel(index, bytes);
    const m = models[index];
    m.removed = false;
    return packed;
  },

  /** Mixed-residency repack (tier 2.5): spend `targetBytes` of full-detail
   * budget on IN-FRUSTUM items, nearest first — out-of-view items ALWAYS
   * come from the coarse parse (outside the frustum, coarse is the default
   * level), as do in-view items past the budget. Hidden items never spend
   * full-detail budget. No DbModel mutation; throws `itemcount-mismatch:`
   * if either variant's item table differs from the registered model. */
  async repackModelMixed(
    index: number,
    fullBytes: ArrayBuffer,
    coarseBytes: ArrayBuffer,
    eye: readonly [number, number, number],
    targetBytes: number,
    cuts: ResidencyCuts,
    viewProj: Float32Array | null,
    clip: Float32Array | null,
  ): Promise<Omit<PackedModel, 'itemBounds'> & { fullBudgetLimited: boolean; packDropped: number }> {
    const m = models[index];
    if (!m) {
      throw new Error(`repackModelMixed: no model at index ${index}`);
    }
    const full = await parseModel(m.name, fullBytes);
    const coarse = await parseModel(m.name, coarseBytes);
    if (full.itemCount !== m.itemCount || coarse.itemCount !== m.itemCount) {
      throw new Error(
        `itemcount-mismatch: model ${index} has ${m.itemCount}, variants have ${full.itemCount}/${coarse.itemCount}`,
      );
    }

    // estimated full-detail GPU bytes per item — the same terms the renderer
    // allocates, normal stream included when the pack will carry one
    const estBytes = estimateItemFullBytes(full, hasAuthoredNormals(full, coarse));

    // nearest-first over the WORLD-space item boxes (clamped AABB distance),
    // in-frustum items strictly before out-of-view ones — full detail lands
    // on what the camera can see, behind-you geometry only gets leftovers
    const wb = worldBoundsOf(m);
    const order = new Uint32Array(m.itemCount);
    const dist = new Float32Array(m.itemCount);
    const inView = new Uint8Array(m.itemCount);
    for (let i = 0; i < m.itemCount; i++) {
      order[i] = i;
      dist[i] = boxDistSq(wb, i, eye);
      if (!viewProj || (Number.isFinite(dist[i]) && boxInFrustum(viewProj, wb, i * 6))) {
        inView[i] = 1;
      }
    }
    order.sort((a, b) => inView[b] - inView[a] || dist[a] - dist[b]);

    // cuts first (dropped items are gone from BOTH sources), then the greedy
    // fill of the full-detail budget over what remains
    const useFull = new Uint8Array(m.itemCount);
    for (let i = 0; i < m.itemCount; i++) {
      const hidden = (m.states[i * 2] & IS_HIDDEN) !== 0;
      const clipped = isClipped(wb, i, clip);
      if (
        (hidden && cuts.dropHidden) ||
        (clipped && isClipCut(wb, i)) ||
        isCut(wb, i, dist[i], cuts, inView[i] === 1)
      ) {
        useFull[i] = ITEM_DROP;
      } else if (clipped) {
        useFull[i] = 0; // outside the clip: coarse, never full detail
      }
    }
    let acc = 0;
    let fullBudgetLimited = false;
    for (const i of order) {
      if (useFull[i] === ITEM_DROP || inView[i] !== 1 || m.states[i * 2] & IS_HIDDEN || !Number.isFinite(dist[i])) {
        continue;
      }
      if (acc + estBytes[i] > targetBytes) {
        fullBudgetLimited = true; // an in-view item wanted detail but the budget ran out
        continue; // one oversized item must not block the smaller ones behind it
      }
      useFull[i] = 1;
      acc += estBytes[i];
    }

    const { itemBounds: mixedBounds, ...packed } = packModelMixed(full, coarse, useFull);
    healItemBounds(m.itemBounds, mixedBounds);
    const packDropped = countMissingVisible(m, mixedBounds, clip);
    // a pack that was NOT budget-limited already contains every in-view item —
    // a bigger budget cannot grow it, so the caller must not re-pack on regrow
    return transferPacked({ ...packed, fullBudgetLimited, packDropped });
  },

  /** Coarse repack with the residency cuts applied: everything from the
   * coarse parse except tiny-and-far and (optionally) hidden items, which
   * are dropped entirely (out-of-frustum items cut harder). With the cuts
   * disabled this equals repackModel of the coarse file. */
  async repackModelCoarse(
    index: number,
    coarseBytes: ArrayBuffer,
    eye: readonly [number, number, number],
    cuts: ResidencyCuts,
    clip: Float32Array | null,
  ): Promise<Omit<PackedModel, 'itemBounds'> & { packDropped: number }> {
    const m = models[index];
    if (!m) {
      throw new Error(`repackModelCoarse: no model at index ${index}`);
    }
    const coarse = await parseModel(m.name, coarseBytes);
    if (coarse.itemCount !== m.itemCount) {
      throw new Error(`itemcount-mismatch: model ${index} has ${m.itemCount} items, variant has ${coarse.itemCount}`);
    }
    const wb = worldBoundsOf(m);
    const keep = new Uint8Array(m.itemCount).fill(1);
    for (let i = 0; i < m.itemCount; i++) {
      const hidden = (m.states[i * 2] & IS_HIDDEN) !== 0;
      // view-INDEPENDENT cuts: a coarse pack never re-packs on turn, so
      // frustum-dependent content would show as permanent holes. Clipping is
      // different — it is an explicit user action, and re-packs are triggered
      // when the clip changes.
      if (
        (hidden && cuts.dropHidden) ||
        (isClipped(wb, i, clip) && isClipCut(wb, i)) ||
        isCut(wb, i, boxDistSq(wb, i, eye), cuts, true)
      ) {
        keep[i] = 0; // no secondary source → dropped
      }
    }
    const { itemBounds: coarseBounds, ...packed } = packModelMixed(coarse, null, keep);
    healItemBounds(m.itemBounds, coarseBounds);
    return { ...transferPacked(packed), packDropped: countMissingVisible(m, coarseBounds, clip) };
  },

  /** Index of a TOMBSTONED model matching folder+name, else -1 (probe for
   * reload-in-place; complements hasModel, which sees only live models). */
  removedIndexForPath(name: string, group = name, store = ''): number {
    return models.findIndex((m) => m.removed === true && m.name === name && m.group === group && m.store === store);
  },

  /** Current interleaved item states for the given live models (re-push after
   * a slot revive recreated the GPU state buffer). */
  statesFor(indices: number[]): StateUpdate[] {
    const out: StateUpdate[] = [];
    for (const i of indices) {
      const m = models[i];
      if (!m || m.removed) {
        continue;
      }
      out.push(packStates(m, i));
    }
    return out;
  },

  clear() {
    models.length = 0;
    resetGlobalIndex();
    resetColorUndo();
    resetTransformUndo();
    resetTransformPool();
  },

  modelNames(): string[] {
    return models.filter((m) => !m.removed).map((m) => m.name);
  },

  /** Live model indices belonging to `store` (the store is part of model
   *  identity since two stores may hold identical structures). */
  indicesForStore(store: string): number[] {
    const out: number[] = [];
    models.forEach((m, i) => {
      if (!m.removed && m.store === store) {
        out.push(i);
      }
    });
    return out;
  },

  /** store per live model index — the hierarchy's plant-band mapping. */
  modelStores(): { index: number; store: string }[] {
    const out: { index: number; store: string }[] = [];
    models.forEach((m, i) => {
      if (!m.removed) {
        out.push({ index: i, store: m.store });
      }
    });
    return out;
  },

  /** Is a model with this file name already loaded in this folder/group?
   * Matches on group+name so two versions of the same model living in
   * different folders don't collide. Mirrors addModel's `group = name`. */
  hasModel(name: string, group = name, store = ''): boolean {
    return models.some((m) => !m.removed && m.name === name && m.group === group && m.store === store);
  },

  /** Scene-wide "dense" box: where ~80% of the geometry actually is. Per
   *  axis, take the size-weighted 10th–90th percentile of item CENTERS
   *  (weight = item diagonal, so physical size counts, not tessellation),
   *  then union the full AABBs of the items whose center survives on every
   *  axis. Computed ACROSS models, so a whole outlier file is trimmed the
   *  same way an outlier vertex is — per-file dense boxes cannot do that.
   *  `indices` limits the box to those models (batch-load fit); omitted =
   *  all live models. Null when there is nothing to frame. */
  sceneDenseBounds(indices?: number[]): { min: number[]; max: number[] } | null {
    const list = (indices ? indices.map((i) => models[i]) : models).filter((m) => m && !m.removed);
    let total = 0;
    for (const m of list) {
      total += m.itemCount;
    }
    if (total === 0) {
      return null;
    }
    const cx = new Float32Array(total);
    const cy = new Float32Array(total);
    const cz = new Float32Array(total);
    const cw = new Float32Array(total);
    const bounds: Float32Array[] = [];
    const itemModel = new Uint16Array(total);
    const itemIdx = new Uint32Array(total);
    let n = 0;
    let weightSum = 0;
    list.forEach((m, mi) => {
      bounds.push(m.itemBounds);
      for (let i = 0; i < m.itemCount; i++) {
        const b = m.itemBounds;
        const o = i * 6;
        if (!Number.isFinite(b[o]) || !Number.isFinite(b[o + 3])) {
          continue; // item without geometry
        }
        cx[n] = (b[o] + b[o + 3]) / 2;
        cy[n] = (b[o + 1] + b[o + 4]) / 2;
        cz[n] = (b[o + 2] + b[o + 5]) / 2;
        const w = Math.max(Math.hypot(b[o + 3] - b[o], b[o + 4] - b[o + 1], b[o + 5] - b[o + 2]), 1e-6);
        cw[n] = w;
        itemModel[n] = mi;
        itemIdx[n] = i;
        weightSum += w;
        n++;
      }
    });
    if (n === 0) {
      return null;
    }
    // few items → percentiles are noise; frame everything
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    const unionItem = (k: number) => {
      const b = bounds[itemModel[k]];
      const o = itemIdx[k] * 6;
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], b[o + a]);
        max[a] = Math.max(max[a], b[o + 3 + a]);
      }
    };
    if (n < 32) {
      for (let k = 0; k < n; k++) {
        unionItem(k);
      }
      return { min, max };
    }
    // per-axis weighted 10th/90th percentile of the centers
    const lo = [0, 0, 0];
    const hi = [0, 0, 0];
    const order = new Uint32Array(n);
    for (let axis = 0; axis < 3; axis++) {
      const c = axis === 0 ? cx : axis === 1 ? cy : cz;
      for (let k = 0; k < n; k++) {
        order[k] = k;
      }
      order.sort((a, b) => c[a] - c[b]);
      let acc = 0;
      let loV = c[order[0]];
      let hiV = c[order[n - 1]];
      let loSet = false;
      for (let k = 0; k < n; k++) {
        acc += cw[order[k]];
        if (!loSet && acc >= weightSum * 0.1) {
          loV = c[order[k]];
          loSet = true;
        }
        if (acc >= weightSum * 0.9) {
          hiV = c[order[k]];
          break;
        }
      }
      lo[axis] = loV;
      hi[axis] = hiV;
    }
    // union the full boxes of the surviving items so their extents count too
    let kept = 0;
    for (let k = 0; k < n; k++) {
      if (cx[k] >= lo[0] && cx[k] <= hi[0] && cy[k] >= lo[1] && cy[k] <= hi[1] && cz[k] >= lo[2] && cz[k] <= hi[2]) {
        unionItem(k);
        kept++;
      }
    }
    if (kept === 0 || !Number.isFinite(min[0])) {
      for (let k = 0; k < n; k++) {
        unionItem(k);
      }
    }
    return { min, max };
  },

  /** Display name + folder/group per model index (the TDP export mirrors the
   *  loaded structure into its output directory). */
  modelMetas(indices: number[]): { name: string; group: string }[] {
    return indices.map((i) => {
      const m = models[i];
      return m && !m.removed ? { name: m.name, group: m.group } : { name: `model-${i}`, group: '' };
    });
  },

  /** Live model indices for the given folder+name pairs (assets → unload).
   * Matches on group+name so unloading one folder's copy leaves another
   * folder's same-named model alone. */
  indicesForPaths(keys: { name: string; group: string; store?: string }[]): number[] {
    // a key WITH store matches only that store's copy; without, any store
    const want = new Set(keys.map((k) => `${k.store ?? '*'}\0${k.group}\0${k.name}`));
    const out: number[] = [];
    models.forEach((m, i) => {
      if (!m.removed && (want.has(`${m.store}\0${m.group}\0${m.name}`) || want.has(`*\0${m.group}\0${m.name}`))) {
        out.push(i);
      }
    });
    return out;
  },

  /** Tombstone models: indices stay stable (item ids / renderer slots keep
   *  lining up); removed models vanish from groups/names/roots. The per-item
   *  state is kept — a residency swap revives the slot with it intact; an
   *  explicit unload calls resetItemStates as well. */
  removeModels(indices: number[]) {
    for (const i of indices) {
      const m = models[i];
      if (!m) {
        continue;
      }
      m.removed = true;
      m.selected = new Uint32Array(0);
    }
  },

  /** Explicit unload: forget every per-item state (colors, opacity, hidden,
   *  item edges, transforms) so a later load of the same file comes back
   *  clean instead of reviving the old look with the slot. */
  resetItemStates(indices: number[]) {
    for (const i of indices) {
      const m = models[i];
      if (m) {
        resetItemStates(m);
      }
    }
  },

  /** Distinct import groups in load order (tree top level = folders). */
  groups(): { group: string; models: number[] }[] {
    const out: { group: string; models: number[] }[] = [];
    models.forEach((m, i) => {
      if (m.removed) {
        return;
      }
      const g = out.find((o) => o.group === m.group);
      if (g) {
        g.models.push(i);
      } else {
        out.push({ group: m.group, models: [i] });
      }
    });
    return out;
  },
};
