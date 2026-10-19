// Authoring helper lines in the viewport (DESIGN.md › Animation): motion
// paths of the scene's moving objects (the pivot's path + a tick at every
// key) and the picked keys (big yellow crosses on their object's path). Same
// vertex format as markerLines (xyz + abgr bits, pairs = segments),
// concatenated into the renderer's depth-tested helper line list. The
// picked keys go first, so a full buffer never drops them, and are rebuilt
// every change; the bulk paths are rebuilt at most every PATHS_THROTTLE_MS
// when they are slow, so dragging a key on a big animation stays smooth.

import { type EvalContext, evaluateObject, objectMotionTimes } from '../../lib/animation/evaluate';
import { m4TransformPoint } from '../../lib/animation/interp';
import type { AnimObject, V3 } from '../../lib/animation/types';
import { animationUiState } from './animationUi.state';
import { contentRevision } from './docContent';
import { playerState } from './player.state';
import { rowObject } from './rows';
import { captureActive, currentView, evalContext } from './runtime';

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

const PATH_COLOR = 0xff3cc2f6; // abgr: amber-ish orange path
const KEY_COLOR = 0xffffffff;
const SELECTED_KEY_COLOR = 0xff00ffff; // abgr: yellow
const SELECTED_KEY_SCALE = 3;
const SAMPLES_PER_S = 24;
const MAX_SAMPLES = 400;
/** Vertex capacity of the bulk paths and of the picked key's lines. */
const PATH_VERTS = 64 * 1024;
const PICKED_VERTS = 4 * 1024;
/** Bulk paths slower than this to build are rebuilt at most every
 *  PATHS_THROTTLE_MS while the doc keeps changing (a key drag). */
const SLOW_PATHS_MS = 12;
const PATHS_THROTTLE_MS = 150;
const EMPTY = new Float32Array(0);

// -----------------------------------------------------------------------------
// module state
// -----------------------------------------------------------------------------

/** the bulk motion paths, when they were built and what that cost */
let paths: { key: string; verts: Float32Array; at: number; ms: number } = { key: '', verts: EMPTY, at: 0, ms: 0 };
let picked: { key: string; verts: Float32Array } = { key: '', verts: EMPTY };
/** the pivots the paths were built with */
let pathsCtx: EvalContext | null = null;
/** everything concatenated, as the viewport takes it */
let cache: { key: string; verts: Float32Array } = { key: '', verts: EMPTY };

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function writer(n: number) {
  const out = new Float32Array(n * 4);
  const bits = new Uint32Array(out.buffer);
  let k = 0;
  return {
    seg(a: V3, b: V3, color: number) {
      if (k + 8 > out.length) {
        return;
      }
      out[k] = a[0];
      out[k + 1] = a[1];
      out[k + 2] = a[2];
      bits[k + 3] = color;
      out[k + 4] = b[0];
      out[k + 5] = b[1];
      out[k + 6] = b[2];
      bits[k + 7] = color;
      k += 8;
    },
    done: () => out.slice(0, k),
  };
}

/** The picked keys of an object row: the object and the keys' times. */
function pickedKeys(): { object: AnimObject; times: number[] } | null {
  const p = animationUiState.get().picked;
  const id = p.kind === 'keys' ? rowObject(p.row) : null;
  const object = id ? currentView()?.scene.objects.find((o) => o.id === id) : undefined;
  if (p.kind !== 'keys' || !object) {
    return null;
  }
  return { object, times: p.indices.flatMap((i) => (object.keys[i] ? [object.keys[i].t] : [])) };
}

function cross(w: ReturnType<typeof writer>, p: V3, size: number, color: number): void {
  for (let a = 0; a < 3; a++) {
    const d: V3 = [0, 0, 0];
    d[a] = size;
    w.seg([p[0] - d[0], p[1] - d[1], p[2] - d[2]], [p[0] + d[0], p[1] + d[1], p[2] + d[2]], color);
  }
}

/** Where an object's pivot is at T. */
function pointAt(o: AnimObject, T: number): V3 | null {
  const ctx = evalContext();
  const pivot = ctx.pivots.get(o.id) ?? [0, 0, 0];
  const pose = evaluateObject(o, T, pivot, ctx.boxes?.get(o.id) ?? null).pose;
  return pose ? m4TransformPoint(pose, pivot) : null;
}

/** One object's path (sampled inside its moving segments only — between
 *  them nothing moves it); returns its length, for marker sizes. */
function objectPath(w: ReturnType<typeof writer>, o: AnimObject): number {
  let prev: V3 | null = null;
  let extent = 0;
  const last = o.keys[o.keys.length - 1]?.t ?? 0;
  for (const T of objectMotionTimes(o, 0, last, SAMPLES_PER_S, MAX_SAMPLES)) {
    const p = pointAt(o, T);
    if (p && prev) {
      w.seg(prev, p, PATH_COLOR);
      extent += Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]);
    }
    prev = p;
  }
  return extent;
}

/** Every moving object's path with a tick at each key. */
function motionPaths(w: ReturnType<typeof writer>): void {
  const objects = (currentView()?.scene.objects ?? []).filter((o) => !o.muted && o.keys.length > 1);
  let extent = 0;
  for (const o of objects) {
    extent += objectPath(w, o);
  }
  const size = Math.max(0.02, extent * 0.01);
  for (const o of objects) {
    for (const k of o.keys) {
      const p = pointAt(o, k.t);
      if (p) {
        cross(w, p, size, KEY_COLOR);
      }
    }
  }
}

/** The picked keys big and yellow (and their object's path when Motion
 *  paths are on). */
function pickedLines(sel: ReturnType<typeof pickedKeys>, showPaths: boolean): Float32Array {
  if (!sel) {
    return EMPTY;
  }
  const w = writer(PICKED_VERTS);
  const extent = showPaths ? objectPath(w, sel.object) : 0;
  const size = Math.max(0.03, extent * 0.01) * SELECTED_KEY_SCALE;
  for (const T of sel.times) {
    const p = pointAt(sel.object, T);
    if (p) {
      cross(w, p, size, SELECTED_KEY_COLOR);
    }
  }
  return w.done();
}

function concat(parts: readonly Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// -----------------------------------------------------------------------------
// public api
// -----------------------------------------------------------------------------

/** The helper line vertices + a key that changes when they do. */
export function animationHelperLines(): { verts: Float32Array; key: string } {
  const ui = animationUiState.get();
  const status = playerState.get().status;
  const authoring = ui.mode.kind === 'author';
  // paths show in playback (presenting) too — the switch decides
  const shown = authoring || ui.mode.kind === 'playback';
  const v = currentView();
  if (status === 'off' || !shown || !v || captureActive()) {
    if (cache.key !== 'off') {
      cache = { key: 'off', verts: EMPTY };
    }
    return cache;
  }
  const content = contentRevision();
  const ctx = evalContext();
  if (ctx !== pathsCtx) {
    // pivots changed (a re-entered session): every path moves
    pathsCtx = ctx;
    paths = { ...paths, key: '' };
    picked = { ...picked, key: '' };
  }
  const pathsKey = ui.showPaths ? String(content) : 'none';
  const now = performance.now();
  const throttled = paths.ms > SLOW_PATHS_MS && now - paths.at < PATHS_THROTTLE_MS;
  if (pathsKey !== paths.key && !throttled) {
    const w = writer(PATH_VERTS);
    if (ui.showPaths) {
      motionPaths(w);
    }
    paths = { key: pathsKey, verts: w.done(), at: now, ms: performance.now() - now };
  }
  const sel = authoring ? pickedKeys() : null;
  const pickedKey = `${content}|${ui.showPaths}|${sel ? `${sel.object.id}:${sel.times.join(',')}` : ''}`;
  if (pickedKey !== picked.key) {
    picked = { key: pickedKey, verts: pickedLines(sel, ui.showPaths) };
  }
  const key = `${paths.key}#${picked.key}`;
  if (key !== cache.key) {
    cache = { key, verts: concat([picked.verts, paths.verts]) };
  }
  return cache;
}
