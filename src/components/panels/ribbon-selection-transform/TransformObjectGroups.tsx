import { IconCubePlus } from '@tabler/icons-react';
import { RibbonButton, RibbonSection } from '@treDeSpaceUI/widgets';
import { transformState } from '../../../state/transform/transform.state';
import { TRANSFORM_RESTING_HINT, useTransformResting } from '../../../state/transform/useTransformResting';
import { selectionState } from '../../../state/viewer/selection.state';
import { ribbonSelectionTransformActions as act } from './ribbonSelectionTransform.actions';

/** What New Object says: why it is off (animating, or the selection is an
 *  object already), else what it does. */
function newObjectTooltip(isResting: boolean, currentName: string | null): string {
  if (isResting) {
    return TRANSFORM_RESTING_HINT;
  }

  if (currentName) {
    return `The selection is the object "${currentName}" already — the ribbon and the gizmo move it. Select other items to make another; a selection inside an object becomes its sub-object and rides on it.`;
  }

  return 'Make the selection a transform object — what the ribbon and the gizmo then move. A selection inside another object becomes its sub-object and rides on it.';
}

/** The first step of moving anything: the selection becomes a transform
 *  object. Off while the selection is an object already (its tooltip names
 *  it) — that is the current object, the one the rest of the ribbon moves. */
export function TransformObjectGroups() {
  const none = selectionState.useSelect((s) => s.count === 0);
  const currentName = transformState.useSelect((s) => s.objects.find((o) => o.id === s.currentId)?.name ?? null);
  const isResting = useTransformResting();

  return (
    <RibbonSection title="Object">
      <RibbonButton
        icon={<IconCubePlus />}
        label="New Object"
        disabled={none || currentName !== null || isResting}
        tooltip={newObjectTooltip(isResting, currentName)}
        shortcut="transform.object.new"
        onClick={act.newObject}
      />
    </RibbonSection>
  );
}
