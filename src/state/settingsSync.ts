// Cross-instance settings sync: every settings store already persists to
// localStorage on change, and the browser broadcasts those writes to ALL OTHER
// same-origin tabs/windows as `storage` events (they never fire in the writing
// tab, and only when a value actually changes — so there is no echo loop).
// This module listens for those events and applies the new value into the
// matching store, so changing e.g. edge thresholds in one instance updates
// every open instance live (the viewport re-reads viewerState each frame).
//
// Deliberately NOT synced: Set Color rules and viewpoints (the viewpoint
// mute-swap rewrites them and would stomp other tabs' scenes), the auto layout
// (per-tab by design), hotkey overrides (the engine rebuild is local), and
// anything content-like (assets, labels, measurements).
import { exportState } from '../components/panels/export/export.state';
import { DEFAULT_QUICK_COLORS, quickColorsState } from '../components/panels/quick-colors/quickColors.state';
import { ribbonSelectionColorState } from '../components/panels/ribbon-selection-color/ribbonSelectionColor.state';
import { initTheme } from '../components/panels/settings/settings.actions';
import { settingsState } from '../components/panels/settings/settings.state';
import { apiSecurityState } from './apiSecurity.state';
import { externalAppsState } from './externalApps.state';
import { layoutsState } from './layouts.state';
import { DEFAULT_PICKER_SWATCHES, pickerSwatchesState } from './pickerSwatches.state';
import { gizmoLabelsState, mergeGizmoLabels } from './viewer/gizmoLabels.state';
import { navState } from './viewer/nav.state';
import { viewerState } from './viewer/viewer.state';

type Patch = Record<string, unknown>;
const parse = (raw: string | null): Patch | null => {
  if (raw == null) {
    return null;
  }
  try {
    const v = JSON.parse(raw) as unknown;
    return typeof v === 'object' && v !== null ? (v as Patch) : null;
  } catch {
    return null;
  }
};

/** One entry per synced localStorage key: apply the other tab's new value. */
const adapters: Record<string, (raw: string | null) => void> = {
  viewer: (raw) => {
    const p = parse(raw);
    if (!p) {
      return;
    }
    // camera mode and sketch are per-SESSION view states (each instance owns
    // its own view) — never let another tab's mode leak into this one
    delete p.orthographic;
    delete p.sketch;
    viewerState.set(p as Parameters<typeof viewerState.set>[0]);
  },
  settings: (raw) => {
    const p = parse(raw);
    if (!p) {
      return;
    }
    settingsState.set(p as Parameters<typeof settingsState.set>[0]);
    initTheme(); // the theme is a DOM attribute, not store-driven — re-push it
  },
  nav: (raw) => {
    const p = parse(raw);
    if (p) {
      navState.set(p as Parameters<typeof navState.set>[0]);
    }
  },
  export: (raw) => {
    const p = parse(raw);
    if (p) {
      exportState.set(p as Parameters<typeof exportState.set>[0]);
    }
  },
  apiSecurity: (raw) => {
    const p = parse(raw);
    if (p) {
      apiSecurityState.set(p as Parameters<typeof apiSecurityState.set>[0]);
    }
  },
  externalApps: (raw) => {
    const p = parse(raw);
    if (p && Array.isArray(p.apps)) {
      externalAppsState.set({ apps: p.apps });
    }
  },
  layouts: (raw) => {
    const p = parse(raw);
    if (p) {
      layoutsState.set(p as Parameters<typeof layoutsState.set>[0]);
    }
  },
  ribbonColor: (raw) => {
    const p = parse(raw);
    if (p) {
      ribbonSelectionColorState.set(p as Parameters<typeof ribbonSelectionColorState.set>[0]);
    }
  },
  // these three persist a bare object/array (not the store shape) and reset by
  // REMOVING the key — a null raw value means "back to defaults"
  gizmoLabels: (raw) => {
    gizmoLabelsState.set({ labels: mergeGizmoLabels(parse(raw) ?? {}) });
  },
  quickColors: (raw) => {
    const arr =
      raw == null
        ? []
        : ((): unknown[] => {
            try {
              const v = JSON.parse(raw) as unknown;
              return Array.isArray(v) ? v : [];
            } catch {
              return [];
            }
          })();
    quickColorsState.set({
      colors: DEFAULT_QUICK_COLORS.map((d, i) => (typeof arr[i] === 'string' ? (arr[i] as string) : d)),
    });
  },
  pickerSwatches: (raw) => {
    const arr =
      raw == null
        ? []
        : ((): unknown[] => {
            try {
              const v = JSON.parse(raw) as unknown;
              return Array.isArray(v) ? v : [];
            } catch {
              return [];
            }
          })();
    pickerSwatchesState.set({
      colors: DEFAULT_PICKER_SWATCHES.map((d, i) => (typeof arr[i] === 'string' ? (arr[i] as string) : d)),
    });
  },
};

// When THIS tab last wrote each synced key. An inbound storage event shortly
// after our own write is almost certainly an ECHO — another instance (possibly
// running an older build with a different field set) applied our write and
// persisted its own serialization back. Applying that echo would visibly
// revert the edit the user just made ("settings reset while you type"), so
// echoes are dropped instead.
const lastLocalWrite: Record<string, number> = {};
const ECHO_WINDOW_MS = 1000;

let installed = false;
export function initSettingsSync() {
  if (installed) {
    return;
  }
  installed = true;
  // observe this tab's own writes (the stores persist via localStorage.setItem)
  const origSetItem = localStorage.setItem.bind(localStorage);
  try {
    localStorage.setItem = (key: string, value: string) => {
      if (adapters[key]) {
        lastLocalWrite[key] = Date.now();
      }
      origSetItem(key, value);
    };
  } catch {
    // host object not patchable — the echo guard degrades gracefully
  }
  window.addEventListener('storage', (e) => {
    if (e.storageArea !== localStorage || e.key == null) {
      return;
    }
    const apply = adapters[e.key];
    if (!apply) {
      return;
    }
    if (Date.now() - (lastLocalWrite[e.key] ?? 0) < ECHO_WINDOW_MS) {
      return; // echo of our own write
    }
    try {
      apply(e.newValue);
      // Applying the patch makes OUR store persist its own serialization,
      // which can differ from the sender's (per-session fields, or version
      // skew between builds). Differing blobs ping-pong storage events, so
      // pin the sender's exact string back: both sides become byte-identical
      // and the next identical write fires no event — the loop dies.
      if (e.newValue != null) {
        origSetItem(e.key, e.newValue);
      }
    } catch {
      // a malformed value from another tab must never crash this one
    }
  });
}
