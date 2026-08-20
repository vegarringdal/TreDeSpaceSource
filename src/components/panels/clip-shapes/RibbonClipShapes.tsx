import { IconBox, IconCircle, IconCylinder, IconEyeOff, IconList, IconVectorTriangle } from '@tabler/icons-react';
import { Ribbon, RibbonButton, RibbonSection } from '@treDeSpaceUI/widgets';
import { clipShapesState } from '../../../state/viewer/clipShapes.state';
import { ribbonClipShapesActions as act } from './ribbonClipShapes.actions';

/** Clip Shapes ribbon: add sphere/cylinder SDF clips, global mute + helper
 *  toggles, and open the list panel for numeric editing. */
export function RibbonClipShapes() {
  const s = clipShapesState.use();
  return (
    <Ribbon>
      <RibbonSection title="Add shape">
        <RibbonButton icon={<IconCircle />} label="Sphere" shortcut="clip.shape.addSphere" onClick={act.addSphere} />
        <RibbonButton
          icon={<IconCylinder />}
          label="Cylinder"
          shortcut="clip.shape.addCylinder"
          onClick={act.addCylinder}
        />
        <RibbonButton icon={<IconBox />} label="Box" shortcut="clip.shape.addBox" onClick={act.addBox} />
      </RibbonSection>

      <RibbonSection title="Global">
        <RibbonButton
          icon={<IconEyeOff />}
          label="Mute"
          selected={s.muted}
          shortcut="clip.shape.mute"
          onClick={act.toggleMuted}
        />
        <RibbonButton
          icon={<IconVectorTriangle />}
          label="Helpers"
          selected={s.helpers}
          shortcut="clip.shape.helpers"
          onClick={act.toggleHelpers}
        />
      </RibbonSection>

      <RibbonSection title="List">
        <RibbonButton icon={<IconList />} label="List" shortcut="clip.shape.list" onClick={act.list} />
      </RibbonSection>
    </Ribbon>
  );
}
