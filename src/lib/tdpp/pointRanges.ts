// Ranges: a streamed .tdpp node cut into spatial groups, so the part of it
// outside the view is not drawn. A node is loaded and held whole (its streams
// are compressed whole), but nearly every node of a scan seen from inside is
// cut by the view edge — drawn whole, most of the vertex work goes to points
// that are not in the picture. The node's 256-point clusters are grouped by
// position and written group by group, so each group is one contiguous run of
// the node's GPU buffer with a tight box; a round then draws only the runs
// whose box touches the view. Pure functions.
import type { DecodedNode, Vec3 } from './tdppFormat';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** How a node's clusters are grouped: the order to write them in. */
export interface RangeLayout {
  /** Cluster indices in buffer order. */
  readonly order: Uint32Array;
  /** Per range: one past its last cluster in `order`. */
  readonly ends: Uint32Array;
  /** Per range: tight min xyz, max xyz of its points (6 floats, cloud frame). */
  readonly boxes: Float32Array;
}

/** The ranges of a packed node, in buffer order. */
export interface PointRanges {
  /** Per range: first point and point count in the node's buffer (2 words). */
  readonly spans: Uint32Array;
  /** Per range: tight min xyz, max xyz (6 floats, cloud frame). */
  readonly boxes: Float32Array;
}

/** What a round culls the ranges against, in the cloud's frame. */
export interface RangeView {
  /** Frustum planes (pointLod's `frustumPlanes`), widened by the point size. */
  readonly planes: Float32Array;
  readonly eye: Vec3;
  /** Points farther than this are not drawn (Infinity = no limit). */
  readonly far: number;
  /** The scene's clip test: true when a sphere is cut away entirely. */
  readonly clipped?: (center: Vec3, radius: number) => boolean;
}

/** A node of which only some ranges were uploaded ("load only what is in
 *  view"): the boxes of ALL its ranges and which of them are on the GPU. */
export interface PartialNode {
  /** Per range of the whole node: tight min xyz, max xyz (6 floats). */
  readonly boxes: Float32Array;
  /** Per range: 1 = uploaded, 0 = left out (it was outside the load view). */
  readonly kept: Uint8Array;
}

/** What to draw of a node: `runs` = first, count, first, count… of its
 *  buffer, or null for all of it. */
export interface RangeDraw {
  readonly runs: Uint32Array | null;
  readonly points: number;
}

interface Group {
  readonly ids: number[];
  readonly min: Vec3;
  readonly size: number;
  readonly depth: number;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** Most points of a range. Smaller culls closer to the view edge and makes
 *  more draws: measured on a 415 M point scan seen from inside, 8192 draws a
 *  third of what whole nodes do at about three draws a node. */
export const RANGE_POINTS = 8192;
/** Octant splits at most (a range of coincident clusters would never split). */
const MAX_SPLITS = 6;
const PLANE_COUNT = 5;
const BOX_FLOATS = 6;

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

/** Whether a box (6 floats at `o`) lies outside one of the planes entirely. */
function boxOutside(planes: Float32Array, b: Float32Array, o: number): boolean {
  for (let i = 0; i < PLANE_COUNT; i++) {
    const nx = planes[i * 4];
    const ny = planes[i * 4 + 1];
    const nz = planes[i * 4 + 2];
    const px = nx >= 0 ? b[o + 3] : b[o];
    const py = ny >= 0 ? b[o + 4] : b[o + 1];
    const pz = nz >= 0 ? b[o + 5] : b[o + 2];
    if (nx * px + ny * py + nz * pz + planes[i * 4 + 3] < 0) {
      return true;
    }
  }
  return false;
}

/** Distance from the eye to a box (0 inside it). */
function boxDistance(eye: Vec3, b: Float32Array, o: number): number {
  let d2 = 0;
  for (let k = 0; k < 3; k++) {
    const v = eye[k] < b[o + k] ? b[o + k] - eye[k] : eye[k] > b[o + 3 + k] ? eye[k] - b[o + 3 + k] : 0;
    d2 += v * v;
  }
  return Math.sqrt(d2);
}

/** Whether a box (6 floats at `o` of `b`) is in a view: touches its frustum,
 *  lies within its max distance and is not clipped away. */
export function boxInView(b: Float32Array, o: number, view: RangeView): boolean {
  if (boxOutside(view.planes, b, o) || boxDistance(view.eye, b, o) > view.far) {
    return false;
  }
  if (!view.clipped) {
    return true;
  }

  const center: Vec3 = [(b[o] + b[o + 3]) / 2, (b[o + 1] + b[o + 4]) / 2, (b[o + 2] + b[o + 5]) / 2];
  const radius = Math.hypot(b[o + 3] - b[o], b[o + 4] - b[o + 1], b[o + 5] - b[o + 2]) / 2;
  return !view.clipped(center, radius);
}

// -----------------------------------------------------------------------------
// Layout
// -----------------------------------------------------------------------------

/**
 * Group a decoded node's clusters into ranges of at most `limit` points: the
 * node's cube is split by the octant of each cluster's centre, again and again
 * while a group is too large. The groups come out depth-first, so neighbours
 * in the order are neighbours in space — two visible ranges are then often
 * adjacent and drawn as one. Null when the node is one range (nothing to cut).
 */
export function layoutRanges(
  d: Pick<DecodedNode, 'count' | 'clusterCount' | 'clusterBounds'>,
  cubeMin: Vec3,
  cubeSize: number,
  limit: number = RANGE_POINTS,
): RangeLayout | null {
  const clusters = d.clusterCount.length;
  if (d.count <= limit || clusters < 2) {
    return null;
  }

  const order: number[] = [];
  const ends: number[] = [];
  const boxes: number[] = [];
  const all = Array.from({ length: clusters }, (_, i) => i);
  const stack: Group[] = [{ ids: all, min: cubeMin, size: cubeSize, depth: 0 }];
  for (let g = stack.pop(); g; g = stack.pop()) {
    let points = 0;
    for (const c of g.ids) {
      points += d.clusterCount[c];
    }
    if (points <= limit || g.ids.length === 1 || g.depth >= MAX_SPLITS) {
      const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (const c of g.ids) {
        for (let k = 0; k < 3; k++) {
          box[k] = Math.min(box[k], d.clusterBounds[c * BOX_FLOATS + k]);
          box[k + 3] = Math.max(box[k + 3], d.clusterBounds[c * BOX_FLOATS + 3 + k]);
        }
      }
      order.push(...g.ids);
      ends.push(order.length);
      boxes.push(...box);
      continue;
    }
    const half = g.size / 2;
    const parts: number[][] = [[], [], [], [], [], [], [], []];
    for (const c of g.ids) {
      let octant = 0;
      for (let k = 0; k < 3; k++) {
        const centre = (d.clusterBounds[c * BOX_FLOATS + k] + d.clusterBounds[c * BOX_FLOATS + 3 + k]) / 2;
        if (centre >= g.min[k] + half) {
          octant |= 1 << k;
        }
      }
      parts[octant].push(c);
    }
    // pushed last to first, so the octants are popped (and written) in order
    for (let octant = 7; octant >= 0; octant--) {
      if (parts[octant].length > 0) {
        const min: Vec3 = [
          g.min[0] + (octant & 1 ? half : 0),
          g.min[1] + (octant & 2 ? half : 0),
          g.min[2] + (octant & 4 ? half : 0),
        ];
        stack.push({ ids: parts[octant], min, size: half, depth: g.depth + 1 });
      }
    }
  }
  if (ends.length < 2) {
    return null;
  }

  return { order: Uint32Array.from(order), ends: Uint32Array.from(ends), boxes: Float32Array.from(boxes) };
}

// -----------------------------------------------------------------------------
// Culling
// -----------------------------------------------------------------------------

/**
 * The runs of a node to draw for a view: its ranges whose box touches the
 * frustum, lies within the max distance and is not clipped away, adjacent
 * ones joined. `total` is the node's point count; when every range passes the
 * node is drawn whole (`runs` null — one draw).
 */
export function visibleRuns(r: PointRanges, total: number, view: RangeView): RangeDraw {
  const ranges = r.spans.length / 2;
  const runs: number[] = [];
  let points = 0;
  let isOpen = false;
  for (let i = 0; i < ranges; i++) {
    if (!boxInView(r.boxes, i * BOX_FLOATS, view)) {
      isOpen = false;
      continue;
    }
    const first = r.spans[2 * i];
    const count = r.spans[2 * i + 1];
    points += count;
    if (isOpen) {
      runs[runs.length - 1] += count;
    } else {
      runs.push(first, count);
      isOpen = true;
    }
  }
  if (points === total) {
    return { runs: null, points };
  }

  return { runs: Uint32Array.from(runs), points };
}

/**
 * Whether loading a partly uploaded node again would help: it lacks a range
 * that the view needs (`need`) AND that a load now would keep (`load`, the
 * wider view a node is packed for). The second test is not implied by the
 * first: the box tests are conservative, and for a box beside or behind the
 * eye the wider frustum can reject what the narrower one lets through.
 * Without it such a node is fetched again and again, each time coming back
 * exactly as it was.
 */
export function needsMore(p: PartialNode, need: RangeView, load: RangeView): boolean {
  for (let i = 0; i < p.kept.length; i++) {
    const o = i * BOX_FLOATS;
    if (p.kept[i] === 0 && boxInView(p.boxes, o, need) && boxInView(p.boxes, o, load)) {
      return true;
    }
  }
  return false;
}
