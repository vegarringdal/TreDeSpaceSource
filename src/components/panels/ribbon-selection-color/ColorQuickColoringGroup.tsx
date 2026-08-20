import { IconPalette, IconRestore } from '@tabler/icons-react';
import { usePanelContext } from '@treDeSpaceUI/dockable';
import { RibbonButton, RibbonSection } from '@treDeSpaceUI/widgets';
import { selectionState } from '../../../state/viewer/selection.state';
import { viewerActions as act } from '../../../state/viewer/viewer.actions';
import { quickColorsState } from '../quick-colors/quickColors.state';
import { ribbonSelectionColorState } from './ribbonSelectionColor.state';

/** The quick-color palette (applied with the quick-opacity value), color
 *  resets and the Color Panel opener. */
export function ColorQuickColoringGroup() {
  const { colors } = quickColorsState.use();
  const { manager } = usePanelContext();
  const { quickOpacity } = ribbonSelectionColorState.use();
  const none = selectionState.use().count === 0;

  return (
    <RibbonSection title="Quick coloring">
      {colors.map((c, i) => (
        <RibbonButton
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed palette slots
          key={i}
          size="mini"
          background={c}
          disabled={none}
          shortcut={`color.quick.${i + 1}`}
          onClick={() => void act.applyColor(c, quickOpacity)}
        />
      ))}
      <RibbonButton
        size="mini"
        icon={<IconRestore />}
        label="Reset Sel"
        tooltip="Clear the color override on the selection"
        disabled={none}
        shortcut="color.clearSel"
        onClick={() => void act.clearColor()}
      />
      <RibbonButton
        size="mini"
        icon={<IconRestore />}
        label="Reset All"
        tooltip="Clear every color override"
        shortcut="color.resetAll"
        onClick={() => void act.resetAllColors()}
      />
      <RibbonButton
        size="mini"
        icon={<IconPalette />}
        label="Panel"
        tooltip="Open the Color Panel (swatches, manual color, opacity)"
        onClick={() => manager.openPanel('quickColors', 'left')}
      />
    </RibbonSection>
  );
}
