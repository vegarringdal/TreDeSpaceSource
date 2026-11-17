// -----------------------------------------------------------------------------
// interpolation + rigid pose math (DESIGN.md › Animation › Evaluation)
// -----------------------------------------------------------------------------
// Matrices are column-major Float32Array(16) (WGSL layout, like the transform
// pool). A pose is a DELTA from the rest pose about a pivot in rest (world)
// space: D = T(move) · T(pivot) · R(rotate) · T(-pivot). Pure — no imports beyond
// types, so it unit-tests without the app.

import { fixedPivot, type PivotOf } from './pivots';
import type { AnimCamera, Interp, ObjectKey, Quat, V3 } from './types';

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

export const QUAT_ID: Quat = [0, 0, 0, 1];
const DEG = Math.PI / 180;

// -----------------------------------------------------------------------------
// interpolation
// -----------------------------------------------------------------------------

/** Progress for `u` in [0, 1] (clamped) as a key's interpolation shapes it:
 *  smooth eases in and out, linear is even, hold stays 0 until the key. */
export function interpEase(kind: Interp, u: number): number {
  const x = Math.min(1, Math.max(0, u));
  switch (kind) {
    case 'linear':
      return x;
    case 'smooth':
      return x * x * (3 - 2 * x);
    case 'hold':
      return x < 1 ? 0 : 1;
  }
}

// -----------------------------------------------------------------------------
// quaternions
// -----------------------------------------------------------------------------

export function qNormalize(q: Quat): Quat {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

export function qMul(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

export function qConj(q: Quat): Quat {
  return [-q[0], -q[1], -q[2], q[3]];
}

/** Rotation of `degrees` about `axis` (normalized here). */
export function qAxisAngle(axis: V3, degrees: number): Quat {
  const l = Math.hypot(axis[0], axis[1], axis[2]);
  if (l < 1e-12) {
    return [...QUAT_ID];
  }
  const h = (degrees * DEG) / 2;
  const s = Math.sin(h) / l;
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(h)];
}

/** Shortest-path spherical interpolation. */
export function qSlerp(a: Quat, b: Quat, t: number): Quat {
  let bx = b[0];
  let by = b[1];
  let bz = b[2];
  let bw = b[3];
  let cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (cos < 0) {
    cos = -cos;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  if (cos > 0.9995) {
    return qNormalize([a[0] + (bx - a[0]) * t, a[1] + (by - a[1]) * t, a[2] + (bz - a[2]) * t, a[3] + (bw - a[3]) * t]);
  }
  const theta = Math.acos(Math.min(1, cos));
  const sin = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sin;
  const wb = Math.sin(t * theta) / sin;
  return [a[0] * wa + bx * wb, a[1] * wa + by * wb, a[2] * wa + bz * wb, a[3] * wa + bw * wb];
}

/** Rotation angle of `q` in degrees, 0..180. */
export function qAngleDeg(q: Quat): number {
  const w = Math.min(1, Math.abs(qNormalize(q)[3]));
  return (2 * Math.acos(w)) / DEG;
}

export function qRotate(q: Quat, v: V3): V3 {
  const [qx, qy, qz, qw] = q;
  const cx = qy * v[2] - qz * v[1] + qw * v[0];
  const cy = qz * v[0] - qx * v[2] + qw * v[1];
  const cz = qx * v[1] - qy * v[0] + qw * v[2];
  return [v[0] + 2 * (qy * cz - qz * cy), v[1] + 2 * (qz * cx - qx * cz), v[2] + 2 * (qx * cy - qy * cx)];
}

/** XYZ Euler degrees (rotate X, then Y, then Z — R = Rz·Ry·Rx) ↔ quaternion,
 *  for the inspector's RotationInput. */
export function qFromEulerDeg(e: V3): Quat {
  const qx = qAxisAngle([1, 0, 0], e[0]);
  const qy = qAxisAngle([0, 1, 0], e[1]);
  const qz = qAxisAngle([0, 0, 1], e[2]);
  return qNormalize(qMul(qz, qMul(qy, qx)));
}

export function qToEulerDeg(q: Quat): V3 {
  const [x, y, z, w] = qNormalize(q);
  const sinp = 2 * (w * y - z * x);
  const pitch = Math.abs(sinp) >= 1 ? (Math.sign(sinp) * Math.PI) / 2 : Math.asin(sinp);
  const roll = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
  const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  return [roll / DEG, pitch / DEG, yaw / DEG];
}

// -----------------------------------------------------------------------------
// matrices
// -----------------------------------------------------------------------------

/** A 4×4 column-major matrix: float32 for the GPU, float64 for authoring
 *  math (keys folded far from the origin keep sub-millimetre precision). */
export type M4 = Float32Array | Float64Array;

export function m4Identity(): Float32Array;
export function m4Identity<T extends M4>(out: T): T;
export function m4Identity(out: M4 = new Float32Array(16)): M4 {
  out.fill(0);
  out[0] = out[5] = out[10] = out[15] = 1;
  return out;
}

/** out = a · b (column-major). `out` may alias neither input. */
export function m4Multiply(a: ArrayLike<number>, b: ArrayLike<number>): Float32Array;
export function m4Multiply<T extends M4>(a: ArrayLike<number>, b: ArrayLike<number>, out: T): T;
export function m4Multiply(a: ArrayLike<number>, b: ArrayLike<number>, out: M4 = new Float32Array(16)): M4 {
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

/** Inverse of a rigid matrix [R | t] → [Rᵀ | −Rᵀt]. */
export function m4InvertRigid(m: ArrayLike<number>): Float32Array;
export function m4InvertRigid<T extends M4>(m: ArrayLike<number>, out: T): T;
export function m4InvertRigid(m: ArrayLike<number>, out: M4 = new Float32Array(16)): M4 {
  const tx = m[12];
  const ty = m[13];
  const tz = m[14];
  out[0] = m[0];
  out[1] = m[4];
  out[2] = m[8];
  out[3] = 0;
  out[4] = m[1];
  out[5] = m[5];
  out[6] = m[9];
  out[7] = 0;
  out[8] = m[2];
  out[9] = m[6];
  out[10] = m[10];
  out[11] = 0;
  out[12] = -(m[0] * tx + m[1] * ty + m[2] * tz);
  out[13] = -(m[4] * tx + m[5] * ty + m[6] * tz);
  out[14] = -(m[8] * tx + m[9] * ty + m[10] * tz);
  out[15] = 1;
  return out;
}

export function m4TransformPoint(m: ArrayLike<number>, p: V3): V3 {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

/** D = T(move) · T(pivot) · R(rotate) · T(-pivot), written into `out`. */
export function poseMatrix(key: Pick<ObjectKey, 'move' | 'rotate'>, pivot: V3): Float32Array;
export function poseMatrix<T extends M4>(key: Pick<ObjectKey, 'move' | 'rotate'>, pivot: V3, out: T): T;
export function poseMatrix(key: Pick<ObjectKey, 'move' | 'rotate'>, pivot: V3, out: M4 = new Float32Array(16)): M4 {
  const [x, y, z, w] = qNormalize(key.rotate);
  const r00 = 1 - 2 * (y * y + z * z);
  const r10 = 2 * (x * y + z * w);
  const r20 = 2 * (x * z - y * w);
  const r01 = 2 * (x * y - z * w);
  const r11 = 1 - 2 * (x * x + z * z);
  const r21 = 2 * (y * z + x * w);
  const r02 = 2 * (x * z + y * w);
  const r12 = 2 * (y * z - x * w);
  const r22 = 1 - 2 * (x * x + y * y);
  const [px, py, pz] = pivot;
  out[0] = r00;
  out[1] = r10;
  out[2] = r20;
  out[3] = 0;
  out[4] = r01;
  out[5] = r11;
  out[6] = r21;
  out[7] = 0;
  out[8] = r02;
  out[9] = r12;
  out[10] = r22;
  out[11] = 0;
  out[12] = key.move[0] + px - (r00 * px + r01 * py + r02 * pz);
  out[13] = key.move[1] + py - (r10 * px + r11 * py + r12 * pz);
  out[14] = key.move[2] + pz - (r20 * px + r21 * py + r22 * pz);
  out[15] = 1;
  return out;
}

/** Rotation quaternion of an (approximately) rigid matrix — re-orthonormalized
 *  first (Gram-Schmidt) so many gizmo folds never skew the key. */
export function rotationOf(m: ArrayLike<number>): Quat {
  let c0: V3 = [m[0], m[1], m[2]];
  let c1: V3 = [m[4], m[5], m[6]];
  const n0 = Math.hypot(...c0) || 1;
  c0 = [c0[0] / n0, c0[1] / n0, c0[2] / n0];
  const d = c0[0] * c1[0] + c0[1] * c1[1] + c0[2] * c1[2];
  c1 = [c1[0] - d * c0[0], c1[1] - d * c0[1], c1[2] - d * c0[2]];
  const n1 = Math.hypot(...c1) || 1;
  c1 = [c1[0] / n1, c1[1] / n1, c1[2] / n1];
  const c2: V3 = [c0[1] * c1[2] - c0[2] * c1[1], c0[2] * c1[0] - c0[0] * c1[2], c0[0] * c1[1] - c0[1] * c1[0]];
  const [m00, m10, m20] = c0;
  const [m01, m11, m21] = c1;
  const [m02, m12, m22] = c2;
  const tr = m00 + m11 + m22;
  let q: Quat;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s];
  }
  return qNormalize(q);
}

/** Inverse of poseMatrix for a rigid `m`: the key (move, rotate) about
 *  `pivot` that reproduces it. move = t − pivot + R·pivot. */
export function decomposeRigid(m: ArrayLike<number>, pivot: V3): { move: V3; rotate: Quat } {
  const rotate = rotationOf(m);
  const rp = qRotate(rotate, pivot);
  return { move: [m[12] - pivot[0] + rp[0], m[13] - pivot[1] + rp[1], m[14] - pivot[2] + rp[2]], rotate };
}

// -----------------------------------------------------------------------------
// track sampling
// -----------------------------------------------------------------------------

/** Index of the last key with t ≤ local, or -1 (keys sorted by t). */
export function keyIndexAt(keys: readonly { t: number }[], local: number): number {
  let lo = 0;
  let hi = keys.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (keys[mid].t <= local + 1e-9) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** Two keys (or pivots) closer than this are at the same place (m) — a
 *  pause on the smooth path, a shared pivot. A tenth of a millimetre: a key
 *  pressed twice without moving lands within float noise of the first. */
export const SAME_PLACE_M = 1e-4;

/** Key i's tangent (m/s) for the smooth path: the neighbours' difference over
 *  their time apart; zero where the object rests — the same place as a
 *  neighbour (a pause), before a hold (it stays, then jumps) or right after
 *  one (it sets off from the jump) — and one-sided at the ends. */
function pathTangent(keys: readonly ObjectKey[], i: number): V3 {
  const same = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < SAME_PLACE_M;
  const p = keys[i].move;
  const prev = keys[i - 1];
  const next = keys[i + 1];
  const rests =
    (prev && same(prev.move, p)) ||
    (next && same(next.move, p)) ||
    next?.interp === 'hold' ||
    keys[i].interp === 'hold';
  if (rests) {
    return [0, 0, 0];
  }
  const a = prev ?? keys[i];
  const b = next ?? keys[i];
  const dt = b.t - a.t;
  if (dt <= 1e-9) {
    return [0, 0, 0];
  }
  return [(b.move[0] - a.move[0]) / dt, (b.move[1] - a.move[1]) / dt, (b.move[2] - a.move[2]) / dt];
}

/** Position on the smooth path between keys i and i+1 at eased progress e
 *  (cubic Hermite with time-scaled tangents — passes through every key). */
function smoothPos(keys: readonly ObjectKey[], i: number, e: number): V3 {
  const a = keys[i];
  const b = keys[i + 1];
  const h = b.t - a.t;
  const ma = pathTangent(keys, i);
  const mb = pathTangent(keys, i + 1);
  const e2 = e * e;
  const e3 = e2 * e;
  const h00 = 2 * e3 - 3 * e2 + 1;
  const h10 = e3 - 2 * e2 + e;
  const h01 = -2 * e3 + 3 * e2;
  const h11 = e3 - e2;
  const out: V3 = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    out[k] = h00 * a.move[k] + h10 * h * ma[k] + h01 * b.move[k] + h11 * h * mb[k];
  }
  return out;
}

/** Where key `k`'s pose puts the rest point x: move + q + R·(x − q). */
function posePoint(k: ObjectKey, q: V3, x: V3): V3 {
  const r = qRotate(k.rotate, [x[0] - q[0], x[1] - q[1], x[2] - q[2]]);
  return [k.move[0] + q[0] + r[0], k.move[1] + q[1] + r[1], k.move[2] + q[2] + r[2]];
}

/** The object's pose at T, as move / rotate about `pivot` (a point in rest
 *  coordinates). A key's move and rotate are about its own pivot
 *  (`pivotOf`); on the way into a key the object turns about THAT key's
 *  pivot q, whose point travels from where the key before puts it to where
 *  this key does — eased, or on the smooth path when both keys share the
 *  pivot. Before the first key: the first key; after the last: the last.
 *  A key with `spin` drives its incoming segment as a multi-turn rotation:
 *  rot(e) = AA(axis, deg·e) · slerp(r0, AA(axis, −deg) · r1, e), which
 *  lands exactly on r1 at e = 1 for any number of turns. */
export function sampleTransform(
  keys: readonly ObjectKey[],
  T: number,
  smooth = false,
  pivotOf: PivotOf = fixedPivot(),
): { move: V3; rotate: Quat; pivot: V3 } {
  if (keys.length === 0) {
    return { move: [0, 0, 0], rotate: [...QUAT_ID], pivot: [0, 0, 0] };
  }
  const i = keyIndexAt(keys, T);
  if (i < 0 || i >= keys.length - 1) {
    const k = i < 0 ? keys[0] : keys[keys.length - 1];
    return { move: [...k.move], rotate: [...k.rotate], pivot: pivotOf(k) };
  }
  const a = keys[i];
  const b = keys[i + 1];
  const span = b.t - a.t;
  const e = interpEase(b.interp, span > 1e-9 ? (T - a.t) / span : 1);
  const spun = b.spin && Math.abs(b.spin.degrees) > 1e-6 ? b.spin : null;
  const rotate = spun
    ? qNormalize(
        qMul(
          qAxisAngle(spun.axis, spun.degrees * e),
          qSlerp(a.rotate, qMul(qAxisAngle(spun.axis, -spun.degrees), b.rotate), e),
        ),
      )
    : qSlerp(a.rotate, b.rotate, e);
  const qb = pivotOf(b);
  const qa = pivotOf(a);
  const shared = Math.hypot(qa[0] - qb[0], qa[1] - qb[1], qa[2] - qb[2]) < SAME_PLACE_M;
  if (shared) {
    const move: V3 = smooth
      ? smoothPos(keys, i, e)
      : [
          a.move[0] + (b.move[0] - a.move[0]) * e,
          a.move[1] + (b.move[1] - a.move[1]) * e,
          a.move[2] + (b.move[2] - a.move[2]) * e,
        ];
    return { move, rotate, pivot: qb };
  }
  // q_b's point at key a, then straight to where key b has it (move_b + q_b)
  const from = posePoint(a, qa, qb);
  const move: V3 = [
    from[0] + (b.move[0] + qb[0] - from[0]) * e - qb[0],
    from[1] + (b.move[1] + qb[1] - from[1]) * e - qb[1],
    from[2] + (b.move[2] + qb[2] - from[2]) * e - qb[2],
  ];
  return { move, rotate, pivot: qb };
}

/** sampleTransform → the delta matrix. */
export function sampleTransformMatrix(
  keys: readonly ObjectKey[],
  T: number,
  out: Float32Array,
  pivotOf: PivotOf = fixedPivot(),
  smooth = false,
): Float32Array {
  const s = sampleTransform(keys, T, smooth, pivotOf);
  return poseMatrix(s, s.pivot, out);
}

// -----------------------------------------------------------------------------
// camera
// -----------------------------------------------------------------------------

/** Camera between two keys (DESIGN.md › Animation › Player): target lerp, azimuth the short way,
 *  elevation lerp, distance log-lerp; projection/sketch step at the key. */
export function lerpCamera(a: AnimCamera, b: AnimCamera, e: number): AnimCamera {
  let dAz = b.azimuth - a.azimuth;
  dAz -= Math.round(dAz / (2 * Math.PI)) * 2 * Math.PI;
  const da = Math.max(a.orbitDistance, 1e-4);
  const db = Math.max(b.orbitDistance, 1e-4);
  const atEnd = e >= 1;
  return {
    target: [
      a.target[0] + (b.target[0] - a.target[0]) * e,
      a.target[1] + (b.target[1] - a.target[1]) * e,
      a.target[2] + (b.target[2] - a.target[2]) * e,
    ],
    azimuth: a.azimuth + dAz * e,
    elevation: a.elevation + (b.elevation - a.elevation) * e,
    orbitDistance: Math.exp(Math.log(da) + (Math.log(db) - Math.log(da)) * e),
    orthographic: atEnd ? b.orthographic : a.orthographic,
    sketch: atEnd ? b.sketch : a.sketch,
  };
}

/** The camera row's view at time T (clamped to the first / last key). */
export function sampleCamera(
  keys: readonly { t: number; view: AnimCamera; interp: Interp }[],
  T: number,
): AnimCamera | null {
  if (keys.length === 0) {
    return null;
  }
  const i = keyIndexAt(keys, T);
  if (i < 0) {
    return keys[0].view;
  }
  if (i >= keys.length - 1) {
    return keys[keys.length - 1].view;
  }
  const a = keys[i];
  const b = keys[i + 1];
  const span = b.t - a.t;
  return lerpCamera(a.view, b.view, interpEase(b.interp, span > 1e-9 ? (T - a.t) / span : 1));
}

/** Smoothstep weight for blends (camera return, DESIGN.md › Animation › Player). */
export function smoothstep(u: number): number {
  const x = Math.min(1, Math.max(0, u));
  return x * x * (3 - 2 * x);
}
