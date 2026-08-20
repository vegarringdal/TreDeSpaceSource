import {
  IconArrowDown,
  IconArrowUp,
  IconCamera,
  IconPlayerPlay,
  IconRowInsertTop,
  IconTrash,
} from '@tabler/icons-react';
import { Button } from '@treDeSpaceUI/widgets';
import { viewpointsActions as act } from '../../../state/viewer/viewpoints.actions';

/** A viewpoint row's action bar: activate, update camera/clip, delete,
 *  insert-before and reorder. */
export function ViewpointRowActions({ vpId, idx, total }: { vpId: string; idx: number; total: number }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <Button
        icon={<IconPlayerPlay size={14} />}
        tooltip="Activate: fly the camera, apply clipping, show this viewpoint's labels/measurements, run its color rules and select its items"
        shortcut="viewpoints.activate"
        onClick={() => void act.activate(vpId)}
      >
        Activate
      </Button>
      <Button
        icon={<IconCamera size={14} />}
        tooltip="Update this viewpoint's camera pose and clipping (box + planes + shapes) from the current view"
        shortcut="viewpoints.updateCamera"
        onClick={() => act.updateCameraClip(vpId)}
      >
        Update camera/clip
      </Button>
      <Button
        icon={<IconTrash size={14} />}
        tooltip="Delete this viewpoint"
        shortcut="viewpoints.delete"
        onClick={() => act.remove(vpId)}
      >
        Delete
      </Button>
      <Button
        iconOnly
        icon={<IconRowInsertTop size={14} />}
        tooltip="Insert a NEW empty viewpoint (current camera + clipping) before this one"
        onClick={() => act.addViewpointBefore(vpId)}
      />
      <Button
        iconOnly
        icon={<IconArrowUp size={14} />}
        disabled={idx === 0}
        tooltip="Move this viewpoint up in the list"
        onClick={() => act.move(vpId, -1)}
      />
      <Button
        iconOnly
        icon={<IconArrowDown size={14} />}
        disabled={idx === total - 1}
        tooltip="Move this viewpoint down in the list"
        onClick={() => act.move(vpId, 1)}
      />
    </div>
  );
}
