import { describe, expect, it } from 'vitest';
import { COLOR_DEFAULT, parseColorToken } from '../src/lib/color/hexColor';
import { parseMultiColumn } from '../src/lib/color/multiColorParse';
import {
  PACKED_NO_COLOR,
  PACKED_NO_OPACITY,
  PackedNamesBuilder,
  packedFromBytes,
  packedFromLines,
  packedName,
  packedTransferables,
} from '../src/lib/color/packedNames';

const dec = new TextDecoder();

describe('PackedNamesBuilder', () => {
  it('lowercases, trims, skips blanks and keeps per-row color/opacity', () => {
    const b = new PackedNamesBuilder();
    b.push('  /A-PIPE ');
    b.push('');
    b.push('/b/Ø-ÆØÅ', 0x11223344, 42);
    const p = b.finish();
    expect(p.count).toBe(2);
    expect(packedName(p, 0, dec)).toBe('/a-pipe');
    expect(packedName(p, 1, dec)).toBe('/b/ø-æøå');
    expect(Array.from(p.colors)).toEqual([PACKED_NO_COLOR, 0x11223344]);
    expect(Array.from(p.opacity)).toEqual([PACKED_NO_OPACITY, 42]);
    expect(p.offsets.length).toBe(3);
    expect(p.offsets[2]).toBe(p.bytes.length);
  });

  it('grows past its initial capacity without losing names', () => {
    const b = new PackedNamesBuilder();
    const n = 5000;
    for (let i = 0; i < n; i++) {
      b.push(`/name-${i}-${'x'.repeat(40)}`, i);
    }
    const p = b.finish();
    expect(p.count).toBe(n);
    expect(packedName(p, 0, dec)).toBe(`/name-0-${'x'.repeat(40)}`);
    expect(packedName(p, n - 1, dec)).toBe(`/name-${n - 1}-${'x'.repeat(40)}`);
    expect(p.colors[n - 1]).toBe(n - 1);
    expect(packedTransferables(p)).toHaveLength(4);
  });

  it('reads color tokens like the two-column Multi paste', () => {
    expect(parseColorToken('yellow')).toEqual({ color: parseColorToken('#ffff00')?.color });
    expect(parseColorToken('#ff0000:50')).toEqual({ color: 0xff0000ff, opacity: 50 });
    expect(parseColorToken('default:')).toEqual({ color: COLOR_DEFAULT });
    expect(parseColorToken('nope')).toBeNull();
    const b = new PackedNamesBuilder();
    b.pushWithToken('/a', null);
    b.pushWithToken('/b', 'red:10');
    b.pushWithToken('/c', 'notacolor');
    const p = b.finish();
    expect(p.colors[0]).toBe(PACKED_NO_COLOR);
    expect(p.opacity[1]).toBe(10);
    expect(p.colors[2]).toBe(PACKED_NO_COLOR);
  });

  it('packedFromLines agrees with parseMultiColumn', () => {
    const text = '/A/B\tred\n/A/C #00ff00:50\n/A/D\n  \n/A/E,default';
    const p = packedFromLines(text);
    const m = parseMultiColumn(text);
    expect(m.names.split('\n').map((n) => n.toLowerCase())).toEqual(
      Array.from({ length: p.count }, (_, i) => packedName(p, i, dec)),
    );
    for (let i = 0; i < p.count; i++) {
      const key = packedName(p, i, dec);
      expect(p.colors[i]).toBe(m.perName[key] ?? PACKED_NO_COLOR);
      expect(p.opacity[i]).toBe(m.perOpacity[key] ?? PACKED_NO_OPACITY);
    }
  });
});

describe('packedFromBytes', () => {
  const enc = new TextEncoder();
  const names = (p: ReturnType<typeof packedFromBytes>) =>
    Array.from({ length: p.count }, (_, i) => packedName(p, i, dec));

  it('reads the Multi grammar byte for byte, matching packedFromLines', () => {
    const text = [
      '  /A-PIPE  ',
      '',
      '/b/Bracket\tyellow',
      '/c/Valve,#ff0000:50',
      '/d/Flange default',
      '/e/Ø-ÆØÅ yellow',
      '/f/no color token here',
      '   ',
    ].join('\r\n');
    const fromBytes = packedFromBytes(enc.encode(text));
    const fromLines = packedFromLines(text);
    expect(names(fromBytes)).toEqual(names(fromLines));
    expect(Array.from(fromBytes.colors)).toEqual(Array.from(fromLines.colors));
    expect(Array.from(fromBytes.opacity)).toEqual(Array.from(fromLines.opacity));
  });

  it('lowercases ASCII in place and still case-folds non-ASCII names', () => {
    const p = packedFromBytes(enc.encode('/A-PIPE\n/B/Ø-ÆØÅ'));
    expect(names(p)).toEqual(['/a-pipe', '/b/ø-æøå']);
  });

  it('grows past its initial capacity and ends on a name without a newline', () => {
    const n = 5000;
    const text = Array.from({ length: n }, (_, i) => `/name-${i}-${'x'.repeat(40)} yellow`).join('\n');
    const p = packedFromBytes(enc.encode(text));
    expect(p.count).toBe(n);
    expect(packedName(p, n - 1, dec)).toBe(`/name-${n - 1}-${'x'.repeat(40)}`);
    expect(p.colors[n - 1]).not.toBe(PACKED_NO_COLOR);
  });
});
