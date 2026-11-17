// Scan cook sub-worker: its own wasm instance and its own read handle on the
// picked file. The coordinator (scan2tdppWorker.ts → scanParallel.ts) hands
// it work — E57: ranges of record blocks to measure and count, then whole
// batches to build; LGSX: runs of octree nodes to re-encode — and every
// result goes back as transferred bytes. Nothing here writes the output.
import * as Comlink from 'comlink';
import { inputIo } from './scanShared';
import init, { E57Part, LgsxPart } from './wasm/scan_wasm.js';

const ready = init();
let part: E57Part | null = null;
let lgsx: LgsxPart | null = null;

function need(): E57Part {
  if (!part) {
    throw new Error('scan part worker used before init');
  }
  return part;
}

const give = (bytes: Uint8Array) => Comlink.transfer(bytes, [bytes.buffer]);

const api = {
  /** Startup handshake for spawnComlinkWorker. */
  ping: () => true,

  /** `tables` = the packet tables the coordinator walked (once, for everyone). */
  async init(file: File, tables: Uint8Array, optionsJson: string): Promise<void> {
    await ready;
    part = new E57Part({ ...inputIo(file), write: () => undefined, progress: () => undefined }, tables, optionsJson);
  },

  async initLgsx(file: File, optionsJson: string): Promise<void> {
    await ready;
    lgsx = new LgsxPart({ ...inputIo(file), write: () => undefined, progress: () => undefined }, optionsJson);
  },

  /** LGSX: octree nodes [i0, i1), encoded. */
  nodes(i0: number, i1: number) {
    if (!lgsx) {
      throw new Error('scan part worker used before initLgsx');
    }
    return give(lgsx.nodes(i0, i1));
  },

  /** Bounds of blocks [i0, i1). */
  stats: (i0: number, i1: number) => give(need().stats(i0, i1)),

  /** Point counts of blocks [i0, i1) on the grid the merged `stats` define. */
  counts: (stats: Uint8Array, i0: number, i1: number) => give(need().counts(stats, i0, i1)),

  setPlan(plan: Uint8Array): void {
    need().set_plan(plan);
  },

  /** Build one batch: its encoded nodes and chunk roots. */
  batch: (index: number) => give(need().batch(index)),
};

export type ScanPartApi = typeof api;
Comlink.expose(api);
