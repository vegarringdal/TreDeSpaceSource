// Instance layout of the renderer's filled marker spheres (shaders/marker.ts):
// label / measurement markers and laser-scan setup markers pack through here
// so the layout lives in one place.

/** Floats per sphere: centre xyz (float32 part), radius, rgba, then the
 *  centre's float32 remainder xyz. */
export const MARKER_INSTANCE_FLOATS = 11;
/** Byte offset of each attribute within an instance, and the stride. */
export const MARKER_INSTANCE_LAYOUT = {
  stride: MARKER_INSTANCE_FLOATS * 4,
  center: 0,
  radius: 12,
  color: 16,
  centerLow: 32,
} as const;

/**
 * Write one sphere into `out` at instance `index`. The centre is split in two
 * float32 triples — the value rounded to float32 and what the rounding lost —
 * because at national-grid coordinates (millions of metres) a float32 alone
 * resolves only 0.5 m: a sphere 0.2 m across would be drawn beside its place.
 * The shader subtracts the frame origin from the first (exact, they are of
 * the same magnitude) and then adds the second.
 */
export function writeMarkerInstance(
  out: Float32Array,
  index: number,
  center: readonly [number, number, number],
  radius: number,
  rgba: readonly [number, number, number, number],
): void {
  const k = index * MARKER_INSTANCE_FLOATS;
  for (let axis = 0; axis < 3; axis++) {
    const high = Math.fround(center[axis]);
    out[k + axis] = high;
    out[k + 8 + axis] = center[axis] - high;
  }
  out[k + 3] = radius;
  out[k + 4] = rgba[0];
  out[k + 5] = rgba[1];
  out[k + 6] = rgba[2];
  out[k + 7] = rgba[3];
}
