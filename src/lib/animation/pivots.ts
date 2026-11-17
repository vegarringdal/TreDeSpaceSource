// -----------------------------------------------------------------------------
// pivots (DESIGN.md › Animation › Data model)
// -----------------------------------------------------------------------------
// An object turns about its pivot — a side of its items' box where they stand
// in the model, or a point — and a key may have a pivot of its own (plus an
// offset). Both resolve to a point in rest coordinates; the box is the
// object's rest bounds [minx, miny, minz, maxx, maxy, maxz]. Pure.

import type { KeyPivot, ObjectKey, ObjectPivot, PivotAnchor, V3 } from './types';

// -----------------------------------------------------------------------------
// types + constants
// -----------------------------------------------------------------------------

/** The object's rest bounds, min corner then max corner. */
export type RestBox = ArrayLike<number>;

/** A key's pivot as a point (rest coordinates). */
export type PivotOf = (key: ObjectKey) => V3;

/** A pivot as the Key panel offers it: as the object or a side of its box,
 *  plus an offset (m). `point` is a key's point shown without its box. */
export interface PivotChoice {
  at: PivotAnchor | 'object' | 'point';
  offset: V3;
}

export const PIVOT_ANCHORS: readonly PivotAnchor[] = ['center', 'bottom', 'top', 'front', 'back', 'left', 'right'];

const ORIGIN: V3 = [0, 0, 0];

/** Tenths of a millimetre are plenty for a pivot (keeps files tidy). */
const PIVOT_ROUND = 1e4;

function roundPivot(v: number): number {
  return Math.round(v * PIVOT_ROUND) / PIVOT_ROUND || 0;
}

// -----------------------------------------------------------------------------
// public api
// -----------------------------------------------------------------------------

export function isPivotAnchor(v: unknown): v is PivotAnchor {
  return typeof v === 'string' && (PIVOT_ANCHORS as readonly string[]).includes(v);
}

/** The middle of a side of the box (its centre for `center`); `fallback`
 *  without a box. */
export function anchorPoint(at: PivotAnchor, box: RestBox | null | undefined, fallback: V3 = ORIGIN): V3 {
  if (!box) {
    return [...fallback];
  }
  const c: V3 = [(box[0] + box[3]) / 2, (box[1] + box[4]) / 2, (box[2] + box[5]) / 2];
  switch (at) {
    case 'bottom':
      return [c[0], c[1], box[2]];
    case 'top':
      return [c[0], c[1], box[5]];
    case 'front':
      return [c[0], box[1], c[2]];
    case 'back':
      return [c[0], box[4], c[2]];
    case 'left':
      return [box[0], c[1], c[2]];
    case 'right':
      return [box[3], c[1], c[2]];
    default:
      return c;
  }
}

/** The object's pivot as a point; `center` falls back to `restCenter`. */
export function objectPivotPoint(p: ObjectPivot, box: RestBox | null | undefined, restCenter: V3): V3 {
  return Array.isArray(p) ? [...p] : anchorPoint(p, box, restCenter);
}

/** A key's pivot as a point: its own (side or point, plus offset), else the
 *  object's. */
export function keyPivotPoint(kp: KeyPivot | undefined, box: RestBox | null | undefined, objectPivot: V3): V3 {
  if (!kp) {
    return [...objectPivot];
  }
  const base = Array.isArray(kp.at) ? kp.at : anchorPoint(kp.at, box, objectPivot);
  const off = kp.offset ?? ORIGIN;
  return [base[0] + off[0], base[1] + off[1], base[2] + off[2]];
}

/** The resolver for one object's keys. */
export function pivotResolver(box: RestBox | null | undefined, objectPivot: V3): PivotOf {
  return (k) => keyPivotPoint(k.pivot, box, objectPivot);
}

/** A key's pivot as the Key panel shows it. A point (a hinge from a file
 *  or an older key) reads as the Centre plus the offset that reaches it, so
 *  the numbers say where the pivot is; `box` is the object's rest box. */
export function choiceOf(spec: KeyPivot | undefined, box?: RestBox | null): PivotChoice {
  if (!spec) {
    return { at: 'object', offset: [0, 0, 0] };
  }
  const offset: V3 = spec.offset ? [...spec.offset] : [0, 0, 0];
  if (!Array.isArray(spec.at)) {
    return { at: spec.at, offset };
  }
  if (!box) {
    return { at: 'point', offset };
  }
  const c = anchorPoint('center', box);
  const p = spec.at;
  return {
    at: 'center',
    offset: [
      roundPivot(p[0] + offset[0] - c[0]),
      roundPivot(p[1] + offset[1] - c[1]),
      roundPivot(p[2] + offset[2] - c[2]),
    ],
  };
}

/** A Key panel choice as a key's pivot (undefined = the object's own, no
 *  offset); a `point` choice keeps the key's point (`kept`). */
export function pivotSpec(choice: PivotChoice, objectPivot: ObjectPivot, kept?: KeyPivot): KeyPivot | undefined {
  const offset: Pick<KeyPivot, 'offset'> = choice.offset.some((x) => x !== 0) ? { offset: [...choice.offset] } : {};
  if (choice.at === 'object') {
    return offset.offset ? { at: objectPivot, ...offset } : undefined;
  }
  if (choice.at === 'point') {
    return Array.isArray(kept?.at) ? { at: kept.at, ...offset } : kept;
  }
  return { at: choice.at, ...offset };
}

/** The same side (or point) with the offset that puts the pivot on `rest`
 *  (a point of the object, rest coordinates) — a pivot dragged in the view
 *  becomes the offset from the side the key names. `objectPoint` is the
 *  object's own pivot as a point (what a key without a pivot is about). */
export function pivotThrough(
  spec: KeyPivot | undefined,
  objectPivot: ObjectPivot,
  box: RestBox | null | undefined,
  objectPoint: V3,
  rest: V3,
): KeyPivot | undefined {
  const at = spec?.at ?? objectPivot;
  const base = Array.isArray(at) ? at : anchorPoint(at, box, objectPoint);
  const offset: V3 = [roundPivot(rest[0] - base[0]), roundPivot(rest[1] - base[1]), roundPivot(rest[2] - base[2])];
  const kept: PivotAnchor | V3 = Array.isArray(at) ? [at[0], at[1], at[2]] : at;
  if (offset.every((x) => x === 0)) {
    return spec ? { at: kept } : undefined;
  }
  return { at: kept, offset };
}

/** Every key turning about the same point (`objectPivot` for all). */
export function fixedPivot(objectPivot: V3 = ORIGIN): PivotOf {
  return () => objectPivot;
}
