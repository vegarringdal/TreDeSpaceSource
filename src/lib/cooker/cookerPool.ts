// A small pool of cooker workers — created on demand, torn down after the
// import batch so idle tabs hold no worker memory.
import * as Comlink from 'comlink';
import { spawnComlinkWorkers, withinMs } from '../worker/spawnComlinkWorker';
import type { CookerApi, CookOutcome, StoreTdpOutcome } from './cookerWorker';

/** Budget for a slot's wasm cooker to fetch + instantiate. The module is
 *  400 KB and normally up in well under a second (the fetch starts at worker
 *  load, then comes from the HTTP cache); the slack is for a slow link with
 *  every slot fetching at once, since a miss fails the whole batch. */
const WASM_READY_MS = 5_000;

export type CookToOpfs = (glb: ArrayBuffer, outFileName: string, coarsePath?: string) => Promise<CookOutcome>;
export type StoreTdpToOpfs = (
  tdp: ArrayBuffer,
  outFileName: string,
  coarsePath: string,
  coarseBytes?: ArrayBuffer,
) => Promise<StoreTdpOutcome>;
export type CookStandardToOpfs = (glb: ArrayBuffer, outFileName: string, normals: boolean) => Promise<CookOutcome>;

export async function withCookerPool<T>(
  size: number,
  run: (cook: CookToOpfs, storeTdp: StoreTdpToOpfs, cookStandard: CookStandardToOpfs) => Promise<T>,
): Promise<T> {
  // every slot must pass the startup handshake — a worker Comlink lost at
  // birth would otherwise hang its first cook, and the batch, for good
  const spawned = await spawnComlinkWorkers<CookerApi>(
    Math.max(1, size),
    () => new Worker(new URL('./cookerWorker.ts', import.meta.url), { type: 'module' }),
    'cooker',
  );
  if (spawned.error) {
    throw new Error(spawned.error.msg);
  }

  const slots = spawned.data ?? [];
  const workers = slots.map((s) => s.worker);
  const apis = slots.map((s) => s.api);
  // round-robin with per-worker busy chaining: callers await their slot
  const busy = apis.map(() => Promise.resolve());
  let next = 0;
  const dispatch = <R>(job: (api: Comlink.Remote<CookerApi>) => Promise<R>): Promise<R> => {
    const i = next;
    next = (next + 1) % apis.length;
    const done = busy[i].then(() => job(apis[i]));
    busy[i] = done.then(
      () => undefined,
      () => undefined,
    );
    return done;
  };
  const cook: CookToOpfs = (glb, outFileName, coarsePath) =>
    dispatch((api) => api.cookToOpfs(Comlink.transfer(glb, [glb]), outFileName, coarsePath));
  // already-cooked .tdp: hashed, written and given its coarse sibling in the
  // worker — both buffers are transferred
  const storeTdp: StoreTdpToOpfs = (tdp, outFileName, coarsePath, coarseBytes) =>
    dispatch((api) =>
      api.storeTdpToOpfs(
        Comlink.transfer(tdp, [tdp]),
        outFileName,
        coarsePath,
        coarseBytes ? Comlink.transfer(coarseBytes, [coarseBytes]) : undefined,
      ),
    );
  // standard glTF (plain node trees / gpu-instanced) — the generic TS cook.
  // Pooled like the others so a batch of standard GLBs converts in parallel.
  const cookStandard: CookStandardToOpfs = (glb, outFileName, normals) =>
    dispatch((api) => api.cookStandardToOpfs(Comlink.transfer(glb, [glb]), outFileName, normals));
  try {
    // the wasm must be up in EVERY slot before the first download: a slot
    // whose init failed or hung would otherwise swallow its cooks later, with
    // the files already fetched. An init error carries the wasm's own message.
    await Promise.all(apis.map((api) => withinMs(api.ready(), WASM_READY_MS, 'cooker wasm init')));
    return await run(cook, storeTdp, cookStandard);
  } finally {
    for (const w of workers) {
      w.terminate();
    }
  }
}
