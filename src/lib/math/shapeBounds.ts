// World-AABB vs clip-volume tests behind "Select Inside / Select Intersecting"
// (Selection Color ribbon → Clipping Shape Select). Items carry a world AABB;
// the volumes are the default clipping box and the extra sphere / cylinder /
// box shapes, in the conventions the clip shader evaluates: a box is centre +
// half-extents + rotation, a cylinder is base point + unit axis + height.
import { type Quat, quatAxes, type V3 } from './quat';

export type SelectShape =
  | { kind: 'box'; center: V3; half: V3; rotation: Quat }
  | { kind: 'sphere'; center: V3; radius: number }
  | { kind: 'cylinder'; base: V3; axis: V3; radius: number; height: number };

export type SelectShapeMode = 'inside' | 'intersect';

/** A world-space AABB packed as [minx, miny, minz, maxx, maxy, maxz]. */
export type PackedAabb = ArrayLike<number>;

/** Squared 2-D distance below which a projected corner sits ON the axis. */
const ON_AXIS_EPS = 1e-18;

function cornerOf(b: PackedAabb, c: number): V3 {
  return [b[c & 1 ? 3 : 0], b[c & 2 ? 4 : 1], b[c & 4 ? 5 : 2]];
}

function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** True when the whole box lies inside the shape. Exact: every shape is
 *  convex, so a box is inside iff all eight corners are. */
export function aabbInsideShape(b: PackedAabb, s: SelectShape): boolean {
  if (s.kind === 'sphere') {
    let far = 0;
    for (let k = 0; k < 3; k++) {
      const d = Math.max(Math.abs(b[k] - s.center[k]), Math.abs(b[k + 3] - s.center[k]));
      far += d * d;
    }
    return far <= s.radius * s.radius;
  }
  if (s.kind === 'box') {
    const axes = quatAxes(s.rotation);
    for (let c = 0; c < 8; c++) {
      const p = cornerOf(b, c);
      const d: V3 = [p[0] - s.center[0], p[1] - s.center[1], p[2] - s.center[2]];
      for (let a = 0; a < 3; a++) {
        if (Math.abs(dot(d, axes[a])) > s.half[a]) {
          return false;
        }
      }
    }
    return true;
  }
  const r2 = s.radius * s.radius;
  for (let c = 0; c < 8; c++) {
    const p = cornerOf(b, c);
    const rel: V3 = [p[0] - s.base[0], p[1] - s.base[1], p[2] - s.base[2]];
    const t = dot(rel, s.axis);
    if (t < 0 || t > s.height) {
      return false;
    }
    if (dot(rel, rel) - t * t > r2) {
      return false;
    }
  }
  return true;
}

/** True when the box and the shape overlap. Exact for boxes (separating-axis
 *  test) and spheres. A cylinder is tested as its axial slab × its radial
 *  disc, which is exact when the axis is world-aligned and slightly
 *  conservative (a near miss can count as a hit) when it is tilted. */
export function aabbIntersectsShape(b: PackedAabb, s: SelectShape): boolean {
  if (s.kind === 'sphere') {
    let d2 = 0;
    for (let k = 0; k < 3; k++) {
      const q = Math.min(Math.max(s.center[k], b[k]), b[k + 3]);
      d2 += (q - s.center[k]) * (q - s.center[k]);
    }
    return d2 <= s.radius * s.radius;
  }
  if (s.kind === 'box') {
    return aabbHitsObb(b, s.center, s.half, quatAxes(s.rotation));
  }
  return aabbHitsCylinder(b, s.base, s.axis, s.radius, s.height);
}

/** Separating-axis test between a world AABB and an oriented box: the three
 *  world axes, the three box axes and their nine cross products. Overlap iff
 *  no axis separates the two projected intervals. */
function aabbHitsObb(b: PackedAabb, center: V3, half: V3, axes: [V3, V3, V3]): boolean {
  const ha: V3 = [(b[3] - b[0]) / 2, (b[4] - b[1]) / 2, (b[5] - b[2]) / 2];
  const d: V3 = [center[0] - (b[0] + b[3]) / 2, center[1] - (b[1] + b[4]) / 2, center[2] - (b[2] + b[5]) / 2];
  const separated = (axis: V3, ra: number, rb: number): boolean => Math.abs(dot(d, axis)) > ra + rb;
  for (let k = 0; k < 3; k++) {
    const e: V3 = [0, 0, 0];
    e[k] = 1;
    const rb = Math.abs(axes[0][k]) * half[0] + Math.abs(axes[1][k]) * half[1] + Math.abs(axes[2][k]) * half[2];
    if (separated(e, ha[k], rb)) {
      return false;
    }
  }
  for (let a = 0; a < 3; a++) {
    const u = axes[a];
    const ra = Math.abs(u[0]) * ha[0] + Math.abs(u[1]) * ha[1] + Math.abs(u[2]) * ha[2];
    if (separated(u, ra, half[a])) {
      return false;
    }
  }
  for (let k = 0; k < 3; k++) {
    for (let a = 0; a < 3; a++) {
      const u = axes[a];
      const l: V3 = k === 0 ? [0, -u[2], u[1]] : k === 1 ? [u[2], 0, -u[0]] : [-u[1], u[0], 0];
      if (dot(l, l) < 1e-12) {
        continue;
      }
      const ra = Math.abs(l[0]) * ha[0] + Math.abs(l[1]) * ha[1] + Math.abs(l[2]) * ha[2];
      let rb = 0;
      for (let c = 0; c < 3; c++) {
        rb += Math.abs(dot(axes[c], l)) * half[c];
      }
      if (separated(l, ra, rb)) {
        return false;
      }
    }
  }
  return true;
}

/** The box overlaps the cylinder when its extent along the axis reaches the
 *  [0, height] slab AND the axis line passes within `radius` of the box. The
 *  radial part is the distance from the origin to the box's projection onto
 *  the plane perpendicular to the axis (a convex polygon of the 8 corners). */
function aabbHitsCylinder(b: PackedAabb, base: V3, axis: V3, radius: number, height: number): boolean {
  const [u, v] = perpBasis(axis);
  const pts: [number, number][] = [];
  let tmin = Infinity;
  let tmax = -Infinity;
  for (let c = 0; c < 8; c++) {
    const p = cornerOf(b, c);
    const rel: V3 = [p[0] - base[0], p[1] - base[1], p[2] - base[2]];
    const t = dot(rel, axis);
    tmin = Math.min(tmin, t);
    tmax = Math.max(tmax, t);
    pts.push([dot(rel, u), dot(rel, v)]);
  }
  if (tmax < 0 || tmin > height) {
    return false;
  }
  return distToConvexHull(pts) <= radius;
}

/** Two unit vectors spanning the plane perpendicular to `axis` (unit). */
function perpBasis(axis: V3): [V3, V3] {
  const h: V3 = Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u: V3 = [axis[1] * h[2] - axis[2] * h[1], axis[2] * h[0] - axis[0] * h[2], axis[0] * h[1] - axis[1] * h[0]];
  const l = Math.hypot(u[0], u[1], u[2]) || 1;
  u[0] /= l;
  u[1] /= l;
  u[2] /= l;
  const v: V3 = [axis[1] * u[2] - axis[2] * u[1], axis[2] * u[0] - axis[0] * u[2], axis[0] * u[1] - axis[1] * u[0]];
  return [u, v];
}

/** Distance from the origin to the convex hull of the points. Zero when the
 *  hull contains the origin — the point directions leave no angular gap of
 *  π or more — otherwise the nearest of the segments between any two points
 *  (every hull edge is one of them, and the nearest hull point lies on an
 *  edge when the origin is outside). */
function distToConvexHull(pts: [number, number][]): number {
  const angles: number[] = [];
  for (const [x, y] of pts) {
    if (x * x + y * y < ON_AXIS_EPS) {
      return 0;
    }
    angles.push(Math.atan2(y, x));
  }
  angles.sort((a, b) => a - b);
  let maxGap = angles[0] + 2 * Math.PI - angles[angles.length - 1];
  for (let i = 1; i < angles.length; i++) {
    maxGap = Math.max(maxGap, angles[i] - angles[i - 1]);
  }
  if (maxGap < Math.PI) {
    return 0;
  }
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      best = Math.min(best, segmentDistToOrigin(pts[i], pts[j]));
    }
  }
  return best;
}

function segmentDistToOrigin(a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.min(1, Math.max(0, -(a[0] * dx + a[1] * dy) / len2)) : 0;
  return Math.hypot(a[0] + t * dx, a[1] + t * dy);
}
