import { Button, Collapsible, ColorSelect, NumberInput } from '@treDeSpaceUI/widgets';
import { measurementsActions as act } from '../../../state/viewer/measurements.actions';
import { measurementsState } from '../../../state/viewer/measurements.state';

/** Config: value precision, line/marker color, mute-all and clear-all. */
export function MeasurementsConfigSection() {
  const { items, muted, precision, lineColor, sphere } = measurementsState.use();
  const allSpheres = items.length > 0 && items.every((m) => m.sphere);

  return (
    <Collapsible
      title="Config"
      defaultOpen={false}
      info="Decimals sets how many digits measurement values show. Color is used for every measurement's lines and markers. Sphere is the 3D point marker a row's sphere toggle draws — radius in metres and colour, applied to every measurement showing spheres. Mute all hides every measurement in the viewport without deleting them; Clear deletes them all."
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
      <label className="flex items-center gap-2 text-slate-400 text-xs">
        <span className="w-16 shrink-0">Sphere</span>
        <div className="w-24">
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
        </div>
        <div className="w-28">
          <ColorSelect value={sphere.color} onChange={(c) => act.setSphereDefault({ color: c })} />
        </div>
      </label>
      <label className="flex items-center gap-2 text-slate-400 text-xs">
        <span className="w-16 shrink-0">Sphere fill</span>
        <label
          className="flex cursor-pointer items-center gap-1 text-slate-300"
          data-tooltip="Fill the spheres (shaded, with the opacity beside) instead of drawing wireframes"
          data-shortcut="measure.sphereSolid"
        >
          <input type="checkbox" checked={sphere.solid} onChange={() => act.toggleSphereSolid()} />
          solid
        </label>
        <div className="w-24">
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
          onClick={() => act.toggleAllSpheres()}
          tooltip="Spheres at every point of every measurement — all on with the Config sphere, or all off"
          shortcut="measure.spheresAll"
        >
          {allSpheres ? 'Spheres off' : 'Spheres on'}
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
