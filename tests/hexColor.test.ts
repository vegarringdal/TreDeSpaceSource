import { describe, expect, it } from 'vitest';
import { COLOR_DEFAULT, colorToHex, packHex, parseColor } from '../src/lib/color/hexColor';

describe('colorToHex', () => {
  it('canonicalises hex codes to lowercase #rrggbb', () => {
    expect(colorToHex('#FF8800')).toBe('#ff8800');
    expect(colorToHex(' #f80 ')).toBe('#ff8800');
  });

  it('converts CSS colour names case-insensitively', () => {
    expect(colorToHex('yellow')).toBe('#ffff00');
    expect(colorToHex('Orange')).toBe('#ffa500');
  });

  it('rejects unknown text, malformed hex, blanks and the default sentinel', () => {
    expect(colorToHex('yellowish')).toBeNull();
    expect(colorToHex('#ff88')).toBeNull();
    expect(colorToHex('')).toBeNull();
    expect(colorToHex('default')).toBeNull();
  });

  it('agrees with parseColor on the packed value', () => {
    const hex = colorToHex('yellow');
    expect(hex).not.toBeNull();
    expect(packHex(hex ?? '')).toBe(parseColor('yellow'));
    expect(parseColor('default')).toBe(COLOR_DEFAULT);
  });
});
