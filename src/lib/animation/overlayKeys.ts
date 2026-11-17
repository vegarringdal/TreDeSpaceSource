// -----------------------------------------------------------------------------
// callout position keys (DESIGN.md › Animation › Overlays)
// -----------------------------------------------------------------------------
// A callout's keyed placement over time: held before the first key and
// after the last, eased in between. Pure.

import { interpEase } from './interp';
import type { CalloutKey, V2 } from './types';

/** Placement at `t` seconds after the callout's start; null without keys. */
export function sampleOverlayPlace(keys: readonly CalloutKey[] | undefined, t: number): V2 | null {
  if (!keys || keys.length === 0) {
    return null;
  }
  if (t <= keys[0].t) {
    return [...keys[0].at];
  }
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i];
    if (t <= b.t) {
      const a = keys[i - 1];
      const span = b.t - a.t;
      const e = interpEase(b.interp, span > 1e-9 ? (t - a.t) / span : 1);
      return [a.at[0] + (b.at[0] - a.at[0]) * e, a.at[1] + (b.at[1] - a.at[1]) * e];
    }
  }
  return [...keys[keys.length - 1].at];
}
