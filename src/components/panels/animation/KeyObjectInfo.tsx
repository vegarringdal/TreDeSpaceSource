import { IconCrosshair, IconTrash } from '@tabler/icons-react';
import { Button, Checkbox, Collapsible, SegmentedControl, Select, TextInput } from '@treDeSpaceUI/widgets';
import type { AnimObject, ObjectPivot, PivotAnchor } from '../../../lib/animation/types';
import { objectsActions } from '../../../state/animation/objects.actions';
import { ObjectItemsFields } from './ObjectItemsFields';
import { SlideInFields } from './SlideInFields';

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

const LABEL_W = 56;

/** The object's pivot — what keys "as the object" turn about. */
const PIVOTS: readonly { value: PivotAnchor | 'point'; label: string; tooltip: string }[] = [
  { value: 'center', label: 'Centre', tooltip: "The centre of its items' box where they stand in the model" },
  { value: 'bottom', label: 'Bottom', tooltip: 'The middle of the bottom of its box (−Z)' },
  { value: 'top', label: 'Top', tooltip: 'The middle of the top of its box (+Z)' },
  { value: 'front', label: 'Front', tooltip: 'The middle of the front of its box (−Y)' },
  { value: 'back', label: 'Back', tooltip: 'The middle of the back of its box (+Y)' },
  { value: 'left', label: 'Left', tooltip: 'The middle of the left side of its box (−X)' },
  { value: 'right', label: 'Right', tooltip: 'The middle of the right side of its box (+X)' },
  {
    value: 'point',
    label: 'Point',
    tooltip:
      "A fixed point of the object: where the gizmo's pivot is now (move it with the Transform ribbon's Set pivot)",
  },
];

const PATHS = [
  {
    value: 'straight',
    label: 'Straight',
    tooltip: 'Straight lines between its keys',
    shortcut: 'animation.path.straight',
  },
  { value: 'smooth', label: 'Smooth', tooltip: 'A curve through its keys', shortcut: 'animation.path.smooth' },
] as const;

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

const pivotMode = (p: ObjectPivot) => (Array.isArray(p) ? 'point' : p);

// -----------------------------------------------------------------------------
// component
// -----------------------------------------------------------------------------

/** The object itself: name, items (added and left out), pivot, path,
 *  Slide in, mute, delete. */
export function KeyObjectInfo({ object }: { object: AnimObject }) {
  const handlePivot = (m: PivotAnchor | 'point') => {
    if (m === 'point') {
      objectsActions.pivotFromGizmo(object.id);
      return;
    }
    objectsActions.setPivot(object.id, m);
  };

  return (
    <Collapsible title="Object" aside={`${object.keys.length} key${object.keys.length === 1 ? '' : 's'}`} defaultOpen>
      <div className="flex flex-col gap-1.5">
        <TextInput
          tooltip="The object's name on its Timeline row"
          label="Name"
          labelPosition="left"
          labelWidth={LABEL_W}
          value={object.name}
          onChange={(name) => objectsActions.rename(object.id, name)}
        />
        <ObjectItemsFields object={object} />
        <div className="flex items-center gap-2 text-xs">
          <span className="shrink-0 text-slate-400" style={{ width: LABEL_W }}>
            Pivot
          </span>
          <Select
            className="min-w-0 flex-1"
            tooltip="What its keys turn about unless a key has a pivot of its own"
            shortcut="animation.object.pivot.next"
            value={pivotMode(object.pivot)}
            options={PIVOTS}
            clearable={false}
            onChange={(m) => m && handlePivot(m)}
          />
          <Button
            iconOnly
            size="sm"
            icon={<IconCrosshair />}
            tooltip="Pivot = the point of the object under the gizmo's pivot (move that with the Transform ribbon's Set pivot); nothing moves"
            shortcut="animation.object.pivotFromGizmo"
            onClick={() => objectsActions.pivotFromGizmo(object.id)}
          />
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="shrink-0 text-slate-400" style={{ width: LABEL_W }}>
            Path
          </span>
          <SegmentedControl
            size="sm"
            grow
            value={object.path}
            options={PATHS}
            onChange={(path) => objectsActions.setPath(object.id, path)}
          />
        </div>
        <SlideInFields object={object} />
        <div className="flex items-center gap-2">
          <Checkbox
            className="flex-1"
            tooltip="Not animated: its items stand where the model has them"
            shortcut="animation.object.mute"
            label="Muted"
            checked={object.muted === true}
            onChange={() => objectsActions.toggleMuted(object.id)}
          />
          <Button
            size="sm"
            variant="ghost"
            icon={<IconTrash />}
            tooltip="Delete the object and its keys (its items stay where the model has them)"
            shortcut="animation.object.remove"
            onClick={() => objectsActions.remove(object.id)}
          >
            Delete object
          </Button>
        </div>
      </div>
    </Collapsible>
  );
}
