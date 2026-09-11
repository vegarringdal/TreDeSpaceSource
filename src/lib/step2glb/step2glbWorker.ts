// STEP → cooked .tdp coordinator worker, via the prebuilt step wasm (./wasm).
// Phase 1 of the STEP import: the main thread stages the picked file into OPFS
// temp/step-import/, and this worker drives a `StepSession` over sync access
// handles so the file is never held in wasm memory:
//   1. index    — the wasm scans the input by range (progress = bytes).
//   2. faces    — tessellation, fanned out over up to 5 sub-workers
//                 (stepTessWorker.ts). This worker streams its index to
//                 index.bin once; each sub-worker reads it by range into its
//                 own table (no re-scan, no in-memory copy of the index),
//                 opens the same STEP through a read-only handle and appends
//                 its results to cache-<k>.bin; the coordinator hands out
//                 product batches dynamically (32 down to 1 as the queue
//                 drains) and sums their face counts. If a sub-worker cannot
//                 start (old Chrome without shared read-only handles, out of
//                 memory) the session tessellates in-process instead.
//   3. products — the assembly walk places every instance, reading the
//                 records back and spilling the world-baked buckets to
//                 spill.bin, so the heap holds one product at a time.
//   4. cook / write — the index is dropped, the cooker gets the heap, and the
//                 `.tdp` (+ `.coarse.tdp`, derived from the cooked bytes) is
//                 written straight to the temp dir through pre-opened handles.
// The converter cooks the merged model itself: no GLB is built, serialised or
// parsed anywhere on this path.
import * as Comlink from 'comlink';
import {
  cacheName,
  INDEX_NAME,
  openSync,
  phaseFromCode,
  readRange,
  ScratchFile,
  SPILL_NAME,
  STEP_INPUT_NAME,
  type StepOptions,
  type StepProgress,
  type SyncHandle,
  stepTempDir,
} from './stepShared';
import type { StepTessApi } from './stepTessWorker';
import init, { StepSession } from './wasm/step_wasm.js';

export type { StepOptions, StepProgress } from './stepShared';

const ready = init();

/** Hard cap on tessellation sub-workers (the option's range is 0–5). */
const MAX_WORKERS = 5;
/** Sub-workers when the option is missing (an older saved settings blob). */
const DEFAULT_WORKERS = 2;
/** Batch sizing: hand out `remaining / (workers * BATCH_DIVISOR)` jobs at a
 *  time (capped), so batches shrink towards the end and a late giant product
 *  stalls one worker, not the whole run. */
const BATCH_DIVISOR = 8;
const MAX_BATCH = 32;
/** Separator between the sub-workers' stats blobs: ASCII record separator
 *  (0x1e), which the wasm splits on. */
const STATS_SEPARATOR = String.fromCharCode(0x1e);
const PHASE_FACES = 1;

interface OutputFile {
  name: string;
  handle: SyncHandle;
  size: number;
  /** Closed early (the index, once the sub-workers can read it). */
  closed: boolean;
}

interface RecordTable {
  keys: number[];
  slots: number[];
  offsets: number[];
  lens: number[];
}

const emptyTable = (): RecordTable => ({ keys: [], slots: [], offsets: [], lens: [] });

/** How many tessellation sub-workers to spawn: the user's setting, clamped
 *  to the cap and to the number of work units (one product per worker at
 *  least, or the fan-out is pure overhead). */
function pickWorkerCount(jobs: number, requested: number): number {
  const wanted = Number.isFinite(requested) ? Math.floor(requested) : DEFAULT_WORKERS;
  const k = Math.min(MAX_WORKERS, Math.max(0, wanted), jobs);
  return jobs < 2 ? 0 : k;
}

/** A Comlink call never rejects when its worker crashes; race it against the
 *  worker's error event so a wasm trap surfaces instead of hanging. */
function withCrash<T>(worker: Worker, call: Promise<T>): Promise<T> {
  const died = new Promise<never>((_, reject) => {
    worker.addEventListener('error', (e) => reject(new Error(e.message || 'step tessellation worker crashed')));
  });
  return Promise.race([call, died]);
}

/** Run the tessellation jobs over `k` sub-workers; returns their record table
 *  and stats blobs. Throws if any worker fails — the caller falls back. */
async function fanOut(
  k: number,
  jobs: Uint32Array,
  opts: StepOptions,
  onFaces: (done: number, busy: number) => void,
): Promise<{ table: RecordTable; stats: string[] }> {
  const workers = Array.from(
    { length: k },
    () => new Worker(new URL('./stepTessWorker.ts', import.meta.url), { type: 'module' }),
  );
  const apis = workers.map((w) => Comlink.wrap<StepTessApi>(w));
  const facesByWorker = new Array<number>(k).fill(0);
  const table = emptyTable();
  let next = 0;
  let busy = 0;
  const facesDone = () => facesByWorker.reduce((a, b) => a + b, 0);
  const takeBatch = (): Uint32Array => {
    const remaining = jobs.length - next;
    const size = Math.min(MAX_BATCH, Math.max(1, Math.ceil(remaining / (k * BATCH_DIVISOR))));
    const batch = jobs.slice(next, next + size);
    next += size;
    return batch;
  };
  try {
    await Promise.all(
      apis.map((api, i) =>
        withCrash(
          workers[i],
          api.init(
            i,
            opts,
            Comlink.proxy((done: number) => {
              facesByWorker[i] = done;
              onFaces(facesDone(), busy);
            }),
          ),
        ),
      ),
    );
    await Promise.all(
      apis.map(async (api, i) => {
        while (next < jobs.length) {
          const batch = takeBatch();
          busy++;
          const rows = await withCrash(workers[i], api.tessellate(Comlink.transfer(batch, [batch.buffer])));
          busy--;
          onFaces(facesDone(), busy);
          for (let r = 0; r + 2 < rows.length; r += 3) {
            table.keys.push(rows[r]);
            table.slots.push(i);
            table.offsets.push(rows[r + 1]);
            table.lens.push(rows[r + 2]);
          }
        }
      }),
    );
    const stats = await Promise.all(apis.map((api, i) => withCrash(workers[i], api.finish())));
    return { table, stats };
  } finally {
    for (const w of workers) {
      w.terminate();
    }
  }
}

const api = {
  /** Convert temp/step-import/input.step → `<stem>.tdp` + `<stem>.coarse.tdp`
   *  in the same dir. `onProgress` fires per phase (see `StepProgress`).
   *  Returns the files written and the JSON diagnostics report. */
  async convert(
    sourceName: string,
    opts: StepOptions,
    onProgress: (p: StepProgress) => void,
  ): Promise<{ files: { name: string; size: number }[]; info: string }> {
    await ready;
    const dir = await stepTempDir();
    const stem = sourceName.replace(/\.(step|stp)$/i, '');
    const outputs: OutputFile[] = [];
    for (const name of [INDEX_NAME, `${stem}.tdp`, `${stem}.coarse.tdp`]) {
      const handle = await openSync(dir, name, { create: true });
      handle.truncate(0);
      outputs.push({ name, handle, size: 0, closed: false });
    }
    const closeOutput = (name: string) => {
      const o = outputs.find((x) => x.name === name);
      if (o && !o.closed) {
        o.handle.flush();
        o.handle.close();
        o.closed = true;
      }
    };
    // read-only so the sub-workers can open the same file; fall back to an
    // exclusive handle (then the sub-workers fail to start and we run alone)
    const input = await openSync(dir, STEP_INPUT_NAME, { readOnly: true }).catch(() => openSync(dir, STEP_INPUT_NAME));
    const spill = new ScratchFile(await openSync(dir, SPILL_NAME, { create: true }));
    const caches: SyncHandle[] = [];
    let workers = 0;
    const report = (code: number, done: number, total: number, busy = 0) => {
      onProgress({ phase: phaseFromCode(code), done, total, workers, busy });
    };
    const io = {
      size: () => input.getSize(),
      read: (offset: number, len: number) => readRange(input, offset, len),
      writeTemp: (offset: number, bytes: Uint8Array) => spill.writeAt(offset, bytes),
      readTemp: (offset: number, len: number) => spill.readAt(offset, len),
      tempLen: () => spill.length,
      readSlot: (slot: number, offset: number, len: number) => readRange(caches[slot], offset, len),
      open: (name: string): number => {
        const i = outputs.findIndex((o) => o.name === name);
        if (i < 0) {
          throw new Error(`step worker: output ${name} was not pre-opened`);
        }
        return i;
      },
      write: (handle: number, bytes: Uint8Array) => {
        const o = outputs[handle];
        o.handle.write(bytes, { at: o.size });
        o.size += bytes.length;
      },
      close: (handle: number) => {
        outputs[handle].handle.flush();
      },
      progress: report,
    };
    let session: StepSession | null = null;
    try {
      session = new StepSession(io, opts.deflectionMm, opts.maxAngleDeg, true, false, opts.cleanup);
      const jobs = session.jobs();
      const faceTotal = session.faceCount();
      let table = emptyTable();
      let stats: string[] = [];
      const k = pickWorkerCount(jobs.length, opts.workers);
      if (k > 0) {
        workers = k;
        try {
          // the index goes to disk once; the sub-workers read it from there
          session.writeIndex(INDEX_NAME);
          closeOutput(INDEX_NAME);
          ({ table, stats } = await fanOut(k, jobs, opts, (done, busy) => report(PHASE_FACES, done, faceTotal, busy)));
          for (let i = 0; i < k; i++) {
            caches.push(await openSync(dir, cacheName(i)));
          }
        } catch (e) {
          // partial results are useless (a missing product would read as
          // empty geometry): drop them and tessellate here instead
          const why = e instanceof Error ? e.message : String(e);
          console.warn(`step import: sub-workers failed (${why}); tessellating in-process`);
          table = emptyTable();
          stats = [];
          workers = 0;
        }
      }
      const info = session.finish(
        new Uint32Array(table.keys),
        new Uint32Array(table.slots),
        new Float64Array(table.offsets),
        new Uint32Array(table.lens),
        stats.join(STATS_SEPARATOR),
        `${stem}.tdp`,
        true, // coarsen: the VRAM-budget variant
        false, // compute_normals: same flag the cooker worker uses for merged
      );
      const files = outputs
        .filter((o) => o.size > 0 && /\.tdp$/i.test(o.name))
        .map(({ name, size }) => ({ name, size }));
      return { files, info };
    } finally {
      session?.free();
      for (const c of caches) {
        c.close();
      }
      spill.close();
      input.close();
      for (const o of outputs) {
        closeOutput(o.name);
      }
    }
  },
};

export type Step2GlbApi = typeof api;
Comlink.expose(api);
