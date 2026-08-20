import { IconPlus, IconTrash } from '@tabler/icons-react';
import { Button } from '@treDeSpaceUI/widgets';
import type { SqlDbEntry } from '../../../state/sqlAssets/sqlAssets.state';
import { sqlReportsActions as act } from '../../../state/sqlReports/sqlReports.actions';
import type { ReportDef } from '../../../state/sqlReports/sqlReports.state';
import { dialogs } from '../../dialogs/dialogs.actions';
import { FilterEditRow } from './FilterEditRow';
import { ReportEditorFields } from './ReportEditorFields';
import { ReportTestButtons } from './ReportTestButtons';
import { useReportDraft } from './useReportDraft';

type ReportEditorProps = Readonly<{
  report: ReportDef;
  dbs: SqlDbEntry[];
  onClose: () => void;
}>;

/** Edit a report — the only place the SQL, main db and all defaults are
 *  visible. `dbs` are the databases in this report's store (for the main-db
 *  picker); the report can still ATTACH files from other stores in its SQL. */
export function ReportEditor({ report, dbs, onClose }: ReportEditorProps) {
  const { draft, patch, toggleType, setFilter, addFilter, removeFilter, eff } = useReportDraft(report);

  return (
    <div className="flex flex-col gap-2 border border-sky-800 bg-slate-900/60 p-2">
      <ReportEditorFields draft={draft} dbs={dbs} patch={patch} toggleType={toggleType} />

      <ReportTestButtons eff={eff} />

      <div className="flex items-center gap-2">
        <span className="flex-1 text-slate-400 text-xs">Filters</span>
        <Button icon={<IconPlus size={14} />} tooltip="Add a filter input" onClick={addFilter}>
          Add filter
        </Button>
      </div>
      {draft.filters.map((f, i) => (
        <FilterEditRow
          // biome-ignore lint/suspicious/noArrayIndexKey: filters are edited positionally (add/remove by index)
          key={i}
          report={eff()}
          filter={f}
          onChange={(p) => setFilter(i, p)}
          onRemove={() => removeFilter(i)}
        />
      ))}

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
          icon={<IconTrash size={14} />}
          className="ml-auto"
          tooltip="Delete this report"
          onClick={() => {
            void dialogs.confirm(`Delete report "${draft.name}"?`, { okLabel: 'Delete' }).then((ok) => {
              if (ok) {
                void act.remove(draft.id);
                onClose();
              }
            });
          }}
        >
          Delete
        </Button>
      </div>
    </div>
  );
}
