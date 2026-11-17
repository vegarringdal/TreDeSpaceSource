// Parser for the cooked .tdp format (CADM v7/v8) produced by the cooker.
// Layout reference: crates/cad-format/src/*.rs and cad-cooker/src/cook.rs.
// All meshlet streams are compressed with the meshoptimizer vertex codec.
import { MeshoptDecoder } from 'meshoptimizer';

export interface ColorGroup {
  color: [number, number, number, number];
  meshletCount: number;
  localVertCount: number;
  triByteCount: number;
  drawRangeCount: number;
  drMeshletStarts: Uint32Array; // per draw range: first meshlet (CG-local)
  drMeshletCounts: Uint32Array;
  descs: DataView; // MeshletDesc[meshletCount], 40 B each
  tris: Uint8Array; // u8 micro-indices, 3/tri, per-meshlet 4-byte padded
  bounds: Float32Array; // MeshletBounds[meshletCount], 12 floats each
  positions: Uint8Array; // 3× u16 per local vertex (quantized)
  normals: Uint8Array | null; // 2× i16 octahedral per local vertex
}

export interface Hierarchy {
  /** UTF-8 name pool; entries reference [nameOffset, nameOffset+nameLen). */
  namePool: Uint8Array;
  entryId: Uint32Array; // sparse GLB draw-range id (leaves) / group id
  entryNameOffset: Uint32Array;
  entryParent: Uint32Array; // 0xFFFFFFFF = root
  entryNameLen: Uint16Array;
  /** Sparse id -> dense item index, sorted by id for binary search. */
  idItemIds: Uint32Array;
  idItemItems: Uint32Array;
}

/** v9 spatial cell table — a fixed 2-level octree stored as ranges, not a
 *  tree. Cell `i` owns dense items `[itemStart[i], itemStart[i] + itemCount[i])`
 *  and `aabbMin/Max` is the union box of those items. Cell 0 is the root
 *  (items that straddle a level-1 boundary — the zone-spanning outliers). */
export interface CellTable {
  count: number;
  aabbMin: Float32Array;
  aabbMax: Float32Array;
  itemStart: Uint32Array;
  itemCount: Uint32Array;
}

export interface ParsedModel {
  name: string;
  boundsMin: [number, number, number];
  boundsMax: [number, number, number];
  /** v8 percentile dense bounds (null on v7 files). */
  denseMin: [number, number, number] | null;
  denseMax: [number, number, number] | null;
  colorGroups: ColorGroup[];
  /** Dense-item tables (items section): item -> color group / draw-range idx. */
  itemCount: number;
  itemToCg: Uint16Array;
  itemToDr: Uint32Array;
  hierarchy: Hierarchy;
  /** v9 spatial cells (null on v7/v8 files). */
  cells: CellTable | null;
}

const MAGIC = 0x4d444143; // "CADM" little-endian
// v7 = the reference cooker's output; v8 (our wasm cooker) appends the
// 10th–90th percentile "dense bounds" to the header (+24 bytes).
const FORMAT_MIN = 7;
const FORMAT_MAX = 9;
const HEADER_SIZE_V7 = 216;
/** v8 appends dense bounds (24 B); v9 appends the cell-table pointer (16 B). */
const HEADER_SIZE_V8 = HEADER_SIZE_V7 + 24;
const HEADER_SIZE_V9 = HEADER_SIZE_V8 + 16;
/** One CellEntry in the v9 cell table: aabb_min[3], aabb_max[3], start, count. */
const CELL_ENTRY_SIZE = 32;
const CG_HEADER_SIZE = 128;

function decodeStream(file: Uint8Array, offset: number, csize: number, count: number, stride: number): Uint8Array {
  const out = new Uint8Array(count * stride);
  if (count === 0) {
    return out;
  }
  MeshoptDecoder.decodeVertexBuffer(out, count, stride, file.subarray(offset, offset + csize));
  return out;
}

export async function parseModel(name: string, bytes: ArrayBuffer): Promise<ParsedModel> {
  await MeshoptDecoder.ready;
  const file = new Uint8Array(bytes);
  const dv = new DataView(bytes);

  if (dv.getUint32(0, true) !== MAGIC) {
    throw new Error(`${name}: bad magic`);
  }
  const version = dv.getUint32(4, true);
  if (version < FORMAT_MIN || version > FORMAT_MAX) {
    throw new Error(`${name}: format version ${version}, expected ${FORMAT_MIN}–${FORMAT_MAX}`);
  }
  const headerSize = version >= 9 ? HEADER_SIZE_V9 : version >= 8 ? HEADER_SIZE_V8 : HEADER_SIZE_V7;
  const cgCount = dv.getUint32(8, true);
  const itemsOffset = Number(dv.getBigUint64(72, true));
  const hierarchyOffset = Number(dv.getBigUint64(80, true));
  const boundsMin: [number, number, number] = [
    dv.getFloat32(48, true),
    dv.getFloat32(52, true),
    dv.getFloat32(56, true),
  ];
  const boundsMax: [number, number, number] = [
    dv.getFloat32(60, true),
    dv.getFloat32(64, true),
    dv.getFloat32(68, true),
  ];
  // v8: percentile dense bounds — frame "where 80% of the mesh is" at load
  const denseMin: [number, number, number] | null =
    version >= 8 ? [dv.getFloat32(216, true), dv.getFloat32(220, true), dv.getFloat32(224, true)] : null;
  const denseMax: [number, number, number] | null =
    version >= 8 ? [dv.getFloat32(228, true), dv.getFloat32(232, true), dv.getFloat32(236, true)] : null;

  // v9: the spatial cell table — each entry is a contiguous DENSE item range
  // plus its union AABB. The ranges ARE the octree (DESIGN.md "Cooked format"); the
  // cooker orders items so a cell's items, draw ranges and meshlets are all
  // contiguous, which is what lets residency load a subset by byte range.
  let cells: CellTable | null = null;
  if (version >= 9) {
    const cellOff = Number(dv.getBigUint64(240, true));
    const cellCount = dv.getUint32(248, true);
    const aabbMin = new Float32Array(cellCount * 3);
    const aabbMax = new Float32Array(cellCount * 3);
    const itemStart = new Uint32Array(cellCount);
    const itemCount = new Uint32Array(cellCount);
    for (let i = 0; i < cellCount; i++) {
      const o = cellOff + i * CELL_ENTRY_SIZE;
      for (let k = 0; k < 3; k++) {
        aabbMin[i * 3 + k] = dv.getFloat32(o + k * 4, true);
        aabbMax[i * 3 + k] = dv.getFloat32(o + 12 + k * 4, true);
      }
      itemStart[i] = dv.getUint32(o + 24, true);
      itemCount[i] = dv.getUint32(o + 28, true);
    }
    cells = { count: cellCount, aabbMin, aabbMax, itemStart, itemCount };
  }

  const colorGroups: ColorGroup[] = [];
  for (let i = 0; i < cgCount; i++) {
    const h = headerSize + i * CG_HEADER_SIZE;
    const color: [number, number, number, number] = [
      dv.getFloat32(h + 0, true),
      dv.getFloat32(h + 4, true),
      dv.getFloat32(h + 8, true),
      dv.getFloat32(h + 12, true),
    ];
    const meshletCount = dv.getUint32(h + 28, true);
    const drawRangeCount = dv.getUint32(h + 24, true);
    const drOff = Number(dv.getBigUint64(h + 32, true));
    const descOff = Number(dv.getBigUint64(h + 40, true));
    const trisOff = Number(dv.getBigUint64(h + 48, true));
    const boundsOff = Number(dv.getBigUint64(h + 56, true));
    const posOff = Number(dv.getBigUint64(h + 64, true));
    const normOff = Number(dv.getBigUint64(h + 72, true));
    const triByteCount = dv.getUint32(h + 80, true);
    const localVertCount = dv.getUint32(h + 84, true);
    const descCsize = dv.getUint32(h + 88, true);
    const trisCsize = dv.getUint32(h + 92, true);
    const boundsCsize = dv.getUint32(h + 96, true);
    const posCsize = dv.getUint32(h + 100, true);
    const normCsize = dv.getUint32(h + 104, true);

    const descBytes = decodeStream(file, descOff, descCsize, meshletCount, 40);
    const tris = decodeStream(file, trisOff, trisCsize, triByteCount / 4, 4);
    const boundsBytes = decodeStream(file, boundsOff, boundsCsize, meshletCount, 48);
    // Positions are codec-encoded as 12-byte elements (2 vertices), tail zero-padded.
    const posElems = Math.ceil((localVertCount * 6) / 12);
    const positions = decodeStream(file, posOff, posCsize, posElems, 12).subarray(0, localVertCount * 6);
    const normals = normOff !== 0 && normCsize !== 0 ? decodeStream(file, normOff, normCsize, localVertCount, 4) : null;

    // draw-range section (raw): ids[D] starts[D] counts[D] dr_meshlet_starts[D] dr_meshlet_counts[D]
    // (read via DataView: compressed sections make later offsets arbitrary)
    const drMeshletStarts = new Uint32Array(drawRangeCount);
    const drMeshletCounts = new Uint32Array(drawRangeCount);
    for (let d = 0; d < drawRangeCount; d++) {
      drMeshletStarts[d] = dv.getUint32(drOff + drawRangeCount * 12 + d * 4, true);
      drMeshletCounts[d] = dv.getUint32(drOff + drawRangeCount * 16 + d * 4, true);
    }

    colorGroups.push({
      color,
      meshletCount,
      localVertCount,
      triByteCount,
      drawRangeCount,
      drMeshletStarts,
      drMeshletCounts,
      descs: new DataView(descBytes.buffer, descBytes.byteOffset, descBytes.byteLength),
      tris,
      bounds: new Float32Array(boundsBytes.buffer, boundsBytes.byteOffset, meshletCount * 12),
      positions,
      normals,
    });
  }
  // items section: dense ItemIndex -> (color group, draw-range index)
  const itemCount = dv.getUint32(itemsOffset, true);
  const itemToCgOff = Number(dv.getBigUint64(itemsOffset + 8, true));
  const itemToDrOff = Number(dv.getBigUint64(itemsOffset + 16, true));
  const itemToCg = new Uint16Array(itemCount);
  const itemToDr = new Uint32Array(itemCount);
  for (let i = 0; i < itemCount; i++) {
    itemToCg[i] = dv.getUint16(itemToCgOff + i * 2, true);
    itemToDr[i] = dv.getUint32(itemToDrOff + i * 4, true);
  }

  // hierarchy section: name pool + parent-linked entries + sparse id -> item
  const entryCount = dv.getUint32(hierarchyOffset, true);
  const idItemCount = dv.getUint32(hierarchyOffset + 4, true);
  const namePoolLen = dv.getUint32(hierarchyOffset + 8, true);
  const namePoolOff = Number(dv.getBigUint64(hierarchyOffset + 16, true));
  const entriesOff = Number(dv.getBigUint64(hierarchyOffset + 24, true));
  const idItemOff = Number(dv.getBigUint64(hierarchyOffset + 32, true));

  const namePool = new Uint8Array(bytes.slice(namePoolOff, namePoolOff + namePoolLen));
  const entryId = new Uint32Array(entryCount);
  const entryNameOffset = new Uint32Array(entryCount);
  const entryParent = new Uint32Array(entryCount);
  const entryNameLen = new Uint16Array(entryCount);
  for (let i = 0; i < entryCount; i++) {
    const e = entriesOff + i * 16;
    entryId[i] = dv.getUint32(e, true);
    entryNameOffset[i] = dv.getUint32(e + 4, true);
    entryParent[i] = dv.getUint32(e + 8, true);
    entryNameLen[i] = dv.getUint16(e + 12, true);
  }
  const idItemIds = new Uint32Array(idItemCount);
  const idItemItems = new Uint32Array(idItemCount);
  for (let i = 0; i < idItemCount; i++) {
    const e = idItemOff + i * 8;
    idItemIds[i] = dv.getUint32(e, true);
    idItemItems[i] = dv.getUint32(e + 4, true);
  }

  return {
    name,
    boundsMin,
    boundsMax,
    denseMin,
    denseMax,
    colorGroups,
    itemCount,
    itemToCg,
    itemToDr,
    hierarchy: { namePool, entryId, entryNameOffset, entryParent, entryNameLen, idItemIds, idItemItems },
    cells,
  };
}
