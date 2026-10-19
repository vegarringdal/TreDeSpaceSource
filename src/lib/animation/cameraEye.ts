// -----------------------------------------------------------------------------
// camera key points (DESIGN.md › Animation › Authoring)
// -----------------------------------------------------------------------------
// A camera key stores an orbit pose — target, azimuth, elevation, distance —
// the way the viewer's camera does; the Key panel shows it as two points, the
// target and where the eye is, and turns typed points back into the pose.
// Same convention as Camera.forward() / eye(): forward = (cos el · cos az,
// cos el · sin az, sin el), eye = target − forward · distance. Pure.

import type { AnimCamera, V3 } from './types';

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

/** The viewer clamps elevation to ±89° (straight up / down has no azimuth). */
const EL_MAX = (89 * Math.PI) / 180;
/** Closer than this the eye and target are one point (no direction). */
const MIN_DISTANCE = 1e-4;

// -----------------------------------------------------------------------------
// public api
// -----------------------------------------------------------------------------

/** Where the eye of a camera pose is. */
export function eyeOf(view: AnimCamera): V3 {
  const ce = Math.cos(view.elevation);
  const f: V3 = [ce * Math.cos(view.azimuth), ce * Math.sin(view.azimuth), Math.sin(view.elevation)];
  return [
    view.target[0] - f[0] * view.orbitDistance,
    view.target[1] - f[1] * view.orbitDistance,
    view.target[2] - f[2] * view.orbitDistance,
  ];
}

/** The pose looking from `eye` at `target` (its other fields kept); null
 *  when the two points are one. Elevation is clamped like the viewer's. */
export function viewFromPoints(view: AnimCamera, eye: V3, target: V3): AnimCamera | null {
  const d: V3 = [target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]];
  const distance = Math.hypot(d[0], d[1], d[2]);
  if (distance < MIN_DISTANCE) {
    return null;
  }
  const elevation = Math.max(-EL_MAX, Math.min(EL_MAX, Math.asin(d[2] / distance)));
  const azimuth = Math.hypot(d[0], d[1]) > 0 ? Math.atan2(d[1], d[0]) : view.azimuth;
  return { ...view, target: [...target], azimuth, elevation, orbitDistance: distance };
}
