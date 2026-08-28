// SQL Assets actions: scan / import / delete database files.
//
// Every file touch takes the SAME Web Lock the SQLite worker client takes —
// the OPFS path (see sqlDbPath) — so an import or delete can never land while
// this or another tab is reading or writing that database. The lock is
// requested with `ifAvailable`, so a busy file is reported, never waited on.

import { dialogs } from '../../components/dialogs/dialogs.actions';
import { consoleActions } from '../../components/panels/console/console.actions';
import { Md5 } from '../../lib/md5';
import { listFiles, readJson, sqlDbPath, sqlStoreDir, writeFile, writeJson } from '../../lib/opfs/opfs';
import { sqliteClient, sqlOptions } from '../../lib/sqlite/client';
import { storesState } from '../stores/stores.state';
import { type SqlDbEntry, sqlAssetsState } from './sqlAssets.state';

// -----------------------------------------------------------------------------
// import-time md5 sidecar (SQL_Meta.json per store)
// -----------------------------------------------------------------------------

/** Per-store sidecar recording each database's import-time md5 — the hash of
 *  the bytes AS DELIVERED, taken before the WAL normalization rewrites the
 *  file. It answers a syncing host's "did I already import this version?"; it
 *  deliberately ignores whatever queries modified the file afterwards.
 *  `refresh()` skips `.json` files, so the sidecar never lists as a database. */
const META_FILE = 'SQL_Meta.json';

type SqlMetaEntry = { md5: string; meta?: Record<string, unknown> };
type SqlMeta = Record<string, SqlMetaEntry>;

async function readMeta(store: string): Promise<SqlMeta> {
  return (await readJson<SqlMeta>(await sqlStoreDir(store), META_FILE)) ?? {};
}

/** Record the import-time md5 and any host metadata for one database. */
async function recordMeta(store: string, fileName: string, md5: string, meta?: Record<string, unknown>): Promise<void> {
  const dir = await sqlStoreDir(store);
  const all = (await readJson<SqlMeta>(dir, META_FILE)) ?? {};
  all[fileName] = { md5, ...(meta ? { meta } : {}) };
  await writeJson(dir, META_FILE, all);
}

async function dropMeta(store: string, fileName: string): Promise<void> {
  const dir = await sqlStoreDir(store);
  const all = (await readJson<SqlMeta>(dir, META_FILE)) ?? {};
  if (all[fileName]) {
    delete all[fileName];
    await writeJson(dir, META_FILE, all);
  }
}

/** Incremental md5 of a whole stream — constant memory, GB-safe. */
async function md5OfStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const h = new Md5();
  const reader = stream.getReader();
  for (let r = await reader.read(); !r.done; r = await reader.read()) {
    h.update(r.value);
  }
  return h.hex();
}

/** Take a just-imported database OUT of WAL journal mode. Our OPFS VFS has no
 *  shared-memory (`-shm`) support, so a WAL database can only be read with
 *  `locking_mode=exclusive` — which means shared/read-only queries fail with
 *  SQLITE_CANTOPEN. An exclusive run applies `journal_mode=DELETE` before its
 *  transaction (see sqliteWorker), and the WAL→rollback switch is a PERSISTENT
 *  header change, so from here on the file reads fine in any mode.
 *  Runs after the import lock is released (the worker takes its own lock). */
async function normalizeOutOfWal(path: string): Promise<void> {
  const res = await sqliteClient().execute(
    sqlOptions({
      mainDbPath: path,
      lockmode: 'exclusive',
      // read-only probe; the WAL→rollback conversion happens in the worker's
      // pre-transaction pragmas, not here
      statements: [{ name: 'journal_mode', sql: 'PRAGMA journal_mode', collect: true }],
    }),
  );
  if (res.err) {
    consoleActions.log('error', `SQL: could not normalize ${path} (WAL→rollback): ${res.err.msg}`);
  }
}

/** Run `body` while holding the exclusive lock on one database path. Returns
 *  null (after logging) when another tab/worker holds it. */
async function withDbLock<T>(path: string, body: () => Promise<T>): Promise<T | null> {
  return navigator.locks.request(path, { ifAvailable: true, mode: 'exclusive' }, async (lock) => {
    if (!lock) {
      consoleActions.log('error', `SQL: ${path} is in use (another tab or a running query) — skipped`);
      return null;
    }
    return body();
  });
}

/** Per-file progress for the SQL import paths. `download` repeats as bytes
 *  arrive (URL imports only); `import` = writing into OPFS + the WAL
 *  normalization; `done` / `error` end that file. */
export interface SqlImportProgress {
  completed: number;
  total: number;
  index: number;
  fileName: string;
  url?: string;
  phase: 'download' | 'import' | 'done' | 'error';
  loaded?: number;
  totalBytes?: number;
}

export interface SqlImportOpts {
  replace?: boolean;
  /** Host metadata stored alongside the db and returned by `sql.list` — e.g.
   *  the md5 of the COMPRESSED artifact the host actually serves. */
  meta?: Record<string, unknown>;
  /** Drive no dialogs — for a caller reporting progress itself. */
  quiet?: boolean;
  onProgress?: (p: SqlImportProgress) => void;
}

export const sqlAssetsActions = {
  /** Collapse every store in the SQL Assets tree. */
  collapseTree() {
    sqlAssetsState.set((s) => ({ treeCollapseSignal: s.treeCollapseSignal + 1 }));
  },
  /** Expand every store in the SQL Assets tree. */
  expandTree() {
    sqlAssetsState.set((s) => ({ treeExpandSignal: s.treeExpandSignal + 1 }));
  },

  /** Re-scan every store's sql_assets directory — the file system is the
   *  index, so this is the only "load" there is. */
  async refresh() {
    const dbs: SqlDbEntry[] = [];
    for (const st of storesState.get().stores) {
      const dir = await sqlStoreDir(st.name);
      const meta = await readMeta(st.name);
      for (const file of await listFiles(dir)) {
        // .json files in a store are sidecar metadata (SQL_Reports.json,
        // SQL_Meta.json), not databases
        if (file.name.toLowerCase().endsWith('.json')) {
          continue;
        }
        const rec = meta[file.name];
        dbs.push({
          store: st.name,
          fileName: file.name,
          path: sqlDbPath(st.name, file.name),
          size: file.size,
          modified: file.lastModified,
          ...(rec?.md5 ? { md5: rec.md5 } : {}),
          ...(rec?.meta ? { meta: rec.meta } : {}),
        });
      }
    }
    dbs.sort((a, b) => a.path.localeCompare(b.path));
    sqlAssetsState.set((s) => {
      // drop selections whose file is gone
      const alive = new Set(dbs.map((d) => d.path));
      const selected: Record<string, boolean> = {};
      for (const [path, on] of Object.entries(s.selected)) {
        if (on && alive.has(path)) {
          selected[path] = true;
        }
      }
      return { dbs, selected, ready: true };
    });
  },

  /** Copy files into sql_assets/<store>/. When `opts.replace` is omitted (the
   *  panel path) an existing name is confirmed with a dialog; when it is set
   *  (the host-API path) the dialog is skipped — `true` overwrites, `false`
   *  skips. A locked target is skipped with a console entry. Returns the OPFS
   *  paths written, the file names skipped, and how many were overwritten. */
  async importDatabases(
    files: File[],
    store: string,
    opts: SqlImportOpts = {},
  ): Promise<{ imported: string[]; skipped: string[]; replaced: number }> {
    const result = { imported: [] as string[], skipped: [] as string[], replaced: 0 };
    if (!files.length) {
      return result;
    }
    const existing = new Set(
      sqlAssetsState
        .get()
        .dbs.filter((d) => d.store === store)
        .map((d) => d.fileName),
    );
    sqlAssetsState.set({ busy: true });
    let completed = 0;
    const tick = (index: number, fileName: string, phase: SqlImportProgress['phase']) =>
      opts.onProgress?.({ completed, total: files.length, index, fileName, phase });
    try {
      for (const [index, file] of files.entries()) {
        tick(index, file.name, 'import');
        if (existing.has(file.name)) {
          const replace =
            opts.replace ??
            (await dialogs.confirm(`"${file.name}" already exists in "${store}" — replace it?`, {
              okLabel: 'Replace',
            }));
          if (!replace) {
            result.skipped.push(file.name);
            completed++;
            tick(index, file.name, 'done');
            continue;
          }
          result.replaced++;
        }
        const path = sqlDbPath(store, file.name);
        // hash the bytes AS DELIVERED — before the write and before the WAL
        // normalization below rewrites the stored file
        const md5 = await md5OfStream(file.stream());
        const done = await withDbLock(path, async () => {
          await writeFile(await sqlStoreDir(store), file.name, file);
          return true;
        });
        if (done) {
          await recordMeta(store, file.name, md5, opts.meta);
          result.imported.push(path);
          consoleActions.log('info', `SQL: imported ${path} (${(file.size / 1048576).toFixed(1)} MB)`);
          // convert out of WAL so it reads in shared/read-only mode later
          await normalizeOutOfWal(path);
          completed++;
          tick(index, file.name, 'done');
        } else {
          result.skipped.push(file.name);
          completed++;
          tick(index, file.name, 'error');
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      consoleActions.log('error', `SQL: import failed: ${msg}`);
      if (!opts.quiet) {
        dialogs.error(msg, 'Import failed');
      }
    } finally {
      sqlAssetsState.set({ busy: false });
      await this.refresh();
    }
    if (result.imported.length) {
      consoleActions.log('info', `SQL: imported ${result.imported.length} database(s) into "${store}"`);
    }
    return result;
  },

  /** Download databases by URL, streaming each straight into
   *  sql_assets/<store>/ — chunks go from the network reader into an OPFS
   *  writable (staged, committed on close, discarded on abort), so a
   *  multi-GB file never sits in memory. The import-time md5 is hashed from
   *  the same chunks as they pass. Files run serially; a failure records a
   *  `failed` entry and never aborts the rest. `replace: false` skips an
   *  existing name WITHOUT downloading it. */
  async importDatabasesFromUrls(
    files: { url: string; fileName: string; meta?: Record<string, unknown> }[],
    store: string,
    opts: SqlImportOpts = {},
  ): Promise<{ imported: string[]; skipped: string[]; replaced: number; failed: { url: string; error: string }[] }> {
    const result = {
      imported: [] as string[],
      skipped: [] as string[],
      replaced: 0,
      failed: [] as { url: string; error: string }[],
    };
    if (!files.length) {
      return result;
    }
    await this.refresh();
    const existing = new Set(
      sqlAssetsState
        .get()
        .dbs.filter((d) => d.store === store)
        .map((d) => d.fileName),
    );
    sqlAssetsState.set({ busy: true });
    let completed = 0;
    const tick = (
      index: number,
      f: { url: string; fileName: string },
      phase: SqlImportProgress['phase'],
      bytes?: { loaded: number; totalBytes: number },
    ) =>
      opts.onProgress?.({
        completed,
        total: files.length,
        index,
        fileName: f.fileName,
        url: f.url,
        phase,
        ...(bytes ?? {}),
      });
    try {
      for (const [index, f] of files.entries()) {
        const existed = existing.has(f.fileName);
        if (existed && !opts.replace) {
          result.skipped.push(f.fileName);
          completed++;
          tick(index, f, 'done');
          continue;
        }
        const path = sqlDbPath(store, f.fileName);
        try {
          const res = await fetch(f.url);
          if (!res.ok) {
            throw new Error(`HTTP ${res.status} ${res.statusText}`);
          }
          const body = res.body;
          if (!body) {
            throw new Error('response has no body');
          }
          // content-length lets the host show a real percentage; without it
          // the ticks still report bytes so far
          const totalBytes = Number(res.headers.get('content-length') ?? 0);
          tick(index, f, 'download', { loaded: 0, totalBytes });
          const md5 = await withDbLock(path, async () => {
            const dir = await sqlStoreDir(store);
            const handle = await dir.getFileHandle(f.fileName, { create: true });
            const writable = await handle.createWritable();
            try {
              const h = new Md5();
              const reader = body.getReader();
              let loaded = 0;
              let lastReport = 0;
              for (let r = await reader.read(); !r.done; r = await reader.read()) {
                h.update(r.value);
                await writable.write(r.value);
                loaded += r.value.length;
                // throttle: every 2% of a known total, else every 8 MB
                const step = totalBytes > 0 ? totalBytes / 50 : 8 * 1024 * 1024;
                if (loaded - lastReport >= step) {
                  lastReport = loaded;
                  tick(index, f, 'download', { loaded, totalBytes });
                }
              }
              tick(index, f, 'import', { loaded, totalBytes: totalBytes || loaded });
              await writable.close();
              return h.hex();
            } catch (e) {
              // staged write: abort discards everything, the prior file (if
              // any) is untouched — only clean up a newly created empty stub
              await writable.abort();
              if (!existed) {
                await dir.removeEntry(f.fileName).catch(() => undefined);
              }
              throw e;
            }
          });
          if (md5 === null) {
            result.skipped.push(f.fileName);
            completed++;
            tick(index, f, 'error');
            continue;
          }
          await recordMeta(store, f.fileName, md5, f.meta);
          if (existed) {
            result.replaced++;
          }
          existing.add(f.fileName);
          result.imported.push(path);
          consoleActions.log('info', `SQL: imported ${path} from URL`);
          // convert out of WAL so it reads in shared/read-only mode later
          await normalizeOutOfWal(path);
          completed++;
          tick(index, f, 'done');
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          result.failed.push({ url: f.url, error: msg });
          consoleActions.log('error', `SQL: import of ${f.url} failed: ${msg}`);
          completed++;
          tick(index, f, 'error');
        }
      }
    } finally {
      sqlAssetsState.set({ busy: false });
      await this.refresh();
    }
    return result;
  },

  /** Delete databases by their OPFS path (the same key used as the Web Lock).
   *  Unknown paths are ignored; a locked file is skipped. Returns the paths
   *  actually deleted and those skipped. */
  async deleteDatabases(paths: string[]): Promise<{ deleted: string[]; skipped: string[] }> {
    const result = { deleted: [] as string[], skipped: [] as string[] };
    const byPath = new Map(sqlAssetsState.get().dbs.map((d) => [d.path, d] as const));
    const doomed = paths.map((p) => byPath.get(p)).filter((d): d is SqlDbEntry => !!d);
    if (!doomed.length) {
      return result;
    }
    sqlAssetsState.set({ busy: true });
    try {
      for (const d of doomed) {
        const done = await withDbLock(d.path, async () => {
          await (await sqlStoreDir(d.store)).removeEntry(d.fileName);
          return true;
        });
        if (done) {
          await dropMeta(d.store, d.fileName);
          result.deleted.push(d.path);
          consoleActions.log('info', `SQL: deleted ${d.path}`);
        } else {
          result.skipped.push(d.path);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      consoleActions.log('error', `SQL: delete failed: ${msg}`);
      dialogs.error(msg, 'Delete failed');
    } finally {
      sqlAssetsState.set({ busy: false });
      await this.refresh();
    }
    return result;
  },

  /** Delete the checked databases (all stores). */
  async deleteSelected(onlyStore?: string) {
    const s = sqlAssetsState.get();
    const paths = s.dbs.filter((d) => s.selected[d.path] && (!onlyStore || d.store === onlyStore)).map((d) => d.path);
    if (!paths.length) {
      return;
    }
    const { deleted } = await this.deleteDatabases(paths);
    consoleActions.log('info', `SQL: deleted ${deleted.length} database(s)`);
  },

  toggleSelected(path: string, on: boolean) {
    sqlAssetsState.set((s) => ({ selected: { ...s.selected, [path]: on } }));
  },

  /** Replace the whole selection (the unified tree owns it as one set). */
  setSelection(paths: Iterable<string>) {
    sqlAssetsState.set(() => ({ selected: Object.fromEntries([...paths].map((p) => [p, true])) }));
  },
};
