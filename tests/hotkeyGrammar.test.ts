import { describe, expect, it } from 'vitest';
import { formatSequence, HotkeyParseError, parseSequence } from '../src/treDeSpaceUI/hotkeys/engine';

/** Display string → canonical sequence → display string. */
const roundTrip = (s: string): string => formatSequence(parseSequence(s));

describe('hotkey display grammar', () => {
  it('joins keys pressed together with +', () => {
    expect(parseSequence('CTRL+Z')).toEqual(['Ctrl&KeyZ']);
    expect(parseSequence('E+R')).toEqual(parseSequence('R+E'));
    expect(roundTrip('ctrl+z')).toBe('CTRL+Z');
  });

  it('separates steps with a space or a comma', () => {
    expect(parseSequence('G X')).toEqual(['KeyG', 'KeyX']);
    expect(parseSequence('G,X')).toEqual(['KeyG', 'KeyX']);
    expect(parseSequence('G, X')).toEqual(['KeyG', 'KeyX']);
    expect(roundTrip('CTRL+K, CTRL+C')).toBe('CTRL+K CTRL+C');
  });

  it('expands runs and re-joins digit runs for display', () => {
    expect(parseSequence('ALT 101')).toEqual(['Alt', 'Digit1', 'Digit0', 'Digit1']);
    expect(roundTrip('ALT 1 0 2 1')).toBe('ALT 1021');
    expect(roundTrip('ALT+F1 101')).toBe('ALT+F1 101');
    expect(parseSequence('FF')).toEqual(['KeyF', 'KeyF']);
  });

  it('keeps F-keys and named keys whole', () => {
    expect(parseSequence('F12')).toEqual(['F12']);
    expect(parseSequence('PAGEUP')).toEqual(['PageUp']);
    expect(roundTrip('ESC')).toBe('ESC');
  });

  it('carries held groups into the following steps', () => {
    expect(parseSequence('[F1] 2')).toEqual(['Digit2&F1']);
    expect(parseSequence('[ALT+F1] 2 3')).toEqual(['Alt&Digit2&F1', 'Alt&Digit3&F1']);
  });

  it('names the + and comma keys', () => {
    expect(parseSequence('CTRL+PLUS')).toEqual(['Ctrl&Equal']);
    expect(roundTrip('CTRL+PLUS')).toBe('CTRL+PLUS');
    expect(roundTrip('ALT+COMMA')).toBe('ALT+COMMA');
  });

  it('rejects the old notation instead of misreading it', () => {
    expect(() => parseSequence('CTRL&Z')).toThrow(HotkeyParseError);
    expect(() => parseSequence('G + X')).toThrow(HotkeyParseError);
    expect(() => parseSequence('ALT + 101')).toThrow(HotkeyParseError);
    expect(() => parseSequence('CTRL++')).toThrow(HotkeyParseError);
  });
});
