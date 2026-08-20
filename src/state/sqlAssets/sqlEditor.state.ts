// SQL Editor panel state. Lives in state/ (not the component) so the text and
// the chosen database survive the panel being closed, undocked or re-mounted.
import { createStore } from '@treDeSpaceUI/lib/createStore';

export interface SqlEditorState {
  /** OPFS path of the main database (sql_assets/<store>/<file>). */
  mainDbPath: string;
  sql: string;
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
  mainDbPath: '',
  sql: 'SELECT name, type FROM sqlite_master ORDER BY name;',
  lockmode: 'shared',
  running: false,
  selStart: 0,
  selEnd: 0,
  lastError: '',
  lastMs: 0,
  lastRows: 0,
});
