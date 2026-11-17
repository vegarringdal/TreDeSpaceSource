// Nearest scan point to a sight line — the measure tool's snap on point
// clouds. Pure: the streamer hands in the decoded nodes around the click.
import type { DecodedNode } from './tdppFormat';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type Vec3 = readonly [number, number, number];

export interface SnapQuery {
  /** Ray origin and unit direction, in the cloud's frame. */
  readonly origin: Vec3;
  readonly dir: Vec3;
  /** Distance along the ray of the depth-picked position. */
  readonly t: number;
  /** Largest distance from the ray, world units. */
  readonly radius: number;
  /** Keep only points this setup measured (null = all). */
  readonly onlySetup: number | null;
}

export interface SnapHit {
  readonly point: [number, number, number];
  /** Squared distance from the ray. */
  readonly d2: number;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** Depth window around the picked position, in radii (and a floor in metres):
 *  the snap must stay on the surface the cursor is on, not reach through a
 *  gap to what is behind. */
const DEPTH_RADII = 4;
const DEPTH_MIN = 0.02;

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

/** The point of `node` nearest the ray within the radius and the depth
 *  window, or null. `best` carries the winner over several nodes. */
export function nearestToRay(node: DecodedNode, q: SnapQuery, best: SnapHit | null = null): SnapHit | null {
  const window = Math.max(DEPTH_RADII * q.radius, DEPTH_MIN);
  let out = best;
  let limit = best ? best.d2 : q.radius * q.radius;
  const p = node.positions;
  for (let i = 0; i < node.count; i++) {
    if (q.onlySetup !== null && node.rgbs[4 * i + 3] !== q.onlySetup) {
      continue;
    }
    const x = p[3 * i] - q.origin[0];
    const y = p[3 * i + 1] - q.origin[1];
    const z = p[3 * i + 2] - q.origin[2];
    const t = x * q.dir[0] + y * q.dir[1] + z * q.dir[2];
    if (Math.abs(t - q.t) > window) {
      continue;
    }
    const d2 = x * x + y * y + z * z - t * t;
    if (d2 <= limit) {
      limit = d2;
      out = { point: [p[3 * i], p[3 * i + 1], p[3 * i + 2]], d2 };
    }
  }
  return out;
}

/** Whether a position lies in a box grown by `pad`. */
export function boxContains(min: Vec3, max: Vec3, p: Vec3, pad: number): boolean {
  return [0, 1, 2].every((k) => p[k] >= min[k] - pad && p[k] <= max[k] + pad);
}
