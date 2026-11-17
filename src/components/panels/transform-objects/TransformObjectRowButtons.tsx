import { IconEye, IconEyeOff, IconListTree, IconPointer, IconRestore, IconTrash } from '@tabler/icons-react';
import { Button } from '@treDeSpaceUI/widgets';
import { isIdentityPose } from '../../../lib/transform/pose';
import type { TransformObject } from '../../../lib/transform/types';
import { transformActions as act } from '../../../state/transform/transform.actions';
import { transformObjectsUiActions as ui } from './transformObjectsUi.actions';

const ICON = 14;

/** One object's header buttons: open / close the rows of its sub-objects
 *  (when it has any), pick it (its items become the selection, so the ribbon
 *  moves it), mute, reset and delete. The hotkeys act on the current object,
 *  so only its row shows them. */
export function TransformObjectRowButtons({
  object,
  isCurrent,
  hasSubObjects,
  isResting,
}: {
  object: TransformObject;
  isCurrent: boolean;
  hasSubObjects: boolean;
  /** animation is active: mute, reset and delete are off */
  isResting: boolean;
}) {
  return (
    <>
      {hasSubObjects && (
        <Button
          iconOnly
          onClick={() => ui.toggleSubObjects(object.id)}
          tooltip="Collapse the rows of this object's sub-objects — or expand them all when none is open"
          shortcut={isCurrent ? 'transform.object.children' : undefined}
        >
          <IconListTree size={ICON} />
        </Button>
      )}
      <Button
        iconOnly
        active={isCurrent}
        onClick={() => void act.select(object.id)}
        tooltip="Select this object's items — it becomes the current object, the one the ribbon and the gizmo move"
      >
        <IconPointer size={ICON} />
      </Button>
      <Button
        iconOnly
        active={object.muted === true}
        disabled={isResting}
        onClick={() => act.toggleMuted(object.id)}
        tooltip={
          object.muted
            ? 'Muted: shown where the model has it. Click to show it moved again.'
            : 'Mute: show it where the model has it, keeping its numbers'
        }
        shortcut={isCurrent ? 'transform.object.mute' : undefined}
      >
        {object.muted ? <IconEyeOff size={ICON} /> : <IconEye size={ICON} />}
      </Button>
      <Button
        iconOnly
        disabled={isResting || isIdentityPose(object)}
        onClick={() => act.resetPose(object.id)}
        tooltip="Reset: back where the model has it (the object stays in the list)"
        shortcut={isCurrent ? 'transform.resetSel' : undefined}
      >
        <IconRestore size={ICON} />
      </Button>
      <Button
        iconOnly
        disabled={isResting}
        onClick={() => act.remove(object.id)}
        tooltip="Delete this object. Its items go back under what it rode on; its sub-objects stay where they are."
        shortcut={isCurrent ? 'transform.object.remove' : undefined}
      >
        <IconTrash size={ICON} />
      </Button>
    </>
  );
}
