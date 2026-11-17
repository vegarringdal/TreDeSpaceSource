// The SQL Table's column filter: EQUALS by default — the whole cell, capitals
// ignored — with `*` or `%` (the SQL LIKE habit) matching any run of
// characters, so `PIPE*` starts with, `*PIPE` ends with and `*PIPE*`
// contains. Every other character is literal (`_` and `.` included — names
// are full of them). Pure, so it stays unit-testable.

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type CellMatcher = (cell: unknown) => boolean;

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const WILDCARDS = /[*%]+/;

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

function cellText(cell: unknown): string {
  return cell == null ? '' : String(cell).trim().toLowerCase();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A predicate over cell values for one column's filter text, or null when
 *  the text is blank (that column does not filter). Both sides are trimmed
 *  and compared case-insensitively; without a wildcard it is a plain string
 *  compare, with one a single anchored RegExp — built once, not per row. */
export function compileCellFilter(text: string): CellMatcher | null {
  const pattern = text.trim().toLowerCase();
  if (!pattern) {
    return null;
  }
  const parts = pattern.split(WILDCARDS);
  if (parts.length === 1) {
    return (cell) => cellText(cell) === pattern;
  }

  const rx = new RegExp(`^${parts.map(escapeRegExp).join('.*')}$`, 's');
  return (cell) => rx.test(cellText(cell));
}
