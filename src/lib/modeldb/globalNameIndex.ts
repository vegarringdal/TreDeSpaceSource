// -----------------------------------------------------------------------------
// global fullname index
// -----------------------------------------------------------------------------
// ONE map across all models (600k-record tag lists resolve in O(records), not
// O(records × models)). A hit packs (model, entry) into a double — exact,
// both fit 2^32. Values: a single packed hit, or an array in ascending model
// order (at most one hit per model — first occurrence wins, like the old
// per-model index). Built incrementally as models load; tombstoned models are
// skipped at READ time, so removeModels needs no invalidation.
import { models } from './dbState';
import { ensureNames } from './hierarchyIndex';

const HIT_PACK = 2 ** 32;
export const hitModel = (p: number): number => Math.floor(p / HIT_PACK);
export const hitEntry = (p: number): number => p % HIT_PACK;
const globalNameIndex = new Map<string, number | number[]>();
let globalIndexedCount = 0; // models[0..count) are merged (models is append-only)

export function ensureGlobalIndex(): void {
  for (; globalIndexedCount < models.length; globalIndexedCount++) {
    const mi = globalIndexedCount;
    const m = models[mi];
    if (m.removed) {
      continue;
    }
    const names = ensureNames(m);
    for (let e = 0; e < names.length; e++) {
      const packed = mi * HIT_PACK + e;
      const cur = globalNameIndex.get(names[e]);
      if (cur === undefined) {
        globalNameIndex.set(names[e], packed);
      } else if (typeof cur === 'number') {
        if (hitModel(cur) !== mi) {
          globalNameIndex.set(names[e], [cur, packed]);
        }
      } else if (hitModel(cur[cur.length - 1]) !== mi) {
        cur.push(packed);
      }
    }
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
