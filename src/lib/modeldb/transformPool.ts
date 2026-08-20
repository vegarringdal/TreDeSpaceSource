// -----------------------------------------------------------------------------
// transform pool (port of native scene_transform.rs)
// -----------------------------------------------------------------------------
// mat4 slots, column-major (WGSL layout). Slot 0 = identity, never written.
// The allocator wraps like native TRANSFORMS_POOL_SIZE — after wrap, very old
// committed slots can be reused (same caveat as the native renderer).
export const TRANSFORM_POOL = 4096;
export const transforms = new Float32Array(TRANSFORM_POOL * 16);
transforms[0] = transforms[5] = transforms[10] = transforms[15] = 1;
let nextTransformSlot = 1;
let maxTransformSlot = 1; // high-water mark: how many slots to upload

export function allocTransformSlot(): number {
  const slot = nextTransformSlot;
  nextTransformSlot = slot + 1 >= TRANSFORM_POOL ? 1 : slot + 1;
  if (slot + 1 > maxTransformSlot) {
    maxTransformSlot = slot + 1;
  }
  return slot;
}

/** The used region of the pool (for GPU upload; copied, not transferred). */
export function transformsSnapshot(): Float32Array {
  return transforms.slice(0, maxTransformSlot * 16);
}

/** Restart the allocator (clear / snapshot REPLACE-import). Slot contents are
 *  not zeroed: slots are always written before commit, and only
 *  [0, maxTransformSlot) is ever uploaded. */
export function resetTransformPool(): void {
  nextTransformSlot = 1;
  maxTransformSlot = 1;
}

/** Item AABB in WORLD space: the cook-time box run through the item's pool
 *  matrix (tidx 0 = identity → copied verbatim). A MOVED item must be
 *  budgeted/culled by the residency logic where it actually is, not where it
 *  was cooked. Writes [minx,miny,minz,maxx,maxy,maxz] into `out`; false for
 *  items without geometry. */
export function itemWorldBounds(itemBounds: Float32Array, tidx: Uint32Array, i: number, out: Float32Array): boolean {
  const o = i * 6;
  if (!Number.isFinite(itemBounds[o])) {
    return false;
  }
  const t = tidx[i];
  if (t === 0) {
    for (let k = 0; k < 6; k++) {
      out[k] = itemBounds[o + k];
    }
    return true;
  }
  const s = t * 16;
  for (let k = 0; k < 3; k++) {
    out[k] = Infinity;
    out[k + 3] = -Infinity;
  }
  for (let c = 0; c < 8; c++) {
    const x = itemBounds[o + (c & 1 ? 3 : 0)];
    const y = itemBounds[o + (c & 2 ? 4 : 1)];
    const z = itemBounds[o + (c & 4 ? 5 : 2)];
    const wx = transforms[s] * x + transforms[s + 4] * y + transforms[s + 8] * z + transforms[s + 12];
    const wy = transforms[s + 1] * x + transforms[s + 5] * y + transforms[s + 9] * z + transforms[s + 13];
    const wz = transforms[s + 2] * x + transforms[s + 6] * y + transforms[s + 10] * z + transforms[s + 14];
    out[0] = Math.min(out[0], wx);
    out[1] = Math.min(out[1], wy);
    out[2] = Math.min(out[2], wz);
    out[3] = Math.max(out[3], wx);
    out[4] = Math.max(out[4], wy);
    out[5] = Math.max(out[5], wz);
  }
  return true;
}
