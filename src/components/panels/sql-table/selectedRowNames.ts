// The SQL Table's selected rows as the names the model understands: the
// `fullname` column, plus a per-row colour from `fullname_color` when the
// result has one — the same two columns a COLORING report returns. Pure (no
// stores), so it stays unit-testable.
import { parseColorToken } from '../../../lib/color/hexColor';
import { type PackedNames, PackedNamesBuilder } from '../../../lib/color/packedNames';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** One distinct fullname and its colour token (`yellow`, `#ff0000:50`), or
 *  null when the row has no usable colour — the rule's own colour applies. */
export type RowName = Readonly<{
  name: string;
  color: string | null;
}>;

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

export const NAME_COLUMN = 'fullname';
export const COLOR_COLUMN = 'fullname_color';

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

/** Index of `name` among the result columns (case-insensitive), or -1. */
export function findColumn(columns: readonly string[], name: string): number {
  const want = name.toLowerCase();
  return columns.findIndex((c) => c.toLowerCase() === want);
}

function cellText(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

/** The fullnames of `rowIdx` (in that order), blanks skipped and duplicates
 *  dropped case-insensitively — a joined result repeats names freely. The
 *  first row of a name decides its colour; a colour cell that does not parse
 *  counts as none, like the coloring buttons read it. `colorCol` -1 = the
 *  result has no colour column. */
export function rowNames(
  rows: readonly (readonly unknown[])[],
  rowIdx: readonly number[],
  nameCol: number,
  colorCol: number,
): RowName[] {
  const seen = new Set<string>();
  const out: RowName[] = [];
  for (const ri of rowIdx) {
    const row = rows[ri];
    const name = cellText(row?.[nameCol]);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) {
      continue;
    }
    seen.add(key);
    const token = colorCol < 0 ? '' : cellText(row?.[colorCol]);
    out.push({ name, color: token && parseColorToken(token) ? token : null });
  }
  return out;
}

/** The names as a PackedNames list — what the coloring and selection applies take. */
export function packRowNames(names: readonly RowName[]): PackedNames {
  const b = new PackedNamesBuilder();
  for (const n of names) {
    b.pushWithToken(n.name, n.color);
  }
  return b.finish();
}

/** The names as a Set Color Multi filter value: one `name` or `name<TAB>color`
 *  line each, the two-column paste grammar the filter reads. */
export function multiFilterValue(names: readonly RowName[]): string {
  return names.map((n) => (n.color ? `${n.name}\t${n.color}` : n.name)).join('\n');
}
