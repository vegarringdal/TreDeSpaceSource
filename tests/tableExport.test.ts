import { describe, expect, it } from 'vitest';
import { cellText, exportFileName, toTsv } from '../src/lib/tableExport';

describe('toTsv', () => {
  it('writes a header line then one tab-separated line per row', () => {
    expect(toTsv(['id', 'name'], [[1, 'a'], [2, 'b']])).toBe('id\tname\n1\ta\n2\tb');
  });

  it('renders null as empty and quotes cells holding tabs, newlines or quotes', () => {
    const out = toTsv(['a', 'b', 'c'], [[null, 'x\ty', 'say "hi"\nthere']]);
    expect(out).toBe('a\tb\tc\n\t"x\ty"\t"say ""hi""\nthere"');
  });

  it('cellText stringifies everything but null / undefined', () => {
    expect(cellText(null)).toBe('');
    expect(cellText(undefined)).toBe('');
    expect(cellText(0)).toBe('0');
    expect(cellText(false)).toBe('false');
  });
});

describe('exportFileName', () => {
  it('keeps a plain title and appends the extension', () => {
    expect(exportFileName('Open defects', 'xlsx')).toBe('Open defects.xlsx');
  });

  it('replaces path and reserved characters and collapses whitespace', () => {
    expect(exportFileName('a/b:c*d?e"f<g>h|ij  k', 'xlsx')).toBe('a_b_c_d_e_f_g_h_ij k.xlsx');
  });

  it('falls back for an empty title and caps the stem', () => {
    expect(exportFileName('   ', 'xlsx')).toBe('sql-table.xlsx');
    expect(exportFileName('x'.repeat(200), 'xlsx')).toBe(`${'x'.repeat(80)}.xlsx`);
  });
});
