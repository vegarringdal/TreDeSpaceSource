// -----------------------------------------------------------------------------
// overlay files (DESIGN.md › Animation › Overlays)
// -----------------------------------------------------------------------------
// Card designs (components) and colour themes as one file: exported from the
// Overlay Editor, imported into it, and the `components` / `themes` part of a
// plan file (a plan Claude writes may bring its own cards). Every entry goes
// through the animation file's parser — the same safety rules (no HTML / CSS,
// data: images only, icons from the fixed set) — and every error is reported
// with its JSON path. Built-in ids are refused, so a file cannot replace a
// preset.

import type { Result } from '../result';
import { parseOverlayComponent, parseOverlayTheme } from './overlayParse';
import { OVERLAY_PRESETS, OVERLAY_THEME_PRESETS } from './overlayPresets';
import type { OverlayComponent, OverlayTheme } from './overlayTypes';

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

export interface OverlayBundle {
  components: OverlayComponent[];
  themes: OverlayTheme[];
}

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

export const OVERLAY_FILE_FORMAT = 'tredespace-overlays';
export const OVERLAY_FILE_VERSION = 1;
export const OVERLAY_FILE_EXT = '.tdoverlay.json';
/** Components / themes one file may hold (a guard against hostile files). */
const MAX_ENTRIES = 500;
const BUILT_IN = new Set<string>([...OVERLAY_PRESETS, ...OVERLAY_THEME_PRESETS].map((x) => x.id));

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** JSON with sorted keys (two designs built in a different key order compare equal). */
function canonical(v: unknown): string {
  if (Array.isArray(v)) {
    return `[${v.map(canonical).join(',')}]`;
  }
  if (isObject(v)) {
    return `{${Object.keys(v)
      .sort()
      .filter((k) => v[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

/** One list of a file: parsed entries, or errors with their paths. */
function readList<T extends { id: string }>(
  raw: unknown,
  key: 'components' | 'themes',
  parse: (v: unknown, path: string) => { value?: T; error?: string },
  errors: string[],
): T[] {
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    errors.push(`${key}: expected an array`);
    return [];
  }
  if (raw.length > MAX_ENTRIES) {
    errors.push(`${key}: more than ${MAX_ENTRIES}`);
    return [];
  }
  const out: T[] = [];
  const seen = new Set<string>();
  raw.forEach((v, i) => {
    const path = `${key}[${i}]`;
    const r = parse(v, path);
    if (!r.value) {
      errors.push(r.error ?? `${path}: not valid`);
      return;
    }
    if (isBuiltInOverlay(r.value.id)) {
      errors.push(`${path}.id: "${r.value.id}" is a built-in design — give yours an id of its own (e.g. "custom.…")`);
      return;
    }
    if (seen.has(r.value.id)) {
      errors.push(`${path}.id: "${r.value.id}" is in the file twice`);
      return;
    }
    seen.add(r.value.id);
    out.push(r.value);
  });
  return out;
}

// -----------------------------------------------------------------------------
// public api
// -----------------------------------------------------------------------------

/** A built-in card or theme id (presets): files may not bring their own. */
export function isBuiltInOverlay(id: string): boolean {
  return id.startsWith('preset.') || BUILT_IN.has(id);
}

/** The same design (or theme), ignoring the version counter. */
export function sameOverlay(a: OverlayComponent | OverlayTheme, b: OverlayComponent | OverlayTheme): boolean {
  const strip = (x: OverlayComponent | OverlayTheme) => ({ ...x, version: undefined });
  return canonical(strip(a)) === canonical(strip(b));
}

/** The `components` and `themes` of a parsed file (an overlay or plan file),
 *  with every error and its path. */
export function readOverlayEntries(data: Record<string, unknown>): { bundle: OverlayBundle; errors: string[] } {
  const errors: string[] = [];
  const components = readList(
    data.components,
    'components',
    (v, p) => {
      const r = parseOverlayComponent(v, p);
      return { value: r.component, error: r.error };
    },
    errors,
  );
  const themes = readList(
    data.themes,
    'themes',
    (v, p) => {
      const r = parseOverlayTheme(v, p);
      return { value: r.theme, error: r.error };
    },
    errors,
  );
  return { bundle: { components, themes }, errors };
}

/** Designs and themes as a file (pretty JSON). */
export function serializeOverlayFile(b: OverlayBundle): string {
  return JSON.stringify(
    { format: OVERLAY_FILE_FORMAT, version: OVERLAY_FILE_VERSION, components: b.components, themes: b.themes },
    null,
    2,
  );
}

/** An overlay file's designs and themes, or every error with its path. */
export function parseOverlayFile(text: string): Result<OverlayBundle> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return { error: { err, msg: `Not JSON: ${err instanceof Error ? err.message : String(err)}` } };
  }
  if (!isObject(data)) {
    return { error: { err: null, msg: 'Not an overlay file: expected { "components": [...], "themes": [...] }' } };
  }
  if (data.format !== undefined && data.format !== OVERLAY_FILE_FORMAT) {
    return { error: { err: null, msg: `Unknown format "${String(data.format)}" (expected "${OVERLAY_FILE_FORMAT}")` } };
  }
  const { bundle, errors } = readOverlayEntries(data);
  if (errors.length > 0) {
    return { error: { err: null, msg: errors.join('\n') } };
  }
  if (bundle.components.length === 0 && bundle.themes.length === 0) {
    return { error: { err: null, msg: 'There are no designs or themes in this file.' } };
  }
  return { data: bundle };
}
