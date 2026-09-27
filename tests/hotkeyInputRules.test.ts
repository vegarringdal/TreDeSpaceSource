import { describe, expect, it } from 'vitest';
import { hasCommandModifier, isFunctionKeySequence, parseSequence } from '../src/treDeSpaceUI/hotkeys/engine';

// The two text-field rules of the hotkey engine: which bindings stay live
// inside an input (F-key combos), and which muted presses are worth reporting
// (anything carrying a command modifier — never plain typing).

describe('isFunctionKeySequence (the allowInInput default)', () => {
  it.each(['F1', 'F12', 'ALT&F1', 'CTRL&SHIFT&F5', 'F1 + F2'])('%s types nothing → fires in fields', (keys) => {
    expect(isFunctionKeySequence(parseSequence(keys))).toBe(true);
  });

  it.each(['F', 'FF', 'ALT + 101', 'H', 'ALT&H', 'END', '[F1] + 2', 'F1 + A', 'SHIFT&A'])(
    '%s touches the field → muted',
    (keys) => {
      expect(isFunctionKeySequence(parseSequence(keys))).toBe(false);
    },
  );

  it('rejects an empty sequence', () => {
    expect(isFunctionKeySequence([])).toBe(false);
  });
});

describe('hasCommandModifier (what a muted press must carry to be reported)', () => {
  it.each(['ALT + 101', 'ALT&H', 'CTRL&Z', 'ALT&SHIFT + 2', 'META&K', 'F + ALT&F'])('%s is a command', (keys) => {
    expect(hasCommandModifier(parseSequence(keys))).toBe(true);
  });

  it.each(['H', 'FF', 'SHIFT&H', 'TAB', 'ESC', 'PAGEUP', '101', 'E&R', 'F1'])('%s looks like typing', (keys) => {
    expect(hasCommandModifier(parseSequence(keys))).toBe(false);
  });
});
