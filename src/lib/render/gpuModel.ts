// Per-model GPU resources + the draw-list replay shared by every pass that
// re-renders the scene's culled geometry (item pick, outline mask).

export interface GpuModel {
  /** Tombstoned by removeModels — buffers destroyed, slot kept so worker/renderer indices stay aligned. */
  dead?: boolean;
  name: string;
  meshletCount: number;
  triangleCount: number;
  /** Total GPU bytes of the 13 per-model buffers (residency budget accounting). */
  bytes: number;
  vertexBuf: GPUBuffer;
  indexBuf: GPUBuffer;
  cgColorBuf: GPUBuffer;
  meshletCullBuf: GPUBuffer;
  recordBuf1: GPUBuffer;
  recordBuf2: GPUBuffer;
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
  renderBind: GPUBindGroup;
  vpGeoBind1: GPUBindGroup; // VP render group 1 (pass-1 visible list)
  vpGeoBind2: GPUBindGroup;
  vpGeoBindFull: GPUBindGroup; // static all-meshlets list (no-cull fallback)
  snapBind?: GPUBindGroup; // measurement snap compute (created lazily)
  fullListBuf: GPUBuffer;
  fullArgsBuf: GPUBuffer;
  countOffset1: number;
  countOffset2: number;
}

/** Replay the scene's culled draw lists (both cull passes; the no-cull
 *  fallback replays the static full list once) through `mdiPipeline` /
 *  `vpPipeline` with the render bind group at `frameOffset` — the pattern
 *  every id/mask re-render pass shares. */
export function replayDrawLists(
  pass: GPURenderPassEncoder,
  models: GpuModel[],
  countsBuf: GPUBuffer,
  cullMode: 'mdi' | 'vp' | 'full',
  mdiPipeline: GPURenderPipeline,
  vpPipeline: GPURenderPipeline,
  frameOffset: number,
): void {
  for (const passIdx of cullMode === 'full' ? ([1] as const) : ([1, 2] as const)) {
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
        const [buf, off] = passIdx === 1 ? [m.recordBuf1, m.countOffset1] : [m.recordBuf2, m.countOffset2];
        (
          pass as unknown as {
            multiDrawIndexedIndirect(b: GPUBuffer, o: number, max: number, cb: GPUBuffer, co: number): void;
          }
        ).multiDrawIndexedIndirect(buf, 0, m.meshletCount, countsBuf, off);
      }
    } else {
      pass.setPipeline(vpPipeline);
      for (const m of models) {
        if (m.dead || m.meshletCount === 0) {
          continue;
        }
        pass.setBindGroup(0, m.renderBind, [frameOffset]);
        if (cullMode === 'vp') {
          pass.setBindGroup(1, passIdx === 1 ? m.vpGeoBind1 : m.vpGeoBind2);
          pass.drawIndirect(countsBuf, passIdx === 1 ? m.countOffset1 : m.countOffset2);
        } else {
          pass.setBindGroup(1, m.vpGeoBindFull);
          pass.drawIndirect(m.fullArgsBuf, 0);
        }
      }
    }
  }
}
