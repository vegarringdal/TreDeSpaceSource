import { IconDeviceFloppy, IconPencil, IconX } from '@tabler/icons-react';
import { Badge, Button, PanelHeader } from '@treDeSpaceUI/widgets';
import type { ReactNode } from 'react';
import { viewpointsActions as act } from '../../../state/viewer/viewpoints.actions';
import { viewpointsState } from '../../../state/viewer/viewpoints.state';

/** The "(viewpoint)" editor bars' Edit → Save / Cancel flow: Edit first, then
 *  the bar shows Save-to-viewpoint (lit while edits are unsaved) and Cancel —
 *  either one locks the editors again. Unsaved edits made while locked (a
 *  label placed in the viewport) bring the same two buttons up. */
export function ViewpointEditBar({ label, dirty }: { label: ReactNode; dirty: boolean }) {
  const s = viewpointsState.use();
  return (
    <PanelHeader
      variant="band"
      title={label}
      aside={dirty && <Badge tone="warning">unsaved edits</Badge>}
      actions={
        !s.editing && !dirty ? (
          <Button
            icon={<IconPencil size={14} />}
            tooltip="Unlock this viewpoint's editors — changes only stick once you Save to viewpoint"
            shortcut="viewpoints.editLive"
            onClick={() => act.startEditing()}
          >
            Edit
          </Button>
        ) : (
          <>
            <Button
              active={dirty}
              icon={<IconDeviceFloppy size={14} />}
              tooltip={
                dirty
                  ? 'Unsaved edits — save the current labels/measurements/rules into this viewpoint and leave editing'
                  : 'Everything is saved into this viewpoint — leave editing'
              }
              shortcut="viewpoints.saveLive"
              onClick={() => act.saveLiveToActive()}
            >
              Save to viewpoint
            </Button>
            <Button
              icon={<IconX size={14} />}
              tooltip="Leave editing without saving — labels, measurements and rules go back to what the viewpoint has saved (asks first when there are unsaved edits). Colors already painted by Run stay until you activate the viewpoint again."
              shortcut="viewpoints.cancelLive"
              onClick={() => void act.cancelEditing()}
            >
              Cancel
            </Button>
          </>
        )
      }
    />
  );
}
