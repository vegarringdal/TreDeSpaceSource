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

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

/** True when the worker answered `ping` within `timeoutMs`. A rejected ping
 *  (e.g. its module failed to load) counts as no answer. The handshake rides
 *  its own wrap — a second Comlink proxy on the same endpoint ignores the
 *  other's replies. */
async function answersPing(worker: Spawnable, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const answered = Comlink.wrap<Pingable>(worker)
    .ping()
    .then(
      () => true,
      () => false,
    );
  const ok = await Promise.race([answered, timedOut]);
  clearTimeout(timer);
  return ok;
}

/** Spawn a Comlink worker and prove it answers before handing it out.
 *  Comlink can lose a fresh worker when many start at once: its first call
 *  never settles, and whatever awaits it hangs for good (holding the import
 *  lock, on the import path). So the first call is a `ping` with a short
 *  timeout; a worker that misses it is terminated and a new one spawned,
 *  `retries` times, before giving up with an error result. Only startup is
 *  guarded — a worker dying mid-call still needs its caller's crash race. */
export async function spawnComlinkWorker<T extends Pingable, W extends Spawnable = Worker>(
  create: () => W,
  label: string,
  opts: SpawnOpts = {},
): Promise<Result<SpawnedWorker<T, W>>> {
  const timeoutMs = opts.timeoutMs ?? READY_TIMEOUT_MS;
  const attempts = 1 + (opts.retries ?? SPAWN_RETRIES);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const worker = create();
    if (await answersPing(worker, timeoutMs)) {
      return { data: { worker, api: Comlink.wrap<T>(worker) } };
    }

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
