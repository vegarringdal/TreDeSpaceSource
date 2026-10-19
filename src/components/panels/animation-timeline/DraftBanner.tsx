import { IconRestore, IconTrash } from '@tabler/icons-react';
import { Button, InfoBox } from '@treDeSpaceUI/widgets';
import { animationDocActions } from '../../../state/animation/animationDoc.actions';
import { animationDocState } from '../../../state/animation/animationDoc.state';
import { animationFileActions } from '../../../state/animation/animationFile.actions';

/** The animation autosaved in an earlier session that ended unsaved —
 *  offered until it is recovered or thrown away (it is kept as it is till
 *  then). */
export function DraftBanner() {
  const draft = animationDocState.useSelect((s) => s.draftAvailable);
  if (!draft) {
    return null;
  }

  return (
    <InfoBox tone="info" className="m-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span>Recover the unsaved animation from your last session?</span>
        <Button
          size="sm"
          icon={<IconRestore />}
          tooltip="Open the animation autosaved in your last session (it replaces the one open now)"
          shortcut="animation.draft.recover"
          onClick={() => void animationFileActions.recoverDraft()}
        >
          Recover
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<IconTrash />}
          tooltip="Throw the autosaved animation away"
          shortcut="animation.draft.discard"
          onClick={() => void animationDocActions.discardDraft()}
        >
          Discard
        </Button>
      </div>
    </InfoBox>
  );
}
