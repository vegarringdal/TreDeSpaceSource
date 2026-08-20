// World → screen projection shared by the SVG/gizmo overlays and the renderer's
// pick classification — one copy of the column-major VP math.

/** Project a world point through a column-major view-projection matrix into
 *  pixel coords of a w×h surface. Returns null at/behind the camera plane. */
export function projectToScreen(
  vp: Float32Array,
  w: number,
  h: number,
  p: readonly [number, number, number] | readonly number[],
): [number, number] | null {
  const x = vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12];
  const y = vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13];
  const cw = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15];
  if (cw <= 1e-6) {
    return null;
  }
  return [(x / cw + 1) * 0.5 * w, (1 - y / cw) * 0.5 * h];
}
