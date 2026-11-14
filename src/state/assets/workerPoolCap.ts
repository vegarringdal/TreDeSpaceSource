/** Hard ceiling for the import cook pool and the load pool (the UI steppers'
 *  historical max; also caps machines that report many cores). */
export const POOL_CEILING = 10;

const FALLBACK_CORES = 4;

/**
 * How many pooled workers this machine should run at once: one fewer than the
 * logical cores (the main thread and the modeldb worker keep one), floored at
 * 1 and capped at POOL_CEILING. Browsers that hide the core count are treated
 * as 4-core. Every pool size — the state defaults, the setters, the steppers'
 * max and the batch runners — goes through this so a host asking for more
 * concurrency than the client has cores cannot push a laptop into a tab OOM.
 */
export function workerPoolCap(): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined;
  return Math.max(1, Math.min(POOL_CEILING, (cores ?? FALLBACK_CORES) - 1));
}

/** Most sub-workers a laser-scan cook fans out to (each holds a batch of
 *  points, about 0.35 GB). */
const SCAN_WORKER_CEILING = 8;

/** The scan cook's sub-worker limit on this machine (0 workers = the one
 *  coordinator worker does everything, so there is no floor). */
export function scanWorkerCap(): number {
  return Math.min(SCAN_WORKER_CEILING, workerPoolCap());
}
