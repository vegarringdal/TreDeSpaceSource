// -----------------------------------------------------------------------------
// evaluation (DESIGN.md › Animation › Evaluation)
// -----------------------------------------------------------------------------
// evaluate() depends only on its arguments: seeking to any time gives the
// same poses, visibility, colours, camera, clipping and overlays as playing
// up to it. Each object is sampled from its own row; before its first key it
// stands at that key, after its last it stays there. Its instant values
// (visible, opacity, colour) are the latest key that sets them.

import type { OverlayFrame, OverlayFx } from '../overlay/overlayTypes';
import { keyAt } from './annotations';
import { sampleClipState } from './clipState';
import { keyIndexAt, SAME_PLACE_M, sampleCamera, sampleTransformMatrix } from './interp';
import { sampleOverlayPlace } from './overlayKeys';
import { pivotResolver, type RestBox } from './pivots';
import { type RulesFrame, rulesAt } from './rules';
import { type SceneView, stepAt } from './scene';
import type {
  AnimationDoc,
  AnimCamera,
  AnimObject,
  ClipStateValue,
  LabelsKey,
  MeasurementsKey,
  ObjectKey,
  Scene,
  V3,
} from './types';

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

export interface FrameState {
  /** object → delta mat4 (column-major); objects with keys only */
  poses: ReadonlyMap<string, Float32Array>;
  /** object → visibility; absent = no key sets it (as in the model) */
  visible: ReadonlyMap<string, boolean>;
  /** object → opacity 0..1; absent = no key sets it */
  opacity: ReadonlyMap<string, number>;
  /** object → '#rrggbb', null = own colour; absent = no key sets it */
  colors: ReadonlyMap<string, string | null>;
  /** the Set Color rules in force; null = the scene's own colours */
  look: RulesFrame | null;
  /** the camera row's view; null = no camera keys (the view is free) */
  camera: AnimCamera | null;
  /** the section row's clipping; null = no section keys */
  clip: ClipStateValue | null;
  /** the Labels key in force; null = no labels */
  labels: LabelsKey | null;
  /** the Measurements key in force; null = no measurements */
  measurements: MeasurementsKey | null;
  overlays: readonly OverlayFrame[];
  /** the step running at T, else null */
  step: string | null;
}

/** What evaluate needs beyond the doc: each object's resolved pivot, and
 *  its rest box (what keys' side pivots are on). */
export interface EvalContext {
  pivots: ReadonlyMap<string, V3>;
  boxes?: ReadonlyMap<string, RestBox>;
}

/** One object's state at a time. */
export interface ObjectState {
  pose: Float32Array | null;
  visible: boolean | null;
  opacity: number | null;
  color: string | null | undefined;
}

interface CachedState extends ObjectState {
  pivot: V3;
  box: RestBox | null;
  /** valid while lo ≤ T < hi (lo > hi = always recompute) */
  lo: number;
  hi: number;
}

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

/** Prefix of the virtual overlay instance a step's card is drawn as —
 *  `step:<step id>`. */
export const STEP_CARD_PREFIX = 'step:';

/** Enter / exit effect of step cards. */
export const STEP_CARD_FX: OverlayFx = { kind: 'fade', duration: 0.25 };

const ORIGIN: V3 = [0, 0, 0];

/** Two orientations whose quaternions' |dot| is this close to 1 are the
 *  same (about 0.002°: float noise, not a turn). */
const SAME_TURN_DOT = 1 - 1e-10;

/** A held step's card stays up this far past its end (the playhead rests
 *  exactly on it, give or take float noise). */
const HELD_EDGE_S = 1e-6;

/** Sample a turning segment at least this often (degrees) — a fast spin
 *  swept once a second would miss most of its circle. */
const SAMPLE_TURN_DEG = 15;

// -----------------------------------------------------------------------------
// module state
// -----------------------------------------------------------------------------

/** Each object's last state (an edited object is a new object). */
const objectCache = new WeakMap<AnimObject, CachedState>();

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

/** The latest key at or before T (T no earlier than the first key) that
 *  sets `field`; undefined when none does. */
function instant<F extends 'visible' | 'opacity' | 'color'>(
  keys: readonly ObjectKey[],
  i: number,
  field: F,
): ObjectKey[F] | undefined {
  for (let k = Math.max(0, i); k >= 0; k--) {
    const v = keys[k]?.[field];
    if (v !== undefined) {
      return v;
    }
  }
  return undefined;
}

/** |cos| of half the angle between two orientations (1 = the same). */
function turnDot(a: ObjectKey['rotate'], b: ObjectKey['rotate']): number {
  return Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
}

/** Does the segment arriving at key b move the object? Keys within float
 *  noise of each other (a key pressed twice without moving) stand still. */
export function segmentMoves(a: ObjectKey, b: ObjectKey): boolean {
  if (b.interp === 'hold') {
    return false;
  }
  if (b.spin && Math.abs(b.spin.degrees) > 1e-6) {
    return true;
  }
  return (
    a.move.some((x, k) => Math.abs(x - b.move[k]) >= SAME_PLACE_M) ||
    turnDot(a.rotate, b.rotate) < SAME_TURN_DOT ||
    JSON.stringify(a.pivot) !== JSON.stringify(b.pivot)
  );
}

/** Degrees the object turns on the segment arriving at key b. */
function segmentTurn(a: ObjectKey, b: ObjectKey): number {
  const slerp = (2 * Math.acos(Math.min(1, turnDot(a.rotate, b.rotate))) * 180) / Math.PI;
  return slerp + Math.abs(b.spin?.degrees ?? 0);
}

const samePivot = (a: V3, b: V3) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

function fxDuration(fx: OverlayFx): number {
  return fx.kind === 'none' ? 0 : Math.max(0, fx.duration);
}

/** One overlay's frame at T for a [show, hide] window (null = not shown). */
function overlayFrame(
  instance: string,
  show: number,
  hide: number,
  enter: OverlayFx,
  exit: OverlayFx,
  step: string | null,
  T: number,
  place: [number, number] | null,
): OverlayFrame | null {
  if (T < show || T > hide) {
    return null;
  }
  const at = place ? { place } : {};
  const din = fxDuration(enter);
  const dout = fxDuration(exit);
  const inP = din > 0 && T - show < din ? (T - show) / din : 1;
  const outP = dout > 0 && hide - T < dout ? (hide - T) / dout : 1;
  // a short overlay's fades overlap: the lower one wins, so it never pops
  if (inP < 1 && inP <= outP) {
    return { instance, progress: inP, phase: 'enter', fx: enter, step, ...at };
  }
  if (outP < 1) {
    return { instance, progress: outP, phase: 'exit', fx: exit, step, ...at };
  }
  return { instance, progress: 1, phase: 'shown', fx: { kind: 'none' }, step, ...at };
}

/** Does a step show a card: its own, else the scene's step card? */
export function stepHasCard(scene: Scene, card: Scene['steps'][number]['card']): boolean {
  return card === undefined ? scene.stepCard !== null : card !== null;
}

/** Callouts, then step cards, shown at T. The step playback waits at the
 *  end of (`held`) keeps its card fully shown. */
function overlayFrames(view: SceneView, T: number, held: string | null): OverlayFrame[] {
  const out: OverlayFrame[] = [];
  for (const c of view.scene.callouts) {
    const f = overlayFrame(
      c.instance,
      c.start,
      c.end,
      c.enter,
      c.exit,
      null,
      T,
      sampleOverlayPlace(c.keys, T - c.start),
    );
    if (f) {
      out.push(f);
    }
  }
  for (const s of view.steps) {
    if (!stepHasCard(view.scene, s.card)) {
      continue;
    }
    const instance = `${STEP_CARD_PREFIX}${s.id}`;
    if (s.id === held && T >= s.start && T <= s.end + HELD_EDGE_S) {
      out.push({ instance, progress: 1, phase: 'shown', fx: { kind: 'none' }, step: s.id });
      continue;
    }
    const f = overlayFrame(instance, s.start, s.end, STEP_CARD_FX, STEP_CARD_FX, s.id, T, null);
    if (f) {
      out.push(f);
    }
  }
  return out;
}

// -----------------------------------------------------------------------------
// public api
// -----------------------------------------------------------------------------

/** One object's pose and instant values at T. The result is reused while T
 *  stays in a stretch where nothing about the object changes (the slots
 *  then skip its write). */
export function evaluateObject(o: AnimObject, T: number, pivot: V3, box: RestBox | null = null): ObjectState {
  const hit = objectCache.get(o);
  if (hit && T >= hit.lo && T < hit.hi && samePivot(hit.pivot, pivot) && hit.box === box) {
    return hit;
  }
  const keys = o.keys;
  if (keys.length === 0 || o.muted) {
    const none: CachedState = {
      pose: null,
      visible: null,
      opacity: null,
      color: undefined,
      pivot,
      box,
      lo: -Infinity,
      hi: Infinity,
    };
    objectCache.set(o, none);
    return none;
  }
  const i = Math.max(0, keyIndexAt(keys, T));
  const visible = instant(keys, i, 'visible');
  const opacity = instant(keys, i, 'opacity');
  const color = instant(keys, i, 'color');
  const before = T < keys[0].t;
  const after = i >= keys.length - 1;
  const still = before || after || !segmentMoves(keys[i], keys[i + 1]);
  const lo = before ? -Infinity : keys[i].t;
  const hi = before ? keys[0].t : after ? Infinity : keys[i + 1].t;
  const state: CachedState = {
    pose: sampleTransformMatrix(keys, T, new Float32Array(16), pivotResolver(box, pivot), o.path === 'smooth'),
    visible: visible ?? null,
    opacity: opacity === undefined ? null : Math.min(1, Math.max(0, opacity)),
    color,
    pivot,
    box,
    lo: still ? lo : 1,
    hi: still ? hi : 0,
  };
  objectCache.set(o, state);
  return state;
}

/** The full frame at scene time T (DESIGN.md › Animation › Evaluation).
 *  `held` is the step playback waits at the end of (its card stays up and
 *  it stays the step — at a shared edge the next one would win). */
export function evaluate(view: SceneView, T: number, ctx: EvalContext, held: string | null = null): FrameState {
  const scene = view.scene;
  const poses = new Map<string, Float32Array>();
  const visible = new Map<string, boolean>();
  const opacity = new Map<string, number>();
  const colors = new Map<string, string | null>();
  for (const o of scene.objects) {
    const s = evaluateObject(o, T, ctx.pivots.get(o.id) ?? ORIGIN, ctx.boxes?.get(o.id) ?? null);
    if (s.pose) {
      poses.set(o.id, s.pose);
    }
    if (s.visible !== null) {
      visible.set(o.id, s.visible);
    }
    if (s.opacity !== null) {
      opacity.set(o.id, s.opacity);
    }
    if (s.color !== undefined) {
      colors.set(o.id, s.color);
    }
  }
  return {
    poses,
    visible,
    opacity,
    colors,
    look: rulesAt(scene.colorRules, T),
    camera: sampleCamera(scene.camera, T),
    clip: sampleClipState(scene.section, T),
    labels: keyAt(scene.labels, T),
    measurements: keyAt(scene.measurements, T),
    overlays: overlayFrames(view, T, held),
    step: (held && view.steps.some((s) => s.id === held) ? held : stepAt(view, T)?.id) ?? null,
  };
}

/** Objects whose keys move them somewhere (they get band slots first). */
export function movingObjects(doc: AnimationDoc): Set<string> {
  const out = new Set<string>();
  for (const scene of doc.scenes) {
    for (const o of scene.objects) {
      const moved = o.keys.some(
        (k) =>
          k.move.some((x) => x !== 0) ||
          Math.abs(k.rotate[3]) < 1 - 1e-9 ||
          (k.spin !== undefined && k.spin.degrees !== 0),
      );
      if (moved) {
        out.add(o.id);
      }
    }
  }
  return out;
}

/** Times worth sampling an object's motion at within [from, to]: its key
 *  times and `perSecond` samples inside each moving segment (at most
 *  `maxPerSegment`) — between them nothing moves it. Sorted, unique. */
export function objectMotionTimes(
  o: AnimObject,
  from: number,
  to: number,
  perSecond: number,
  maxPerSegment = 200,
): number[] {
  const times = new Set<number>();
  for (const [i, k] of o.keys.entries()) {
    if (k.t >= from && k.t <= to) {
      times.add(k.t);
    }
    const next = o.keys[i + 1];
    if (!next || !segmentMoves(k, next)) {
      continue;
    }
    const a = Math.max(from, k.t);
    const b = Math.min(to, next.t);
    if (b <= a) {
      continue;
    }
    const turns = Math.ceil((segmentTurn(k, next) * (b - a)) / (next.t - k.t) / SAMPLE_TURN_DEG);
    const n = Math.min(maxPerSegment, Math.max(1, Math.ceil((b - a) * perSecond), turns));
    for (let s = 0; s <= n; s++) {
      times.add(a + ((b - a) * s) / n);
    }
  }
  return [...times].sort((x, y) => x - y);
}
