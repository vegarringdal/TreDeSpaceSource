import { createStore } from '@treDeSpaceUI/lib/createStore';

export interface RibbonMeasurementsState {
  tool: 'off' | 'point' | 'line' | 'path' | 'area' | 'diameter' | 'angle' | 'face';
  /** Leaving the Measurements ribbon (another ribbon tab, or a layout slot
   *  switch) puts the tool back to Off — so a measurement mode never lingers
   *  invisibly while the user works elsewhere. Default on; persisted. */
  offOnRibbonSwitch: boolean;
}

const KEY = 'ribbonMeasurements';

function load(): RibbonMeasurementsState {
  const fallback: RibbonMeasurementsState = { tool: 'off', offOnRibbonSwitch: true };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      return fallback;
    }
    const saved = JSON.parse(raw) as Partial<RibbonMeasurementsState>;
    // the tool itself is session state — only the preference is restored
    return { ...fallback, offOnRibbonSwitch: saved.offOnRibbonSwitch !== false };
  } catch {
    return fallback;
  }
}

export const ribbonMeasurementsState = createStore<RibbonMeasurementsState>(load());

ribbonMeasurementsState.subscribe(() => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ offOnRibbonSwitch: ribbonMeasurementsState.get().offOnRibbonSwitch }));
  } catch {
    // storage unavailable — non-fatal
  }
});
