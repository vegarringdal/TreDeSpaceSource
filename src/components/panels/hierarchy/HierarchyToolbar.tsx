import {
  IconArrowsMaximize,
  IconCurrentLocation,
  IconFocus2,
  IconFocusCentered,
  IconFoldUp,
  IconListNumbers,
  IconPlaneTilt,
} from '@tabler/icons-react';
import { Button } from '@treDeSpaceUI/widgets';
import { selectionState } from '../../../state/viewer/selection.state';
import { viewerActions } from '../../../state/viewer/viewer.actions';
import { viewerState } from '../../../state/viewer/viewer.state';

/** The camera/tree action strip at the top of the hierarchy list. */
export function HierarchyToolbar({
  expandedCount,
  onCollapseAll,
}: {
  expandedCount: number;
  onCollapseAll: () => void;
}) {
  const sel = selectionState.use();
  const treeModelOrder = viewerState.useSelect((s) => s.treeModelOrder);

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
        icon={<IconCurrentLocation />}
        tooltip={'Go to last click\n(fly there and pivot, like Space+click)'}
        shortcut="camera.gotoClick"
        onClick={() => viewerActions.flyToLastClick()}
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
        icon={<IconArrowsMaximize />}
        tooltip={'Fit visible\n(frame everything not hidden, cut to the clipping in force)'}
        shortcut="camera.fitVisible"
        onClick={() => void viewerActions.fitVisible()}
      />
      <Button
        iconOnly
        icon={<IconFoldUp />}
        tooltip="Collapse the whole tree"
        shortcut="hierarchy.collapseAll"
        disabled={expandedCount === 0}
        onClick={onCollapseAll}
      />
      <Button
        iconOnly
        icon={<IconListNumbers />}
        active={treeModelOrder}
        tooltip={
          'Model order\n(on: what sits below the zones is listed in the order the model file has it; off: A–Z. Folders, sites and zones always stay A–Z)'
        }
        shortcut="hierarchy.modelOrder"
        onClick={() => viewerActions.update({ treeModelOrder: !treeModelOrder })}
      />
    </div>
  );
}
