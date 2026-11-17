import type { PackedNames } from '../color/packedNames';

export type ProgressCallback = (type: 'STATEMENT' | 'ROW', no: number, total: number | null) => void;

export type SqlExecuteOption = {
  mainDbPath: string;
  /**
   * for attach db if needed, or you just want to lock
   */
  additionalDbPaths: string[];
  /**
   * all statements are wrapped in 1 common
   * -----------------------------------
   *      db.exec("pragma locking_mode=exclusive;");
   *      db.exec("BEGIN TRANSACTION");
   *          // all statements
   *      db.exec("COMMIT"); or  db.exec("ROLLBACK"); if it fails...
   */
  statements: Statement[];
  /**
   * how long to wait until you quick trying to lock..
   * useful if you do a lot of small operations, and want it to try up to 500ms..
   */
  lockTimeout: number;
  /**
   * mode for web-lock/filehandle
   * PS! not all browsers support read-only mode..
   * use shared for read only mode
   */
  lockmode: 'shared' | 'exclusive';
  /**
   * 0 = off
   * will only show if type ROW (rowno % progressSize !== 0)
   * PS! this can slow it down a lot..
   */
  progressSize: number;

  /**
   * print to console in worker...
   */
  debugPrint: boolean; // default = false
  /**
   * print to conosle, input to printSqliteWorkerClient helper
   */
  printInputOptions: boolean; // default = false
  /**
   * for collecting/debug, will print if printSqliteWorkerClient helper is used
   */
  collectLog: boolean; // default = false
};

export type Statement = {
  /**
   * name you can use for something in gui
   */
  name?: string;
  /**
   * DEFAULT = true
   * if you want to set SQL to statement
   */
  useStatementInLog?: boolean;
  /**
   * sql to run
   */
  sql: string;
  /**
   * if more then one row, we use:
   * -----------------------------------
   *      const stmt = db.prepare(statement.sql);
   *          binding.forEach((v) => {
   *          stmt.bind(v);
   *          stmt.stepReset();
   *      });
   *      stmt.finalize();
   *
   *
   * if just one row: (if you want to collect results..)
   * -----------------------------------
   *          db.exec({
   *               sql: statement.sql,
   *               bind: binding[0] || null,
   *               returnValue: "resultRows",
   *               callback: (row)=>...
   *           });
   */
  binding?: (string | number)[][];
  /**
   * if you need to collect results. `'packedNames'` collects a
   * `fullname[, color]` projection into ONE flat PackedNames buffer set
   * (lowercased names, per-row color/opacity) instead of row arrays —
   * the memory-flat form the coloring / selection consumers take.
   */
  collect?: boolean | 'packedNames';
  /**
   * stop KEEPING rows past this many (the statement still runs to the end and
   * the true count is reported in `rowCounts`) — a cap applied in the worker so
   * a huge result is never materialised just to be sliced on the main thread.
   * Ignored for 'packedNames'.
   */
  maxRows?: number;
};

export type WorkerMessageEvent =
  | {
      id: number;
      options: SqlExecuteOption;
      logtime: readonly [number, number];
      type: 'EXECUTE';
    }
  | {
      id: number;
      result: SqlWorkerResult;
      type: 'RESULT';
    }
  | {
      id: number;
      type: 'SHARED_MODE_DISABLED';
    }
  | {
      id: number;
      type: 'SHARED_MODE_ENABLED';
    }
  | {
      id: number;
      result: {
        type: 'STATEMENT' | 'ROW';
        no: number;
        total: number | null;
      };
      type: 'PROGRESS';
    };

export type resolveFN = (value: unknown) => void;

export type SqlWorkerResult = {
  data: unknown[] | null;
  /** parallel to `data`: the PackedNames of a `collect: 'packedNames'`
   *  statement (its `data` slot is an empty array), else null */
  packed?: (PackedNames | null)[];
  /** parallel to `data`: rows the statement RETURNED (≥ rows kept when
   *  `maxRows` capped them) */
  rowCounts?: number[];
  /** Column names per collected statement, parallel to `data` (null when that
   *  statement returned no rows / wasn't a query). Rows themselves stay compact
   *  value arrays — the column list is what the Table grid and Detail form
   *  label with. */
  columns: (string[] | null)[];
  logs: string[];
  err: null | { err: unknown; msg: string };
  // internal only atm; absent when the worker never ran (e.g. killed)
  transferedLogtime?: readonly [number, number];
  execTimeWorker: number;
  execTime: number;
};
/**
 * Minimal structural surface of the sqlite3-wasm runtime used by the custom
 * VFS. The `Sqlite3Static` type shipped by @sqlite.org/sqlite-wasm misses the
 * `capi`/`wasm` members the VFS calls, so exactly that surface is typed here —
 * widen it if the VFS starts using more of the API.
 */
export type Sqlite3Struct = {
  readonly pointer: number;
  dispose?: () => void;
} & { [field: `$${string}`]: number };

export type Sqlite3VfsStruct = Sqlite3Struct & {
  registerVfs: (asDefault?: boolean) => void;
};

/** JS function installable as a C callback; arg/return shapes are dictated by the ABI `sig`. */
export type Sqlite3InstallableFn = (...args: never[]) => number;

export type Sqlite3Wasm = {
  installFunction: (sig: string, fn: Sqlite3InstallableFn) => number;
  uninstallFunction: (ptr: number) => void;
  cstrToJs: (ptr: number) => string | null;
  allocCString: (s: string) => number;
  heap8u: () => Uint8Array<ArrayBuffer>;
  poke: (ptr: number, value: number, type: 'i32' | 'double') => void;
  poke64: (ptr: number, value: number) => void;
  pokePtr: (ptr: number, value: number) => void;
};

export type Sqlite3CApi = {
  sqlite3_io_methods: new () => Sqlite3Struct;
  sqlite3_vfs: new () => Sqlite3VfsStruct;
  sqlite3_file: { structInfo: { sizeof: number } };
  sqlite3_vfs_unregister: (ptr: number) => number;
} & { [constant: `SQLITE_${string}`]: number };

export type Sqlite3Api = { capi: Sqlite3CApi; wasm: Sqlite3Wasm };

/**
 * The worker-only sync access handle. TS's lib.dom does not declare it (and we
 * would rather not pull in @types/wicg-file-system-access for one interface),
 * so the surface the VFS actually uses is declared here.
 */
export interface SyncAccessHandle {
  read(buffer: Uint8Array, options: { at: number }): number;
  write(buffer: Uint8Array, options: { at: number }): number;
  truncate(size: number): void;
  getSize(): number;
  flush(): void;
  close(): void;
}

export interface OpenFile {
  name: string;
  handle?: SyncAccessHandle;
  inMemory?: Uint8Array;
}
