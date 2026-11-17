// World-space axis-aligned bounds of an oriented box (the default clipping box
// is center + size + rotation). The host API hands these out so a host can
// intersect the box against its own asset bounds without the quaternion math.
import { type Quat, quatAxes, type V3 } from './quat';

/** AABB of the oriented box: along each world axis the extent is the sum of
 *  the half-sizes projected onto it (Σ |axis_i[k]| · size_i / 2). Exact for an
 *  unrotated box; for a rotated one it is the tight envelope of the 8 corners. */
export function obbWorldBounds(center: V3, size: V3, rotation: Quat): { min: V3; max: V3 } {
  const axes = quatAxes(rotation);
  const min: V3 = [0, 0, 0];
  const max: V3 = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const r =
      (Math.abs(axes[0][k]) * size[0]) / 2 +
      (Math.abs(axes[1][k]) * size[1]) / 2 +
      (Math.abs(axes[2][k]) * size[2]) / 2;
    min[k] = center[k] - r;
    max[k] = center[k] + r;
  }
  return { min, max };
}
