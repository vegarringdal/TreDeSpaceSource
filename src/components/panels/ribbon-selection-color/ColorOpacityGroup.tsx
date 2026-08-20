import { IconRestore } from '@tabler/icons-react';
import { RibbonButton, RibbonNumber, RibbonSection } from '@treDeSpaceUI/widgets';
import { selectionState } from '../../../state/viewer/selection.state';
import { viewerActions as act } from '../../../state/viewer/viewer.actions';
import { ribbonSelectionColorActions as colorAct } from './ribbonSelectionColor.actions';
import { ribbonSelectionColorState } from './ribbonSelectionColor.state';

/** Opacity override controls: the percentage value plus set/reset actions. */
export function ColorOpacityGroup() {
  const { opacity } = ribbonSelectionColorState.use();
  const setOpacity = colorAct.setOpacity;
  const none = selectionState.use().count === 0;

  return (
    <RibbonSection title="Opacity override">
      <RibbonNumber
        size="medium"
        unit="%"
        fieldWidth={84}
        min={0}
        max={100}
        step={5}
        value={opacity}
        decShortcut="opacity.value.dec"
        incShortcut="opacity.value.inc"
        onChange={setOpacity}
      />
      <RibbonButton
        size="medium"
        label="Set Sel"
        tooltip="Set the opacity override on the selection"
        disabled={none}
        onClick={() => void act.setOpacity(opacity)}
      />
      <RibbonButton
        size="medium"
        icon={<IconRestore />}
        label="Reset Sel"
        tooltip="Clear the opacity override on the selection"
        disabled={none}
        shortcut="opacity.resetSel"
        onClick={() => void act.resetOpacity()}
      />
      <RibbonButton
        size="medium"
        icon={<IconRestore />}
        label="Reset All"
        tooltip="Clear every opacity override"
        shortcut="opacity.resetAll"
        onClick={() => void act.resetAllOpacity()}
      />
    </RibbonSection>
  );
}
