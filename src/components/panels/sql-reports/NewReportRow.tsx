import { IconPlus } from '@tabler/icons-react';
import { Button } from '@treDeSpaceUI/widgets';
import { sqlReportsActions as act } from '../../../state/sqlReports/sqlReports.actions';
import { emptyReport } from '../../../state/sqlReports/sqlReports.state';

/** The "New report" button row: creates an empty report in the given store,
 *  saves it and drops straight into its editor. */
export function NewReportRow({ store }: { store: string }) {
  return (
    <div className="flex items-center justify-end border border-slate-800 p-1.5">
      <Button
        icon={<IconPlus size={14} />}
        shortcut="sql.reports.new"
        tooltip="Create a new report in this store (choose a main db, or None, in the editor)"
        onClick={() => {
          const report = emptyReport(crypto.randomUUID(), store);
          void act.save(report).then(() => {
            act.setEdit(report.id);
            act.setOpen(report.id);
          });
        }}
      >
        New report
      </Button>
    </div>
  );
}
