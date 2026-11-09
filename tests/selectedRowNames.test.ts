import { describe, expect, it } from 'vitest';
import {
  findColumn,
  multiFilterValue,
  packRowNames,
  rowNames,
} from '../src/components/panels/sql-table/selectedRowNames';
import { parseColor } from '../src/lib/color/hexColor';
import { parseMultiColumn } from '../src/lib/color/multiColorParse';
import { PACKED_NO_COLOR, PACKED_NO_OPACITY, packedName } from '../src/lib/color/packedNames';

const COLUMNS = ['id', 'FullName', 'Fullname_Color'];
const ROWS: unknown[][] = [
  [1, '/A-PIPE', 'red'],
  [2, ' /B-VALVE ', '#00ff00:40'],
  [3, '/a-pipe', 'blue'],
  [4, '', 'red'],
  [5, null, 'red'],
  [6, '/C-PUMP', 'not-a-colour'],
  [7, '/D-TANK', null],
];

describe('findColumn', () => {
  it('matches case-insensitively and reports -1 when missing', () => {
    expect(findColumn(COLUMNS, 'fullname')).toBe(1);
    expect(findColumn(COLUMNS, 'fullname_color')).toBe(2);
    expect(findColumn(COLUMNS, 'tag')).toBe(-1);
  });
});

describe('rowNames', () => {
  it('keeps the given order, drops blanks and case-insensitive repeats, and only usable colours', () => {
    const names = rowNames(ROWS, [6, 0, 1, 2, 3, 4, 5], 1, 2);
    expect(names).toEqual([
      { name: '/D-TANK', color: null },
      { name: '/A-PIPE', color: 'red' },
      { name: '/B-VALVE', color: '#00ff00:40' },
      { name: '/C-PUMP', color: null },
    ]);
  });

  it('reads no colour at all without a colour column', () => {
    expect(rowNames(ROWS, [0, 1], 1, -1)).toEqual([
      { name: '/A-PIPE', color: null },
      { name: '/B-VALVE', color: null },
    ]);
  });
});

describe('packRowNames / multiFilterValue', () => {
  const names = rowNames(ROWS, [0, 1, 6], 1, 2);

  it('packs lowercased names with their colour and opacity', () => {
    const p = packRowNames(names);
    const dec = new TextDecoder();
    expect(p.count).toBe(3);
    expect([0, 1, 2].map((i) => packedName(p, i, dec))).toEqual(['/a-pipe', '/b-valve', '/d-tank']);
    expect(p.colors[0]).toBe(parseColor('red'));
    expect(p.opacity[1]).toBe(40);
    expect(p.colors[2]).toBe(PACKED_NO_COLOR);
    expect(p.opacity[2]).toBe(PACKED_NO_OPACITY);
  });

  it('writes Multi lines the Set Color filter reads back to the same colours', () => {
    const value = multiFilterValue(names);
    expect(value).toBe('/A-PIPE\tred\n/B-VALVE\t#00ff00:40\n/D-TANK');
    const parsed = parseMultiColumn(value);
    expect(parsed.names).toBe('/A-PIPE\n/B-VALVE\n/D-TANK');
    expect(parsed.perName['/a-pipe']).toBe(parseColor('red'));
    expect(parsed.perOpacity['/b-valve']).toBe(40);
    expect(parsed.perName['/d-tank']).toBeUndefined();
  });
});
