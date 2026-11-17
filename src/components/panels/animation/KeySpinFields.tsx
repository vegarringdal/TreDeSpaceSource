import { Checkbox, NumberInput, Vec3Input } from '@treDeSpaceUI/widgets';
import type { ObjectKey } from '../../../lib/animation/types';

const LABEL_W = 56;
const ONE_TURN = 360;

/** A key's multi-turn spin: whole turns about an axis on the way to it. */
export function KeySpinFields({
  spin,
  onChange,
}: {
  spin: ObjectKey['spin'];
  onChange: (spin: ObjectKey['spin']) => void;
}) {
  return (
    <>
      <Checkbox
        tooltip="Turn about an axis on the way to this key (a wheel, a fan) — the rotation above is where it ends"
        shortcut="animation.key.spin"
        label="Spin into this key"
        checked={spin !== undefined}
        onChange={(on) => onChange(on ? { axis: [0, 0, 1], degrees: ONE_TURN } : undefined)}
      />
      {spin && (
        <>
          <Vec3Input
            tooltips={['Spin axis X', 'Spin axis Y', 'Spin axis Z']}
            label="Axis"
            labelWidth={LABEL_W}
            value={spin.axis}
            step={0.1}
            onChange={(axis) => onChange({ axis, degrees: spin.degrees })}
          />
          <NumberInput
            tooltip="Extra degrees turned on the way (360 = one full turn; negative turns the other way)"
            decShortcut="animation.key.spinDegrees.dec"
            incShortcut="animation.key.spinDegrees.inc"
            label="Turns"
            labelPosition="left"
            labelWidth={LABEL_W}
            value={spin.degrees}
            step={45}
            unit="°"
            onChange={(degrees) => onChange({ axis: spin.axis, degrees })}
          />
        </>
      )}
    </>
  );
}
