import { describe, expect, it } from 'vitest';
import {
  indentSelection,
  newlineKeepIndent,
  outdentSelection,
  type TextEdit,
} from '../src/treDeSpaceUI/widgets/sql/sqlEditKeys';

const apply = (v: string, e: TextEdit) => v.slice(0, e.replaceStart) + e.text + v.slice(e.replaceEnd);

describe('Tab', () => {
  it('caret: inserts one indent', () => {
    const e = indentSelection('ab', 1, 1);
    expect(apply('ab', e)).toBe('a  b');
    expect([e.selStart, e.selEnd]).toEqual([3, 3]);
  });
  it('single-line selection: replaces it with the indent', () => {
    expect(apply('abcd', indentSelection('abcd', 1, 3))).toBe('a  d');
  });
  it('multi-line: indents every non-empty touched line and selects them', () => {
    const v = 'x\nSELECT\n\nFROM t\ny';
    const e = indentSelection(v, 3, 12); // inside SELECT … inside FROM
    expect(apply(v, e)).toBe('x\n  SELECT\n\n  FROM t\ny');
    expect(v.slice(0, e.selStart)).toBe('x\n');
    expect(apply(v, e).slice(e.selStart, e.selEnd)).toBe('  SELECT\n\n  FROM t');
  });
  it('a selection ending at a line start does not indent that line', () => {
    const v = 'a\nb\nc';
    expect(apply(v, indentSelection(v, 0, 4))).toBe('  a\n  b\nc');
  });
});

describe('Shift+Tab', () => {
  it('caret: removes one indent from the line and shifts the caret', () => {
    const v = '    SELECT';
    const e = outdentSelection(v, 6, 6);
    expect(e && apply(v, e)).toBe('  SELECT');
    expect(e?.selStart).toBe(4);
  });
  it('multi-line: removes up to one indent (or a tab) per line', () => {
    const v = '  a\n\tb\n c\nd';
    const e = outdentSelection(v, 0, v.length);
    expect(e && apply(v, e)).toBe('a\nb\nc\nd');
  });
  it('nothing to remove → null', () => {
    expect(outdentSelection('a\nb', 0, 3)).toBeNull();
  });
});

describe('Enter', () => {
  it('keeps the leading whitespace of the current line', () => {
    const v = '  SELECT x';
    const e = newlineKeepIndent(v, v.length, v.length);
    expect(apply(v, e)).toBe('  SELECT x\n  ');
    expect(e.selStart).toBe(v.length + 3);
  });
  it('replaces a selection', () => {
    expect(apply('ab', newlineKeepIndent('ab', 0, 2))).toBe('\n');
  });
});
