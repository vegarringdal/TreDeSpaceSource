// -----------------------------------------------------------------------------
// global fullname index
// -----------------------------------------------------------------------------
// ONE map across all models (600k-record tag lists resolve in O(records), not
// O(records × models)). A hit packs (model, entry) into a double — exact,
// both fit 2^32. Values: a single packed hit, or an array in ascending model
// order (at most one hit per model — first occurrence wins, like the old
// per-model index). Built incrementally as models load; tombstoned models are
// skipped at READ time. An explicit unload (forgetModels) drops the model's
// hits so its name strings can be collected, and a revive of such a slot
// re-inserts them (sorted, so first-model-wins still holds).
import { models } from './dbState';
import { ensureNames } from './hierarchyIndex';

const HIT_PACK = 2 ** 32;
export const hitModel = (p: number): number => Math.floor(p / HIT_PACK);
export const hitEntry = (p: number): number => p % HIT_PACK;
const globalNameIndex = new Map<string, number | number[]>();
let globalIndexedCount = 0; // models[0..count) are merged (models is append-only)

/** Insert `packed` for `name` keeping ascending model order; a model already
 *  present under the name keeps its first occurrence. */
function insertHit(name: string, packed: number): void {
  const mi = hitModel(packed);
  const cur = globalNameIndex.get(name);
  if (cur === undefined) {
    globalNameIndex.set(name, packed);
    return;
  }
  if (typeof cur === 'number') {
    const cm = hitModel(cur);
    if (cm !== mi) {
      globalNameIndex.set(name, cm < mi ? [cur, packed] : [packed, cur]);
    }
    return;
  }
  let at = cur.length;
  for (let i = 0; i < cur.length; i++) {
    const cm = hitModel(cur[i]);
    if (cm === mi) {
      return;
    }
    if (cm > mi) {
      at = i;
      break;
    }
  }
  cur.splice(at, 0, packed);
}

function indexModel(mi: number): void {
  const m = models[mi];
  if (!m || m.removed) {
    return;
  }
  const names = ensureNames(m);
  for (let e = 0; e < names.length; e++) {
    insertHit(names[e], mi * HIT_PACK + e);
  }
}

export function ensureGlobalIndex(): void {
  for (; globalIndexedCount < models.length; globalIndexedCount++) {
    indexModel(globalIndexedCount);
  }
}

/** Remove every hit of model `mi` (explicit unload). O(index size) — runs
 *  once per unload, never per query. */
export function dropModelFromGlobalIndex(mi: number): void {
  for (const [name, v] of globalNameIndex) {
    if (typeof v === 'number') {
      if (hitModel(v) === mi) {
        globalNameIndex.delete(name);
      }
      continue;
    }
    const kept = v.filter((p) => hitModel(p) !== mi);
    if (kept.length === v.length) {
      continue;
    }
    if (kept.length === 0) {
      globalNameIndex.delete(name);
    } else if (kept.length === 1) {
      globalNameIndex.set(name, kept[0]);
    } else {
      globalNameIndex.set(name, kept);
    }
  }
}

/** Re-index a slot revived after forgetModels. The incremental build has
 *  already passed a lower slot, so it is merged here; a slot the build has not
 *  reached yet is picked up by ensureGlobalIndex as usual. */
export function indexRevivedModel(mi: number): void {
  if (mi < globalIndexedCount) {
    indexModel(mi);
  }
}

/** First hit in a live (non-removed) model — ascending order = first-model-wins. */
export function firstLiveHit(nameLower: string): number | undefined {
  const v = globalNameIndex.get(nameLower);
  if (v === undefined) {
    return undefined;
  }
  if (typeof v === 'number') {
    return models[hitModel(v)].removed ? undefined : v;
  }
  for (const p of v) {
    if (!models[hitModel(p)].removed) {
      return p;
    }
  }
  return undefined;
}

/** Every live-model hit for a name (rules apply in ALL models that contain it). */
export function liveHits(nameLower: string, out: (packed: number) => void): void {
  const v = globalNameIndex.get(nameLower);
  if (v === undefined) {
    return;
  }
  if (typeof v === 'number') {
    if (!models[hitModel(v)].removed) {
      out(v);
    }
    return;
  }
  for (const p of v) {
    if (!models[hitModel(p)].removed) {
      out(p);
    }
  }
}

/** Drop the whole index (scene clear). */
export function resetGlobalIndex(): void {
  globalNameIndex.clear();
  globalIndexedCount = 0;
}
