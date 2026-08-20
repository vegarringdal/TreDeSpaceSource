import { IconFocus2, IconFocusCentered, IconFoldUp, IconPlaneTilt } from '@tabler/icons-react';
import { Button } from '@treDeSpaceUI/widgets';
import { selectionState } from '../../../state/viewer/selection.state';
import { viewerActions } from '../../../state/viewer/viewer.actions';

/** The camera/tree action strip at the top of the hierarchy list. */
export function HierarchyToolbar({
  expandedCount,
  onCollapseAll,
}: {
  expandedCount: number;
  onCollapseAll: () => void;
}) {
  const sel = selectionState.use();

  return (
    <div className="mb-1 flex shrink-0 items-center gap-1 border-slate-800 border-b pb-1">
      <Button
        iconOnly
        icon={<IconPlaneTilt />}
        tooltip={'Fly to selection\n(fit its bounding box)'}
        shortcut="camera.flyTo"
        disabled={sel.count === 0}
        onClick={() => void viewerActions.flyToSelection()}
      />
      <Button
        iconOnly
        icon={<IconFocus2 />}
        tooltip={'Focus last click\n(re-pivot like Alt+click, camera stays)'}
        shortcut="camera.focusClick"
        onClick={() => viewerActions.focusLastClick()}
      />
      <Button
        iconOnly
        icon={<IconFocusCentered />}
        tooltip={'Focus selection\n(pivot on its center, camera stays)'}
        shortcut="camera.focusSelection"
        disabled={sel.count === 0}
        onClick={() => void viewerActions.focusSelection()}
      />
      <Button
        iconOnly
        icon={<IconFoldUp />}
        tooltip="Collapse the whole tree"
        shortcut="hierarchy.collapseAll"
        disabled={expandedCount === 0}
        onClick={onCollapseAll}
      />
    </div>
  );
}
