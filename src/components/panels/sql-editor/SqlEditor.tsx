import { PanelBody, useMinSize } from '@treDeSpaceUI/dockable';
import { SqlCodeEditor } from '@treDeSpaceUI/widgets';
import { useEffect } from 'react';
import { sqlAssetsActions } from '../../../state/sqlAssets/sqlAssets.actions';
import { sqlEditorActions as act } from '../../../state/sqlAssets/sqlEditor.actions';
import { sqlEditorState } from '../../../state/sqlAssets/sqlEditor.state';
import { storesActions } from '../../../state/stores/stores.actions';
import { SqlEditorDbRow } from './SqlEditorDbRow';
import { SqlEditorReportRow } from './SqlEditorReportRow';
import { SqlEditorRunRow } from './SqlEditorRunRow';
import { SqlEditorStatus } from './SqlEditorStatus';
import { registerSqlRun } from './sqlEditorPanel';

/** SQL Editor: write SQLite against the databases in SQL Assets. The main
 *  database is picked here; any other file has to be brought in with
 *  `ATTACH DATABASE 'sql_assets/<store>/<file>'`, and those literals are what
 *  decides which files get Web-Locked before the query runs. Results go to the
 *  Console panel. */
export function SqlEditor() {
  useMinSize(320, 240);
  const { sql } = sqlEditorState.use();

  useEffect(() => {
    void storesActions.init().then(() => sqlAssetsActions.refresh());
  }, []);

  useEffect(() => {
    registerSqlRun(() => void act.run());
    return () => registerSqlRun(null);
  });

  return (
    <PanelBody className="panel-body flex h-full min-h-0 flex-col gap-1.5 overflow-hidden p-2">
      <SqlEditorDbRow />

      <SqlCodeEditor
        className="min-h-24 flex-1"
        value={sql}
        onChange={act.setSql}
        onRun={() => void act.run()}
        onSelect={act.setSelection}
      />

      <SqlEditorRunRow />
      <SqlEditorReportRow />
      <SqlEditorStatus />
    </PanelBody>
  );
}
