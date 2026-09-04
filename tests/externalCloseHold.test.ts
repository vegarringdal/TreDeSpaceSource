import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  beginHeldClose,
  clearCloseHold,
  hasCloseHold,
  releaseHeldClose,
  setCloseHold,
} from '../src/state/externalCloseHold';

describe('externalCloseHold', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('closes at once without a hold', () => {
    expect(beginHeldClose('none')).toBeNull();
    expect(releaseHeldClose('none')).toBe(false);
  });

  it('waits for the release, or the timeout', async () => {
    expect(setCloseHold('a', true, 500)).toBe(500);
    let released = false;
    void beginHeldClose('a')?.then(() => {
      released = true;
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(released).toBe(false);
    expect(releaseHeldClose('a')).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(released).toBe(true);
    expect(releaseHeldClose('a')).toBe(false);

    let timedOut = false;
    void beginHeldClose('a')?.then(() => {
      timedOut = true;
    });
    await vi.advanceTimersByTimeAsync(499);
    expect(timedOut).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(timedOut).toBe(true);
  });

  it('clamps the timeout and forgets the hold with the page', async () => {
    expect(setCloseHold('b', true, 99_999)).toBe(10_000);
    expect(setCloseHold('b', true, -5)).toBe(0);
    expect(hasCloseHold('b')).toBe(true);
    let finished = false;
    setCloseHold('b', true, 5000);
    void beginHeldClose('b')?.then(() => {
      finished = true;
    });
    clearCloseHold('b');
    await vi.advanceTimersByTimeAsync(0);
    expect(finished).toBe(true);
    expect(hasCloseHold('b')).toBe(false);
    expect(setCloseHold('b', false)).toBeNull();
  });
});
