// Minimal quaternion helpers for the clip gizmo / oriented clipping box.
// Layout [x, y, z, w]; identity = [0, 0, 0, 1].
export type Quat = [number, number, number, number];
export type V3 = [number, number, number];

export const QUAT_IDENTITY: Quat = [0, 0, 0, 1];

export function quatFromAxisAngle(axis: V3, angle: number): Quat {
  const h = angle / 2;
  const s = Math.sin(h);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(h)];
}

export function quatMul(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

export function quatNormalize(q: Quat): Quat {
  const l = Math.hypot(...q) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

export function quatRotate(q: Quat, v: V3): V3 {
  // v' = v + 2*cross(q.xyz, cross(q.xyz, v) + w*v)
  const [qx, qy, qz, qw] = q;
  const cx = qy * v[2] - qz * v[1] + qw * v[0];
  const cy = qz * v[0] - qx * v[2] + qw * v[1];
  const cz = qx * v[1] - qy * v[0] + qw * v[2];
  return [v[0] + 2 * (qy * cz - qz * cy), v[1] + 2 * (qz * cx - qx * cz), v[2] + 2 * (qx * cy - qy * cx)];
}

/** The box's local axes in world space (columns of the rotation matrix). */
export function quatAxes(q: Quat): [V3, V3, V3] {
  return [quatRotate(q, [1, 0, 0]), quatRotate(q, [0, 1, 0]), quatRotate(q, [0, 0, 1])];
}

/** Shortest-arc rotation taking +Z to `dir` (unit). Identity when dir ≈ +Z,
 *  a 180° X-flip when dir ≈ −Z. */
export function quatFromZTo(dir: V3): Quat {
  const z: V3 = [0, 0, 1];
  const d = z[0] * dir[0] + z[1] * dir[1] + z[2] * dir[2];
  if (d > 1 - 1e-9) {
    return [0, 0, 0, 1];
  }
  if (d < -1 + 1e-9) {
    return [1, 0, 0, 0]; // 180° about X
  }
  const ax: V3 = [z[1] * dir[2] - z[2] * dir[1], z[2] * dir[0] - z[0] * dir[2], z[0] * dir[1] - z[1] * dir[0]];
  return quatNormalize([ax[0], ax[1], ax[2], 1 + d]);
}
