// The SQL Table's filter operators: names, button symbols, which column kind
// offers which, and the pure text helpers around them (typed shortcuts like
// `>=500`, pasted spreadsheet cells, the in-list value list). The ids are the
// `@simple-html/grid` v6 names, so a later move to that grid is mostly a swap.

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type FilterOperator =
  | 'EQUAL'
  | 'NOT_EQUAL_TO'
  | 'CONTAINS'
  | 'DOES_NOT_CONTAIN'
  | 'BEGIN_WITH'
  | 'END_WITH'
  | 'IN'
  | 'NOT_IN'
  | 'GREATER_THAN'
  | 'GREATER_THAN_OR_EQUAL_TO'
  | 'LESS_THAN'
  | 'LESS_THAN_OR_EQUAL_TO'
  | 'BETWEEN'
  | 'IS_BLANK'
  | 'IS_NOT_BLANK';

/** A column is `number` when every non-blank value is a JS number (SQLite
 *  INTEGER / REAL); everything else is `text`. */
export type ColumnKind = 'text' | 'number';

/** One column's filter. For `IN` / `NOT_IN` the text holds one value per line. */
export type ColumnFilter = Readonly<{ op: FilterOperator; text: string }>;

type OperatorInfo = Readonly<{
  /** What the filter cell's button shows. */
  symbol: string;
  /** The menu entry. */
  label: string;
  /** Blank checks take no value: their input is disabled. */
  hasValue: boolean;
}>;

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

export const DEFAULT_OPERATOR: FilterOperator = 'EQUAL';

export const EMPTY_FILTER: ColumnFilter = { op: DEFAULT_OPERATOR, text: '' };

export const OPERATORS: Readonly<Record<FilterOperator, OperatorInfo>> = {
  EQUAL: { symbol: '=', label: 'Equals (* = any text)', hasValue: true },
  NOT_EQUAL_TO: { symbol: '≠', label: 'Does not equal (* = any text)', hasValue: true },
  CONTAINS: { symbol: '*a*', label: 'Contains', hasValue: true },
  DOES_NOT_CONTAIN: { symbol: '!*a*', label: 'Does not contain', hasValue: true },
  BEGIN_WITH: { symbol: 'a*', label: 'Begins with', hasValue: true },
  END_WITH: { symbol: '*a', label: 'Ends with', hasValue: true },
  IN: { symbol: '∈', label: 'In list', hasValue: true },
  NOT_IN: { symbol: '∉', label: 'Not in list', hasValue: true },
  GREATER_THAN: { symbol: '>', label: 'Greater than', hasValue: true },
  GREATER_THAN_OR_EQUAL_TO: { symbol: '≥', label: 'Greater than or equal', hasValue: true },
  LESS_THAN: { symbol: '<', label: 'Less than', hasValue: true },
  LESS_THAN_OR_EQUAL_TO: { symbol: '≤', label: 'Less than or equal', hasValue: true },
  BETWEEN: { symbol: 'a..b', label: 'Between (100..250)', hasValue: true },
  IS_BLANK: { symbol: '∅', label: 'Is blank', hasValue: false },
  IS_NOT_BLANK: { symbol: '!∅', label: 'Is not blank', hasValue: false },
};

/** The operator menu per column kind, in groups (a rule between each). */
export const OPERATOR_GROUPS: Readonly<Record<ColumnKind, readonly (readonly FilterOperator[])[]>> = {
  text: [
    ['EQUAL', 'NOT_EQUAL_TO'],
    ['CONTAINS', 'DOES_NOT_CONTAIN', 'BEGIN_WITH', 'END_WITH'],
    ['IN', 'NOT_IN'],
    ['IS_BLANK', 'IS_NOT_BLANK'],
  ],
  number: [
    ['EQUAL', 'NOT_EQUAL_TO'],
    ['GREATER_THAN', 'GREATER_THAN_OR_EQUAL_TO', 'LESS_THAN', 'LESS_THAN_OR_EQUAL_TO', 'BETWEEN'],
    ['IN', 'NOT_IN'],
    ['IS_BLANK', 'IS_NOT_BLANK'],
  ],
};

const NUMBER_ONLY: ReadonlySet<FilterOperator> = new Set([
  'GREATER_THAN',
  'GREATER_THAN_OR_EQUAL_TO',
  'LESS_THAN',
  'LESS_THAN_OR_EQUAL_TO',
]);

/** Longest sign first, so `>=` is never read as `>` followed by `=`. */
const TYPED_SIGNS: readonly (readonly [string, FilterOperator])[] = [
  ['>=', 'GREATER_THAN_OR_EQUAL_TO'],
  ['<=', 'LESS_THAN_OR_EQUAL_TO'],
  ['<>', 'NOT_EQUAL_TO'],
  ['!=', 'NOT_EQUAL_TO'],
  ['>', 'GREATER_THAN'],
  ['<', 'LESS_THAN'],
];

const LIST_SEPARATOR = /\r?\n|\r|\t/;
const PASTED_CELLS = /[\r\n\t]/;

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

export function isListOperator(op: FilterOperator): boolean {
  return op === 'IN' || op === 'NOT_IN';
}

/** The values of an in-list filter's text, trimmed, blanks skipped (repeats kept). */
export function listValues(text: string): string[] {
  return text
    .split(LIST_SEPARATOR)
    .map((v) => v.trim())
    .filter(Boolean);
}

/** The values with repeats removed (capitals ignored, the first spelling kept). */
export function uniqueValues(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.filter((v) => {
    const key = v.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/** The cells of a spreadsheet paste (a copied column arrives one value per
 *  line, a copied row tab-separated), repeats dropped — or null when the
 *  clipboard holds a single value, which pastes as ordinary text. */
export function pastedListValues(clipboard: string): string[] | null {
  if (!PASTED_CELLS.test(clipboard.trim())) {
    return null;
  }
  return uniqueValues(listValues(clipboard));
}

/** Typing a comparison sign first (`>=500`, `!=PIPE`) switches the operator
 *  and drops the sign. Returns null when the text has no sign, only the sign
 *  so far, or a number-only sign (`>`, `<`, `>=`, `<=`) on a text column. */
export function parseTypedOperator(text: string, kind: ColumnKind): ColumnFilter | null {
  const match = TYPED_SIGNS.find(([sign]) => text.startsWith(sign));
  if (!match || text.length === match[0].length) {
    return null;
  }

  const [sign, op] = match;
  if (NUMBER_ONLY.has(op) && kind !== 'number') {
    return null;
  }

  return { op, text: text.slice(sign.length).trimStart() };
}

/** The filter after picking another operator: blank checks drop the value,
 *  and a list of several values does not carry over to a single-value operator. */
export function withOperator(filter: ColumnFilter, op: FilterOperator): ColumnFilter {
  if (!OPERATORS[op].hasValue) {
    return { op, text: '' };
  }
  if (isListOperator(filter.op) && !isListOperator(op)) {
    const values = listValues(filter.text);
    return { op, text: values.length === 1 ? values[0] : '' };
  }

  return { op, text: filter.text };
}
