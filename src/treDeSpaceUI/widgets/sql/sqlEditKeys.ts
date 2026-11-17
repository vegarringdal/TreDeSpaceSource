// Editor key behaviours as PURE text edits, so the textarea widget stays a
// thin shell and the rules are unit-testable: Tab / Shift+Tab indent and
// outdent the selected lines (or insert / remove one indent at the caret),
// Enter keeps the current line's indentation.

export const INDENT = '  ';

/** One edit: replace [replaceStart, replaceEnd) with `text`, then select
 *  [selStart, selEnd). */
export interface TextEdit {
  replaceStart: number;
  replaceEnd: number;
  text: string;
  selStart: number;
  selEnd: number;
}

const lineStartAt = (value: string, pos: number): number => value.lastIndexOf('\n', pos - 1) + 1;

const lineEndAt = (value: string, pos: number): number => {
  const i = value.indexOf('\n', pos);
  return i === -1 ? value.length : i;
};

/** The whole lines a selection touches. A selection that ends exactly at the
 *  start of a line does not include that line (as editors do), unless it is
 *  empty (a caret). */
function touchedLines(value: string, start: number, end: number): { from: number; to: number } {
  const from = lineStartAt(value, start);
  const lastPos = end > start && value[end - 1] === '\n' ? end - 1 : end;
  return { from, to: lineEndAt(value, lastPos) };
}

/** Tab: multi-line selection → indent every non-empty touched line and keep
 *  those lines selected; otherwise insert one indent at the caret (replacing
 *  a single-line selection). */
export function indentSelection(value: string, start: number, end: number): TextEdit {
  const multiLine = value.slice(start, end).includes('\n');
  if (!multiLine) {
    return {
      replaceStart: start,
      replaceEnd: end,
      text: INDENT,
      selStart: start + INDENT.length,
      selEnd: start + INDENT.length,
    };
  }
  const { from, to } = touchedLines(value, start, end);
  const text = value
    .slice(from, to)
    .split('\n')
    .map((l) => (l.length ? INDENT + l : l))
    .join('\n');
  return { replaceStart: from, replaceEnd: to, text, selStart: from, selEnd: from + text.length };
}

/** Shift+Tab: remove up to one indent (or a leading tab) from every touched
 *  line. With a caret the line is outdented in place and the caret shifts
 *  left by what was removed; a selection ends up covering the whole lines.
 *  Returns null when nothing can be removed. */
export function outdentSelection(value: string, start: number, end: number): TextEdit | null {
  const { from, to } = touchedLines(value, start, end);
  let removedFirst = 0;
  let any = false;
  const text = value
    .slice(from, to)
    .split('\n')
    .map((l, i) => {
      const m = l.match(/^(\t| {1,2})/);
      const n = m ? m[0].length : 0;
      if (i === 0) {
        removedFirst = n;
      }
      any = any || n > 0;
      return l.slice(n);
    })
    .join('\n');
  if (!any) {
    return null;
  }
  if (start === end) {
    const caret = Math.max(from, start - removedFirst);
    return { replaceStart: from, replaceEnd: to, text, selStart: caret, selEnd: caret };
  }
  return { replaceStart: from, replaceEnd: to, text, selStart: from, selEnd: from + text.length };
}

/** Enter: newline plus the current line's leading whitespace (auto-indent),
 *  replacing any selection. */
export function newlineKeepIndent(value: string, start: number, end: number): TextEdit {
  const from = lineStartAt(value, start);
  const lead = value.slice(from, start).match(/^[ \t]*/)?.[0] ?? '';
  const text = `\n${lead}`;
  return { replaceStart: start, replaceEnd: end, text, selStart: start + text.length, selEnd: start + text.length };
}
