import { describe, expect, it } from 'vitest';
import {
  ApiError,
  answerCommand,
  classifyInbound,
  type Inbound,
  replyOrigin,
  resultEnvelope,
  toWireError,
} from '../src/lib/messageApi/wire';

const envelope = (over: Record<string, unknown> = {}) => ({
  tredespace: 1,
  id: 'req-1',
  type: 'selection.set',
  payload: { fullnames: ['/A'] },
  ...over,
});

const ignore = (reason: string) => ({ kind: 'ignore', reason });

describe('classifyInbound', () => {
  it('drops a disallowed origin before looking at the message', () => {
    expect(classifyInbound(envelope(), false, true)).toEqual(ignore('origin'));
  });

  it('drops anything that is not our envelope', () => {
    expect(classifyInbound('hi', true, true)).toEqual(ignore('envelope'));
    expect(classifyInbound(null, true, true)).toEqual(ignore('envelope'));
    expect(classifyInbound(envelope({ tredespace: 2 }), true, true)).toEqual(ignore('envelope'));
    expect(classifyInbound(envelope({ type: 7 }), true, true)).toEqual(ignore('envelope'));
  });

  it('needs a sending window to answer', () => {
    expect(classifyInbound(envelope(), true, false)).toEqual(ignore('no-source'));
  });

  it('recognises the SDK notes only with a null id', () => {
    expect(classifyInbound(envelope({ id: null, type: 'client.hello' }), true, true)).toEqual({ kind: 'hello' });
    expect(classifyInbound(envelope({ id: null, type: 'client.bye' }), true, true)).toEqual({ kind: 'bye' });
    expect(classifyInbound(envelope({ id: null, type: 'selection.set' }), true, true)).toEqual(ignore('no-id'));
    expect(classifyInbound(envelope({ id: 42 }), true, true)).toEqual(ignore('no-id'));
  });

  it('drops our own outbound traffic reflected back', () => {
    expect(classifyInbound(envelope({ type: 'selection.set:result' }), true, true)).toEqual(ignore('own-traffic'));
    expect(classifyInbound(envelope({ type: 'app.ready' }), true, true)).toEqual(ignore('own-traffic'));
  });

  it('yields a command with a record payload, or an empty one', () => {
    expect(classifyInbound(envelope({ bytes: 'b' }), true, true)).toEqual({
      kind: 'command',
      id: 'req-1',
      type: 'selection.set',
      payload: { fullnames: ['/A'] },
      bytes: 'b',
    });
    const cmd = classifyInbound(envelope({ payload: 'nope' }), true, true);
    expect(cmd.kind === 'command' && cmd.payload).toEqual({});
  });
});

describe('answerCommand', () => {
  const cmd: Extract<Inbound, { kind: 'command' }> = {
    kind: 'command',
    id: 'req-1',
    type: 'x.y',
    payload: { a: 1 },
    bytes: undefined,
  };

  it('answers not-ready without dispatching', async () => {
    let dispatched = false;
    const a = await answerCommand(cmd, false, async () => {
      dispatched = true;
      return {};
    });
    expect(a).toEqual({ ok: false, error: { code: 'not-ready', message: expect.stringContaining('app.ready') } });
    expect(dispatched).toBe(false);
  });

  it('returns the handler result with what it was asked', async () => {
    const seen: unknown[] = [];
    const a = await answerCommand(cmd, true, async (type, p, bytes) => {
      seen.push(type, p, bytes);
      return { ok: 1 };
    });
    expect(a).toEqual({ ok: true, payload: { ok: 1 } });
    expect(seen).toEqual(['x.y', { a: 1 }, undefined]);
  });

  it('maps an ApiError to its code and anything else to internal', async () => {
    expect(
      await answerCommand(cmd, true, async () => {
        throw new ApiError('busy', 'import running');
      }),
    ).toEqual({ ok: false, error: { code: 'busy', message: 'import running' } });
    expect(
      await answerCommand(cmd, true, async () => {
        throw new Error('boom');
      }),
    ).toEqual({ ok: false, error: { code: 'internal', message: 'boom' } });
    expect(
      await answerCommand(cmd, true, async () => {
        throw 'plain';
      }),
    ).toEqual({ ok: false, error: { code: 'internal', message: 'plain' } });
  });
});

describe('envelopes', () => {
  it('builds the one result envelope a request gets', () => {
    expect(resultEnvelope('r', 'a.b', { ok: true, payload: { n: 1 } })).toEqual({
      tredespace: 1,
      id: 'r',
      type: 'a.b:result',
      ok: true,
      payload: { n: 1 },
    });
    expect(resultEnvelope('r', 'a.b', { ok: false, error: toWireError(new ApiError('not-found', 'x')) })).toEqual({
      tredespace: 1,
      id: 'r',
      type: 'a.b:result',
      ok: false,
      error: { code: 'not-found', message: 'x' },
    });
  });

  it('replies to a sandboxed null-origin sender with *, everyone else exactly', () => {
    expect(replyOrigin('null')).toBe('*');
    expect(replyOrigin('https://host.test')).toBe('https://host.test');
  });
});
