// Per-model GPU resources + the draw-list replay shared by every pass that
// re-renders the scene's culled geometry (item pick, outline mask).

import { SORT_COUNT_WORD } from './shaders/cull';

/** A model's cull-produced draw lists: pass 1 (visible last frame), pass 2
 *  (newly visible) and the sorted transparent list the blend pass draws
 *  back-to-front (DESIGN.md "Sorted blend pass"). */
export type DrawList = 1 | 2 | 3;
export const TRANSPARENT_LIST: DrawList = 3;
/** Byte offset of the MDI multi-draw count inside a model's transparent count
 *  slot (the sort scan writes the vertex-pull args at 0 and the plain count
 *  after them). */
export const TRANSPARENT_COUNT_OFFSET = SORT_COUNT_WORD * 4;

export interface GpuModel {
  /** Tombstoned by removeModels — buffers destroyed, slot kept so worker/renderer indices stay aligned. */
  dead?: boolean;
  name: string;
  meshletCount: number;
  triangleCount: number;
  /** Total GPU bytes of the 17 per-model buffers (residency budget accounting). */
  bytes: number;
  vertexBuf: GPUBuffer;
  indexBuf: GPUBuffer;
  cgColorBuf: GPUBuffer;
  meshletCullBuf: GPUBuffer;
  recordBuf1: GPUBuffer;
  recordBuf2: GPUBuffer;
  /** Sorted transparent draw list (MDI records / vertex-pull entries). */
  recordBufT: GPUBuffer;
  /** Transparent candidates from both cull passes: [meshlet, bucket] pairs. */
  candBuf: GPUBuffer;
  /** Bucket histogram → scatter bases, candidate count. */
  sortBuf: GPUBuffer;
  /** Scatter dispatch args (indirect), written by the scan pass. */
  sortArgsBuf: GPUBuffer;
  visBuf: GPUBuffer;
  meshletInfoBuf: GPUBuffer;
  itemStateBuf: GPUBuffer; // per-item [flags, colorRGBA8, transform_idx] (MeshItem)
  normalBuf: GPUBuffer; // authored oct normals (u32/vertex) or a 1-word dummy
  modelUniBuf: GPUBuffer; // {item_base}
  itemBase: number; // global id-buffer offset (0 = background)
  itemCount: number;
  cullBind1: GPUBindGroup; // MDI emit
  cullBind2: GPUBindGroup;
  cullVpBind1: GPUBindGroup; // vertex-pull emit
  cullVpBind2: GPUBindGroup;
  sortScanBind: GPUBindGroup; // sort-state scan → transparent count slot
  sortScatterBind: GPUBindGroup; // MDI records into recordBufT
  sortScatterVpBind: GPUBindGroup; // vertex-pull entries into recordBufT
  renderBind: GPUBindGroup;
  vpGeoBind1: GPUBindGroup; // VP render group 1 (pass-1 visible list)
  vpGeoBind2: GPUBindGroup;
  vpGeoBindT: GPUBindGroup; // sorted transparent list
  vpGeoBindFull: GPUBindGroup; // static all-meshlets list (no-cull fallback)
  snapBind?: GPUBindGroup; // measurement snap compute (created lazily)
  fullListBuf: GPUBuffer;
  fullArgsBuf: GPUBuffer;
  countOffset1: number;
  countOffset2: number;
  countOffsetT: number;
}

/** Record buffer + count-slot byte offset of one of a model's draw lists. */
export function drawListOf(m: GpuModel, list: DrawList): { buf: GPUBuffer; offset: number; vpBind: GPUBindGroup } {
  if (list === 1) {
    return { buf: m.recordBuf1, offset: m.countOffset1, vpBind: m.vpGeoBind1 };
  }
  if (list === 2) {
    return { buf: m.recordBuf2, offset: m.countOffset2, vpBind: m.vpGeoBind2 };
  }
  return { buf: m.recordBufT, offset: m.countOffsetT + TRANSPARENT_COUNT_OFFSET, vpBind: m.vpGeoBindT };
}

/** The vertex-pull drawIndirect args offset of a draw list (the transparent
 *  slot keeps its args at the slot start, before the MDI count). */
export function vpArgsOffsetOf(m: GpuModel, list: DrawList): number {
  return list === TRANSPARENT_LIST ? m.countOffsetT : drawListOf(m, list).offset;
}

/** Replay the scene's culled draw lists (both cull passes plus the sorted
 *  transparent list — its second facing instance degenerates outside the
 *  blend pass; the no-cull fallback replays the static full list once)
 *  through `mdiPipeline` / `vpPipeline` with the render bind group at
 *  `frameOffset` — the pattern every id/mask re-render pass shares. */
export function replayDrawLists(
  pass: GPURenderPassEncoder,
  models: GpuModel[],
  countsBuf: GPUBuffer,
  cullMode: 'mdi' | 'vp' | 'full',
  mdiPipeline: GPURenderPipeline,
  vpPipeline: GPURenderPipeline,
  frameOffset: number,
): void {
  for (const list of cullMode === 'full' ? ([1] as const) : ([1, 2, TRANSPARENT_LIST] as const)) {
    if (cullMode === 'mdi') {
      pass.setPipeline(mdiPipeline);
      for (const m of models) {
        // meshletCount 0 also covers a fully-cut coarse variant, whose
        // minimum-sized geometry buffers would fail draw-time binding checks
        if (m.dead || m.meshletCount === 0) {
          continue;
        }
        pass.setBindGroup(0, m.renderBind, [frameOffset]);
        pass.setVertexBuffer(0, m.vertexBuf);
        pass.setIndexBuffer(m.indexBuf, 'uint16');
        const { buf, offset } = drawListOf(m, list);
        (
          pass as unknown as {
            multiDrawIndexedIndirect(b: GPUBuffer, o: number, max: number, cb: GPUBuffer, co: number): void;
          }
        ).multiDrawIndexedIndirect(buf, 0, m.meshletCount, countsBuf, offset);
      }
    } else {
      pass.setPipeline(vpPipeline);
      for (const m of models) {
        if (m.dead || m.meshletCount === 0) {
          continue;
        }
        pass.setBindGroup(0, m.renderBind, [frameOffset]);
        if (cullMode === 'vp') {
          pass.setBindGroup(1, drawListOf(m, list).vpBind);
          pass.drawIndirect(countsBuf, vpArgsOffsetOf(m, list));
        } else {
          pass.setBindGroup(1, m.vpGeoBindFull);
          pass.drawIndirect(m.fullArgsBuf, 0);
        }
      }
    }
  }
}
