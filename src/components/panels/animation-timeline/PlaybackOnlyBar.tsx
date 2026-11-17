import { IconMovie } from '@tabler/icons-react';
import { Button, InfoBox } from '@treDeSpaceUI/widgets';
import { animationUiActions } from '../../../state/animation/animationUi.actions';

/** Playing back only (a host, Present): the Timeline shows the animation
 *  but edits nothing until Animate. */
export function PlaybackOnlyBar() {
  return (
    <InfoBox tone="info" className="m-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span>Playing back only — turn on Animate to make objects and keys.</span>
        <Button
          size="sm"
          icon={<IconMovie />}
          tooltip="Enter animation authoring"
          shortcut="animation.toggleMode"
          onClick={() => void animationUiActions.enterAuthoring()}
        >
          Animate
        </Button>
      </div>
    </InfoBox>
  );
}
