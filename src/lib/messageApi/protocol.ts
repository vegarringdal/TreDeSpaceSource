// Shared protocol pieces for the postMessage host API: the wire version, the
// typed command error, the handler shape, and payload validation helpers.
import { storeExists } from '../../state/stores/stores.state';

export const PROTOCOL = 1;

export class ApiError extends Error {
  readonly code: 'bad-payload' | 'not-ready' | 'busy' | 'not-found' | 'internal';
  constructor(code: 'bad-payload' | 'not-ready' | 'busy' | 'not-found' | 'internal', message: string) {
    super(message);
    this.code = code;
  }
}

/** One command implementation: gets the raw (validated-record) payload plus
 *  the command name (set/add pairs share one handler), the optional binary
 *  side-channel, and the sending window (ui.close). */
export type ApiHandler = (ctx: {
  type: string;
  p: Record<string, unknown>;
  bytes: unknown;
  source?: Window;
}) => Promise<unknown> | unknown;

// -----------------------------------------------------------------------------
// validation helpers
// -----------------------------------------------------------------------------

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

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
