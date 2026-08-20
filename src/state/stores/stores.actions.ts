// Actions on the shared store registry: create / describe / delete a project.
// Creating a store makes its two real OPFS directories; deleting one removes
// them recursively (models AND databases) and prunes the model index.
import { consoleActions } from '../../components/panels/console/console.actions';
import {
  deleteLegacyManualAssets,
  modelAssetsDir,
  modelStoreDir,
  readJson,
  removeStoreDirs,
  rootDir,
  sqlStoreDir,
  wipeLegacyFlatAssets,
  writeJson,
} from '../../lib/opfs/opfs';
import { assetsActions } from '../assets/assets.actions';
import { sqlAssetsActions } from '../sqlAssets/sqlAssets.actions';
import { MAIN_STORE, normalizeStoreName, type StoreDef, storesState, TEMP_STORE } from './stores.state';

const STORES = 'stores.json';

interface StoredStores {
  stores?: StoreDef[];
}

async function persist() {
  await writeJson(await rootDir(), STORES, { stores: storesState.get().stores });
}

/** Make sure 'main' exists and comes first. */
function withMain(stores: StoreDef[]): StoreDef[] {
  return stores.some((st) => st.name === MAIN_STORE) ? stores : [{ name: MAIN_STORE, description: '' }, ...stores];
}

export const storesActions = {
  /** Read stores.json once (either panel's mount). On the first run after the
   *  layout change the registry is seeded from the old model_assets/index.json
   *  — the store NAMES survive even though the flat asset files do not. */
  async init() {
    if (storesState.get().ready) {
      return;
    }
    await deleteLegacyManualAssets();
    const idx = await readJson<StoredStores>(await rootDir(), STORES);
    let stores = idx?.stores ?? [];
    if (!stores.length) {
      // first run on the new layout — carry the names over, then wipe the
      // flat library (files + index.json) the old layout left behind
      const legacy = await readJson<StoredStores>(await modelAssetsDir(), 'index.json');
      stores = legacy?.stores ?? [];
    }
    await wipeLegacyFlatAssets();
    storesState.set({ stores: withMain(stores), ready: true });
    // (re)create the directories so both panels can list them straight away
    for (const st of storesState.get().stores) {
      await modelStoreDir(st.name);
      await sqlStoreDir(st.name);
    }
    await persist();
  },

  /** Create a store (Admin, either panel). Name is sanitized; duplicates and
   *  'main' are no-ops. Both real directories are created up front. */
  async addStore(rawName: string, description = '') {
    const name = normalizeStoreName(rawName);
    if (!name || name === TEMP_STORE) {
      return; // 'temp' is reserved for session-only imports
    }
    if (storesState.get().stores.some((st) => st.name === name)) {
      return;
    }
    await modelStoreDir(name);
    await sqlStoreDir(name);
    storesState.set((s) => ({ stores: [...s.stores, { name, description }] }));
    await persist();
    consoleActions.log('info', `Stores: created store "${name}"`);
  },

  async updateStore(name: string, patch: Partial<StoreDef>) {
    storesState.set((s) => ({ stores: s.stores.map((st) => (st.name === name ? { ...st, ...patch } : st)) }));
    await persist();
  },

  /** Delete a store: its model files, its databases and both directories go.
   *  'main' can't be deleted. */
  async removeStore(name: string) {
    if (name === MAIN_STORE) {
      return;
    }
    await assetsActions.forgetStore(name);
    await removeStoreDirs(name);
    storesState.set((s) => ({ stores: s.stores.filter((st) => st.name !== name) }));
    await persist();
    await sqlAssetsActions.refresh();
    consoleActions.log('warn', `Stores: deleted store "${name}" (models and databases)`);
  },
};
