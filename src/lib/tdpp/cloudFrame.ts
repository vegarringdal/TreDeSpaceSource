// A point cloud's own axes versus the scene's. A `.tdpp` stores its points on
// a grid whose axes are those of the source project; when the project has a
// rotated coordinate system the file names the rotation from those axes to
// the coordinates it is placed in (TdppMeta.axes). Everything that works on
// the stored points — LOD selection, snapping — runs in the cloud's own
// axes; these helpers move the camera, rays and results across.

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type Vec3 = readonly [number, number, number];

/** Row-major 3×3 rotation: cloud axes → scene axes. Null = the same axes. */
export type CloudAxes = readonly number[] | null;

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

/** Rotation matrix (row-major) of a unit quaternion [w, x, y, z]; null for
 *  the identity, so the common unrotated cloud costs nothing. */
export function axesOfQuat(q: readonly [number, number, number, number]): CloudAxes {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  const [w, x, y, z] = [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
  if (x === 0 && y === 0 && z === 0) {
    return null;
  }
  return [
    1 - 2 * (y * y + z * z),
    2 * (x * y - w * z),
    2 * (x * z + w * y),
    2 * (x * y + w * z),
    1 - 2 * (x * x + z * z),
    2 * (y * z - w * x),
    2 * (x * z - w * y),
    2 * (y * z + w * x),
    1 - 2 * (x * x + y * y),
  ];
}

/** A vector in cloud axes → scene axes. */
export function toScene(m: CloudAxes, v: Vec3): [number, number, number] {
  if (!m) {
    return [v[0], v[1], v[2]];
  }
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/** A vector in scene axes → cloud axes (the transpose). */
export function toCloud(m: CloudAxes, v: Vec3): [number, number, number] {
  if (!m) {
    return [v[0], v[1], v[2]];
  }
  return [
    m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
    m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
    m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
  ];
}

/** Frustum planes (5 × nx, ny, nz, d — relative to the cloud origin, scene
 *  axes) expressed in cloud axes: the normals turn, the offsets stay. */
export function planesToCloud(m: CloudAxes, planes: Float32Array): Float32Array {
  if (!m) {
    return planes;
  }
  const out = new Float32Array(planes.length);
  for (let i = 0; i < planes.length; i += 4) {
    const n = toCloud(m, [planes[i], planes[i + 1], planes[i + 2]]);
    out.set([n[0], n[1], n[2], planes[i + 3]], i);
  }
  return out;
}

/** Scene-axes bounds of a box given in cloud axes, both relative to the
 *  cloud origin. */
export function boxToScene(m: CloudAxes, min: Vec3, max: Vec3): { min: Vec3; max: Vec3 } {
  if (!m) {
    return { min, max };
  }
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let c = 0; c < 8; c++) {
    const p = toScene(m, [c & 1 ? max[0] : min[0], c & 2 ? max[1] : min[1], c & 4 ? max[2] : min[2]]);
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], p[k]);
      hi[k] = Math.max(hi[k], p[k]);
    }
  }
  return { min: [lo[0], lo[1], lo[2]], max: [hi[0], hi[1], hi[2]] };
}
