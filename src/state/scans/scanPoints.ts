// Point streaming for the open laser scans: every frame the viewport ticks
// this; when the view, the settings or the resident set changed it re-runs
// the LOD selection (lib/tdpp/pointLod.ts), queues the missing nodes (read
// from OPFS → meshopt decode → GPU buffer, a few at a time), hands the
// renderer the drawn set, and evicts the least recently wanted nodes once the
// GPU cache outgrows the budget. GPU handles live here, never in a store.

import { consoleActions } from '../../components/panels/console/console.actions';
import { clipCulledSphere } from '../../lib/render/clipCull';
import type { PointCloudDraw, PointNodeDraw, PointNodeGpu, PointStyle } from '../../lib/render/pointsLayer';
import type { Renderer } from '../../lib/render/renderer';
import { POINT_HEADER_WORDS, POINT_OCTANTS, POINT_WORDS } from '../../lib/render/shaders/points';
import { boxToScene, type CloudAxes, planesToCloud, toCloud, toScene } from '../../lib/tdpp/cloudFrame';
import { decodeNodeJob } from '../../lib/tdpp/pointDecodePool';
import { frustumPlanes, type LodCloud, selectNodes, type Vec3 } from '../../lib/tdpp/pointLod';
import { needsMore, type PartialNode, type PointRanges, type RangeView, visibleRuns } from '../../lib/tdpp/pointRanges';
import { octantSpacings, sameSizes } from '../../lib/tdpp/pointSizes';
import { boxContains, nearestToRay, type SnapHit } from '../../lib/tdpp/pointSnap';
import { type DecodedNode, decodeNode } from '../../lib/tdpp/tdppFormat';
import { pointPerf } from './pointPerf';
import { pointStatsState } from './pointStats.state';
import { arePointsShown, hiddenKeepMs, type PointsMode } from './pointsMode';
import { type OpenScan, openScans } from './scanFiles';
import { type ScansState, scansState } from './scans.state';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface Resident {
  readonly gpu: PointNodeGpu;
  /** The spatial groups its points were written in (null: too small to cut):
   *  only those in view are drawn. */
  readonly ranges: PointRanges | null;
  /** Set when only the ranges in view were uploaded ("load only what is in
   *  view"): what the node lacks. It is loaded again when the view needs more. */
  readonly partial: PartialNode | null;
  /** The view (`lastView`) the node was packed in: with the view unchanged a
   *  reload would bring back the same ranges, so none is started. */
  readonly packedView: string;
  /** Selection round that last wanted this node (LRU). */
  lastUsed: number;
  /** The spacing per octant written into the node header (the adaptive
   *  size's reference, lib/tdpp/pointSizes.ts). */
  sizes: Float32Array<ArrayBuffer>;
  /** Loaded and not yet seen by a selection round (pointPerf: "not wanted"). */
  isFresh: boolean;
}

/** "Only this setup's points": the cloud and the per-point setup id kept. */
interface SetupFilter {
  readonly assetId: string;
  readonly setup: number;
}

interface CloudCache {
  readonly assetId: string;
  readonly scan: OpenScan;
  readonly resident: Map<number, Resident>;
  readonly loading: Set<number>;
  /** Nodes that could not be loaded: attempts so far and the round of the last. */
  readonly failed: Map<number, { attempts: number; round: number }>;
  residentPoints: number;
  /** "Load only what is in view": the view a node packed now keeps the
   *  ranges of (wider than the picture); null = nodes are uploaded whole. */
  loadView: RangeView | null;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** Node fetches in flight at once. */
const MAX_INFLIGHT = 4;
/** Most points drawn, in budgets. Charging a node only for its share in view
 *  (or in range, or unclipped) lets the walk pick nodes far beyond the budget
 *  — they are drawn whole — so the whole-node total is capped too. */
const MAX_DRAWN_BUDGETS = 2;
const MILLION = 1_000_000;
const SETUP_MASK_LAST = 63;
/** Decoded nodes kept for the measure snap (points; ≈ 16 B each). The nodes
 *  of the query in progress are kept on top of it — one LOD path of a dense
 *  scan is larger than this. */
const SNAP_CACHE_POINTS = 1_500_000;
/** "Load only what is in view": a node keeps the ranges within the view
 *  widened by this share of the half view on every side… */
const LOAD_GUARD = 0.6;
/** …and is loaded again once a range it lacks comes within this share: the
 *  gap between the two is how far the camera turns before anything streams. */
const NEED_GUARD = 0.25;
/** "Lighter while moving": the share of the budget drawn while the view
 *  changes. The nodes stay loaded — only the draw list is cut… */
const MOVING_BUDGET_SHARE = 0.3;
/** …until the view has stood still this long. */
const MOVE_SETTLE_MS = 200;
/** FNV prime: folds the drawn runs into the draw key. */
const HASH_PRIME = 16777619;
/** Attempts a node gets to load before it is given up for the session… */
const MAX_NODE_ATTEMPTS = 3;
/** …a retry waits this many selection rounds (the view has moved on a bit). */
const NODE_RETRY_ROUNDS = 30;
/** In the free view of "only inside a setup" the nodes stay on the GPU this
 *  long: stepping out of a setup and into the next does not restream. */
const RELEASE_HIDDEN_MS = 5000;

let bound: Renderer | null = null;
const caches = new Map<string, CloudCache>();
let round = 0;
let lastKey = '';
/** The view (camera + settings) of the last tick and when it last changed:
 *  "lighter while moving" draws less until it has stood still for a moment. */
let lastView = '';
let lastMoveAt = 0;
let lastDrawKey = '';
let dirty = true;
let inflight = 0;
let filter: SetupFilter | null = null;
/** "Load only what is in view" as the resident nodes were packed for. */
let inViewLoad = false;
/** Buffers replaced by a reload: still in the renderer's draw list, so they
 *  are destroyed only after the next round has handed it a new one. */
const retired: PointNodeGpu[] = [];
/** A node was replaced: the draw list must be rebuilt although its key is the same. */
let isDrawStale = false;
/** When the points stopped being shown (performance.now()) and in which
 *  mode; null while shown. A change of mode starts the count again. */
let hiddenSince: number | null = null;
let hiddenMode: PointsMode | null = null;
/** Recently decoded nodes for the measure snap, oldest first (`asset:node`). */
const snapCache = new Map<string, DecodedNode>();
/** Keys the snap query in progress has read: never evicted under it. */
const snapInUse = new Set<string>();

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

function styleOf(s: ScansState): PointStyle {
  return {
    sizePx: s.pointSize,
    adaptive: s.adaptive,
    adaptiveMaxPx: s.pointAdaptiveMax,
    colorMode: s.colorMode,
    maxDistance: s.pointMaxDistance,
  };
}

/** ClipData words (clipPack.ts): the enabled-planes mask and, per shape, its kind. */
const CLIP_MASK_WORD = 32;
const CLIP_SHAPES_WORD = 36;
const CLIP_SHAPE_WORDS = 28;
const CLIP_KIND_WORD = 24;
const CLIP_SHAPE_COUNT = 8;

/**
 * The scene's clip test for one cloud, taking positions in the cloud's own
 * frame (relative to its origin, along its axes); undefined when no plane or
 * shape is enabled, so an unclipped scene pays nothing.
 */
function clipTest(r: Renderer, origin: Vec3, axes: CloudAxes): LodCloud['clipped'] {
  const clip = r.clipData;
  const words = r.clipDataU32;
  if (!clip || !words) {
    return undefined;
  }
  let active = words[CLIP_MASK_WORD] !== 0;
  for (let i = 0; i < CLIP_SHAPE_COUNT && !active; i++) {
    active = words[CLIP_SHAPES_WORD + i * CLIP_SHAPE_WORDS + CLIP_KIND_WORD] !== 0;
  }
  if (!active) {
    return undefined;
  }
  return (center, radius) => {
    const p = toScene(axes, center);
    return clipCulledSphere(clip, words, [p[0] + origin[0], p[1] + origin[1], p[2] + origin[2]], radius);
  };
}

function viewKey(r: Renderer, canvas: HTMLCanvasElement, s: ScansState): string {
  const c = r.camera;
  return [
    ...c.eye(),
    ...c.forward(),
    c.fovY,
    c.ortho,
    c.orthoHalfH,
    canvas.width,
    canvas.height,
    s.pointSize,
    s.pointBudget,
    s.pointMaxDistance,
    s.pointFocusDistance,
    s.pointInViewBudget,
    s.pointDetail,
    s.pointCache,
    r.clipRevision,
    s.hidden.join('|'),
  ].join(',');
}

function dropCache(r: Renderer, c: CloudCache) {
  for (const res of c.resident.values()) {
    r.points.destroyNode(res.gpu);
  }
  c.resident.clear();
  c.failed.clear();
  c.residentPoints = 0;
}

/** The setup filter the state asks for: on, inside a setup, and the file
 *  stores which setup measured each point. */
function wantedFilter(s: ScansState): SetupFilter | null {
  const view = s.onlySetupPoints && s.active ? s.setups.find((v) => v.key === s.active) : undefined;
  const file = view ? openScans.get(view.assetId)?.file : undefined;
  const setup = view && file?.header.hasSetup ? file.meta.setups[view.setup]?.index : null;
  return view && typeof setup === 'number' ? { assetId: view.assetId, setup } : null;
}

/** Whether a node holds any point of the filtered setup (node mask: one bit
 *  per setup, the last bit shared by setups 63 and up). */
function nodeHasSetup(mask: bigint, setup: number): boolean {
  return (mask & (1n << BigInt(Math.min(setup, SETUP_MASK_LAST)))) !== 0n;
}

/** A changed filter re-packs every node: drop the GPU cache and restream. */
function applyFilter(r: Renderer, next: SetupFilter | null) {
  if (next?.assetId === filter?.assetId && next?.setup === filter?.setup) {
    return;
  }
  filter = next;
  lastDrawKey = '';
  r.points.setClouds([]);
  for (const c of caches.values()) {
    dropCache(r, c);
  }
  dirty = true;
}

/** Union of the open clouds' absolute boxes (the renderer's scene box). */
function cloudBounds(): { min: number[]; max: number[] } | null {
  if (caches.size === 0) {
    return null;
  }
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const c of caches.values()) {
    const h = c.scan.file.header;
    const box = boxToScene(c.scan.file.meta.axes, h.boundsMin, h.boundsMax);
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], h.origin[k] + box.min[k]);
      max[k] = Math.max(max[k], h.origin[k] + box.max[k]);
    }
  }
  return { min, max };
}

/** Follow the open-scan registry: new scans get a cache, closed ones free
 *  theirs. True when the set of open scans (so the scene box) changed. */
function syncOpen(r: Renderer): boolean {
  let changed = false;
  for (const [id, c] of caches) {
    if (openScans.get(id) !== c.scan) {
      dropCache(r, c);
      caches.delete(id);
      changed = true;
    }
  }
  for (const [id, scan] of openScans) {
    if (!caches.has(id)) {
      caches.set(id, {
        assetId: id,
        scan,
        loadView: null,
        resident: new Map(),
        loading: new Set(),
        failed: new Map(),
        residentPoints: 0,
      });
      changed = true;
    }
  }
  if (changed) {
    snapCache.clear();
    r.setPointBounds(cloudBounds());
    dirty = true;
  }
  return changed;
}

/** A node's decoded points for the snap, through a small LRU (the GPU copy
 *  cannot be read back cheaply, and keeping every node on the CPU too would
 *  double the memory). */
async function snapNode(c: CloudCache, index: number): Promise<DecodedNode | null> {
  const key = `${c.assetId}:${index}`;
  snapInUse.add(key);
  const have = snapCache.get(key);
  if (have) {
    snapCache.delete(key);
    snapCache.set(key, have);
    return have;
  }
  const node = c.scan.file.nodes[index];
  const dec = await decodeNode(node, await c.scan.src.read(node.payloadOffset, node.payloadSize));
  if (!dec.data) {
    return null;
  }
  snapCache.set(key, dec.data);
  let held = 0;
  for (const d of snapCache.values()) {
    held += d.count;
  }
  for (const [k, d] of snapCache) {
    if (held <= SNAP_CACHE_POINTS) {
      break;
    }
    if (snapInUse.has(k)) {
      continue;
    }
    snapCache.delete(k);
    held -= d.count;
  }
  return dec.data;
}

/**
 * The drawn scan point nearest a sight line around `near` (the depth-picked
 * position): only the drawn nodes whose own points reach that spot are read
 * back from the file — the few on the LOD path there.
 */
async function snapToPoint(
  ray: { origin: readonly number[]; dir: readonly number[] },
  near: Vec3,
  radius: number,
): Promise<[number, number, number] | null> {
  let best: SnapHit | null = null;
  let from: Vec3 = [0, 0, 0];
  let fromAxes: CloudAxes = null;
  snapInUse.clear();
  for (const c of caches.values()) {
    if ((filter && filter.assetId !== c.assetId) || scansState.get().hidden.includes(c.assetId)) {
      continue;
    }
    // the stored points are searched in the cloud's own axes
    const o = c.scan.file.header.origin;
    const axes = c.scan.file.meta.axes;
    const rel: Vec3 = toCloud(axes, [near[0] - o[0], near[1] - o[1], near[2] - o[2]]);
    const origin: Vec3 = toCloud(axes, [ray.origin[0] - o[0], ray.origin[1] - o[1], ray.origin[2] - o[2]]);
    const dir: Vec3 = toCloud(axes, [ray.dir[0], ray.dir[1], ray.dir[2]]);
    const t = (rel[0] - origin[0]) * dir[0] + (rel[1] - origin[1]) * dir[1] + (rel[2] - origin[2]) * dir[2];
    const query = { origin, dir, t, radius, onlySetup: filter ? filter.setup : null };
    for (const [index, res] of [...c.resident]) {
      const node = c.scan.file.nodes[index];
      if (res.gpu.count === 0 || !boxContains(node.boundsMin, node.boundsMax, rel, radius)) {
        continue;
      }
      const decoded = await snapNode(c, index).catch(() => null);
      const hit: SnapHit | null = decoded ? nearestToRay(decoded, query, best) : best;
      if (hit !== best) {
        best = hit;
        from = o;
        fromAxes = axes;
      }
    }
  }
  if (!best) {
    return null;
  }
  const p = toScene(fromAxes, [best.point[0], best.point[1], best.point[2]]);
  return [p[0] + from[0], p[1] + from[1], p[2] + from[2]];
}

function markFailed(c: CloudCache, index: number) {
  c.failed.set(index, { attempts: (c.failed.get(index)?.attempts ?? 0) + 1, round });
}

/** Whether a node may be fetched now: its parent is there or on its way (a
 *  node under a missing parent could never be drawn), and it has not failed
 *  too often or too recently. */
function canLoad(c: CloudCache, index: number): boolean {
  const parent = c.scan.file.nodes[index].parent;
  if (parent >= 0 && !c.resident.has(parent) && !c.loading.has(parent)) {
    return false;
  }
  const f = c.failed.get(index);
  return !f || (f.attempts < MAX_NODE_ATTEMPTS && round - f.round >= NODE_RETRY_ROUNDS);
}

/** Fetch, decode and upload one node; marks the streamer dirty when done. */
async function load(r: Renderer, c: CloudCache, index: number) {
  const node = c.scan.file.nodes[index];
  const only = filter;
  c.loading.add(index);
  inflight++;
  pointPerf.loadStarted(performance.now());
  try {
    let words = new Uint32Array(POINT_HEADER_WORDS);
    let ranges: PointRanges | null = null;
    let partial: PartialNode | null = null;
    let packedView = lastView;
    let readMs = 0;
    let decodeMs = 0;
    let packMs = 0;
    let isOffThread = false;
    // an empty node (a structural ancestor) has no payload to read
    if (node.pointCount > 0 && (!only || nodeHasSetup(node.setupMask, only.setup))) {
      const readAt = performance.now();
      const payload = await c.scan.src.read(node.payloadOffset, node.payloadSize);
      readMs = performance.now() - readAt;
      // the view as it is now, not as it was when the fetch started
      const view = c.loadView;
      packedView = lastView;
      // decoded and packed in a worker (pointDecodePool.ts), so a full node
      // does not take a frame's worth of main thread
      const done = await decodeNodeJob({
        node,
        payload,
        header: { hasColor: c.scan.file.header.hasColor, hasIntensity: c.scan.file.header.hasIntensity },
        onlySetup: only ? only.setup : null,
        loadView: view ? { planes: view.planes, eye: view.eye, far: view.far } : null,
        grid: c.scan.file.meta.gridScale,
      });
      if (!done.data) {
        markFailed(c, index);
        consoleActions.log('error', `Scans: ${c.scan.name}: ${done.error?.msg ?? 'node decode failed'}`);
        return;
      }
      words = done.data.words;
      ranges = done.data.ranges;
      partial = done.data.partial;
      decodeMs = done.data.decodeMs;
      packMs = done.data.packMs;
      isOffThread = done.data.isOffThread;
    }
    if (bound !== r || caches.get(c.assetId) !== c || filter !== only) {
      pointPerf.dropped();
      return; // closed, the device was replaced or the filter changed meanwhile
    }
    const count = (words.length - POINT_HEADER_WORDS) / POINT_WORDS;
    const uploadAt = performance.now();
    const gpu = r.points.createNode(words, count);
    if (!gpu) {
      markFailed(c, index);
      return;
    }
    const uploadMs = performance.now() - uploadAt;
    c.failed.delete(index);
    const sizes = new Float32Array(POINT_OCTANTS).fill(node.spacing);
    const old = c.resident.get(index);
    if (old) {
      // a reload with more ranges: the old buffer is drawn until the next round
      retired.push(old.gpu);
      c.residentPoints -= old.gpu.count;
      isDrawStale = true;
    }
    c.resident.set(index, { gpu, ranges, partial, packedView, lastUsed: round, sizes, isFresh: !old });
    c.residentPoints += count;
    pointPerf.nodeLoaded({
      readMs,
      decodeMs,
      packMs,
      uploadMs,
      isOffThread,
      points: count,
      bytes: words.byteLength,
    });
  } catch (e) {
    markFailed(c, index);
    consoleActions.log('error', `Scans: ${c.scan.name}: node ${index} could not be read: ${e}`);
  } finally {
    c.loading.delete(index);
    inflight--;
    dirty = true;
  }
}

/**
 * Drop the least recently wanted nodes until the cache fits; never one the
 * current round wants. The cache is what is held BEYOND the wanted nodes:
 * those are charged to the budget by their share in view / in range / unclipped
 * but are resident whole, so they alone can exceed budget × (1 + cache) —
 * measured against that, nothing idle would ever be kept. And it is measured
 * from what is wanted, not from the budget: a max distance or a clip box that
 * leaves little to draw then frees the memory too, instead of leaving a full
 * budget of idle nodes behind.
 */
function evict(r: Renderer, budget: number) {
  let total = 0;
  let wanted = 0;
  const idle: { c: CloudCache; index: number; res: Resident }[] = [];
  for (const c of caches.values()) {
    total += c.residentPoints;
    for (const [index, res] of c.resident) {
      if (res.lastUsed < round) {
        idle.push({ c, index, res });
        if (res.isFresh) {
          // loaded for a view that had moved on before the node arrived
          res.isFresh = false;
          pointPerf.notWanted();
        }
      } else {
        wanted += res.gpu.count;
      }
    }
  }
  const cap = wanted + (budget * scansState.get().pointCache) / 100;
  idle.sort((a, b) => a.res.lastUsed - b.res.lastUsed);
  for (const { c, index, res } of idle) {
    if (total <= cap) {
      break;
    }
    const n = res.gpu.count;
    r.points.destroyNode(res.gpu);
    c.resident.delete(index);
    c.residentPoints -= n;
    total -= n;
  }
}

/**
 * One selection round: pick the wanted nodes, start fetching the missing ones
 * (most urgent first), and draw the resident ones whose parent is drawn too —
 * an additive LOD with a gap in its chain would show a hole. Each drawn node
 * gets the spacing its points are sized by when adaptive, per octant: that of
 * the finest level drawn there (pointSizes.ts). Of a node cut by the view edge only
 * the ranges in view are drawn (pointRanges.ts). Returns what the LOD walk alone
 * cost and how many nodes it picked (pointPerf).
 */
function selectRound(
  r: Renderer,
  canvas: HTMLCanvasElement,
  s: ScansState,
  isMoving: boolean,
): { walkMs: number; picks: number } {
  round++;
  const list = [...caches.values()];
  const cam = r.camera;
  const aspect = canvas.width / canvas.height;
  const eye = cam.eye();
  const only = filter;
  const dpr = canvas.clientWidth > 0 ? canvas.width / canvas.clientWidth : 1;
  // a point just outside the view still reaches in by its size: the ranges
  // are culled against a frustum that much wider
  const reachPx = Math.max(s.pointSize, s.adaptive ? s.pointAdaptiveMax : 0) * dpr;
  const far = !cam.ortho && s.pointMaxDistance > 0 ? s.pointMaxDistance : Number.POSITIVE_INFINITY;
  const views: RangeView[] = [];
  const needs: RangeView[] = [];
  const lod: LodCloud[] = list.map((c) => {
    // the eye and the frustum in the cloud's own axes, where its nodes are
    const o = c.scan.file.header.origin;
    const axes = c.scan.file.meta.axes;
    const rel: Vec3 = toCloud(axes, [eye[0] - o[0], eye[1] - o[1], eye[2] - o[2]]);
    const viewProj = cam.viewProjRelative(aspect, o);
    const planes = planesToCloud(axes, frustumPlanes(viewProj));
    // what the clip planes / boxes cut away is neither loaded nor paid for
    const clipped = clipTest(r, o, axes);
    views.push({
      planes: planesToCloud(axes, frustumPlanes(viewProj, reachPx / canvas.width, reachPx / canvas.height)),
      eye: rel,
      far,
      clipped,
    });
    // "load only what is in view": what a node packed now keeps, and what a
    // partial node must have (both wider than the picture, the first more)
    c.loadView = inViewLoad
      ? { planes: planesToCloud(axes, frustumPlanes(viewProj, LOAD_GUARD, LOAD_GUARD)), eye: rel, far }
      : null;
    needs.push({ planes: planesToCloud(axes, frustumPlanes(viewProj, NEED_GUARD, NEED_GUARD)), eye: rel, far });
    if (s.hidden.includes(c.assetId)) {
      return { nodes: [], planes, eye: rel }; // switched off in the Scans panel
    }
    if (!only) {
      return { nodes: c.scan.file.nodes, planes, eye: rel, clipped };
    }
    // only the filtered cloud is walked; nodes without the setup cost nothing
    return {
      nodes: c.assetId === only.assetId ? c.scan.file.nodes : [],
      planes,
      eye: rel,
      cost: (n) => (nodeHasSetup(n.setupMask, only.setup) ? n.pointCount : 0),
      clipped,
    };
  });
  const budget = s.pointBudget * MILLION;
  const walkAt = performance.now();
  const picks = selectNodes(
    lod,
    { ortho: cam.ortho, pxScale: (cam.lastP11 * canvas.height) / 2 },
    {
      budget,
      maxHeld: budget * MAX_DRAWN_BUDGETS,
      // refine until the points sit a point size apart on screen — closer
      // still with a detail factor above 1
      minPx: (Math.max(1, s.pointSize) * dpr) / s.pointDetail,
      maxDistance: s.pointMaxDistance,
      focusDistance: s.pointFocusDistance,
      inViewCost: s.pointInViewBudget,
    },
  );
  const walkMs = performance.now() - walkAt;
  const drawn = list.map(() => new Set<number>());
  // while moving, only the most urgent nodes are drawn: the picks come most
  // urgent first and parents before children, so a prefix of them is a
  // complete, coarser picture. What is wanted and loaded is not cut.
  const drawBudget = isMoving ? budget * MOVING_BUDGET_SHARE : Number.POSITIVE_INFINITY;
  let isDrawFull = false;
  let inView = 0;
  for (const p of picks) {
    const c = list[p.cloud];
    const res = c.resident.get(p.node);
    if (!res) {
      if (inflight < MAX_INFLIGHT && !c.loading.has(p.node) && canLoad(c, p.node)) {
        void load(r, c, p.node);
      }
      continue;
    }
    res.lastUsed = round;
    res.isFresh = false;
    // a partly uploaded node the view has turned past: fetch it again (it is
    // drawn as it is meanwhile)
    const loadView = c.loadView;
    if (
      res.partial &&
      loadView &&
      res.packedView !== lastView &&
      inflight < MAX_INFLIGHT &&
      !c.loading.has(p.node) &&
      needsMore(res.partial, needs[p.cloud], loadView) &&
      canLoad(c, p.node)
    ) {
      void load(r, c, p.node);
    }
    const parent = c.scan.file.nodes[p.node].parent;
    if (isDrawFull || (parent >= 0 && !drawn[p.cloud].has(parent))) {
      continue;
    }
    if (inView > 0 && inView + p.cost > drawBudget) {
      isDrawFull = true;
      continue;
    }
    drawn[p.cloud].add(p.node);
    inView += p.cost;
  }
  let points = 0;
  let nodes = 0;
  let draws = 0;
  let runsHash = 0;
  const clouds: PointCloudDraw[] = list.map((c, i) => {
    const set = drawn[i];
    const gpu: PointNodeDraw[] = [];
    const sizes = octantSpacings(c.scan.file.nodes, set, (index) => (c.resident.get(index)?.gpu.count ?? 0) === 0);
    for (const index of set) {
      const res = c.resident.get(index);
      if (!res) {
        continue;
      }
      const wanted = sizes.get(index);
      if (wanted && !sameSizes(res.sizes, wanted)) {
        r.points.setNodeSizes(res.gpu, wanted);
        res.sizes = wanted;
      }
      const cut = res.ranges ? visibleRuns(res.ranges, res.gpu.count, views[i]) : null;
      if (cut?.points === 0) {
        continue; // its cube touches the view, its points do not
      }
      const runs = cut?.runs ?? null;
      gpu.push({ gpu: res.gpu, runs });
      points += cut ? cut.points : res.gpu.count;
      draws += runs ? runs.length / 2 : 1;
      if (runs) {
        runsHash = Math.imul(runsHash ^ index, HASH_PRIME);
        for (const v of runs) {
          runsHash = Math.imul(runsHash ^ v, HASH_PRIME);
        }
      }
    }
    nodes += gpu.length;
    return { id: c.assetId, origin: c.scan.file.header.origin, axes: c.scan.file.meta.axes, nodes: gpu };
  });
  // the drawn nodes and, of the cut ones, which runs: a turn of the camera
  // changes the runs long before it changes the nodes
  const drawKey = `${list.map((c, i) => `${c.assetId}:${[...drawn[i]].join('.')}`).join('|')}#${runsHash >>> 0}`;
  if (drawKey !== lastDrawKey || isDrawStale) {
    lastDrawKey = drawKey;
    isDrawStale = false;
    r.points.setClouds(clouds);
  }
  flushRetired(r);
  evict(r, budget);
  let resident = 0;
  let loading = 0;
  let residentPoints = 0;
  for (const c of list) {
    resident += c.resident.size;
    loading += c.loading.size;
    residentPoints += c.residentPoints;
  }
  const st = pointStatsState.get();
  inView = Math.min(points, Math.round(inView));
  if (
    st.drawn !== points ||
    st.inView !== inView ||
    st.nodes !== nodes ||
    st.draws !== draws ||
    st.resident !== resident ||
    st.loading !== loading ||
    st.residentPoints !== residentPoints
  ) {
    pointStatsState.set({ drawn: points, inView, nodes, draws, resident, loading, residentPoints });
  }

  return { walkMs, picks: picks.length };
}

/** Destroy the buffers a reload replaced — only once the renderer's draw
 *  list no longer holds them. */
function flushRetired(r: Renderer) {
  for (const gpu of retired) {
    r.points.destroyNode(gpu);
  }
  retired.length = 0;
}

function hide(r: Renderer) {
  lastKey = ''; // shown again → select again
  if (lastDrawKey !== '' || isDrawStale) {
    lastDrawKey = '';
    isDrawStale = false;
    r.points.setClouds([]);
    pointStatsState.set({ drawn: 0, inView: 0, nodes: 0, draws: 0 });
  }
  flushRetired(r);
}

/** "Load only what is in view" was switched: the resident nodes were packed
 *  the other way, so drop them and restream. */
function applyInViewLoad(r: Renderer, next: boolean) {
  if (next === inViewLoad) {
    return;
  }

  inViewLoad = next;
  lastDrawKey = '';
  r.points.setClouds([]);
  flushRetired(r);
  for (const c of caches.values()) {
    dropCache(r, c);
  }
  dirty = true;
}

/**
 * Points are not shown: once that has lasted `keepMs` in this mode
 * (pointsMode's `hiddenKeepMs`: at once when off, never while only hidden)
 * the streamed nodes are given back, and so is every node a fetch still in
 * flight delivers later.
 */
function releaseHidden(r: Renderer, now: number, mode: PointsMode, keepMs: number) {
  if (hiddenSince === null || hiddenMode !== mode) {
    hiddenSince = now;
    hiddenMode = mode;
  }
  if (now - hiddenSince < keepMs) {
    return;
  }

  let released = false;
  for (const c of caches.values()) {
    if (c.resident.size > 0) {
      dropCache(r, c);
      released = true;
    }
  }
  if (released) {
    snapCache.clear();
    pointStatsState.set({ resident: 0, residentPoints: 0 });
  }
}

// -----------------------------------------------------------------------------
// Actions
// -----------------------------------------------------------------------------

export const scanPoints = {
  /** A scan was moved (its offset changed): redraw at the new place — the
   *  loaded points stay, they are relative to the scan's origin. */
  moved(r: Renderer) {
    lastDrawKey = '';
    snapCache.clear();
    r.setPointBounds(cloudBounds());
    dirty = true;
  },

  /** Per viewport frame (cheap when nothing changed). True when the scene
   *  box changed (a scan was opened or closed): what the viewport derives
   *  from it — the centre of an un-anchored clip plane — must follow. */
  tick(r: Renderer): boolean {
    pointPerf.frame();
    if (r !== bound) {
      // a new renderer (first frame or after device loss): the old buffers
      // died with the old device
      caches.clear();
      snapCache.clear();
      retired.length = 0;
      isDrawStale = false;
      bound = r;
      r.pointSnapper = snapToPoint;
      lastKey = '';
      lastDrawKey = '';
      dirty = true;
    }
    const boundsChanged = syncOpen(r);
    const s = scansState.get();
    r.points.setStyle(styleOf(s));
    applyFilter(r, wantedFilter(s));
    applyInViewLoad(r, s.pointInViewLoad);
    const canvas = r.canvasEl;
    if (!arePointsShown(s.pointsMode, s.active)) {
      hide(r);
      releaseHidden(r, performance.now(), s.pointsMode, hiddenKeepMs(s.pointsMode, RELEASE_HIDDEN_MS));
      return boundsChanged;
    }

    hiddenSince = null;
    if (caches.size === 0 || !canvas || canvas.width === 0 || canvas.height === 0) {
      hide(r);
      return boundsChanged;
    }
    const view = viewKey(r, canvas, s);
    const at = performance.now();
    if (view !== lastView) {
      lastView = view;
      lastMoveAt = at;
    }
    // the round after the view came to rest draws the full budget again
    const isMoving = s.pointMoveLight && at - lastMoveAt < MOVE_SETTLE_MS;
    const key = isMoving ? `${view}|moving` : view;
    if (!dirty && key === lastKey) {
      return boundsChanged;
    }
    dirty = false;
    lastKey = key;
    const roundAt = performance.now();
    const { walkMs, picks } = selectRound(r, canvas, s, isMoving);
    const now = performance.now();
    pointPerf.selection(walkMs, now - roundAt, picks, now);
    if (inflight === 0) {
      pointPerf.settled(now);
    }

    return boundsChanged;
  },
};
