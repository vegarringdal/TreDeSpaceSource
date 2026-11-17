import { Ribbon } from '@treDeSpaceUI/widgets';
import { ClipBoxFaceGroups } from './ClipBoxFaceGroups';
import { ClipBoxModeGroups } from './ClipBoxModeGroups';
import { ClipBoxSizeGroup } from './ClipBoxSizeGroup';

/** Clipping-box ribbon: enable/helper/gizmo modes, fit-based sizing and the
 *  per-face resize/move controls. */
export function RibbonClippingBox() {
  return (
    <Ribbon>
      <ClipBoxModeGroups />
      <ClipBoxSizeGroup />
      <ClipBoxFaceGroups />
    </Ribbon>
  );
}
