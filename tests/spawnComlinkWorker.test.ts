// The Comlink startup handshake: a worker that never answers its first call
// is terminated and respawned, and the spawn gives up with an error instead of
// hanging. Workers are faked with a MessageChannel — one end is the "worker"
// the helper talks to, the other either exposes a pingable api or stays silent.
import v8 from 'node:v8';
import vm from 'node:vm';
import * as Comlink from 'comlink';
import { describe, expect, it } from 'vitest';
import {
  type Spawnable,
  spawnComlinkWorker,
  spawnComlinkWorkers,
  withinMs,
} from '../src/lib/worker/spawnComlinkWorker';

type FakeWorker = Spawnable & { terminated: boolean };

/** Budget where a healthy worker must answer. Generous: a loaded CI runner
 *  can stall the first MessageChannel round trip far past a few ms, and a
 *  healthy answer returns at once — only a silent worker waits it out. */
const ANSWER_TIMEOUT_MS = 500;

/** Budget where every worker is silent, so nothing depends on speed. */
const SILENT_TIMEOUT_MS = 20;

/** A worker whose far end answers `ping` only when `healthy` — and, with a
 *  `gate`, only once it resolves (a ping parked in flight). */
function fakeWorker(healthy: boolean, gate?: Promise<void>): FakeWorker {
  const { port1, port2 } = new MessageChannel();
  if (healthy) {
    Comlink.expose(
      {
        ping: async () => {
          await gate;
          return true;
        },
      },
      port2,
    );
  }
  const worker: FakeWorker = {
    terminated: false,
    postMessage: (message: unknown, transfer?: Transferable[]) => port1.postMessage(message, transfer ?? []),
    addEventListener: (type, listener) => port1.addEventListener(type, listener),
    removeEventListener: (type, listener) => port1.removeEventListener(type, listener),
    start: () => port1.start(),
    terminate: () => {
      worker.terminated = true;
      port1.close();
      port2.close();
    },
  };
  return worker;
}

/** A real `gc()`: Node hides it behind a V8 flag, but the flag can be set at
 *  runtime and a fresh context then sees the global. undefined when the
 *  runtime refuses. */
function exposeGc(): (() => void) | undefined {
  try {
    v8.setFlagsFromString('--expose-gc');
    const gc: unknown = vm.runInNewContext('gc');
    if (typeof gc !== 'function') {
      return undefined;
    }

    return () => {
      gc();
    };
  } catch {
    return undefined;
  }
}

const gc = exposeGc();

/** Let queued messages and FinalizationRegistry callbacks run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** A `create` that hands out workers by script (`true` = healthy), recording
 *  every one it made. */
function scripted(health: boolean[]) {
  const made: FakeWorker[] = [];
  const create = () => {
    const w = fakeWorker(health[made.length] ?? false);
    made.push(w);
    return w;
  };
  return { made, create };
}

describe('spawnComlinkWorker', () => {
  it('hands out a worker that answers on the first try', async () => {
    const { made, create } = scripted([true]);
    const res = await spawnComlinkWorker(create, 'test', { timeoutMs: ANSWER_TIMEOUT_MS });
    expect(res.error).toBeUndefined();
    expect(await res.data?.api.ping()).toBe(true);
    expect(made).toHaveLength(1);
    res.data?.worker.terminate();
  });

  it('terminates a silent worker and respawns', async () => {
    const { made, create } = scripted([false, true]);
    const res = await spawnComlinkWorker(create, 'test', { timeoutMs: ANSWER_TIMEOUT_MS });
    expect(res.data?.worker).toBe(made[1]);
    expect(made[0].terminated).toBe(true);
    expect(made[1].terminated).toBe(false);
    res.data?.worker.terminate();
  });

  // GoogleChromeLabs/comlink#692: when the last proxy for a worker is
  // garbage-collected, Comlink sends it a RELEASE and the worker stops
  // listening for good. The handshake's own proxy is transient, so a GC while
  // its ping is in flight must not silence the worker — the pinned root
  // (created before the ping) keeps the count above zero.
  it.skipIf(!gc)('keeps the worker listening when a GC runs during the handshake', async () => {
    let release = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = () => resolve();
    });
    const worker = fakeWorker(true, gate);
    const spawning = spawnComlinkWorker(() => worker, 'test', { timeoutMs: ANSWER_TIMEOUT_MS });
    await settle(); // the ping has reached the worker side and is parked on the gate
    gc?.();
    await settle(); // finalizers run — the handshake proxies are collectable now
    gc?.();
    await settle();
    release();
    const res = await spawning;
    expect(res.error).toBeUndefined();
    const again = res.data?.api.ping() ?? Promise.reject(new Error('no api'));
    await expect(withinMs(again, ANSWER_TIMEOUT_MS, 'second ping')).resolves.toBe(true);
    res.data?.worker.terminate();
  });

  it('gives up with an error after the retries, terminating every attempt', async () => {
    const { made, create } = scripted([]);
    const res = await spawnComlinkWorker(create, 'test', { timeoutMs: SILENT_TIMEOUT_MS, retries: 3 });
    expect(res.data).toBeUndefined();
    expect(res.error?.msg).toMatch(/test worker did not answer/);
    expect(made).toHaveLength(4);
    expect(made.every((w) => w.terminated)).toBe(true);
  });
});

describe('withinMs', () => {
  it('passes a settled value through', async () => {
    await expect(withinMs(Promise.resolve(42), ANSWER_TIMEOUT_MS, 'x')).resolves.toBe(42);
  });

  it('passes a rejection through unchanged', async () => {
    await expect(withinMs(Promise.reject(new Error('wasm broke')), ANSWER_TIMEOUT_MS, 'x')).rejects.toThrow(
      'wasm broke',
    );
  });

  it('rejects with the label once the budget passes', async () => {
    await expect(withinMs(new Promise<never>(() => undefined), SILENT_TIMEOUT_MS, 'cooker wasm init')).rejects.toThrow(
      'cooker wasm init did not finish within 20 ms',
    );
  });
});

describe('spawnComlinkWorkers', () => {
  it('is all or nothing: one slot giving up terminates the rest', async () => {
    const workers: FakeWorker[] = [];
    let n = 0;
    const create = () => {
      // slot 0 healthy, every later worker silent
      const w = fakeWorker(n++ === 0);
      workers.push(w);
      return w;
    };
    // retries: 0 — the silent slot waits the answer budget once, not per retry
    const res = await spawnComlinkWorkers(2, create, 'test', { timeoutMs: ANSWER_TIMEOUT_MS, retries: 0 });
    expect(res.data).toBeUndefined();
    expect(res.error).toBeDefined();
    expect(workers.every((w) => w.terminated)).toBe(true);
  });
});
