// -----------------------------------------------------------------------------
// state snapshot (.tdsnap)
// -----------------------------------------------------------------------------
// Save streams one block per live model into OPFS; apply is REPLACE-semantics
// per channel and resets the affected undo domains (snapshotting prev-state of
// every item could blow the 64 MB undo caps).
import { createFnv64Scratch, fnv1a64 } from '../hash/fnv64';
import { opfsOpenByteStream } from '../opfs/opfsSyncWrite';
import {
  blockGroupTableOffset,
  encodeBlock,
  parseBlockBody,
  parseBlockHeader,
  parseFileHeader,
  SNAP_BLOCK_HEADER_SIZE,
  SNAP_FILE_HEADER_SIZE,
  SNAP_FLAG_COLOR,
  SNAP_FLAG_SCOPE_ALL,
  SNAP_FLAG_SKIPPED_HIDDEN,
  SNAP_FLAG_SKIPPED_WHITE,
  SNAP_FLAG_TRANSFORM,
  SNAP_NO_MATRIX,
  SNAP_STATE_MASK,
  SNAP_WHITE_RGBA8,
  validateGroupCounts,
  writeFileHeader,
} from '../snapshot/snapshotFormat';
import { resetTransformUndo } from './apiTransform';
import { resetColorUndo } from './colorUndo';
import { type DbModel, HAS_COLOR_OVERRIDE, IS_HIDDEN, models, NO_PARENT, type StateUpdate } from './dbState';
import { ensureNames, packStates } from './hierarchyIndex';
import {
  allocTransformSlot,
  resetTransformPool,
  TRANSFORM_POOL,
  transforms,
  transformsSnapshot,
} from './transformPool';

const hashScratch = createFnv64Scratch();
const hashPair = new Uint32Array(2);

/** Build (lazily, cached — names never change after load) the fullname-hash →
 *  dense-items index for snapshot import. Items sharing a fullname (duplicate
 *  names, multi-item leaves) share a bucket: one record applies to all. */
function ensureItemHashes(m: DbModel): Map<number, { hi: number; items: number[] }[]> {
  if (m.hashIndex) {
    return m.hashIndex;
  }
  const names = ensureNames(m);
  const idx = new Map<number, { hi: number; items: number[] }[]>();
  for (let i = 0; i < m.itemCount; i++) {
    const e = m.itemToEntry[i];
    if (e === NO_PARENT) {
      continue;
    }
    fnv1a64(names[e], hashScratch, hashPair, 0);
    const lo = hashPair[0];
    const hi = hashPair[1];
    let buckets = idx.get(lo);
    if (!buckets) {
      buckets = [];
      idx.set(lo, buckets);
    }
    const bucket = buckets.find((b) => b.hi === hi);
    if (bucket) {
      bucket.items.push(i);
    } else {
      buckets.push({ hi, items: [i] });
    }
  }
  m.hashIndex = idx;
  return idx;
}

export interface SnapshotSaveOptions {
  /** OPFS-root-relative output path (e.g. `temp/export/state.tdsnap`). */
  opfsOut: string;
  /** `all` = every mapped item's effective state (base color included);
   *  `modified` = only items with an override / hidden flag / transform. */
  scope: 'all' | 'modified';
  color: boolean;
  transform: boolean;
  /** Drop opaque-white colors — the unpainted default that dominates most
   *  scenes. An item left with nothing else is not written at all. */
  skipWhite: boolean;
  /** Drop the hidden flag, so the snapshot never hides anything on load. */
  skipHidden: boolean;
  /** Save only models loaded from this store ('' / undefined = every store). */
  store?: string;
}

/** The snapshot state an item contributes, or null when it carries nothing
 *  worth writing (unmapped, filtered out by scope, or emptied by the
 *  skip-white / skip-hidden filters). `slot` is the raw transform-pool slot;
 *  the caller maps it into the block-local matrix table. */
function snapshotItemState(
  m: DbModel,
  i: number,
  opts: SnapshotSaveOptions,
): { flags: number; color: number; slot: number } | null {
  if (m.itemToEntry[i] === NO_PARENT) {
    return null;
  }
  const raw = m.states[i * 2] & SNAP_STATE_MASK;
  const slot = opts.transform ? m.tidx[i] : 0;
  if (opts.scope !== 'all' && !(opts.color && raw !== 0) && slot === 0) {
    return null;
  }
  let flags = 0;
  let color = 0;
  if (opts.color) {
    flags = opts.skipHidden ? raw & ~IS_HIDDEN : raw;
    // the color word only means something with an override; scope "all" also
    // records the untouched base color so it can repaint another dataset
    if (flags & HAS_COLOR_OVERRIDE || opts.scope === 'all') {
      color = flags & HAS_COLOR_OVERRIDE ? m.states[i * 2 + 1] : m.baseColor[i];
      if (opts.skipWhite && color === SNAP_WHITE_RGBA8) {
        flags &= ~HAS_COLOR_OVERRIDE;
        color = 0;
      }
    }
  }
  if (flags === 0 && color === 0 && slot === 0) {
    return null;
  }
  return { flags, color, slot };
}

/** Encode one model's snapshot block, or null when no item qualifies.
 *  Items are bucketed by their distinct (flags, color, matrixIndex) state —
 *  a coloring rule gives thousands of items the same tuple, so members cost
 *  only their 8-byte hash. One pass assigns group ids and hashes; a prefix
 *  sum then scatters the hashes into group order. */
function buildSnapshotBlock(m: DbModel, opts: SnapshotSaveOptions): { bytes: Uint8Array; records: number } | null {
  const names = ensureNames(m);
  let count = 0;
  for (let i = 0; i < m.itemCount; i++) {
    if (snapshotItemState(m, i, opts)) {
      count++;
    }
  }
  if (count === 0) {
    return null;
  }
  const slotToIndex = new Map<number, number>();
  const matrixSlots: number[] = [];
  const keyToGroup = new Map<string, number>();
  const groupStates: number[] = []; // 3 words per group [flags, color, midx]
  const groupSizes: number[] = [];
  const itemGroup = new Uint32Array(count);
  const itemHashes = new Uint32Array(count * 2); // in item order for now
  let k = 0;
  for (let i = 0; i < m.itemCount; i++) {
    const st = snapshotItemState(m, i, opts);
    if (!st) {
      continue;
    }
    fnv1a64(names[m.itemToEntry[i]], hashScratch, hashPair, 0);
    itemHashes[k * 2] = hashPair[0];
    itemHashes[k * 2 + 1] = hashPair[1];
    const { flags, color, slot } = st;
    let midx = SNAP_NO_MATRIX;
    if (slot !== 0) {
      const existing = slotToIndex.get(slot);
      if (existing !== undefined) {
        midx = existing;
      } else {
        midx = matrixSlots.length;
        slotToIndex.set(slot, midx);
        matrixSlots.push(slot);
      }
    }
    const key = `${flags},${color},${midx}`;
    let g = keyToGroup.get(key);
    if (g === undefined) {
      g = groupSizes.length;
      keyToGroup.set(key, g);
      groupStates.push(flags, color, midx);
      groupSizes.push(0);
    }
    groupSizes[g]++;
    itemGroup[k] = g;
    k++;
  }
  // group table + hash area scattered into group order via a prefix sum
  const groups = new Uint32Array(groupSizes.length * 4);
  const cursor = new Uint32Array(groupSizes.length);
  let running = 0;
  for (let g = 0; g < groupSizes.length; g++) {
    groups[g * 4] = groupStates[g * 3];
    groups[g * 4 + 1] = groupStates[g * 3 + 1];
    groups[g * 4 + 2] = groupStates[g * 3 + 2];
    groups[g * 4 + 3] = groupSizes[g];
    cursor[g] = running;
    running += groupSizes[g];
  }
  const hashes = new Uint32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const dst = cursor[itemGroup[i]]++;
    hashes[dst * 2] = itemHashes[i * 2];
    hashes[dst * 2 + 1] = itemHashes[i * 2 + 1];
  }
  const matrices = new Float32Array(matrixSlots.length * 16);
  matrixSlots.forEach((slot, mi) => {
    matrices.set(transforms.subarray(slot * 16, slot * 16 + 16), mi * 16);
  });
  return { bytes: encodeBlock(m.group, m.name, m.store, matrices, groups, hashes), records: count };
}

export interface SnapshotApplyResult {
  updates: StateUpdate[];
  /** Transform pool for renderer.writeTransforms — null when transforms were
   *  not applied (pool unchanged). */
  transforms: Float32Array | null;
  blocksTotal: number;
  blocksMatched: number;
  skippedModels: { group: string; name: string; store: string }[];
  recordsApplied: number;
  recordsUnmatched: number;
  /** Channels actually applied = user choice ∩ channels present in the file. */
  appliedColor: boolean;
  appliedTransform: boolean;
  /** The file needed more than the pool's 4095 distinct matrices; overflowing
   *  items were left at identity. */
  poolExhausted: boolean;
}

export const snapshotApi = {
  /** Stream the current per-item state of every live model into one .tdsnap
   *  file in OPFS (one block per model — bounded memory at any scene size). */
  async saveSnapshot(
    opts: SnapshotSaveOptions,
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ models: number; records: number; size: number }> {
    const flags =
      (opts.color ? SNAP_FLAG_COLOR : 0) |
      (opts.transform ? SNAP_FLAG_TRANSFORM : 0) |
      (opts.scope === 'all' ? SNAP_FLAG_SCOPE_ALL : 0) |
      (opts.skipWhite ? SNAP_FLAG_SKIPPED_WHITE : 0) |
      (opts.skipHidden ? SNAP_FLAG_SKIPPED_HIDDEN : 0);
    const out = await opfsOpenByteStream(opts.opfsOut);
    let blocks = 0;
    let records = 0;
    try {
      out.write(writeFileHeader(flags));
      const live = models.filter((m) => !m.removed && (!opts.store || m.store === opts.store));
      for (let k = 0; k < live.length; k++) {
        onProgress?.(k, live.length);
        const block = buildSnapshotBlock(live[k], opts);
        if (block) {
          out.write(block.bytes);
          blocks++;
          records += block.records;
        }
        // let queued picking/selection calls interleave between models
        await new Promise((r) => setTimeout(r));
      }
      onProgress?.(live.length, live.length);
      return { models: blocks, records, size: out.close() };
    } catch (e) {
      out.abort();
      throw e;
    }
  },

  /** Apply a .tdsnap file, block-at-a-time (peak memory = one block).
   *  REPLACE semantics per channel: the channels being applied are first
   *  cleared on EVERY live model, and their undo stacks reset (snapshotting
   *  prev-state of every item could blow the 64 MB undo caps). The file is
   *  structurally validated up front so a corrupt file mutates nothing. */
  async applySnapshot(
    file: File,
    apply: {
      color: boolean;
      transform: boolean;
      skipWhite: boolean;
      skipHidden: boolean;
      /** Apply only onto models of this store ('' / undefined = every store)
       *  — other stores' models are neither cleared nor written. */
      store?: string;
    },
    onProgress?: (bytesDone: number, bytesTotal: number) => void,
  ): Promise<SnapshotApplyResult> {
    const header = parseFileHeader(new DataView(await file.slice(0, SNAP_FILE_HEADER_SIZE).arrayBuffer()));
    const applyColor = apply.color && (header.flags & SNAP_FLAG_COLOR) !== 0;
    const applyTransform = apply.transform && (header.flags & SNAP_FLAG_TRANSFORM) !== 0;

    const dec = new TextDecoder();
    const blockSpans: { offset: number; length: number; group: string; name: string; store: string }[] = [];
    for (let offset = SNAP_FILE_HEADER_SIZE; offset < file.size; ) {
      if (offset + SNAP_BLOCK_HEADER_SIZE > file.size) {
        throw new Error('corrupt snapshot (truncated block header)');
      }
      const bh = parseBlockHeader(
        new DataView(await file.slice(offset, offset + header.blockHeaderSize).arrayBuffer()),
        header,
      );
      if (offset + bh.blockByteLength > file.size) {
        throw new Error('corrupt snapshot (truncated block)');
      }
      // group counts must sum to the hash count BEFORE anything is mutated
      const gtAt = offset + blockGroupTableOffset(header, bh);
      validateGroupCounts(
        new Uint8Array(await file.slice(gtAt, gtAt + bh.groupCount * header.groupStride).arrayBuffer()),
        header,
        bh,
      );
      // block identity (group/name/store), for the model matching below
      const strAt = offset + header.blockHeaderSize;
      const strBytes = new Uint8Array(
        await file.slice(strAt, strAt + bh.groupLen + bh.nameLen + bh.storeLen).arrayBuffer(),
      );
      blockSpans.push({
        offset,
        length: bh.blockByteLength,
        group: dec.decode(strBytes.subarray(0, bh.groupLen)),
        name: dec.decode(strBytes.subarray(bh.groupLen, bh.groupLen + bh.nameLen)),
        store: dec.decode(strBytes.subarray(bh.groupLen + bh.nameLen)),
      });
      offset += bh.blockByteLength;
    }

    // Match blocks to live models BEFORE mutating anything. Pass 1 matches
    // exactly (store + group + name); pass 2 rescues the rest by group+name
    // among still-unclaimed in-scope models — that covers v1 files (store '')
    // and deliberate retargeting (apply a plant's snapshot onto another store
    // by scoping the apply to it).
    const inScope = (m: DbModel): boolean => !m.removed && (!apply.store || m.store === apply.store);
    const claimed = new Set<number>();
    const targets = blockSpans.map((sp) => {
      const i = models.findIndex(
        (x, k) => inScope(x) && !claimed.has(k) && x.store === sp.store && x.group === sp.group && x.name === sp.name,
      );
      if (i >= 0) {
        claimed.add(i);
      }
      return i;
    });
    blockSpans.forEach((sp, b) => {
      if (targets[b] >= 0) {
        return;
      }
      const i = models.findIndex((x, k) => inScope(x) && !claimed.has(k) && x.group === sp.group && x.name === sp.name);
      if (i >= 0) {
        claimed.add(i);
        targets[b] = i;
      }
    });

    const result: SnapshotApplyResult = {
      updates: [],
      transforms: null,
      blocksTotal: blockSpans.length,
      blocksMatched: 0,
      skippedModels: [],
      recordsApplied: 0,
      recordsUnmatched: 0,
      appliedColor: applyColor,
      appliedTransform: applyTransform,
      poolExhausted: false,
    };
    if (!applyColor && !applyTransform) {
      return result;
    }

    // REPLACE-clear the applied channels on every model IN SCOPE
    for (const m of models) {
      if (!inScope(m)) {
        continue;
      }
      if (applyColor) {
        for (let i = 0; i < m.itemCount; i++) {
          m.states[i * 2] &= ~SNAP_STATE_MASK;
        }
      }
      if (applyTransform) {
        m.tidx.fill(0);
      }
    }
    if (applyColor) {
      resetColorUndo();
    }
    if (applyTransform) {
      resetTransformUndo();
      if (!apply.store) {
        // every tidx is now 0 → restart the allocator: the import gets the
        // full pool and can never wrap onto slots it allocated itself
        resetTransformPool();
      }
      // store-scoped: models OUTSIDE the scope keep their live pool slots, so
      // the allocator must keep running — the import draws fresh slots from
      // the remaining pool instead
    }

    let poolAllocs = 0;
    const matrixKeyToSlot = new Map<string, number>();
    for (let b = 0; b < blockSpans.length; b++) {
      const span = blockSpans[b];
      onProgress?.(span.offset + span.length, file.size);
      const m = targets[b] >= 0 ? models[targets[b]] : undefined;
      if (!m) {
        result.skippedModels.push({ group: span.group, name: span.name, store: span.store });
        continue;
      }
      const bytes = new Uint8Array(await file.slice(span.offset, span.offset + span.length).arrayBuffer());
      const body = parseBlockBody(bytes, header);
      result.blocksMatched++;
      const idx = ensureItemHashes(m);

      // resolve the block's matrix table to pool slots (deduped across blocks)
      let slotForMidx: Uint32Array | null = null;
      if (applyTransform && body.matrices.length > 0) {
        const mu32 = new Uint32Array(body.matrices.buffer, body.matrices.byteOffset, body.matrices.length);
        const nMat = body.matrices.length / 16;
        slotForMidx = new Uint32Array(nMat);
        for (let k = 0; k < nMat; k++) {
          const key = mu32.subarray(k * 16, k * 16 + 16).join(',');
          const existing = matrixKeyToSlot.get(key);
          if (existing !== undefined) {
            slotForMidx[k] = existing;
            continue;
          }
          if (poolAllocs >= TRANSFORM_POOL - 1) {
            result.poolExhausted = true;
            continue; // slot stays 0 = identity
          }
          const slot = allocTransformSlot();
          poolAllocs++;
          transforms.set(body.matrices.subarray(k * 16, k * 16 + 16), slot * 16);
          matrixKeyToSlot.set(key, slot);
          slotForMidx[k] = slot;
        }
      }

      // per group: decode the shared state once, then apply it to each member
      const gdv = body.groups;
      const hdv = body.hashes;
      let hashPos = 0;
      for (let g = 0; g < body.groupCount; g++) {
        const gAt = g * header.groupStride;
        const recColor = gdv.getUint32(gAt + 4, true);
        // the load-side filters run ONCE per group, not per member item
        let recFlags = gdv.getUint32(gAt, true);
        if (apply.skipHidden) {
          recFlags &= ~IS_HIDDEN;
        }
        if (apply.skipWhite && recFlags & HAS_COLOR_OVERRIDE && recColor === SNAP_WHITE_RGBA8) {
          recFlags &= ~HAS_COLOR_OVERRIDE;
        }
        const midx = gdv.getUint32(gAt + 8, true);
        const memberCount = gdv.getUint32(gAt + 12, true);
        const slot = slotForMidx && midx !== SNAP_NO_MATRIX && midx < slotForMidx.length ? slotForMidx[midx] : 0;
        for (let r = 0; r < memberCount; r++, hashPos++) {
          const at = hashPos * header.hashStride;
          const buckets = idx.get(hdv.getUint32(at, true));
          const hi = hdv.getUint32(at + 4, true);
          const bucket = buckets?.find((b) => b.hi === hi);
          if (!bucket) {
            result.recordsUnmatched++;
            continue;
          }
          for (const it of bucket.items) {
            if (applyColor) {
              m.states[it * 2] = (m.states[it * 2] & ~SNAP_STATE_MASK) | (recFlags & SNAP_STATE_MASK);
              if (recFlags & HAS_COLOR_OVERRIDE) {
                m.states[it * 2 + 1] = recColor;
              }
            }
            if (slot !== 0) {
              m.tidx[it] = slot;
            }
          }
          result.recordsApplied++;
        }
      }
    }

    // every live model was REPLACE-cleared → every one needs a GPU re-upload
    models.forEach((m, i) => {
      if (!m.removed) {
        result.updates.push(packStates(m, i));
      }
    });
    result.transforms = applyTransform ? transformsSnapshot() : null;
    return result;
  },
};
