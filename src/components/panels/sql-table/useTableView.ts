import { useEffect, useMemo, useState } from 'react';

export type Sort = { col: number; dir: 'asc' | 'desc' } | null;

export type TableView = Readonly<{
  sort: Sort;
  filters: string[];
  colKeys: string[];
  viewIdx: number[];
  toggleSort: (col: number) => void;
  setFilter: (col: number, value: string) => void;
}>;

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

/** Click-header sort + per-column contains filters (AND across filled
 *  columns) expressed as a view over ORIGINAL row indices, plus stable React
 *  keys per column (names can repeat). Resets when a new result arrives. */
export function useTableView(columns: string[], rows: unknown[][]): TableView {
  const [sort, setSort] = useState<Sort>(null);
  const [filters, setFilters] = useState<string[]>(() => columns.map(() => ''));

  // reset per-result state when a new payload arrives
  useEffect(() => {
    setSort(null);
    setFilters(columns.map(() => ''));
  }, [columns]);

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

  // original indices → contains-filter (AND across filled columns) → sort
  const viewIdx = useMemo(() => {
    let idx = rows.map((_, i) => i);
    const active: [string, number][] = [];
    filters.forEach((f, c) => {
      const t = f.trim().toLowerCase();
      if (t) {
        active.push([t, c]);
      }
    });
    if (active.length) {
      idx = idx.filter((ri) =>
        active.every(([t, c]) =>
          String(rows[ri][c] ?? '')
            .toLowerCase()
            .includes(t),
        ),
      );
    }
    if (sort) {
      const { col, dir } = sort;
      idx.sort((ia, ib) => {
        const c = compare(rows[ia][col], rows[ib][col]);
        return dir === 'asc' ? c : -c;
      });
    }
    return idx;
  }, [rows, filters, sort]);

  const toggleSort = (col: number): void =>
    setSort((s) => (s?.col !== col ? { col, dir: 'asc' } : s.dir === 'asc' ? { col, dir: 'desc' } : null));

  const setFilter = (col: number, value: string): void =>
    setFilters((prev) => prev.map((f, k) => (k === col ? value : f)));

  return { sort, filters, colKeys, viewIdx, toggleSort, setFilter };
}
