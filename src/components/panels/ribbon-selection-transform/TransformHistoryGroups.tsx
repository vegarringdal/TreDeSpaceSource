import { IconArrowBackUp, IconArrowForwardUp, IconList, IconRestore } from '@tabler/icons-react';
import { RibbonButton, RibbonSection } from '@treDeSpaceUI/widgets';
import { transformState } from '../../../state/transform/transform.state';
import { useTransformResting } from '../../../state/transform/useTransformResting';
import { RibbonPanelToggle } from '../shared/RibbonPanelToggle';
import { ribbonSelectionTransformActions as act } from './ribbonSelectionTransform.actions';

/** Reset buttons, the Objects group (the Transform Objects list toggle) and
 *  the transform undo / redo history (kept last, where it always was). */
export function TransformHistoryGroups() {
  const hasCurrent = transformState.useSelect((s) => s.currentId !== null);
  const undoDepth = transformState.useSelect((s) => s.undoDepth);
  const redoDepth = transformState.useSelect((s) => s.redoDepth);
  // while animating the objects rest: nothing here can change them
  const isResting = useTransformResting();

  return (
    <>
      <RibbonSection title="Reset">
        <RibbonButton
          size="medium"
          icon={<IconRestore />}
          label="Reset Obj"
          disabled={!hasCurrent || isResting}
          shortcut="transform.resetSel"
          onClick={act.resetSel}
        />
        <RibbonButton
          size="medium"
          icon={<IconRestore />}
          label="Reset All"
          disabled={isResting}
          shortcut="transform.resetAll"
          onClick={act.resetAll}
        />
      </RibbonSection>

      <RibbonSection title="Objects">
        <RibbonPanelToggle
          panel="transformObjects"
          icon={<IconList />}
          label="List"
          shortcut="transform.list"
          onClick={act.list}
        />
      </RibbonSection>

      <RibbonSection title="History">
        <RibbonButton
          size="medium"
          icon={<IconArrowBackUp />}
          label="Undo"
          disabled={undoDepth === 0 || isResting}
          shortcut="transform.undo"
          onClick={act.undo}
        />
        <RibbonButton
          size="medium"
          icon={<IconArrowForwardUp />}
          label="Redo"
          disabled={redoDepth === 0 || isResting}
          shortcut="transform.redo"
          onClick={act.redo}
        />
      </RibbonSection>
    </>
  );
}
