// SQL Reports — saved queries with filter inputs, whose result drives a table,
// a coloring of the loaded model, or a click-following detail form. Reports are
// grouped by STORE: all of a store's reports live in one file,
// sql_assets/<store>/SQL_Reports.json. The panel selects a store first, then
// shows/edits that store's reports; see sqlReports.actions.ts.
import { createStore } from '@treDeSpaceUI/lib/createStore';

export type ReportType = 'TABLE' | 'COLORING' | 'DETAIL';

/** A form input that fills FILTER_ARGS(k,v) before the report SQL runs. */
export interface ReportFilter {
  kind: 'INPUT' | 'DROPDOWN';
  /** FILTER_ARGS.k — the report SQL reads `select v from FILTER_ARGS where k='…'`. */
  key: string;
  label: string;
  /** INPUT: the current text value. */
  value?: string;
  /** DROPDOWN: default bind for dropdownSql when the search box is empty (usually '%'). */
  searchValue?: string;
  /** DROPDOWN: `select <id>, <value> …` — first 25 shown; `?` binds the search term. */
  dropdownSql?: string;
  /** DROPDOWN: selected ids → one FILTER_ARGS row each. */
  selected?: string[];
}

export interface ReportDef {
  id: string;
  /** The store this report belongs to — decides which SQL_Reports.json holds it. */
  store: string;
  /** Main database path (sql_assets/<store>/<file>), or '' for None (the report
   *  runs off ATTACH'd files only, against an in-memory scratch db). */
  db: string;
  name: string;
  description: string;
  types: ReportType[];
  sql: string;
  /** Every real db the SQL touches (main, if any, + ATTACH paths) — collected on
   *  save, used to take the right locks when running. Never contains ''. */
  databases: string[];
  filters: ReportFilter[];
}

export interface SqlReportsState {
  /** The selected store — the panel shows/edits only this store's reports.
   *  Null until the user picks one (the panel shows a "pick a store" hint). */
  store: string | null;
  /** Reports for the selected store (the loaded SQL_Reports.json). */
  reports: ReportDef[];
  ready: boolean;
  /** The single expanded accordion row. */
  openId: string | null;
  /** The report currently in edit mode (id, or 'new' while creating). */
  editId: string | null;
  /** Search box text (filters the list by name/description). */
  query: string;
  /** A report is running (buttons disabled meanwhile). */
  busy: boolean;
}

export const sqlReportsState = createStore<SqlReportsState>({
  store: null,
  reports: [],
  ready: false,
  openId: null,
  editId: null,
  query: '',
  busy: false,
});

/** A blank report in a store, with no main db (None) by default. */
export function emptyReport(id: string, store: string, db = ''): ReportDef {
  return {
    id,
    store,
    db,
    name: 'New report',
    description: '',
    types: ['TABLE'],
    sql: 'SELECT * FROM sqlite_master;',
    databases: db ? [db] : [],
    filters: [],
  };
}
