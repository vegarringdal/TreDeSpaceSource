// A clipping plane as the ribbon stores it (elevation/azimuth, a signed
// offset from an anchor, a flip) turned into the world half-space the shader
// keeps: n·p + d ≥ 0. Shared by the clip uniform packer, the plane gizmo and
// the clip-aware fit so they never disagree on which side survives.
import type { V3 } from './quat';

export interface PlaneSpec {
  el: number;
  az: number;
  position: number;
  /** cut the other side (negates the normal) */
  flipped: boolean;
  /** null = the scene centre */
  anchor: V3 | null;
}

export interface HalfSpace {
  n: V3;
  d: number;
}

export interface WorldPlane extends HalfSpace {
  /** the un-flipped normal — where the gizmo handle and helper marker point */
  n0: V3;
  point: V3;
}

const DEG = Math.PI / 180;

/** Unit vector for an elevation/azimuth pair in degrees, Z up. */
export function sph(elDeg: number, azDeg: number): V3 {
  const el = elDeg * DEG;
  const az = azDeg * DEG;
  return [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];
}

/** Centre of the renderer's scene box — the default plane anchor — or the
 *  origin before anything is loaded (the box is ±Infinity then). */
export function sceneCenterOf(bounds: { min: ArrayLike<number>; max: ArrayLike<number> }): V3 {
  const { min, max } = bounds;
  if (!Number.isFinite(min[0])) {
    return [0, 0, 0];
  }
  return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
}

/** The plane point is anchor (or the scene centre) + n0·position; `flipped`
 *  negates the normal so the other side is kept. */
export function planeWorld(pl: PlaneSpec, sceneCenter: V3): WorldPlane {
  const n0 = sph(pl.el, pl.az);
  const base = pl.anchor ?? sceneCenter;
  const point: V3 = [base[0] + n0[0] * pl.position, base[1] + n0[1] * pl.position, base[2] + n0[2] * pl.position];
  const n: V3 = pl.flipped ? [-n0[0], -n0[1], -n0[2]] : n0;
  return { n0, point, n, d: -(n[0] * point[0] + n[1] * point[1] + n[2] * point[2]) };
}
