import { Button, Checkbox, Collapsible, ColorSelect, NumberInput } from '@treDeSpaceUI/widgets';
import { measurementsActions as act } from '../../../state/viewer/measurements.actions';
import { measurementsState } from '../../../state/viewer/measurements.state';

/** Label column of this section's rows, in px. */
const LABEL_W = 64;

/** Config: value precision, line/marker color and spheres. */
export function MeasurementsConfigSection() {
  const { items, precision, lineColor, sphere } = measurementsState.use();
  const allSpheres = items.length > 0 && items.every((m) => m.sphere);

  return (
    <Collapsible
      title="Config"
      defaultOpen={false}
      info="Decimals sets how many digits measurement values show. Color is used for every measurement's lines and markers. Sphere is the 3D point marker a row's sphere toggle draws — radius in metres and colour, applied to every measurement showing spheres. Mute all hides every measurement in the viewport without deleting them; Clear deletes them all."
    >
      <NumberInput
        label="Decimals"
        labelPosition="left"
        labelWidth={LABEL_W}
        value={precision}
        min={0}
        max={6}
        step={1}
        onChange={(v) => act.setPrecision(v)}
        decShortcut="measure.precision.dec"
        incShortcut="measure.precision.inc"
      />
      <ColorSelect
        label="Color"
        labelPosition="left"
        labelWidth={LABEL_W}
        value={lineColor}
        onChange={act.setLineColor}
      />
      <div className="grid items-center gap-2" style={{ gridTemplateColumns: `${LABEL_W}px 1fr 1fr` }}>
        <span className="truncate text-slate-400 text-xs">Sphere</span>
        <NumberInput
          value={sphere.size}
          min={0.01}
          step={0.05}
          precision={2}
          unit="m"
          onChange={(v) => act.setSphereDefault({ size: v })}
          decShortcut="measure.sphereSize.dec"
          incShortcut="measure.sphereSize.inc"
        />
        <ColorSelect value={sphere.color} onChange={(c) => act.setSphereDefault({ color: c })} />
        <span className="truncate text-slate-400 text-xs">Sphere fill</span>
        <Checkbox
          label="solid"
          checked={sphere.solid}
          onChange={() => act.toggleSphereSolid()}
          shortcut="measure.sphereSolid"
          tooltip="Fill the spheres (shaded, with the opacity beside) instead of drawing wireframes"
        />
        <NumberInput
          value={sphere.opacity}
          min={0.05}
          max={1}
          step={0.05}
          precision={2}
          disabled={!sphere.solid}
          onChange={(v) => act.setSphereDefault({ opacity: v })}
          decShortcut="measure.sphereOpacity.dec"
          incShortcut="measure.sphereOpacity.inc"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={items.length === 0}
          onClick={() => act.toggleAllSpheres()}
          tooltip="Spheres at every point of every measurement — all on with the Config sphere, or all off"
          shortcut="measure.spheresAll"
        >
          {allSpheres ? 'Spheres off' : 'Spheres on'}
        </Button>
      </div>
    </Collapsible>
  );
}
