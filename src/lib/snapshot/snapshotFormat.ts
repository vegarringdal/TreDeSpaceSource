// The .tdsnap state-snapshot container: current per-item visual state
// (color/opacity/hidden overrides + baked transforms) for every loaded model,
// streamed as self-describing per-model blocks so multi-hundred-MB scenes
// export and import with bounded memory. Pure encode/decode helpers — no
// worker or DOM dependencies; the modeldb worker produces/consumes blocks and
// the export panel only moves whole files.
//
// Items are GROUPED by their state: a coloring rule paints thousands of items
// the same (flags, color, matrix), so each distinct tuple is written once in
// the group table and every member item costs only its 8-byte fullname hash —
// ~3× smaller than flat per-item records, and import decodes each state once.
//
// Layout (all little-endian, following the .tdp/CADM conventions):
//   file header (24 B)
//     u32 magic "TDSN" | u32 version | u32 flags (SNAP_FLAG_*)
//     u32 groupStride | u32 blockHeaderSize | u32 hashStride
//   block, repeated until EOF (one per model)
//     u32 marker "TBLK" | u32 blockByteLength (incl. header — skippable)
//     u32 groupLen | u32 nameLen | u32 hashCount | u32 matrixCount
//     u32 groupCount | u32 storeLen (v2; v1 wrote 0 here as `reserved`)
//     group UTF-8, name UTF-8, store UTF-8 (v2), zero-pad to 8
//     matrix table: matrixCount × 64 B (f32×16 column-major, deduped)
//     group table: groupCount × groupStride
//       u32 flags               item-state bits masked to SNAP_STATE_MASK
//       u32 colorRGBA8          override color (or base color, scope "all")
//       u32 matrixIndex         block-local table index, SNAP_NO_MATRIX = none
//       u32 hashCount           member hashes in this group
//     hashes: hashCount × hashStride (u32 lo, u32 hi), in group order —
//       FNV-1a 64 of each member item's LOWERCASED fullname
//
// Forward compatibility: readers must iterate with the header's strides /
// blockHeaderSize, so new fields append without breaking old files; semantic
// breaks bump SNAP_VERSION. Hash collisions across ≤10^6 distinct fullnames
// are ~10^-8 — accepted, no detection. Duplicate fullnames intentionally share
// one hash (state applies to every matching item).

export const SNAP_MAGIC = 0x4e534454; // "TDSN"
// v2 adds the model's STORE (plant) to each block so the same folder+name
// structure loaded from two stores round-trips unambiguously; v1 files read
// fine (their reserved word doubles as storeLen 0 → store '').
export const SNAP_VERSION = 2;
export const SNAP_BLOCK_MAGIC = 0x4b4c4254; // "TBLK"
export const SNAP_FILE_HEADER_SIZE = 24;
export const SNAP_BLOCK_HEADER_SIZE = 32;
export const SNAP_GROUP_STRIDE = 16;
export const SNAP_HASH_STRIDE = 8;
export const SNAP_NO_MATRIX = 0xffffffff;

/** Opaque white — the "unpainted" default that dominates most scenes, and the
 *  color the skip-white filters drop (on save and on load). Matched exactly,
 *  so a deliberately translucent white is still carried. */
export const SNAP_WHITE_RGBA8 = 0xffffffff;

// file-header flag bits (the last two are informational — the filters are
// already applied to the data, they just record how the file was made)
export const SNAP_FLAG_COLOR = 1 << 0;
export const SNAP_FLAG_TRANSFORM = 1 << 1;
export const SNAP_FLAG_SCOPE_ALL = 1 << 2;
export const SNAP_FLAG_SKIPPED_WHITE = 1 << 3;
export const SNAP_FLAG_SKIPPED_HIDDEN = 1 << 4;

/** The item-state bits a snapshot carries — IS_HIDDEN, HAS_COLOR_OVERRIDE,
 *  HAS_OPACITY_OVERRIDE and the bits-25-31 opacity band. Mirrors the native
 *  MeshItem layout in modeldbWorker.ts; IS_SELECTED (bit 2) is never
 *  serialized. */
export const SNAP_STATE_MASK = (1 << 0) | (1 << 4) | (1 << 6) | (0x7f << 25);

export interface SnapFileHeader {
  readonly flags: number;
  readonly groupStride: number;
  readonly blockHeaderSize: number;
  readonly hashStride: number;
}

export interface SnapBlockHeader {
  readonly blockByteLength: number;
  readonly groupLen: number;
  readonly nameLen: number;
  readonly hashCount: number;
  readonly matrixCount: number;
  readonly groupCount: number;
  /** 0 in v1 files (the word was reserved). */
  readonly storeLen: number;
}

const align8 = (n: number): number => Math.ceil(n / 8) * 8;

export function writeFileHeader(flags: number): Uint8Array {
  const out = new Uint8Array(SNAP_FILE_HEADER_SIZE);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, SNAP_MAGIC, true);
  dv.setUint32(4, SNAP_VERSION, true);
  dv.setUint32(8, flags, true);
  dv.setUint32(12, SNAP_GROUP_STRIDE, true);
  dv.setUint32(16, SNAP_BLOCK_HEADER_SIZE, true);
  dv.setUint32(20, SNAP_HASH_STRIDE, true);
  return out;
}

/** Parse + validate the 24-byte file header. Throws on a foreign or
 *  newer-versioned file (invariant of every reader below). */
export function parseFileHeader(dv: DataView): SnapFileHeader {
  if (dv.byteLength < SNAP_FILE_HEADER_SIZE || dv.getUint32(0, true) !== SNAP_MAGIC) {
    throw new Error('not a state snapshot (.tdsnap) file');
  }
  const version = dv.getUint32(4, true);
  if (version < 1 || version > SNAP_VERSION) {
    throw new Error(`unsupported snapshot version ${version} (this app reads versions 1-${SNAP_VERSION})`);
  }
  const groupStride = dv.getUint32(12, true);
  const blockHeaderSize = dv.getUint32(16, true);
  const hashStride = dv.getUint32(20, true);
  if (groupStride < SNAP_GROUP_STRIDE || blockHeaderSize < SNAP_BLOCK_HEADER_SIZE || hashStride < SNAP_HASH_STRIDE) {
    throw new Error('corrupt snapshot header');
  }
  return { flags: dv.getUint32(8, true), groupStride, blockHeaderSize, hashStride };
}

/** Parse + validate one block header at offset 0 of `dv`. */
export function parseBlockHeader(dv: DataView, header: SnapFileHeader): SnapBlockHeader {
  if (dv.byteLength < header.blockHeaderSize || dv.getUint32(0, true) !== SNAP_BLOCK_MAGIC) {
    throw new Error('corrupt snapshot (bad block marker)');
  }
  const block: SnapBlockHeader = {
    blockByteLength: dv.getUint32(4, true),
    groupLen: dv.getUint32(8, true),
    nameLen: dv.getUint32(12, true),
    hashCount: dv.getUint32(16, true),
    matrixCount: dv.getUint32(20, true),
    groupCount: dv.getUint32(24, true),
    storeLen: dv.getUint32(28, true),
  };
  const payload =
    align8(header.blockHeaderSize + block.groupLen + block.nameLen + block.storeLen) +
    block.matrixCount * 64 +
    block.groupCount * header.groupStride +
    block.hashCount * header.hashStride;
  if (block.blockByteLength !== payload) {
    throw new Error('corrupt snapshot (block length mismatch)');
  }
  return block;
}

/** Byte offset of the group table inside its block (for the pre-apply
 *  structural validation, which reads headers + group tables only). */
export function blockGroupTableOffset(header: SnapFileHeader, block: SnapBlockHeader): number {
  return align8(header.blockHeaderSize + block.groupLen + block.nameLen + block.storeLen) + block.matrixCount * 64;
}

/** Sum the per-group member counts and check them against the block's total
 *  hash count. `groupTable` is the raw group-table bytes. */
export function validateGroupCounts(groupTable: Uint8Array, header: SnapFileHeader, block: SnapBlockHeader): void {
  const dv = new DataView(groupTable.buffer, groupTable.byteOffset, groupTable.byteLength);
  let sum = 0;
  for (let g = 0; g < block.groupCount; g++) {
    sum += dv.getUint32(g * header.groupStride + 12, true);
  }
  if (sum !== block.hashCount) {
    throw new Error('corrupt snapshot (group counts mismatch)');
  }
}

/** Assemble one complete block (header + strings + matrices + groups +
 *  hashes). A block covers one model, at most a few MB — built in memory,
 *  streamed out by the caller. `groups` is groupCount × 4 u32
 *  [flags, colorRGBA8, matrixIndex, hashCount]; `hashes` is hashCount × 2 u32
 *  [lo, hi] in group order. */
export function encodeBlock(
  group: string,
  name: string,
  store: string,
  matrices: Float32Array,
  groups: Uint32Array,
  hashes: Uint32Array,
): Uint8Array {
  const enc = new TextEncoder();
  const groupBytes = enc.encode(group);
  const nameBytes = enc.encode(name);
  const storeBytes = enc.encode(store);
  const matrixCount = matrices.length / 16;
  const groupCount = groups.length / 4;
  const hashCount = hashes.length / 2;
  const stringsEnd = align8(SNAP_BLOCK_HEADER_SIZE + groupBytes.length + nameBytes.length + storeBytes.length);
  const total = stringsEnd + matrixCount * 64 + groupCount * SNAP_GROUP_STRIDE + hashCount * SNAP_HASH_STRIDE;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, SNAP_BLOCK_MAGIC, true);
  dv.setUint32(4, total, true);
  dv.setUint32(8, groupBytes.length, true);
  dv.setUint32(12, nameBytes.length, true);
  dv.setUint32(16, hashCount, true);
  dv.setUint32(20, matrixCount, true);
  dv.setUint32(24, groupCount, true);
  dv.setUint32(28, storeBytes.length, true);
  out.set(groupBytes, SNAP_BLOCK_HEADER_SIZE);
  out.set(nameBytes, SNAP_BLOCK_HEADER_SIZE + groupBytes.length);
  out.set(storeBytes, SNAP_BLOCK_HEADER_SIZE + groupBytes.length + nameBytes.length);
  out.set(new Uint8Array(matrices.buffer, matrices.byteOffset, matrixCount * 64), stringsEnd);
  out.set(new Uint8Array(groups.buffer, groups.byteOffset, groups.byteLength), stringsEnd + matrixCount * 64);
  out.set(
    new Uint8Array(hashes.buffer, hashes.byteOffset, hashes.byteLength),
    stringsEnd + matrixCount * 64 + groups.byteLength,
  );
  return out;
}

export interface SnapBlockBody {
  readonly group: string;
  readonly name: string;
  /** '' in v1 files (no store recorded). */
  readonly store: string;
  /** matrixCount × 16 f32 (a copy — safe to keep past the block buffer). */
  readonly matrices: Float32Array;
  /** Group table for stride-aware iteration (offset 0 = first group). */
  readonly groups: DataView;
  readonly groupCount: number;
  /** Hash pairs for stride-aware iteration, in group order. */
  readonly hashes: DataView;
  readonly hashCount: number;
}

/** Decode a whole block from its own buffer (byte 0 = block header). */
export function parseBlockBody(bytes: Uint8Array, header: SnapFileHeader): SnapBlockBody {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const block = parseBlockHeader(dv, header);
  const dec = new TextDecoder();
  const strings = header.blockHeaderSize;
  const group = dec.decode(bytes.subarray(strings, strings + block.groupLen));
  const name = dec.decode(bytes.subarray(strings + block.groupLen, strings + block.groupLen + block.nameLen));
  const storeAt = strings + block.groupLen + block.nameLen;
  const store = dec.decode(bytes.subarray(storeAt, storeAt + block.storeLen));
  const matricesAt = align8(strings + block.groupLen + block.nameLen + block.storeLen);
  const matrices = new Float32Array(block.matrixCount * 16);
  matrices.set(new Float32Array(bytes.buffer, bytes.byteOffset + matricesAt, block.matrixCount * 16));
  const groupsAt = matricesAt + block.matrixCount * 64;
  const hashesAt = groupsAt + block.groupCount * header.groupStride;
  return {
    group,
    name,
    store,
    matrices,
    groups: new DataView(bytes.buffer, bytes.byteOffset + groupsAt, block.groupCount * header.groupStride),
    groupCount: block.groupCount,
    hashes: new DataView(bytes.buffer, bytes.byteOffset + hashesAt, block.hashCount * header.hashStride),
    hashCount: block.hashCount,
  };
}
