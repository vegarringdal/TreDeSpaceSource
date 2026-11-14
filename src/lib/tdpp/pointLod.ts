// Level-of-detail selection over .tdpp hierarchies (additive octree LOD: a
// node's points add to its ancestors'). Pure functions — the streamer feeds
// them the camera and the open clouds and gets back the nodes to have
// resident and draw, in priority order. Each cloud is evaluated in its own
// origin-relative frame so no absolute (large) coordinate reaches f32.
import type { TdppNode } from './tdppFormat';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type Vec3 = readonly [number, number, number];

/** One cloud as the selector sees it. */
export interface LodCloud {
  readonly nodes: readonly TdppNode[];
  /** Frustum planes in the cloud's frame: 5 × (nx, ny, nz, d), inside = dot(n, p) + d >= 0. */
  readonly planes: Float32Array;
  /** Eye in the cloud's frame. */
  readonly eye: Vec3;
  /** Points a node costs against the budget (default: its point count) — a
   *  setup filter prices the nodes it empties at 0, so they are still walked. */
  readonly cost?: (node: TdppNode) => number;
  /** The clip planes / boxes of the scene, in the cloud's frame: true when a
   *  sphere is cut away entirely (radius 0 = a point). A node whose cube is
   *  cut away is skipped with everything below it, and one cut partly is
   *  charged only for the share that is left. Unset = nothing is clipped. */
  readonly clipped?: (center: Vec3, radius: number) => boolean;
}

export interface LodView {
  readonly ortho: boolean;
  /** Projected px per world unit at distance 1 (perspective) or flat (ortho): P11 · viewportH / 2. */
  readonly pxScale: number;
}

export interface LodOptions {
  /** Most points drawn over all clouds. */
  readonly budget: number;
  /** Refine a node while its point spacing projects larger than this (px). */
  readonly minPx: number;
  /** Skip nodes whose cube is farther from the eye than this (0 / unset = no
   *  limit). A node reaching past it is charged to the budget only for the
   *  share of it within range, so the budget is spent on what is shown. */
  readonly maxDistance?: number;
  /** Beyond this distance from the eye the detail falls off (a node's
   *  priority is scaled by focus / distance), so under a tight budget the
   *  near surroundings are refined first and the far ones stay coarser
   *  (0 / unset = even detail on screen; perspective only). */
  readonly focusDistance?: number;
  /** Charge a node only for the share of it inside the view (and the max
   *  distance): the budget then counts what is on screen, not the parts of
   *  large nodes that reach outside it — finer detail, more points held. */
  readonly inViewCost?: boolean;
  /** Most points of the picked nodes counted WHOLE (0 / unset = no cap). A
   *  node charged for a share of itself is still loaded and drawn whole, so
   *  the budget alone does not bound what reaches the GPU; this does. */
  readonly maxHeld?: number;
}

/** A node waiting in the walk's queue. */
interface LodCandidate {
  readonly cloud: number;
  readonly node: number;
  /** Projected spacing, px (larger = more urgent). */
  readonly priority: number;
}

/** A node the walk picked. */
export interface LodPick extends LodCandidate {
  /** Points this node was charged to the budget: all of its own, or the
   *  estimated share in view / in range / not clipped away. */
  readonly cost: number;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const PLANE_COUNT = 5;
/** Distance floor for the projection (eye inside a node's cube). */
const MIN_DIST = 1e-3;
/** Samples per axis of the in-range estimate (rangeShare). */
const SHARE_SAMPLES = 4;

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

/** Side + near planes of a column-major view-projection (reversed-Z: the near
 *  plane is z <= w; the far plane is at infinity and skipped). */
export function frustumPlanes(m: ArrayLike<number>): Float32Array {
  const row = (r: number) => [m[r], m[4 + r], m[8 + r], m[12 + r]];
  const w = row(3);
  const out = new Float32Array(PLANE_COUNT * 4);
  const combos: [number[], number][] = [
    [row(0), 1],
    [row(0), -1],
    [row(1), 1],
    [row(1), -1],
    [row(2), -1],
  ];
  combos.forEach(([a, sign], i) => {
    const p = [w[0] + sign * a[0], w[1] + sign * a[1], w[2] + sign * a[2], w[3] + sign * a[3]];
    const l = Math.hypot(p[0], p[1], p[2]) || 1;
    out.set([p[0] / l, p[1] / l, p[2] / l, p[3] / l], i * 4);
  });
  return out;
}

/** Whether a node's cube (it bounds every descendant) touches the frustum. */
export function cubeVisible(node: TdppNode, planes: Float32Array): boolean {
  const s = node.cubeSize;
  const [x, y, z] = node.cubeMin;
  for (let i = 0; i < PLANE_COUNT; i++) {
    const nx = planes[i * 4];
    const ny = planes[i * 4 + 1];
    const nz = planes[i * 4 + 2];
    const px = nx >= 0 ? x + s : x;
    const py = ny >= 0 ? y + s : y;
    const pz = nz >= 0 ? z + s : z;
    if (nx * px + ny * py + nz * pz + planes[i * 4 + 3] < 0) {
      return false;
    }
  }
  return true;
}

/** Distance from the eye to a node's cube (0 inside it). */
export function cubeDistance(node: TdppNode, eye: Vec3): number {
  const s = node.cubeSize;
  let d2 = 0;
  for (let k = 0; k < 3; k++) {
    const lo = node.cubeMin[k];
    const v = eye[k] < lo ? lo - eye[k] : eye[k] > lo + s ? eye[k] - lo - s : 0;
    d2 += v * v;
  }
  return Math.sqrt(d2);
}

/**
 * Estimated share (0..1) of a node's points that count: those within `far` of
 * the eye, inside the view frustum when `planes` is given, and not cut away
 * when `clipped` is — the fraction
 * of sample positions in its tight bounds that pass. Rough (points sit on
 * surfaces, not evenly in the box), but it only prices a node that straddles
 * the limit; never 0, so a node that touches it still costs something.
 */
export function rangeShare(
  node: TdppNode,
  eye: Vec3,
  far: number,
  planes?: Float32Array,
  clipped?: (center: Vec3, radius: number) => boolean,
): number {
  const lo = node.boundsMin;
  const hi = node.boundsMax;
  const far2 = far * far;
  if (!planes && !clipped) {
    let worst = 0;
    for (let k = 0; k < 3; k++) {
      const d = Math.max(Math.abs(eye[k] - lo[k]), Math.abs(eye[k] - hi[k]));
      worst += d * d;
    }
    if (worst <= far2) {
      return 1;
    }
  }
  const n = SHARE_SAMPLES;
  const at = (k: number, i: number) => lo[k] + ((i + 0.5) / n) * (hi[k] - lo[k]);
  let inside = 0;
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      for (let z = 0; z < n; z++) {
        const p: Vec3 = [at(0, x), at(1, y), at(2, z)];
        const d2 = (p[0] - eye[0]) ** 2 + (p[1] - eye[1]) ** 2 + (p[2] - eye[2]) ** 2;
        if (d2 <= far2 && (!planes || pointVisible(p, planes)) && !clipped?.(p, 0)) {
          inside++;
        }
      }
    }
  }
  return Math.max(inside, 1) / (n * n * n);
}

function pointVisible(p: Vec3, planes: Float32Array): boolean {
  for (let i = 0; i < PLANE_COUNT; i++) {
    if (planes[i * 4] * p[0] + planes[i * 4 + 1] * p[1] + planes[i * 4 + 2] * p[2] + planes[i * 4 + 3] < 0) {
      return false;
    }
  }
  return true;
}

/** Half the diagonal of a unit cube: a node cube's bounding-sphere radius per size. */
const CUBE_RADIUS = Math.sqrt(3) / 2;

/** Whether a node's cube — and so every node below it — is cut away by the
 *  scene's clip planes / boxes. */
export function cubeClipped(node: TdppNode, clipped: LodCloud['clipped']): boolean {
  if (!clipped) {
    return false;
  }
  const h = node.cubeSize / 2;
  return clipped([node.cubeMin[0] + h, node.cubeMin[1] + h, node.cubeMin[2] + h], node.cubeSize * CUBE_RADIUS);
}

/** Projected point spacing of a node, px: its spacing over the eye's distance
 *  to the node cube (flat in ortho). Past `focus` (when set) it is scaled by
 *  focus / distance, so far nodes are refined later and less. */
export function nodePriority(node: TdppNode, eye: Vec3, view: LodView, focus = 0): number {
  if (view.ortho) {
    return node.spacing * view.pxScale;
  }
  const d = Math.max(cubeDistance(node, eye), MIN_DIST);
  const falloff = focus > 0 && d > focus ? focus / d : 1;
  return ((node.spacing * view.pxScale) / d) * falloff;
}

/** Binary max-heap on priority. */
class PickHeap {
  private readonly items: LodCandidate[] = [];

  get size(): number {
    return this.items.length;
  }

  push(p: LodCandidate) {
    const a = this.items;
    a.push(p);
    let i = a.length - 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (a[up].priority >= a[i].priority) {
        break;
      }
      [a[up], a[i]] = [a[i], a[up]];
      i = up;
    }
  }

  pop(): LodCandidate | undefined {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0 && last) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].priority > a[m].priority) {
          m = l;
        }
        if (r < a.length && a[r].priority > a[m].priority) {
          m = r;
        }
        if (m === i) {
          break;
        }
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Nodes to show, most urgent first, over every cloud under one point budget.
 * Best-first over the projected spacing: a node is taken when its cube is in
 * the frustum, not cut away by the clip planes / boxes, and its points
 * (those within the max distance, when one is set) still fit the budget; its children are queued
 * while its spacing projects above `minPx`. A parent always comes before its
 * children, so the list is closed under "parent of" — the draw set the
 * streamer derives from it never has a hole above a drawn node.
 */
export function selectNodes(clouds: readonly LodCloud[], view: LodView, opts: LodOptions): LodPick[] {
  const heap = new PickHeap();
  const far = !view.ortho && opts.maxDistance && opts.maxDistance > 0 ? opts.maxDistance : Number.POSITIVE_INFINITY;
  const focus = opts.focusDistance ?? 0;
  const partial = Number.isFinite(far) || opts.inViewCost === true;
  clouds.forEach((c, ci) => {
    const root = c.nodes[0];
    if (root && cubeVisible(root, c.planes) && cubeDistance(root, c.eye) <= far && !cubeClipped(root, c.clipped)) {
      heap.push({ cloud: ci, node: 0, priority: nodePriority(root, c.eye, view, focus) });
    }
  });
  const out: LodPick[] = [];
  const maxHeld = opts.maxHeld && opts.maxHeld > 0 ? opts.maxHeld : Number.POSITIVE_INFINITY;
  let total = 0;
  let held = 0;
  while (heap.size > 0) {
    const pick = heap.pop();
    if (!pick) {
      break;
    }
    const c = clouds[pick.cloud];
    const node = c.nodes[pick.node];
    const all = c.cost ? c.cost(node) : node.pointCount;
    const cost =
      partial || c.clipped
        ? all * rangeShare(node, c.eye, far, opts.inViewCost ? c.planes : undefined, c.clipped)
        : all;
    if (total + cost > opts.budget || held + all > maxHeld) {
      break;
    }
    total += cost;
    held += all;
    out.push({ ...pick, cost });
    if (pick.priority <= opts.minPx) {
      continue;
    }
    for (let k = 0; k < node.childCount; k++) {
      const ci = node.firstChild + k;
      const child = c.nodes[ci];
      if (
        child &&
        cubeVisible(child, c.planes) &&
        cubeDistance(child, c.eye) <= far &&
        !cubeClipped(child, c.clipped)
      ) {
        heap.push({ cloud: pick.cloud, node: ci, priority: nodePriority(child, c.eye, view, focus) });
      }
    }
  }
  return out;
}
