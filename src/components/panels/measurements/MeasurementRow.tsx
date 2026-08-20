import {
  IconAngle,
  IconArrowAutofitHeight,
  IconChartArea,
  IconCircleDashed,
  IconEye,
  IconEyeOff,
  IconMapPin,
  IconRoute,
  IconRuler,
  IconTag,
  IconTrash,
  IconTrendingUp,
} from '@tabler/icons-react';
import { Button, Collapsible, TextInput } from '@treDeSpaceUI/widgets';
import { measurementsActions as act } from '../../../state/viewer/measurements.actions';
import {
  displayName,
  type Measurement,
  type MeasureToolKind,
  valueLabel,
} from '../../../state/viewer/measurements.state';
import { MeasurementAxisLegs } from './MeasurementAxisLegs';

const KIND_ICON: Record<MeasureToolKind, typeof IconRuler> = {
  point: IconMapPin,
  angle: IconAngle,
  line: IconRuler,
  path: IconRoute,
  area: IconChartArea,
  diameter: IconCircleDashed,
  face: IconArrowAutofitHeight,
};

/** One measurement's list row: rename, label/perpendicular/visibility toggles,
 *  delete, and the ΔX/ΔY/ΔZ leg controls for line/path measurements. */
export function MeasurementRow({ m, precision }: { m: Measurement; precision: number }) {
  const Icon = KIND_ICON[m.kind];
  const staircase = m.kind === 'line' || m.kind === 'path';

  return (
    // native shapes_panel-style section bar: name + live value aside
    <Collapsible
      key={m.id}
      title={displayName(m)}
      aside={<span className="font-mono text-amber-300">{valueLabel(m, precision)}</span>}
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Icon size={16} className="shrink-0 text-slate-400" />
          <div className="min-w-0 flex-1">
            <TextInput value={m.label} onChange={(v) => act.setLabel(m.id, v)} placeholder="(name)" />
          </div>
          <Button
            iconOnly
            active={m.showLabel}
            onClick={() => act.toggleShowLabel(m.id)}
            tooltip="Show the name/value label in the viewport"
          >
            <IconTag size={14} />
          </Button>
          <Button
            iconOnly
            active={m.showPerp}
            disabled={!m.points.some((p) => p.clicked)}
            onClick={() => act.toggleShowPerp(m.id)}
            tooltip={
              m.points.some((p) => p.clicked)
                ? 'Show the perpendicular (Shift) construction helper'
                : 'No perpendicular (Shift) points in this measurement'
            }
          >
            <IconAngle size={14} />
          </Button>
          {m.kind === 'angle' && (
            <Button
              iconOnly
              active={m.flipAngle ?? false}
              onClick={() => act.toggleFlipAngle(m.id)}
              tooltip="Flip to the reflex angle (360° − θ)"
            >
              <IconAngle size={14} className="-scale-x-100" />
            </Button>
          )}
          {m.kind === 'line' && (
            <Button
              iconOnly
              active={m.slopeInLabel}
              onClick={() => act.toggleSlopeInLabel(m.id)}
              tooltip="Append the slope (∠ from horizontal + % fall) to the label"
            >
              <IconTrendingUp size={14} />
            </Button>
          )}
          <Button
            iconOnly
            onClick={() => act.toggleVisible(m.id)}
            tooltip={m.visible ? 'Hide in the viewport' : 'Show in the viewport'}
          >
            {m.visible ? <IconEye size={14} /> : <IconEyeOff size={14} />}
          </Button>
          <Button iconOnly onClick={() => act.remove(m.id)} tooltip="Delete this measurement">
            <IconTrash size={14} />
          </Button>
        </div>
        {staircase && <MeasurementAxisLegs m={m} />}
      </div>
    </Collapsible>
  );
}
