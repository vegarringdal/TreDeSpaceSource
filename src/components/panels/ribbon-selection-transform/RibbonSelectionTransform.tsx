import { Ribbon, RibbonSlot } from '@treDeSpaceUI/widgets';
import { TransformGizmoGroups } from './TransformGizmoGroups';
import { TransformHistoryGroups } from './TransformHistoryGroups';
import { TransformMoveGroups } from './TransformMoveGroups';
import { TransformObjectGroups } from './TransformObjectGroups';
import { TransformStepGroups } from './TransformStepGroups';

/** Transform ribbon: New Object, gizmo/pivot placement, step nudging, scale,
 *  90° rotates, the objects list and the transform history — all acting on
 *  the current transform object (the object the selection is). */
export function RibbonSelectionTransform() {
  return (
    <Ribbon>
      <TransformObjectGroups />
      <TransformGizmoGroups />
      <TransformStepGroups />
      <TransformMoveGroups />
      <TransformHistoryGroups />
      <RibbonSlot size="big" className="min-w-52 px-2"></RibbonSlot>
    </Ribbon>
  );
}
