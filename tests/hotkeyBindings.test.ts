import { beforeAll, describe, expect, it } from 'vitest';
import type { HotkeyDef } from '../src/treDeSpaceUI/hotkeys';
import { formatSequence, parseSequence, validateBindings } from '../src/treDeSpaceUI/hotkeys/engine';

// The app validates its own table at boot and, in dev, refuses to start on a
// clash ("Invalid hotkey bindings") — but only a browser run sees that. These
// run the same check in the unit tests, so a shortcut added (or a generated
// family that shifts, like the per-section `settings.reset.*` keys) can never
// collide unnoticed; and they pin that a user's own key edits never stop the
// app, whatever they clash with.

/** The table's modules start the model-DB worker on import, and registering
 *  starts the key listeners; Node has neither, and no hotkey runs here, so
 *  inert stand-ins are enough. */
class InertWorker {
  postMessage(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
  terminate(): void {}
}
const INERT_WINDOW = { addEventListener(): void {}, removeEventListener(): void {} };

let hotkeys: HotkeyDef[] = [];

beforeAll(async () => {
  if (typeof globalThis.Worker === 'undefined') {
    Object.assign(globalThis, { Worker: InertWorker });
  }
  if (typeof globalThis.window === 'undefined') {
    Object.assign(globalThis, { window: INERT_WINDOW });
  }
  hotkeys = (await import('../src/hotkeys/bindings')).HOTKEYS;
});

describe('the hotkey table', () => {
  it('passes the same validation the app runs at boot', () => {
    expect(validateBindings(hotkeys)).toEqual([]);
  });

  it('has no two shortcuts on the same default keys', () => {
    const byKeys = new Map<string, string[]>();
    for (const h of hotkeys) {
      const keys = formatSequence(parseSequence(h.defaultKeys));
      byKeys.set(keys, [...(byKeys.get(keys) ?? []), h.id]);
    }
    const shared = [...byKeys].filter(([, ids]) => ids.length > 1).map(([keys, ids]) => `${keys}: ${ids.join(', ')}`);
    expect(shared).toEqual([]);
  });

  it('keeps every per-section reset key where it was', () => {
    const keys = new Map(hotkeys.map((h) => [h.id, h.defaultKeys]));
    // positional keys of long-standing sections must not move when sections are added
    expect(keys.get('settings.reset.antialiasing')).toBe('ALT 1241');
    expect(keys.get('settings.reset.shortcuts')).toBe('ALT 1263');
    expect(keys.get('settings.reset.navGizmo')).toBe('ALT 1265');
  });
});

describe('user key edits', () => {
  it('never stop the app, even when they land on keys a new default now uses', async () => {
    const { hotkeysActions, hotkeysState } = await import('../src/treDeSpaceUI/hotkeys/hotkeys.state');
    // a user who bound Fit visible to ALT 1265 before the Navigation gizmo
    // section's reset took that default: both stay registered, nothing throws
    hotkeysState.set({ overrides: { 'camera.fitVisible': { keys: parseSequence('ALT 1265') } } });
    expect(() => hotkeysActions.register(hotkeys)).not.toThrow();
    const live = hotkeysActions.list();
    const keysOf = (id: string) => live.find((h) => h.id === id)?.keys;
    expect(keysOf('camera.fitVisible')).toBe('ALT 1265');
    expect(keysOf('settings.reset.navGizmo')).toBe('ALT 1265');
    expect(hotkeysActions.conflictsFor(parseSequence('ALT 1265'), 'camera.fitVisible')).toEqual([
      'settings.reset.navGizmo',
    ]);
  });
});
