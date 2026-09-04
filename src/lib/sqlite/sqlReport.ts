// Assemble the statement list a report runs. Pure + unit-testable — no OPFS, no
// worker. The result feeds sqliteClient().execute in SHARED (read-only) lock
// mode, so the scratch tables MUST be TEMP (they land in SQLite's per-
// connection temp schema; unqualified `FILTER_ARGS` / `TREE_VIEW_ARGS` still
// resolve, and the user's data file is never written).
import type { ReportFilter, ReportType } from '../../state/sqlReports/sqlReports.state';
import { splitSqlStatements } from './sqlAttach';
import type { Statement } from './types';

/** FILTER_ARGS rows for one filter: INPUT → one (k,v); DROPDOWN → one per
 *  selected id. */
function filterRows(f: ReportFilter): [string, string][] {
  if (f.kind === 'INPUT') {
    return f.value != null && f.value !== '' ? [[f.key, f.value]] : [];
  }
  return (f.selected ?? []).map((v) => [f.key, v]);
}

/** Wrap the report's final SELECT for the consuming type. `sql` must be a bare
 *  SELECT with no trailing ';' (splitSqlStatements strips it). */
function wrapForType(sql: string, o: BuildOpts): string {
  if (o.type === 'COLORING') {
    // Project exactly the columns the coloring path uses — never `SELECT *`.
    // `fullname_color` is optional: runColoring probes the query's columns first
    // (temp view + pragma, see `colorProbe`) and passes hasColorColumn, so a
    // query without it falls back to `SELECT fullname` (each row → yellow in JS).
    // DISTINCT: a coloring result repeats fullnames freely (joins); the
    // duplicates would only cost transfer and resolve time
    if (o.hasColorColumn === false) {
      return `SELECT DISTINCT fullname FROM (${sql})`;
    }
    return `SELECT DISTINCT fullname, fullname_color FROM (${sql})`;
  }
  // DETAIL: the query wrapped to a single row, columns in SELECT order.
  if (o.type === 'DETAIL') {
    return `SELECT * FROM (${sql}) LIMIT 1`;
  }
  return `SELECT * FROM (${sql}) LIMIT ${o.loadAll ? 250000 : 50}`; // TABLE
}

export interface BuildOpts {
  filters: ReportFilter[];
  sql: string;
  type: ReportType;
  /** TABLE only: lift the 50-row cap to 250k. */
  loadAll?: boolean;
  /** COLORING: false when the column probe found no `fullname_color` column, so
   *  the wrap is `SELECT fullname` and JS defaults every row to yellow. */
  hasColorColumn?: boolean;
  /** COLORING: build the column probe (temp view + `pragma_table_info`) instead
   *  of the coloring select — the collected result is the query's column names,
   *  which decides whether the real run includes `fullname_color`. */
  colorProbe?: boolean;
  /** The fullname hierarchy → TREE_VIEW_ARGS. DETAIL passes the current
   *  selection's; every other run type seeds it from the LAST selection too
   *  (tree click, viewport pick, U / P), so a query can be checked As Table /
   *  colored with the same table a detail run would see. Omitted/empty = no
   *  table. */
  treeFullnames?: string[];
}

/** DROP/CREATE TEMP TABLE TREE_VIEW_ARGS(FULLNAME) + inserts for a tree-view
 *  path — the import-folder levels above the model AND the entry chain, i.e.
 *  every row the Hierarchy panel shows above the item (the store band is not
 *  a level). Shared by DETAIL runs and the SQL Editor / report runs (seeded
 *  from the last selection — tree click, viewport pick or U / P).
 *
 *  Rows go in LOWEST level first — the clicked item, then its parent, up to
 *  the root — because that is the order a detail query wants to read them
 *  in: the most specific match first (`… ORDER BY rowid LIMIT 1`), the
 *  ancestors as fallbacks. The hierarchy path the model DB hands out is
 *  root → leaf, so it is reversed here, in the one place both callers share. */
export function treeViewArgsStatements(fullnames: string[]): Statement[] {
  const out: Statement[] = [
    { sql: 'DROP TABLE IF EXISTS TREE_VIEW_ARGS', useStatementInLog: false },
    { sql: 'CREATE TEMP TABLE TREE_VIEW_ARGS(FULLNAME TEXT)', useStatementInLog: false },
  ];
  const names = [...fullnames].reverse().map((n) => [n] as (string | number)[]);
  if (names.length) {
    out.push({ sql: 'INSERT INTO TREE_VIEW_ARGS(FULLNAME) VALUES (?)', binding: names, useStatementInLog: false });
  }
  return out;
}

/** DROP/CREATE TEMP TABLE FILTER_ARGS(k, v) + one insert per filter value —
 *  TEMP so a read-only db is fine. Shared by report runs and the SQL Editor's
 *  raw Run, so a query reads its filters the same way either way. */
export function filterArgsStatements(filters: ReportFilter[]): Statement[] {
  const out: Statement[] = [
    { sql: 'DROP TABLE IF EXISTS FILTER_ARGS', useStatementInLog: false },
    { sql: 'CREATE TEMP TABLE FILTER_ARGS(k TEXT, v TEXT)', useStatementInLog: false },
  ];
  const rows = filters.flatMap(filterRows);
  if (rows.length) {
    out.push({ sql: 'INSERT INTO FILTER_ARGS(k, v) VALUES (?, ?)', binding: rows, useStatementInLog: false });
  }
  return out;
}

/** The full Statement[] for a run: scratch-table setup, the report's own setup
 *  statements verbatim, then the wrapped final query (the only collected one). */
export function buildReportStatements(o: BuildOpts): Statement[] {
  const out: Statement[] = [];

  // FILTER_ARGS (always)
  out.push(...filterArgsStatements(o.filters));

  // TREE_VIEW_ARGS — DETAIL always (its clicked hierarchy, possibly empty);
  // any other type when a hierarchy was supplied (the last selection)
  if (o.type === 'DETAIL' || o.treeFullnames?.length) {
    out.push(...treeViewArgsStatements(o.treeFullnames ?? []));
  }

  // the report's own SQL: all but the last statement are setup, run verbatim
  const parts = splitSqlStatements(o.sql);
  if (parts.length === 0) {
    return out;
  }
  for (let i = 0; i < parts.length - 1; i++) {
    out.push({ sql: parts[i] });
  }
  const finalSelect = parts[parts.length - 1];

  // COLORING column probe: wrap the final SELECT in a TEMP view (fine under a
  // read-only lock — temp schema), then read its column names. Lets the real run
  // include `fullname_color` only when the query actually has it.
  if (o.type === 'COLORING' && o.colorProbe) {
    out.push({ sql: 'DROP VIEW IF EXISTS _color_meta', useStatementInLog: false });
    out.push({ sql: `CREATE TEMP VIEW _color_meta AS ${finalSelect}`, useStatementInLog: false });
    out.push({ sql: "SELECT name FROM pragma_table_info('_color_meta')", collect: true });
    return out;
  }

  // COLORING rows never become row arrays: the worker packs `fullname[, color]`
  // straight into flat buffers (PackedNames) that go to the model-db worker
  out.push({ sql: wrapForType(finalSelect, o), collect: o.type === 'COLORING' ? 'packedNames' : true });
  return out;
}
