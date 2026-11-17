import { IconCamera, IconPlayerPlay, IconTrash } from '@tabler/icons-react';
import { Button } from '@treDeSpaceUI/widgets';
import { viewpointsActions as act } from '../../../state/viewer/viewpoints.actions';

/** A viewpoint row's action bar: activate, update camera/clip, delete
 *  (insert-before and reorder live in the section header). */
export function ViewpointRowActions({ vpId }: { vpId: string }) {
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
    </div>
  );
}
