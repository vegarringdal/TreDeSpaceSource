// Text forms of a SQL Table result for the clipboard and for file names. Pure.

const MAX_FILE_STEM = 80;
const FALLBACK_FILE_STEM = 'sql-table';

/** A cell as text: null / undefined → '' (what a sheet shows), else String(). */
export function cellText(v: unknown): string {
  return v == null ? '' : String(v);
}

/** A TSV cell — quoted (quotes doubled) only when it holds a tab, newline or
 *  quote, so a paste into a spreadsheet lands one value per cell. */
function tsvCell(v: unknown): string {
  const s = cellText(v);
  return /[\t\n\r"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Header + rows as tab-separated lines — what a spreadsheet pastes as columns. */
export function toTsv(columns: readonly string[], rows: readonly (readonly unknown[])[]): string {
  const lines = [columns.map(tsvCell).join('\t')];
  for (const row of rows) {
    lines.push(row.map(tsvCell).join('\t'));
  }
  return lines.join('\n');
}

/** `<title>.<ext>` with the characters no file system takes (and control
 *  characters) replaced, whitespace collapsed, and a fallback stem for an
 *  empty title. */
export function exportFileName(title: string, ext: string): string {
  const stem = title
    .replace(/[\\/:*?"<>|]|\p{Cc}/gu, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_FILE_STEM)
    .trim();
  return `${stem || FALLBACK_FILE_STEM}.${ext}`;
}
