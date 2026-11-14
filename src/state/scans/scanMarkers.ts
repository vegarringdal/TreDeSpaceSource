// Scan setup markers: one filled sphere per scanner position, drawn through
// the renderer's marker-sphere instances (depth tested against the model) and
// picked on the CPU by a ray–sphere test. Pure data — unit-tested as is.

import { MARKER_INSTANCE_FLOATS, writeMarkerInstance } from '../../lib/render/markerInstance';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type Vec3 = readonly [number, number, number];

export interface ScanMarker {
  readonly key: string;
  readonly center: Vec3;
  readonly selected: boolean;
}

export interface MarkerRay {
  readonly origin: Vec3;
  /** Unit direction. */
  readonly dir: Vec3;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** World radius of a setup marker (metres). */
export const SCAN_MARKER_RADIUS = 0.2;
/** The depth-picked point may sit this many radii in front of the marker's
 *  centre and still be the marker (its near surface is one radius in front;
 *  the rest is depth-buffer precision at a distance). */
const MARKER_DEPTH_SLACK = 1.25;
const COLOR = [0.96, 0.62, 0.04] as const;
const COLOR_SELECTED = [0.99, 0.88, 0.28] as const;

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

/** Filled-sphere instances for the renderer's marker pipeline, at `alpha`
 *  (1 = opaque). */
export function scanMarkerInstances(
  markers: readonly ScanMarker[],
  alpha = 1,
  radius = SCAN_MARKER_RADIUS,
): Float32Array {
  const out = new Float32Array(markers.length * MARKER_INSTANCE_FLOATS);
  markers.forEach((m, i) => {
    const c = m.selected ? COLOR_SELECTED : COLOR;
    writeMarkerInstance(out, i, m.center, radius, [c[0], c[1], c[2], alpha]);
  });
  return out;
}

/** A marker under a picking ray: its key and the distance along the ray to
 *  the point nearest its centre. */
export interface MarkerHit {
  readonly key: string;
  readonly t: number;
}

/** The nearest marker the ray passes through (in front of its origin). */
export function pickScanMarker(
  ray: MarkerRay,
  markers: readonly ScanMarker[],
  radius = SCAN_MARKER_RADIUS,
): MarkerHit | null {
  let best: MarkerHit | null = null;
  for (const m of markers) {
    const oc = [m.center[0] - ray.origin[0], m.center[1] - ray.origin[1], m.center[2] - ray.origin[2]];
    const t = oc[0] * ray.dir[0] + oc[1] * ray.dir[1] + oc[2] * ray.dir[2];
    const d2 = oc[0] * oc[0] + oc[1] * oc[1] + oc[2] * oc[2] - t * t;
    if (t > 0 && d2 <= radius * radius && t < (best?.t ?? Number.POSITIVE_INFINITY)) {
      best = { key: m.key, t };
    }
  }
  return best;
}

/**
 * Whether a picked marker is the thing seen at that pixel: `surface` is what
 * the depth buffer holds there (null = background). A wall, a floor or scan
 * points in front of the sphere hide it; the sphere's own surface (an opaque
 * marker writes depth) and anything behind it do not.
 */
export function markerInFront(
  ray: MarkerRay,
  hit: MarkerHit,
  surface: Vec3 | null,
  radius = SCAN_MARKER_RADIUS,
): boolean {
  if (!surface) {
    return true;
  }
  const d =
    (surface[0] - ray.origin[0]) * ray.dir[0] +
    (surface[1] - ray.origin[1]) * ray.dir[1] +
    (surface[2] - ray.origin[2]) * ray.dir[2];
  return d >= hit.t - radius * MARKER_DEPTH_SLACK;
}

/** Add scan-marker instances to `base`: opaque ones spliced in after its
 *  opaque block, see-through ones appended (the renderer draws the first
 *  `opaqueCount` instances depth-writing, the rest blended). */
export function mergeMarkerInstances(
  base: Float32Array,
  baseOpaque: number,
  scans: Float32Array,
  opaque = true,
): { readonly data: Float32Array; readonly opaqueCount: number } {
  if (scans.length === 0) {
    return { data: base, opaqueCount: baseOpaque };
  }
  if (!opaque) {
    const blended = new Float32Array(base.length + scans.length);
    blended.set(base, 0);
    blended.set(scans, base.length);
    return { data: blended, opaqueCount: baseOpaque };
  }
  const cut = baseOpaque * MARKER_INSTANCE_FLOATS;
  const data = new Float32Array(base.length + scans.length);
  data.set(base.subarray(0, cut), 0);
  data.set(scans, cut);
  data.set(base.subarray(cut), cut + scans.length);
  return { data, opaqueCount: baseOpaque + scans.length / MARKER_INSTANCE_FLOATS };
}
