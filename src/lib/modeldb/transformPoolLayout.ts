// -----------------------------------------------------------------------------
// transform pool layout (shared by the modeldb worker and the renderer)
// -----------------------------------------------------------------------------
// Constants only — the renderer sizes its GPU buffer from these without pulling
// the worker's pool state into the main bundle.
//
// [0]                         identity, never written
// [1, ANIM_BAND_FIRST)        committed edits (allocTransformSlot wraps here)
// [ANIM_BAND_FIRST, POOL)     animation band — owned by animation mode only

/** Total mat4 slots in the pool (32768 × 64 B = 2 MB of GPU memory). */
export const TRANSFORM_POOL = 32768;

/** Slots reserved at the top of the pool for animation playback — an
 *  animation can move this many items (a planner plan: one per item). */
export const ANIM_BAND_SIZE = 16384;

/** First animation-band slot; the committed allocator never reaches it. */
export const ANIM_BAND_FIRST = TRANSFORM_POOL - ANIM_BAND_SIZE;

/** Floats per slot (one column-major mat4). */
export const SLOT_FLOATS = 16;
