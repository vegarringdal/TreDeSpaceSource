import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatSequence, parseSequence, recordSequence } from '../src/treDeSpaceUI/hotkeys/engine';

// The Record button's capture: a bare Enter finishes the recording, but Enter
// pressed while a key is held (CTRL+ENTER) is part of the chord.

type Listener = (e: FakeEvent) => void;

interface FakeEvent {
  code: string;
  repeat: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

const listeners = new Map<string, Listener[]>();

function fire(type: string, code: string, patch: Partial<FakeEvent> = {}): void {
  const e: FakeEvent = {
    code,
    repeat: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    preventDefault() {},
    stopPropagation() {},
    ...patch,
  };
  for (const fn of listeners.get(type) ?? []) {
    fn(e);
  }
}

describe('recordSequence', () => {
  beforeEach(() => {
    listeners.clear();
    vi.useFakeTimers();
    vi.stubGlobal('window', {
      addEventListener: (type: string, fn: Listener) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
      removeEventListener: (type: string, fn: Listener) =>
        listeners.set(
          type,
          (listeners.get(type) ?? []).filter((l) => l !== fn),
        ),
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('records CTRL+ENTER as a chord', async () => {
    const recorded = recordSequence();
    fire('keydown', 'ControlLeft', { ctrlKey: true });
    fire('keydown', 'Enter', { ctrlKey: true });
    fire('keyup', 'Enter', { ctrlKey: true });
    fire('keyup', 'ControlLeft');
    vi.runAllTimers();
    const seq = await recorded;
    expect(seq).toEqual(parseSequence('CTRL+ENTER'));
    expect(formatSequence(seq)).toBe('CTRL+ENTER');
  });

  it('finishes on a bare Enter after a step', async () => {
    const recorded = recordSequence();
    fire('keydown', 'KeyE');
    fire('keyup', 'KeyE');
    fire('keydown', 'Enter');
    expect(await recorded).toEqual(parseSequence('E'));
  });

  it('records a bare Enter as the first step', async () => {
    const recorded = recordSequence();
    fire('keydown', 'Enter');
    fire('keyup', 'Enter');
    fire('keydown', 'Enter');
    expect(await recorded).toEqual(parseSequence('ENTER'));
  });
});
