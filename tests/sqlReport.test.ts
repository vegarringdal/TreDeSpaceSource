import { describe, expect, it } from 'vitest';
import { buildReportStatements } from '../src/lib/sqlite/sqlReport';

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
