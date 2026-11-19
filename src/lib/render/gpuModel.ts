// Per-model GPU resources + the draw-list replay shared by every pass that
// re-renders the scene's culled geometry (item pick, outline mask).

import type { DrawPath, IndexWidth } from './drawLayout';
import { SORT_COUNT_WORD } from './shaders/cull';

/** A model's cull-produced draw lists: pass 1 (visible last frame), pass 2
 *  (newly visible), the sorted transparent list the blend pass draws
 *  back-to-front (DESIGN.md "Sorted blend pass") and the outline list — the
 *  outlined items' in-view (drawn or occluded) meshlets, built by the outline
 *  pass for its mask. */
export type DrawList = 1 | 2 | 3 | 4;
export const TRANSPARENT_LIST: DrawList = 3;
export const OUTLINE_LIST: DrawList = 4;
/** Byte offset of the MDI multi-draw count inside a model's transparent count
 *  slot (the sort scan writes the vertex-pull args at 0 and the plain count
 *  after them). */
export const TRANSPARENT_COUNT_OFFSET = SORT_COUNT_WORD * 4;

/** The sorted blend list of a model with something transparent. */
export interface SortLists {
  /** Back-to-front draw list (MDI records / vertex-pull entry pairs). */
  recordBufT: GPUBuffer;
  /** Transparent candidates from both cull passes: [meshlet, bucket] pairs. */
  candBuf: GPUBuffer;
  /** Bucket histogram → scatter bases, candidate count. */
  sortBuf: GPUBuffer;
  /** Scatter dispatch args (indirect), written by the scan pass. */
  sortArgsBuf: GPUBuffer;
}

/** The no-cull path's static all-meshlets list. */
export interface FullList {
  fullListBuf: GPUBuffer;
  fullArgsBuf: GPUBuffer;
}

/** Bind groups over the model's CURRENT buffers, for its current path —
 *  rebuilt whenever any buffer they reference is replaced. Vertex-pull groups
 *  are null under MDI (the index buffer is u16 there, the vertex-pull shader
 *  reads u8). */
export interface ModelBinds {
  cull1: GPUBindGroup;
  cull2: GPUBindGroup;
  vp1: GPUBindGroup | null;
  vp2: GPUBindGroup | null;
  vpT: GPUBindGroup | null;
  vpO: GPUBindGroup | null;
  vpFull: GPUBindGroup | null;
  sortScan: GPUBindGroup | null;
  sortScatter: GPUBindGroup | null;
  outlineList: GPUBindGroup | null;
}

export interface GpuModel {
  /** Tombstoned by removeModels — buffers destroyed, slot kept so worker/renderer indices stay aligned. */
  dead?: boolean;
  name: string;
  meshletCount: number;
  triangleCount: number;
  /** Live GPU bytes of every buffer the slot holds right now — core plus the
   *  optional lists its layout carries (residency budget accounting). */
  bytes: number;
  vertexBuf: GPUBuffer;
  /** Meshlet-local indices, `indexWidth` bytes each (drawLayout.ts). */
  indexBuf: GPUBuffer;
  indexWidth: IndexWidth;
  /** Index slots the buffers hold (the pack's u8 length, a multiple of 4). */
  indexCount: number;
  cgColorBuf: GPUBuffer;
  meshletCullBuf: GPUBuffer;
  visBuf: GPUBuffer;
  meshletInfoBuf: GPUBuffer;
  itemStateBuf: GPUBuffer; // per-item [flags, colorRGBA8, transform_idx] (MeshItem)
  normalBuf: GPUBuffer; // authored oct normals (u32/vertex) or a 1-word dummy
  modelUniBuf: GPUBuffer; // {item_base}
  itemBase: number; // global id-buffer offset (0 = background)
  itemCount: number;
  /** Anything for the blend pass in this model — the worker's
   *  modelHasTransparency, refreshed by every state update (baked colour
   *  alpha at upload). Gates the per-model sort clear / scan / scatter and
   *  the blend draw, so blend mode's fixed per-model cost is paid only by
   *  models that have glass — and the sorted list exists only while it holds. */
  transparent: boolean;
  /** Draw path the lists and bind groups are laid out for. */
  path: DrawPath;
  /** Pass-1 / pass-2 cull lists, entry size per path. */
  recordBuf1: GPUBuffer;
  recordBuf2: GPUBuffer;
  /** Sorted blend list — only while `transparent` (and the path culls). */
  sort: SortLists | null;
  /** Outline mask list (outlinePass.ts) — only while an outline feature is on. */
  outlineBuf: GPUBuffer | null;
  /** Static all-meshlets list — only on the no-cull path. */
  full: FullList | null;
  renderBind: GPUBindGroup;
  binds: ModelBinds;
  snapBind?: GPUBindGroup; // measurement snap compute (created lazily)
  countOffset1: number;
  countOffset2: number;
  countOffsetT: number;
  countOffsetO: number;
}

/** A draw list's MDI record buffer, its count-slot byte offset and its
 *  vertex-pull bind group (null under MDI). */
export type DrawListRef = Readonly<{ buf: GPUBuffer; offset: number; vpBind: GPUBindGroup | null }>;

/** One of a model's draw lists — null when the model does not hold it (no
 *  transparency, outline off), which draws nothing either way. */
export function drawListOf(m: GpuModel, list: DrawList): DrawListRef | null {
  if (list === 1) {
    return { buf: m.recordBuf1, offset: m.countOffset1, vpBind: m.binds.vp1 };
  }
  if (list === 2) {
    return { buf: m.recordBuf2, offset: m.countOffset2, vpBind: m.binds.vp2 };
  }
  if (list === OUTLINE_LIST) {
    return m.outlineBuf ? { buf: m.outlineBuf, offset: m.countOffsetO, vpBind: m.binds.vpO } : null;
  }
  return m.sort
    ? { buf: m.sort.recordBufT, offset: m.countOffsetT + TRANSPARENT_COUNT_OFFSET, vpBind: m.binds.vpT }
    : null;
}

/** The vertex-pull drawIndirect args offset of a draw list (the transparent
 *  slot keeps its args at the slot start, before the MDI count). */
export function vpArgsOffsetOf(m: GpuModel, list: DrawList): number {
  if (list === TRANSPARENT_LIST) {
    return m.countOffsetT;
  }
  if (list === OUTLINE_LIST) {
    return m.countOffsetO;
  }
  return list === 1 ? m.countOffset1 : m.countOffset2;
}

/** Replay the scene's culled draw lists (both cull passes plus the sorted
 *  transparent list — its second facing instance degenerates outside the
 *  blend pass; the no-cull fallback replays the static full list once)
 *  through `mdiPipeline` / `vpPipeline` with the render bind group at
 *  `frameOffset` — the pattern every id/mask re-render pass shares. `lists`
 *  narrows the replay to specific lists (the outline mask draws only its own). */
export function replayDrawLists(
  pass: GPURenderPassEncoder,
  models: GpuModel[],
  countsBuf: GPUBuffer,
  cullMode: DrawPath,
  mdiPipeline: GPURenderPipeline,
  vpPipeline: GPURenderPipeline,
  frameOffset: number,
  lists: readonly DrawList[] = cullMode === 'full' ? [1] : [1, 2, TRANSPARENT_LIST],
): void {
  for (const list of lists) {
    pass.setPipeline(cullMode === 'mdi' ? mdiPipeline : vpPipeline);
    for (const m of models) {
      // meshletCount 0 also covers a fully-cut coarse variant, whose
      // minimum-sized geometry buffers would fail draw-time binding checks
      if (m.dead || m.meshletCount === 0) {
        continue;
      }
      replayModelList(pass, m, list, countsBuf, cullMode, frameOffset);
    }
  }
}

/** One model's share of replayDrawLists. */
function replayModelList(
  pass: GPURenderPassEncoder,
  m: GpuModel,
  list: DrawList,
  countsBuf: GPUBuffer,
  cullMode: DrawPath,
  frameOffset: number,
): void {
  if (cullMode === 'full' && list !== OUTLINE_LIST) {
    if (!m.full || !m.binds.vpFull) {
      return;
    }
    pass.setBindGroup(0, m.renderBind, [frameOffset]);
    pass.setBindGroup(1, m.binds.vpFull);
    pass.drawIndirect(m.full.fullArgsBuf, 0);
    return;
  }
  const ref = drawListOf(m, list);
  if (!ref) {
    return;
  }
  pass.setBindGroup(0, m.renderBind, [frameOffset]);
  if (cullMode === 'mdi') {
    if (m.indexWidth !== 2) {
      return;
    }
    pass.setVertexBuffer(0, m.vertexBuf);
    pass.setIndexBuffer(m.indexBuf, 'uint16');
    (
      pass as unknown as {
        multiDrawIndexedIndirect(b: GPUBuffer, o: number, max: number, cb: GPUBuffer, co: number): void;
      }
    ).multiDrawIndexedIndirect(ref.buf, 0, m.meshletCount, countsBuf, ref.offset);
    return;
  }
  if (!ref.vpBind) {
    return;
  }
  pass.setBindGroup(1, ref.vpBind);
  pass.drawIndirect(countsBuf, vpArgsOffsetOf(m, list));
}
