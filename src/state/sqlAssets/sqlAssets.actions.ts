// SQL Assets actions: scan / import / delete database files.
//
// Every file touch takes the SAME Web Lock the SQLite worker client takes —
// the OPFS path (see sqlDbPath) — so an import or delete can never land while
// this or another tab is reading or writing that database. The lock is
// requested with `ifAvailable`, so a busy file is reported, never waited on.

import { dialogs } from '../../components/dialogs/dialogs.actions';
import { consoleActions } from '../../components/panels/console/console.actions';
import { listFiles, sqlDbPath, sqlStoreDir, writeFile } from '../../lib/opfs/opfs';
import { sqliteClient, sqlOptions } from '../../lib/sqlite/client';
import { storesState } from '../stores/stores.state';
import { type SqlDbEntry, sqlAssetsState } from './sqlAssets.state';

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

export const sqlAssetsActions = {
  /** Re-scan every store's sql_assets directory — the file system is the
   *  index, so this is the only "load" there is. */
  async refresh() {
    const dbs: SqlDbEntry[] = [];
    for (const st of storesState.get().stores) {
      const dir = await sqlStoreDir(st.name);
      for (const file of await listFiles(dir)) {
        // .json files in a store are sidecar metadata (SQL_Reports.json), not databases
        if (file.name.toLowerCase().endsWith('.json')) {
          continue;
        }
        dbs.push({
          store: st.name,
          fileName: file.name,
          path: sqlDbPath(st.name, file.name),
          size: file.size,
          modified: file.lastModified,
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
    opts: { replace?: boolean } = {},
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
    try {
      for (const file of files) {
        if (existing.has(file.name)) {
          const replace =
            opts.replace ??
            (await dialogs.confirm(`"${file.name}" already exists in "${store}" — replace it?`, {
              okLabel: 'Replace',
            }));
          if (!replace) {
            result.skipped.push(file.name);
            continue;
          }
          result.replaced++;
        }
        const path = sqlDbPath(store, file.name);
        const done = await withDbLock(path, async () => {
          await writeFile(await sqlStoreDir(store), file.name, file);
          return true;
        });
        if (done) {
          result.imported.push(path);
          consoleActions.log('info', `SQL: imported ${path} (${(file.size / 1048576).toFixed(1)} MB)`);
          // convert out of WAL so it reads in shared/read-only mode later
          await normalizeOutOfWal(path);
        } else {
          result.skipped.push(file.name);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      consoleActions.log('error', `SQL: import failed: ${msg}`);
      dialogs.error(msg, 'Import failed');
    } finally {
      sqlAssetsState.set({ busy: false });
      await this.refresh();
    }
    if (result.imported.length) {
      consoleActions.log('info', `SQL: imported ${result.imported.length} database(s) into "${store}"`);
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
