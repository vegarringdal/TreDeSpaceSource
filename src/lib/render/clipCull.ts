// CPU mirror of the cull shader's `clip_culled` (shaders/cull.ts) evaluated
// over the packed ClipData floats (clipPack.ts layout: planes[8×vec4] @0,
// plane_mask vec4u @32, 8 tagged-union shapes ×28 floats @36). Used by the
// residency manager for zones with NO resident geometry — the GPU draw
// counts cannot speak for those. Semantics match the shader exactly:
// holes discard a sphere entirely inside; keeps discard only a sphere
// outside EVERY keep volume (union-of-keeps).

const SHAPES_OFFSET = 36;
const SHAPE_STRIDE = 28;

/** True when a bounding sphere is provably clipped away entirely. */
export function clipCulledSphere(
  clip: Float32Array,
  clipU32: Uint32Array,
  center: readonly [number, number, number],
  radius: number,
): boolean {
  const mask = clipU32[32];
  for (let i = 0; i < 8; i++) {
    if (
      (mask & (1 << i)) !== 0 &&
      clip[i * 4] * center[0] + clip[i * 4 + 1] * center[1] + clip[i * 4 + 2] * center[2] + clip[i * 4 + 3] < -radius
    ) {
      return true; // sphere fully behind an enabled plane
    }
  }

  let anyKeep = false;
  let maybeInside = false;
  for (let si = 0; si < 8; si++) {
    const s = SHAPES_OFFSET + si * SHAPE_STRIDE;
    const kind = clipU32[s + 24];
    if (kind === 0) {
      continue;
    }
    const hole = clipU32[s + 25] !== 0;
    // box-local point via the column-major inv_transform (rotation+translation)
    const lx = clip[s] * center[0] + clip[s + 4] * center[1] + clip[s + 8] * center[2] + clip[s + 12];
    const ly = clip[s + 1] * center[0] + clip[s + 5] * center[1] + clip[s + 9] * center[2] + clip[s + 13];
    const lz = clip[s + 2] * center[0] + clip[s + 6] * center[1] + clip[s + 10] * center[2] + clip[s + 14];
    const p0 = [clip[s + 16], clip[s + 17], clip[s + 18], clip[s + 19]];
    const p1 = [clip[s + 20], clip[s + 21], clip[s + 22], clip[s + 23]];

    if (hole) {
      let entirelyInside = false;
      if (kind === 1) {
        entirelyInside =
          lx >= p0[0] + radius &&
          ly >= p0[1] + radius &&
          lz >= p0[2] + radius &&
          lx <= p1[0] - radius &&
          ly <= p1[1] - radius &&
          lz <= p1[2] - radius;
      } else if (kind === 2) {
        const dx = center[0] - p0[0];
        const dy = center[1] - p0[1];
        const dz = center[2] - p0[2];
        const rr = p0[3] - radius;
        entirelyInside = rr > 0 && dx * dx + dy * dy + dz * dz < rr * rr;
      } else {
        const rx = center[0] - p0[0];
        const ry = center[1] - p0[1];
        const rz = center[2] - p0[2];
        const t = rx * p1[0] + ry * p1[1] + rz * p1[2];
        const ax = rx - t * p1[0];
        const ay = ry - t * p1[1];
        const az = rz - t * p1[2];
        const rr = p0[3] - radius;
        entirelyInside = rr > 0 && t >= radius && t <= p1[3] - radius && ax * ax + ay * ay + az * az < rr * rr;
      }
      if (entirelyInside) {
        return true; // fully carved away by the hole
      }
      continue;
    }

    anyKeep = true;
    let entirelyOutside = false;
    if (kind === 1) {
      entirelyOutside =
        lx < p0[0] - radius ||
        ly < p0[1] - radius ||
        lz < p0[2] - radius ||
        lx > p1[0] + radius ||
        ly > p1[1] + radius ||
        lz > p1[2] + radius;
    } else if (kind === 2) {
      const dx = center[0] - p0[0];
      const dy = center[1] - p0[1];
      const dz = center[2] - p0[2];
      const rr = p0[3] + radius;
      entirelyOutside = dx * dx + dy * dy + dz * dz > rr * rr;
    } else {
      const rx = center[0] - p0[0];
      const ry = center[1] - p0[1];
      const rz = center[2] - p0[2];
      const t = rx * p1[0] + ry * p1[1] + rz * p1[2];
      const ax = rx - t * p1[0];
      const ay = ry - t * p1[1];
      const az = rz - t * p1[2];
      const rr = p0[3] + radius;
      entirelyOutside = t < -radius || t > p1[3] + radius || ax * ax + ay * ay + az * az > rr * rr;
    }
    if (!entirelyOutside) {
      maybeInside = true;
    }
  }
  return anyKeep && !maybeInside; // outside every keep volume
}
