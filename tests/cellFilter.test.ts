import { describe, expect, it } from 'vitest';
import { compileCellFilter, detectColumnKinds } from '../src/components/panels/sql-table/cellFilter';
import {
  type ColumnKind,
  type FilterOperator,
  parseTypedOperator,
  pastedListValues,
  withOperator,
} from '../src/components/panels/sql-table/filterOperators';

const compile = (op: FilterOperator, text: string, kind: ColumnKind = 'text') => compileCellFilter({ op, text }, kind);

const matcher = (op: FilterOperator, text: string, kind: ColumnKind = 'text') => {
  const m = compile(op, text, kind);
  if (!m) {
    throw new Error(`${op} "${text}" compiled to no filter`);
  }
  return m;
};

const matches = (filter: string, cell: unknown): boolean => matcher('EQUAL', filter)(cell);

describe('compileCellFilter — EQUAL (the default)', () => {
  it('is no filter for blank text', () => {
    expect(compile('EQUAL', '')).toBeNull();
    expect(compile('EQUAL', '   ')).toBeNull();
    expect(compile('GREATER_THAN', '', 'number')).toBeNull();
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

  it('compares numbers as numbers on a number column, wildcards as text', () => {
    const eq80 = matcher('EQUAL', '80', 'number');
    expect(eq80(80)).toBe(true);
    expect(eq80(80.0)).toBe(true);
    expect(eq80(800)).toBe(false);
    expect(eq80(null)).toBe(false);
    expect(matcher('EQUAL', '080', 'number')(80)).toBe(true);
    expect(matcher('EQUAL', '1,5', 'number')(1.5)).toBe(true);
    expect(matcher('EQUAL', '1*', 'number')(150)).toBe(true);
    expect(matcher('EQUAL', '1*', 'number')(50)).toBe(false);
  });
});

describe('compileCellFilter — other text operators', () => {
  it('NOT_EQUAL_TO inverts equals, wildcards included, blanks kept', () => {
    const m = matcher('NOT_EQUAL_TO', 'pipe');
    expect(m('PIPE')).toBe(false);
    expect(m('VALVE')).toBe(true);
    expect(m(null)).toBe(true);
    expect(matcher('NOT_EQUAL_TO', 'p*')('PIPE')).toBe(false);
  });

  it('CONTAINS / DOES_NOT_CONTAIN / BEGIN_WITH / END_WITH take the text literally', () => {
    expect(matcher('CONTAINS', 'flange')('/HA/FLANGE-80')).toBe(true);
    expect(matcher('CONTAINS', 'a*b')('xa*by')).toBe(true);
    expect(matcher('CONTAINS', 'a*b')('xaZby')).toBe(false);
    expect(matcher('DOES_NOT_CONTAIN', 'flange')('/HA/FLANGE-80')).toBe(false);
    expect(matcher('DOES_NOT_CONTAIN', 'flange')(null)).toBe(true);
    expect(matcher('BEGIN_WITH', '/ha')('/HA/PIPE')).toBe(true);
    expect(matcher('BEGIN_WITH', 'pipe')('/HA/PIPE')).toBe(false);
    expect(matcher('END_WITH', 'pipe')('/HA/PIPE')).toBe(true);
  });

  it('IS_BLANK / IS_NOT_BLANK need no value; spaces count as blank', () => {
    const blank = matcher('IS_BLANK', '');
    expect(blank(null)).toBe(true);
    expect(blank('')).toBe(true);
    expect(blank('  ')).toBe(true);
    expect(blank(0)).toBe(false);
    expect(matcher('IS_NOT_BLANK', '')('x')).toBe(true);
    expect(matcher('IS_NOT_BLANK', '')(undefined)).toBe(false);
  });
});

describe('compileCellFilter — lists', () => {
  it('IN takes one value per line (tabs too), capitals ignored, wildcards allowed', () => {
    const m = matcher('IN', 'PIPE\nvalve\t\n  beam*  ');
    expect(m('pipe')).toBe(true);
    expect(m('VALVE')).toBe(true);
    expect(m('BEAM-1')).toBe(true);
    expect(m('PUMP')).toBe(false);
    expect(m(null)).toBe(false);
  });

  it('IN compares numbers as numbers on a number column', () => {
    const m = matcher('IN', '80\n150', 'number');
    expect(m(80)).toBe(true);
    expect(m(150.0)).toBe(true);
    expect(m(100)).toBe(false);
  });

  it('NOT_IN is the opposite, blanks included; an empty list does not filter', () => {
    const m = matcher('NOT_IN', 'PIPE\nVALVE');
    expect(m('PIPE')).toBe(false);
    expect(m('PUMP')).toBe(true);
    expect(m(null)).toBe(true);
    expect(compile('IN', '\n \n')).toBeNull();
    expect(compile('NOT_IN', '')).toBeNull();
  });
});

describe('compileCellFilter — number operators', () => {
  it('compares as numbers and skips blanks', () => {
    expect(matcher('GREATER_THAN', '500', 'number')(501)).toBe(true);
    expect(matcher('GREATER_THAN', '500', 'number')(500)).toBe(false);
    expect(matcher('GREATER_THAN_OR_EQUAL_TO', '500', 'number')(500)).toBe(true);
    expect(matcher('LESS_THAN', '1,5', 'number')(1.4)).toBe(true);
    expect(matcher('LESS_THAN_OR_EQUAL_TO', '-2', 'number')(-2)).toBe(true);
    expect(matcher('LESS_THAN', '10', 'number')(null)).toBe(false);
  });

  it('BETWEEN includes both ends, in either order, and allows an open end', () => {
    const m = matcher('BETWEEN', '100..250', 'number');
    expect(m(100)).toBe(true);
    expect(m(250)).toBe(true);
    expect(m(99.9)).toBe(false);
    expect(matcher('BETWEEN', '250..100', 'number')(150)).toBe(true);
    expect(matcher('BETWEEN', '1.5..2.5', 'number')(2)).toBe(true);
    expect(matcher('BETWEEN', '100..', 'number')(1e9)).toBe(true);
    expect(matcher('BETWEEN', '..100', 'number')(-5)).toBe(true);
    expect(matcher('BETWEEN', '..100', 'number')(null)).toBe(false);
  });

  it('matches nothing when the value cannot be read', () => {
    expect(matcher('GREATER_THAN', 'abc', 'number')(5)).toBe(false);
    expect(matcher('BETWEEN', '100', 'number')(100)).toBe(false);
    expect(matcher('BETWEEN', 'a..b', 'number')(100)).toBe(false);
  });
});

describe('detectColumnKinds', () => {
  it('is number only when every non-blank value is a number', () => {
    const rows = [
      ['a', 1, 1.5, null, 1],
      ['b', 2, null, null, 'x'],
      ['c', 3, 2, '', 3],
    ];
    expect(detectColumnKinds(5, rows)).toEqual(['text', 'number', 'number', 'text', 'text']);
  });

  it('is text for every column of an empty result', () => {
    expect(detectColumnKinds(2, [])).toEqual(['text', 'text']);
  });
});

describe('parseTypedOperator', () => {
  it('switches the operator and drops the sign', () => {
    expect(parseTypedOperator('>=500', 'number')).toEqual({ op: 'GREATER_THAN_OR_EQUAL_TO', text: '500' });
    expect(parseTypedOperator('<= 5', 'number')).toEqual({ op: 'LESS_THAN_OR_EQUAL_TO', text: '5' });
    expect(parseTypedOperator('>5', 'number')).toEqual({ op: 'GREATER_THAN', text: '5' });
    expect(parseTypedOperator('!=PIPE', 'text')).toEqual({ op: 'NOT_EQUAL_TO', text: 'PIPE' });
    expect(parseTypedOperator('<>PIPE', 'text')).toEqual({ op: 'NOT_EQUAL_TO', text: 'PIPE' });
  });

  it('waits for more than the sign, and keeps > and < literal on text columns', () => {
    expect(parseTypedOperator('>', 'number')).toBeNull();
    expect(parseTypedOperator('>=', 'number')).toBeNull();
    expect(parseTypedOperator('>5', 'text')).toBeNull();
    expect(parseTypedOperator('>=5', 'text')).toBeNull();
    expect(parseTypedOperator('PIPE', 'text')).toBeNull();
  });
});

describe('pastedListValues', () => {
  it('splits a copied column or row, skipping empty cells and repeats', () => {
    expect(pastedListValues('A\r\nB\r\n\r\na\r\nC\r\n')).toEqual(['A', 'B', 'C']);
    expect(pastedListValues('A\tB\t\tC')).toEqual(['A', 'B', 'C']);
  });

  it('is null for a single value, even with the trailing line break a spreadsheet adds', () => {
    expect(pastedListValues('PIPE')).toBeNull();
    expect(pastedListValues('PIPE\r\n')).toBeNull();
  });
});

describe('withOperator', () => {
  it('drops the value for blank checks and multi-value lists', () => {
    expect(withOperator({ op: 'EQUAL', text: 'x' }, 'IS_BLANK')).toEqual({ op: 'IS_BLANK', text: '' });
    expect(withOperator({ op: 'IN', text: 'a\nb' }, 'EQUAL')).toEqual({ op: 'EQUAL', text: '' });
    expect(withOperator({ op: 'IN', text: 'a\n' }, 'CONTAINS')).toEqual({ op: 'CONTAINS', text: 'a' });
    expect(withOperator({ op: 'EQUAL', text: 'a' }, 'IN')).toEqual({ op: 'IN', text: 'a' });
  });
});
