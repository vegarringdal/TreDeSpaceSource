import { IconDeviceFloppy, IconPencil } from '@tabler/icons-react';
import { Badge, Button, PanelHeader } from '@treDeSpaceUI/widgets';
import type { ReactNode } from 'react';
import { viewpointsActions as act } from '../../../state/viewer/viewpoints.actions';
import { viewpointsState } from '../../../state/viewer/viewpoints.state';

/** The "(viewpoint)" editor bars' Edit → Save flow: Edit first, then the
 *  button becomes Save-to-viewpoint and lights up while edits are unsaved. */
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
          <Button
            active={dirty}
            icon={<IconDeviceFloppy size={14} />}
            tooltip={
              dirty
                ? 'Unsaved edits — save the current labels/measurements/rules into this viewpoint'
                : 'Everything is saved into this viewpoint'
            }
            shortcut="viewpoints.saveLive"
            onClick={() => act.saveLiveToActive()}
          >
            Save to viewpoint
          </Button>
        )
      }
    />
  );
}
