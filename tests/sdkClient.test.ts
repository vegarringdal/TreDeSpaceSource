// The copy-paste SDK against a fake viewer window: no jsdom — `window` is a
// stub that records what the client posts and lets the test play the viewer.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AppReady, TredespaceClient, TredespaceClientError } from '../api/tredespace-client';

const VIEWER = 'https://viewer.test';

interface Posted {
  msg: Record<string, unknown>;
  origin: string;
  transfer: unknown[];
}

class FakeWindow {
  closed = false;
  readonly posted: Posted[] = [];
  private readonly listeners = new Map<string, Set<(e: unknown) => void>>();

  addEventListener(type: string, l: (e: unknown) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(l);
  }

  removeEventListener(type: string, l: (e: unknown) => void): void {
    this.listeners.get(type)?.delete(l);
  }

  postMessage(msg: Record<string, unknown>, origin: string, transfer: unknown[] = []): void {
    this.posted.push({ msg, origin, transfer });
  }

  dispatch(type: string, e: unknown): void {
    for (const l of [...(this.listeners.get(type) ?? [])]) {
      l(e);
    }
  }
}

const READY: AppReady = {
  version: '1.2.3',
  api: 1,
  commands: ['app.info', 'events.subscribe', 'selection.clear', 'selection.setList'],
  events: ['tree.select', 'theme.changed', 'app.ready', 'app.bye'],
  gpu: 'booting',
};

let host: FakeWindow;
let viewer: FakeWindow;
let client: TredespaceClient;

const fromViewer = (data: unknown, origin = VIEWER) => host.dispatch('message', { data, origin, source: viewer });
const ready = () => fromViewer({ tredespace: 1, id: null, type: 'app.ready', ok: true, payload: READY });
const typeOf = (p: Posted) => String(p.msg.type);
const postedOf = (type: string) => viewer.posted.filter((p) => typeOf(p) === type);
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  host = new FakeWindow();
  viewer = new FakeWindow();
  vi.stubGlobal('window', host);
  vi.stubGlobal('HTMLIFrameElement', class {});
  client = new TredespaceClient(viewer as unknown as Window, { targetOrigin: VIEWER, timeoutMs: 1000 });
});

afterEach(() => {
  client.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('handshake', () => {
  it('says hello on construction and resolves ready() on app.ready', async () => {
    expect(viewer.posted.map(typeOf)).toEqual(['client.hello']);
    expect(viewer.posted[0].origin).toBe(VIEWER);
    const p = client.ready();
    ready();
    expect(await p).toEqual(READY);
    expect(await client.ready()).toEqual(READY); // already ready: immediate
  });

  it('answers supports() from the ready payload', () => {
    expect(client.supports('selection.clear')).toBe(false); // not ready yet
    ready();
    expect(client.supports('selection.clear')).toBe(true);
    expect(client.supports('tree.select')).toBe(true);
    expect(client.supports('export.glb')).toBe(false);
  });

  it('ready({ timeoutMs }) rejects when no app.ready arrives', async () => {
    vi.useFakeTimers();
    const p = client.ready({ timeoutMs: 50 });
    const failed = p.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(50);
    const e = await failed;
    expect(e).toBeInstanceOf(TredespaceClientError);
    expect(e instanceof TredespaceClientError && e.code).toBe('timeout');
  });

  it('dispose() rejects a pending ready() with transport', async () => {
    const failed = client.ready().catch((e: unknown) => e);
    client.dispose();
    const e = await failed;
    expect(e instanceof TredespaceClientError && e.code).toBe('transport');
    await expect(client.ready()).rejects.toBeInstanceOf(TredespaceClientError);
  });

  it('ignores viewer traffic from another origin', () => {
    fromViewer({ tredespace: 1, id: null, type: 'app.ready', ok: true, payload: READY }, 'https://evil.test');
    expect(client.supports('selection.clear')).toBe(false);
  });
});

describe('commands', () => {
  it('wait for app.ready by default, then correlate the result by id', async () => {
    const p = client.selectionClear();
    expect(postedOf('selection.clear')).toHaveLength(0);
    ready();
    await flush();
    const [cmd] = postedOf('selection.clear');
    expect(cmd).toBeDefined();
    expect(cmd.msg.tredespace).toBe(1);
    expect(typeof cmd.msg.id).toBe('string');
    fromViewer({ tredespace: 1, id: 'someone-else', type: 'selection.clear:result', ok: true, payload: { no: 1 } });
    fromViewer({ tredespace: 1, id: cmd.msg.id, type: 'selection.clear:result', ok: true, payload: {} });
    expect(await p).toEqual({ data: {} });
  });

  it('post at once with waitForReady: false and surface not-ready as an error', async () => {
    client.dispose();
    client = new TredespaceClient(viewer as unknown as Window, { targetOrigin: VIEWER, waitForReady: false });
    const p = client.selectionClear();
    const [cmd] = postedOf('selection.clear');
    expect(cmd).toBeDefined();
    fromViewer({
      tredespace: 1,
      id: cmd.msg.id,
      type: 'selection.clear:result',
      ok: false,
      error: { code: 'not-ready', message: 'booting' },
    });
    const r = await p;
    expect(r.error?.code).toBe('not-ready');
    expect(r.error?.msg).toBe('booting');
  });

  it('time out into a Result error, never a throw', async () => {
    vi.useFakeTimers();
    ready();
    const p = client.selectionClear();
    await vi.advanceTimersByTimeAsync(1000);
    const r = await p;
    expect(r.error?.code).toBe('timeout');
  });

  it('map a wire error to Result.error with its code', async () => {
    ready();
    const p = client.selectionClear();
    await flush();
    const [cmd] = postedOf('selection.clear');
    fromViewer({
      tredespace: 1,
      id: cmd.msg.id,
      type: 'selection.clear:result',
      ok: false,
      error: { code: 'unknown-command', message: 'no such command' },
    });
    const r = await p;
    expect(r.error?.code).toBe('unknown-command');
  });

  it('are settled with transport on app.bye, and ready() is armed again', async () => {
    ready();
    const p = client.selectionClear();
    await flush();
    fromViewer({ tredespace: 1, id: null, type: 'app.bye', ok: true, payload: { reason: 'unload' } });
    expect((await p).error?.code).toBe('transport');
    expect(client.supports('selection.clear')).toBe(false);
    const again = client.ready();
    ready();
    expect(await again).toEqual(READY);
  });

  it('transfer ArrayBuffer bytes instead of cloning them', async () => {
    ready();
    const buf = new TextEncoder().encode('/A\n').buffer;
    void client.selectionSetList(buf);
    await flush();
    const [cmd] = postedOf('selection.setList');
    expect(cmd.msg.bytes).toBe(buf);
    expect(cmd.transfer).toEqual([buf]);
  });

  it('fail with transport once disposed', async () => {
    client.dispose();
    expect((await client.selectionClear()).error?.code).toBe('transport');
  });
});

describe('events', () => {
  it('subscribe with the viewer on ready, once per new type, never for local events', async () => {
    client.on('tree.select', () => undefined);
    client.onClosed(() => undefined);
    expect(postedOf('events.subscribe')).toHaveLength(0);
    ready();
    expect(postedOf('events.subscribe').map((p) => p.msg.payload)).toEqual([{ events: ['tree.select'] }]);
    client.on('tree.select', () => undefined);
    client.on('theme.changed', () => undefined);
    client.onRelayChanged(() => undefined);
    expect(postedOf('events.subscribe').map((p) => p.msg.payload)).toEqual([
      { events: ['tree.select'] },
      { events: ['theme.changed'] },
    ]);
    ready(); // a reloaded viewer learns the whole list again
    expect(postedOf('events.subscribe').at(-1)?.msg.payload).toEqual({ events: ['tree.select', 'theme.changed'] });
  });

  it('reach typed handlers, the string overload, and once()', async () => {
    ready();
    const seen: string[] = [];
    client.on('theme.changed', (e) => seen.push(e.theme));
    client.on('some.future', (p) => seen.push(String((p as { x: number }).x)));
    const next = client.once('tree.select');
    fromViewer({ tredespace: 1, id: null, type: 'theme.changed', ok: true, payload: { theme: 'dark' } });
    fromViewer({ tredespace: 1, id: null, type: 'some.future', ok: true, payload: { x: 7 } });
    fromViewer({ tredespace: 1, id: null, type: 'tree.select', ok: true, payload: { model: 1, entry: 2 } });
    expect(seen).toEqual(['dark', '7']);
    expect(await next).toEqual({ model: 1, entry: 2 });
  });

  it('once() rejects on timeout and when the client closes', async () => {
    vi.useFakeTimers();
    ready();
    const late = client.once('tree.select', { timeoutMs: 20 }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(20);
    expect((await late) instanceof TredespaceClientError).toBe(true);
    const closed = client.once('tree.select').catch((e: unknown) => e);
    client.dispose();
    const e = await closed;
    expect(e instanceof TredespaceClientError && e.code).toBe('transport');
  });

  it('raise app.error to onAppError', () => {
    const got: string[] = [];
    client.onAppError((e) => got.push(e.code));
    fromViewer({ tredespace: 1, id: null, type: 'app.error', ok: true, payload: { code: 'gpu-init', message: 'x' } });
    expect(got).toEqual(['gpu-init']);
  });
});
