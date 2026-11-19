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
  /** Flip the vertical of the left-button mouse drag (look/orbit). */
  mouseInvertY: boolean;
  /** Arrow-key pan sensitivity multiplier. */
  keyPanSens: number;
  /** When movement keys wake the camera out of orbit, enter walk instead of fly. */
  keysDefaultWalk: boolean;
  /** SpaceMouse: turn-rate multiplier (move speed follows the fly/walk speed). */
  spaceLookSens: number;
  /** SpaceMouse: fraction of full deflection ignored around rest. */
  spaceDeadzone: number;
  /** SpaceMouse: act on the most-deflected axis only. */
  spaceDominant: boolean;
  spaceInvertPitch: boolean;
  spaceInvertYaw: boolean;
  spaceInvertForward: boolean;
  /** SpaceMouse: show the centre crosshair (the buttons' aim point) while in use. */
  spaceCrosshair: boolean;
  /** SpaceMouse: seconds the crosshair stays after the device goes still, then fades. */
  spaceCrosshairHoldSec: number;
}

export const NAV_DEFAULTS: NavState = {
  mode: 'fly',
  flySpeed: 6,
  flyShift: 18,
  walkSpeed: 4,
  walkShift: 10,
  orbitSens: 1,
  panSens: 3.5,
  mouseInvertY: false,
  keyPanSens: 0.3,
  keysDefaultWalk: false,
  spaceLookSens: 1,
  spaceDeadzone: 0.1,
  spaceDominant: false,
  spaceInvertPitch: false,
  spaceInvertYaw: false,
  spaceInvertForward: false,
  spaceCrosshair: true,
  spaceCrosshairHoldSec: 2.5,
};
const DEFAULTS = NAV_DEFAULTS;
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
  /** SpaceMouse moved while in orbit → fly (the SpaceMouse steers the eye; walk is kept). */
  spaceActivate: () => {
    if (navState.get().mode === 'orbit') {
      navState.set({ mode: 'fly' });
    }
  },
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
