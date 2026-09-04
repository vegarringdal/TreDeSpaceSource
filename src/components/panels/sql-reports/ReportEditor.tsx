import { IconTrash } from '@tabler/icons-react';
import { Button } from '@treDeSpaceUI/widgets';
import { useEffect } from 'react';
import type { SqlDbEntry } from '../../../state/sqlAssets/sqlAssets.state';
import { sqlEditorActions } from '../../../state/sqlAssets/sqlEditor.actions';
import { sqlReportsActions as act } from '../../../state/sqlReports/sqlReports.actions';
import type { ReportDef } from '../../../state/sqlReports/sqlReports.state';
import { dialogs } from '../../dialogs/dialogs.actions';
import { openSqlEditorPanel } from '../sql-editor/sqlEditorPanel';
import { ReportEditorFields } from './ReportEditorFields';
import { ReportFiltersEditor } from './ReportFiltersEditor';
import { ReportTestButtons } from './ReportTestButtons';
import { registerReportSetEditor } from './sqlReportsPanel';
import { useReportDraft } from './useReportDraft';

type ReportEditorProps = Readonly<{
  report: ReportDef;
  dbs: SqlDbEntry[];
  onClose: () => void;
}>;

/** Edit a report — the only place the SQL, main db and all defaults are
 *  visible. `dbs` are the databases in this report's store (for the main-db
 *  picker); the report can still ATTACH files from other stores in its SQL.
 *  Set editor copies the draft (unsaved edits included) into the SQL Editor. */
export function ReportEditor({ report, dbs, onClose }: ReportEditorProps) {
  const { draft, patch, toggleType, setFilter, addFilter, removeFilter, eff } = useReportDraft(report);

  const handleSetEditor = (): void => {
    void dialogs
      .confirm('Are you sure you want to replace the current SQL Editor data?', {
        title: 'Set editor',
        okLabel: 'Replace',
      })
      .then((ok) => {
        if (ok) {
          sqlEditorActions.setFromReport(eff());
          openSqlEditorPanel();
        }
      });
  };

  const handleDelete = (): void => {
    void dialogs.confirm(`Delete report "${draft.name}"?`, { okLabel: 'Delete' }).then((ok) => {
      if (ok) {
        void act.remove(draft.id);
        onClose();
      }
    });
  };

  useEffect(() => {
    registerReportSetEditor(handleSetEditor);
    return () => registerReportSetEditor(null);
  });

  return (
    <div className="flex flex-col gap-2 border border-sky-800 bg-slate-900/60 p-2">
      <ReportEditorFields draft={draft} dbs={dbs} patch={patch} toggleType={toggleType} />

      <ReportTestButtons eff={eff} />

      <ReportFiltersEditor
        report={eff()}
        filters={draft.filters}
        onChange={setFilter}
        onAdd={addFilter}
        onRemove={removeFilter}
      />

      <div className="flex gap-2">
        <Button
          shortcut="sql.reports.save"
          tooltip="Save this report to the store's SQL_Reports.json"
          onClick={() => {
            void act.save(draft);
            onClose();
          }}
        >
          Save
        </Button>
        <Button tooltip="Discard changes" onClick={onClose}>
          Cancel
        </Button>
        <Button
          shortcut="sql.reports.setEditor"
          tooltip="Put this report's definition (unsaved edits included) into the SQL Editor, replacing what is there — asks first"
          onClick={handleSetEditor}
        >
          Set editor
        </Button>
        <Button icon={<IconTrash size={14} />} className="ml-auto" tooltip="Delete this report" onClick={handleDelete}>
          Delete
        </Button>
      </div>
    </div>
  );
}
