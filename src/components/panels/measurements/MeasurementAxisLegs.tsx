import { Button } from '@treDeSpaceUI/widgets';
import { measurementsActions as act } from '../../../state/viewer/measurements.actions';
import type { Measurement } from '../../../state/viewer/measurements.state';

/** The ΔX/ΔY/ΔZ "staircase" controls of a line/path row: per-axis leg and
 *  leg-length toggles, all-legs toggle, and the Σ append-to-label toggle. */
export function MeasurementAxisLegs({ m }: { m: Measurement }) {
  return (
    <div className="flex flex-wrap items-center gap-1 pl-6">
      <Button
        active={m.axisLegs.every((l) => l)}
        onClick={() => act.toggleAllAxisLegs(m.id)}
        tooltip="Toggle all ΔX/ΔY/ΔZ legs"
      >
        XYZ
      </Button>
      {(['X', 'Y', 'Z'] as const).map((name, ax) => (
        <span key={name} className="flex gap-0.5">
          <Button
            active={m.axisLegs[ax]}
            onClick={() => act.toggleAxisLeg(m.id, ax as 0 | 1 | 2)}
            tooltip={`Show the Δ${name} leg`}
          >
            {name}
          </Button>
          <Button
            active={m.axisLabels[ax]}
            onClick={() => act.toggleAxisLabel(m.id, ax as 0 | 1 | 2)}
            tooltip={`Show the Δ${name} length`}
          >
            {name}T
          </Button>
        </span>
      ))}
      <Button
        active={m.legsInLabel}
        onClick={() => act.toggleLegsInLabel(m.id)}
        tooltip="Append the ΔX/ΔY/ΔZ lengths to the main label (X: … / Y: … / Z: …)"
      >
        ΣXYZ
      </Button>
    </div>
  );
}
