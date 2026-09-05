import { Collapsible, ColorSelect, NumberInput } from '@treDeSpaceUI/widgets';
import type { ReactNode } from 'react';
import { labelsActions as act } from '../../../state/viewer/labels.actions';
import { labelsState } from '../../../state/viewer/labels.state';
import { DEFAULT_SPHERE_MARKER } from '../../../state/viewer/sphereMarker';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-slate-400 text-xs">{label}</span>
      <div className="w-32 shrink-0">{children}</div>
    </div>
  );
}

/** Labels → Style: colors/opacity for the selection or the next labels. */
export function LabelsStyleSection() {
  const s = labelsState.use();
  const selCount = s.items.filter((l) => l.selected).length;

  return (
    <Collapsible title="Style" defaultOpen={false}>
      <div className="text-slate-500 text-xs">
        Applies to the {selCount > 0 ? `${selCount} selected label(s)` : 'next labels you create'}.
      </div>
      <Row label="Label color">
        <ColorSelect value={s.bg} onChange={(c) => act.setStyle({ bg: c })} />
      </Row>
      <Row label="Text color">
        <ColorSelect value={s.textColor} onChange={(c) => act.setStyle({ textColor: c })} />
      </Row>
      <Row label="Opacity">
        <NumberInput
          value={s.opacity}
          min={0.1}
          max={1}
          step={0.05}
          precision={2}
          onChange={(x) => act.setStyle({ opacity: x })}
        />
      </Row>
      <Row label="Leader line">
        <ColorSelect value={s.leaderColor} onChange={act.setLeaderColor} />
      </Row>
      <label
        className="flex cursor-pointer items-center gap-2 text-slate-300 text-xs"
        data-tooltip="Draw a wireframe sphere IN the scene at the anchor — depth tested, so the point reads at its true depth"
        data-shortcut="labels.sphere"
      >
        <input type="checkbox" checked={s.sphere !== null} onChange={() => act.toggleSphereStyle()} />
        3D sphere at the anchor
      </label>
      <Row label="Sphere size">
        <NumberInput
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
      </Row>
      <Row label="Sphere color">
        <ColorSelect
          value={s.sphere?.color ?? DEFAULT_SPHERE_MARKER.color}
          onChange={(c) => act.setStyle({ sphere: { ...DEFAULT_SPHERE_MARKER, ...s.sphere, color: c } })}
        />
      </Row>
      <label
        className="flex cursor-pointer items-center gap-2 text-slate-300 text-xs"
        data-tooltip="Fill the sphere (shaded, with the opacity below) instead of drawing a wireframe"
        data-shortcut="labels.sphereSolid"
      >
        <input
          type="checkbox"
          disabled={s.sphere === null}
          checked={s.sphere?.solid ?? DEFAULT_SPHERE_MARKER.solid}
          onChange={() => act.toggleSphereSolid()}
        />
        Solid sphere
      </label>
      <Row label="Sphere opacity">
        <NumberInput
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
      </Row>
      <label className="flex cursor-pointer items-center gap-2 text-slate-300 text-xs">
        <input type="checkbox" checked={s.richText} onChange={(e) => act.setRichText(e.target.checked)} />
        Styled text (multiline, **bold** spans)
      </label>
    </Collapsible>
  );
}
