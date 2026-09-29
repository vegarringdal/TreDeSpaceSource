// The Comlink startup handshake: a worker that never answers its first call
// is terminated and respawned, and the spawn gives up with an error instead of
// hanging. Workers are faked with a MessageChannel — one end is the "worker"
// the helper talks to, the other either exposes a pingable api or stays silent.
import * as Comlink from 'comlink';
import { describe, expect, it } from 'vitest';
import { type Spawnable, spawnComlinkWorker, spawnComlinkWorkers } from '../src/lib/worker/spawnComlinkWorker';

type FakeWorker = Spawnable & { terminated: boolean };

const TIMEOUT_MS = 20;

/** A worker whose far end answers `ping` only when `healthy`. */
function fakeWorker(healthy: boolean): FakeWorker {
  const { port1, port2 } = new MessageChannel();
  if (healthy) {
    Comlink.expose({ ping: () => true }, port2);
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
    const res = await spawnComlinkWorker(create, 'test', { timeoutMs: TIMEOUT_MS });
    expect(res.error).toBeUndefined();
    expect(await res.data?.api.ping()).toBe(true);
    expect(made).toHaveLength(1);
    res.data?.worker.terminate();
  });

  it('terminates a silent worker and respawns', async () => {
    const { made, create } = scripted([false, true]);
    const res = await spawnComlinkWorker(create, 'test', { timeoutMs: TIMEOUT_MS });
    expect(res.data?.worker).toBe(made[1]);
    expect(made[0].terminated).toBe(true);
    expect(made[1].terminated).toBe(false);
    res.data?.worker.terminate();
  });

  it('gives up with an error after the retries, terminating every attempt', async () => {
    const { made, create } = scripted([]);
    const res = await spawnComlinkWorker(create, 'test', { timeoutMs: TIMEOUT_MS, retries: 3 });
    expect(res.data).toBeUndefined();
    expect(res.error?.msg).toMatch(/test worker did not answer/);
    expect(made).toHaveLength(4);
    expect(made.every((w) => w.terminated)).toBe(true);
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
    const res = await spawnComlinkWorkers(2, create, 'test', { timeoutMs: TIMEOUT_MS, retries: 1 });
    expect(res.data).toBeUndefined();
    expect(res.error).toBeDefined();
    expect(workers.every((w) => w.terminated)).toBe(true);
  });
});
