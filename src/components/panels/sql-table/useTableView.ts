import { useEffect, useMemo, useState } from 'react';
import { type CellMatcher, compileCellFilter, detectColumnKinds } from './cellFilter';
import {
  type ColumnFilter,
  type ColumnKind,
  defaultFilter,
  type FilterOperator,
  isListOperator,
  parseTypedOperator,
  withOperator,
} from './filterOperators';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type Sort = { col: number; dir: 'asc' | 'desc' } | null;

export type TableView = Readonly<{
  sort: Sort;
  /** One per column: what the user set, else the kind's default operator. */
  filters: readonly ColumnFilter[];
  /** Per column, detected from the values: drives the operators offered. */
  kinds: readonly ColumnKind[];
  /** Per column: whether its filter currently hides anything (blue underline). */
  isFiltering: readonly boolean[];
  colKeys: string[];
  viewIdx: number[];
  toggleSort: (col: number) => void;
  /** Typed text; a leading `>=`, `!=`… switches the operator (see parseTypedOperator). */
  setFilterText: (col: number, text: string) => void;
  setOperator: (col: number, op: FilterOperator) => void;
  /** Pasted spreadsheet cells: the column becomes in list (a not-in-list stays so). */
  setFilterList: (col: number, values: readonly string[]) => void;
}>;

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

function compare(a: unknown, b: unknown): number {
  if (a == null && b == null) {
    return 0;
  }
  if (a == null) {
    return -1;
  }
  if (b == null) {
    return 1;
  }
  const na = typeof a === 'number' ? a : Number(a);
  const nb = typeof b === 'number' ? b : Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) {
    return na - nb;
  }
  return String(a).localeCompare(String(b));
}

/** The filter of one column — the text default if the column is unknown. */
export function filterOf(filters: readonly ColumnFilter[], col: number): ColumnFilter {
  return filters[col] ?? defaultFilter('text');
}

type FilterEdits = readonly (ColumnFilter | undefined)[];

/** Click-header sort + per-column operator filters (see cellFilter; AND across
 *  filtering columns) expressed as a view over ORIGINAL row indices, plus
 *  stable React keys per column (names can repeat). Resets when a new result
 *  arrives. */
export function useTableView(columns: string[], rows: unknown[][]): TableView {
  const [sort, setSort] = useState<Sort>(null);
  // only the columns the user touched; the rest use their kind's default
  const [edits, setEdits] = useState<FilterEdits>([]);

  // reset per-result state when a new payload arrives
  useEffect(() => {
    setSort(null);
    setEdits(columns.map(() => undefined));
  }, [columns]);

  const kinds = useMemo(() => detectColumnKinds(columns.length, rows), [columns, rows]);
  const filters = useMemo(() => kinds.map((kind, c) => edits[c] ?? defaultFilter(kind)), [kinds, edits]);

  // stable, unique React keys per column (names can repeat) — used for header
  // cells AND body cells so neither has to key off the array index
  const colKeys = useMemo(() => {
    const seen = new Map<string, number>();
    return columns.map((c) => {
      const n = seen.get(c) ?? 0;
      seen.set(c, n + 1);
      return n ? `${c}#${n}` : c;
    });
  }, [columns]);

  // compiled once per filter change, never per row
  const matchers = useMemo(
    () => columns.map((_, c) => compileCellFilter(filterOf(filters, c), kinds[c])),
    [columns, filters, kinds],
  );
  const isFiltering = useMemo(() => matchers.map((m) => m !== null), [matchers]);

  // original indices → column filters (AND across filtering columns) → sort
  const viewIdx = useMemo(() => {
    let idx = rows.map((_, i) => i);
    const active: [CellMatcher, number][] = [];
    matchers.forEach((match, c) => {
      if (match) {
        active.push([match, c]);
      }
    });
    if (active.length) {
      idx = idx.filter((ri) => active.every(([match, c]) => match(rows[ri][c])));
    }
    if (sort) {
      const { col, dir } = sort;
      idx.sort((ia, ib) => {
        const c = compare(rows[ia][col], rows[ib][col]);
        return dir === 'asc' ? c : -c;
      });
    }
    return idx;
  }, [rows, matchers, sort]);

  const updateFilter = (col: number, next: (f: ColumnFilter) => ColumnFilter): void =>
    setEdits((prev) =>
      columns.map((_, k) => (k === col ? next(prev[k] ?? defaultFilter(kinds[k] ?? 'text')) : prev[k])),
    );

  const toggleSort = (col: number): void =>
    setSort((s) => (s?.col !== col ? { col, dir: 'asc' } : s.dir === 'asc' ? { col, dir: 'desc' } : null));

  const setFilterText = (col: number, text: string): void =>
    updateFilter(
      col,
      (f) => (isListOperator(f.op) ? null : parseTypedOperator(text, kinds[col])) ?? { op: f.op, text },
    );

  const setOperator = (col: number, op: FilterOperator): void => updateFilter(col, (f) => withOperator(f, op));

  const setFilterList = (col: number, values: readonly string[]): void =>
    updateFilter(col, (f) => ({ op: f.op === 'NOT_IN' ? 'NOT_IN' : 'IN', text: values.join('\n') }));

  return { sort, filters, kinds, isFiltering, colKeys, viewIdx, toggleSort, setFilterText, setOperator, setFilterList };
}
