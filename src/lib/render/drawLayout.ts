// -----------------------------------------------------------------------------
// Per-model GPU layout of the draw path — the ONE place that says how many
// bytes a meshlet and a triangle cost on the GPU. The renderer allocates from
// it (renderer.ts ensureLayout) and the worker's mixed-pack budget estimates
// with it (pack.ts estimateItemFullBytes), so the two can never drift.
// Pure: no GPU types, safe to import from the model-database worker.
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** How the scene is culled and drawn: multi-draw indirect (u16 hardware
 *  index buffer, 20-byte draw records), vertex pulling (u8 indices read from
 *  storage, 4-byte list entries), or the no-cull fallback (vertex pulling over
 *  a static all-meshlets list). */
export type DrawPath = 'mdi' | 'vp' | 'full';

/** Bytes per index in a model's index buffer: 1 on the vertex-pull paths,
 *  2 under MDI (WebGPU index buffers are uint16 or uint32 only). */
export type IndexWidth = 1 | 2;

/** The optional per-model lists a layout carries: the blend pass's sorted
 *  transparent list exists only while the model has something transparent,
 *  the outline mask list only while an outline feature is switched on. */
export type ListNeeds = Readonly<{ transparent: boolean; outline: boolean }>;

/** GPU bytes the renderer allocates per meshlet and per triangle under one
 *  layout — what the residency budget's per-item estimate multiplies by. */
export type GpuSizing = Readonly<{ meshletBytes: number; indexBytesPerTriangle: number }>;

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** Packed MeshletCull record (shaders/cull.ts, 9 u32). */
export const CULL_RECORD_BYTES = 36;
/** MeshletInfo record {aabb_min, cg, aabb_scale, item}. */
export const INFO_RECORD_BYTES = 32;
/** One visibility word per meshlet (two-pass occlusion state). */
export const VIS_BYTES = 4;
/** drawIndexedIndirect record: 5 × u32. */
export const MDI_RECORD_BYTES = 20;
/** Vertex-pull list entry: one meshlet index. */
export const VP_ENTRY_BYTES = 4;
/** Sorted-blend candidate: [meshlet, bucket]. */
export const SORT_CANDIDATE_BYTES = 8;

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** Bytes per entry of a cull-written draw list on this path. */
export function listEntryBytes(path: DrawPath): number {
  return path === 'mdi' ? MDI_RECORD_BYTES : VP_ENTRY_BYTES;
}

/** Bytes per entry of the sorted transparent list: MDI draws both facing
 *  halves from one record (instanceCount 2); vertex pull lists two entries. */
export function transparentEntryBytes(path: DrawPath): number {
  return path === 'mdi' ? MDI_RECORD_BYTES : 2 * VP_ENTRY_BYTES;
}

/** Index width a path reads. */
export function indexWidthOf(path: DrawPath): IndexWidth {
  return path === 'mdi' ? 2 : 1;
}

/**
 * Fixed GPU bytes per meshlet, whatever its fill: cull + info records, the
 * visibility word, the pass-1 and pass-2 lists, plus the full list (no-cull
 * path only), the sorted transparent list with its candidates (culling paths
 * only — the no-cull blend pass routes over the full list) and the outline
 * list when `needs` asks for them.
 */
export function meshletBytes(path: DrawPath, needs: ListNeeds): number {
  const entry = listEntryBytes(path);
  let bytes = CULL_RECORD_BYTES + INFO_RECORD_BYTES + VIS_BYTES + 2 * entry;
  if (path === 'full') {
    bytes += VP_ENTRY_BYTES;
  }
  if (needs.transparent && path !== 'full') {
    bytes += transparentEntryBytes(path) + SORT_CANDIDATE_BYTES;
  }
  if (needs.outline) {
    bytes += entry;
  }
  return bytes;
}

/** The budget estimate's sizing for one model under a layout. */
export function gpuSizingOf(path: DrawPath, needs: ListNeeds): GpuSizing {
  return { meshletBytes: meshletBytes(path, needs), indexBytesPerTriangle: 3 * indexWidthOf(path) };
}
