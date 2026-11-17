// Wire-level pieces of the postMessage host API with NO app imports, so the
// envelope routing is unit-testable: the protocol version, the typed command
// error, the pure classification of an inbound message and the reply shape.
// index.ts owns the side effects (client registry, dispatch, postMessage).

export const PROTOCOL = 1;

export type ApiErrorCode =
  | 'bad-payload'
  | 'not-ready'
  /** the import lock is held — the command never ran, so a retry is sensible */
  | 'busy'
  | 'not-found'
  /** a URL the command was told to fetch could not be downloaded */
  | 'download'
  /** SQLite rejected the statement (a caller error: bad SQL, no such table) */
  | 'sql'
  /** the caller cancelled it (an AbortSignal, or the SDK's timeout) */
  | 'cancelled'
  | 'internal'
  | 'unknown-command';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface WireError {
  code: ApiErrorCode;
  message: string;
}

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** An inbound message once classified: a command to answer, one of the SDK's
 *  id-less client notes, or something to drop (with why, for tests). */
export type Inbound =
  | { kind: 'ignore'; reason: 'origin' | 'envelope' | 'no-source' | 'no-id' | 'own-traffic' }
  | { kind: 'hello' }
  | { kind: 'bye' }
  /** `command.cancel` — abort the in-flight command with this id, if it is
   *  still running and belongs to the sender. Carries no id of its own: it is
   *  a note, not a request, and gets no reply. */
  | { kind: 'cancel'; cancelId: string }
  | { kind: 'command'; id: string; type: string; payload: Record<string, unknown>; bytes: unknown };

/** The command's answer, ready to go into a result envelope. */
export type Answer = { ok: true; payload: unknown } | { ok: false; error: WireError };

/**
 * Classify one `message` event. Order matters and mirrors the trust model:
 * the origin gate first (a disallowed sender is never parsed), then the
 * envelope (our protocol number and a string type), then a sending window to
 * answer. `client.hello` / `client.bye` are the SDK's id-less notes; anything
 * else without a string id is not a request, and our own outbound traffic
 * (`*:result`, `app.ready`) reflected back is dropped.
 */
export function classifyInbound(data: unknown, originAllowed: boolean, hasSource: boolean): Inbound {
  if (!originAllowed) {
    return { kind: 'ignore', reason: 'origin' };
  }
  if (!isRecord(data) || data.tredespace !== PROTOCOL || typeof data.type !== 'string') {
    return { kind: 'ignore', reason: 'envelope' };
  }
  if (!hasSource) {
    return { kind: 'ignore', reason: 'no-source' };
  }
  if (data.id === null && data.type === 'client.hello') {
    return { kind: 'hello' };
  }
  if (data.id === null && data.type === 'client.bye') {
    return { kind: 'bye' };
  }
  if (data.id === null && data.type === 'command.cancel') {
    const cancelId = isRecord(data.payload) ? data.payload.id : undefined;
    return typeof cancelId === 'string' ? { kind: 'cancel', cancelId } : { kind: 'ignore', reason: 'no-id' };
  }
  if (typeof data.id !== 'string') {
    return { kind: 'ignore', reason: 'no-id' };
  }
  if (data.type.endsWith(':result') || data.type === 'app.ready') {
    return { kind: 'ignore', reason: 'own-traffic' };
  }
  return {
    kind: 'command',
    id: data.id,
    type: data.type,
    payload: isRecord(data.payload) ? data.payload : {},
    bytes: data.bytes,
  };
}

/** Map anything a handler throws to a wire error: an ApiError keeps its code,
 *  everything else is `internal` with the message. */
export function toWireError(err: unknown): WireError {
  if (err instanceof ApiError) {
    return { code: err.code, message: err.message };
  }
  return { code: 'internal', message: err instanceof Error ? err.message : String(err) };
}

/** Answer a command: `not-ready` while the app boots, else the dispatcher's
 *  result, with every throw mapped to a wire error — a handler can never
 *  leave a request unanswered. */
export async function answerCommand(
  cmd: Extract<Inbound, { kind: 'command' }>,
  ready: boolean,
  dispatch: (type: string, payload: Record<string, unknown>, bytes: unknown) => Promise<unknown>,
  signal?: AbortSignal,
): Promise<Answer> {
  if (!ready) {
    return { ok: false, error: { code: 'not-ready', message: 'app is still booting — wait for app.ready' } };
  }
  try {
    const payload = await dispatch(cmd.type, cmd.payload, cmd.bytes);
    // a handler that finished anyway after an abort still reports cancelled:
    // the caller has stopped listening for a success
    if (signal?.aborted) {
      return { ok: false, error: { code: 'cancelled', message: `${cmd.type} was cancelled` } };
    }
    return { ok: true, payload };
  } catch (err) {
    if (signal?.aborted) {
      return { ok: false, error: { code: 'cancelled', message: `${cmd.type} was cancelled` } };
    }
    return { ok: false, error: toWireError(err) };
  }
}

/**
 * Buffers in a handler's payload that should MOVE to the host instead of being
 * copied. Kept beside the payload (a WeakMap, not a field) so nothing extra
 * ever reaches the wire; `transfersOf` reads it back just before the reply is
 * posted. A cross-origin window is fine — postMessage's transfer list is not
 * origin-restricted.
 */
const transferLists = new WeakMap<object, Transferable[]>();

export function withTransfer<T extends object>(payload: T, list: Transferable[]): T {
  transferLists.set(payload, list);
  return payload;
}

/** The transfer list an answer's payload declared, or none. */
export function transfersOf(answer: Answer): Transferable[] {
  if (!answer.ok || typeof answer.payload !== 'object' || answer.payload === null) {
    return [];
  }
  return transferLists.get(answer.payload) ?? [];
}

/** The one result envelope a request gets (same id, `type:result`). */
export function resultEnvelope(id: string, type: string, answer: Answer): Record<string, unknown> {
  return { tredespace: PROTOCOL, id, type: `${type}:result`, ...answer };
}

/** Where a reply is posted: the sender's origin — or `*` for a sandboxed
 *  sender whose origin is the literal `'null'`, the only way to reach it. */
export function replyOrigin(origin: string): string {
  return origin === 'null' ? '*' : origin;
}
