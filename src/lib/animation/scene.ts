// -----------------------------------------------------------------------------
// scene view (DESIGN.md › Animation › Evaluation)
// -----------------------------------------------------------------------------
// What playback needs from a scene beyond its rows: its length and its steps
// in order. Built once per scene object (the doc is immutable per revision).
// Pure.

import type { Scene, Step } from './types';

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

export interface SceneView {
  scene: Scene;
  /** the pinned end, else the last key, step end or callout end (s) */
  duration: number;
  /** steps by start time */
  steps: readonly Step[];
}

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

/** Seconds within which ◀ step goes to the step before rather than back to
 *  the start of the current one. */
const PREV_STEP_GRACE_S = 0.5;
const EPS = 1e-6;

// -----------------------------------------------------------------------------
// module state
// -----------------------------------------------------------------------------

const viewCache = new WeakMap<Scene, SceneView>();

// -----------------------------------------------------------------------------
// public api
// -----------------------------------------------------------------------------

/** The last moment anything in the scene happens (s). */
export function contentEnd(scene: Scene): number {
  let end = 0;
  for (const o of scene.objects) {
    const last = o.keys[o.keys.length - 1];
    if (last) {
      end = Math.max(end, last.t);
    }
  }
  for (const list of [scene.camera, scene.section, scene.colorRules, scene.labels, scene.measurements]) {
    const last = list[list.length - 1];
    if (last) {
      end = Math.max(end, last.t);
    }
  }
  for (const s of scene.steps) {
    end = Math.max(end, s.end);
  }
  for (const c of scene.callouts) {
    end = Math.max(end, c.end);
  }
  return end;
}

/** The scene's view (memoized per scene object). */
export function sceneView(scene: Scene): SceneView {
  let v = viewCache.get(scene);
  if (!v) {
    v = {
      scene,
      duration: scene.end !== undefined ? Math.max(0, scene.end) : contentEnd(scene),
      steps: [...scene.steps].sort((a, b) => a.start - b.start),
    };
    viewCache.set(scene, v);
  }
  return v;
}

/** The step running at T (start ≤ T ≤ end; the later one wins at a shared
 *  edge); null in a gap. */
export function stepAt(view: SceneView, T: number): Step | null {
  let hit: Step | null = null;
  for (const s of view.steps) {
    if (s.start > T + EPS) {
      break;
    }
    if (T <= s.end + EPS) {
      hit = s;
    }
  }
  return hit;
}

/** The latest step started at or before T (gaps still name the last one —
 *  what {{step.*}} placeholders show). */
export function lastStepAt(view: SceneView, T: number): Step | null {
  let hit: Step | null = null;
  for (const s of view.steps) {
    if (s.start > T + EPS) {
      break;
    }
    hit = s;
  }
  return hit;
}

/** The step to go to for ◀ / ▶ step from T: the next one starting after
 *  T, or the one before — the current one's start unless T is within a
 *  moment of it. */
export function neighbourStep(view: SceneView, T: number, dir: -1 | 1): Step | null {
  if (dir > 0) {
    return view.steps.find((s) => s.start > T + EPS) ?? null;
  }
  const before = view.steps.filter((s) => s.start < T - PREV_STEP_GRACE_S);
  return before[before.length - 1] ?? null;
}

/** 1-based number of a step in play order (0 = not in the scene). */
export function stepNumber(view: SceneView, id: string): number {
  return view.steps.findIndex((s) => s.id === id) + 1;
}
