// The Navisworks import's mesh simplification settings, as the Import NWD
// section offers them. Pure data + math — shared by the import options, the
// hotkeys and the worker.

/** Range of "Keep": the lowest percentage of a part's triangles the
 *  simplifier may leave (the checkbox covers "keep everything"). */
export const NWD_KEEP_MIN = 5;
export const NWD_KEEP_MAX = 95;
export const NWD_KEEP_STEP = 5;

/** Range of "Max error": how far the surface may move, as a percentage of
 *  each part's size (0 = only triangles that change nothing). */
export const NWD_ERROR_MIN = 0;
export const NWD_ERROR_MAX = 5;
export const NWD_ERROR_STEP = 0.1;

/** The simplification part of the import options. */
export type NwdSimplify = Readonly<{
  simplify: boolean;
  /** Percent, NWD_KEEP_MIN..NWD_KEEP_MAX. */
  simplifyKeep: number;
  /** Percent of the part's size, NWD_ERROR_MIN..NWD_ERROR_MAX. */
  simplifyError: number;
}>;

/** The converter's meshopt pair for the settings: `threshold` is the fraction
 *  of indices to keep (1 = the pass is skipped), `targetError` the error
 *  budget relative to the part's extent. */
export function nwdMeshoptOptions(opts: NwdSimplify): { threshold: number; targetError: number } {
  if (!opts.simplify) {
    return { threshold: 1, targetError: 0 };
  }

  return { threshold: opts.simplifyKeep / 100, targetError: opts.simplifyError / 100 };
}

/** "Keep" one step up (`dir` 1) or down (-1), clamped to its range. */
export function stepNwdKeep(keep: number, dir: 1 | -1): number {
  return Math.min(NWD_KEEP_MAX, Math.max(NWD_KEEP_MIN, keep + dir * NWD_KEEP_STEP));
}

/** "Max error" one step up or down, clamped — rounded to the step's one
 *  decimal so repeated 0.1 steps do not drift. */
export function stepNwdError(error: number, dir: 1 | -1): number {
  const next = Math.round((error + dir * NWD_ERROR_STEP) * 10) / 10;

  return Math.min(NWD_ERROR_MAX, Math.max(NWD_ERROR_MIN, next));
}
