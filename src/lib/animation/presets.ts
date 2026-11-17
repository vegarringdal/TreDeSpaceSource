// -----------------------------------------------------------------------------
// camera orbit (DESIGN.md › Animation › Authoring)
// -----------------------------------------------------------------------------
// A one-turn orbit as plain camera keys — everything stays editable on the
// Timeline's Camera row.

import type { AnimCamera, CameraKey } from './types';

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

/** One orbit: its length and how many camera keys carry it. */
export const ORBIT_S = 8;
export const ORBIT_STEPS = 8;

// -----------------------------------------------------------------------------
// public api
// -----------------------------------------------------------------------------

/** One full turn around the view's target from `start`, starting at `t0`,
 *  at an even speed — a key every 1/`steps` turn, so each glide takes the
 *  short way round. */
export function orbitKeys(start: AnimCamera, t0 = 0, seconds = ORBIT_S, steps = ORBIT_STEPS): CameraKey[] {
  return Array.from({ length: steps + 1 }, (_, i) => ({
    t: t0 + (seconds * i) / steps,
    view: {
      ...start,
      target: [start.target[0], start.target[1], start.target[2]],
      azimuth: start.azimuth + (2 * Math.PI * i) / steps,
    },
    interp: 'linear',
  }));
}
