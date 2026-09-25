import { IconArrowDown, IconArrowUp, IconRowInsertTop } from '@tabler/icons-react';
import { Button } from '@treDeSpaceUI/widgets';
import { viewpointsActions as act } from '../../../state/viewer/viewpoints.actions';

/** A viewpoint section's header buttons: insert-before and reorder — in the
 *  header so the list can be arranged without opening each viewpoint. */
export function ViewpointHeaderActions({ vpId, idx, total }: { vpId: string; idx: number; total: number }) {
  return (
    <>
      <Button
        iconOnly
        size="sm"
        icon={<IconRowInsertTop size={13} />}
        tooltip="Insert a NEW empty viewpoint (current camera + clipping) before this one"
        onClick={() => act.addViewpointBefore(vpId)}
      />
      <Button
        iconOnly
        size="sm"
        icon={<IconArrowUp size={13} />}
        disabled={idx === 0}
        tooltip="Move this viewpoint up in the list"
        onClick={() => act.move(vpId, -1)}
      />
      <Button
        iconOnly
        size="sm"
        icon={<IconArrowDown size={13} />}
        disabled={idx === total - 1}
        tooltip="Move this viewpoint down in the list"
        onClick={() => act.move(vpId, 1)}
      />
    </>
  );
}
