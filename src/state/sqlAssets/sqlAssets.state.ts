// SQL assets — SQLite databases in OPFS under sql_assets/<store>/<file>.
// There is NO index file here: the directories are real, so the filesystem is
// the source of truth (that is also why ATTACH DATABASE 'sql_assets/…' works
// straight out of the box). Stores are shared with Model Assets.
import { createStore } from '@treDeSpaceUI/lib/createStore';

/** One database file. `path` is the OPFS path AND the Web Lock key. */
export interface SqlDbEntry {
  store: string;
  fileName: string;
  path: string;
  size: number;
  modified: number;
}

export interface SqlAssetsState {
  dbs: SqlDbEntry[];
  /** path → selected (drives Delete Selected). */
  selected: Record<string, boolean>;
  /** The directories have been scanned at least once. */
  ready: boolean;
  /** An import/delete is running — buttons stay disabled meanwhile. */
  busy: boolean;
}

export const sqlAssetsState = createStore<SqlAssetsState>({
  dbs: [],
  selected: {},
  ready: false,
  busy: false,
});
