// A Set Color filter value too long to edit by hand — a Multi list from the
// SQL Table's Add Set Color can be hundreds of thousands of lines. Putting
// that whole string in one DOM field costs megabytes and makes every render
// lag, so the editor shows only the head of it, read-only. Pure (no stores),
// so it stays unit-testable.

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type MultiValuePreview = Readonly<{
  /** Lines in the whole value (a trailing newline does not count as one). */
  lines: number;
  /** The first `maxLines` lines — what the editor shows. */
  head: string;
}>;

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** The most lines a filter value can have and still be edited in place. */
export const MULTI_EDIT_MAX_LINES = 1000;

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

/** The line count and the first `maxLines` lines of a value longer than
 *  that, or null when it is short enough to edit. One indexOf scan, no
 *  per-line strings, so it stays cheap on a multi-megabyte list. */
export function multiValuePreview(value: string, maxLines = MULTI_EDIT_MAX_LINES): MultiValuePreview | null {
  let lines = 1;
  let cut = -1;
  for (let i = value.indexOf('\n'); i !== -1; i = value.indexOf('\n', i + 1)) {
    if (lines === maxLines) {
      cut = i;
    }
    lines++;
  }
  if (value.endsWith('\n')) {
    lines--;
  }
  if (lines <= maxLines) {
    return null;
  }

  return { lines, head: value.slice(0, cut) };
}
