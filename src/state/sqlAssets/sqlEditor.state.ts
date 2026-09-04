// SQL Editor panel state. Lives in state/ (not the component) so the draft and
// the chosen database survive the panel being closed, undocked or re-mounted.
import { createStore } from '@treDeSpaceUI/lib/createStore';
import { ALL_REPORT_TYPES } from '../sqlReports/reportDraft';
import type { ReportDef } from '../sqlReports/sqlReports.state';

/** The transient report the editor edits — never persisted, so id/store are fixed. */
export const EDITOR_REPORT_ID = '__editor__';
export const DEFAULT_EDITOR_SQL = 'SELECT name, type FROM sqlite_master ORDER BY name;';

/** A fresh editor draft: no name, every output type, the default SQL, no
 *  filters. `db` is the main database (Clear keeps the current pick). */
export function emptyEditorDraft(db = ''): ReportDef {
  return {
    id: EDITOR_REPORT_ID,
    store: '',
    db,
    name: '',
    description: '',
    types: [...ALL_REPORT_TYPES],
    sql: DEFAULT_EDITOR_SQL,
    databases: db ? [db] : [],
    filters: [],
  };
}

export interface SqlEditorState {
  /** What the editor holds, report-shaped: `db` is the main database (OPFS
   *  path sql_assets/<store>/<file>, '' = None), `sql` the script, plus the
   *  name / description / types / filters a host can read out and save. */
  draft: ReportDef;
  /** 'shared' = read-only (several readers at once), 'exclusive' = writes. */
  lockmode: 'shared' | 'exclusive';
  /** A query is in flight. */
  running: boolean;
  /** Current textarea selection — when start<end the action buttons run ONLY
   *  the selected text, so you can run one of several statements. */
  selStart: number;
  selEnd: number;
  /** Last run's timings + error, shown under the buttons. */
  lastError: string;
  lastMs: number;
  lastRows: number;
}

export const sqlEditorState = createStore<SqlEditorState>({
  draft: emptyEditorDraft(),
  lockmode: 'shared',
  running: false,
  selStart: 0,
  selEnd: 0,
  lastError: '',
  lastMs: 0,
  lastRows: 0,
});
