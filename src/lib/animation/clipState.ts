// -----------------------------------------------------------------------------
// animated clipping (DESIGN.md › Animation › Data model)
// -----------------------------------------------------------------------------
// Section keys hold the whole clipping (box, x/y/z planes, shapes). Between
// two keys it either switches at the later key ('hold') or glides: box centre /
// size / rotation and plane position / angles blend when both sides have the
// part switched on; anything structural (on/off, flipped, shapes) switches
// when the glide arrives. Pure.

import { interpEase, qSlerp } from './interp';
import type { ClipBoxState, ClipPlaneState, ClipStateValue, SectionKey, V3 } from './types';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp3 = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** Angle blend the short way round (degrees). */
function lerpDeg(a: number, b: number, t: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return a + d * t;
}

function blendBox(a: ClipBoxState, b: ClipBoxState, t: number): ClipBoxState {
  const both = a.enabled && b.enabled && a.boxOn && b.boxOn && a.inverted === b.inverted;
  if (!both) {
    return t >= 1 ? b : a;
  }
  return {
    ...b,
    center: lerp3(a.center, b.center, t),
    size: lerp3(a.size, b.size, t),
    rotation: qSlerp(a.rotation, b.rotation, t),
  };
}

function blendPlane(a: ClipPlaneState, b: ClipPlaneState, t: number): ClipPlaneState {
  if (!(a.enabled && b.enabled && a.flipped === b.flipped)) {
    return t >= 1 ? b : a;
  }
  return {
    ...b,
    position: lerp(a.position, b.position, t),
    el: lerpDeg(a.el, b.el, t),
    az: lerpDeg(a.az, b.az, t),
    anchor: a.anchor && b.anchor ? lerp3(a.anchor, b.anchor, t) : t >= 1 ? b.anchor : a.anchor,
  };
}

/** Two clip states blended at t (0 = a, 1 = b). */
export function blendClipState(a: ClipStateValue, b: ClipStateValue, t: number): ClipStateValue {
  return {
    box: blendBox(a.box, b.box, t),
    planes: {
      x: blendPlane(a.planes.x, b.planes.x, t),
      y: blendPlane(a.planes.y, b.planes.y, t),
      z: blendPlane(a.planes.z, b.planes.z, t),
    },
    shapes: t >= 1 ? b.shapes : a.shapes,
  };
}

/** Clipping at time T; null without keys. Held before the first and after
 *  the last key. */
export function sampleClipState(keys: readonly SectionKey[], T: number): ClipStateValue | null {
  if (keys.length === 0) {
    return null;
  }
  if (T <= keys[0].t) {
    return keys[0].value;
  }
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i];
    if (T < b.t) {
      const a = keys[i - 1];
      if (b.interp === 'hold') {
        return a.value;
      }
      const span = b.t - a.t;
      return blendClipState(a.value, b.value, interpEase(b.interp, span > 1e-9 ? (T - a.t) / span : 1));
    }
  }
  return keys[keys.length - 1].value;
}
