import { Button } from '@treDeSpaceUI/widgets';
import { sqlReportsActions as act, type ReportColorUse } from '../../../state/sqlReports/sqlReports.actions';
import type { ReportDef } from '../../../state/sqlReports/sqlReports.state';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type ReportColorButtonsProps = Readonly<{
  report: ReportDef;
  disabled: boolean;
}>;

type ColorButton = Readonly<{ use: ReportColorUse; label: string; tooltip: string }>;

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const COLOR_BUTTONS: readonly ColorButton[] = [
  {
    use: 'white',
    label: 'As White',
    tooltip: 'Run the report: everything white + the returned rows their own colors (default yellow)',
  },
  {
    use: 'transparent',
    label: 'As Transparent',
    tooltip:
      'Run the report like As White, but with the base coat white at 10% opacity — the rest of the model stays faintly visible',
  },
  {
    use: 'hidden',
    label: 'As Hidden',
    tooltip:
      'Run the report and isolate the result: the returned rows keep their colors, everything else is hidden (Reset model in Set Color recovers)',
  },
  {
    use: 'set',
    label: 'Use Set Color',
    tooltip:
      'Run the report, then your current Set Color rules + the result appended as one extra Multi rule (Set Color panel untouched)',
  },
  {
    use: 'selection',
    label: 'As Selection',
    tooltip:
      'Run the report and select the result in the viewer: every returned fullname becomes the selection (colors untouched)',
  },
];

// -----------------------------------------------------------------------------
// Render
// -----------------------------------------------------------------------------

/** A COLORING report's buttons, the same five the SQL Editor has. Each click
 *  runs `report` again and applies that result — nothing is kept from an
 *  earlier run, so the current filter values always decide what is painted. */
export function ReportColorButtons({ report, disabled }: ReportColorButtonsProps) {
  return (
    <>
      {COLOR_BUTTONS.map((b) => (
        <Button key={b.use} disabled={disabled} tooltip={b.tooltip} onClick={() => void act.runAndColor(report, b.use)}>
          {b.label}
        </Button>
      ))}
    </>
  );
}
