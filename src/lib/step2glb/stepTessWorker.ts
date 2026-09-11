// Tessellation sub-worker for the STEP import (spawned by step2glbWorker.ts).
// Opens read-only sync handles on the staged input and on the index file the
// coordinator streamed out (index.bin), rebuilds the file's index from that
// file in bounded pieces (no second pass over the STEP, no copy of the index
// in memory), then tessellates the product batches the coordinator hands it —
// each result appended as a record to cache-<slot>.bin. It never runs the
// assembly walk or the cooker: the coordinator reads the records back for
// those, so this worker's heap is the index table plus one product.
import * as Comlink from 'comlink';
import {
  cacheName,
  INDEX_NAME,
  notHere,
  openSync,
  PHASE_FACES_CODE,
  readRange,
  ScratchFile,
  STEP_INPUT_NAME,
  type StepOptions,
  type SyncHandle,
  stepTempDir,
} from './stepShared';
import init, { StepSession } from './wasm/step_wasm.js';

const ready = init();

interface Open {
  session: StepSession;
  input: SyncHandle;
  cache: ScratchFile;
}

let open: Open | null = null;

function opened(): Open {
  if (!open) {
    throw new Error('step tessellation worker: init() first');
  }
  return open;
}

const api = {
  /** Open the staged input and rebuild its index from index.bin;
   *  `onFaces(done)` reports this worker's running face count (the
   *  coordinator sums them). */
  async init(slot: number, opts: StepOptions, onFaces: (done: number) => void): Promise<void> {
    await ready;
    const dir = await stepTempDir();
    const input = await openSync(dir, STEP_INPUT_NAME, { readOnly: true });
    const index = await openSync(dir, INDEX_NAME, { readOnly: true });
    const cache = new ScratchFile(await openSync(dir, cacheName(slot), { create: true }));
    const io = {
      size: () => input.getSize(),
      read: (offset: number, len: number) => readRange(input, offset, len),
      indexSize: () => index.getSize(),
      readIndex: (offset: number, len: number) => readRange(index, offset, len),
      writeTemp: (offset: number, bytes: Uint8Array) => cache.writeAt(offset, bytes),
      readTemp: (offset: number, len: number) => cache.readAt(offset, len),
      tempLen: () => cache.length,
      readSlot: () => notHere('readSlot'),
      open: () => notHere('open'),
      write: () => notHere('write'),
      close: () => notHere('close'),
      progress: (phase: number, done: number) => {
        if (phase === PHASE_FACES_CODE) {
          onFaces(done);
        }
      },
    };
    try {
      // y_up=true (STEP Z-up → glTF Y-up), keep_normals=false (flatshaded app)
      const session = StepSession.fromIndexFile(io, opts.deflectionMm, opts.maxAngleDeg, true, false, opts.cleanup);
      open = { session, input, cache };
    } finally {
      // the index is parsed into the table once; the file is not needed again
      index.close();
    }
  },

  /** Tessellate one batch; returns `[key, offset, len]` triples into this
   *  worker's cache file. */
  tessellate(keys: Uint32Array): Float64Array {
    const table = opened().session.tessellate(keys);
    return Comlink.transfer(table, [table.buffer]);
  },

  /** Flush the cache file and hand back this worker's tally (wire text). */
  finish(): string {
    const { session, input, cache } = opened();
    const stats = session.statsWire();
    session.free();
    cache.close();
    input.close();
    open = null;
    return stats;
  },
};

export type StepTessApi = typeof api;
Comlink.expose(api);
