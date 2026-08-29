// SQL Reports actions: load/save (one SQL_Reports.json per store), run a report
// in read-only mode, and dispatch its result to the table / coloring / detail
// consumers.

import { dialogs } from '../../components/dialogs/dialogs.actions';
import { consoleActions } from '../../components/panels/console/console.actions';
import { ruleToSpec } from '../../components/panels/multi-color/multiColor.actions';
import { type ColorRule, multiColorState } from '../../components/panels/multi-color/multiColor.state';
import { setTablePayload } from '../../components/panels/sql-table/sqlTablePanel';
import { parseColor } from '../../lib/color/hexColor';
import type { PackedNames } from '../../lib/color/packedNames';
import type { ColorRuleSpec } from '../../lib/modeldb/modeldbWorker';
import { readJson, sqlStoreDir, writeJson } from '../../lib/opfs/opfs';
import { sqliteClient, sqlOptions } from '../../lib/sqlite/client';
import { parseAttachPaths, splitSqlStatements, stripSqlComments } from '../../lib/sqlite/sqlAttach';
import { buildReportStatements } from '../../lib/sqlite/sqlReport';
import type { Statement } from '../../lib/sqlite/types';
import { killHint } from '../sqlAssets/sqlKillHint';
import { viewerActions } from '../viewer/viewer.actions';
import { type ReportDef, type ReportType, sqlReportsState } from './sqlReports.state';

/** A rule matching EVERYTHING (blank Contains) with a given color/opacity — the
 *  base coat for White (white/1) and Hidden (default/0). */
function everythingRule(o: { color: string | null; opacity: number }): ColorRule {
  return {
    comment: '',
    enabled: true,
    filters: [{ op: 'append', mode: 'contains', value: '', comment: '', level: 0 }],
    color: o.color,
    opacity: o.opacity,
    store: '',
  };
}

/** The sql result as ONE appended rule: a `packed` filter carrying the flat
 *  fullname list with its per-row colors/opacity. Rows without a color get
 *  the rule color — yellow, as the two-column Multi paste defaults. The
 *  worker reads it exactly like a Multi filter + perNameColor, minus the
 *  strings. */
function packedSpec(p: PackedNames): ColorRuleSpec {
  return {
    filters: [{ op: 'append', mode: 'packed', value: '', packed: p, level: 0 }],
    colorRGBA8: parseColor('yellow'),
    opacityPct: null,
  };
}

/** Run LOCAL (unsaved) rule specs the same way the panel's Run does:
 *  applyColorRules (reset clears overrides first, append layers). Behind the
 *  "please wait" dialog. Never touches panel state. */
async function runColorSpecs(label: string, specs: ColorRuleSpec[], mode: 'reset' | 'append' | 'hide') {
  await timedColor(label, () => viewerActions.applyColorRules(specs, mode));
}

/** Run a coloring apply behind a "please wait" dialog and log how long it took
 *  (the apply can churn over hundreds of thousands of items). */
async function timedColor(label: string, run: () => Promise<unknown>) {
  const t0 = performance.now();
  dialogs.loading('Applying to the model… please wait', 'Set Color');
  try {
    await run();
  } finally {
    dialogs.hideLoading();
  }
  consoleActions.log('info', `Set Color: ${label} in ${(performance.now() - t0).toFixed(0)} ms`);
}

/** One file per store holds all of that store's reports. */
const REPORTS_FILE = 'SQL_Reports.json';

async function readStoreReports(store: string): Promise<ReportDef[]> {
  const dir = await sqlStoreDir(store);
  const list = (await readJson<ReportDef[]>(dir, REPORTS_FILE)) ?? [];
  // stamp the store in case of a hand-edited file, and default missing fields
  return list.map((r) => ({ ...r, store, db: r.db ?? '', databases: r.databases ?? [] }));
}

async function writeStoreReports(store: string, reports: ReportDef[]) {
  const dir = await sqlStoreDir(store);
  await writeJson(dir, REPORTS_FILE, reports);
}

/** The report's own ATTACH statements — prepended before a filter's dropdown
 *  SQL so it can see the attached databases even when the report has no main db. */
function attachSetup(sql: string): Statement[] {
  return splitSqlStatements(sql)
    .filter((s) => /^\s*attach\b/i.test(stripSqlComments(s).trimStart()))
    .map((s) => ({ sql: s, useStatementInLog: false }));
}

/** The last (collected) statement's result. */
interface RunResult {
  columns: string[];
  rows: unknown[][];
  /** the flat fullname list when the statement collected `packedNames` */
  packed: PackedNames | null;
  error?: string;
}

async function execReport(
  report: ReportDef,
  type: ReportType,
  extra: {
    loadAll?: boolean;
    tree?: string[];
    hasColorColumn?: boolean;
    colorProbe?: boolean;
    progress?: boolean;
  },
): Promise<RunResult> {
  const statements = buildReportStatements({
    filters: report.filters,
    sql: report.sql,
    type,
    loadAll: extra.loadAll,
    hasColorColumn: extra.hasColorColumn,
    colorProbe: extra.colorProbe,
    treeFullnames: extra.tree,
  });
  // report.db may be '' (None) → an in-memory scratch main; every real db is in
  // report.databases (never contains ''), so additional = databases minus main.
  const additionalDbPaths = report.databases.filter((p) => p !== report.db);
  const t0 = performance.now();
  const hint = killHint();
  if (extra.progress) {
    dialogs.loading(`Running query…${hint}`, `Report: ${report.name}`);
  }
  try {
    const result = await sqliteClient().execute(
      sqlOptions({
        mainDbPath: report.db,
        additionalDbPaths,
        lockmode: 'shared',
        statements,
        progressSize: extra.progress ? 2000 : 0,
      }),
      // live row counter — the worker emits every 2000 collected rows
      extra.progress
        ? (kind, no) => {
            if (kind === 'ROW') {
              dialogs.loading(`Collected ${no.toLocaleString()} rows…${hint}`, `Report: ${report.name}`);
            }
          }
        : undefined,
    );
    return finishExec(result, performance.now() - t0);
  } finally {
    if (extra.progress) {
      dialogs.hideLoading();
    }
  }
}

function finishExec(result: Awaited<ReturnType<ReturnType<typeof sqliteClient>['execute']>>, _ms: number): RunResult {
  if (result.err) {
    const detail = result.err.err instanceof Error ? result.err.err.message : String(result.err.err ?? '');
    return { columns: [], rows: [], packed: null, error: `${result.err.msg}${detail ? ` — ${detail}` : ''}` };
  }
  const last = (result.data?.length ?? 0) - 1;
  const rows = (last >= 0 ? (result.data?.[last] as unknown[][]) : []) ?? [];
  const columns = (last >= 0 ? result.columns?.[last] : null) ?? [];
  const packed = (last >= 0 ? result.packed?.[last] : null) ?? null;
  return { columns, rows, packed };
}

export const sqlReportsActions = {
  /** Load the selected store's reports (SQL_Reports.json). No store → empty. */
  async refresh(store: string | null = sqlReportsState.get().store) {
    if (!store) {
      sqlReportsState.set({ reports: [], ready: true });
      return;
    }
    const reports = await readStoreReports(store);
    sqlReportsState.set({ reports, ready: true });
  },

  /** Switch the panel to a store (or none) and load its reports. */
  async setStore(store: string | null) {
    sqlReportsState.set({ store, openId: null, editId: null, query: '' });
    await this.refresh(store);
  },

  setQuery(query: string) {
    sqlReportsState.set({ query });
  },
  setOpen(openId: string | null) {
    sqlReportsState.set({ openId });
  },
  setEdit(editId: string | null) {
    sqlReportsState.set({ editId });
  },

  /** Insert/replace a report and persist its store's SQL_Reports.json. */
  async save(report: ReportDef) {
    const databases = [...new Set([report.db, ...parseAttachPaths(report.sql)].filter(Boolean))];
    const next: ReportDef = { ...report, databases };
    sqlReportsState.set((s) => {
      const exists = s.reports.some((r) => r.id === next.id);
      return { reports: exists ? s.reports.map((r) => (r.id === next.id ? next : r)) : [...s.reports, next] };
    });
    await writeStoreReports(
      next.store,
      sqlReportsState.get().reports.filter((r) => r.store === next.store),
    );
    consoleActions.log('info', `Reports: saved "${next.name}"`);
  },

  async remove(id: string) {
    const report = sqlReportsState.get().reports.find((r) => r.id === id);
    if (!report) {
      return;
    }
    sqlReportsState.set((s) => ({ reports: s.reports.filter((r) => r.id !== id), editId: null, openId: null }));
    await writeStoreReports(
      report.store,
      sqlReportsState.get().reports.filter((r) => r.store === report.store),
    );
    consoleActions.log('warn', `Reports: deleted "${report.name}"`);
  },

  /** Run the DROPDOWN filter's SQL to fill its async Select (≤25 rows). The
   *  report's ATTACH statements run first, so the dropdown works whether the
   *  report has a main db or None. The first two columns are id + value. */
  async dropdownOptions(
    report: ReportDef,
    sql: string,
    query: string,
    searchValue: string,
  ): Promise<{ value: string; label: string }[]> {
    const bind = query.trim() ? query : searchValue || '%';
    const additionalDbPaths = report.databases.filter((p) => p !== report.db);
    const result = await sqliteClient().execute(
      sqlOptions({
        mainDbPath: report.db,
        additionalDbPaths,
        lockmode: 'shared',
        statements: [
          ...attachSetup(report.sql),
          { sql: `SELECT * FROM (${sql.replace(/;\s*$/, '')}) LIMIT 25`, binding: [[bind]], collect: true },
        ],
      }),
    );
    if (result.err) {
      throw new Error(result.err.msg);
    }
    // the dropdown select is the LAST statement (setup ATTACHes precede it)
    const last = (result.data?.length ?? 0) - 1;
    const rows = (last >= 0 ? (result.data?.[last] as unknown[][]) : []) ?? [];
    return rows.map((r) => ({ value: String(r[0]), label: String(r[1] ?? r[0]) }));
  },

  // -----------------------------------------------------------------------------
  // consumers
  // -----------------------------------------------------------------------------

  /** TABLE: run and push into the SQL Table panel. */
  async runTable(report: ReportDef, loadAll = false) {
    sqlReportsState.set({ busy: true });
    try {
      const res = await execReport(report, 'TABLE', { loadAll, progress: true });
      if (res.error) {
        dialogs.error(res.error, 'Report failed');
        return;
      }
      setTablePayload({
        title: report.name,
        columns: res.columns,
        rows: res.rows,
        truncated: !loadAll && res.rows.length >= 50,
        reload: loadAll ? null : () => void sqlReportsActions.runTable(report, true),
      });
    } finally {
      sqlReportsState.set({ busy: false });
    }
  },

  /** COLORING: run and return the result as a PackedNames list for the color
   *  buttons — the rows never exist as strings here. A cheap column probe
   *  (temp view + pragma) runs first so the real query projects
   *  `fullname, fullname_color` only when the color column exists — never
   *  `SELECT *` — and a query without it (or a NULL cell) defaults to yellow. */
  async runColoring(report: ReportDef): Promise<PackedNames | null> {
    sqlReportsState.set({ busy: true });
    try {
      // 1) probe the query's output columns (temp view + pragma_table_info)
      const meta = await execReport(report, 'COLORING', { colorProbe: true });
      if (meta.error) {
        dialogs.error(meta.error, 'Report failed');
        return null;
      }
      const cols = meta.rows.map((r) => String(r[0] ?? '').toLowerCase());
      if (!cols.includes('fullname')) {
        dialogs.error('The coloring query must return a "fullname" column.', 'Report failed');
        return null;
      }
      const hasColorColumn = cols.includes('fullname_color');

      // 2) run for real, projecting fullname[, fullname_color] per the probe —
      // the worker packs them straight into flat buffers
      const res = await execReport(report, 'COLORING', { hasColorColumn, progress: true });
      if (res.error) {
        dialogs.error(res.error, 'Report failed');
        return null;
      }
      if (!res.packed) {
        dialogs.error('The coloring query returned no packed result.', 'Report failed');
        return null;
      }
      return res.packed;
    } finally {
      sqlReportsState.set({ busy: false });
    }
  },

  /** DETAIL: run against the clicked fullname hierarchy, return the one row. */
  async runDetail(report: ReportDef, tree: string[]): Promise<RunResult> {
    return execReport(report, 'DETAIL', { tree });
  },

  /** ALT+click on a Detail button — print the SQL just bound to SQL Detail, so
   *  it's clear WHAT got set (and whether it's the query you expect). */
  logDetailSql(report: ReportDef) {
    consoleActions.log('info', `SQL Detail bound "${report.name}" on ${report.databases.join(', ')}`);
    consoleActions.log('info', `  SQL: ${report.sql}`);
  },

  // -----------------------------------------------------------------------------
  // coloring apply (the 4 buttons)
  // -----------------------------------------------------------------------------
  // Each builds a LOCAL Set Color config (ColorRule[] + mode) in memory and runs
  // it through the very pipeline the Set Color panel uses (ruleToSpec →
  // applyColorRules). The panel's own state is never touched.

  /** White base coat + the result as a colored highlight. Fresh reset-mode
   *  run: rule 1 appends white (opacity 1) over everything, rule 2 appends
   *  the packed result. */
  async colorWhite(p: PackedNames) {
    if (!p.count) {
      return;
    }
    await runColorSpecs(
      'white base + highlight',
      [ruleToSpec(everythingRule({ color: '#ffffff', opacity: 1 })), packedSpec(p)],
      'reset',
    );
  },

  /** Isolate the result. Same as colorWhite but the base rule fades everything
   *  to opacity 0 (default color) instead of white; the packed result (opacity
   *  restored) then re-shows the hits with their own colors. */
  async colorHidden(p: PackedNames) {
    if (!p.count) {
      return;
    }
    await runColorSpecs('hidden', [ruleToSpec(everythingRule({ color: null, opacity: 0 })), packedSpec(p)], 'reset');
  },

  /** Layer the result ON TOP of the LIVE Set Color config: the panel's
   *  enabled rules as specs (its state is only read), the packed result
   *  appended as one extra rule, run in the panel's own reset/append mode.
   *  Nothing is saved back to the panel. */
  async colorSetColor(p: PackedNames) {
    if (!p.count) {
      return;
    }
    const config = multiColorState.get();
    const specs = config.rules.filter((r) => r.enabled).map(ruleToSpec);
    specs.push(packedSpec(p));
    await runColorSpecs('set color', specs, config.mode);
  },

  async colorSelection(p: PackedNames) {
    if (!p.count) {
      return;
    }
    await viewerActions.selectByPacked(p);
  },
};
