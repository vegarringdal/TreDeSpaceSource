// Conservative AABB-vs-frustum test shared by the residency manager (main
// thread) and the modeldb worker's frustum-aware pack selection.

/** Clip-space corner rejection: false only when every corner of the box is
 * outside the same clip plane (never falsely culls; may keep edge cases). */
/** True when the box is ENTIRELY inside the frustum (every corner passes
 * every clip test) — such a zone gains nothing from a mixed pack. */
export function boxFullyInFrustum(vp: Float32Array, b: ArrayLike<number>, o = 0): boolean {
  for (let c = 0; c < 8; c++) {
    const x = b[o + (c & 1 ? 3 : 0)];
    const y = b[o + (c & 2 ? 4 : 1)];
    const z = b[o + (c & 4 ? 5 : 2)];
    const cx = vp[0] * x + vp[4] * y + vp[8] * z + vp[12];
    const cy = vp[1] * x + vp[5] * y + vp[9] * z + vp[13];
    const cz = vp[2] * x + vp[6] * y + vp[10] * z + vp[14];
    const cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
    if (cw <= 0 || cx > cw || cx < -cw || cy > cw || cy < -cw || cz > cw) {
      return false;
    }
  }
  return true;
}

export function boxInFrustum(vp: Float32Array, b: ArrayLike<number>, o = 0): boolean {
  // outside-flags per plane: +x, -x, +y, -y, near (w<=0), far (z>w)
  let all = 0b111111;
  for (let c = 0; c < 8; c++) {
    const x = b[o + (c & 1 ? 3 : 0)];
    const y = b[o + (c & 2 ? 4 : 1)];
    const z = b[o + (c & 4 ? 5 : 2)];
    const cx = vp[0] * x + vp[4] * y + vp[8] * z + vp[12];
    const cy = vp[1] * x + vp[5] * y + vp[9] * z + vp[13];
    const cz = vp[2] * x + vp[6] * y + vp[10] * z + vp[14];
    const cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
    let out = 0;
    if (cx > cw) {
      out |= 1;
    }
    if (cx < -cw) {
      out |= 2;
    }
    if (cy > cw) {
      out |= 4;
    }
    if (cy < -cw) {
      out |= 8;
    }
    if (cw <= 0) {
      out |= 16;
    }
    if (cz > cw) {
      out |= 32;
    }
    all &= out;
    if (all === 0) {
      return true;
    }
  }
  return false;
}
