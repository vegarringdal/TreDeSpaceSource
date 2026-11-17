// The decode workers of the scan point streamer: a small pool that turns node
// payloads into GPU words off the main thread, so streaming does not stall
// frames (a full node is 6–13 ms of decode and pack). Workers start on first
// use and live for the session. Where a worker cannot be started, or one
// dies, the job runs on the main thread instead — slower frames, same result.
import type { Result } from '../result';
import type { DecodeRequest, DecodeResponse } from './pointDecodeWorker';
import { type NodeJob, type NodeJobDone, runNodeJob } from './pointNodeJob';
import { decoderReady } from './tdppFormat';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** A finished job, and whether it ran off the main thread. */
export interface PooledJob extends NodeJobDone {
  readonly isOffThread: boolean;
}

interface PoolWorker {
  readonly worker: Worker;
  readonly pending: Map<number, (r: Result<PooledJob>) => void>;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** Most workers: the streamer has 4 fetches in flight at most. */
const MAX_WORKERS = 4;
/** Cores left to the main thread and the browser. */
const SPARE_CORES = 2;

// -----------------------------------------------------------------------------
// State
// -----------------------------------------------------------------------------

const workers: PoolWorker[] = [];
let nextId = 1;
/** Set when a worker could not be started: no further attempts. */
let isUnavailable = typeof Worker === 'undefined';

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

const fail = (msg: string, err: unknown = null): Result<PooledJob> => ({ error: { err, msg } });

function poolSize(): number {
  const cores = typeof navigator === 'undefined' ? MAX_WORKERS : navigator.hardwareConcurrency || MAX_WORKERS;
  return Math.min(MAX_WORKERS, Math.max(1, cores - SPARE_CORES));
}

/** A worker died: fail what it held and take it out of the pool. */
function retire(w: PoolWorker, why: string) {
  const at = workers.indexOf(w);
  if (at >= 0) {
    workers.splice(at, 1);
  }
  for (const resolve of w.pending.values()) {
    resolve(fail(why));
  }
  w.pending.clear();
  w.worker.terminate();
}

function spawn(): PoolWorker | null {
  try {
    const worker = new Worker(new URL('./pointDecodeWorker.ts', import.meta.url), { type: 'module' });
    const w: PoolWorker = { worker, pending: new Map() };
    worker.onmessage = (e: MessageEvent<DecodeResponse>) => {
      const resolve = w.pending.get(e.data.id);
      w.pending.delete(e.data.id);
      if (!resolve) {
        return;
      }
      resolve('done' in e.data ? { data: { ...e.data.done, isOffThread: true } } : fail(e.data.error));
    };
    worker.onerror = (e) => retire(w, `decode worker failed: ${e.message}`);
    workers.push(w);
    return w;
  } catch {
    isUnavailable = true;
    return null;
  }
}

/** The worker with the least to do, starting another while the pool has room
 *  and every worker is busy. */
function pick(): PoolWorker | null {
  if (isUnavailable) {
    return null;
  }
  let best: PoolWorker | null = null;
  for (const w of workers) {
    if (!best || w.pending.size < best.pending.size) {
      best = w;
    }
  }
  if ((!best || best.pending.size > 0) && workers.length < poolSize()) {
    return spawn() ?? best;
  }
  return best;
}

async function runHere(job: NodeJob): Promise<Result<PooledJob>> {
  await decoderReady();
  const result = runNodeJob(job);
  return result.data ? { data: { ...result.data, isOffThread: false } } : { error: result.error };
}

// -----------------------------------------------------------------------------
// Actions
// -----------------------------------------------------------------------------

/**
 * Decode and pack one node. The payload's buffer is handed to the worker —
 * the caller must not use it afterwards. Never rejects: a failure is a Result.
 */
export function decodeNodeJob(job: NodeJob): Promise<Result<PooledJob>> {
  const w = pick();
  if (!w) {
    return runHere(job).catch((err) => fail(`node decode failed: ${err}`, err));
  }

  return new Promise((resolve) => {
    const id = nextId++;
    w.pending.set(id, resolve);
    const request: DecodeRequest = { id, job };
    try {
      w.worker.postMessage(request, [job.payload.buffer]);
    } catch (err) {
      w.pending.delete(id);
      resolve(fail(`node decode could not be queued: ${err}`, err));
    }
  });
}
