// Orbit distance that frames a world box from a pivot that need not be the
// box centre — a label anchored somewhere on an item, looking at all of it.

/** Distance from `pivot` at which a camera of vertical FOV `fovY` (radians)
 *  shows every corner of `bounds`: the sphere around the pivot reaching the
 *  farthest corner, with the same 13 % margin camera.fit() uses, floored at
 *  `minDist`. No bounds (nothing to frame) → `minDist`. */
export function framingDistanceFromPoint(
  pivot: readonly [number, number, number],
  bounds: { min: readonly number[]; max: readonly number[] } | null,
  fovY: number,
  minDist: number,
): number {
  if (!bounds) {
    return minDist;
  }
  let radiusSq = 0;
  for (let a = 0; a < 3; a++) {
    const d = Math.max(Math.abs(bounds.min[a] - pivot[a]), Math.abs(bounds.max[a] - pivot[a]));
    radiusSq += d * d;
  }
  return Math.max(minDist, (Math.sqrt(radiusSq) * 1.3) / Math.tan(fovY / 2));
}
