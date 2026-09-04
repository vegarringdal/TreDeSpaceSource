import { createStore } from '@treDeSpaceUI/lib/createStore';
import { storageKey } from '../../../lib/storageKeys';

/** Editor preferences — plain JSON, persistable. */
export interface SettingsState {
  theme: 'dark' | 'light';
  /** WebGPU adapter preference — applied at page load (renderer init). */
  gpu: 'high-performance' | 'low-power' | 'fallback';
  autosave: string;
  modules: string[];
  snap: string;
}

export const SETTINGS_DEFAULTS: SettingsState = {
  theme: 'light',
  gpu: 'high-performance',
  autosave: '120',
  modules: ['animation', 'scripting'],
  snap: '0.25',
};
const DEFAULTS = SETTINGS_DEFAULTS;
const KEY = storageKey('settings');

function load(): SettingsState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<SettingsState>) };
    }
  } catch {
    // defaults
  }
  return DEFAULTS;
}

export const settingsState = createStore<SettingsState>(load());

/** The Settings panel's active vertical tab. A store (not local state) so a
 *  Layout slot can open Settings on a specific tab — e.g. slot "Panels" lands
 *  on Layouts. Not persisted; defaults to About. */
export const settingsTabState = createStore<{ tab: string }>({ tab: 'about' });

settingsState.subscribe(() => {
  try {
    localStorage.setItem(KEY, JSON.stringify(settingsState.get()));
  } catch {
    // storage unavailable — non-fatal
  }
});

/** The preference the CURRENT page booted with — a different selection needs
 *  a reload before it takes effect (the GPU device is baked into pipelines). */
export const bootGpu = settingsState.get().gpu;
