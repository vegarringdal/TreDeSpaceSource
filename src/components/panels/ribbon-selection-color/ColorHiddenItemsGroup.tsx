import { IconEye, IconEyeCheck, IconEyeOff } from '@tabler/icons-react';
import { RibbonButton, RibbonSection } from '@treDeSpaceUI/widgets';
import { selectionState } from '../../../state/viewer/selection.state';
import { viewerActions as act } from '../../../state/viewer/viewer.actions';
import { ribbonSelectionColorActions as colorAct } from './ribbonSelectionColor.actions';

/** Hide/unhide controls, including the clip-box and offset-based unhides. */
export function ColorHiddenItemsGroup() {
  const none = selectionState.use().count === 0;

  return (
    <RibbonSection title="Hidden items">
      <RibbonButton
        size="mini"
        icon={<IconEyeOff />}
        label="Hide"
        disabled={none}
        shortcut="selection.hide"
        onClick={() => void act.hideSelection()}
      />
      <RibbonButton
        size="mini"
        icon={<IconEye />}
        label="Unhide Sel"
        tooltip="Unhide the selected items"
        disabled={none}
        shortcut="selection.unhideSel"
        onClick={() => void act.unhideSelection()}
      />
      <RibbonButton
        size="mini"
        icon={<IconEyeCheck />}
        label="Unhide All"
        shortcut="selection.unhideAll"
        onClick={() => void act.unhideAll()}
      />
      <RibbonButton
        size="mini"
        icon={<IconEye />}
        label="Unhide Box"
        tooltip="Unhide everything that intersects the current clipping box (its position/size/rotation as-is)"
        shortcut="selection.unhideBox"
        onClick={() => void colorAct.unhideInClipBox()}
      />
      <RibbonButton
        size="mini"
        icon={<IconEye />}
        label="Unhide Sel+Off."
        tooltip="Unhide everything within the selection's bounds grown by the Clipping Box ribbon's Fit Sel offset — no clipping box needed"
        disabled={none}
        shortcut="selection.unhideAround"
        onClick={() => void colorAct.unhideAroundSelection()}
      />
      <RibbonButton
        size="mini"
        icon={<IconEye />}
        label="Unhide Each+Off."
        tooltip="Unhide everything within the Fit Sel offset of EACH selected item individually (max 200 selected) — for scattered selections where one big box would cover too much"
        disabled={none}
        shortcut="selection.unhideAroundEach"
        onClick={() => void colorAct.unhideAroundEachSelected()}
      />
    </RibbonSection>
  );
}
