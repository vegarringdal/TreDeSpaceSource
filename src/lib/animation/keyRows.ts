// -----------------------------------------------------------------------------
// key rows (DESIGN.md › Animation › Authoring)
// -----------------------------------------------------------------------------
// Pure edits of one row of keys (object, camera, section, colour rules):
// insert / replace at a time, retime a selection, delete, copy. Rows stay
// sorted by time and never hold two keys at the same moment. Plus the Slide
// in helper and the pose an object holds at a time.

import {
  decomposeRigid,
  interpEase,
  keyIndexAt,
  m4InvertRigid,
  m4TransformPoint,
  poseMatrix,
  sampleTransform,
} from './interp';
import type { PivotOf } from './pivots';
import type { AnimObject, Interp, ObjectKey, V3 } from './types';

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

/** Two keys closer than this are the same key (s). */
export const SAME_KEY_S = 1e-3;

/** Fewer degrees than this is no spin. */
const NO_SPIN_DEG = 1e-6;

/** The six directions Slide in comes from (Z is up). */
export const SLIDE_DIRECTIONS: readonly { value: string; label: string; dir: V3 }[] = [
  { value: 'above', label: 'From above', dir: [0, 0, 1] },
  { value: 'below', label: 'From below', dir: [0, 0, -1] },
  { value: 'east', label: 'From +X', dir: [1, 0, 0] },
  { value: 'west', label: 'From −X', dir: [-1, 0, 0] },
  { value: 'north', label: 'From +Y', dir: [0, 1, 0] },
  { value: 'south', label: 'From −Y', dir: [0, -1, 0] },
];

// -----------------------------------------------------------------------------
// rows
// -----------------------------------------------------------------------------

/** Insert `key`, replacing a key at the same time; sorted. */
export function upsertKey<K extends { t: number }>(keys: readonly K[], key: K): K[] {
  const rest = keys.filter((k) => Math.abs(k.t - key.t) > SAME_KEY_S);
  return [...rest, key].sort((a, b) => a.t - b.t);
}

/** Index of the key at time t (within SAME_KEY_S), or -1. */
export function keyIndexNear(keys: readonly { t: number }[], t: number): number {
  return keys.findIndex((k) => Math.abs(k.t - t) <= SAME_KEY_S);
}

/** The row without the keys at `indices`. */
export function removeKeys<K>(keys: readonly K[], indices: readonly number[]): K[] {
  const drop = new Set(indices);
  return keys.filter((_, i) => !drop.has(i));
}

/** Keys at `indices` moved by dt (never before 0); a moved key lands on and
 *  replaces a key that stays. Returns the row and where the moved keys are
 *  now. */
export function retimeKeys<K extends { t: number }>(
  keys: readonly K[],
  indices: readonly number[],
  dt: number,
): { keys: K[]; indices: number[] } {
  const moving = new Set(indices);
  const shift = Math.max(dt, -Math.min(...indices.map((i) => keys[i]?.t ?? 0)));
  const moved = keys.filter((_, i) => moving.has(i)).map((k) => ({ ...k, t: k.t + shift }));
  const stay = keys.filter((k, i) => !moving.has(i) && !moved.some((m) => Math.abs(m.t - k.t) <= SAME_KEY_S));
  const all = [...stay.map((k) => ({ k, moved: false })), ...moved.map((k) => ({ k, moved: true }))].sort(
    (a, b) => a.k.t - b.k.t,
  );
  return {
    keys: all.map((x) => x.k),
    indices: all.flatMap((x, i) => (x.moved ? [i] : [])),
  };
}

/** Copies of the keys at `indices`, timed from the first of them (paste
 *  puts that one at the time slider). */
export function copyKeys<K extends { t: number }>(keys: readonly K[], indices: readonly number[]): K[] {
  const picked = keys.filter((_, i) => indices.includes(i));
  const t0 = picked[0]?.t ?? 0;
  return picked.map((k) => ({ ...structuredClone(k), t: k.t - t0 }));
}

/** `clip` (times from 0) pasted at T, replacing keys at the same times. */
export function pasteKeys<K extends { t: number }>(keys: readonly K[], clip: readonly K[], T: number): K[] {
  let out = [...keys];
  for (const k of clip) {
    out = upsertKey(out, { ...structuredClone(k), t: Math.max(0, T + k.t) });
  }
  return out;
}

// -----------------------------------------------------------------------------
// objects
// -----------------------------------------------------------------------------

/** Where the object stands at T as a key would hold it (the rest when it
 *  has no keys): move / rotate about `pivot`, the pivot of the key the
 *  object is heading to (`pivotOf` resolves keys' pivots). */
export function poseAt(
  o: AnimObject,
  T: number,
  pivotOf?: PivotOf,
): Pick<ObjectKey, 'move' | 'rotate'> & { pivot: V3 } {
  return sampleTransform(o.keys, T, o.path === 'smooth', pivotOf);
}

/** The key whose pivot the pose at T is about: the next key after T, else
 *  the last. */
function pivotKeyAt(o: AnimObject, T: number): ObjectKey | undefined {
  return o.keys.find((k) => k.t > T + SAME_KEY_S) ?? o.keys[o.keys.length - 1];
}

/** Where a key's pivot is at that key (a point in the model): its rest point
 *  moved by the key. */
export function keyPivotWorld(key: ObjectKey, pivotOf: PivotOf): V3 {
  const q = pivotOf(key);
  return [q[0] + key.move[0], q[1] + key.move[1], q[2] + key.move[2]];
}

/** The same pose said about another pivot: `from` → `to` (rest points;
 *  double precision, so a model far from the origin keeps its place). */
export function rePivot(key: Pick<ObjectKey, 'move' | 'rotate'>, from: V3, to: V3): Pick<ObjectKey, 'move' | 'rotate'> {
  return decomposeRigid(poseMatrix(key, from, new Float64Array(16)), to);
}

/** The point of the object at `world` when it stands as `key` has it (rest
 *  coordinates) — a Point pivot from a point in the model. */
export function restPointAt(key: ObjectKey, pivotOf: PivotOf, world: V3): V3 {
  return m4TransformPoint(
    m4InvertRigid(poseMatrix(key, pivotOf(key), new Float64Array(16)), new Float64Array(16)),
    world,
  );
}

/** The instant values (visible, opacity, colour) the object has at T. */
export function instantAt(o: AnimObject, T: number): Pick<ObjectKey, 'visible' | 'opacity' | 'color'> {
  const at = Math.max(T, o.keys[0]?.t ?? T);
  const out: Pick<ObjectKey, 'visible' | 'opacity' | 'color'> = {};
  for (const k of o.keys) {
    if (k.t > at + SAME_KEY_S) {
      break;
    }
    if (k.visible !== undefined) {
      out.visible = k.visible;
    }
    if (k.opacity !== undefined) {
      out.opacity = k.opacity;
    }
    if (k.color !== undefined) {
      out.color = k.color;
    }
  }
  return out;
}

/** A key's instant values (visible, opacity, colour) — only those it sets. */
function instantsOf(k: ObjectKey): Pick<ObjectKey, 'visible' | 'opacity' | 'color'> {
  return {
    ...(k.visible !== undefined ? { visible: k.visible } : {}),
    ...(k.opacity !== undefined ? { opacity: k.opacity } : {}),
    ...(k.color !== undefined ? { color: k.color } : {}),
  };
}

/** A key at T holding where the object stands then; a new key takes the
 *  pivot of the key the object is heading to, so the motion keeps its
 *  shape. Its instant values are left to the keys before it — before the
 *  first key there are none, so it takes the first key's (they apply from
 *  the start: an object hidden until its first key stays hidden). */
export function keyHere(o: AnimObject, T: number, interp: Interp, pivotOf?: PivotOf): ObjectKey {
  const at = keyIndexNear(o.keys, T);
  const own = at >= 0 ? o.keys[at] : undefined;
  if (own) {
    return { ...own };
  }
  const { move, rotate } = poseAt(o, T, pivotOf);
  const ref = pivotKeyAt(o, T);
  const first = o.keys[0];
  const early = first && T < first.t ? instantsOf(first) : {};
  return { t: T, move, rotate, interp, ...early, ...(ref?.pivot ? { pivot: structuredClone(ref.pivot) } : {}) };
}

/** The row with `key` in it (replacing a key at its time). A NEW key inside
 *  a spinning segment takes its share of the turns and the key after it
 *  keeps the rest, so the object turns on as it did (exact for linear
 *  arrival; the eased share otherwise). */
export function insertObjectKey(keys: readonly ObjectKey[], key: ObjectKey): ObjectKey[] {
  const i = keyIndexAt(keys, key.t);
  const a = keys[i];
  const b = keys[i + 1];
  const spin = b?.spin;
  if (key.spin || keyIndexNear(keys, key.t) >= 0 || !a || !b || !spin || Math.abs(spin.degrees) <= NO_SPIN_DEG) {
    return upsertKey(keys, key);
  }
  const share = spin.degrees * interpEase(b.interp, (key.t - a.t) / (b.t - a.t));
  const rest = spin.degrees - share;
  const { spin: _dropped, ...plain } = b;
  const after: ObjectKey =
    Math.abs(rest) > NO_SPIN_DEG ? { ...b, spin: { axis: [...spin.axis], degrees: rest } } : plain;
  const added: ObjectKey =
    Math.abs(share) > NO_SPIN_DEG ? { ...key, spin: { axis: [...spin.axis], degrees: share } } : key;
  return upsertKey(
    keys.map((k) => (k === b ? after : k)),
    added,
  );
}

/** Slide in: the object waits hidden away from where it stands at T (when
 *  nothing keys it before T), appears there at T and slides into place by
 *  T + duration. `dir` points from the place towards where it comes from. */
export function slideInKeys(
  o: AnimObject,
  T: number,
  dir: V3,
  distance: number,
  duration: number,
  interp: Interp,
  pivotOf?: PivotOf,
): ObjectKey[] {
  const place = poseAt(o, T + duration, pivotOf);
  const ref = pivotKeyAt(o, T + duration - SAME_KEY_S);
  const pivot = ref?.pivot ? { pivot: structuredClone(ref.pivot) } : {};
  const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const away: V3 = [
    place.move[0] + (dir[0] / l) * distance,
    place.move[1] + (dir[1] / l) * distance,
    place.move[2] + (dir[2] / l) * distance,
  ];
  const rotate = place.rotate;
  let keys = o.keys.filter((k) => k.t < T - SAME_KEY_S || k.t > T + duration + SAME_KEY_S);
  const before = keys.some((k) => k.t < T - SAME_KEY_S);
  if (!before && T > SAME_KEY_S) {
    keys = upsertKey(keys, { t: 0, move: away, rotate, interp: 'hold', visible: false, ...pivot });
  }
  keys = upsertKey(keys, { t: T, move: away, rotate, interp: 'hold', visible: true, ...pivot });
  return upsertKey(keys, { t: T + duration, move: place.move, rotate, interp, ...pivot });
}
