import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HotkeyEngine, parseSequence, type Registered } from '../src/treDeSpaceUI/hotkeys/engine';

// The `trigger: 'tap'` rule (DESIGN.md › Animation › Player): Space tap =
// play/pause, while Space held + click stays fly-to. A tap fires on key-up of
// a clean, short press; anything else during the hold consumes it.

type Listener = (e: FakeEvent) => void;

interface FakeEvent {
  code: string;
  key: string;
  repeat: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  target: { tagName: string; isContentEditable: boolean };
  defaultPrevented: boolean;
  propagationStopped: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

const listeners = new Map<string, Listener[]>();

function fire(type: string, patch: Partial<FakeEvent> = {}): FakeEvent {
  const e: FakeEvent = {
    code: 'Space',
    key: ' ',
    repeat: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    target: { tagName: 'DIV', isContentEditable: false },
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.propagationStopped = true;
    },
    ...patch,
  };
  for (const fn of listeners.get(type) ?? []) {
    fn(e);
  }
  return e;
}

function engineWith(run: () => void, extra: Partial<Registered> = {}): HotkeyEngine {
  const engine = new HotkeyEngine();
  engine.setBindings([{ id: 'play', sequence: parseSequence('SPACE'), run, trigger: 'tap', ...extra }]);
  engine.start();
  return engine;
}

describe('tap trigger', () => {
  let now = 0;

  beforeEach(() => {
    listeners.clear();
    now = 0;
    vi.stubGlobal('window', {
      addEventListener: (type: string, fn: Listener) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
      removeEventListener: () => {},
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    });
    vi.spyOn(performance, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fires on a clean key-up and claims only the key-up', () => {
    const run = vi.fn();
    engineWith(run);
    const down = fire('keydown');
    expect(down.defaultPrevented).toBe(false); // the camera still sees Space held
    expect(run).not.toHaveBeenCalled();
    now = 120;
    const up = fire('keyup');
    expect(run).toHaveBeenCalledTimes(1);
    expect(up.defaultPrevented).toBe(true); // a focused button is not activated
  });

  it('a pointer press while held is fly-to, not a tap', () => {
    const run = vi.fn();
    engineWith(run);
    fire('keydown');
    fire('pointerdown');
    fire('keyup');
    expect(run).not.toHaveBeenCalled();
  });

  it('another key or a wheel turn consumes it', () => {
    const run = vi.fn();
    engineWith(run);
    fire('keydown');
    fire('keydown', { code: 'KeyW', key: 'w' });
    fire('keyup', { code: 'KeyW', key: 'w' });
    fire('keyup');
    fire('keydown');
    fire('wheel');
    fire('keyup');
    expect(run).not.toHaveBeenCalled();
  });

  it('a long hold does not fire', () => {
    const run = vi.fn();
    engineWith(run, { tapMaxMs: 1000 });
    fire('keydown');
    now = 1500;
    fire('keyup');
    expect(run).not.toHaveBeenCalled();
  });

  it('auto-repeat keeps the tap armed and does not fire it early', () => {
    const run = vi.fn();
    engineWith(run);
    fire('keydown');
    fire('keydown', { repeat: true });
    expect(run).not.toHaveBeenCalled();
    now = 300;
    fire('keyup');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('is muted in a text field and honours its context guard', () => {
    const run = vi.fn();
    engineWith(run);
    fire('keydown', { target: { tagName: 'INPUT', isContentEditable: false } });
    fire('keyup');
    expect(run).not.toHaveBeenCalled();
    let active = false;
    const guarded = vi.fn();
    listeners.clear();
    engineWith(guarded, { context: () => active });
    fire('keydown');
    fire('keyup');
    active = true;
    fire('keydown');
    fire('keyup');
    expect(guarded).toHaveBeenCalledTimes(1);
  });
});
