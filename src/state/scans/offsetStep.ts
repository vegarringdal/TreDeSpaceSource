// The step of the scan-offset boxes and hotkeys: how far one − / + moves a
// scan. Pure — the value lives in scans.state.ts.

/** Step the offset boxes start with, metres. */
export const DEFAULT_OFFSET_STEP = 0.1;
/** Smallest step: offsets are kept to the millimetre. */
export const MIN_OFFSET_STEP = 0.001;
export const MAX_OFFSET_STEP = 1000;

const round3 = (v: number) => Math.round(v * 1000) / 1000;
/** Tolerance of `decade` for a power of ten that float maths left a hair low. */
const DECADE_EPSILON = 1e-9;
/** Factor that takes a value clearly below itself for `decade` (well beyond
 *  DECADE_EPSILON), without reaching the next step down. */
const JUST_BELOW = 1 - 1e-6;

/** The power of ten at or below `v` (0.25 → 0.1, 30 → 10). */
function decade(v: number): number {
  return 10 ** Math.floor(Math.log10(v) + DECADE_EPSILON);
}

/** A step within its range, to the millimetre. */
export function clampOffsetStep(v: number): number {
  return Math.min(MAX_OFFSET_STEP, Math.max(MIN_OFFSET_STEP, round3(v)));
}

/**
 * The next step up or down, counting like an odometer so every useful size
 * is a few presses away: 0.1 → 0.2 … 0.9 → 1 → 2 going up, 0.1 → 0.09 … 0.01
 * → 0.009 going down — a tenth of the current magnitude each press.
 */
export function nextOffsetStep(value: number, direction: 1 | -1): number {
  const v = clampOffsetStep(value);
  // going down from an exact power of ten continues in the decade below
  const by = direction > 0 ? decade(v) : decade(v * JUST_BELOW);
  return clampOffsetStep(v + direction * by);
}

/** What one + on the step box itself adds (see nextOffsetStep). */
export function offsetStepIncrement(value: number): number {
  return decade(clampOffsetStep(value));
}
