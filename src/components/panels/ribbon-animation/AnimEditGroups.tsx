import { IconArrowBackUp, IconArrowForwardUp } from '@tabler/icons-react';
import { RibbonButton, RibbonSection } from '@treDeSpaceUI/widgets';
import { animationDocActions } from '../../../state/animation/animationDoc.actions';
import { animationDocState } from '../../../state/animation/animationDoc.state';

/** Edit: the animation's undo / redo. */
export function AnimEditGroups() {
  const doc = animationDocState.use();

  return (
    <RibbonSection title="Edit">
      <RibbonButton
        size="mini"
        icon={<IconArrowBackUp />}
        label="Undo"
        disabled={doc.undoDepth === 0}
        tooltip="Undo the last animation edit"
        shortcut="animation.undo"
        onClick={animationDocActions.undo}
      />
      <RibbonButton
        size="mini"
        icon={<IconArrowForwardUp />}
        label="Redo"
        disabled={doc.redoDepth === 0}
        tooltip="Redo the last undone animation edit"
        shortcut="animation.redo"
        onClick={animationDocActions.redo}
      />
    </RibbonSection>
  );
}
