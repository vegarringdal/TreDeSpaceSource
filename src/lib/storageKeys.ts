// Every viewer localStorage / sessionStorage key carries the `tds:` prefix, so
// a host page that shares the origin (the viewer proxied under a path of the
// host's own site) never collides with it, and the viewer's resets can be
// scoped to its own keys. Pure — no store imports — so it is unit-tested.

export const STORAGE_PREFIX = 'tds:';

/** Every persisted name — a store must be listed here to get a key, so the
 *  one-time legacy copy and the scoped resets cover it. */
export const VIEWER_STORAGE_NAMES = [
  'settings',
  'viewer',
  'nav',
  'layouts',
  'hotkeys',
  'externalApps',
  'apiSecurity',
  'export',
  'quickColors',
  'ribbonColor',
  'ribbonMeasurements',
  'pickerSwatches',
  'gizmoLabels',
  'globalReset',
  'opfsLayout',
  'dialogIds',
  // reset placeholders (globalReset.ts) with no store behind them yet
  'viewpoints',
  'labels',
  'sqlReports',
] as const;
export type ViewerStorageName = (typeof VIEWER_STORAGE_NAMES)[number];

/** Marker: the pre-prefix values have been copied once. */
const MIGRATED_KEY = `${STORAGE_PREFIX}migrated`;

export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

function safeLocalStorage(): KeyValueStore | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

export function storageKey(name: ViewerStorageName): string {
  return `${STORAGE_PREFIX}${name}`;
}

/** The name behind a viewer key, or null for a key that is not the viewer's. */
export function storageName(key: string): ViewerStorageName | null {
  if (!key.startsWith(STORAGE_PREFIX)) {
    return null;
  }
  const name = key.slice(STORAGE_PREFIX.length);
  return VIEWER_STORAGE_NAMES.find((n) => n === name) ?? null;
}

/** One-time copy of the pre-prefix values (app ≤ 0.0.84 wrote bare names
 *  such as `settings`) into their `tds:` keys, so an existing install keeps
 *  its settings. Runs once per origin — a marker key records it — and never
 *  again, so a later reset of a prefixed key is not undone by re-copying a
 *  stale value. The legacy keys are left in place: on a shared origin they
 *  may be the host's. Returns how many values were copied. */
export function migrateLegacyStorage(storage: KeyValueStore | null = safeLocalStorage()): number {
  try {
    if (!storage || storage.getItem(MIGRATED_KEY) !== null) {
      return 0;
    }
    let copied = 0;
    for (const name of VIEWER_STORAGE_NAMES) {
      const key = storageKey(name);
      if (storage.getItem(key) !== null) {
        continue;
      }
      const legacy = storage.getItem(name);
      if (legacy === null) {
        continue;
      }
      storage.setItem(key, legacy);
      copied++;
    }
    storage.setItem(MIGRATED_KEY, '1');
    return copied;
  } catch {
    return 0;
  }
}

/** Every key of the viewer's in the store (prefix match). */
export function viewerStorageKeys(storage: KeyValueStore | null = safeLocalStorage()): string[] {
  const out: string[] = [];
  if (!storage) {
    return out;
  }
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k?.startsWith(STORAGE_PREFIX)) {
      out.push(k);
    }
  }
  return out;
}

/** Remove the viewer's keys and nothing else — what "Clear all local data"
 *  does to localStorage. The migration marker is kept, so the legacy values
 *  are not copied back in on the next launch. */
export function clearViewerStorage(storage: KeyValueStore | null = safeLocalStorage()): number {
  const keys = viewerStorageKeys(storage);
  try {
    for (const k of keys) {
      storage?.removeItem(k);
    }
    storage?.setItem(MIGRATED_KEY, '1');
  } catch {
    // storage unavailable — non-fatal
  }
  return keys.length;
}
