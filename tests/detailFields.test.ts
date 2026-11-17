// SQL Detail field rows: a JSON-array column flattens into one row per
// element (labels may repeat), http(s) values carry a link, and anything that
// is not a well-formed array stays a plain value.
import { describe, expect, it } from 'vitest';
import {
  buildDetailFields,
  isEmptyValue,
  matchesFilter,
} from '../src/components/panels/sql-detail/detailFields';

const docs = JSON.stringify([
  { label: 'DOC1', value: 'https://docs.example.com/id-1', value_link_label: 'title 1' },
  { label: 'DOC1', value: 'https://docs.example.com/id-2' },
  { label: 'NOTE', value: 'plain text' },
]);

describe('buildDetailFields', () => {
  it('flattens a JSON array column in place, one row per element', () => {
    const fields = buildDetailFields(['fullname', 'data', 'after'], ['/A/B', docs, 'x']);
    expect(fields.map((f) => f.label)).toEqual(['fullname', 'DOC1', 'DOC1', 'NOTE', 'after']);
    expect(fields.map((f) => f.col)).toEqual(['fullname', 'data', 'data', 'data', 'after']);
    expect(new Set(fields.map((f) => f.key)).size).toBe(fields.length);
  });

  it('links http(s) values: element link label, else the URL, "Open link" for a plain column', () => {
    const [, first, second, note] = buildDetailFields(['fullname', 'data'], ['/A/B', docs]);
    expect(first.href).toBe('https://docs.example.com/id-1');
    expect(first.linkLabel).toBe('title 1');
    expect(second.linkLabel).toBe('https://docs.example.com/id-2');
    expect(note.href).toBeUndefined();
    const [plain] = buildDetailFields(['url'], [' http://example.com/x ']);
    expect(plain.href).toBe('http://example.com/x');
    expect(plain.linkLabel).toBe('Open link');
  });

  it('never links other schemes', () => {
    const [f] = buildDetailFields(['v'], ['javascript:alert(1)']);
    expect(f.href).toBeUndefined();
    expect(f.val).toBe('javascript:alert(1)');
  });

  it('leaves malformed or non-array JSON as a plain value', () => {
    const rows = buildDetailFields(['a', 'b', 'c'], ['[not json', '{"label":"x"}', 42]);
    expect(rows.map((f) => f.val)).toEqual(['[not json', '{"label":"x"}', 42]);
    expect(rows.map((f) => f.label)).toEqual(['a', 'b', 'c']);
  });

  it('handles primitive elements, shapeless objects, missing labels and empty arrays', () => {
    const fields = buildDetailFields(
      ['tags', 'raw', 'nolabel', 'none'],
      ['["p1","p2"]', '[{"foo":1}]', '[{"value":"v"}]', '[]'],
    );
    expect(fields.map((f) => [f.label, f.val])).toEqual([
      ['tags', 'p1'],
      ['tags', 'p2'],
      ['raw', '{"foo":1}'],
      ['nolabel', 'v'],
      ['none', null],
    ]);
  });
});

describe('filters', () => {
  it('matches label, column, value and link text', () => {
    const [, first] = buildDetailFields(['fullname', 'data'], ['/A/B', docs]);
    expect(matchesFilter(first, 'doc1')).toBe(true);
    expect(matchesFilter(first, 'data')).toBe(true);
    expect(matchesFilter(first, 'id-1')).toBe(true);
    expect(matchesFilter(first, 'title 1')).toBe(true);
    expect(matchesFilter(first, 'zzz')).toBe(false);
    expect(matchesFilter(first, '')).toBe(true);
  });

  it('treats null and the empty string as empty', () => {
    expect(isEmptyValue(null)).toBe(true);
    expect(isEmptyValue(undefined)).toBe(true);
    expect(isEmptyValue('')).toBe(true);
    expect(isEmptyValue(0)).toBe(false);
    expect(isEmptyValue('x')).toBe(false);
  });
});
