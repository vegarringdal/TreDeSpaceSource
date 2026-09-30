// Comlink worker spawn with a startup handshake — see spawnComlinkWorker.
import * as Comlink from 'comlink';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type ErrorResult = Readonly<{ err: unknown; msg: string }>;
type Result<T> = Readonly<{ data?: T; error?: ErrorResult }>;

/** What the spawn needs from a worker: a Comlink endpoint it can kill.
 *  `Worker` fits; tests pass a MessagePort wrapper. */
export type Spawnable = Comlink.Endpoint & { terminate(): void };

/** Every api spawned through `spawnComlinkWorker` exposes `ping` — the
 *  handshake's round trip. */
export type Pingable = { ping(): boolean };

export type SpawnedWorker<T, W> = Readonly<{ worker: W; api: Comlink.Remote<T> }>;

type SpawnOpts = Readonly<{ timeoutMs?: number; retries?: number }>;

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** How long a fresh worker gets to answer its first Comlink call. */
const READY_TIMEOUT_MS = 1000;

/** Fresh workers tried after the first one missed its handshake. */
const SPAWN_RETRIES = 3;

/** Root proxies pinned for their worker's lifetime. Comlink counts the live
 *  proxies per worker and, when the LAST one is garbage-collected, sends it a
 *  RELEASE — after which the worker drops its message listener for good and
 *  every later call hangs silently (GoogleChromeLabs/comlink#692). A pinned
 *  root keeps the count above zero, so a transient wrap (the handshake, or a
 *  one-off `wrap(w).call()`) can never silence the worker. Weakly keyed: the
 *  pin goes when the worker object does. */
const pinnedRoots = new WeakMap<Spawnable, unknown>();

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

/** `promise`, or a rejection naming `label` once `ms` pass without it
 *  settling — for a worker call that must not be awaited open-endedly. */
export function withinMs<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not finish within ${ms} ms`)), ms);
  });
  return Promise.race([promise, timedOut]).finally(() => clearTimeout(timer));
}

/** True when the worker answered `ping` within `timeoutMs`. A rejected ping
 *  (e.g. its module failed to load) counts as no answer. The handshake rides
 *  its own wrap — a second Comlink proxy on the same endpoint ignores the
 *  other's replies. */
function answersPing(worker: Spawnable, timeoutMs: number): Promise<boolean> {
  return withinMs(Comlink.wrap<Pingable>(worker).ping(), timeoutMs, 'handshake').then(
    () => true,
    () => false,
  );
}

/** Spawn a Comlink worker and prove it answers before handing it out.
 *  Comlink can lose a fresh worker when many start at once: its first call
 *  never settles, and whatever awaits it hangs for good (holding the import
 *  lock, on the import path). So the first call is a `ping` with a short
 *  timeout; a worker that misses it is terminated and a new one spawned,
 *  `retries` times, before giving up with an error result. Only startup is
 *  guarded — a worker dying mid-call still needs its caller's crash race.
 *  The returned `api` is the worker's one root proxy, pinned for as long as
 *  the worker object lives (see `pinnedRoots`); it is created BEFORE the
 *  handshake so the handshake's own transient proxy can't release the worker. */
export async function spawnComlinkWorker<T extends Pingable, W extends Spawnable = Worker>(
  create: () => W,
  label: string,
  opts: SpawnOpts = {},
): Promise<Result<SpawnedWorker<T, W>>> {
  const timeoutMs = opts.timeoutMs ?? READY_TIMEOUT_MS;
  const attempts = 1 + (opts.retries ?? SPAWN_RETRIES);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const worker = create();
    const api = Comlink.wrap<T>(worker);
    pinnedRoots.set(worker, api);
    if (await answersPing(worker, timeoutMs)) {
      return { data: { worker, api } };
    }

    pinnedRoots.delete(worker);
    worker.terminate();
    if (attempt < attempts) {
      console.warn(`${label} worker missed its ${timeoutMs} ms handshake — respawning (${attempt + 1}/${attempts})`);
    }
  }
  const msg = `${label} worker did not answer within ${timeoutMs} ms (${attempts} attempts)`;
  return { error: { err: new Error(msg), msg } };
}

/** Spawn `count` workers in parallel, each through the handshake. All or
 *  nothing: if any slot gives up, the ones that started are terminated and
 *  its error is returned. */
export async function spawnComlinkWorkers<T extends Pingable, W extends Spawnable = Worker>(
  count: number,
  create: () => W,
  label: string,
  opts: SpawnOpts = {},
): Promise<Result<SpawnedWorker<T, W>[]>> {
  const spawned = await Promise.all(Array.from({ length: count }, () => spawnComlinkWorker<T, W>(create, label, opts)));
  const slots = spawned.flatMap((s) => (s.data ? [s.data] : []));
  const failed = spawned.find((s) => s.error);
  if (failed?.error) {
    for (const s of slots) {
      s.worker.terminate();
    }
    return { error: failed.error };
  }

  return { data: slots };
}
