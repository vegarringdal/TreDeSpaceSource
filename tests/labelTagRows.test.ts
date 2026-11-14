import { describe, expect, it } from 'vitest';
import {
  BAD_ROWS_HEADER,
  formatTagLeftovers,
  NOT_FOUND_HEADER,
  parseCoordinate,
  parseTagRows,
  planTagLabels,
  type TagAnchor,
  type TagLabelDraft,
} from '../src/state/viewer/labelTagRows';

const TAB = '\t';
const NBSP = ' ';

describe('parseCoordinate', () => {
  it('reads a decimal point and a decimal comma', () => {
    expect(parseCoordinate('12.5')).toBe(12.5);
    expect(parseCoordinate(' -3,25 ')).toBe(-3.25);
    expect(parseCoordinate('1e3')).toBe(1000);
  });

  it('drops thousands separators when the decimal mark is clear', () => {
    expect(parseCoordinate('1,234.5')).toBe(1234.5);
    expect(parseCoordinate('1.234,5')).toBe(1234.5);
    expect(parseCoordinate('6,650,123')).toBe(6650123);
  });

  it('allows spaced digit groups only when asked', () => {
    expect(parseCoordinate(`6${NBSP}650${NBSP}123,45`, true)).toBe(6650123.45);
    expect(parseCoordinate('6 650 123,45')).toBeNull();
  });

  it('refuses anything that is not a number', () => {
    for (const cell of ['', 'x', '12m', '1.2.3x', 'NaN', 'Infinity', '--1']) {
      expect(parseCoordinate(cell)).toBeNull();
    }
  });
});

describe('parseTagRows', () => {
  it('keeps plain names as before: distinct, blank rows and the headers dropped', () => {
    const text = ['/T-100', '', '/t-100', '  T-200  ', NOT_FOUND_HEADER, BAD_ROWS_HEADER, 'PIPE 1 of ZONE /Z'].join('\n');

    expect(parseTagRows(text)).toEqual({
      rows: [
        { name: '/T-100', at: null },
        { name: 'T-200', at: null },
        { name: 'PIPE 1 of ZONE /Z', at: null },
      ],
      bad: [],
    });
  });

  it('reads four spreadsheet columns, decimal comma included', () => {
    const text = [`T-100${TAB}12,5${TAB}3,2${TAB}8`, `T-200${TAB}6${NBSP}650${NBSP}123,45${TAB}-1${TAB}0`].join('\r\n');

    expect(parseTagRows(text).rows).toEqual([
      { name: 'T-100', at: [12.5, 3.2, 8] },
      { name: 'T-200', at: [6650123.45, -1, 0] },
    ]);
  });

  it('reads semicolons, commas and spaces as separators', () => {
    const text = ['A;1,5;2;3', 'B, 1.5, 2, 3', 'C 1.5 2 3', 'Leak point 12,5 3,2 8,0'].join('\n');

    expect(parseTagRows(text).rows).toEqual([
      { name: 'A', at: [1.5, 2, 3] },
      { name: 'B', at: [1.5, 2, 3] },
      { name: 'C', at: [1.5, 2, 3] },
      { name: 'Leak point', at: [12.5, 3.2, 8] },
    ]);
  });

  it('treats a row with empty or wordy coordinate cells as a name', () => {
    const text = [`T-100${TAB}${TAB}${TAB}`, `Tag${TAB}X${TAB}Y${TAB}Z`, 'T-300 1 2'].join('\n');

    expect(parseTagRows(text)).toEqual({
      rows: [
        { name: 'T-100', at: null },
        { name: 'Tag', at: null },
        { name: 'T-300 1 2', at: null },
      ],
      bad: [],
    });
  });

  it('reports rows with some coordinates but not all three, or no name', () => {
    const rows = [`T-100${TAB}1${TAB}${TAB}3`, `T-200${TAB}1${TAB}2`, `${TAB}1${TAB}2${TAB}3`];

    expect(parseTagRows(rows.join('\n'))).toEqual({ rows: [], bad: rows.map((r) => r.trim()) });
  });

  it('keeps one name at two points, drops an exact repeat', () => {
    const text = ['Leak 1 2 3', 'Leak 4 5 6', 'leak 1.0 2.0 3.0'].join('\n');

    expect(parseTagRows(text).rows).toHaveLength(2);
  });

  it('ignores columns after z', () => {
    expect(parseTagRows(`T-100${TAB}1${TAB}2${TAB}3${TAB}note`).rows).toEqual([{ name: 'T-100', at: [1, 2, 3] }]);
  });
});

describe('planTagLabels', () => {
  const found: TagAnchor[] = [
    { name: '/T-100', center: [1, 1, 1] },
    { name: '/T-200', center: [2, 2, 2] },
  ];
  const links: TagAnchor[] = [{ name: '/T-300', center: [9, 9, 9] }];

  it('places a row with coordinates at its point, linked only when the model knows the name', () => {
    const { rows } = parseTagRows(['T-300 5 6 7', 'Leak point 1 2 3'].join('\n'));

    expect(planTagLabels(rows, [], links, [], false)).toEqual([
      { text: 'T-300', fullname: '/T-300', anchor: [5, 6, 7] },
      { text: 'Leak point', fullname: null, anchor: [1, 2, 3] },
    ]);
  });

  it('keeps paste order across looked-up and placed rows', () => {
    const { rows } = parseTagRows(['T-200', 'Leak 1 2 3', '/T-100'].join('\n'));

    expect(planTagLabels(rows, found, [], [], true).map((d) => d.text)).toEqual(['T-200', 'Leak', 'T-100']);
  });

  it('skips a fullname that already has a label and a placed label already standing there', () => {
    const existing: TagLabelDraft[] = [
      { text: 'whatever', fullname: '/t-100', anchor: [0, 0, 0] },
      { text: 'Leak', fullname: null, anchor: [1, 2, 3] },
    ];
    const { rows } = parseTagRows(['T-100', 'T-200', 'Leak 1 2 3', 'Leak 1 2 4'].join('\n'));

    expect(planTagLabels(rows, found, [], existing, false)).toEqual([
      { text: '/T-200', fullname: '/T-200', anchor: [2, 2, 2] },
      { text: 'Leak', fullname: null, anchor: [1, 2, 4] },
    ]);
  });

  it('labels every model that carries a looked-up name', () => {
    const twice: TagAnchor[] = [
      { name: '/T-100', center: [1, 1, 1] },
      { name: 'T-100', center: [5, 5, 5] },
    ];

    expect(planTagLabels(parseTagRows('T-100').rows, twice, [], [], false)).toHaveLength(2);
  });
});

describe('formatTagLeftovers', () => {
  it('is empty when everything was used', () => {
    expect(formatTagLeftovers({ notFound: [], bad: [] })).toBe('');
  });

  it('round-trips through the parser without the headers', () => {
    const text = formatTagLeftovers({ notFound: ['T-900'], bad: ['T-901\t1\t2'] });

    expect(text).toBe(`${NOT_FOUND_HEADER}\nT-900\n${BAD_ROWS_HEADER}\nT-901\t1\t2`);
    expect(parseTagRows(text)).toEqual({ rows: [{ name: 'T-900', at: null }], bad: ['T-901\t1\t2'] });
  });
});
