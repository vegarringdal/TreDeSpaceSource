// -----------------------------------------------------------------------------
// The per-model buffers that follow the draw layout (drawLayout.ts): the
// index buffer at the path's width, the draw lists at the path's entry size,
// and the lists only one kind of path uses (sorted list / full list). The
// renderer decides WHEN to (re)build (renderer.ts ensureLayout); this module
// only knows how, and what a model holds right now.
// -----------------------------------------------------------------------------

import {
  type DrawPath,
  type IndexWidth,
  SORT_CANDIDATE_BYTES,
  transparentEntryBytes,
  VP_ENTRY_BYTES,
} from './drawLayout';
import type { FullList, GpuModel, SortLists } from './gpuModel';
import { SORT_STATE_WORDS } from './shaders/cull';

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** Floor for every per-model buffer: a near-empty coarse variant (1–2
 *  triangles) must still satisfy each pipeline's minimum binding size (the
 *  largest stride any binding reads is 48 B). */
export const MIN_MODEL_BUFFER_BYTES = 64;

/** Vertex-pull drawIndirect args of the static full list: 372 vertices
 *  (124 triangles) per meshlet instance. */
const VP_VERTICES_PER_MESHLET = 372;

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** Byte size for `bytes` of content: 4-aligned, never under the floor. */
function sizeFor(bytes: number): number {
  return Math.max(MIN_MODEL_BUFFER_BYTES, Math.ceil(bytes / 4) * 4);
}

/** An empty index buffer for `indexCount` indices at `width` bytes each.
 *  Width 2 is the MDI hardware index buffer; both widths stay storage-
 *  readable (measure snap, width conversion) and copyable (GLB export). */
export function createIndexBuffer(dev: GPUDevice, indexCount: number, width: IndexWidth): GPUBuffer {
  const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
  return dev.createBuffer({
    label: width === 1 ? 'modelIndexBuf8' : 'modelIndexBuf16',
    size: sizeFor(indexCount * width),
    usage: width === 2 ? usage | GPUBufferUsage.INDEX : usage,
  });
}

/** A cull-written draw list: one entry per meshlet at `entryBytes`. */
export function createListBuffer(dev: GPUDevice, meshletCount: number, entryBytes: number): GPUBuffer {
  return dev.createBuffer({
    label: 'modelRecordBuf',
    size: sizeFor(meshletCount * entryBytes),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT,
  });
}

/** The sorted blend list of a model with something transparent (DESIGN.md
 *  "Sorted blend pass"): the back-to-front list, the cull's [meshlet, bucket]
 *  candidates, the bucket histogram and the scatter's dispatch args — a
 *  buffer may not be writable storage and an indirect source in one pass,
 *  hence the args' own buffer. */
export function createSortLists(dev: GPUDevice, meshletCount: number, path: DrawPath): SortLists {
  return {
    recordBufT: createListBuffer(dev, meshletCount, transparentEntryBytes(path)),
    candBuf: dev.createBuffer({
      label: 'modelCandBuf',
      size: sizeFor(meshletCount * SORT_CANDIDATE_BYTES),
      usage: GPUBufferUsage.STORAGE,
    }),
    sortBuf: dev.createBuffer({
      label: 'modelSortBuf',
      size: SORT_STATE_WORDS * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }),
    sortArgsBuf: dev.createBuffer({
      label: 'modelSortArgsBuf',
      size: 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT,
    }),
  };
}

/** The no-cull path's static all-meshlets list and its drawIndirect args. */
export function createFullList(dev: GPUDevice, meshletCount: number): FullList {
  const iota = new Uint32Array(meshletCount);
  for (let i = 0; i < meshletCount; i++) {
    iota[i] = i;
  }
  const fullListBuf = dev.createBuffer({
    label: 'modelFullListBuf',
    size: sizeFor(meshletCount * VP_ENTRY_BYTES),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  dev.queue.writeBuffer(fullListBuf, 0, iota);
  const fullArgsBuf = dev.createBuffer({
    label: 'modelFullArgsBuf',
    size: 16,
    usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
  });
  dev.queue.writeBuffer(fullArgsBuf, 0, new Uint32Array([VP_VERTICES_PER_MESHLET, meshletCount, 0, 0]));
  return { fullListBuf, fullArgsBuf };
}

/** Every GPU buffer the model holds right now — core plus the optional lists. */
export function heldBuffers(m: GpuModel): GPUBuffer[] {
  const out = [
    m.vertexBuf,
    m.indexBuf,
    m.cgColorBuf,
    m.meshletCullBuf,
    m.visBuf,
    m.meshletInfoBuf,
    m.itemStateBuf,
    m.normalBuf,
    m.modelUniBuf,
    m.recordBuf1,
    m.recordBuf2,
    m.outlineBuf,
  ];
  if (m.sort) {
    out.push(m.sort.recordBufT, m.sort.candBuf, m.sort.sortBuf, m.sort.sortArgsBuf);
  }
  if (m.full) {
    out.push(m.full.fullListBuf, m.full.fullArgsBuf);
  }
  return out;
}

/** Live GPU bytes of a model slot (residency budget accounting). */
export function modelBytesOf(m: GpuModel): number {
  return heldBuffers(m).reduce((sum, b) => sum + b.size, 0);
}

/** Release every buffer the model holds (tombstone / scene clear). */
export function destroyModelBuffers(m: GpuModel): void {
  for (const b of heldBuffers(m)) {
    b.destroy();
  }
}

/** Free the optional sorted blend list. */
export function destroySortLists(s: SortLists): void {
  s.recordBufT.destroy();
  s.candBuf.destroy();
  s.sortBuf.destroy();
  s.sortArgsBuf.destroy();
}

/** Free the optional full list. */
export function destroyFullList(f: FullList): void {
  f.fullListBuf.destroy();
  f.fullArgsBuf.destroy();
}
