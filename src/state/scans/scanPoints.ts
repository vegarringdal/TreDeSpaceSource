// Point streaming for the open laser scans: every frame the viewport ticks
// this; when the view, the settings or the resident set changed it re-runs
// the LOD selection (lib/tdpp/pointLod.ts), queues the missing nodes (read
// from OPFS → meshopt decode → GPU buffer, a few at a time), hands the
// renderer the drawn set, and evicts the least recently wanted nodes once the
// GPU cache outgrows the budget. GPU handles live here, never in a store.

import { consoleActions } from '../../components/panels/console/console.actions';
import { clipCulledSphere } from '../../lib/render/clipCull';
import type { PointCloudDraw, PointNodeGpu, PointStyle } from '../../lib/render/pointsLayer';
import type { Renderer } from '../../lib/render/renderer';
import { POINT_HEADER_WORDS, POINT_WORDS } from '../../lib/render/shaders/points';
import { boxToScene, type CloudAxes, planesToCloud, toCloud, toScene } from '../../lib/tdpp/cloudFrame';
import { frustumPlanes, type LodCloud, selectNodes, type Vec3 } from '../../lib/tdpp/pointLod';
import { packNodePoints } from '../../lib/tdpp/pointPack';
import { boxContains, nearestToRay, type SnapHit } from '../../lib/tdpp/pointSnap';
import { type DecodedNode, decodeNode } from '../../lib/tdpp/tdppFormat';
import { pointStatsState } from './pointStats.state';
import { type OpenScan, openScans } from './scanFiles';
import { type ScansState, scansState } from './scans.state';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface Resident {
  readonly gpu: PointNodeGpu;
  /** Selection round that last wanted this node (LRU). */
  lastUsed: number;
  /** Effective spacing written into the node header. */
  spacing: number;
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
/** Attempts a node gets to load before it is given up for the session… */
const MAX_NODE_ATTEMPTS = 3;
/** …a retry waits this many selection rounds (the view has moved on a bit). */
const NODE_RETRY_ROUNDS = 30;

let bound: Renderer | null = null;
const caches = new Map<string, CloudCache>();
let round = 0;
let lastKey = '';
let lastDrawKey = '';
let dirty = true;
let inflight = 0;
let filter: SetupFilter | null = null;
/** Recently decoded nodes for the measure snap, oldest first (`asset:node`). */
const snapCache = new Map<string, DecodedNode>();
/** Keys the snap query in progress has read: never evicted under it. */
const snapInUse = new Set<string>();

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

function styleOf(s: ScansState): PointStyle {
  return { sizePx: s.pointSize, adaptive: s.adaptive, colorMode: s.colorMode, maxDistance: s.pointMaxDistance };
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
  try {
    let words = new Uint32Array(POINT_HEADER_WORDS);
    // an empty node (a structural ancestor) has no payload to read
    if (node.pointCount > 0 && (!only || nodeHasSetup(node.setupMask, only.setup))) {
      const bytes = await c.scan.src.read(node.payloadOffset, node.payloadSize);
      const dec = await decodeNode(node, bytes);
      if (!dec.data) {
        markFailed(c, index);
        consoleActions.log('error', `Scans: ${c.scan.name}: ${dec.error?.msg ?? 'node decode failed'}`);
        return;
      }
      words = packNodePoints(dec.data, node.spacing, c.scan.file.header, only ? only.setup : null);
    }
    if (bound !== r || caches.get(c.assetId) !== c || filter !== only) {
      return; // closed, the device was replaced or the filter changed meanwhile
    }
    const count = (words.length - POINT_HEADER_WORDS) / POINT_WORDS;
    const gpu = r.points.createNode(words, count);
    if (!gpu) {
      markFailed(c, index);
      return;
    }
    c.failed.delete(index);
    c.resident.set(index, { gpu, lastUsed: round, spacing: node.spacing });
    c.residentPoints += count;
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
 * measured against that, nothing idle would ever be kept.
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
      } else {
        wanted += res.gpu.count;
      }
    }
  }
  const cap = Math.max(budget, wanted) + (budget * scansState.get().pointCache) / 100;
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
 * an additive LOD with a gap in its chain would show a hole. A drawn node with
 * a drawn child gets half its spacing as the adaptive size reference (its
 * children fill in between its points).
 */
function selectRound(r: Renderer, canvas: HTMLCanvasElement, s: ScansState) {
  round++;
  const list = [...caches.values()];
  const cam = r.camera;
  const aspect = canvas.width / canvas.height;
  const eye = cam.eye();
  const only = filter;
  const lod: LodCloud[] = list.map((c) => {
    // the eye and the frustum in the cloud's own axes, where its nodes are
    const o = c.scan.file.header.origin;
    const axes = c.scan.file.meta.axes;
    const rel: Vec3 = toCloud(axes, [eye[0] - o[0], eye[1] - o[1], eye[2] - o[2]]);
    const planes = planesToCloud(axes, frustumPlanes(cam.viewProjRelative(aspect, o)));
    if (s.hidden.includes(c.assetId)) {
      return { nodes: [], planes, eye: rel }; // switched off in the Scans panel
    }
    // what the clip planes / boxes cut away is neither loaded nor paid for
    const clipped = clipTest(r, o, axes);
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
  const dpr = canvas.clientWidth > 0 ? canvas.width / canvas.clientWidth : 1;
  const budget = s.pointBudget * MILLION;
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
  const drawn = list.map(() => new Set<number>());
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
    const parent = c.scan.file.nodes[p.node].parent;
    if (parent < 0 || drawn[p.cloud].has(parent)) {
      drawn[p.cloud].add(p.node);
      inView += p.cost;
    }
  }
  let points = 0;
  let nodes = 0;
  const clouds: PointCloudDraw[] = list.map((c, i) => {
    const set = drawn[i];
    const gpu: PointNodeGpu[] = [];
    for (const index of set) {
      const node = c.scan.file.nodes[index];
      const res = c.resident.get(index);
      if (!res) {
        continue;
      }
      let refined = false;
      for (let k = 0; k < node.childCount && !refined; k++) {
        refined = set.has(node.firstChild + k);
      }
      const spacing = refined ? node.spacing / 2 : node.spacing;
      if (res.spacing !== spacing) {
        r.points.setNodeSpacing(res.gpu, spacing);
        res.spacing = spacing;
      }
      gpu.push(res.gpu);
      points += res.gpu.count;
    }
    nodes += gpu.length;
    return { id: c.assetId, origin: c.scan.file.header.origin, axes: c.scan.file.meta.axes, nodes: gpu };
  });
  const drawKey = list.map((c, i) => `${c.assetId}:${[...drawn[i]].join('.')}`).join('|');
  if (drawKey !== lastDrawKey) {
    lastDrawKey = drawKey;
    r.points.setClouds(clouds);
  }
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
    st.resident !== resident ||
    st.loading !== loading ||
    st.residentPoints !== residentPoints
  ) {
    pointStatsState.set({ drawn: points, inView, nodes, resident, loading, residentPoints });
  }
}

function hide(r: Renderer) {
  lastKey = ''; // shown again → select again
  if (lastDrawKey !== '') {
    lastDrawKey = '';
    r.points.setClouds([]);
    pointStatsState.set({ drawn: 0, inView: 0, nodes: 0 });
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
    if (r !== bound) {
      // a new renderer (first frame or after device loss): the old buffers
      // died with the old device
      caches.clear();
      snapCache.clear();
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
    const canvas = r.canvasEl;
    if (!s.showPoints || caches.size === 0 || !canvas || canvas.width === 0 || canvas.height === 0) {
      hide(r);
      return boundsChanged;
    }
    const key = viewKey(r, canvas, s);
    if (!dirty && key === lastKey) {
      return boundsChanged;
    }
    dirty = false;
    lastKey = key;
    selectRound(r, canvas, s);
    return boundsChanged;
  },
};
