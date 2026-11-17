// -----------------------------------------------------------------------------
// transform objects (DESIGN.md › Transform objects)
// -----------------------------------------------------------------------------
// What the Transform ribbon moves: a named set of items with ONE absolute
// pose — how far it stands from where the model has it — and an optional
// parent whose pose it rides on. The same item-set and pivot vocabulary as an
// animation object, plus scale. JSON-serializable; metres, quaternions
// (degrees only in the UI). Pure — no store imports, so the core unit-tests.

import type { KeyPivot, Quat, V3 } from '../animation/types';

export type { KeyPivot, Quat, V3 };

/** A side of the object's rest box or a point of it, plus an offset (m). */
export type TransformPivot = KeyPivot;

/** One transform object. */
export interface TransformObject {
  id: string;
  name: string;
  /** lower-cased fullnames; an item under a named node moves with it */
  items: string[];
  /** lower-cased fullnames left out (with what is under them) */
  exclude?: string[];
  /** id of the object this one rides on (its pose is applied on top of this
   *  one's); absent = it stands on its own */
  parent?: string;
  /** what `move`, `rotate` and `scale` are about, in rest coordinates */
  pivot: TransformPivot;
  /** offset from where the items stand in the model (m), in the parent's
   *  rest frame */
  move: V3;
  rotate: Quat;
  /** per axis, along the object's own (rotated) axes */
  scale: V3;
  /** shown where the model has it (its pose is kept, its children still
   *  ride on its parent) */
  muted?: boolean;
}

/** The saved file. */
export interface TransformDoc {
  format: 'tredespace.transforms';
  version: 1;
  objects: TransformObject[];
}

/** An object's rest box [minx, miny, minz, maxx, maxy, maxz], by object id. */
export type RestBoxes = ReadonlyMap<string, ArrayLike<number>>;

/** The pose fields of an object. */
export type Pose = Pick<TransformObject, 'move' | 'rotate' | 'scale'>;

export const TRANSFORM_FORMAT = 'tredespace.transforms';
export const TRANSFORM_VERSION = 1;

export const IDENTITY_POSE: Pose = { move: [0, 0, 0], rotate: [0, 0, 0, 1], scale: [1, 1, 1] };
