import { createStore } from '@treDeSpaceUI/lib/createStore';

export const DEFAULT_QUICK_COLORS = [
  '#ef4444',
  '#3b82f6',
  '#16a34a',
  '#eab308',
  '#a855f7',
  '#14b8a6',
  '#f97316',
  '#27272a',
  '#ffffff',
  '#0ea5e9',
  '#84cc16',
  '#ec4899',
  '#78716c',
  '#facc15',
  '#6366f1',
];

const KEY = 'quickColors';

function load(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const arr = JSON.parse(raw) as string[];
      if (Array.isArray(arr) && arr.length > 0) {
        // palette grew since this was saved: keep the custom slots, pad the
        // rest with defaults (never discard a user's colors on upgrade)
        return DEFAULT_QUICK_COLORS.map((d, i) => (typeof arr[i] === 'string' ? arr[i] : d));
      }
    }
  } catch {
    // fall through to defaults
  }
  return [...DEFAULT_QUICK_COLORS];
}

export const quickColorsState = createStore<{ colors: string[] }>({ colors: load() });

export const quickColorsActions = {
  set(index: number, color: string) {
    const colors = [...quickColorsState.get().colors];
    colors[index] = color;
    quickColorsState.set({ colors });
    localStorage.setItem(KEY, JSON.stringify(colors));
  },
  resetOne(index: number) {
    quickColorsActions.set(index, DEFAULT_QUICK_COLORS[index]);
  },
  resetDefaults() {
    quickColorsState.set({ colors: [...DEFAULT_QUICK_COLORS] });
    localStorage.removeItem(KEY);
  },
};
