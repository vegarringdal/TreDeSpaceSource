// Scan cooks fanned out over sub-workers (scanPartWorker.ts), driven from
// the coordinator worker. The wasm session (E57Cook / LgsxCook) owns the
// output and the merging; this file is the hand-out loop between its stages.
//
// E57:  1. bounds  — workers take ranges of record blocks;
//       2. counts  — the same, on the grid the bounds define;
//       3. batches — each worker builds whole batches (decode + LOD + encode).
//          The packet headers are walked once, by the coordinator, and shared.
// LGSX: runs of octree nodes — each worker decodes and re-encodes a run.
//
// Batches and node runs are written strictly in order, so the file is
// byte-identical whatever the worker count or timing.
import type * as Comlink from 'comlink';
import { type SpawnedWorker, spawnComlinkWorkers } from '../worker/spawnComlinkWorker';
import type { ScanPartApi } from './scanPartWorker';
import { E57Cook, LgsxCook } from './wasm/scan_wasm.js';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type Part = SpawnedWorker<ScanPartApi, Worker>;
type PartApi = Comlink.Remote<ScanPartApi>;

/** The sub-workers could not be started — the caller cooks in-process instead. */
export class PartsUnavailable extends Error {}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** Record blocks (2²⁰ points each) handed to a worker per call. */
const BLOCK_STEP = 4;
/** Octree nodes per run of an LGSX cook (a node holds up to ~300 k points). */
const NODE_STEP = 4;
/** Units (batches, node runs) the workers may run ahead of the one being
 *  written, per worker — bounds what waits in memory when an early one is slow. */
const AHEAD_PER_WORKER = 2;
const GATE_MS = 25;

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

/** A Comlink call never rejects when its worker crashes; race it against the
 *  worker's error event so a wasm trap surfaces instead of hanging. */
function guarded<T>(part: Part, call: Promise<T>): Promise<T> {
  const died = new Promise<never>((_, reject) => {
    part.worker.addEventListener('error', (e) => reject(new Error(e.message || 'scan part worker crashed')));
  });
  return Promise.race([call, died]);
}

const pause = () => new Promise<void>((resolve) => setTimeout(resolve, GATE_MS));

/** Run `work` over every block, workers pulling ranges as they free up. */
async function overBlocks(
  parts: readonly Part[],
  blocks: number,
  work: (api: PartApi, i0: number, i1: number) => Promise<Uint8Array>,
  merge: (bytes: Uint8Array) => void,
  onDone: (fraction: number) => void,
): Promise<void> {
  let next = 0;
  let done = 0;
  await Promise.all(
    parts.map(async (p) => {
      while (next < blocks) {
        const i0 = next;
        const i1 = Math.min(blocks, i0 + BLOCK_STEP);
        next = i1;
        merge(await guarded(p, work(p.api, i0, i1)));
        done += i1 - i0;
        onDone(done / blocks);
      }
    }),
  );
}

/** Run `work` for units 0..total on the workers and `commit` the results
 *  strictly in unit order. */
async function inOrder(
  parts: readonly Part[],
  total: number,
  work: (api: PartApi, index: number) => Promise<Uint8Array>,
  commit: (index: number, bytes: Uint8Array) => void,
  onDone: (written: number) => void,
): Promise<void> {
  const waiting = new Map<number, Uint8Array>();
  let next = 0;
  let written = 0;
  await Promise.all(
    parts.map(async (p) => {
      while (next < total) {
        if (next - written >= parts.length * AHEAD_PER_WORKER) {
          await pause();
          continue;
        }
        const index = next++;
        waiting.set(index, await guarded(p, work(p.api, index)));
        for (let bytes = waiting.get(written); bytes; bytes = waiting.get(written)) {
          commit(written, bytes);
          waiting.delete(written);
          written++;
          onDone(written);
        }
      }
    }),
  );
}

async function spawnParts(workers: number): Promise<Part[]> {
  const spawned = await spawnComlinkWorkers<ScanPartApi>(
    workers,
    () => new Worker(new URL('./scanPartWorker.ts', import.meta.url), { type: 'module' }),
    'scan part',
  );
  if (!spawned.data) {
    throw new PartsUnavailable(spawned.error?.msg ?? 'scan part workers failed to start');
  }
  return spawned.data;
}

const onWorkers = (n: number) => `on ${n} worker${n === 1 ? '' : 's'}`;

/**
 * Cook an LGSX over `workers` sub-workers through `io` (the output side).
 * Returns the wasm's JSON report. Throws PartsUnavailable — before anything
 * is written — when the sub-workers cannot start.
 */
export async function cookLgsxParallel(
  file: File,
  io: object,
  optionsJson: string,
  workers: number,
  onProgress: (message: string) => void,
): Promise<string> {
  const parts = await spawnParts(workers);
  let session: LgsxCook | null = null;
  try {
    onProgress('Opening the scan…');
    await Promise.all(parts.map((p) => guarded(p, p.api.initLgsx(file, optionsJson))));
    session = new LgsxCook(io, optionsJson);
    const cook = session;
    const nodes = cook.nodes();
    const first = (run: number) => run * NODE_STEP;
    await inOrder(
      parts,
      Math.ceil(nodes / NODE_STEP),
      (api, run) => api.nodes(first(run), Math.min(nodes, first(run + 1))),
      (run, bytes) => cook.add_nodes(first(run), bytes),
      (written) =>
        onProgress(`Converted ${Math.min(nodes, first(written))} of ${nodes} nodes ${onWorkers(parts.length)}`),
    );
    onProgress('Writing the photos…');
    return cook.finish();
  } finally {
    for (const p of parts) {
      p.worker.terminate();
    }
    session?.free();
  }
}

/**
 * Cook an E57 over `workers` sub-workers through `io`; see cookLgsxParallel.
 */
export async function cookE57Parallel(
  file: File,
  io: object,
  optionsJson: string,
  workers: number,
  onProgress: (message: string) => void,
): Promise<string> {
  const parts = await spawnParts(workers);
  const on = onWorkers(parts.length);
  let session: E57Cook | null = null;
  try {
    onProgress('Indexing the file…');
    session = new E57Cook(io, optionsJson);
    const cook = session;
    const tables = cook.tables();
    await Promise.all(parts.map((p) => guarded(p, p.api.init(file, tables, optionsJson))));
    const blocks = cook.blocks();
    const pct = (f: number) => `${Math.round(f * 100)}%`;
    await overBlocks(
      parts,
      blocks,
      (api, i0, i1) => api.stats(i0, i1),
      (bytes) => cook.add_stats(bytes),
      (f) => onProgress(`Measuring ${pct(f)} ${on}`),
    );
    const stats = cook.stats();
    await overBlocks(
      parts,
      blocks,
      (api, i0, i1) => api.counts(stats, i0, i1),
      (bytes) => cook.add_counts(bytes),
      (f) => onProgress(`Counting ${pct(f)} ${on}`),
    );
    const plan = cook.plan();
    await Promise.all(parts.map((p) => guarded(p, p.api.setPlan(plan))));
    const batches = cook.batches();
    await inOrder(
      parts,
      batches,
      (api, index) => api.batch(index),
      (index, bytes) => cook.add_batch(index, bytes),
      (written) => onProgress(`Built ${written} of ${batches} batches ${on}`),
    );
    onProgress('Writing the upper levels and the photos…');
    return cook.finish();
  } finally {
    for (const p of parts) {
      p.worker.terminate();
    }
    session?.free();
  }
}
