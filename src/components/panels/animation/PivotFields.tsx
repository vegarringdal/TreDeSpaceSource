import { Select, Vec3Input } from '@treDeSpaceUI/widgets';
import type { ReactNode } from 'react';
import type { PivotChoice } from '../../../lib/animation/pivots';

const LABEL_W = 56;
const STEP_M = 0.05;

/** The pivots a key can turn about (the sides follow the view cube). */
const OPTIONS: readonly { value: PivotChoice['at']; label: string; tooltip: string }[] = [
  { value: 'object', label: 'As the object', tooltip: "The object's own pivot (Object › Pivot)" },
  { value: 'center', label: 'Centre', tooltip: "The centre of its items' box where they stand in the model" },
  { value: 'bottom', label: 'Bottom', tooltip: 'The middle of the bottom of its box (−Z)' },
  { value: 'top', label: 'Top', tooltip: 'The middle of the top of its box (+Z)' },
  { value: 'front', label: 'Front', tooltip: 'The middle of the front of its box (−Y)' },
  { value: 'back', label: 'Back', tooltip: 'The middle of the back of its box (+Y)' },
  { value: 'left', label: 'Left', tooltip: 'The middle of the left side of its box (−X)' },
  { value: 'right', label: 'Right', tooltip: 'The middle of the right side of its box (+X)' },
];

/** A key's pivot as the Key panel shows it: what Move and Rotate are about
 *  and what it turns about on the way in, plus an offset (m) — the object
 *  stays where it is when they change. Picking a side starts its offset at
 *  zero; dragging the gizmo's pivot writes the offset. */
export function PivotFields({
  choice,
  onChange,
  actions,
}: {
  choice: PivotChoice;
  onChange: (choice: PivotChoice) => void;
  /** buttons after the picker (take / show the Transform pivot) */
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <Select
          className="min-w-0 flex-1"
          tooltip="What Move and Rotate are about, and what it turns about on the way here"
          shortcut="animation.key.pivot.next"
          label="Pivot"
          labelPosition="left"
          labelWidth={LABEL_W}
          value={choice.at}
          options={OPTIONS}
          clearable={false}
          onChange={(at) => at && onChange({ at, offset: [0, 0, 0] })}
        />
        {actions}
      </div>
      <Vec3Input
        label="Offset"
        labelWidth={LABEL_W}
        step={STEP_M}
        unit="m"
        tooltips={[
          'Pivot offset X (m) from the side above — dragging the pivot in the view sets it too',
          'Pivot offset Y (m) from the side above — dragging the pivot in the view sets it too',
          'Pivot offset Z (m) from the side above — dragging the pivot in the view sets it too',
        ]}
        value={choice.offset}
        onChange={(offset) => onChange({ ...choice, offset })}
      />
    </div>
  );
}
