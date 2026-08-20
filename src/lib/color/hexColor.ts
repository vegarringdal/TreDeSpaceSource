// Color parsing shared by Set Color and SQL Reports. The item-state color
// override the renderer reads is a packed little-endian RGBA8 uint32
// (r | g<<8 | b<<16 | a<<24) — see modeldb.ts.
import { CSS_COLOR_NAMES } from './colorNames';

/** Sentinel color meaning "restore the mesh item's original color" (clear the
 *  override). Negative so it never collides with a real packed RGBA8 (≥ 0). */
export const COLOR_DEFAULT = -1;

/** '#rrggbb' (or '#rgb') → packed RGBA8, alpha forced opaque. */
export function packHex(hex: string): number {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (r | (g << 8) | (b << 16) | (255 << 24)) >>> 0;
}

/** A hex code OR a CSS color name → packed RGBA8, or null if neither parses.
 *  A leading '#' means hex; anything else is looked up in the name table
 *  (case-insensitive). Used by the 2-column Multi filter and the SQL Reports
 *  color feed. */
export function parseColor(token: string): number | null {
  const t = token.trim();
  if (!t) {
    return null;
  }
  // "default" = restore the item's original mesh color
  if (t.toLowerCase() === 'default') {
    return COLOR_DEFAULT;
  }
  const hex = t.startsWith('#') ? t : CSS_COLOR_NAMES[t.toLowerCase()];
  if (!hex) {
    return null;
  }
  if (!/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(hex)) {
    return null;
  }
  return packHex(hex);
}
