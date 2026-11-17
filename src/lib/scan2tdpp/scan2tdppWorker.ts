// LGSX / E57 → .tdpp worker, via the prebuilt scan wasm (./wasm — see its
// README for how it is built). Scans are many GB, so nothing is staged or held
// whole: the wasm pulls input ranges straight from the picked File
// (FileReaderSync — synchronous, worker only) and streams the cooked file
// into the asset store through an OPFS sync access handle, rewriting the
// 128-byte header at offset 0 last. The cook is fanned out over sub-workers
// (scanParallel.ts) with this worker merging and writing; with 0 workers it
// runs here alone (blocking until done — progress lines still reach the main
// thread, postMessage queues from a blocked thread).
import * as Comlink from 'comlink';
import { cookE57Parallel, cookLgsxParallel, PartsUnavailable } from './scanParallel';
import { inputIo, type ScanCookOptions, type ScanCookReport } from './scanShared';
import init, { cook } from './wasm/scan_wasm.js';

export type { ScanCookOptions, ScanCookReport } from './scanShared';

const ready = init();

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface SyncHandle {
  truncate(n: number): void;
  write(b: Uint8Array, opts: { at: number }): number;
  flush(): void;
  close(): void;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** Batch sizes of a multi-worker E57 cook: every worker holds one batch, so
 *  they are kept small (≈ 20 B per point plus the build's working memory);
 *  the block skipping makes small batches cheap. The chunk size is part of
 *  the output (it decides where the octree is cut into chunks, so the order
 *  of the payloads): every E57 cook in the app uses this one value. */
const PARALLEL_BATCH_POINTS = 6_000_000;
const PARALLEL_CHUNK_POINTS = 3_000_000;
const MAX_WORKERS = 8;

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

/** With workers asked for, the cook is fanned out over sub-workers (and
 *  falls back to this worker alone if they cannot start). */
async function runCook(
  file: File,
  io: object,
  opts: ScanCookOptions,
  onProgress: (message: string) => void,
): Promise<string> {
  const workers = Math.min(MAX_WORKERS, Math.max(0, Math.floor(opts.workers)));
  // chunkPoints also for the one-worker cook (an E57's bytes depend on the
  // chunk size, not on the batch size or the worker count): the file is then
  // the same whether it was converted on sub-workers, alone, or after the
  // fallback below. An LGSX cook ignores it.
  const plain = JSON.stringify({
    panoMaxSize: opts.panoMaxSize,
    intensity16: opts.intensity16,
    chunkPoints: PARALLEL_CHUNK_POINTS,
  });
  if (workers > 0) {
    try {
      if (/\.e57$/i.test(file.name)) {
        const json = JSON.stringify({
          panoMaxSize: opts.panoMaxSize,
          intensity16: opts.intensity16,
          batchPoints: PARALLEL_BATCH_POINTS,
          chunkPoints: PARALLEL_CHUNK_POINTS,
        });
        return await cookE57Parallel(file, io, json, workers, onProgress);
      }
      return await cookLgsxParallel(file, io, plain, workers, onProgress);
    } catch (e) {
      if (!(e instanceof PartsUnavailable)) {
        throw e;
      }
      onProgress(`Sub-workers unavailable (${e.message}) — converting in one worker`);
    }
  }
  return cook(io, plain);
}

function isReport(v: unknown): v is ScanCookReport {
  return typeof v === 'object' && v !== null && 'points' in v && 'nodes' in v && 'fileSize' in v;
}

const api = {
  /** Startup handshake for spawnComlinkWorker. */
  ping: () => true,

  /** Cook `file` into `out` (truncated first). Throws on a cook error — the
   *  caller removes the partial output. */
  async cook(
    file: File,
    out: FileSystemFileHandle,
    opts: ScanCookOptions,
    onProgress: (message: string) => void,
  ): Promise<ScanCookReport> {
    await ready;
    // worker-only API, missing from TS's lib.dom
    const sync = await (out as unknown as { createSyncAccessHandle(): Promise<SyncHandle> }).createSyncAccessHandle();
    try {
      sync.truncate(0);
      const io = {
        ...inputIo(file),
        write: (offset: number, bytes: Uint8Array) => {
          sync.write(bytes, { at: offset });
        },
        progress: (message: string) => onProgress(message),
      };
      const report: unknown = JSON.parse(await runCook(file, io, opts, onProgress));
      sync.flush();
      if (!isReport(report)) {
        throw new Error('the scan cook returned no report');
      }
      return report;
    } finally {
      sync.close();
    }
  },
};

export type Scan2TdppApi = typeof api;
Comlink.expose(api);
