import { IconDeviceFloppy, IconFilePlus, IconFolderOpen, IconMovie, IconPresentation } from '@tabler/icons-react';
import { RibbonButton, RibbonSection } from '@treDeSpaceUI/widgets';
import { animationDocState } from '../../../state/animation/animationDoc.state';
import { animationFileActions } from '../../../state/animation/animationFile.actions';
import { animationUiActions } from '../../../state/animation/animationUi.actions';
import { animationUiState } from '../../../state/animation/animationUi.state';
import { presentActions } from '../../../state/animation/present.actions';

const SAVE_TOOLTIP = 'Download the animation (overlay styles included)';

/** Animation: Animate on / off (pressed again it closes the mode), Present
 *  (the 3D view with the play bar — its Close comes back), and the animation
 *  file — New, Open, Save. */
export function AnimModeGroups() {
  const mode = animationUiState.use().mode.kind;
  const docState = animationDocState.use();
  const authoring = mode === 'author';

  return (
    <RibbonSection title="Animation">
      <RibbonButton
        size="big"
        icon={<IconMovie />}
        label="Animate"
        selected={authoring}
        tooltip="Enter animation authoring; press again to leave — the scene is restored"
        shortcut="animation.toggleMode"
        onClick={() => void animationUiActions.toggleMode()}
      />
      <RibbonButton
        size="big"
        icon={<IconPresentation />}
        label="Present"
        tooltip="Present the animation: the 3D view alone with the play bar — Close on the play bar comes back to these panels"
        shortcut="animation.present"
        onClick={() => void presentActions.enter()}
      />
      <RibbonButton
        size="mini"
        icon={<IconFilePlus />}
        label="New"
        tooltip="Start a new, empty animation"
        shortcut="animation.file.new"
        onClick={() => void animationFileActions.newAnimation()}
      />
      <RibbonButton
        size="mini"
        icon={<IconFolderOpen />}
        label="Open"
        tooltip="Open an animation file (*.tdanim.json)"
        shortcut="animation.file.open"
        onClick={() => void animationFileActions.open()}
      />
      <RibbonButton
        size="mini"
        icon={<IconDeviceFloppy />}
        label={docState.dirty ? 'Save*' : 'Save'}
        tooltip={docState.dirty ? `${SAVE_TOOLTIP} — the * means it has unsaved changes` : SAVE_TOOLTIP}
        shortcut="animation.file.save"
        onClick={animationFileActions.save}
      />
    </RibbonSection>
  );
}
