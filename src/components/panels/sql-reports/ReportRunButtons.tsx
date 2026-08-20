import { Button } from '@treDeSpaceUI/widgets';
import { sqlReportsActions as act } from '../../../state/sqlReports/sqlReports.actions';
import type { ReportDef } from '../../../state/sqlReports/sqlReports.state';
import { sqlReportsState } from '../../../state/sqlReports/sqlReports.state';
import { bindDetailReport, openSqlDetailPanel } from '../sql-detail/sqlDetailPanel';
import { openSqlTablePanel } from '../sql-table/sqlTablePanel';
import type { ColorRow } from './reportValues';

type ReportRunButtonsProps = Readonly<{
  effective: ReportDef;
  onColorRows: (rows: ColorRow[] | null) => void;
}>;

/** The report's run buttons — one per enabled output type, running the
 *  EFFECTIVE report (saved definition + the current run-time filter values). */
export function ReportRunButtons({ effective, onColorRows }: ReportRunButtonsProps) {
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
      {effective.types.includes('COLORING') && (
        <Button
          disabled={busy}
          tooltip="Run the coloring query, then choose how to apply it"
          onClick={() => void act.runColoring(effective).then((rows) => onColorRows(rows))}
        >
          Coloring
        </Button>
      )}
      {effective.types.includes('DETAIL') && (
        <Button
          tooltip="Open the SQL Detail panel and follow viewport clicks with this report. ALT+click prints the bound SQL to the Console."
          onClick={(e) => {
            bindDetailReport(effective);
            if (e.altKey) {
              act.logDetailSql(effective);
            }
            openSqlDetailPanel();
          }}
        >
          Detail
        </Button>
      )}
    </div>
  );
}
