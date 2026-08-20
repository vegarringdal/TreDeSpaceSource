// SQL database commands (SQLite in OPFS, stores shared with model assets).
// See EVENTS.md for the payload contracts.
import { sqlAssetsActions } from '../../state/sqlAssets/sqlAssets.actions';
import { sqlAssetsState } from '../../state/sqlAssets/sqlAssets.state';
import { sqliteClient, sqlOptions } from '../sqlite/client';
import { parseAttachPaths, splitSqlStatements } from '../sqlite/sqlAttach';
import { ApiError, type ApiHandler, requireStoreOpt, strings } from './protocol';

export const sqlHandlers: Record<string, ApiHandler> = {
  'sql.list': async ({ p }) => {
    const store = requireStoreOpt(p.store);
    await sqlAssetsActions.refresh(); // the filesystem IS the index — re-scan
    const dbs = sqlAssetsState
      .get()
      .dbs.filter((d) => !store || d.store === store)
      .map((d) => ({ store: d.store, fileName: d.fileName, path: d.path, size: d.size, modified: d.modified }));
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
    return await sqlAssetsActions.importDatabases([file], store, { replace });
  },

  'sql.delete': async ({ p }) => {
    const paths = strings(p.paths, 'paths');
    await sqlAssetsActions.refresh();
    return await sqlAssetsActions.deleteDatabases(paths);
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
      const rows = (rowsUnknown ?? []) as unknown[];
      const truncated = rows.length > maxRows;
      return {
        columns: result.columns[i] ?? null,
        rows: truncated ? rows.slice(0, maxRows) : rows,
        rowCount: rows.length,
        ...(truncated ? { truncated: true } : {}),
      };
    });
    return { statements: out, ms: result.execTime };
  },
};
