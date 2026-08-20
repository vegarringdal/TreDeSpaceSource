import { IconPencil, IconRestore } from '@tabler/icons-react';
import { PanelBody, useMinSize } from '@treDeSpaceUI/dockable';
import { Button, Collapsible, ColorSelect, InfoButton, NumberInput } from '@treDeSpaceUI/widgets';
import { selectionState } from '../../../state/viewer/selection.state';
import { viewerActions } from '../../../state/viewer/viewer.actions';
import { ribbonSelectionColorActions as colorAct } from '../ribbon-selection-color/ribbonSelectionColor.actions';
import { ribbonSelectionColorState } from '../ribbon-selection-color/ribbonSelectionColor.state';
import { DEFAULT_QUICK_COLORS, quickColorsActions, quickColorsState } from './quickColors.state';

/** The Color Panel: quick-color swatch editors, the manual color picker, and
 *  the color opacity — opened from the ribbon's Panel button. */
export function QuickColors() {
  useMinSize(220, 200);
  const { colors } = quickColorsState.use();
  const { quickOpacity, customColor } = ribbonSelectionColorState.use();
  const none = selectionState.use().count === 0;

  return (
    <PanelBody className="panel-body flex flex-col gap-1.5 p-2">
      <div className="flex shrink-0 items-center gap-1 border-slate-800 border-b pb-1 text-slate-400 text-xs">
        <span className="flex-1">Colors</span>
        <InfoButton label="About coloring">
          Quick and manual coloring of the current selection — every apply uses the opacity set below. Colors override
          an item's original look until you clear them, and are persisted locally per browser.
        </InfoButton>
      </div>

      <Collapsible
        title="Manual color"
        info="Pick any color and apply it to the current selection. It's applied at the opacity below and overrides the item's original color until cleared."
      >
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <ColorSelect value={customColor} onChange={colorAct.setCustomColor} />
          </div>
          <Button
            icon={<IconPencil size={14} />}
            disabled={none}
            tooltip="Apply the picked color to the selection"
            shortcut="color.applyCustom"
            onClick={() => void viewerActions.applyColor(customColor, quickOpacity)}
          >
            Apply
          </Button>
        </div>
      </Collapsible>

      <Collapsible
        title="Opacity"
        info="Opacity used by every color apply — manual picks and the quick swatches. 100% is fully opaque; lower values make coloured items translucent. Reset returns it to 100%."
      >
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <NumberInput
              value={quickOpacity}
              min={0}
              max={100}
              step={5}
              unit="%"
              onChange={colorAct.setQuickOpacity}
              decShortcut="color.quickOpacity.dec"
              incShortcut="color.quickOpacity.inc"
            />
          </div>
          <Button
            icon={<IconRestore size={14} />}
            disabled={quickOpacity === 100}
            tooltip="Reset the color opacity to fully opaque"
            shortcut="color.quickOpacity.reset"
            onClick={() => colorAct.setQuickOpacity(100)}
          >
            100 %
          </Button>
        </div>
      </Collapsible>

      <Collapsible
        title="Quick Coloring"
        info="An editable palette of quick colors used by the ribbon's colour buttons. Change any slot's colour here; Reset returns one slot — or all of them — to the defaults."
      >
        <div className="flex flex-col gap-1.5">
          {colors.map((c, i) => {
            const custom = c !== DEFAULT_QUICK_COLORS[i];
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed-size palette, position is identity
              <div key={i} className="flex items-center gap-2">
                <span className="w-4 shrink-0 text-right text-slate-400 text-xs">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <ColorSelect value={c} onChange={(x) => quickColorsActions.set(i, x)} />
                </div>
                <Button
                  disabled={!custom}
                  tooltip={custom ? `Back to ${DEFAULT_QUICK_COLORS[i]}` : 'Default color'}
                  onClick={() => quickColorsActions.resetOne(i)}
                >
                  Reset
                </Button>
              </div>
            );
          })}
          <Button className="mt-1 self-start" onClick={quickColorsActions.resetDefaults}>
            Reset all to default
          </Button>
        </div>
      </Collapsible>
    </PanelBody>
  );
}
