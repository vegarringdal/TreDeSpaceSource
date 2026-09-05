/** A wireframe sphere drawn IN the scene at an annotation's point (a label
 *  anchor, a measurement point) — depth tested against the model, so the
 *  point reads at its true depth, unlike the flat overlay glyphs. */
export interface SphereMarker {
  /** radius, metres */
  size: number;
  /** `#rrggbb` */
  color: string;
  /** filled sphere (shaded, `opacity` applies) instead of a wireframe */
  solid: boolean;
  /** fill opacity 0..1 for a solid sphere; 1 = opaque (writes depth) */
  opacity: number;
}

export const DEFAULT_SPHERE_MARKER: SphereMarker = { size: 0.1, color: '#ff8800', solid: false, opacity: 0.6 };

/** A well-formed marker, or null for "none". API and JSON input is not
 *  trusted: `true` means the fallback, a partial object is completed from it,
 *  anything else is none. */
export function readSphereMarker(v: unknown, fallback: SphereMarker = DEFAULT_SPHERE_MARKER): SphereMarker | null {
  if (v === true) {
    return { ...fallback };
  }
  if (typeof v !== 'object' || v === null) {
    return null;
  }
  const o = v as { size?: unknown; color?: unknown; solid?: unknown; opacity?: unknown };
  const size = typeof o.size === 'number' && Number.isFinite(o.size) && o.size > 0 ? o.size : fallback.size;
  const color = typeof o.color === 'string' && /^#[0-9a-f]{6}$/i.test(o.color) ? o.color : fallback.color;
  const solid = typeof o.solid === 'boolean' ? o.solid : fallback.solid;
  const opacity =
    typeof o.opacity === 'number' && Number.isFinite(o.opacity) && o.opacity >= 0 && o.opacity <= 1
      ? o.opacity
      : fallback.opacity;
  return { size, color, solid, opacity };
}
