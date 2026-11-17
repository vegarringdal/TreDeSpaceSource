// -----------------------------------------------------------------------------
// transform object poses (DESIGN.md › Transform objects)
// -----------------------------------------------------------------------------
// An object's own matrix is D = T(move) · T(q) · R(rotate) · S(scale) · T(−q),
// q its pivot in rest coordinates; what is drawn is W = W(parent) · D. All of
// it in float64 — a pivot far from the origin keeps sub-millimetre precision
// until the pool takes the result as float32. Pure.

import { m4Multiply, m4TransformPoint, qConj, qMul, qNormalize, rotationOf } from '../animation/interp';
import { keyPivotPoint } from '../animation/pivots';
import { parentIn } from '../objectTree';
import type { Pose, Quat, RestBoxes, TransformObject, TransformPivot, V3 } from './types';

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

const ORIGIN: V3 = [0, 0, 0];

/** A scale never collapses an object (nor mirrors it). */
export const MIN_SCALE = 0.01;

/** Tenths of a millimetre / millionths of a turn are plenty for a pose. */
const ROUND_M = 1e5;
const ROUND_Q = 1e9;

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function f64(): Float64Array {
  return new Float64Array(16);
}

function roundTo(v: number, unit: number): number {
  return Math.round(v * unit) / unit || 0;
}

function roundV3(v: V3, unit: number): V3 {
  return [roundTo(v[0], unit), roundTo(v[1], unit), roundTo(v[2], unit)];
}

function roundQuat(q: Quat): Quat {
  const n = qNormalize(q);
  const s = n[3] < 0 ? -1 : 1;
  return [
    roundTo(n[0] * s, ROUND_Q),
    roundTo(n[1] * s, ROUND_Q),
    roundTo(n[2] * s, ROUND_Q),
    roundTo(n[3] * s, ROUND_Q),
  ];
}

/** The linear part of `m` applied to `v` (no translation). */
function linear(m: ArrayLike<number>, v: V3): V3 {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2],
  ];
}

function clampScale(v: number): number {
  return Number.isFinite(v) ? Math.max(MIN_SCALE, v) : 1;
}

// -----------------------------------------------------------------------------
// matrices
// -----------------------------------------------------------------------------

export function identityMatrix(): Float64Array {
  const m = f64();
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

/** Inverse of an affine matrix (any linear part that can be inverted; the
 *  identity when it cannot). */
export function invertAffine(m: ArrayLike<number>): Float64Array {
  const a = m[0];
  const b = m[4];
  const c = m[8];
  const d = m[1];
  const e = m[5];
  const f = m[9];
  const g = m[2];
  const h = m[6];
  const i = m[10];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  const out = identityMatrix();
  if (Math.abs(det) < 1e-30) {
    return out;
  }
  const r = 1 / det;
  out[0] = (e * i - f * h) * r;
  out[4] = (c * h - b * i) * r;
  out[8] = (b * f - c * e) * r;
  out[1] = (f * g - d * i) * r;
  out[5] = (a * i - c * g) * r;
  out[9] = (c * d - a * f) * r;
  out[2] = (d * h - e * g) * r;
  out[6] = (b * g - a * h) * r;
  out[10] = (a * e - b * d) * r;
  const t = linear(out, [m[12], m[13], m[14]]);
  out[12] = -t[0];
  out[13] = -t[1];
  out[14] = -t[2];
  return out;
}

/** D = T(move) · T(q) · R · S · T(−q). */
export function poseMatrix(pose: Pose, q: V3): Float64Array {
  const [x, y, z, w] = qNormalize(pose.rotate);
  const [sx, sy, sz] = pose.scale;
  const out = f64();
  out[0] = (1 - 2 * (y * y + z * z)) * sx;
  out[1] = 2 * (x * y + z * w) * sx;
  out[2] = 2 * (x * z - y * w) * sx;
  out[4] = 2 * (x * y - z * w) * sy;
  out[5] = (1 - 2 * (x * x + z * z)) * sy;
  out[6] = 2 * (y * z + x * w) * sy;
  out[8] = 2 * (x * z + y * w) * sz;
  out[9] = 2 * (y * z - x * w) * sz;
  out[10] = (1 - 2 * (x * x + y * y)) * sz;
  const lq = linear(out, q);
  out[12] = pose.move[0] + q[0] - lq[0];
  out[13] = pose.move[1] + q[1] - lq[1];
  out[14] = pose.move[2] + q[2] - lq[2];
  out[15] = 1;
  return out;
}

/** The pose about `q` that gives matrix `m` — exact when `m` is a rotation
 *  with a scale along its own axes; a skewed `m` (a parent scaled unevenly
 *  under a turned child) comes back as the closest such pose, its
 *  translation kept. */
export function decomposePose(m: ArrayLike<number>, q: V3): Pose {
  const rotate = rotationOf(m);
  const scale: V3 = [
    clampScale(Math.hypot(m[0], m[1], m[2])),
    clampScale(Math.hypot(m[4], m[5], m[6])),
    clampScale(Math.hypot(m[8], m[9], m[10])),
  ];
  const lq = linear(poseMatrix({ move: ORIGIN, rotate, scale }, ORIGIN), q);
  return roundPose({
    move: [m[12] - q[0] + lq[0], m[13] - q[1] + lq[1], m[14] - q[2] + lq[2]],
    rotate,
    scale,
  });
}

/** A pose as it is stored: rounded so files stay tidy and a pose folded many
 *  times does not drift. */
export function roundPose(p: Pose): Pose {
  return {
    move: roundV3(p.move, ROUND_M),
    rotate: roundQuat(p.rotate),
    scale: [
      roundTo(clampScale(p.scale[0]), ROUND_M),
      roundTo(clampScale(p.scale[1]), ROUND_M),
      roundTo(clampScale(p.scale[2]), ROUND_M),
    ],
  };
}

export function isIdentityPose(p: Pose): boolean {
  const moved = p.move.some((v) => Math.abs(v) > 1e-6);
  const turned = Math.abs(Math.abs(qNormalize(p.rotate)[3]) - 1) > 1e-9;
  const scaled = p.scale.some((v) => Math.abs(v - 1) > 1e-6);
  return !moved && !turned && !scaled;
}

// -----------------------------------------------------------------------------
// objects
// -----------------------------------------------------------------------------

/** An object's pivot as a point in rest coordinates (the origin for a side
 *  of a box that is not known — no item of it is loaded). */
export function pivotPoint(pivot: TransformPivot, box: ArrayLike<number> | null | undefined): V3 {
  return keyPivotPoint(pivot, box, ORIGIN);
}

/** What is drawn for every object: W = W(parent) · D, a muted object's own D
 *  left out. A parent that is missing — or a loop — counts as no parent. */
export function worldMatrices(objects: readonly TransformObject[], boxes: RestBoxes): Map<string, Float64Array> {
  const done = new Map<string, Float64Array>();
  const resolve = (o: TransformObject): Float64Array => {
    const hit = done.get(o.id);
    if (hit) {
      return hit;
    }
    const parent = parentIn(objects, o);
    const above = parent ? resolve(parent) : identityMatrix();
    const own = o.muted ? identityMatrix() : poseMatrix(o, pivotPoint(o.pivot, boxes.get(o.id)));
    const w = m4Multiply(above, own, f64());
    done.set(o.id, w);
    return w;
  };
  for (const o of objects) {
    resolve(o);
  }
  return done;
}

/** The matrix an object's own pose is applied under: its parent's W, the
 *  identity without one. */
export function parentMatrix(
  objects: readonly TransformObject[],
  boxes: RestBoxes,
  id: string,
  world: ReadonlyMap<string, Float64Array> = worldMatrices(objects, boxes),
): Float64Array {
  const parent = objects.find((o) => o.id === id)?.parent;
  return (parent ? world.get(parent) : undefined) ?? identityMatrix();
}

/** Where the object's pivot is drawn (world): what the gizmo sits on and what
 *  the ribbon turns about. */
export function worldPivot(o: TransformObject, q: V3, above: ArrayLike<number>): V3 {
  return m4TransformPoint(above, [o.move[0] + q[0], o.move[1] + q[1], o.move[2] + q[2]]);
}

/**
 * The object's pose after world matrix `g` (a gizmo drag, a ribbon step) is
 * applied on top of where it is drawn. `above` is its parent's W.
 *
 * The pivot's image travels exactly (so the object lands where the preview
 * showed it); the turn is `g`'s rotation seen from the parent's frame; a
 * stretch in `g` is taken along the object's OWN axes — each axis grows by
 * how much `g` stretches its direction — so the pose never skews. That is
 * exact for a move, a turn, an even scale and a scale along an axis the
 * object is lined up with.
 */
export function applyWorld(o: TransformObject, q: V3, above: ArrayLike<number>, g: ArrayLike<number>): Pose {
  const inv = invertAffine(above);
  const at = m4TransformPoint(inv, m4TransformPoint(g, worldPivot(o, q, above)));
  const turnAbove = rotationOf(above);
  const turn = rotationOf(g);
  const rotate = qMul(qMul(qMul(qConj(turnAbove), turn), turnAbove), qNormalize(o.rotate));
  const own = m4Multiply(above, poseMatrix({ move: ORIGIN, rotate: o.rotate, scale: [1, 1, 1] }, ORIGIN), f64());
  const stretch = (axis: 0 | 1 | 2): number => {
    const dir: V3 = [own[axis * 4], own[axis * 4 + 1], own[axis * 4 + 2]];
    const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const out = linear(g, [dir[0] / len, dir[1] / len, dir[2] / len]);
    return Math.hypot(out[0], out[1], out[2]);
  };
  return roundPose({
    move: [at[0] - q[0], at[1] - q[1], at[2] - q[2]],
    rotate,
    scale: [o.scale[0] * stretch(0), o.scale[1] * stretch(1), o.scale[2] * stretch(2)],
  });
}

/** The same placement said about another pivot: only `move` changes. */
export function rePivot(pose: Pose, from: V3, to: V3): Pose {
  const l = poseMatrix({ move: ORIGIN, rotate: pose.rotate, scale: pose.scale }, ORIGIN);
  const d: V3 = [from[0] - to[0], from[1] - to[1], from[2] - to[2]];
  const ld = linear(l, d);
  return roundPose({
    ...pose,
    move: [pose.move[0] + d[0] - ld[0], pose.move[1] + d[1] - ld[1], pose.move[2] + d[2] - ld[2]],
  });
}

/** The pose that keeps the object where it is drawn when the matrix above it
 *  changes from `from` to `to` (a new parent, a parent removed). */
export function reParent(pose: Pose, q: V3, from: ArrayLike<number>, to: ArrayLike<number>): Pose {
  const world = m4Multiply(from, poseMatrix(pose, q), f64());
  return decomposePose(m4Multiply(invertAffine(to), world, f64()), q);
}

// the tree walks are shared with animation objects (lib/objectTree)
export { ridesOn, treeOrder } from '../objectTree';
