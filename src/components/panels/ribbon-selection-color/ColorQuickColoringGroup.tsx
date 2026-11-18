import { IconPalette, IconRestore } from '@tabler/icons-react';
import { RibbonButton, RibbonSection } from '@treDeSpaceUI/widgets';
import { selectionState } from '../../../state/viewer/selection.state';
import { viewerActions as act } from '../../../state/viewer/viewer.actions';
import { quickColorsState } from '../quick-colors/quickColors.state';
import { panelToggleHotkeyId, togglePanelById } from '../ribbon-panels/panelToggle';
import { ribbonSelectionColorState } from './ribbonSelectionColor.state';

const COLOR_PANEL_ID = 'quickColors';

/** The quick-color palette (applied with the quick-opacity value), color
 *  resets and the Color Panel toggle. */
export function ColorQuickColoringGroup() {
  const { colors } = quickColorsState.use();
  const { quickOpacity } = ribbonSelectionColorState.use();
  const none = selectionState.use().count === 0;

  return (
    <RibbonSection title="Quick Coloring">
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
        tooltip="Show / hide the Color Panel (swatches, manual color, opacity)"
        shortcut={panelToggleHotkeyId(COLOR_PANEL_ID)}
        onClick={() => togglePanelById(COLOR_PANEL_ID)}
      />
    </RibbonSection>
  );
}
