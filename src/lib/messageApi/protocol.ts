// Shared protocol pieces for the postMessage host API: the handler shape and
// payload validation helpers. The wire version, the typed command error and
// the envelope routing live in wire.ts (no app imports, unit-tested) and are
// re-exported here so handlers keep one import.
import { storeExists } from '../../state/stores/stores.state';
import { colorToHex } from '../color/hexColor';
import { ApiError, isRecord } from './wire';

export { ApiError, type ApiErrorCode, isRecord, PROTOCOL } from './wire';

/** One command implementation: gets the raw (validated-record) payload plus
 *  the command name (set/add pairs share one handler), the optional binary
 *  side-channel, and the sending window (ui.close). */
export type ApiHandler = (ctx: {
  type: string;
  p: Record<string, unknown>;
  bytes: unknown;
  source?: Window;
  /** Aborted when the caller cancels (`command.cancel`, the SDK's timeout, or
   *  the client going away). Handlers that download or loop over a batch pass
   *  it on / check it; the rest simply answer `cancelled` at the end. */
  signal?: AbortSignal;
}) => Promise<unknown> | unknown;

// -----------------------------------------------------------------------------
// validation helpers
// -----------------------------------------------------------------------------

/** A finite number, optionally range-checked. `undefined` is NOT accepted —
 *  use `?? fallback` at the call site for an optional field. */
export function num(v: unknown, what: string, range?: { min?: number; max?: number }): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new ApiError('bad-payload', `${what} must be a finite number`);
  }
  if (range?.min !== undefined && v < range.min) {
    throw new ApiError('bad-payload', `${what} must be >= ${range.min}`);
  }
  if (range?.max !== undefined && v > range.max) {
    throw new ApiError('bad-payload', `${what} must be <= ${range.max}`);
  }
  return v;
}

/** Optional number: `undefined` / `null` → `fallback`, anything else validated. */
export function numOpt(v: unknown, what: string, fallback: number, range?: { min?: number; max?: number }): number {
  return v === undefined || v === null ? fallback : num(v, what, range);
}

export function str(v: unknown, what: string, max = 1024): string {
  if (typeof v !== 'string') {
    throw new ApiError('bad-payload', `${what} must be a string`);
  }
  if (v.length > max) {
    throw new ApiError('bad-payload', `${what} must be at most ${max} characters`);
  }
  return v;
}

export function strOpt(v: unknown, what: string, fallback: string, max = 1024): string {
  return v === undefined || v === null ? fallback : str(v, what, max);
}

/** Optional colour: `undefined` / `null` → `fallback`, a `'#rrggbb'` code or a
 *  CSS colour name → canonical lowercase hex. The fallback types the result,
 *  so `null` expresses "follow the panel style". */
export function colorOpt<T extends string | null>(v: unknown, what: string, fallback: T): string | T {
  if (v === undefined || v === null) {
    return fallback;
  }
  const hex = typeof v === 'string' ? colorToHex(v) : null;
  if (hex === null) {
    throw new ApiError('bad-payload', `${what} must be a '#rrggbb' hex colour or a CSS colour name`);
  }
  return hex;
}

export function boolOpt(v: unknown, what: string, fallback: boolean): boolean {
  if (v === undefined || v === null) {
    return fallback;
  }
  if (typeof v !== 'boolean') {
    throw new ApiError('bad-payload', `${what} must be a boolean`);
  }
  return v;
}

/** A fixed-length tuple of finite numbers — the shape every vector/quaternion
 *  field on the wire has. `[1]` or `['x', 0, 0]` is rejected here rather than
 *  becoming NaN in a GPU uniform three layers down. */
function numTuple(v: unknown, what: string, n: number): number[] {
  if (!Array.isArray(v) || v.length !== n) {
    throw new ApiError('bad-payload', `${what} must be an array of ${n} numbers`);
  }
  return v.map((x, i) => num(x, `${what}[${i}]`));
}

export function vec3(v: unknown, what: string): [number, number, number] {
  const [x, y, z] = numTuple(v, what, 3);
  return [x, y, z];
}

export function vec3Opt(
  v: unknown,
  what: string,
  fallback: readonly [number, number, number],
): [number, number, number] {
  return v === undefined || v === null ? [fallback[0], fallback[1], fallback[2]] : vec3(v, what);
}

export function vec2Opt(v: unknown, what: string, fallback: readonly [number, number]): [number, number] {
  if (v === undefined || v === null) {
    return [fallback[0], fallback[1]];
  }
  const [x, y] = numTuple(v, what, 2);
  return [x, y];
}

export function quat(v: unknown, what: string): [number, number, number, number] {
  const [x, y, z, w] = numTuple(v, what, 4);
  return [x, y, z, w];
}

export function quatOpt(
  v: unknown,
  what: string,
  fallback: readonly [number, number, number, number],
): [number, number, number, number] {
  return v === undefined || v === null ? [fallback[0], fallback[1], fallback[2], fallback[3]] : quat(v, what);
}

/** One of a fixed set of string values. */
export function oneOf<T extends string>(v: unknown, what: string, allowed: readonly T[]): T {
  if (typeof v !== 'string' || !allowed.includes(v as T)) {
    throw new ApiError('bad-payload', `${what} must be one of: ${allowed.join(', ')}`);
  }
  return v as T;
}

export function strings(v: unknown, what: string): string[] {
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
    throw new ApiError('bad-payload', `${what} must be a string[]`);
  }
  return v as string[];
}

export function records(v: unknown, what: string): Record<string, unknown>[] {
  if (!Array.isArray(v) || v.some((x) => !isRecord(x))) {
    throw new ApiError('bad-payload', `${what} must be an object[]`);
  }
  return v as Record<string, unknown>[];
}

/** A binary name list from the `bytes` side-channel — UTF-8 text, one
 *  `fullname[<sep>color[:opacity]]` per line. An ArrayBuffer arrives
 *  TRANSFERRED (zero-copy); a Blob is read once. The caller packs it without
 *  ever making a JS string per row. */
export async function nameListBytes(bytes: unknown, what: string): Promise<Uint8Array> {
  if (bytes instanceof ArrayBuffer) {
    return new Uint8Array(bytes);
  }
  if (bytes instanceof Blob) {
    return new Uint8Array(await bytes.arrayBuffer());
  }
  throw new ApiError('bad-payload', `${what} needs the name list in \`bytes\` (an ArrayBuffer or Blob of UTF-8 text)`);
}

/** Validate an optional `store` payload field: undefined → undefined (no
 *  filter / default), a known store name → itself, an unknown name → not-found
 *  (hosts must fetch stores.list first). */
export function requireStoreOpt(v: unknown): string | undefined {
  if (v === undefined || v === null) {
    return undefined;
  }
  if (typeof v !== 'string') {
    throw new ApiError('bad-payload', 'store must be a string');
  }
  if (!storeExists(v)) {
    throw new ApiError('not-found', `no store named "${v}" — call stores.list first`);
  }
  return v;
}
