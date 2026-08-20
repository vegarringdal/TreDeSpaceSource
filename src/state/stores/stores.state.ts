// The SHARED store registry. A "store" is a named project that groups both
// cooked models (Model Assets panel) and SQLite databases (SQL Assets panel) —
// same name, same description, one list. It is persisted on its own in the
// OPFS root (`stores.json`) rather than inside model_assets/index.json, so
// neither panel owns it.
import { createStore } from '@treDeSpaceUI/lib/createStore';

/** The always-present default store. */
export const MAIN_STORE = 'main';

/** Reserved store for session-only temp imports (purged on next app start).
 *  A real directory under model_assets/, but NEVER in the registry — the
 *  Model Assets panel shows it as its own virtual section, and users cannot
 *  create a store with this name. */
export const TEMP_STORE = 'temp';

/** A store = a named group of assets (a project). "main" always exists and
 *  can't be removed. `name` is both the id and the collapsible title, and it
 *  is the real OPFS directory name under model_assets/ and sql_assets/. */
export interface StoreDef {
  name: string;
  description: string;
}

export interface StoresState {
  /** Stores in display order — 'main' is always first and permanent. */
  stores: StoreDef[];
  /** stores.json has been read from OPFS. */
  ready: boolean;
}

export const storesState = createStore<StoresState>({
  stores: [{ name: MAIN_STORE, description: '' }],
  ready: false,
});

/** Sanitize a user-typed store name into a stable id/title. It doubles as a
 *  directory name, so path separators are folded away. */
export function normalizeStoreName(raw: string): string {
  return raw
    .trim()
    .replace(/[/\\]+/g, '-')
    .slice(0, 60);
}

/** True when `name` is an existing store. */
export function storeExists(name: string): boolean {
  return storesState.get().stores.some((st) => st.name === name);
}
