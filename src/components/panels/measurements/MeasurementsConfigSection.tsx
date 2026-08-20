import { Button, Collapsible, ColorSelect, NumberInput } from '@treDeSpaceUI/widgets';
import { measurementsActions as act } from '../../../state/viewer/measurements.actions';
import { measurementsState } from '../../../state/viewer/measurements.state';

/** Config: value precision, line/marker color, mute-all and clear-all. */
export function MeasurementsConfigSection() {
  const { items, muted, precision, lineColor } = measurementsState.use();

  return (
    <Collapsible
      title="Config"
      defaultOpen={false}
      info="Decimals sets how many digits measurement values show. Color is used for every measurement's lines and markers. Mute all hides every measurement in the viewport without deleting them; Clear deletes them all."
    >
      <label className="flex items-center gap-2 text-slate-400 text-xs">
        <span className="w-16 shrink-0">Decimals</span>
        <div className="w-20">
          <NumberInput
            value={precision}
            min={0}
            max={6}
            step={1}
            onChange={(v) => act.setPrecision(v)}
            decShortcut="measure.precision.dec"
            incShortcut="measure.precision.inc"
          />
        </div>
      </label>
      <label className="flex items-center gap-2 text-slate-400 text-xs">
        <span className="w-16 shrink-0">Color</span>
        <div className="w-28">
          <ColorSelect value={lineColor} onChange={act.setLineColor} />
        </div>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          active={muted}
          onClick={() => act.toggleMuted()}
          tooltip="Hide/show all measurements in the viewport"
          shortcut="measure.muteAll"
        >
          {muted ? 'Show all' : 'Mute all'}
        </Button>
        <Button
          disabled={items.length === 0}
          onClick={() => act.clear()}
          tooltip="Delete every measurement"
          shortcut="measure.clearAll"
        >
          Clear
        </Button>
      </div>
    </Collapsible>
  );
}
