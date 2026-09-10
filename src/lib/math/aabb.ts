// Axis-aligned world boxes. The clip-aware fit frames a visible-items box cut
// down by the clip volumes, so it needs union, intersection and an exact
// half-space clip.
import type { V3 } from './quat';

export interface Aabb {
  min: V3;
  max: V3;
}

export function unionAabb(a: Aabb, b: Aabb): Aabb {
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  };
}

/** Overlap of two boxes; null when they do not touch. */
export function intersectAabb(a: Aabb, b: Aabb): Aabb | null {
  const min: V3 = [Math.max(a.min[0], b.min[0]), Math.max(a.min[1], b.min[1]), Math.max(a.min[2], b.min[2])];
  const max: V3 = [Math.min(a.max[0], b.max[0]), Math.min(a.max[1], b.max[1]), Math.min(a.max[2], b.max[2])];
  for (let k = 0; k < 3; k++) {
    if (min[k] > max[k]) {
      return null;
    }
  }
  return { min, max };
}

/** The part of a box on the keep side of a plane (n·p + d ≥ 0), as a box.
 *  Exact: the kept region is a convex polytope whose vertices are the kept
 *  corners plus the points where the plane cuts the box's edges, so their
 *  envelope is its tight AABB. null when the plane clears the whole box. */
export function clipAabbByHalfSpace(box: Aabb, n: V3, d: number): Aabb | null {
  const corners: V3[] = [];
  for (let c = 0; c < 8; c++) {
    corners.push([c & 1 ? box.max[0] : box.min[0], c & 2 ? box.max[1] : box.min[1], c & 4 ? box.max[2] : box.min[2]]);
  }
  const side = corners.map((p) => n[0] * p[0] + n[1] * p[1] + n[2] * p[2] + d);
  const kept: V3[] = corners.filter((_, i) => side[i] >= 0);
  // an edge joins two corners that differ in exactly one index bit
  for (let a = 0; a < 8; a++) {
    for (const bit of [1, 2, 4]) {
      const b = a | bit;
      if (b === a || side[a] >= 0 === side[b] >= 0) {
        continue;
      }
      const t = side[a] / (side[a] - side[b]);
      const pa = corners[a];
      const pb = corners[b];
      kept.push([pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t, pa[2] + (pb[2] - pa[2]) * t]);
    }
  }
  if (kept.length === 0) {
    return null;
  }
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const p of kept) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[k]);
      max[k] = Math.max(max[k], p[k]);
    }
  }
  return { min, max };
}
