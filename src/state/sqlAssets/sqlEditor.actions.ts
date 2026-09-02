// Running the SQL Editor's script.
//
// Which files get locked is NOT guesswork: the main database is the one picked
// in the panel, and every other file must appear in an `ATTACH DATABASE '…'`
// literal, which parseAttachPaths extracts exactly. Those paths go to the
// worker client, which takes a Web Lock per file (the same key SQL Assets uses
// for import/delete) before any handle is opened.

import { dialogs } from '../../components/dialogs/dialogs.actions';
import { consoleActions } from '../../components/panels/console/console.actions';
import { bindDetailReport, openSqlDetailPanel } from '../../components/panels/sql-detail/sqlDetailPanel';
import { openSqlTablePanel } from '../../components/panels/sql-table/sqlTablePanel';
import { killSqliteWorker, sqliteClient, sqlOptions } from '../../lib/sqlite/client';
import { parseAttachPaths, splitSqlStatements } from '../../lib/sqlite/sqlAttach';
import { treeViewArgsStatements } from '../../lib/sqlite/sqlReport';
import { lastSelectedTree, sqlReportsActions } from '../sqlReports/sqlReports.actions';
import type { ReportDef } from '../sqlReports/sqlReports.state';
import { sqlEditorState } from './sqlEditor.state';
import { killHint } from './sqlKillHint';

/** The SQL an action should run: the highlighted selection when there is one,
 *  otherwise the whole editor text. Lets you run just one of several statements. */
function effectiveSql(): string {
  const { sql, selStart, selEnd } = sqlEditorState.get();
  const a = Math.max(0, Math.min(selStart, sql.length));
  const b = Math.max(0, Math.min(selEnd, sql.length));
  return b > a ? sql.slice(a, b) : sql;
}

/** Wrap the editor's current SQL (selection or all) as a transient report so it
 *  can flow through the same table / coloring / detail consumers a saved report
 *  uses. Returns null (after a dialog) when no main db is picked. */
function editorReport(): ReportDef | null {
  const { mainDbPath } = sqlEditorState.get();
  const sql = effectiveSql();
  return {
    id: '__editor__',
    // transient report — never persisted, so store is irrelevant. mainDbPath
    // may be '' (None): the report runs off ATTACH'd files only.
    store: '',
    db: mainDbPath,
    name: 'SQL Editor',
    description: '',
    types: ['TABLE', 'COLORING', 'DETAIL'],
    sql,
    databases: [...new Set([mainDbPath, ...parseAttachPaths(sql)].filter(Boolean))],
    filters: [],
  };
}

/** Rows come back as arrays/objects from sqlite; print them compactly. */
function logRows(name: string, rows: unknown[]) {
  consoleActions.log('info', `SQL: ${name} → ${rows.length} row(s)`);
  for (const row of rows) {
    consoleActions.log('info', `  ${JSON.stringify(row)}`);
  }
}

/** The rule under an appended block's title — wide enough to read as a
 *  separator in the editor's monospace gutter. */
const BANNER = '-'.repeat(49);

/** A titled SQL block: two rules around the name, then the statement. */
function titledBlock(sql: string, name: string): string {
  return `${BANNER}\n-- ${name}\n${BANNER}\n\n${sql}`;
}

export const sqlEditorActions = {
  setMainDbPath(mainDbPath: string) {
    sqlEditorState.set({ mainDbPath });
  },

  setSql(sql: string) {
    sqlEditorState.set({ sql });
  },

  /** Host API `sql.editor`: put SQL into the panel. Replacing swaps the whole
   *  script; appending adds it below the current one as a titled block, so a
   *  host can stack several queries a user can read and run one by one. The
   *  text selection is reset either way — a stale one would make the action
   *  buttons run a slice of the OLD script. Returns the resulting text. */
  setEditorSql(sql: string, opts: { replace?: boolean; name?: string } = {}): string {
    const body = sql.trim();
    const current = sqlEditorState.get().sql;
    const replace = opts.replace !== false;
    const block = opts.name !== undefined || !replace ? titledBlock(body, opts.name?.trim() || 'sql') : body;
    const next = replace || !current.trim() ? block : `${current.replace(/\s+$/, '')}\n\n${block}`;
    sqlEditorState.set({ sql: next, selStart: 0, selEnd: 0 });
    return next;
  },

  /** Track the editor's text selection — the action buttons run only the
   *  highlighted text when start<end. */
  setSelection(start: number, end: number) {
    sqlEditorState.set({ selStart: start, selEnd: end });
  },

  toggleLockmode() {
    sqlEditorState.set((s) => ({ lockmode: s.lockmode === 'shared' ? 'exclusive' : 'shared' }));
  },

  /** Run the editor's script against the selected database. Everything —
   *  rows, logs, errors — goes to the Console panel for now. */
  async run() {
    const s = sqlEditorState.get();
    if (s.running) {
      return;
    }
    const sql = effectiveSql(); // selection if any, else the whole editor
    const statements = splitSqlStatements(sql);
    if (!statements.length) {
      return;
    }

    // Seed TREE_VIEW_ARGS from the last viewport click so a query can read it
    // (e.g. testing a detail SELECT) without clicking the model again.
    const tree = await lastSelectedTree();
    const setup = tree.length ? treeViewArgsStatements(tree) : [];

    const additionalDbPaths = parseAttachPaths(sql).filter((p) => p !== s.mainDbPath);
    sqlEditorState.set({ running: true, lastError: '' });
    consoleActions.log(
      'info',
      `SQL: running ${statements.length} statement(s) on ${s.mainDbPath || '(no main db)'}${
        additionalDbPaths.length ? ` (+ ${additionalDbPaths.join(', ')})` : ''
      }${tree.length ? ` — TREE_VIEW_ARGS seeded with ${tree.length} level(s)` : ''} — ${s.lockmode} lock`,
    );
    const hint = killHint();
    dialogs.loading(`Running query…${hint}`, 'SQL Editor');
    try {
      const result = await sqliteClient().execute(
        sqlOptions({
          mainDbPath: s.mainDbPath,
          additionalDbPaths,
          lockmode: s.lockmode,
          statements: [...setup, ...statements.map((sql) => ({ sql, collect: true }))],
          progressSize: 2000,
        }),
        // live row counter — the worker emits every 2000 collected rows
        (kind, no) => {
          if (kind === 'ROW') {
            dialogs.loading(`Collected ${no.toLocaleString()} rows…${hint}`, 'SQL Editor');
          }
        },
      );
      let rows = 0;
      if (result.data) {
        // skip the injected TREE_VIEW_ARGS setup statements so numbering matches
        // the user's own statements
        result.data.slice(setup.length).forEach((r, i) => {
          const list = (r ?? []) as unknown[];
          rows += list.length;
          logRows(`statement ${i + 1}`, list);
        });
      }
      for (const line of result.logs ?? []) {
        consoleActions.log('info', `  ${line}`);
      }
      sqlEditorState.set({
        lastMs: result.execTime,
        lastRows: rows,
        lastError: result.err?.msg ?? '',
      });
      if (result.err) {
        const detail = result.err.err instanceof Error ? result.err.err.message : String(result.err.err ?? '');
        consoleActions.log('error', `SQL: ${result.err.msg}${detail ? ` — ${detail}` : ''}`);
        dialogs.error(`${result.err.msg}${detail ? `\n${detail}` : ''}`, 'SQL failed');
      } else {
        consoleActions.log(
          'info',
          `SQL: done in ${result.execTime.toFixed(0)} ms (worker ${result.execTimeWorker.toFixed(0)} ms), ${rows} row(s)`,
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      sqlEditorState.set({ lastError: msg });
      consoleActions.log('error', `SQL: ${msg}`);
      dialogs.error(msg, 'SQL failed');
    } finally {
      dialogs.hideLoading();
      sqlEditorState.set({ running: false });
    }
  },

  /** Terminate the worker — the escape hatch for a query that won't end. Its
   *  file locks are released with it. */
  kill() {
    killSqliteWorker();
    sqlEditorState.set({ running: false, lastError: 'worker killed' });
    consoleActions.log('warn', 'SQL: worker killed — locks released');
  },

  // -----------------------------------------------------------------------------
  // route the editor's SQL through the report consumers
  // -----------------------------------------------------------------------------

  /** Run the current SQL and show it in the SQL Table panel. */
  async asTable() {
    const r = editorReport();
    if (!r) {
      return;
    }
    await sqlReportsActions.runTable(r);
    openSqlTablePanel();
  },

  /** White base coat + the result as a colored Multi highlight in Set Color. */
  async colorWhite() {
    const r = editorReport();
    if (!r) {
      return;
    }
    const rows = await sqlReportsActions.runColoring(r);
    if (rows) {
      await sqlReportsActions.colorWhite(rows);
    }
  },

  /** Opacity-0 base coat + the result colored (default yellow): isolates the
   *  returned rows, like Color White but hiding the rest instead of whitening. */
  async colorHidden() {
    const r = editorReport();
    if (!r) {
      return;
    }
    const rows = await sqlReportsActions.runColoring(r);
    if (rows) {
      await sqlReportsActions.colorHidden(rows);
    }
  },

  /** White base at 10% + the result colored: like Color White, but the rest of
   *  the model stays faintly visible instead of going flat white. */
  async colorTransparent() {
    const r = editorReport();
    if (!r) {
      return;
    }
    const rows = await sqlReportsActions.runColoring(r);
    if (rows) {
      await sqlReportsActions.colorTransparent(rows);
    }
  },

  /** Append a per-row Multi rule (fullname + fullname_color) to Set Color and run it. */
  async colorSet() {
    const r = editorReport();
    if (!r) {
      return;
    }
    const rows = await sqlReportsActions.runColoring(r);
    if (rows) {
      await sqlReportsActions.colorSetColor(rows);
    }
  },

  /** Bind the current SQL to the SQL Detail panel — clicks run it against the
   *  clicked hierarchy (write `… WHERE fullname IN (SELECT FULLNAME FROM TREE_VIEW_ARGS)`).
   *  `debug` (ALT+click) prints the SQL just bound, so you can verify it was set. */
  asDetail(debug = false) {
    const r = editorReport();
    if (!r) {
      return;
    }
    bindDetailReport(r);
    if (debug) {
      sqlReportsActions.logDetailSql(r);
    }
    openSqlDetailPanel();
  },
};
