// A small pool of cooker workers — created on demand, torn down after the
// import batch so idle tabs hold no worker memory.
import * as Comlink from 'comlink';
import type { CookerApi, CookOutcome } from './cookerWorker';

export type CookToOpfs = (glb: ArrayBuffer, outFileName: string, coarsePath?: string) => Promise<CookOutcome>;
export type CoarsenTdpToOpfs = (tdp: ArrayBuffer, outFileName: string) => Promise<{ size: number }>;
export type CookStandardToOpfs = (glb: ArrayBuffer, outFileName: string, normals: boolean) => Promise<CookOutcome>;

export async function withCookerPool<T>(
  size: number,
  run: (cook: CookToOpfs, coarsenTdp: CoarsenTdpToOpfs, cookStandard: CookStandardToOpfs) => Promise<T>,
): Promise<T> {
  const workers = Array.from(
    { length: Math.max(1, size) },
    () => new Worker(new URL('./cookerWorker.ts', import.meta.url), { type: 'module' }),
  );
  const apis = workers.map((w) => Comlink.wrap<CookerApi>(w));
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
  const coarsenTdp: CoarsenTdpToOpfs = (tdp, outFileName) =>
    dispatch((api) => api.coarsenTdpToOpfs(Comlink.transfer(tdp, [tdp]), outFileName));
  // standard glTF (plain node trees / gpu-instanced) — the generic TS cook.
  // Pooled like the others so a batch of standard GLBs converts in parallel.
  const cookStandard: CookStandardToOpfs = (glb, outFileName, normals) =>
    dispatch((api) => api.cookStandardToOpfs(Comlink.transfer(glb, [glb]), outFileName, normals));
  try {
    return await run(cook, coarsenTdp, cookStandard);
  } finally {
    for (const w of workers) {
      w.terminate();
    }
  }
}
