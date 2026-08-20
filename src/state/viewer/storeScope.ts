import { useEffect, useState } from 'react';
import { assetsState, groupOf } from '../assets/assets.state';
import { storesState, TEMP_STORE } from '../stores/stores.state';
import { db } from './db';
import { selectionState } from './selection.state';

/**
 * Worker model indices of the LOADED models belonging to `store` — the
 * scoping set for store-filtered color-rule runs and label resolves. A store
 * with nothing loaded returns [] (scoped operations then match nothing).
 */
export async function loadedIndicesForStore(store: string): Promise<number[]> {
  const entries = assetsState.get().assets.filter((a) => a.store === store);
  if (entries.length === 0) {
    return [];
  }
  return db.indicesForPaths(entries.map((a) => ({ name: a.name, group: groupOf(a), store: a.store })));
}

/**
 * Store (plant) names with at least one LOADED model, registry order (temp
 * last) — for pickers that should only offer stores present in the scene.
 */
export function useLoadedStores(): string[] {
  const { modelsVersion } = selectionState.use();
  const { stores } = storesState.use();
  const [loaded, setLoaded] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    void db.modelStores().then((ms) => {
      if (!alive) {
        return;
      }
      const present = new Set(ms.map((m) => m.store));
      setLoaded([...stores.map((st) => st.name), TEMP_STORE].filter((st) => present.has(st)));
    });
    return () => {
      alive = false;
    };
  }, [stores, modelsVersion]);

  return loaded;
}
