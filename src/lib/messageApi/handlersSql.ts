// SQL database commands (SQLite in OPFS, stores shared with model assets).
// See EVENTS.md for the payload contracts.
import {
  bindDetailReport,
  detailPanelId,
  getDetailAutoRemove,
  openSqlDetailPanel,
} from '../../components/panels/sql-detail/sqlDetailPanel';
import { openSqlEditorPanelBesideViewport } from '../../components/panels/sql-editor/sqlEditorPanel';
import { openSqlTablePanel } from '../../components/panels/sql-table/sqlTablePanel';
import { type SqlImportProgress, sqlAssetsActions } from '../../state/sqlAssets/sqlAssets.actions';
import { sqlAssetsState } from '../../state/sqlAssets/sqlAssets.state';
import { sqlEditorActions } from '../../state/sqlAssets/sqlEditor.actions';
import { sqlEditorState } from '../../state/sqlAssets/sqlEditor.state';
import { withDatabases } from '../../state/sqlReports/reportDraft';
import { type SqlRunOpts, sqlReportsActions } from '../../state/sqlReports/sqlReports.actions';
import type { ReportDef, ReportFilter } from '../../state/sqlReports/sqlReports.state';
import { sqliteClient, sqlOptions } from '../sqlite/client';
import { parseAttachPaths, splitSqlStatements } from '../sqlite/sqlAttach';
import type { Statement } from '../sqlite/types';
import { parseColorMode } from './colorMode';
import { fileNameFromUrl } from './handlersAssets';
import { ApiError, type ApiHandler, isRecord, records, requireStoreOpt, strings } from './protocol';
import { editorDraftPayload, parseEditorDraft } from './sqlEditorPayload';
import { emitApiEvent } from './transport';

/** Progress plumbing shared by `sql.import` and `sql.importUrl`: a host that
 *  passes `progress: true` (the SDK sets it with `onProgress`) gets a
 *  `sql.importUrl:progress` event per file AND per download chunk, and the
 *  viewer keeps its own dialogs down. */
function sqlProgressOpts(p: Record<string, unknown>): { quiet?: boolean; onProgress?: (t: SqlImportProgress) => void } {
  const quiet = p.progress === true;
  if (!quiet) {
    return {};
  }
  const batchId = typeof p.batchId === 'string' ? p.batchId : undefined;
  return {
    quiet,
    onProgress: (tick: SqlImportProgress) =>
      emitApiEvent('sql.importUrl:progress', { ...(batchId ? { batchId } : {}), ...tick }),
  };
}

/** Validate one `sql.execute` statement into the worker's `Statement` shape —
 *  the same contract the SQL editor and the original sqllitedebug tool use:
 *  `sql`, optional `name` (echoed in results and progress), `binding` (one
 *  array of values per execution — several rows = the statement is prepared
 *  once and stepped per row), `collect` (keep the rows). */
function parseStatement(v: unknown, i: number): Statement {
  if (!isRecord(v) || typeof v.sql !== 'string' || !v.sql.trim()) {
    throw new ApiError('bad-payload', `statements[${i}].sql must be a non-empty string`);
  }
  let binding: (string | number)[][] | undefined;
  if (v.binding !== undefined) {
    if (!Array.isArray(v.binding)) {
      throw new ApiError('bad-payload', `statements[${i}].binding must be an array of value arrays`);
    }
    binding = v.binding.map((row, r) => {
      if (!Array.isArray(row)) {
        throw new ApiError('bad-payload', `statements[${i}].binding[${r}] must be an array`);
      }
      return row.map((cell, c) => {
        // null rides as a bound NULL; anything else must be a scalar sqlite can bind
        if (cell === null) {
          return cell as unknown as string;
        }
        if (typeof cell !== 'string' && typeof cell !== 'number') {
          throw new ApiError('bad-payload', `statements[${i}].binding[${r}][${c}] must be a string, number or null`);
        }
        return cell;
      });
    });
  }
  return {
    sql: v.sql,
    ...(typeof v.name === 'string' ? { name: v.name } : {}),
    ...(binding ? { binding } : {}),
    collect: v.collect === true,
  };
}

/** Rows capped per statement, with the pre-cut count kept — shared by
 *  `sql.query` and `sql.execute`. */
/** The worker already kept at most `maxRows` (Statement.maxRows); `rowCount`
 *  is what the statement really returned. */
function capRows(rowsUnknown: unknown, rowCount: number | undefined) {
  const rows = (rowsUnknown ?? []) as unknown[];
  const total = rowCount ?? rows.length;
  return { rows, rowCount: total, truncated: total > rows.length };
}

// -----------------------------------------------------------------------------
// report-shaped commands (color / select / table / detail)
// -----------------------------------------------------------------------------
// These reuse the SQL Reports pipeline the editor's buttons run on, so a host
// gets the SAME packed transfer: the query's fullnames go SQL worker → model
// DB as flat buffers and the rows never cross the postMessage boundary.

/** `filters` → FILTER_ARGS rows. A `value` is one row; `values` is one row per
 *  entry (what a report's DROPDOWN produces), for `… IN (SELECT v FROM
 *  FILTER_ARGS WHERE k='…')`. */
function parseFilters(v: unknown): ReportFilter[] {
  if (v === undefined) {
    return [];
  }
  return records(v, 'filters').map((f, i) => {
    const key = typeof f.key === 'string' ? f.key.trim() : '';
    if (!key) {
      throw new ApiError('bad-payload', `filters[${i}].key must be a non-empty string`);
    }
    if (Array.isArray(f.values)) {
      return { kind: 'DROPDOWN', key, label: key, selected: strings(f.values, `filters[${i}].values`) };
    }
    if (typeof f.value !== 'string' && typeof f.value !== 'number') {
      throw new ApiError('bad-payload', `filters[${i}] needs a string/number \`value\` or a string[] \`values\``);
    }
    return { kind: 'INPUT', key, label: key, value: String(f.value) };
  });
}

/** A throwaway ReportDef for one API call. `mainDb` may be omitted when the
 *  SQL only ATTACHes files (the reports panel's "None" main db). */
async function apiReport(p: Record<string, unknown>, name: string): Promise<ReportDef> {
  const sql = typeof p.sql === 'string' ? p.sql : '';
  if (!sql.trim()) {
    throw new ApiError('bad-payload', 'sql is required');
  }
  const mainDb = typeof p.mainDb === 'string' ? p.mainDb : '';
  const attach = p.attach === undefined ? [] : strings(p.attach, 'attach');
  await sqlAssetsActions.refresh();
  const known = new Set(sqlAssetsState.get().dbs.map((d) => d.path));
  for (const path of [...(mainDb ? [mainDb] : []), ...attach]) {
    if (!known.has(path)) {
      throw new ApiError('not-found', `no database at "${path}" — call sql.list first`);
    }
  }
  const databases = [...new Set([mainDb, ...attach, ...parseAttachPaths(sql)].filter(Boolean))];
  if (!databases.length) {
    throw new ApiError('bad-payload', 'mainDb is required unless the sql ATTACHes a database');
  }
  return {
    id: 'api',
    store: '',
    db: mainDb,
    name,
    description: '',
    types: ['COLORING'],
    sql,
    databases,
    filters: parseFilters(p.filters),
  };
}

/** The database `sql.editor` should point the panel at: an explicit `mainDb`
 *  path, or `store` + `fileName` (what a host knows without building OPFS
 *  paths). '' is the panel's "None — attach only". undefined = leave the
 *  editor's current pick alone. */
async function editorMainDb(p: Record<string, unknown>): Promise<string | undefined> {
  const store = typeof p.store === 'string' ? p.store.trim() : '';
  const fileName = typeof p.fileName === 'string' ? p.fileName.trim() : '';
  if (typeof p.mainDb === 'string') {
    if (!p.mainDb) {
      return ''; // explicit None
    }
    await sqlAssetsActions.refresh();
    if (!sqlAssetsState.get().dbs.some((d) => d.path === p.mainDb)) {
      throw new ApiError('not-found', `no database at "${p.mainDb}" — call sql.list first`);
    }
    return p.mainDb;
  }
  if (!store && !fileName) {
    return undefined;
  }
  if (!store || !fileName) {
    throw new ApiError('bad-payload', 'store and fileName go together (or pass a mainDb path)');
  }
  await sqlAssetsActions.refresh();
  const hit = sqlAssetsState.get().dbs.find((d) => d.store === store && d.fileName === fileName);
  if (!hit) {
    throw new ApiError('not-found', `no database "${fileName}" in store "${store}" — call sql.list first`);
  }
  return hit.path;
}

/** `progress: true` runs the query without viewer dialogs and streams row
 *  ticks back as events instead — the convention the import commands use. */
function runOpts(p: Record<string, unknown>, event: string): SqlRunOpts {
  if (p.progress !== true) {
    return {};
  }
  const batchId = typeof p.batchId === 'string' ? p.batchId : undefined;
  return {
    quiet: true,
    onRows: (rows) => emitApiEvent(event, { ...(batchId ? { batchId } : {}), rows }),
  };
}

/** Run the coloring query and hand back the packed list, or fail the command
 *  with the query's own error. */
async function packedFor(p: Record<string, unknown>, name: string, event: string) {
  const report = await apiReport(p, name);
  const opts = runOpts(p, event);
  const t0 = performance.now();
  const res = await sqlReportsActions.runColoringResult(report, opts);
  if (res.error || !res.packed) {
    throw new ApiError('internal', res.error ?? 'the coloring query returned nothing');
  }
  return { packed: res.packed, opts, ms: Math.round(performance.now() - t0) };
}

export const sqlHandlers: Record<string, ApiHandler> = {
  'sql.list': async ({ p }) => {
    const store = requireStoreOpt(p.store);
    await sqlAssetsActions.refresh(); // the filesystem IS the index — re-scan
    const dbs = sqlAssetsState
      .get()
      .dbs.filter((d) => !store || d.store === store)
      .map((d) => ({
        store: d.store,
        fileName: d.fileName,
        path: d.path,
        size: d.size,
        modified: d.modified,
        ...(d.md5 ? { md5: d.md5 } : {}),
        ...(d.meta ? { meta: d.meta } : {}),
      }));
    return { dbs };
  },

  'sql.import': async ({ p, bytes }) => {
    if (!(bytes instanceof ArrayBuffer) && !(bytes instanceof Blob)) {
      throw new ApiError('bad-payload', 'bytes must be an ArrayBuffer or Blob');
    }
    const fileName = typeof p.fileName === 'string' ? p.fileName : '';
    if (!fileName) {
      throw new ApiError('bad-payload', 'fileName is required');
    }
    const store = requireStoreOpt(p.store) ?? 'main';
    const replace = p.replace === true;
    const file = new File([bytes], fileName);
    // structured result (imported / skipped / replaced) — a same-name file
    // with replace:false is a legitimate skip, not an error, so don't throw.
    return await sqlAssetsActions.importDatabases([file], store, {
      replace,
      ...(isRecord(p.meta) ? { meta: p.meta } : {}),
      ...sqlProgressOpts(p),
    });
  },

  'sql.importUrl': async ({ p }) => {
    const raw = p.files;
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new ApiError('bad-payload', 'files must be a non-empty array');
    }
    const files = raw.map((f, i) => {
      if (!isRecord(f) || typeof f.url !== 'string' || !f.url) {
        throw new ApiError('bad-payload', `files[${i}].url must be a string`);
      }
      const fileName =
        typeof f.fileName === 'string' && f.fileName ? f.fileName : fileNameFromUrl(f.url, `file-${i}.db`);
      return { url: f.url, fileName, ...(isRecord(f.meta) ? { meta: f.meta } : {}) };
    });
    const store = requireStoreOpt(p.store) ?? 'main';
    const replace = p.replace === true;
    // structured result (imported / skipped / replaced / failed) — skips and
    // per-file download failures are recorded, never thrown.
    return await sqlAssetsActions.importDatabasesFromUrls(files, store, {
      replace,
      ...sqlProgressOpts(p),
    });
  },

  'sql.delete': async ({ p }) => {
    const paths = strings(p.paths, 'paths');
    await sqlAssetsActions.refresh();
    return await sqlAssetsActions.deleteDatabases(paths);
  },

  'sql.check': async ({ p }) => {
    const sql = typeof p.sql === 'string' ? p.sql : '';
    if (!sql.trim()) {
      throw new ApiError('bad-payload', 'sql is required');
    }
    const mainDb = typeof p.mainDb === 'string' && p.mainDb ? [p.mainDb] : [];
    await sqlAssetsActions.refresh();
    const byPath = new Map(sqlAssetsState.get().dbs.map((d) => [d.path, d] as const));
    // mainDb first (when given), then ATTACH literals in appearance order
    const paths = [...new Set([...mainDb, ...parseAttachPaths(sql)])];
    const dbs = paths.map((path) => {
      const d = byPath.get(path);
      if (!d) {
        return { path, exists: false };
      }
      return { path, exists: true, size: d.size, modified: d.modified, ...(d.md5 ? { md5: d.md5 } : {}) };
    });
    return { dbs };
  },

  // Full statement form (the SQL editor's / sqllitedebug's contract): several
  // statements in ONE transaction on the same files, per-statement bindings
  // and collect flags, optional progress per statement and per row.
  'sql.execute': async ({ p }) => {
    const mainDbPath = typeof p.mainDb === 'string' ? p.mainDb : '';
    if (!mainDbPath) {
      throw new ApiError('bad-payload', 'mainDb is required (a path from sql.list)');
    }
    if (!Array.isArray(p.statements) || p.statements.length === 0) {
      throw new ApiError('bad-payload', 'statements must be a non-empty array');
    }
    const statements = p.statements.map(parseStatement);
    await sqlAssetsActions.refresh();
    const known = new Set(sqlAssetsState.get().dbs.map((d) => d.path));
    if (!known.has(mainDbPath)) {
      throw new ApiError('not-found', `no database at "${mainDbPath}" — call sql.list first`);
    }
    // files to lock alongside: explicit `attach` paths plus every ATTACH
    // literal in any statement (the same scan sql.query and the editor use)
    const attach = p.attach === undefined ? [] : strings(p.attach, 'attach');
    for (const a of attach) {
      if (!known.has(a)) {
        throw new ApiError('not-found', `no database at "${a}" (attach) — call sql.list first`);
      }
    }
    const scanned = statements.flatMap((st) => parseAttachPaths(st.sql));
    const additionalDbPaths = [...new Set([...attach, ...scanned])].filter((path) => path !== mainDbPath);
    const lockmode = p.lockmode === 'exclusive' ? 'exclusive' : 'shared';
    const maxRows = typeof p.maxRows === 'number' && p.maxRows > 0 ? Math.floor(p.maxRows) : 10_000;

    // progress: STATEMENT ticks are per statement; ROW ticks every
    // `progressSize` rows (the worker gates BOTH on a non-zero size)
    const progress = p.progress === true;
    const batchId = typeof p.batchId === 'string' ? p.batchId : undefined;
    const progressSize = progress
      ? typeof p.progressSize === 'number' && p.progressSize > 0
        ? Math.floor(p.progressSize)
        : 1000
      : 0;
    const total = statements.length;
    const onProgress = progress
      ? (type: 'STATEMENT' | 'ROW', no: number, tot: number | null) =>
          emitApiEvent('sql.execute:progress', {
            ...(batchId ? { batchId } : {}),
            type: type === 'STATEMENT' ? 'statement' : 'row',
            no,
            total: type === 'STATEMENT' ? total : tot,
            // a STATEMENT tick reports the statement that just FINISHED; a ROW
            // tick has no index from the worker, so it names nothing
            ...(type === 'STATEMENT' && statements[no]?.name ? { name: statements[no].name } : {}),
          })
      : undefined;

    const result = await sqliteClient().execute(
      sqlOptions({
        mainDbPath,
        additionalDbPaths,
        lockmode,
        statements: statements.map((st) => (st.collect ? { ...st, maxRows } : st)),
        progressSize,
      }),
      onProgress,
    );
    if (result.err) {
      throw new ApiError('internal', result.err.msg);
    }
    const out = statements.map((st, i) => {
      const { rows, rowCount, truncated } = capRows(result.data?.[i], result.rowCounts?.[i]);
      return {
        ...(st.name ? { name: st.name } : {}),
        columns: result.columns[i] ?? null,
        rows: st.collect ? rows : [],
        rowCount: st.collect ? rowCount : 0,
        ...(st.collect && truncated ? { truncated: true } : {}),
      };
    });
    return { statements: out, ms: result.execTime };
  },

  'sql.query': async ({ p }) => {
    const sql = typeof p.sql === 'string' ? p.sql : '';
    if (!sql.trim()) {
      throw new ApiError('bad-payload', 'sql is required');
    }
    const mainDbPath = typeof p.mainDb === 'string' ? p.mainDb : '';
    if (!mainDbPath) {
      throw new ApiError('bad-payload', 'mainDb is required (a path from sql.list)');
    }
    await sqlAssetsActions.refresh();
    if (!sqlAssetsState.get().dbs.some((d) => d.path === mainDbPath)) {
      throw new ApiError('not-found', `no database at "${mainDbPath}" — call sql.list first`);
    }
    const lockmode = p.lockmode === 'exclusive' ? 'exclusive' : 'shared';
    const maxRows = typeof p.maxRows === 'number' && p.maxRows > 0 ? Math.floor(p.maxRows) : 10_000;
    const statements = splitSqlStatements(sql);
    if (!statements.length) {
      return { statements: [], ms: 0 };
    }
    // ATTACH'd files are locked alongside the main db, exactly as the editor does
    const additionalDbPaths = parseAttachPaths(sql).filter((path) => path !== mainDbPath);
    const result = await sqliteClient().execute(
      sqlOptions({
        mainDbPath,
        additionalDbPaths,
        lockmode,
        statements: statements.map((s) => ({ sql: s, collect: true, maxRows })),
      }),
    );
    if (result.err) {
      throw new ApiError('internal', result.err.msg);
    }
    const out = (result.data ?? []).map((rowsUnknown, i) => {
      const { rows, rowCount, truncated } = capRows(rowsUnknown, result.rowCounts?.[i]);
      return {
        columns: result.columns[i] ?? null,
        rows,
        rowCount,
        ...(truncated ? { truncated: true } : {}),
      };
    });
    return { statements: out, ms: result.execTime };
  },

  // Colour the model FROM a query — the editor's Color White / Hidden / Set
  // buttons over the API. The result never leaves the viewer: the host gets
  // the row count.
  'sql.color': async ({ p }) => {
    const mode = parseColorMode(p.mode);
    const { packed, opts, ms } = await packedFor(p, 'api color', 'sql.color:progress');
    await sqlReportsActions.colorPackedMode(packed, mode, opts);
    return { mode: mode.type, rows: packed.count, ms };
  },

  // Select what a query returns (fullname column), packed all the way into the
  // model DB. `append` adds to the current selection.
  'sql.select': async ({ p }) => {
    const { packed, ms } = await packedFor(p, 'api select', 'sql.select:progress');
    const r = await sqlReportsActions.colorSelection(packed, { append: p.append === true });
    return { rows: packed.count, matched: r.matched, missed: r.missed, ms };
  },

  // Push a query's result into the SQL Table panel. The rows land in the
  // panel, not in the response — the host gets the shape only.
  'sql.table': async ({ p }) => {
    const report = await apiReport(p, typeof p.name === 'string' && p.name.trim() ? p.name.trim() : 'API query');
    const res = await sqlReportsActions.runTable(report, p.loadAll === true, runOpts(p, 'sql.table:progress'));
    if (res.error) {
      throw new ApiError('internal', res.error);
    }
    if (p.show !== false) {
      openSqlTablePanel();
    }
    return { columns: res.columns, rows: res.rows.length };
  },

  // Put SQL into the SQL Editor panel — for a host that wants the USER to see,
  // tweak and run a query rather than running it headless. `store` +
  // `fileName` (or a `mainDb` path) also point the editor at a database, and
  // `title` / `description` / `types` / `filters` fill the draft's report
  // fields (the shape `sql.editor.get` hands out, so a stored draft restores).
  'sql.editor': async ({ p }) => {
    const sql = typeof p.sql === 'string' ? p.sql : '';
    if (!sql.trim()) {
      throw new ApiError('bad-payload', 'sql is required');
    }
    const draft = parseEditorDraft(p);
    if (draft.error) {
      throw new ApiError('bad-payload', draft.error);
    }
    const mainDb = await editorMainDb(p);
    if (mainDb !== undefined) {
      sqlEditorActions.setMainDbPath(mainDb);
    }
    const replace = p.replace !== false;
    const name = typeof p.name === 'string' ? p.name : undefined;
    const text = sqlEditorActions.setEditorSql(sql, { replace, ...(name === undefined ? {} : { name }) });
    if (draft.patch && Object.keys(draft.patch).length) {
      sqlEditorActions.patch(draft.patch);
    }
    if (p.show !== false) {
      openSqlEditorPanelBesideViewport();
    }
    return { replaced: replace, mainDb: sqlEditorState.get().draft.db, chars: text.length };
  },

  // Read the SQL Editor's draft — title, description, main db, types, SQL and
  // filters, plus the databases a run would lock — in the shape `sql.editor`
  // takes back, so a host can store it (the editor has no Save) and restore it.
  'sql.editor.get': () => editorDraftPayload(withDatabases(sqlEditorState.get().draft)),

  // Bind a query to a SQL Detail panel: every hierarchy click runs it against
  // the clicked node (write it against TREE_VIEW_ARGS). A `name` gives the
  // query its OWN panel, titled with that name — calling again with the same
  // name re-binds that panel instead of opening another; without a name the
  // built-in SQL Detail panel is used.
  'sql.detail': async ({ p }) => {
    const name = typeof p.name === 'string' ? p.name.trim() : '';
    // only an EXPLICIT autoRemove overrides: re-binding a new query to a panel
    // the user has switched to Keep must not silently revert their choice
    const autoRemove = typeof p.autoRemove === 'boolean' ? p.autoRemove : undefined;
    const report = await apiReport(p, name || 'API detail');
    bindDetailReport({ ...report, types: ['DETAIL'] }, name, autoRemove);
    if (p.show !== false) {
      openSqlDetailPanel(name, name || 'SQL Detail');
    }
    return { bound: true, name: report.name, panel: detailPanelId(name), autoRemove: getDetailAutoRemove(name) };
  },
};
