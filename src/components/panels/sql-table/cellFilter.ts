// The SQL Table's column filters as cell predicates. Text compares ignore
// capitals and surrounding spaces. EQUAL / NOT_EQUAL_TO (and each value of an
// in-list filter) keep the old wildcard rule: `*` or `%` (the SQL LIKE habit)
// match any run of characters, every other character is literal (`_` and `.`
// included — names are full of them). On a number column a value that reads
// as a number compares as a number, so `80` matches 80.0. Pure, so it stays
// unit-testable.

import { type ColumnFilter, type ColumnKind, type FilterOperator, isListOperator, listValues } from './filterOperators';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type CellMatcher = (cell: unknown) => boolean;

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const WILDCARDS = /[*%]+/;
const RANGE_SEPARATOR = '..';
const MATCH_NOTHING: CellMatcher = () => false;

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

function cellText(cell: unknown): string {
  return cell == null ? '' : String(cell).trim().toLowerCase();
}

function isBlank(cell: unknown): boolean {
  return cellText(cell) === '';
}

function cellNumber(cell: unknown): number | null {
  if (typeof cell === 'number') {
    return Number.isNaN(cell) ? null : cell;
  }
  if (typeof cell === 'bigint') {
    return Number(cell);
  }

  return null;
}

/** A typed number, accepting a decimal comma (`1,5`); null when it is not one. */
function parseNumber(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (t === '') {
    return null;
  }
  const n = Number(t);

  return Number.isFinite(n) ? n : null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-value text match with `*` / `%` wildcards; `pattern` is lower-cased. */
function compileTextPattern(pattern: string): (text: string) => boolean {
  const parts = pattern.split(WILDCARDS);
  if (parts.length === 1) {
    return (text) => text === pattern;
  }

  const rx = new RegExp(`^${parts.map(escapeRegExp).join('.*')}$`, 's');
  return (text) => rx.test(text);
}

/** EQUAL's test for one value: as a number on a number column when the value
 *  reads as one, else as text with wildcards. */
function compileEquals(value: string, kind: ColumnKind): CellMatcher {
  const n = kind === 'number' ? parseNumber(value) : null;
  if (n !== null) {
    return (cell) => cellNumber(cell) === n;
  }

  const match = compileTextPattern(value.trim().toLowerCase());
  return (cell) => match(cellText(cell));
}

/**
 * In-list test, built to stay fast at 450k rows × thousands of values: plain
 * values go into hash sets (numbers and lower-cased text), and only the
 * values with a wildcard are tried one by one. Null when the list is empty.
 */
function compileInList(text: string, kind: ColumnKind): CellMatcher | null {
  const values = listValues(text);
  if (!values.length) {
    return null;
  }

  const numbers = new Set<number>();
  const texts = new Set<string>();
  const patterns: ((text: string) => boolean)[] = [];
  for (const v of values) {
    const n = kind === 'number' ? parseNumber(v) : null;
    const low = v.toLowerCase();
    if (n !== null) {
      numbers.add(n);
    } else if (WILDCARDS.test(low)) {
      patterns.push(compileTextPattern(low));
    } else {
      texts.add(low);
    }
  }

  return (cell) => {
    const n = cellNumber(cell);
    if (n !== null && numbers.has(n)) {
      return true;
    }
    const t = cellText(cell);
    return texts.has(t) || patterns.some((match) => match(t));
  };
}

/** `a..b` with both ends included; either end may be left open (`100..`). */
function compileBetween(text: string): CellMatcher {
  const at = text.indexOf(RANGE_SEPARATOR);
  if (at < 0) {
    return MATCH_NOTHING;
  }
  const loText = text.slice(0, at);
  const hiText = text.slice(at + RANGE_SEPARATOR.length);
  const lo = loText.trim() ? parseNumber(loText) : -Infinity;
  const hi = hiText.trim() ? parseNumber(hiText) : Infinity;
  if (lo === null || hi === null) {
    return MATCH_NOTHING;
  }
  const min = Math.min(lo, hi);
  const max = Math.max(lo, hi);

  return (cell) => {
    const n = cellNumber(cell);
    return n !== null && n >= min && n <= max;
  };
}

function compileComparison(op: FilterOperator, text: string): CellMatcher {
  const v = parseNumber(text);
  if (v === null) {
    return MATCH_NOTHING;
  }
  const test: (n: number) => boolean =
    op === 'GREATER_THAN'
      ? (n) => n > v
      : op === 'GREATER_THAN_OR_EQUAL_TO'
        ? (n) => n >= v
        : op === 'LESS_THAN'
          ? (n) => n < v
          : (n) => n <= v;

  return (cell) => {
    const n = cellNumber(cell);
    return n !== null && test(n);
  };
}

function negate(match: CellMatcher | null): CellMatcher | null {
  return match && ((cell) => !match(cell));
}

/** A predicate over one column's cells, compiled once per filter change (never
 *  per row), or null when the filter is empty (that column does not filter).
 *  A value that cannot be read (`>abc`, `100` for BETWEEN) matches nothing. */
export function compileCellFilter(filter: ColumnFilter, kind: ColumnKind): CellMatcher | null {
  const { op, text } = filter;
  if (op === 'IS_BLANK') {
    return isBlank;
  }
  if (op === 'IS_NOT_BLANK') {
    return (cell) => !isBlank(cell);
  }
  if (isListOperator(op)) {
    const inList = compileInList(text, kind);
    return op === 'IN' ? inList : negate(inList);
  }

  const value = text.trim();
  if (!value) {
    return null;
  }
  const low = value.toLowerCase();
  switch (op) {
    case 'EQUAL':
      return compileEquals(value, kind);
    case 'NOT_EQUAL_TO':
      return negate(compileEquals(value, kind));
    case 'CONTAINS':
      return (cell) => cellText(cell).includes(low);
    case 'DOES_NOT_CONTAIN':
      return (cell) => !cellText(cell).includes(low);
    case 'BEGIN_WITH':
      return (cell) => cellText(cell).startsWith(low);
    case 'END_WITH':
      return (cell) => cellText(cell).endsWith(low);
    case 'BETWEEN':
      return compileBetween(value);
    default:
      return compileComparison(op, value);
  }
}

/** Each column's kind from the values SQLite returned: `number` when every
 *  non-blank value is a number. One pass that drops a column at its first
 *  non-number, so it stays cheap at the 450k-row cap. An all-blank column is
 *  `text`. */
export function detectColumnKinds(columnCount: number, rows: readonly (readonly unknown[])[]): ColumnKind[] {
  const isNumber = new Array<boolean>(columnCount).fill(true);
  const hasValue = new Array<boolean>(columnCount).fill(false);
  let open = columnCount;
  for (const row of rows) {
    if (!open) {
      break;
    }
    for (let c = 0; c < columnCount; c++) {
      const v = row[c];
      if (!isNumber[c] || v == null || v === '') {
        continue;
      }
      if (typeof v === 'number' || typeof v === 'bigint') {
        hasValue[c] = true;
        continue;
      }
      isNumber[c] = false;
      open--;
    }
  }

  return isNumber.map((n, c) => (n && hasValue[c] ? 'number' : 'text'));
}
