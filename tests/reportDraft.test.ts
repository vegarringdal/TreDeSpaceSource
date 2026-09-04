import { describe, expect, it } from 'vitest';
import {
  addReportFilter,
  removeReportFilter,
  setReportFilter,
  toggleReportType,
  withDatabases,
} from '../src/state/sqlReports/reportDraft';
import type { ReportDef } from '../src/state/sqlReports/sqlReports.state';

const base: ReportDef = {
  id: 'r1',
  store: 'main',
  db: 'sql_assets/main/a.db',
  name: 'n',
  description: '',
  types: ['TABLE'],
  sql: "ATTACH DATABASE 'sql_assets/main/b.db' AS b; ATTACH DATABASE 'sql_assets/main/a.db' AS a; select 1",
  databases: [],
  filters: [],
};

describe('reportDraft helpers', () => {
  it('withDatabases = main db + ATTACH literals, deduped, never empty strings', () => {
    expect(withDatabases(base).databases).toEqual(['sql_assets/main/a.db', 'sql_assets/main/b.db']);
    expect(withDatabases({ ...base, db: '', sql: 'select 1' }).databases).toEqual([]);
  });

  it('toggleReportType adds and removes without mutating', () => {
    const on = toggleReportType(base, 'DETAIL');
    expect(on.types).toEqual(['TABLE', 'DETAIL']);
    expect(toggleReportType(on, 'TABLE').types).toEqual(['DETAIL']);
    expect(base.types).toEqual(['TABLE']);
  });

  it('add / set / remove filters by position', () => {
    const one = addReportFilter(base);
    const two = addReportFilter(one);
    expect(two.filters).toEqual([
      { kind: 'INPUT', key: 'arg1', label: '' },
      { kind: 'INPUT', key: 'arg2', label: '' },
    ]);
    const edited = setReportFilter(two, 1, { kind: 'DROPDOWN', label: 'Area' });
    expect(edited.filters[1]).toEqual({ kind: 'DROPDOWN', key: 'arg2', label: 'Area' });
    expect(removeReportFilter(edited, 0).filters).toEqual([edited.filters[1]]);
  });
});
