import { IconArrowBackUp, IconArrowForwardUp, IconRestore } from '@tabler/icons-react';
import { RibbonButton, RibbonSection } from '@treDeSpaceUI/widgets';
import { selectionState } from '../../../state/viewer/selection.state';
import { ribbonSelectionTransformActions as act } from './ribbonSelectionTransform.actions';

/** Transform reset buttons and the per-domain transform undo/redo history. */
export function TransformHistoryGroups() {
  const sel = selectionState.use();
  const none = sel.count === 0;

  return (
    <>
      <RibbonSection title="Reset">
        <RibbonButton
          size="medium"
          icon={<IconRestore />}
          label="Reset Sel"
          disabled={none}
          shortcut="transform.resetSel"
          onClick={act.resetSel}
        />
        <RibbonButton
          size="medium"
          icon={<IconRestore />}
          label="Reset All"
          shortcut="transform.resetAll"
          onClick={act.resetAll}
        />
      </RibbonSection>

      <RibbonSection title="History">
        <RibbonButton
          size="medium"
          icon={<IconArrowBackUp />}
          label="Undo"
          disabled={sel.transformUndoDepth === 0}
          shortcut="transform.undo"
          onClick={act.undo}
        />
        <RibbonButton
          size="medium"
          icon={<IconArrowForwardUp />}
          label="Redo"
          disabled={sel.transformRedoDepth === 0}
          shortcut="transform.redo"
          onClick={act.redo}
        />
      </RibbonSection>
    </>
  );
}
