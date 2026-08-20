import { Ribbon, RibbonSlot } from '@treDeSpaceUI/widgets';
import { TransformGizmoGroups } from './TransformGizmoGroups';
import { TransformHistoryGroups } from './TransformHistoryGroups';
import { TransformMoveGroups } from './TransformMoveGroups';
import { TransformStepGroups } from './TransformStepGroups';

/** Transform ribbon: gizmo/pivot placement, step nudging, scale, 90° rotates
 *  and the per-domain transform history, acting on the current selection. */
export function RibbonSelectionTransform() {
  return (
    <Ribbon>
      <TransformGizmoGroups />
      <TransformStepGroups />
      <TransformMoveGroups />
      <TransformHistoryGroups />
      <RibbonSlot size="big" className="min-w-52 px-2"></RibbonSlot>
    </Ribbon>
  );
}
