import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconArrowsShuffle,
  IconDeselect,
  IconEraser,
  IconFocus2,
} from '@tabler/icons-react';
import { RibbonButton, RibbonSection } from '@treDeSpaceUI/widgets';
import { selectionState } from '../../../state/viewer/selection.state';
import { viewerActions as act } from '../../../state/viewer/viewer.actions';

/** Selection utilities, the clear-all-overrides button and the per-domain
 *  coloring undo/redo history. */
export function ColorMiscGroups() {
  const sel = selectionState.use();
  const none = sel.count === 0;

  return (
    <>
      <RibbonSection title="Misc">
        <RibbonButton
          size="mini"
          icon={<IconArrowsShuffle />}
          label="Invert sel"
          tooltip="Select everything that is not selected"
          shortcut="selection.invert"
          onClick={() => void act.invertSelection()}
        />
        <RibbonButton
          size="mini"
          icon={<IconFocus2 />}
          label="Isolate"
          disabled={none}
          shortcut="selection.isolate"
          onClick={() => void act.isolateSelection()}
        />
        <RibbonButton
          size="mini"
          icon={<IconDeselect />}
          label="Clear sel"
          disabled={none}
          shortcut="selection.clear"
          onClick={() => void act.clearSelection()}
        />
      </RibbonSection>

      <RibbonSection title="Overrides">
        <RibbonButton
          size="big"
          icon={<IconEraser />}
          label="Clear all"
          tooltip="Unhide all + reset every color and opacity override (whole model)"
          shortcut="selection.clearOverrides"
          onClick={() => void act.clearAllOverrides()}
        />
      </RibbonSection>

      <RibbonSection title="History">
        <RibbonButton
          size="medium"
          icon={<IconArrowBackUp />}
          label="Undo"
          disabled={sel.colorUndoDepth === 0}
          shortcut="color.undo"
          onClick={() => void act.undoColor()}
        />
        <RibbonButton
          size="medium"
          icon={<IconArrowForwardUp />}
          label="Redo"
          disabled={sel.colorRedoDepth === 0}
          shortcut="color.redo"
          onClick={() => void act.redoColor()}
        />
      </RibbonSection>
    </>
  );
}
