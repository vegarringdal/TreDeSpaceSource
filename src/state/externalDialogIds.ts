import { storageKey } from '../lib/storageKeys';

// Per-instance identity for external app iframes: `tdsDialogId`, a UUID the
// page finds on its URL. With it a page can key its own (partitioned)
// sessionStorage, or the viewer's `instance` blob, and pick up where it left
// off after a close → reopen. The map lives in the viewer's sessionStorage —
// the same lifetime as the page's own sessionStorage, so a reload in the same
// tab keeps the pairing. Pure apart from the injected store, so it is
// unit-tested with an in-memory one.

const KEY = storageKey('dialogIds');

export type DialogIdStore = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStore(): DialogIdStore | null {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
}

function readMap(store: DialogIdStore | null): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(store?.getItem(KEY) ?? '{}');
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string') {
        out[k] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function randomId(): string {
  return typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** The UUID for an instance key — `ext:<appId>` for a single-instance panel,
 *  `modal:<appId>` for a single-instance dialog, a restored multi-instance
 *  panel's own id — created on first use, then stable for the tab. */
export function dialogIdFor(instanceKey: string, store: DialogIdStore | null = defaultStore()): string {
  const map = readMap(store);
  const hit = map[instanceKey];
  if (hit) {
    return hit;
  }
  const id = randomId();
  map[instanceKey] = id;
  try {
    store?.setItem(KEY, JSON.stringify(map));
  } catch {
    // storage unavailable — the id still serves this open
  }
  return id;
}

/** A fresh UUID for a multi-instance dialog — every open is a new instance,
 *  so nothing to remember. */
export function freshDialogId(): string {
  return randomId();
}
