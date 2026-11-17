import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUploadRegistry, type ExpireReason } from '../src/lib/messageApi/uploadSessions';

const IDLE = 120_000;
const WATCH = 5_000;

function setup() {
  const expired: { id: string; data: string; reason: ExpireReason }[] = [];
  const reg = createUploadRegistry<string>({
    idleMs: IDLE,
    watchMs: WATCH,
    onExpire: (id, data, reason) => expired.push({ id, data, reason }),
  });
  return { reg, expired };
}

describe('upload session registry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('expires a session that sees no chunk for the idle period, touch restarts the clock', () => {
    const { reg, expired } = setup();
    reg.begin('u1', { closed: false }, 'a.rvm');
    vi.advanceTimersByTime(IDLE - WATCH);
    expect(reg.size()).toBe(1);
    reg.touch('u1');
    vi.advanceTimersByTime(IDLE - WATCH);
    expect(expired).toEqual([]);
    vi.advanceTimersByTime(WATCH);
    expect(expired).toEqual([{ id: 'u1', data: 'a.rvm', reason: 'idle' }]);
    expect(reg.size()).toBe(0);
    expect(reg.get('u1')).toBeUndefined();
  });

  it('expires a session whose owner window closed, at the next check', () => {
    const { reg, expired } = setup();
    const owner = { closed: false };
    reg.begin('u1', owner, 'a.rvm');
    vi.advanceTimersByTime(WATCH);
    owner.closed = true;
    vi.advanceTimersByTime(WATCH);
    expect(expired).toEqual([{ id: 'u1', data: 'a.rvm', reason: 'owner-gone' }]);
  });

  it('dropOwner expires only that owner\'s sessions', () => {
    const { reg, expired } = setup();
    const a = { closed: false };
    const b = { closed: false };
    reg.begin('u1', a, 'a.rvm');
    reg.begin('u2', b, 'b.rvm');
    reg.begin('u3', a, 'c.rvm');
    reg.dropOwner(a);
    expect(expired.map((e) => e.id).sort()).toEqual(['u1', 'u3']);
    expect(reg.size()).toBe(1);
    expect(reg.get('u2', b)).toBe('b.rvm');
  });

  it('answers only the owner; an ownerless session is open to anyone', () => {
    const { reg } = setup();
    const a = { closed: false };
    const b = { closed: false };
    reg.begin('owned', a, 'a.rvm');
    reg.begin('open', null, 'o.rvm');
    expect(reg.get('owned', b)).toBeUndefined();
    expect(reg.get('owned', a)).toBe('a.rvm');
    expect(reg.get('owned')).toBe('a.rvm');
    expect(reg.get('open', b)).toBe('o.rvm');
    expect(reg.take('owned', b)).toBeUndefined();
    expect(reg.take('owned', a)).toBe('a.rvm');
    expect(reg.size()).toBe(1);
  });

  it('take stops the watchdog, so a long finish never expires', () => {
    const { reg, expired } = setup();
    reg.begin('u1', { closed: false }, 'a.rvm');
    expect(reg.take('u1')).toBe('a.rvm');
    vi.advanceTimersByTime(IDLE * 3);
    expect(expired).toEqual([]);
  });
});
