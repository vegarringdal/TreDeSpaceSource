// SQLite worker. Ported from the reference project (temp_ref/sqllitedebug-main)
// with one behavioural fix: files are keyed by their FULL OPFS path so nested
// paths (sql_assets/<store>/<db>) work — see SyncOpfsVfs.
import sqlite3InitModule, { type Database, type Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import { type PackedNames, PackedNamesBuilder, packedTransferables } from '../color/packedNames';
import { LogCollector } from './LogCollector';
import { type FileMap, SyncOpfsVfs } from './SyncOpfsVfs';
import type { ProgressCallback, SqlExecuteOption, SqlWorkerResult, WorkerMessageEvent } from './types';

/**
 * worker sqliteInstance
 */
let sqlite3: Sqlite3Static | null = null;

/** postMessage, typed against the worker protocol; `transfer` moves buffers
 *  (a packed result) instead of cloning them. */
const post = (msg: WorkerMessageEvent, transfer: Transferable[] = []): void =>
  globalThis.postMessage(msg, { transfer });

// supress internal logs
(globalThis as Record<string, unknown>).sqlite3ApiConfig = {
  // define any or all of these:
  warn: () => {},
  error: () => {},
  debug: () => {},
  log: () => {},
};

/**
 * helper for creating sync file handle
 * @param fileFullPath
 * @param lockmode
 * @returns
 */
/** Remove one OPFS file (missing file / open handle elsewhere = non-fatal). */
async function deleteOpfsFile(fileFullPath: string, logger: LogCollector) {
  try {
    const parts = fileFullPath.split('/').filter(Boolean);
    const name = parts.pop();
    if (!name) {
      return;
    }
    let dir = await navigator.storage.getDirectory();
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part);
    }
    await dir.removeEntry(name);
    logger.log(`journal removed: ${fileFullPath}`);
  } catch {
    // never existed or already gone — fine
  }
}

async function createSyncFileHandle(
  fileFullPath: string,
  lockmode: 'read-only' | 'readwrite',
  logger: LogCollector,
  isJournal = false,
) {
  const parts = fileFullPath.split('/');
  let fileName = parts.pop() || 'unknown'; // last part is the file name
  fileName = isJournal ? `${fileName}-journal` : fileName;

  try {
    const root = await navigator.storage.getDirectory();
    let currentDir = root;

    for (const part of parts) {
      if (part) {
        // skip empty strings from leading slashes
        currentDir = await currentDir.getDirectoryHandle(part, { create: true });
      }
    }

    logger.log(`filehandle created: ${[...parts.filter(Boolean), fileName].join('/')}, lockmode:${lockmode}`);

    const dbFileHandle = await currentDir.getFileHandle(fileName, {
      create: true,
    });

    // @ts-expect-error - not supported everywhere/standard
    const syncHandle = await dbFileHandle.createSyncAccessHandle({
      mode: lockmode,
    });

    return {
      data: {
        // FULL path (proper separators) — the VFS looks files up by
        // the exact name SQLite was given, so `sql_assets/a/x.db` and
        // `sql_assets/b/x.db` can be attached together
        fullpath: [...parts.filter(Boolean), fileName].join('/'),
        syncHandle,
      },
    };
  } catch (err) {
    return {
      data: null,
      err: {
        err,
        msg: `unable to create sync handle: ${[...parts.filter(Boolean), fileName].join('/')}, with lockMode:${lockmode}`,
      },
    };
  }
}

/**
 * helper to check if sharedMode is possible
 */
async function testSharedMode() {
  const logger = new LogCollector(0, 'init', false, false, [0, 0]);

  try {
    {
      const syncHandleResult = await createSyncFileHandle('temp/sharedModeTest.db', 'read-only', logger);
      if (syncHandleResult.err) {
        throw syncHandleResult.err.err;
      }
    }
    {
      const syncHandleResult = await createSyncFileHandle('temp/sharedModeTest.db', 'read-only', logger);
      if (syncHandleResult.err) {
        throw syncHandleResult.err.err;
      }
    }
  } catch (_) {
    post({
      id: 0,
      type: 'SHARED_MODE_DISABLED',
    });
  } finally {
    post({
      id: 0,
      type: 'SHARED_MODE_ENABLED',
    });
  }
}
testSharedMode(); // not perfect.. top level await cant be use in iife..

/**
 * worker message handler
 * @param e
 */
globalThis.onmessage = async (e) => {
  const data = e.data as WorkerMessageEvent;
  if (data.type === 'EXECUTE') {
    const progressSize = data.options.progressSize;

    const result = await execute(data.options, data.id, data.logtime, (type, no, total) => {
      if (!data.options.progressSize) {
        return;
      }

      if (type === 'ROW' && no % progressSize !== 0) {
        return;
      }

      post({
        id: data.id,
        result: {
          type,
          no,
          total,
        },
        type: 'PROGRESS',
      });
    });
    post(
      {
        id: data.id,
        result,
        type: 'RESULT',
      },
      (result.packed ?? []).flatMap((p) => (p ? packedTransferables(p) : [])),
    );
  }
};

/**
 * executor for sql, create instance/vfs and runs sql
 * @param options
 * @returns
 */
async function execute(
  options: SqlExecuteOption,
  id: number,
  logtime: readonly [number, number],
  progressCallback: ProgressCallback,
): Promise<SqlWorkerResult> {
  /**
   * main vars
   */
  const logger = new LogCollector(id, 'iWorker', options.collectLog, options.debugPrint, logtime);
  const fileMap: FileMap = new Map();
  const fileHandles = [];
  // journal files this run pre-created — removed again after a CLEAN run (the
  // VFS xDelete is a sync no-op and exclusive locking holds journals to close,
  // so SQLite's own DELETE journal mode can never remove the OPFS file)
  const journalPaths: string[] = [];
  let db: Database | null = null;
  let vfs: SyncOpfsVfs | null = null;
  const lockmode = options.lockmode === 'shared' ? 'read-only' : 'readwrite';
  // A blank mainDbPath means "no main database": open an in-memory SCRATCH db
  // through the VFS and use it purely as a namespace to ATTACH real files into.
  // The VFS's xOpen already falls back to an in-memory buffer for any name not
  // in its file map (that is how it backs journals/temp files), so the scratch
  // db needs no sync handle, takes no lock and is never persisted. The name must
  // NOT be ':memory:' — SQLite special-cases that to its built-in memory VFS,
  // which would bypass ours and make the ATTACH paths unresolvable.
  const noMain = !options.mainDbPath;
  const mainFilename = options.mainDbPath || '__scratch_main__.db';
  /**
   * create main db file handle/directories
   */

  let err: SqlWorkerResult['err'] = null;
  const statementResults: unknown[] = [];
  const statementPacked: (PackedNames | null)[] = [];
  const rowCounts: number[] = [];
  const statementColumns: (string[] | null)[] = [];

  try {
    logger.log('filehandle about to be created');

    /**
     * create main db file handle/directories
     */
    // Skip the whole main-handle dance when there is no main db — the scratch
    // db lives only in the VFS's in-memory fallback (no file, no lock).
    if (!noMain) {
      const syncHandleResult = await createSyncFileHandle(options.mainDbPath, lockmode, logger);
      if (syncHandleResult.err) {
        throw syncHandleResult.err.err;
      }
      fileMap.set(syncHandleResult.data.fullpath, syncHandleResult.data.syncHandle);
      fileHandles.push(syncHandleResult.data.syncHandle);

      if (lockmode === 'readwrite') {
        const journal = await createSyncFileHandle(options.mainDbPath, lockmode, logger, true);
        if (journal.err) {
          throw journal.err.err;
        }
        fileMap.set(journal.data.fullpath, journal.data.syncHandle);
        fileHandles.push(journal.data.syncHandle);
        journalPaths.push(`${options.mainDbPath}-journal`);
      }
    }

    /**
     * create aditional db file handle/directories
     */

    for (let i = 0; i < options.additionalDbPaths.length; i++) {
      {
        const syncHandleResult = await createSyncFileHandle(options.additionalDbPaths[i], lockmode, logger);
        if (syncHandleResult.err) {
          throw syncHandleResult.err.err;
        }
        fileMap.set(syncHandleResult.data.fullpath, syncHandleResult.data.syncHandle);
        fileHandles.push(syncHandleResult.data.syncHandle);
      }
      if (lockmode === 'readwrite') {
        const syncHandleResult = await createSyncFileHandle(options.additionalDbPaths[i], lockmode, logger, true);
        if (syncHandleResult.err) {
          throw syncHandleResult.err.err;
        }
        fileMap.set(syncHandleResult.data.fullpath, syncHandleResult.data.syncHandle);
        fileHandles.push(syncHandleResult.data.syncHandle);
        journalPaths.push(`${options.additionalDbPaths[i]}-journal`);
      }
    }

    /**
     * init sql if needed
     */

    if (!sqlite3) {
      logger.log('sqlite3InitModule() start');
      sqlite3 = await sqlite3InitModule();
      logger.log('sqlite3InitModule() done');
    }

    /**
     * register SyncOpfsVfs VFS
     */

    logger.log('new SyncOpfsVfs start');

    vfs = new SyncOpfsVfs(fileMap);
    vfs.register(sqlite3);

    logger.log('new SyncOpfsVfs done');

    /**
     * Create DB
     */

    logger.log('new sqlite3.oo1.DB start');

    // Flags MUST match the sync-handle mode. In shared mode the handles are
    // read-only, so the connection has to be SQLITE_OPEN_READONLY too —
    // otherwise SQLite opens (and ATTACHes) read-write and takes a
    // journal/WAL write path the read-only OPFS handle can't back, failing
    // with SQLITE_CANTOPEN on the first attached-DB access.
    db = new sqlite3.oo1.DB({
      filename: mainFilename,
      flags: lockmode === 'readwrite' ? 'rwc' : 'r',
      vfs: vfs.name,
    });

    logger.log('new sqlite3.oo1.DB done');

    /**
     * begin sql work
     */

    if (lockmode === 'readwrite') {
      db.exec('pragma locking_mode=exclusive');
      // DELETE (not TRUNCATE): the rollback journal file is REMOVED after each
      // transaction instead of left behind as a zero-length -journal in OPFS
      db.exec('pragma journal_mode = DELETE');
      db.exec('BEGIN TRANSACTION');
    }

    for (let i = 0; i < options.statements.length; i++) {
      const statementResult: unknown[] = [];

      const statement = options.statements[i];
      const binding = statement.binding || [];
      let rowno = 0;
      // where a collected row goes: the packed builder (fullname[, color] →
      // flat buffers, never a row array), or the row list up to `maxRows`;
      // an uncollected statement keeps nothing
      const packed = statement.collect === 'packedNames' ? new PackedNamesBuilder() : null;
      const maxRows = packed ? Infinity : (statement.maxRows ?? Infinity);
      const keep = (row: unknown): void => {
        if (packed) {
          const r = Array.isArray(row) ? row : [row];
          packed.pushWithToken(String(r[0] ?? ''), r.length > 1 && r[1] != null ? String(r[1]) : null);
          return;
        }
        if (statement.collect && statementResult.length < maxRows) {
          statementResult.push(row);
        }
      };
      // column names for THIS statement (filled by the collecting paths below)
      let columnNames: string[] | null = null;

      logger.log(
        `Statement start ${i.toString().padStart(3, '0')} - ${statement.useStatementInLog === false ? '' : statement.sql}`,
      );
      logger.log(`Statement bindings: ${binding.length}`);
      if (binding.length > 1) {
        const stmt = db.prepare(statement.sql);
        binding.forEach((v) => {
          if (Array.isArray(v)) {
            // one bind() with the whole row: oo1 binds an ARRAY positionally
            // (1..n). Binding each value on its own bound every column onto
            // parameter 1 — a latent bug, since nothing in-app sent
            // multi-column rows before sql.execute did.
            stmt.bind(v);
            if (statement.collect) {
              stmt.step();
              if (!columnNames) {
                columnNames = stmt.getColumnNames([]);
              }
              keep(stmt.get([]));
            }
            progressCallback('ROW', rowno, null);
            rowno++;
          } else {
            stmt.bind(v);
            if (statement.collect) {
              stmt.step();
              if (!columnNames) {
                columnNames = stmt.getColumnNames([]);
              }
              keep(stmt.get([]));
            }
            progressCallback('ROW', rowno, null);
            rowno++;
          }

          stmt.stepReset();
        });

        stmt.finalize();
      } else {
        // out-param: sqlite fills this with the query's column names even when
        // zero rows come back (so the grid keeps its header on an empty result)
        const cols: string[] = [];
        db.exec({
          sql: statement.sql,
          bind: binding[0] || null,
          returnValue: 'resultRows',
          columnNames: cols,
          callback: (row) => {
            keep(row);
            progressCallback('ROW', rowno, null);
            rowno++;
          },
        });
        if (statement.collect) {
          columnNames = cols.length ? cols : null;
        }
      }

      progressCallback('STATEMENT', i, options.statements.length);

      statementResults.push(statementResult);
      statementColumns.push(columnNames);
      statementPacked.push(packed ? packed.finish() : null);
      rowCounts.push(rowno);

      logger.log(`Statement done  ${i.toString().padStart(3, '0')}`);
    }
    if (lockmode === 'readwrite') {
      logger.log(`db commit start`);
      db.exec('COMMIT');
      logger.log(`db commit done`);
    }
    logger.log(`db close start`);
    db.close();
    logger.log(`db close done`);
  } catch (e) {
    logger.log('error occured');
    if (db) {
      if (lockmode === 'readwrite') {
        db.exec('ROLLBACK');
      }
      db.close();
    }
    // surface sqlite's own message ("no such table: x", "datatype mismatch",
    // "UNIQUE constraint failed") — a host driving sql.execute can act on it,
    // whereas a fixed sentinel told nobody anything
    err = { err: e, msg: e instanceof Error && e.message ? e.message : String(e) };
  }

  /**
   * cleanup handles
   */

  // Tear the per-run VFS out of SQLite's registry BEFORE the next run — the
  // worker is long-lived, so a leaked registration would shadow future runs
  // with its already-closed sync handles (→ SQLITE_CANTOPEN). Runs on both the
  // success and error paths (db is already closed by here in both).
  if (vfs && sqlite3) {
    try {
      vfs.unregister(sqlite3);
    } catch (e) {
      logger.log(`vfs unregister failed: ${e}`);
    }
  }

  logger.log('cleanup file handles start');
  for (let i = 0; i < fileHandles.length; i++) {
    if (lockmode === 'readwrite') {
      fileHandles[i].flush();
    }
    fileHandles[i].close();
  }

  // Spent journals: COMMIT (or ROLLBACK) already ran and the db is closed, so
  // the journal is cold — remove it instead of leaving a stale `-journal`
  // beside the database. Skipped after errors: a rollback that itself failed
  // may leave a HOT journal, which the next open needs for recovery. (A killed
  // worker never reaches this line, so crash recovery is untouched.)
  if (!err) {
    for (const p of journalPaths) {
      await deleteOpfsFile(p, logger);
    }
  }

  logger.log('cleanup file handles done - sending data');

  const loggerResult = logger.getResult();

  return {
    data: err ? null : statementResults,
    columns: err ? [] : statementColumns,
    packed: err ? [] : statementPacked,
    rowCounts: err ? [] : rowCounts,
    logs: loggerResult.logs,
    transferedLogtime: logger.transferAbsoluteLogTimes(),
    err,
    execTimeWorker: loggerResult.executeTime,
    execTime: 0,
  };
}
