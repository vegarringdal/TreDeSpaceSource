// One shared SQLite client for the whole app (the panels, and anything else
// that grows a need later) — created on first use so tabs that never touch SQL
// never spin up the worker. Every consumer goes through here so the Web Locks
// taken around a query are the same ones SQL Assets takes around import/delete.
import { SqliteWorkerClient } from './SqliteWorkerClient';
import type { SqlExecuteOption, Statement } from './types';

let client: SqliteWorkerClient | null = null;

export function sqliteClient(): SqliteWorkerClient {
  if (!client) {
    client = new SqliteWorkerClient();
  }
  return client;
}

/** Terminate the worker (cancels whatever SQL is running) and release its
 *  locks. The next call to sqliteClient() starts a fresh one. */
export function killSqliteWorker() {
  client?.killWorkerThread();
  client = null;
}

/** Fill in the option bag's boilerplate — callers only care about the paths,
 *  the statements and the lock mode. */
export function sqlOptions(o: {
  mainDbPath: string;
  additionalDbPaths?: string[];
  statements: Statement[];
  lockmode?: 'shared' | 'exclusive';
  lockTimeout?: number;
  /** Emit a PROGRESS message every N collected rows (0 = off). Pair with a
   *  progressCallback passed to execute() to drive a live row counter. */
  progressSize?: number;
}): SqlExecuteOption {
  return {
    mainDbPath: o.mainDbPath,
    additionalDbPaths: o.additionalDbPaths ?? [],
    statements: o.statements,
    lockTimeout: o.lockTimeout ?? 0,
    lockmode: o.lockmode ?? 'exclusive',
    progressSize: o.progressSize ?? 0,
    debugPrint: false,
    printInputOptions: false,
    collectLog: true,
  };
}
