import { Button } from '@treDeSpaceUI/widgets';
import { sqlReportsActions as act } from '../../../state/sqlReports/sqlReports.actions';
import type { ReportDef } from '../../../state/sqlReports/sqlReports.state';
import { sqlReportsState } from '../../../state/sqlReports/sqlReports.state';
import { openSqlTablePanel } from '../sql-table/sqlTablePanel';
import { ReportColorButtons } from './ReportColorButtons';

/** The report's run buttons — the ones its enabled output types give it, each
 *  running the EFFECTIVE report (saved definition + the current run-time
 *  filter values) at the moment it is pressed. */
export function ReportRunButtons({ effective }: { effective: ReportDef }) {
  const { busy } = sqlReportsState.use();

  return (
    <div className="flex flex-wrap gap-2">
      {effective.types.includes('TABLE') && (
        <Button
          disabled={busy}
          shortcut="sql.reports.table"
          tooltip="Run and show the result in the SQL Table panel"
          onClick={() => void act.runTable(effective).then(() => openSqlTablePanel())}
        >
          Table
        </Button>
      )}
      {effective.types.includes('COLORING') && <ReportColorButtons report={effective} disabled={busy} />}
      {effective.types.includes('DETAIL') && (
        <Button
          tooltip="Open the SQL Detail panel and follow viewport clicks with this report. SQL that does not read TREE_VIEW_ARGS is wrapped to the clicked item's fullname. ALT+click prints the bound SQL to the Console."
          onClick={(e) => act.asDetail(effective, e.altKey)}
        >
          Detail
        </Button>
      )}
    </div>
  );
}
