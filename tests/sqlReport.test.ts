import { describe, expect, it } from 'vitest';
import {
  buildReportStatements,
  detailScopedSql,
  filterArgsStatements,
  pickDropdownColumns,
} from '../src/lib/sqlite/sqlReport';

const base = { filters: [], sql: 'SELECT fullname FROM t' };

describe('buildReportStatements — TREE_VIEW_ARGS seeding', () => {
  it('TABLE / COLORING get the table when a hierarchy is supplied', () => {
    for (const type of ['TABLE', 'COLORING'] as const) {
      const st = buildReportStatements({ ...base, type, treeFullnames: ['/root', '/root/leaf'] });
      const sqls = st.map((s) => s.sql);
      expect(sqls).toContain('CREATE TEMP TABLE TREE_VIEW_ARGS(FULLNAME TEXT)');
      const ins = st.find((s) => s.sql.startsWith('INSERT INTO TREE_VIEW_ARGS'));
      // lowest level first
      expect(ins?.binding).toEqual([['/root/leaf'], ['/root']]);
    }
  });

  it('TABLE without a pick has no table; DETAIL always creates it', () => {
    const table = buildReportStatements({ ...base, type: 'TABLE', treeFullnames: [] });
    expect(table.some((s) => s.sql.includes('TREE_VIEW_ARGS'))).toBe(false);
    const detail = buildReportStatements({ ...base, type: 'DETAIL', treeFullnames: [] });
    expect(detail.map((s) => s.sql)).toContain('CREATE TEMP TABLE TREE_VIEW_ARGS(FULLNAME TEXT)');
    expect(detail.some((s) => s.sql.startsWith('INSERT INTO TREE_VIEW_ARGS'))).toBe(false);
  });
});

describe('detailScopedSql — the editor\'s As Detail wrap', () => {
  const WRAP = 'where fullname in (select fullname from TREE_VIEW_ARGS) limit 1';

  it('leaves SQL that reads TREE_VIEW_ARGS as written', () => {
    const sql = 'SELECT * FROM t WHERE fullname IN (SELECT FULLNAME FROM tree_view_args)';
    expect(detailScopedSql(sql)).toBe(sql);
  });

  it('wraps a plain select to the clicked fullname', () => {
    expect(detailScopedSql('SELECT fullname, tag FROM t;')).toBe(`select * from (SELECT fullname, tag FROM t) ${WRAP}`);
  });

  it('a mention in a comment does not count', () => {
    const out = detailScopedSql('-- uses TREE_VIEW_ARGS later\nSELECT * FROM t');
    expect(out.endsWith(WRAP)).toBe(true);
  });

  it('keeps setup statements and wraps only the last', () => {
    const out = detailScopedSql('CREATE TEMP TABLE x AS SELECT 1 AS fullname; SELECT * FROM x');
    expect(out).toBe(`CREATE TEMP TABLE x AS SELECT 1 AS fullname;\nselect * from (SELECT * FROM x) ${WRAP}`);
  });

  it('empty SQL stays empty', () => {
    expect(detailScopedSql('  ')).toBe('  ');
  });
});

describe('filterArgsStatements — a dropdown\'s own search term', () => {
  const filters = [
    { kind: 'DROPDOWN' as const, key: 'arg1', label: '', selected: ['old-1', 'old-2'] },
    { kind: 'INPUT' as const, key: 'arg2', label: '', value: 'elec' },
  ];

  it('seeds a selection per row without a search', () => {
    const ins = filterArgsStatements(filters).find((s) => s.sql.startsWith('INSERT'));
    expect(ins?.binding).toEqual([
      ['arg1', 'old-1'],
      ['arg1', 'old-2'],
      ['arg2', 'elec'],
    ]);
  });

  it('a single-select dropdown binds at most one id', () => {
    const single = [{ ...filters[0], single: true }];
    const ins = filterArgsStatements(single).find((s) => s.sql.startsWith('INSERT'));
    expect(ins?.binding).toEqual([['arg1', 'old-1']]);
  });

  it('the searched key carries the term instead of its selection', () => {
    const ins = filterArgsStatements(filters, { key: 'arg1', value: 'pum' }).find((s) => s.sql.startsWith('INSERT'));
    expect(ins?.binding).toEqual([
      ['arg1', 'pum'],
      ['arg2', 'elec'],
    ]);
  });
});

describe('pickDropdownColumns — which column is the id', () => {
  const pick = (cols: string[] | null) => pickDropdownColumns(cols);

  it('reads named columns in any order', () => {
    expect(pick(['label', 'id'])).toEqual({ idIdx: 1, labelIdx: 0 });
    expect(pick(['id', 'label'])).toEqual({ idIdx: 0, labelIdx: 1 });
  });

  it('keeps the documented (id, value) pair', () => {
    expect(pick(['id', 'value'])).toEqual({ idIdx: 0, labelIdx: 1 });
    // `value` is the stored id only when `label` claims the shown text
    expect(pick(['label', 'value'])).toEqual({ idIdx: 1, labelIdx: 0 });
    expect(pick(['value', 'label'])).toEqual({ idIdx: 0, labelIdx: 1 });
  });

  it('falls back to the positional reading for unnamed columns', () => {
    expect(pick(['tag_id', 'tag_name'])).toEqual({ idIdx: 0, labelIdx: 1 });
    expect(pick(null)).toEqual({ idIdx: 0, labelIdx: 0 });
  });

  it('pairs a single named column with the first column left', () => {
    expect(pick(['descr', 'id'])).toEqual({ idIdx: 1, labelIdx: 0 });
    expect(pick(['a', 'b', 'label'])).toEqual({ idIdx: 0, labelIdx: 2 });
    expect(pick(['id'])).toEqual({ idIdx: 0, labelIdx: 0 });
  });

  it('ignores case and surrounding blanks', () => {
    expect(pick([' Label ', 'ID'])).toEqual({ idIdx: 1, labelIdx: 0 });
  });
});
