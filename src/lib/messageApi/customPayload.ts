// Validation for the custom-event bus commands (custom.*). Pure — no store,
// no protocol import — so the rules are unit-testable; the handler turns a
// returned error into ApiError.

// -----------------------------------------------------------------------------
// types + limits
// -----------------------------------------------------------------------------

export type Outcome<T> = { ok: true; value: T } | { ok: false; error: string };

export const MAX_EVENT_NAME = 128;
export const MAX_CLIENT_NAME = 64;
/** JSON text length cap for `data` (UTF-16 units — about 1 MB). */
export const MAX_DATA_CHARS = 1024 * 1024;

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function nonEmptyString(v: unknown, what: string, max: number): Outcome<string> {
  if (typeof v !== 'string' || !v.trim()) {
    return { ok: false, error: `${what} must be a non-empty string` };
  }
  if (v.length > max) {
    return { ok: false, error: `${what} must be at most ${max} characters` };
  }
  return { ok: true, value: v };
}

function stringList(v: unknown, what: string, max: number): Outcome<string[]> {
  if (!Array.isArray(v)) {
    return { ok: false, error: `${what} must be a string[]` };
  }
  const out: string[] = [];
  for (const s of v) {
    const r = nonEmptyString(s, `${what} entries`, max);
    if (!r.ok) {
      return r;
    }
    out.push(r.value);
  }
  return { ok: true, value: out };
}

// -----------------------------------------------------------------------------
// parsers
// -----------------------------------------------------------------------------

export function parseEventName(v: unknown): Outcome<string> {
  return nonEmptyString(v, 'event', MAX_EVENT_NAME);
}

/** `events` of custom.subscribe: omitted = every event (null), an empty list
 *  = presence only (no custom events at all), otherwise exact names. */
export function parseEventFilter(v: unknown): Outcome<string[] | null> {
  if (v === undefined) {
    return { ok: true, value: null };
  }
  return stringList(v, 'events', MAX_EVENT_NAME);
}

/** Optional `name` / `tag` of custom.subscribe. */
export function parseClientLabel(v: unknown, what: 'name' | 'tag'): Outcome<string | undefined> {
  if (v === undefined) {
    return { ok: true, value: undefined };
  }
  return nonEmptyString(v, what, MAX_CLIENT_NAME);
}

/** `to` of custom.post: omitted = broadcast (null), else one id or a list. */
export function parseTargets(v: unknown): Outcome<string[] | null> {
  if (v === undefined) {
    return { ok: true, value: null };
  }
  if (typeof v === 'string') {
    const r = nonEmptyString(v, 'to', MAX_CLIENT_NAME);
    return r.ok ? { ok: true, value: [r.value] } : r;
  }
  const r = stringList(v, 'to', MAX_CLIENT_NAME);
  if (!r.ok) {
    return r;
  }
  if (r.value.length === 0) {
    return { ok: false, error: 'to must name at least one client (omit it to broadcast)' };
  }
  return { ok: true, value: r.value };
}

/** The bus carries JSON only: `data` is round-tripped through JSON so what
 *  every recipient gets is exactly what JSON.parse would give (Dates become
 *  strings, undefined fields vanish); functions, cycles and binary are
 *  rejected, as is anything over the size cap. Omitted = null. */
export function parseJsonData(v: unknown): Outcome<unknown> {
  if (v === undefined) {
    return { ok: true, value: null };
  }
  let text: string | undefined;
  try {
    text = JSON.stringify(v);
  } catch {
    return { ok: false, error: 'data must be JSON-serializable (no cycles, BigInt or binary)' };
  }
  if (text === undefined) {
    return { ok: false, error: 'data must be JSON-serializable (a function or symbol is not)' };
  }
  if (text.length > MAX_DATA_CHARS) {
    return { ok: false, error: `data exceeds the ${MAX_DATA_CHARS} character JSON cap` };
  }
  return { ok: true, value: JSON.parse(text) };
}
