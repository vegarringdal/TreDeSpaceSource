import { createStore } from '@treDeSpaceUI/lib/createStore';
import { storageKey } from '../../lib/storageKeys';

/** Camera navigation settings — fly vs walk mode and per-mode speeds
 *  (units/second), with a separate speed while Shift is held. Persisted. */
export interface NavState {
  mode: 'orbit' | 'fly' | 'walk';
  flySpeed: number;
  flyShift: number;
  walkSpeed: number;
  walkShift: number;
  /** Mouse sensitivity multipliers (1 = native feel). */
  orbitSens: number;
  panSens: number;
  /** Arrow-key pan sensitivity multiplier. */
  keyPanSens: number;
  /** When movement keys wake the camera out of orbit, enter walk instead of fly. */
  keysDefaultWalk: boolean;
}

const DEFAULTS: NavState = {
  mode: 'fly',
  flySpeed: 6,
  flyShift: 18,
  walkSpeed: 4,
  walkShift: 10,
  orbitSens: 1,
  panSens: 3.5,
  keyPanSens: 0.3,
  keysDefaultWalk: false,
};
const KEY = storageKey('nav');

function load(): NavState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<NavState>) };
    }
  } catch {
    // defaults
  }
  return DEFAULTS;
}

export const navState = createStore<NavState>(load());

navState.subscribe(() => {
  try {
    localStorage.setItem(KEY, JSON.stringify(navState.get()));
  } catch {
    // storage unavailable — non-fatal
  }
});

export const navActions = {
  reset: () => navState.set(DEFAULTS),
  update: (patch: Partial<NavState>) => navState.set(patch),
  setMode: (mode: NavState['mode']) => navState.set({ mode }),
  toggleMode: () => navState.set((s) => ({ mode: s.mode === 'fly' ? 'walk' : 'fly' })),
  /** WASD/QE pressed while in orbit → hop into fly (or walk, per setting). */
  keysActivate: () => navState.set((s) => (s.mode === 'orbit' ? { mode: s.keysDefaultWalk ? 'walk' : 'fly' } : s)),
  /** Orbit-style input (alt+click, wheel dolly, space+click) → back to orbit. */
  orbitActivate: () => navState.set((s) => (s.mode === 'orbit' ? s : { mode: 'orbit' })),
  /** Clamp-bump a numeric field (drives the number-input +/- hotkeys);
   *  sensitivities go down to 0.1, speeds stop at 0.5. */
  bump: (
    field: 'flySpeed' | 'flyShift' | 'walkSpeed' | 'walkShift' | 'orbitSens' | 'panSens' | 'keyPanSens',
    delta: number,
  ) =>
    navState.set((s) => {
      const min = field === 'orbitSens' || field === 'panSens' || field === 'keyPanSens' ? 0.1 : 0.5;
      return { [field]: Math.max(min, +(s[field] + delta).toFixed(2)) } as Partial<NavState>;
    }),
};
