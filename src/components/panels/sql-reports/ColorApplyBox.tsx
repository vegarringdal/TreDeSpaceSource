import { Button } from '@treDeSpaceUI/widgets';
import type { PackedNames } from '../../../lib/color/packedNames';
import { sqlReportsActions as act } from '../../../state/sqlReports/sqlReports.actions';

/** After a Coloring run: choose how the returned fullname/color rows (a
 *  packed list — never strings on this thread) are applied to the model (Set
 *  Color rules, white base, isolate, or selection). */
export function ColorApplyBox({ rows }: { rows: PackedNames }) {
  return (
    <div className="flex flex-col gap-1 border border-slate-800 p-1.5">
      <span className="text-[11px] text-slate-500">{rows.count.toLocaleString()} rows — apply as:</span>
      <div className="flex flex-wrap gap-2">
        <Button
          tooltip="Run your current Set Color rules + the result appended as one extra Multi rule (Set Color panel untouched)"
          onClick={() => void act.colorSetColor(rows)}
        >
          Set color
        </Button>
        <Button
          tooltip="Everything white + the returned rows their own colors (Set Color panel untouched)"
          onClick={() => void act.colorWhite(rows)}
        >
          White
        </Button>
        <Button
          tooltip="Isolate the result: hits keep their colors, everything else fades to opacity 0 (Reset model recovers)"
          onClick={() => void act.colorHidden(rows)}
        >
          Hidden
        </Button>
        <Button tooltip="Select every returned fullname in the viewer" onClick={() => void act.colorSelection(rows)}>
          Selection
        </Button>
      </div>
    </div>
  );
}
