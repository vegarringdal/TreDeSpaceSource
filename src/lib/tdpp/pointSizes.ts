// Adaptive point size in an additive LOD: which spacing a drawn node's points
// are sized by. A node's own spacing is right only where nothing finer is
// drawn. Up close the nodes above the finest level are still drawn — their
// points are part of the picture — and sized by their own spacing they are
// squares many times larger than the points around them. So every drawn node
// gets one spacing per octant of its cube: the finest spacing drawn in the
// child there, or its own where no child is drawn. Pure functions.
import type { TdppNode } from './tdppFormat';

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const OCTANTS = 8;

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

/**
 * The spacing to size by in each octant, for every drawn node that has points.
 * `drawn` is closed under "parent of" (the streamer's draw set); `isEmpty`
 * tells a drawn node without points of its own (a structural node, or one the
 * setup filter emptied) — it takes no part: the region is sized as if the
 * node were not there. Children are stored after their parent, so walking the
 * indices downwards meets every child before its parent.
 */
export function octantSpacings(
  nodes: readonly TdppNode[],
  drawn: ReadonlySet<number>,
  isEmpty: (index: number) => boolean,
): Map<number, Float32Array<ArrayBuffer>> {
  const out = new Map<number, Float32Array<ArrayBuffer>>();
  /** Per drawn node: the finest spacing drawn in its cube (Infinity: nothing). */
  const finest = new Map<number, number>();
  const order = [...drawn].sort((a, b) => b - a);
  for (const index of order) {
    const node = nodes[index];
    const own = isEmpty(index) ? Number.POSITIVE_INFINITY : node.spacing;
    const sizes = new Float32Array(OCTANTS).fill(own);
    let fine = own;
    for (let k = 0; k < node.childCount; k++) {
      const child = node.firstChild + k;
      const below = finest.get(child);
      if (below !== undefined && Number.isFinite(below)) {
        sizes[nodes[child].octant % OCTANTS] = below;
        fine = Math.min(fine, below);
      }
    }
    finest.set(index, fine);
    if (Number.isFinite(own)) {
      out.set(index, sizes);
    }
  }
  return out;
}

/** Whether two octant tables hold the same spacings. */
export function sameSizes(a: Float32Array, b: Float32Array): boolean {
  for (let k = 0; k < OCTANTS; k++) {
    if (a[k] !== b[k]) {
      return false;
    }
  }
  return true;
}
