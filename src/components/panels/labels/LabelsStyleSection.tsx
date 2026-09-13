import { Checkbox, Collapsible, ColorSelect, NumberInput } from '@treDeSpaceUI/widgets';
import { labelsActions as act } from '../../../state/viewer/labels.actions';
import { labelsState } from '../../../state/viewer/labels.state';
import { DEFAULT_SPHERE_MARKER } from '../../../state/viewer/sphereMarker';

/** Field column of this section's label rows, in px. */
const FIELD_W = 128;

/** Labels → Style: colors/opacity for the selection or the next labels. */
export function LabelsStyleSection() {
  const s = labelsState.use();
  const selCount = s.items.filter((l) => l.selected).length;

  return (
    <Collapsible title="Style" defaultOpen={false}>
      <div className="text-slate-500 text-xs">
        Applies to the {selCount > 0 ? `${selCount} selected label(s)` : 'next labels you create'}.
      </div>
      <ColorSelect
        label="Label color"
        labelPosition="split"
        fieldWidth={FIELD_W}
        value={s.bg}
        onChange={(c) => act.setStyle({ bg: c })}
      />
      <ColorSelect
        label="Text color"
        labelPosition="split"
        fieldWidth={FIELD_W}
        value={s.textColor}
        onChange={(c) => act.setStyle({ textColor: c })}
      />
      <NumberInput
        label="Opacity"
        labelPosition="split"
        fieldWidth={FIELD_W}
        value={s.opacity}
        min={0.1}
        max={1}
        step={0.05}
        precision={2}
        onChange={(x) => act.setStyle({ opacity: x })}
      />
      <ColorSelect
        label="Leader line"
        labelPosition="split"
        fieldWidth={FIELD_W}
        value={s.leaderColor}
        onChange={act.setLeaderColor}
      />
      <Checkbox
        label="3D sphere at the anchor"
        checked={s.sphere !== null}
        onChange={() => act.toggleSphereStyle()}
        shortcut="labels.sphere"
        tooltip="Draw a wireframe sphere IN the scene at the anchor — depth tested, so the point reads at its true depth"
      />
      <NumberInput
        label="Sphere size"
        labelPosition="split"
        fieldWidth={FIELD_W}
        value={s.sphere?.size ?? DEFAULT_SPHERE_MARKER.size}
        min={0.01}
        step={0.05}
        precision={2}
        unit="m"
        disabled={s.sphere === null}
        decShortcut="labels.sphereSize.dec"
        incShortcut="labels.sphereSize.inc"
        onChange={(x) => act.setStyle({ sphere: { ...DEFAULT_SPHERE_MARKER, ...s.sphere, size: x } })}
      />
      <ColorSelect
        label="Sphere color"
        labelPosition="split"
        fieldWidth={FIELD_W}
        value={s.sphere?.color ?? DEFAULT_SPHERE_MARKER.color}
        onChange={(c) => act.setStyle({ sphere: { ...DEFAULT_SPHERE_MARKER, ...s.sphere, color: c } })}
      />
      <Checkbox
        label="Solid sphere"
        disabled={s.sphere === null}
        checked={s.sphere?.solid ?? DEFAULT_SPHERE_MARKER.solid}
        onChange={() => act.toggleSphereSolid()}
        shortcut="labels.sphereSolid"
        tooltip="Fill the sphere (shaded, with the opacity below) instead of drawing a wireframe"
      />
      <NumberInput
        label="Sphere opacity"
        labelPosition="split"
        fieldWidth={FIELD_W}
        value={s.sphere?.opacity ?? DEFAULT_SPHERE_MARKER.opacity}
        min={0.05}
        max={1}
        step={0.05}
        precision={2}
        disabled={!s.sphere?.solid}
        decShortcut="labels.sphereOpacity.dec"
        incShortcut="labels.sphereOpacity.inc"
        onChange={(x) => act.setStyle({ sphere: { ...DEFAULT_SPHERE_MARKER, ...s.sphere, opacity: x } })}
      />
      <Checkbox label="Styled text (multiline, **bold** spans)" checked={s.richText} onChange={act.setRichText} />
    </Collapsible>
  );
}
