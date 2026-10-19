// -----------------------------------------------------------------------------
// transform pool (port of native scene_transform.rs)
// -----------------------------------------------------------------------------
// mat4 slots, column-major (WGSL layout). Slot 0 = identity, never written.
// The committed allocator wraps like native TRANSFORMS_POOL_SIZE — after wrap,
// very old committed slots can be reused (same caveat as the native renderer).
// It wraps BEFORE the animation band (transformPoolLayout.ts), so a live
// animation slot is never handed to a committed edit.
import { ANIM_BAND_FIRST, ANIM_BAND_SIZE, TRANSFORM_POOL } from './transformPoolLayout';

export { ANIM_BAND_FIRST, ANIM_BAND_SIZE, TRANSFORM_POOL };

/** Slots available to committed edits (slot 0 included). */
export const COMMITTED_SLOTS = ANIM_BAND_FIRST;

export const transforms = new Float32Array(TRANSFORM_POOL * 16);
transforms[0] = transforms[5] = transforms[10] = transforms[15] = 1;
let nextTransformSlot = 1;
let maxTransformSlot = 1; // high-water mark: how many slots to upload
let nextAnimSlot = ANIM_BAND_FIRST;

export function allocTransformSlot(): number {
  const slot = nextTransformSlot;
  nextTransformSlot = slot + 1 >= COMMITTED_SLOTS ? 1 : slot + 1;
  if (slot + 1 > maxTransformSlot) {
    maxTransformSlot = slot + 1;
  }
  return slot;
}

/** Next free animation-band slot, or null when the band is full. Band slots
 *  are never part of transformsSnapshot(): the main thread uploads them. */
export function allocAnimSlot(): number | null {
  if (nextAnimSlot >= TRANSFORM_POOL) {
    return null;
  }
  return nextAnimSlot++;
}

/** Free the whole animation band (animation mode exit / scene clear). */
export function resetAnimBand(): void {
  nextAnimSlot = ANIM_BAND_FIRST;
}

/** Animation-band slots handed out since the last reset. */
export function animSlotsUsed(): number {
  return nextAnimSlot - ANIM_BAND_FIRST;
}

/** True while animation mode owns band slots. Committed transform edits are
 *  refused meanwhile (DESIGN.md › Animation, D12): a bake or undo would
 *  move animated items out of the band, and mode exit restores the captured
 *  slots anyway, silently discarding the edit. */
let animModeActive = false;

export function setAnimModeActive(on: boolean): void {
  animModeActive = on;
}

export function isAnimModeActive(): boolean {
  return animModeActive;
}

/** Per band slot: a conservative WORLD box covering every pose the slot takes
 *  over the timeline (animSetSweptBounds). itemWorldBounds answers with it so
 *  residency budgets a moving part where it will be, not only where it rests. */
const sweptBySlot = new Map<number, Float32Array>();

export function setSweptBounds(slot: number, box: Float32Array | null): void {
  if (box) {
    sweptBySlot.set(slot, box);
  } else {
    sweptBySlot.delete(slot);
  }
}

export function clearSweptBounds(): void {
  sweptBySlot.clear();
}

/** The used region of the pool (for GPU upload; copied, not transferred). */
export function transformsSnapshot(): Float32Array<ArrayBuffer> {
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
export function itemWorldBounds(
  itemBounds: Float32Array,
  tidx: Uint32Array,
  i: number,
  out: Float32Array,
  swept = false,
): boolean {
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
  // the whole path an animated item sweeps is for residency only (a part is
  // never evicted before it moves into view); everything else — selection,
  // fit, explode directions, export — wants where the item is now
  const sweptBox = swept && t >= ANIM_BAND_FIRST ? sweptBySlot.get(t) : undefined;
  if (sweptBox) {
    out.set(sweptBox);
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
