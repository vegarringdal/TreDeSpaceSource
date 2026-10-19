// -----------------------------------------------------------------------------
// playhead stepping (DESIGN.md › Animation › Player)
// -----------------------------------------------------------------------------
// One playback tick: advance the time by dt inside the scope and stop at the
// first event the tick crosses — the end of a step that pauses there, the
// end of the scope — or wrap (Loop) or turn round (Ping-pong). Pure, so the
// player's rules are unit-tested without a renderer.

import type { SceneView } from './scene';

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

/** What Play plays: the whole scene, one step, or a time range. */
export type PlayScope = { kind: 'all' } | { kind: 'step'; step: string } | { kind: 'range'; from: number; to: number };

export interface PlayheadInput {
  time: number;
  /** scene seconds to advance (already scaled by the player speed) */
  dt: number;
  /** 1 = forwards; -1 = on the way back (ping-pong) */
  direction: 1 | -1;
  view: SceneView;
  scope: PlayScope;
  loop: boolean;
  pingPong: boolean;
}

export type PlayheadStop = { kind: 'none' } | { kind: 'end' } | { kind: 'stepEnd'; step: string };

export interface PlayheadStep {
  time: number;
  direction: 1 | -1;
  stop: PlayheadStop;
  /** wrapped or turned round this tick */
  looped: boolean;
}

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

const EPS = 1e-9;

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

/** [start, end] of what a scope plays. */
export function scopeRange(scope: PlayScope, view: SceneView): [number, number] {
  if (scope.kind === 'range') {
    return [Math.min(scope.from, scope.to), Math.max(scope.from, scope.to)];
  }
  if (scope.kind === 'step') {
    const s = view.steps.find((x) => x.id === scope.step);
    if (s) {
      return [s.start, s.end];
    }
  }
  return [0, view.duration];
}

// -----------------------------------------------------------------------------
// advance
// -----------------------------------------------------------------------------

/** One tick. A step end exactly AT the start time is not hit again, so
 *  Continue from a step's end moves on. Steps pause only going forwards, and
 *  only when the whole scene plays. One step plays once and stops at its
 *  end — the scene's Loop / Ping-pong are for the scene. */
export function advancePlayhead(p: PlayheadInput): PlayheadStep {
  const [s, e] = scopeRange(p.scope, p.view);
  const repeats = p.scope.kind !== 'step';
  const loop = repeats && p.loop;
  const pingPong = repeats && p.pingPong;
  const t0 = Math.min(Math.max(p.time, s), e);
  const dt = Math.max(0, p.dt);
  if (p.direction < 0) {
    const t1 = t0 - dt;
    if (t1 > s) {
      return { time: t1, direction: -1, stop: { kind: 'none' }, looped: false };
    }
    if (loop && e > s) {
      return { time: Math.min(e, s + (s - t1)), direction: 1, stop: { kind: 'none' }, looped: true };
    }
    return { time: s, direction: 1, stop: { kind: 'end' }, looped: false };
  }
  const t1 = t0 + dt;
  if (p.scope.kind === 'all') {
    // a step ending with the scene pauses there only when playback would go
    // on (looping or turning round); otherwise the end stops it anyway
    const goesOn = loop || pingPong;
    const hit = p.view.steps.find(
      (x) => x.pauseAtEnd && x.end > t0 + EPS && x.end <= t1 + EPS && (x.end < e - EPS || goesOn),
    );
    if (hit) {
      return { time: hit.end, direction: 1, stop: { kind: 'stepEnd', step: hit.id }, looped: false };
    }
  }
  if (t1 < e) {
    return { time: t1, direction: 1, stop: { kind: 'none' }, looped: false };
  }
  if (pingPong && e > s) {
    return { time: Math.max(s, e - (t1 - e)), direction: -1, stop: { kind: 'none' }, looped: true };
  }
  if (loop && e > s) {
    return { time: s + ((t1 - e) % (e - s)), direction: 1, stop: { kind: 'none' }, looped: true };
  }
  return { time: e, direction: 1, stop: { kind: 'end' }, looped: false };
}
