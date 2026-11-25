// -----------------------------------------------------------------------------
// transform objects file (DESIGN.md › Transform objects)
// -----------------------------------------------------------------------------
// Parse / validate / serialize the saved object list. The file is untrusted
// (it is shared between people): every field is checked and an error names
// its JSON path. Pure — returns { error } instead of throwing.

import { isPivotAnchor } from '../animation/pivots';
import { roundPose } from './pose';
import {
  type ModelRef,
  type Quat,
  TRANSFORM_FORMAT,
  TRANSFORM_VERSION,
  type TransformDoc,
  type TransformObject,
  type TransformPivot,
  type V3,
} from './types';

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

export type TransformParseResult = Readonly<{ doc?: TransformDoc; error?: string }>;

class FieldError extends Error {}

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

/** Hard ceiling on a file's size (characters) — a guard, not a design limit. */
const MAX_DOC_CHARS = 16 << 20;
const ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
const ID_LENGTH = 8;

// -----------------------------------------------------------------------------
// readers
// -----------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function record(v: unknown, path: string): Record<string, unknown> {
  if (!isRecord(v)) {
    throw new FieldError(`${path}: expected an object`);
  }
  return v;
}

function text(v: unknown, path: string): string {
  if (typeof v !== 'string' || v.length === 0) {
    throw new FieldError(`${path}: expected a text`);
  }
  return v;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function numbers(v: unknown, path: string, length: number): number[] {
  if (!Array.isArray(v) || v.length !== length) {
    throw new FieldError(`${path}: expected ${length} numbers`);
  }
  const out: number[] = v.filter(isFiniteNumber);
  if (out.length !== length) {
    throw new FieldError(`${path}: expected ${length} numbers`);
  }
  return out;
}

function v3(v: unknown, path: string): V3 {
  const [x, y, z] = numbers(v, path, 3);
  return [x, y, z];
}

function quat(v: unknown, path: string): Quat {
  const [x, y, z, w] = numbers(v, path, 4);
  if (Math.hypot(x, y, z, w) < 1e-9) {
    throw new FieldError(`${path}: a rotation cannot be all zeros`);
  }
  return [x, y, z, w];
}

function names(v: unknown, path: string): string[] {
  if (!Array.isArray(v)) {
    throw new FieldError(`${path}: expected a list of names`);
  }
  return [...new Set(v.map((x, i) => text(x, `${path}[${i}]`).toLowerCase()))];
}

/** A model file ref; `store` and `group` may be empty (a model without
 *  them), `name` may not. */
function modelRefOf(v: unknown, path: string): ModelRef {
  const r = record(v, path);
  const field = (x: unknown, at: string) => {
    if (typeof x !== 'string') {
      throw new FieldError(`${at}: expected a text`);
    }
    return x;
  };
  return {
    store: field(r.store, `${path}.store`),
    group: field(r.group, `${path}.group`),
    name: text(r.name, `${path}.name`),
  };
}

function modelRefs(v: unknown, path: string): ModelRef[] {
  if (!Array.isArray(v)) {
    throw new FieldError(`${path}: expected a list of model files`);
  }
  return v.map((x, i) => modelRefOf(x, `${path}[${i}]`));
}

function pivot(v: unknown, path: string): TransformPivot {
  if (v === undefined) {
    return { at: 'center' };
  }
  const p = record(v, path);
  const at = isPivotAnchor(p.at) ? p.at : v3(p.at, `${path}.at`);
  return p.offset === undefined ? { at } : { at, offset: v3(p.offset, `${path}.offset`) };
}

function object(v: unknown, path: string): TransformObject {
  const o = record(v, path);
  const items = names(o.items, `${path}.items`);
  if (items.length === 0) {
    throw new FieldError(`${path}.items: an object needs at least one item`);
  }
  const exclude = o.exclude === undefined ? [] : names(o.exclude, `${path}.exclude`);
  const models = o.models === undefined ? [] : modelRefs(o.models, `${path}.models`);
  const pose = roundPose({
    move: o.move === undefined ? [0, 0, 0] : v3(o.move, `${path}.move`),
    rotate: o.rotate === undefined ? [0, 0, 0, 1] : quat(o.rotate, `${path}.rotate`),
    scale: o.scale === undefined ? [1, 1, 1] : v3(o.scale, `${path}.scale`),
  });
  return {
    id: o.id === undefined ? newTransformId() : text(o.id, `${path}.id`),
    name: o.name === undefined ? items[0] : text(o.name, `${path}.name`),
    items,
    ...(exclude.length > 0 ? { exclude } : {}),
    ...(models.length > 0 ? { models } : {}),
    ...(o.parent === undefined ? {} : { parent: text(o.parent, `${path}.parent`) }),
    pivot: pivot(o.pivot, `${path}.pivot`),
    ...pose,
    ...(o.muted === true ? { muted: true } : {}),
  };
}

/** Parents that are missing, or that loop back, are dropped. */
function tidyParents(objects: TransformObject[]): TransformObject[] {
  const byId = new Map(objects.map((o) => [o.id, o]));
  const loops = (o: TransformObject): boolean => {
    const seen = new Set([o.id]);
    for (let at = o.parent; at; at = byId.get(at)?.parent) {
      if (seen.has(at)) {
        return true;
      }
      seen.add(at);
    }
    return false;
  };
  return objects.map((o) => {
    if (o.parent && byId.has(o.parent) && !loops(o)) {
      return o;
    }
    const { parent: _dropped, ...rest } = o;
    return rest;
  });
}

// -----------------------------------------------------------------------------
// public api
// -----------------------------------------------------------------------------

/** Short random id (8 chars, ~40 bits). */
export function newTransformId(): string {
  const bytes = new Uint8Array(ID_LENGTH);
  crypto.getRandomValues(bytes);
  let out = 't';
  for (const b of bytes) {
    out += ID_ALPHABET[b % ID_ALPHABET.length];
  }
  return out;
}

/** Check a parsed JSON value as a transform objects file. */
export function validateTransformDoc(raw: unknown): TransformParseResult {
  try {
    const d = record(raw, 'file');
    if (d.format !== TRANSFORM_FORMAT) {
      return { error: `Not a transform objects file (format is not '${TRANSFORM_FORMAT}')` };
    }
    if (d.version !== TRANSFORM_VERSION) {
      return {
        error: `Unsupported transform objects version ${String(d.version)} (this build reads ${TRANSFORM_VERSION})`,
      };
    }
    if (!Array.isArray(d.objects)) {
      return { error: 'objects: expected a list' };
    }
    const objects = d.objects.map((o, i) => object(o, `objects[${i}]`));
    const ids = new Set<string>();
    for (const o of objects) {
      if (ids.has(o.id)) {
        return { error: `objects: the id '${o.id}' is used twice` };
      }
      ids.add(o.id);
    }
    return { doc: { format: TRANSFORM_FORMAT, version: TRANSFORM_VERSION, objects: tidyParents(objects) } };
  } catch (e) {
    if (e instanceof FieldError) {
      return { error: e.message };
    }
    throw e;
  }
}

/** Parse the text of a transform objects file. */
export function parseTransformDoc(json: string): TransformParseResult {
  if (json.length > MAX_DOC_CHARS) {
    return { error: 'The transform objects file is too large' };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    return { error: `Not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  return validateTransformDoc(raw);
}

/** Pretty JSON for Save. */
export function serializeTransformDoc(objects: readonly TransformObject[]): string {
  const doc: TransformDoc = { format: TRANSFORM_FORMAT, version: TRANSFORM_VERSION, objects: [...objects] };
  return JSON.stringify(doc, null, 1);
}
