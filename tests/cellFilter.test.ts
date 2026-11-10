import { describe, expect, it } from 'vitest';
import { compileCellFilter } from '../src/components/panels/sql-table/cellFilter';

const matches = (filter: string, cell: unknown): boolean => {
  const m = compileCellFilter(filter);
  if (!m) {
    throw new Error(`"${filter}" compiled to no filter`);
  }
  return m(cell);
};

describe('compileCellFilter', () => {
  it('is no filter for blank text', () => {
    expect(compileCellFilter('')).toBeNull();
    expect(compileCellFilter('   ')).toBeNull();
  });

  it('equals the whole cell by default, ignoring capitals and outer spaces', () => {
    expect(matches('/A-PIPE', '/a-pipe')).toBe(true);
    expect(matches(' /A-PIPE ', '  /A-PIPE')).toBe(true);
    expect(matches('/A-PIPE', '/A-PIPE-2')).toBe(false);
    expect(matches('PIPE', '/A-PIPE')).toBe(false);
    expect(matches('42', 42)).toBe(true);
    expect(matches('4', 42)).toBe(false);
    expect(matches('x', null)).toBe(false);
  });

  it('treats * and % as any run of characters, anywhere', () => {
    expect(matches('/A*', '/A-PIPE')).toBe(true);
    expect(matches('*PIPE', '/A-PIPE')).toBe(true);
    expect(matches('*-PI*', '/A-PIPE')).toBe(true);
    expect(matches('%-PI%', '/A-PIPE')).toBe(true);
    expect(matches('/A*E', '/A-PIPE')).toBe(true);
    expect(matches('/A*X', '/A-PIPE')).toBe(false);
    expect(matches('/a*%*b', '/A-B')).toBe(true);
    expect(matches('*', '')).toBe(true);
    expect(matches('*', null)).toBe(true);
    expect(matches('*b*', 'a\nb\nc')).toBe(true);
  });

  it('chains several pieces, in the order written', () => {
    expect(matches('%ab%wow%', 'xxABxxWOWxx')).toBe(true);
    expect(matches('%ab%wow%', 'abwow')).toBe(true);
    expect(matches('%ab%wow%', 'AB wow wow')).toBe(true);
    expect(matches('%ab%wow%', 'wow-ab')).toBe(false);
    expect(matches('%ab%wow%', 'ab')).toBe(false);
    expect(matches('ab*wow*', 'xab-wow')).toBe(false);
  });

  it('keeps every other character literal', () => {
    expect(matches('A.B', 'AxB')).toBe(false);
    expect(matches('A.B', 'A.B')).toBe(true);
    expect(matches('A_B', 'AxB')).toBe(false);
    expect(matches('(x)*', '(x)[1]')).toBe(true);
    expect(matches('a+b?', 'a+b?')).toBe(true);
  });
});
