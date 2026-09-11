// Validation for the host API's per-tab settings setters. Pure (no store, no
// protocol import) so the rules are unit-testable: the handler passes the
// tab's key list and the defaults, and turns a returned error into ApiError.
import type { ViewerState } from '../../state/viewer/viewer.state';
import { isViewerEnumKey, VIEWER_ENUM_VALUES } from '../../state/viewer/viewerSettingsGroups';
import { colorToHex } from '../color/hexColor';

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

export type PatchOutcome<K extends keyof ViewerState> =
  | { ok: true; patch: Partial<Pick<ViewerState, K>>; reset: boolean }
  | { ok: false; error: string };

/** The one payload key that is not a setting. */
export const RESET_KEY = 'reset';

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

const isColorKey = (k: string): boolean => k.endsWith('Color');

/** One value checked against the shape of its default: enums against their
 *  list, colours normalised to '#rrggbb' (CSS names accepted), the rest by
 *  primitive type. Returns the value to store or an error message. */
function checkValue(key: string, value: unknown, fallback: unknown): { value?: unknown; error?: string } {
  if (isViewerEnumKey(key)) {
    const allowed: readonly (string | number)[] = VIEWER_ENUM_VALUES[key];
    if (typeof value !== 'string' && typeof value !== 'number') {
      return { error: `${key} must be one of ${allowed.join(', ')}` };
    }
    if (!allowed.includes(value)) {
      return { error: `${key} must be one of ${allowed.join(', ')}` };
    }
    return { value };
  }
  if (isColorKey(key)) {
    const hex = typeof value === 'string' ? colorToHex(value) : null;
    if (hex === null) {
      return { error: `${key} must be a '#rrggbb' hex colour or a CSS colour name` };
    }
    return { value: hex };
  }
  if (Array.isArray(fallback)) {
    if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
      return { error: `${key} must be a string[]` };
    }
    return { value };
  }
  const want = typeof fallback;
  if (want === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { error: `${key} must be a finite number` };
    }
    return { value };
  }
  if (typeof value !== want) {
    return { error: `${key} must be a ${want}` };
  }
  return { value };
}

// -----------------------------------------------------------------------------
// validate
// -----------------------------------------------------------------------------

/**
 * Validate a host-supplied patch for one settings tab. Strict on purpose: an
 * unknown key is an error rather than a silent no-op, because a typo in a
 * company default would otherwise go unnoticed for good. Values are checked
 * against the defaults' shape (no range clamping — the same trust the
 * settings-file loader extends). `reset: true` is read out separately.
 */
export function validateViewerPatch<K extends keyof ViewerState>(
  p: Record<string, unknown>,
  keys: readonly K[],
  defaults: Pick<ViewerState, K>,
): PatchOutcome<K> {
  let reset = false;
  const out: Record<string, unknown> = {};
  const allowed: readonly string[] = keys;
  for (const [key, value] of Object.entries(p)) {
    if (key === RESET_KEY) {
      if (typeof value !== 'boolean') {
        return { ok: false, error: 'reset must be a boolean' };
      }
      reset = value;
      continue;
    }
    if (!allowed.includes(key)) {
      return { ok: false, error: `unknown setting '${key}' — allowed: ${allowed.join(', ')}` };
    }
    const fallback: unknown = defaults[key as K];
    const checked = checkValue(key, value, fallback);
    if (checked.error !== undefined) {
      return { ok: false, error: checked.error };
    }
    out[key] = checked.value;
  }
  // every entry was admitted by the allow-list and shape-checked above
  return { ok: true, patch: out as Partial<Pick<ViewerState, K>>, reset };
}
