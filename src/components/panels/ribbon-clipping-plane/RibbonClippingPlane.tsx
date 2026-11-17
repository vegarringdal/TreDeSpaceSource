import { Ribbon } from '@treDeSpaceUI/widgets';
import { ClipPlanePositionGroups } from './ClipPlanePositionGroups';
import { ClipPlaneRotationGroups } from './ClipPlaneRotationGroups';
import { ClipPlaneToggleGroups } from './ClipPlaneToggleGroups';

/** Clipping-plane ribbon: per-axis enable/helper, position, flip and rotation
 *  controls for the three axis-aligned planes. */
export function RibbonClippingPlane() {
  return (
    <Ribbon>
      <ClipPlaneToggleGroups />
      <ClipPlanePositionGroups />
      <ClipPlaneRotationGroups />
    </Ribbon>
  );
}
