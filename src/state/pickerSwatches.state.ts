import { createStore } from '@treDeSpaceUI/lib/createStore';
import { DEFAULT_PICKER_SWATCHES, setColorSelectSwatchesStore } from '@treDeSpaceUI/widgets';
import { storageKey } from '../lib/storageKeys';

// The default 8×4 grid lives with the ColorSelect widget; users override the
// colors in Settings → Editor and this store persists them.
export { DEFAULT_PICKER_SWATCHES };

const KEY = storageKey('pickerSwatches');

function load(): { colors: string[] } {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as string[];
      if (Array.isArray(saved)) {
        // pad/trim to the default length so the grid shape stays 8×4
        return { colors: DEFAULT_PICKER_SWATCHES.map((d, i) => saved[i] ?? d) };
      }
    }
  } catch {
    // defaults
  }
  return { colors: [...DEFAULT_PICKER_SWATCHES] };
}

export const pickerSwatchesState = createStore(load());

// Every ColorSelect (across all dockable React roots) defaults to this grid.
setColorSelectSwatchesStore(pickerSwatchesState);

pickerSwatchesState.subscribe(() => {
  try {
    localStorage.setItem(KEY, JSON.stringify(pickerSwatchesState.get().colors));
  } catch {
    // storage unavailable — non-fatal
  }
});

export const pickerSwatchesActions = {
  setColor(i: number, color: string) {
    pickerSwatchesState.set((s) => ({ colors: s.colors.map((c, k) => (k === i ? color : c)) }));
  },
  reset() {
    pickerSwatchesState.set({ colors: [...DEFAULT_PICKER_SWATCHES] });
  },
};
