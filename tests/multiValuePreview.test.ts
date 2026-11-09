import { describe, expect, it } from 'vitest';
import { MULTI_EDIT_MAX_LINES, multiValuePreview } from '../src/components/panels/multi-color/multiValuePreview';

const lines = (n: number): string => Array.from({ length: n }, (_, i) => `/ITEM-${i + 1}`).join('\n');

describe('multiValuePreview', () => {
  it('leaves a value of up to the limit editable', () => {
    expect(multiValuePreview('')).toBeNull();
    expect(multiValuePreview('/A')).toBeNull();
    expect(multiValuePreview(lines(MULTI_EDIT_MAX_LINES))).toBeNull();
    expect(multiValuePreview(`${lines(MULTI_EDIT_MAX_LINES)}\n`)).toBeNull();
  });

  it('cuts a longer value to its first lines and counts them all', () => {
    const p = multiValuePreview(lines(MULTI_EDIT_MAX_LINES + 1));
    expect(p?.lines).toBe(MULTI_EDIT_MAX_LINES + 1);
    expect(p?.head).toBe(lines(MULTI_EDIT_MAX_LINES));
  });

  it('honours a custom limit and ignores a trailing newline', () => {
    expect(multiValuePreview('a\nb\nc', 2)).toEqual({ lines: 3, head: 'a\nb' });
    expect(multiValuePreview('a\nb\n', 2)).toBeNull();
    expect(multiValuePreview('a\tred\nb\nc\nd\n', 2)).toEqual({ lines: 4, head: 'a\tred\nb' });
  });

  it('handles a 450k-line list', () => {
    const p = multiValuePreview(lines(450_000));
    expect(p?.lines).toBe(450_000);
    expect(p?.head.split('\n')).toHaveLength(MULTI_EDIT_MAX_LINES);
  });
});
