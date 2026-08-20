import { createStore } from '@treDeSpaceUI/lib/createStore';

/** Ribbon-local opacity values — promoted from component useState to a store so
 *  they persist across refresh and can be driven by hotkeys. */
export interface RibbonSelectionColorState {
  /** opacity applied together with a quick/custom color (0–100) */
  quickOpacity: number;
  /** the opacity-override value (0–100) */
  opacity: number;
  /** the Manual color picker's current color */
  customColor: string;
}

const DEFAULTS: RibbonSelectionColorState = { quickOpacity: 100, opacity: 10, customColor: '#e36414' };
const KEY = 'ribbonColor';

function load(): RibbonSelectionColorState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<RibbonSelectionColorState>) };
    }
  } catch {
    // defaults
  }
  return DEFAULTS;
}

export const ribbonSelectionColorState = createStore<RibbonSelectionColorState>(load());

ribbonSelectionColorState.subscribe(() => {
  try {
    localStorage.setItem(KEY, JSON.stringify(ribbonSelectionColorState.get()));
  } catch {
    // storage unavailable — non-fatal
  }
});
