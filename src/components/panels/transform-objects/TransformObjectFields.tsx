import { Select, type SelectOption, TextInput, Vec3Input } from '@treDeSpaceUI/widgets';
import { useMemo } from 'react';
import type { PivotAnchor } from '../../../lib/animation/types';
import { ridesOn } from '../../../lib/transform/pose';
import type { TransformObject, V3 } from '../../../lib/transform/types';
import { transformActions as act } from '../../../state/transform/transform.actions';
import { transformState } from '../../../state/transform/transform.state';
import { useTransformResting } from '../../../state/transform/useTransformResting';
import { FieldCaption } from './FieldCaption';
import { TransformObjectItems } from './TransformObjectItems';
import { TransformPoseFields } from './TransformPoseFields';

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

const LABEL_W = 56;
const OFFSET_STEP_M = 0.05;
const OFFSET_PRECISION = 3;
const ZERO: V3 = [0, 0, 0];

type PivotSide = PivotAnchor | 'point';

/** The sides follow the view cube. */
const PIVOT_SIDES: readonly SelectOption<PivotSide>[] = [
  { value: 'center', label: 'Centre' },
  { value: 'bottom', label: 'Bottom', hint: '−Z' },
  { value: 'top', label: 'Top', hint: '+Z' },
  { value: 'front', label: 'Front', hint: '−Y' },
  { value: 'back', label: 'Back', hint: '+Y' },
  { value: 'left', label: 'Left', hint: '−X' },
  { value: 'right', label: 'Right', hint: '+X' },
];

const POINT_OPTION: SelectOption<PivotSide> = { value: 'point', label: 'Point', hint: 'from a file' };

// -----------------------------------------------------------------------------
// component
// -----------------------------------------------------------------------------

/** One object's fields: name, its pose (TransformPoseFields), what the pose
 *  is about (pivot), what the object rides on and its items. Changing the pivot or the
 *  parent never moves it. While animating the fields are greyed out; the
 *  items line below them keeps its read-only buttons. */
export function TransformObjectFields({ object }: { object: TransformObject }) {
  const objects = transformState.useSelect((s) => s.objects);
  const isResting = useTransformResting();

  const isPoint = Array.isArray(object.pivot.at);
  const side: PivotSide = Array.isArray(object.pivot.at) ? 'point' : object.pivot.at;
  const parents = useMemo<SelectOption[]>(
    () =>
      objects
        .filter((o) => o.id !== object.id && !ridesOn(objects, o.id, object.id))
        .map((o) => ({ value: o.id, label: o.name })),
    [objects, object.id],
  );

  const handleSide = (at: PivotSide | null) => {
    if (at && at !== 'point') {
      act.setPivot(object.id, { at });
    }
  };

  const handleOffset = (offset: V3) => {
    act.setPivot(object.id, { at: object.pivot.at, ...(offset.some((v) => v !== 0) ? { offset } : {}) });
  };

  return (
    <div className="flex flex-col gap-1">
      {/* a disabled fieldset greys out every field inside while the objects rest (animation) */}
      <fieldset disabled={isResting} className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0">
        <TextInput
          label="Name"
          labelPosition="left"
          labelWidth={LABEL_W}
          value={object.name}
          onChange={(name) => act.rename(object.id, name)}
        />
        <TransformPoseFields object={object} />
        <Select
          label="Pivot"
          labelPosition="left"
          labelWidth={LABEL_W}
          tooltip="What Move, Rotate and Scale are about: a side of the object's box where the model has it. The gizmo sits here; Set Pivot on the ribbon drags it (that writes the offset below). Changing it does not move the object."
          value={side}
          options={isPoint ? [...PIVOT_SIDES, POINT_OPTION] : PIVOT_SIDES}
          clearable={false}
          onChange={handleSide}
        />
        <FieldCaption>Pivot offset X / Y / Z (m)</FieldCaption>
        <Vec3Input
          step={OFFSET_STEP_M}
          precision={OFFSET_PRECISION}
          tooltips={[
            'Pivot offset X (m) from the side above',
            'Pivot offset Y (m) from the side above',
            'Pivot offset Z (m) from the side above',
          ]}
          value={object.pivot.offset ?? ZERO}
          onChange={handleOffset}
        />
        <Select
          label="Rides on"
          labelPosition="left"
          labelWidth={LABEL_W}
          placeholder="Nothing — it stands on its own"
          tooltip="The object this one rides on: moving that one carries this one along. Set by itself when an object is made inside another; clear it to detach. Changing it does not move the object."
          value={object.parent ?? null}
          options={parents}
          searchable
          onChange={(parent) => act.setParent(object.id, parent)}
        />
      </fieldset>
      <TransformObjectItems object={object} />
    </div>
  );
}
