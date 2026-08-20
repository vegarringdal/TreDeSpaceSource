import { Button } from '@treDeSpaceUI/widgets';
import { sqlReportsActions as act } from '../../../state/sqlReports/sqlReports.actions';
import type { ReportDef } from '../../../state/sqlReports/sqlReports.state';
import { bindDetailReport, openSqlDetailPanel } from '../sql-detail/sqlDetailPanel';
import { openSqlTablePanel } from '../sql-table/sqlTablePanel';

/** Test buttons for the editor — each runs the DRAFT (via `eff`) against the
 *  model right here, unsaved edits included. */
export function ReportTestButtons({ eff }: { eff: () => ReportDef }) {
  return (
    <div className="flex flex-wrap gap-2 border-slate-800 border-y py-2">
      <span className="w-full text-slate-400 text-xs">Test</span>
      <Button
        tooltip="Run and show in the SQL Table panel"
        onClick={() => void act.runTable(eff()).then(openSqlTablePanel)}
      >
        As Table
      </Button>
      <Button
        tooltip="Everything white + the returned rows their colors"
        onClick={() => void act.runColoring(eff()).then((rows) => rows && act.colorWhite(rows))}
      >
        Color White
      </Button>
      <Button
        tooltip="Isolate the result: hits keep their colors, everything else fades to opacity 0"
        onClick={() => void act.runColoring(eff()).then((rows) => rows && act.colorHidden(rows))}
      >
        Color Hidden
      </Button>
      <Button
        tooltip="Run your current Set Color rules + the result appended as one extra Multi rule (Set Color panel untouched)"
        onClick={() => void act.runColoring(eff()).then((rows) => rows && act.colorSetColor(rows))}
      >
        Color Set
      </Button>
      <Button
        tooltip="Bind this draft to the SQL Detail panel (follows viewport clicks). ALT+click prints the bound SQL."
        onClick={(e) => {
          bindDetailReport(eff());
          if (e.altKey) {
            act.logDetailSql(eff());
          }
          openSqlDetailPanel();
        }}
      >
        As Detail
      </Button>
    </div>
  );
}
