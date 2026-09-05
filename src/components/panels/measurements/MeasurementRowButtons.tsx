import { IconAngle, IconEye, IconEyeOff, IconSphere, IconTag, IconTrash, IconTrendingUp } from '@tabler/icons-react';
import { Button } from '@treDeSpaceUI/widgets';
import { measurementsActions as act } from '../../../state/viewer/measurements.actions';
import type { Measurement } from '../../../state/viewer/measurements.state';

/** One measurement's row toggles — label, 3D spheres, perpendicular helper,
 *  reflex angle, slope, visibility — and delete. */
export function MeasurementRowButtons({ m }: { m: Measurement }) {
  return (
    <>
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
        active={!!m.sphere}
        onClick={() => act.toggleSphere(m.id)}
        tooltip="3D sphere at each point, depth tested (size and colour under Config)"
      >
        <IconSphere size={14} />
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
    </>
  );
}
