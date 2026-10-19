// -----------------------------------------------------------------------------
// strict JSON field readers
// -----------------------------------------------------------------------------
// The building blocks of the file parsers (animation files, overlay designs):
// each reader checks one value and throws a FieldError naming its path. A
// parser wraps its run in try / catch and returns { error } — files arrive
// from users and host pages, so wrong types are errors, never guesses.

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

/** What is wrong and where (`path: message`). */
export class FieldError extends Error {}

export type Obj = Record<string, unknown>;

type V3 = [number, number, number];
type Quat = [number, number, number, number];

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

const ID_RE = /^[A-Za-z0-9_:.-]{1,64}$/;

// -----------------------------------------------------------------------------
// readers
// -----------------------------------------------------------------------------

export function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function obj(v: unknown, path: string): Obj {
  if (!isObj(v)) {
    throw new FieldError(`${path}: expected an object`);
  }
  return v;
}

export function arr(v: unknown, path: string, optional = false): unknown[] {
  if (v === undefined && optional) {
    return [];
  }
  if (!Array.isArray(v)) {
    throw new FieldError(`${path}: expected an array`);
  }
  return v;
}

export function str(v: unknown, path: string, fallback?: string): string {
  if (v === undefined && fallback !== undefined) {
    return fallback;
  }
  if (typeof v !== 'string') {
    throw new FieldError(`${path}: expected a string`);
  }
  return v;
}

/** A short id: letters, digits and `_ : . -`, at most 64 characters. */
export function id(v: unknown, path: string): string {
  const s = str(v, path);
  if (!ID_RE.test(s)) {
    throw new FieldError(`${path}: invalid id "${s.slice(0, 40)}"`);
  }
  return s;
}

export function num(v: unknown, path: string, fallback?: number): number {
  if (v === undefined && fallback !== undefined) {
    return fallback;
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new FieldError(`${path}: expected a finite number`);
  }
  return v;
}

/** A number clamped into [min, max]. */
export function clampNum(v: unknown, path: string, min: number, max: number, fallback?: number): number {
  return Math.min(max, Math.max(min, num(v, path, fallback)));
}

export function bool(v: unknown, path: string, fallback?: boolean): boolean {
  if (v === undefined && fallback !== undefined) {
    return fallback;
  }
  if (typeof v !== 'boolean') {
    throw new FieldError(`${path}: expected true/false`);
  }
  return v;
}

export function oneOf<T extends string>(v: unknown, list: readonly T[], path: string, fallback?: T): T {
  if (v === undefined && fallback !== undefined) {
    return fallback;
  }
  const hit = list.find((x) => x === v);
  if (hit === undefined) {
    throw new FieldError(`${path}: expected one of ${list.join(', ')}`);
  }
  return hit;
}

export function v2(v: unknown, path: string): [number, number] {
  const a = arr(v, path);
  if (a.length !== 2) {
    throw new FieldError(`${path}: expected [x, y]`);
  }
  return [num(a[0], path), num(a[1], path)];
}

export function v3(v: unknown, path: string): V3 {
  const a = arr(v, path);
  if (a.length !== 3) {
    throw new FieldError(`${path}: expected [x, y, z]`);
  }
  return [num(a[0], path), num(a[1], path), num(a[2], path)];
}

/** A rotation [x, y, z, w], normalized; a zero quaternion is an error. */
export function quat(v: unknown, path: string): Quat {
  const a = arr(v, path);
  if (a.length !== 4) {
    throw new FieldError(`${path}: expected [x, y, z, w]`);
  }
  const q: Quat = [num(a[0], path), num(a[1], path), num(a[2], path), num(a[3], path)];
  const l = Math.hypot(...q);
  if (l < 1e-9) {
    throw new FieldError(`${path}: zero quaternion`);
  }
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

/** Run a throwing reader as a Result-style `{ value } | { error }`. */
export function readField<T>(read: () => T): { value?: T; error?: string } {
  try {
    return { value: read() };
  } catch (e) {
    if (e instanceof FieldError) {
      return { error: e.message };
    }
    throw e;
  }
}
