// -----------------------------------------------------------------------------
// video export frame plan (DESIGN.md › Animation › Capture)
// -----------------------------------------------------------------------------
// The timeline time each video frame shows: evenly spaced at the frame rate
// over [from, to], with the frames of a hold (a step that pauses at its end)
// inserted at the hold's time, so the video waits there before going on.
// Several scenes play one after another (`videoSegments`).

import { type SceneView, sceneView } from './scene';
import type { Scene } from './types';

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

export interface FramePlan {
  from: number;
  to: number;
  fps: number;
  /** timeline times to wait at, and for how many seconds of video */
  holds: readonly { at: number; seconds: number }[];
}

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

const EPS = 1e-6;

// -----------------------------------------------------------------------------
// public api
// -----------------------------------------------------------------------------

/** Timeline time per video frame (the last frame is `to` itself). */
export function videoFrameTimes(plan: FramePlan): number[] {
  const span = Math.max(0, plan.to - plan.from);
  const n = Math.max(1, Math.ceil(span * plan.fps - EPS));
  const holds = plan.holds
    .filter((h) => h.seconds > 0 && h.at >= plan.from - EPS && h.at <= plan.to + EPS)
    .sort((a, b) => a.at - b.at);
  const out: number[] = [];
  const pushHold = (h: { at: number; seconds: number }) => {
    for (let k = 0; k < Math.round(h.seconds * plan.fps); k++) {
      out.push(h.at);
    }
  };
  let next = 0;
  for (let i = 0; i <= n; i++) {
    const T = Math.min(plan.to, plan.from + i / plan.fps);
    while (next < holds.length && holds[next].at < T - EPS) {
      pushHold(holds[next]);
      next++;
    }
    out.push(T);
  }
  while (next < holds.length) {
    pushHold(holds[next]);
    next++;
  }
  return out;
}

/** One stretch of the video: a scene from `from` to `to` (its seconds) and
 *  the waits at its pausing steps. */
export interface VideoSegment {
  scene: string;
  from: number;
  to: number;
  holds: readonly { at: number; seconds: number }[];
}

/** What a video shows. */
export interface VideoChoice {
  /** every scene one after another (each whole), or one scene */
  scenes: 'all' | 'one';
  /** the one scene (an id) */
  scene: string;
  /** of the one scene: all of it, or from `from` to `to` */
  span: 'whole' | 'part';
  from: number;
  to: number;
}

/** The video's stretches, in play order: every scene whole, one after
 *  another (empty ones left out), or one scene whole or its part — Start and
 *  End in either order, never before 0; an End past the scene's end holds
 *  its last picture. `holdS` seconds of wait at each pausing step's end. */
export function videoSegments(scenes: readonly Scene[], choice: VideoChoice, holdS: number): VideoSegment[] {
  const holdsOf = (v: SceneView) =>
    holdS > 0 ? v.steps.filter((s) => s.pauseAtEnd).map((s) => ({ at: s.end, seconds: holdS })) : [];
  if (choice.scenes === 'all') {
    return scenes
      .map((s) => sceneView(s))
      .filter((v) => v.duration > EPS)
      .map((v) => ({ scene: v.scene.id, from: 0, to: v.duration, holds: holdsOf(v) }));
  }
  const scene = scenes.find((s) => s.id === choice.scene);
  if (!scene) {
    return [];
  }
  const v = sceneView(scene);
  const part = choice.span === 'part';
  const from = part ? Math.max(0, Math.min(choice.from, choice.to)) : 0;
  const to = part ? Math.max(0, choice.from, choice.to) : v.duration;
  return to - from > EPS ? [{ scene: scene.id, from, to, holds: holdsOf(v) }] : [];
}
