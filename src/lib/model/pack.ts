// Pure geometry packing: ParsedModel -> flat typed arrays ready for GPU
// upload. Runs inside the model-database worker so multi-second packing of
// big models never blocks the main thread; every array is transferable.
import type { ParsedModel } from './format';

export const MESHLET_STRIDE = 36; // packed MeshletCull words in shaders.ts (9 u32)
export const INFO_STRIDE_WORDS = 8; // MeshletInfo: {aabb_min, cg, aabb_scale, item}

export interface PackedModel {
  name: string;
  boundsMin: [number, number, number];
  boundsMax: [number, number, number];
  /** v8 percentile dense bounds (null on v7 files). */
  denseMin: [number, number, number] | null;
  denseMax: [number, number, number] | null;
  meshletCount: number;
  triangleCount: number;
  itemCount: number;
  cgCount: number;
  /** u16x4 quantized positions (8 B/vertex). */
  positionsQ: Uint16Array;
  /** 2× snorm16 octahedral normals per vertex (parallel to positionsQ), or
   *  null when the model shades flat. Read as array<u32> on the GPU. */
  normalsQ: Int16Array | null;
  /** u16 meshlet-local indices, trimmed + even-padded. */
  indices16: Uint16Array;
  /** MeshletCull records (64 B each). */
  cull: ArrayBuffer;
  /** MeshletInfo records (32 B each); .item is the DENSE local ItemIndex. */
  meshletInfo: ArrayBuffer;
  cgColors: Float32Array;
  /** per-item world AABB [minx,miny,minz,maxx,maxy,maxz] — stays in the worker. */
  itemBounds: Float32Array;
}

/**
 * Quantize the meshlet cone to s8x4 (WGSL unpack4x8snorm layout: byte 0 = x).
 * The cutoff rounds UP one extra 1/127 step so the quantized-axis error
 * (≤ √3·0.5/127 on the dot product) can never cull a visible cluster; a file
 * cutoff ≥ 1 stays the exact 1.0 degenerate marker (cone test skipped).
 */
function packCone(ax: number, ay: number, az: number, cutoff: number): number {
  const s8 = (v: number): number => Math.max(-127, Math.min(127, Math.round(v * 127))) & 0xff;
  const cut = cutoff >= 1 ? 127 : Math.max(-127, Math.min(127, Math.ceil(cutoff * 127) + 1)) & 0xff;
  return (s8(ax) | (s8(ay) << 8) | (s8(az) << 16) | (cut << 24)) >>> 0;
}

/**
 * Mixed-residency pack (VRAM-budget tier 2.5): ONE packed model whose
 * per-item geometry comes from `full` (useFull[item] = 1) or `coarse` (0) —
 * near items sharp, the rest coarse, complete item table, exclusive per item.
 * Both parses must come from the same import (identical item table, color
 * groups, and draw-range order — the invariant the coarse cook guarantees
 * and the caller asserts). An item with useFull=0 and no coarse parse is
 * dropped to zero meshlets (like the cook's tiny-item cut), and `useFull[i]
 * = 2` drops the item unconditionally (tiny-and-far / hidden cuts). Unlike
 * packModel, vertex/index streams are COMPACTED — skipped meshlets would
 * otherwise leave gaps in the buffers.
 */
export const ITEM_DROP = 2;

/** GPU bytes per meshlet that do not depend on its size: the cull record,
 *  the two draw-record slots, the visibility word, the info record and the
 *  full-list entry (renderer.ts MESHLET_RECORD_BYTES). */
export const MESHLET_RECORD_BYTES = 116;
const POSITION_BYTES_PER_VERTEX = 8;
const NORMAL_BYTES_PER_VERTEX = 4;
const INDEX_BYTES_PER_TRIANGLE = 6;

/** Whether a pack of these parses would carry an authored-normal stream: the
 *  packer only emits one when EVERY color group of every source has normals. */
export function hasAuthoredNormals(full: ParsedModel, coarse: ParsedModel | null): boolean {
  return (
    full.colorGroups.length > 0 &&
    full.colorGroups.every((cg) => cg.normals != null) &&
    (!coarse || coarse.colorGroups.every((cg) => cg.normals != null))
  );
}

/** Estimated GPU bytes per item at full detail — what the mixed pack's greedy
 *  fill budgets with. Positions, indices, the per-meshlet records, and the
 *  normal stream when the model has one (omitting it under-estimated
 *  smooth-shaded models by a third of their vertex bytes, so mixed packs
 *  overshot their target). */
export function estimateItemFullBytes(full: ParsedModel, withNormals: boolean): Float32Array {
  const est = new Float32Array(full.itemCount);
  const drToItem = full.colorGroups.map((cg) => new Uint32Array(cg.drawRangeCount));
  for (let i = 0; i < full.itemCount; i++) {
    drToItem[full.itemToCg[i]][full.itemToDr[i]] = i;
  }
  const vertexBytes = POSITION_BYTES_PER_VERTEX + (withNormals ? NORMAL_BYTES_PER_VERTEX : 0);
  full.colorGroups.forEach((cg, cgIdx) => {
    for (let d = 0; d < cg.drawRangeCount; d++) {
      const item = drToItem[cgIdx][d];
      const start = cg.drMeshletStarts[d];
      for (let k = 0; k < cg.drMeshletCounts[d]; k++) {
        const off = (start + k) * 40;
        est[item] +=
          cg.descs.getUint32(off + 8, true) * vertexBytes +
          cg.descs.getUint32(off + 12, true) * INDEX_BYTES_PER_TRIANGLE +
          MESHLET_RECORD_BYTES;
      }
    }
  });
  return est;
}

/**
 * Upgrade-only merge of freshly packed item bounds into a model's stored ones:
 * items whose stored bounds are non-finite adopt the incoming bounds when
 * those are finite. Finite stored bounds are never touched.
 *
 * Why this exists: the DbModel's itemBounds are written once at addModel and
 * every repack discards the variant's bounds — correct when addModel saw the
 * FULL file, but the VRAM-budget initial load feeds addModel the COARSE file,
 * whose cooker-cut tiny items have no meshlets and therefore ±Infinity bounds.
 * Those items were unselectable-in-space forever (focus/clip-fit returned
 * null) even after the budget was turned off. This heals them on the first
 * repack that packs the item with geometry (full promote, mixed pack, or a
 * coarse refresh for items the coarsen kept).
 */
export function healItemBounds(stored: Float32Array, incoming: Float32Array): number {
  let healed = 0;
  const n = Math.min(stored.length, incoming.length);
  for (let b = 0; b < n; b += 6) {
    if (!Number.isFinite(stored[b]) && Number.isFinite(incoming[b])) {
      for (let k = 0; k < 6; k++) {
        stored[b + k] = incoming[b + k];
      }
      healed++;
    }
  }
  return healed;
}

export function packModelMixed(full: ParsedModel, coarse: ParsedModel | null, useFull: Uint8Array): PackedModel {
  if (coarse && (coarse.itemCount !== full.itemCount || coarse.colorGroups.length !== full.colorGroups.length)) {
    throw new Error('packModelMixed: coarse variant does not match the full parse');
  }

  const drToItem = full.colorGroups.map((cg) => new Uint32Array(cg.drawRangeCount));
  for (let i = 0; i < full.itemCount; i++) {
    drToItem[full.itemToCg[i]][full.itemToDr[i]] = i;
  }

  // sizing pre-pass over each draw range's CHOSEN source
  let totalVerts = 0;
  let totalTris = 0;
  let totalMeshlets = 0;
  const srcOf = (cgIdx: number, item: number) => {
    if (useFull[item] === ITEM_DROP) {
      return null;
    }
    if (useFull[item] === 1) {
      return full.colorGroups[cgIdx];
    }
    return coarse ? coarse.colorGroups[cgIdx] : null;
  };
  full.colorGroups.forEach((fcg, cgIdx) => {
    const ccg = coarse?.colorGroups[cgIdx];
    if (ccg && ccg.drawRangeCount !== fcg.drawRangeCount) {
      throw new Error(`packModelMixed: cg ${cgIdx} draw-range count differs between variants`);
    }
    for (let d = 0; d < fcg.drawRangeCount; d++) {
      const src = srcOf(cgIdx, drToItem[cgIdx][d]);
      if (!src) {
        continue;
      }
      const start = src.drMeshletStarts[d];
      for (let k = 0; k < src.drMeshletCounts[d]; k++) {
        const off = (start + k) * 40;
        totalVerts += src.descs.getUint32(off + 8, true);
        totalTris += src.descs.getUint32(off + 12, true);
        totalMeshlets++;
      }
    }
  });

  const positionsQ = new Uint16Array(totalVerts * 4);
  const withNormals =
    full.colorGroups.length > 0 &&
    full.colorGroups.every((cg) => cg.normals != null) &&
    (!coarse || coarse.colorGroups.every((cg) => cg.normals != null));
  const normalsQ = withNormals ? new Int16Array(totalVerts * 2) : null;
  const indices16 = new Uint16Array(totalTris * 3 + 1); // +1: even pad for writeBuffer
  const cull = new ArrayBuffer(totalMeshlets * MESHLET_STRIDE);
  const cullF = new Float32Array(cull);
  const cullU = new Uint32Array(cull);
  const cgColors = new Float32Array(full.colorGroups.length * 4);
  const meshletInfo = new ArrayBuffer(totalMeshlets * INFO_STRIDE_WORDS * 4);
  const infoU = new Uint32Array(meshletInfo);
  const infoF = new Float32Array(meshletInfo);
  const itemBounds = new Float32Array(full.itemCount * 6);
  for (let i = 0; i < full.itemCount; i++) {
    itemBounds.set([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], i * 6);
  }

  let nextVert = 0;
  let indexPos = 0;
  let meshletIdx = 0;
  let triangleCount = 0;

  full.colorGroups.forEach((fcg, cgIdx) => {
    cgColors.set(fcg.color, cgIdx * 4);
    for (let d = 0; d < fcg.drawRangeCount; d++) {
      const item = drToItem[cgIdx][d];
      const src = srcOf(cgIdx, item);
      if (!src) {
        continue;
      }
      const nrmQ =
        normalsQ && src.normals
          ? new Int16Array(src.normals.buffer, src.normals.byteOffset, src.localVertCount * 2)
          : null;
      const start = src.drMeshletStarts[d];
      for (let k = 0; k < src.drMeshletCounts[d]; k++) {
        const doff = (start + k) * 40;
        const vOff = src.descs.getUint32(doff + 0, true);
        const tOff = src.descs.getUint32(doff + 4, true);
        const vCount = src.descs.getUint32(doff + 8, true);
        const tCount = src.descs.getUint32(doff + 12, true);

        const meshletBase = nextVert;
        for (let v = 0; v < vCount; v++) {
          const s = (vOff + v) * 6;
          const dst = (meshletBase + v) * 4;
          positionsQ[dst + 0] = src.positions[s] | (src.positions[s + 1] << 8);
          positionsQ[dst + 1] = src.positions[s + 2] | (src.positions[s + 3] << 8);
          positionsQ[dst + 2] = src.positions[s + 4] | (src.positions[s + 5] << 8);
          if (normalsQ && nrmQ) {
            normalsQ[(meshletBase + v) * 2] = nrmQ[(vOff + v) * 2];
            normalsQ[(meshletBase + v) * 2 + 1] = nrmQ[(vOff + v) * 2 + 1];
          }
        }
        nextVert += vCount;

        const io = meshletIdx * INFO_STRIDE_WORDS;
        infoF[io + 0] = src.descs.getFloat32(doff + 16, true);
        infoF[io + 1] = src.descs.getFloat32(doff + 20, true);
        infoF[io + 2] = src.descs.getFloat32(doff + 24, true);
        infoU[io + 3] = cgIdx;
        infoF[io + 4] = src.descs.getFloat32(doff + 28, true);
        infoF[io + 5] = src.descs.getFloat32(doff + 32, true);
        infoF[io + 6] = src.descs.getFloat32(doff + 36, true);
        infoU[io + 7] = item;

        const it = item * 6;
        const mnx = infoF[io + 0];
        const mny = infoF[io + 1];
        const mnz = infoF[io + 2];
        const mxx = mnx + infoF[io + 4] * 65535;
        const mxy = mny + infoF[io + 5] * 65535;
        const mxz = mnz + infoF[io + 6] * 65535;
        itemBounds[it] = Math.min(itemBounds[it], mnx);
        itemBounds[it + 1] = Math.min(itemBounds[it + 1], mny);
        itemBounds[it + 2] = Math.min(itemBounds[it + 2], mnz);
        itemBounds[it + 3] = Math.max(itemBounds[it + 3], mxx);
        itemBounds[it + 4] = Math.max(itemBounds[it + 4], mxy);
        itemBounds[it + 5] = Math.max(itemBounds[it + 5], mxz);

        const firstIndex = indexPos;
        for (let t = 0; t < tCount * 3; t++) {
          indices16[indexPos++] = src.tris[tOff + t];
        }
        triangleCount += tCount;

        const b = (start + k) * 12;
        const o = meshletIdx * 9;
        cullF[o + 0] = src.bounds[b + 0];
        cullF[o + 1] = src.bounds[b + 1];
        cullF[o + 2] = src.bounds[b + 2];
        cullF[o + 3] = src.bounds[b + 3];
        cullU[o + 4] = packCone(src.bounds[b + 7], src.bounds[b + 8], src.bounds[b + 9], src.bounds[b + 10]);
        cullU[o + 5] = tCount * 3;
        cullU[o + 6] = firstIndex;
        cullU[o + 7] = cgIdx;
        cullU[o + 8] = meshletBase;
        meshletIdx++;
      }
    }
  });

  return {
    name: full.name,
    boundsMin: full.boundsMin,
    boundsMax: full.boundsMax,
    denseMin: full.denseMin,
    denseMax: full.denseMax,
    normalsQ,
    meshletCount: totalMeshlets,
    triangleCount,
    itemCount: full.itemCount,
    cgCount: full.colorGroups.length,
    positionsQ,
    indices16: indices16.slice(0, Math.ceil(indexPos / 2) * 2),
    cull,
    meshletInfo,
    cgColors,
    itemBounds,
  };
}

export function packModel(model: ParsedModel): PackedModel {
  let totalVerts = 0,
    totalTris = 0,
    totalMeshlets = 0;
  for (const cg of model.colorGroups) {
    totalVerts += cg.localVertCount;
    totalMeshlets += cg.meshletCount;
    totalTris += cg.triByteCount; // upper bound; trimmed below
  }

  const positionsQ = new Uint16Array(totalVerts * 4);
  // normals are all-or-nothing per file (cook.ts) — pack only when every CG has them
  const withNormals = model.colorGroups.length > 0 && model.colorGroups.every((cg) => cg.normals != null);
  const normalsQ = withNormals ? new Int16Array(totalVerts * 2) : null;
  const indices16 = new Uint16Array(totalTris * 3 + 1); // +1: even pad for writeBuffer
  const cull = new ArrayBuffer(totalMeshlets * MESHLET_STRIDE);
  const cullF = new Float32Array(cull);
  const cullU = new Uint32Array(cull);
  const cgColors = new Float32Array(model.colorGroups.length * 4);
  const meshletInfo = new ArrayBuffer(totalMeshlets * INFO_STRIDE_WORDS * 4);
  const infoU = new Uint32Array(meshletInfo);
  const infoF = new Float32Array(meshletInfo);

  // items section inverted: (cg, drawRangeIdx) -> dense ItemIndex
  const drToItem = model.colorGroups.map((cg) => new Uint32Array(cg.drawRangeCount));
  for (let i = 0; i < model.itemCount; i++) {
    drToItem[model.itemToCg[i]][model.itemToDr[i]] = i;
  }

  const itemBounds = new Float32Array(model.itemCount * 6);
  for (let i = 0; i < model.itemCount; i++) {
    itemBounds.set([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], i * 6);
  }
  // meshlet -> item lookup while packing (mirrors the meshletInfo fill below)
  const meshletItem = new Uint32Array(model.colorGroups.reduce((n, cg) => n + cg.meshletCount, 0));

  let vertBase = 0,
    indexPos = 0,
    meshletIdx = 0;
  let triangleCount = 0;

  model.colorGroups.forEach((cg, cgIdx) => {
    cgColors.set(cg.color, cgIdx * 4);
    const cgFirstMeshlet = meshletIdx;

    // meshlet -> dense item (draw ranges are contiguous meshlet spans)
    for (let d = 0; d < cg.drawRangeCount; d++) {
      const item = drToItem[cgIdx][d];
      const start = cgFirstMeshlet + cg.drMeshletStarts[d];
      for (let k = 0; k < cg.drMeshletCounts[d]; k++) {
        const o = (start + k) * INFO_STRIDE_WORDS;
        infoU[o + 3] = cgIdx;
        infoU[o + 7] = item;
        meshletItem[start + k] = item;
      }
    }

    const posQ = cg.positions;
    const nrmQ =
      normalsQ && cg.normals ? new Int16Array(cg.normals.buffer, cg.normals.byteOffset, cg.localVertCount * 2) : null;
    for (let m = 0; m < cg.meshletCount; m++) {
      const d = m * 40;
      const vOff = cg.descs.getUint32(d + 0, true);
      const tOff = cg.descs.getUint32(d + 4, true);
      const vCount = cg.descs.getUint32(d + 8, true);
      const tCount = cg.descs.getUint32(d + 12, true);

      const meshletBase = vertBase + vOff;
      for (let v = 0; v < vCount; v++) {
        const src = (vOff + v) * 6;
        const dst = (meshletBase + v) * 4;
        positionsQ[dst + 0] = posQ[src] | (posQ[src + 1] << 8);
        positionsQ[dst + 1] = posQ[src + 2] | (posQ[src + 3] << 8);
        positionsQ[dst + 2] = posQ[src + 4] | (posQ[src + 5] << 8);
        if (normalsQ && nrmQ) {
          normalsQ[(meshletBase + v) * 2] = nrmQ[(vOff + v) * 2];
          normalsQ[(meshletBase + v) * 2 + 1] = nrmQ[(vOff + v) * 2 + 1];
        }
      }
      // dequant AABB into meshlet_info for the vertex shader
      const io = meshletIdx * INFO_STRIDE_WORDS;
      infoF[io + 0] = cg.descs.getFloat32(d + 16, true);
      infoF[io + 1] = cg.descs.getFloat32(d + 20, true);
      infoF[io + 2] = cg.descs.getFloat32(d + 24, true);
      infoF[io + 4] = cg.descs.getFloat32(d + 28, true);
      infoF[io + 5] = cg.descs.getFloat32(d + 32, true);
      infoF[io + 6] = cg.descs.getFloat32(d + 36, true);

      // grow the owning item's AABB by this meshlet's dequant box
      {
        const it = meshletItem[meshletIdx] * 6;
        const mnx = infoF[io + 0],
          mny = infoF[io + 1],
          mnz = infoF[io + 2];
        const mxx = mnx + infoF[io + 4] * 65535;
        const mxy = mny + infoF[io + 5] * 65535;
        const mxz = mnz + infoF[io + 6] * 65535;
        if (mnx < itemBounds[it]) {
          itemBounds[it] = mnx;
        }
        if (mny < itemBounds[it + 1]) {
          itemBounds[it + 1] = mny;
        }
        if (mnz < itemBounds[it + 2]) {
          itemBounds[it + 2] = mnz;
        }
        if (mxx > itemBounds[it + 3]) {
          itemBounds[it + 3] = mxx;
        }
        if (mxy > itemBounds[it + 4]) {
          itemBounds[it + 4] = mxy;
        }
        if (mxz > itemBounds[it + 5]) {
          itemBounds[it + 5] = mxz;
        }
      }

      const firstIndex = indexPos;
      // meshlet-local u16 indices; baseVertex in the draw record
      for (let t = 0; t < tCount * 3; t++) {
        indices16[indexPos++] = cg.tris[tOff + t];
      }
      triangleCount += tCount;

      // MeshletBounds in the file: center[3] radius apex[3] axis[3] cutoff
      // (f32 each). GPU record (36 B): center+radius f32, cone packed s8x4
      // [axis.xyz, cutoff] — the apex is dropped; the cull shader uses the
      // conservative apex-free meshopt cone test (center/radius based).
      const b = m * 12;
      const o = meshletIdx * 9;
      cullF[o + 0] = cg.bounds[b + 0]; // center
      cullF[o + 1] = cg.bounds[b + 1];
      cullF[o + 2] = cg.bounds[b + 2];
      cullF[o + 3] = cg.bounds[b + 3]; // radius
      cullU[o + 4] = packCone(cg.bounds[b + 7], cg.bounds[b + 8], cg.bounds[b + 9], cg.bounds[b + 10]);
      cullU[o + 5] = tCount * 3; // index_count
      cullU[o + 6] = firstIndex;
      cullU[o + 7] = cgIdx;
      cullU[o + 8] = meshletBase; // base_vertex for the draw record
      meshletIdx++;
    }

    vertBase += cg.localVertCount;
  });

  return {
    name: model.name,
    boundsMin: model.boundsMin,
    denseMin: model.denseMin,
    denseMax: model.denseMax,
    boundsMax: model.boundsMax,
    normalsQ,
    meshletCount: totalMeshlets,
    triangleCount,
    itemCount: model.itemCount,
    cgCount: model.colorGroups.length,
    positionsQ,
    indices16: indices16.slice(0, Math.ceil(indexPos / 2) * 2),
    cull,
    meshletInfo,
    cgColors,
    itemBounds,
  };
}
