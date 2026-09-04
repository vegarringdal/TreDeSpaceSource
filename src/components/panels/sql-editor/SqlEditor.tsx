import { PanelBody, useMinSize } from '@treDeSpaceUI/dockable';
import { SqlCodeEditor } from '@treDeSpaceUI/widgets';
import { useEffect } from 'react';
import { sqlAssetsActions } from '../../../state/sqlAssets/sqlAssets.actions';
import { sqlEditorActions as act } from '../../../state/sqlAssets/sqlEditor.actions';
import { sqlEditorState } from '../../../state/sqlAssets/sqlEditor.state';
import { withDatabases } from '../../../state/sqlReports/reportDraft';
import { storesActions } from '../../../state/stores/stores.actions';
import { ReportFiltersEditor } from '../sql-reports/ReportFiltersEditor';
import { ReportMetaFields } from '../sql-reports/ReportMetaFields';
import { ReportTypeToggles } from '../sql-reports/ReportTypeToggles';
import { SqlEditorDbRow } from './SqlEditorDbRow';
import { SqlEditorReportRow } from './SqlEditorReportRow';
import { SqlEditorRunRow } from './SqlEditorRunRow';
import { SqlEditorStatus } from './SqlEditorStatus';
import { SqlEditorTopRow } from './SqlEditorTopRow';
import { registerSqlRun } from './sqlEditorPanel';

/** SQL Editor: a report draft you write SQLite in — name, description, output
 *  types and filters like a saved report; Save Local adds it to SQL Reports,
 *  and a host reads it through `sql.editor.get`. The main database is picked
 *  here; any other file has to be brought in with
 *  `ATTACH DATABASE 'sql_assets/<store>/<file>'`, and those literals are what
 *  decides which files get Web-Locked before the query runs. Run's results go
 *  to the Console panel. */
export function SqlEditor() {
  useMinSize(320, 240);
  const { draft } = sqlEditorState.use();

  useEffect(() => {
    void storesActions.init().then(() => sqlAssetsActions.refresh());
  }, []);

  useEffect(() => {
    registerSqlRun(() => void act.run());
    return () => registerSqlRun(null);
  });

  return (
    <PanelBody className="panel-body flex h-full min-h-0 flex-col gap-1.5 overflow-y-auto p-2">
      <SqlEditorTopRow />
      <ReportMetaFields draft={draft} patch={act.patch} />
      <SqlEditorDbRow />
      <ReportTypeToggles draft={draft} toggleType={act.toggleType} />

      <SqlCodeEditor
        resizable
        className="h-48 min-h-16 shrink-0"
        value={draft.sql}
        onChange={act.setSql}
        onRun={() => void act.run()}
        onSelect={act.setSelection}
      />

      <SqlEditorRunRow />
      <SqlEditorReportRow />

      <ReportFiltersEditor
        report={withDatabases(draft)}
        filters={draft.filters}
        onChange={act.setFilter}
        onAdd={act.addFilter}
        onRemove={act.removeFilter}
        addShortcut="sql.editor.addFilter"
      />

      <SqlEditorStatus />
    </PanelBody>
  );
}
