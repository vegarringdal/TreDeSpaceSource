// SQL database commands (SQLite in OPFS, stores shared with model assets).
// See EVENTS.md for the payload contracts.
import { type SqlImportProgress, sqlAssetsActions } from '../../state/sqlAssets/sqlAssets.actions';
import { sqlAssetsState } from '../../state/sqlAssets/sqlAssets.state';
import { sqliteClient, sqlOptions } from '../sqlite/client';
import { parseAttachPaths, splitSqlStatements } from '../sqlite/sqlAttach';
import type { Statement } from '../sqlite/types';
import { fileNameFromUrl } from './handlersAssets';
import { ApiError, type ApiHandler, isRecord, requireStoreOpt, strings } from './protocol';
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
function capRows(rowsUnknown: unknown, maxRows: number) {
  const rows = (rowsUnknown ?? []) as unknown[];
  const truncated = rows.length > maxRows;
  return { rows: truncated ? rows.slice(0, maxRows) : rows, rowCount: rows.length, truncated };
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
      sqlOptions({ mainDbPath, additionalDbPaths, lockmode, statements, progressSize }),
      onProgress,
    );
    if (result.err) {
      throw new ApiError('internal', result.err.msg);
    }
    const out = statements.map((st, i) => {
      const { rows, rowCount, truncated } = capRows(result.data?.[i], maxRows);
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
        statements: statements.map((s) => ({ sql: s, collect: true })),
      }),
    );
    if (result.err) {
      throw new ApiError('internal', result.err.msg);
    }
    const out = (result.data ?? []).map((rowsUnknown, i) => {
      const { rows, rowCount, truncated } = capRows(rowsUnknown, maxRows);
      return {
        columns: result.columns[i] ?? null,
        rows,
        rowCount,
        ...(truncated ? { truncated: true } : {}),
      };
    });
    return { statements: out, ms: result.execTime };
  },
};
