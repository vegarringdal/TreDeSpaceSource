import { Ribbon } from '@treDeSpaceUI/widgets';
import { ColorClipSelectGroup } from './ColorClipSelectGroup';
import { ColorHiddenItemsGroup } from './ColorHiddenItemsGroup';
import { ColorMiscGroups } from './ColorMiscGroups';
import { ColorOpacityGroup } from './ColorOpacityGroup';
import { ColorQuickColoringGroup } from './ColorQuickColoringGroup';

/**
 * Coloring works on the current selection; undo here is the COLORING undo
 * stack only (per-domain — transforms will get their own; no global undo).
 * Quick colors apply together with the quick-opacity value (100 % = opaque).
 */
export function RibbonSelectionColor() {
  return (
    <Ribbon>
      <ColorHiddenItemsGroup />
      <ColorClipSelectGroup />
      <ColorQuickColoringGroup />
      <ColorOpacityGroup />
      <ColorMiscGroups />
    </Ribbon>
  );
}
