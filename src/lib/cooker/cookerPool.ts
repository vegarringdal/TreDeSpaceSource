// A small pool of cooker workers — created on demand, torn down after the
// import batch so idle tabs hold no worker memory.
import * as Comlink from 'comlink';
import type { CookerApi, CookOutcome } from './cookerWorker';

export type CookToOpfs = (glb: ArrayBuffer, outFileName: string, coarsePath?: string) => Promise<CookOutcome>;

export async function withCookerPool<T>(size: number, run: (cook: CookToOpfs) => Promise<T>): Promise<T> {
  const workers = Array.from(
    { length: Math.max(1, size) },
    () => new Worker(new URL('./cookerWorker.ts', import.meta.url), { type: 'module' }),
  );
  const apis = workers.map((w) => Comlink.wrap<CookerApi>(w));
  // round-robin with per-worker busy chaining: callers await their slot
  const busy = apis.map(() => Promise.resolve());
  let next = 0;
  const cook: CookToOpfs = (glb, outFileName, coarsePath) => {
    const i = next;
    next = (next + 1) % apis.length;
    const job = busy[i].then(() => apis[i].cookToOpfs(Comlink.transfer(glb, [glb]), outFileName, coarsePath));
    busy[i] = job.then(
      () => undefined,
      () => undefined,
    );
    return job;
  };
  try {
    return await run(cook);
  } finally {
    for (const w of workers) {
      w.terminate();
    }
  }
}
