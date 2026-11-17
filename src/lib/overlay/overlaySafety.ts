// -----------------------------------------------------------------------------
// overlay content safety (DESIGN.md › Animation › Overlays, D13)
// -----------------------------------------------------------------------------
// The whitelist every overlay value passes before it reaches markup: colours
// are hex / rgb() / a $theme token, images are data: URIs of four raster/
// vector types under a size cap. Shared by the file validator (io.ts) and the
// renderer, which re-checks at draw time so nothing that bypassed the loader
// (a store edit, an SDK value) can inject markup or fetch a remote URL.

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

/** Per-image cap (Q6): 1 MB of decoded bytes. */
export const OVERLAY_IMAGE_MAX_BYTES = 1 << 20;

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const RGB_RE =
  /^rgba?\(\s*\d{1,3}(?:\.\d+)?%?\s*,\s*\d{1,3}(?:\.\d+)?%?\s*,\s*\d{1,3}(?:\.\d+)?%?\s*(?:,\s*(?:0|1|0?\.\d+|\d{1,3}%)\s*)?\)$/;
const TOKEN_RE = /^\$[A-Za-z][\w-]{0,30}$/;
const IMAGE_RE = /^data:image\/(?:png|jpeg|webp|svg\+xml)(?:;charset=[\w-]+)?(;base64)?,/;
const BASE64_BODY_RE = /^[A-Za-z0-9+/]*={0,2}$/;

// -----------------------------------------------------------------------------
// checks
// -----------------------------------------------------------------------------

/** Hex, rgb()/rgba() with plain numbers, `transparent`, or a $token. */
export function isSafeColor(s: string): boolean {
  return s === 'transparent' || HEX_RE.test(s) || RGB_RE.test(s) || TOKEN_RE.test(s);
}

/** Decoded size of a data: URI body (base64 or percent-encoded). */
function dataBytes(uri: string, base64: boolean): number {
  const body = uri.slice(uri.indexOf(',') + 1);
  if (base64) {
    return Math.floor((body.length * 3) / 4);
  }
  return body.length;
}

/** A data:image/(png|jpeg|webp|svg+xml) URI within OVERLAY_IMAGE_MAX_BYTES.
 *  SVG is only ever drawn through an image element (never inlined), so its
 *  scripts cannot run. */
export function isSafeImage(s: string): boolean {
  const m = IMAGE_RE.exec(s);
  if (!m) {
    return false;
  }
  const base64 = m[1] !== undefined;
  if (base64 && !BASE64_BODY_RE.test(s.slice(m[0].length))) {
    return false;
  }
  return dataBytes(s, base64) <= OVERLAY_IMAGE_MAX_BYTES;
}

/** A style bound to one of the design's values: exactly `{{key}}`. */
export const VALUE_REF_RE = /^\{\{([A-Za-z_]\w{0,40})\}\}$/;

/** Resolve a colour against a theme: `$token` → its value; `{{key}}` → the
 *  card's colour value, which the renderer puts in `tokens` under that name
 *  (one level: it may be a token, never another reference); unsafe → fallback. */
export function resolveColor(
  c: string | undefined,
  tokens: Readonly<Record<string, string>>,
  fallback: string,
): string {
  if (c !== undefined && VALUE_REF_RE.test(c)) {
    const v = tokens[c];
    return v === undefined || VALUE_REF_RE.test(v) ? fallback : resolveColor(v, tokens, fallback);
  }
  if (c === undefined || !isSafeColor(c)) {
    return fallback;
  }
  if (c.startsWith('$')) {
    const v = tokens[c.slice(1)];
    return v !== undefined && isSafeColor(v) && !v.startsWith('$') ? v : fallback;
  }
  return c;
}
