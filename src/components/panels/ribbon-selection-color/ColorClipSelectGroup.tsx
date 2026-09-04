import { IconLayersIntersect, IconSquareDot } from '@tabler/icons-react';
import { RibbonButton, RibbonSection } from '@treDeSpaceUI/widgets';
import { clipShapesState } from '../../../state/viewer/clipShapes.state';
import { ribbonClippingBoxState } from '../ribbon-clipping-box/ribbonClippingBox.state';
import { activeSelectShapes } from './clipSelectShapes';
import { ribbonSelectionColorActions as colorAct } from './ribbonSelectionColor.actions';

/** Select by the clip volumes: everything inside, or everything touching, the
 *  clipping box and the enabled extra shapes. Disabled while clipping is off
 *  or only inverted (hole) shapes are active. */
export function ColorClipSelectGroup() {
  const box = ribbonClippingBoxState.use();
  const shapes = clipShapesState.use();
  const off = activeSelectShapes(box, shapes).length === 0;

  return (
    <RibbonSection title="Clipping Shape Select">
      <RibbonButton
        size="medium"
        icon={<IconSquareDot />}
        label="Select Inside"
        tooltip="Select every item whose bounds lie fully inside the clipping box or an enabled clip shape (inverted shapes are holes and are skipped)"
        disabled={off}
        shortcut="selection.clipInside"
        onClick={() => void colorAct.selectInClipShapes('inside')}
      />
      <RibbonButton
        size="medium"
        icon={<IconLayersIntersect />}
        label="Select Intersecting"
        tooltip="Select every item whose bounds touch the clipping box or an enabled clip shape (inverted shapes are holes and are skipped)"
        disabled={off}
        shortcut="selection.clipIntersect"
        onClick={() => void colorAct.selectInClipShapes('intersect')}
      />
    </RibbonSection>
  );
}
