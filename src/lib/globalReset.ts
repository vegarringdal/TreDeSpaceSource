// Startup config reset — a deliberate "drop stale local data on breaking change"
// switch for the current fast-moving phase (no real migrations yet).
//
// Imported FIRST in main.tsx (before App) so the wipes run BEFORE any state
// store reads localStorage.
//
// Each part below carries a reset TOKEN (a version string). We remember, per
// part, the token last applied (localStorage `globalReset`). On startup a part
// whose remembered token != the token here is reset, then the token is stored.
// So: bump a part's token whenever a change makes its stored data incompatible,
// and it resets once on the next launch. Clients with no `globalReset` state
// (i.e. the first launch after this ships) reset every listed part.
//
// Saved files that no longer match the reset config may be left behind — that's
// accepted for now; a proper migration step comes once things settle.

import { migrateLegacyStorage, storageKey } from './storageKeys';

/** part → its current reset token. Bump a token to force that part to reset. */
export const GLOBAL_RESET: Record<string, string> = {
  layout: '0.0.11',
  setting: '0.0.11',
  external: '0.0.11',
  sqlAssets: '0.0.11',
  modelAssets: '0.0.11',
  viewPoints: '0.0.11',
  labels: '0.0.11',
  sqlReports: '0.0.11',
};

/** localStorage record of the token last applied per part. */
const STATE_KEY = storageKey('globalReset');

// Where each part lives. `local` = localStorage keys, wiped synchronously before
// the stores load. `opfs` = top-level OPFS directories, wiped asynchronously.
const LOCAL_KEYS: Record<string, string[]> = {
  layout: [storageKey('layouts')],
  // mirrors the "Reset all settings" scope: viewer + nav + gizmo + editor + shortcuts
  setting: [
    storageKey('settings'),
    storageKey('viewer'),
    storageKey('nav'),
    storageKey('gizmoLabels'),
    storageKey('pickerSwatches'),
    storageKey('hotkeys'),
  ],
  external: [storageKey('externalApps'), storageKey('apiSecurity')],
  viewPoints: [storageKey('viewpoints')],
  // labels have no standalone store today (they ride inside viewpoints) — the
  // key is a placeholder so the mechanism is ready if that changes.
  labels: [storageKey('labels')],
  // SQL reports live in OPFS under sql_assets/<store>/ — cleared with sqlAssets;
  // the key is a placeholder for any future localStorage-side report state.
  sqlReports: [storageKey('sqlReports')],
};
const OPFS_DIRS: Record<string, string[]> = {
  modelAssets: ['model_assets'],
  sqlAssets: ['sql_assets'],
};

function readState(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

async function clearOpfsDirs(dirs: string[]): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    for (const d of dirs) {
      try {
        await root.removeEntry(d, { recursive: true });
      } catch {
        // directory absent — nothing to clear
      }
    }
  } catch {
    // OPFS unavailable — nothing to clear
  }
}

// Run immediately, at import time — before App's state modules load.
(() => {
  // app ≤ 0.0.84 wrote bare key names — copy them under the tds: prefix once
  migrateLegacyStorage();
  const applied = readState();
  const opfsDirs = new Set<string>();
  let changed = false;

  for (const [part, token] of Object.entries(GLOBAL_RESET)) {
    if (applied[part] === token) {
      continue; // already reset at this token
    }
    for (const k of LOCAL_KEYS[part] ?? []) {
      try {
        localStorage.removeItem(k);
      } catch {
        // storage unavailable — non-fatal
      }
    }
    for (const d of OPFS_DIRS[part] ?? []) {
      opfsDirs.add(d);
    }
    applied[part] = token;
    changed = true;
  }

  if (changed) {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(applied));
    } catch {
      // storage unavailable — non-fatal
    }
  }
  if (opfsDirs.size) {
    void clearOpfsDirs([...opfsDirs]);
  }
})();
