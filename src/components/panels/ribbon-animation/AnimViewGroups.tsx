import { IconCameraRotate, IconMessage2, IconRoute } from '@tabler/icons-react';
import { RibbonButton, RibbonSection } from '@treDeSpaceUI/widgets';
import { animationUiActions } from '../../../state/animation/animationUi.actions';
import { animationUiState } from '../../../state/animation/animationUi.state';
import { playerActions } from '../../../state/animation/player.actions';
import { playerState } from '../../../state/animation/player.state';

/** View toggles: motion paths, overlays, and the view following the camera
 *  keys or orbiting freely. */
export function AnimViewGroups() {
  const ui = animationUiState.use();
  const showOverlays = playerState.useSelect((s) => s.showOverlays);
  const camera = playerState.useSelect((s) => (s.canFollow ? s.camera : null));

  return (
    <RibbonSection title="View">
      <RibbonButton
        size="mini"
        icon={<IconRoute />}
        label="Motion paths"
        selected={ui.showPaths}
        tooltip="Show the paths of the moving objects in the 3D view"
        shortcut="animation.togglePaths"
        onClick={animationUiActions.togglePaths}
      />
      <RibbonButton
        size="mini"
        icon={<IconMessage2 />}
        label="Overlays"
        selected={showOverlays}
        tooltip="Show the 2D overlays (step cards, callouts)"
        shortcut="animation.toggleOverlays"
        onClick={playerActions.toggleOverlays}
      />
      <RibbonButton
        size="mini"
        icon={<IconCameraRotate />}
        label="Camera keys"
        selected={camera === 'follow'}
        disabled={camera === null}
        tooltip={
          camera === null
            ? 'The scene has no camera keys — the view is yours'
            : 'On: the view follows the camera keys. Off: orbit freely, also when you play again (R or this brings the camera keys back)'
        }
        shortcut="animation.toggleCameraFollow"
        onClick={playerActions.toggleCameraFollow}
      />
    </RibbonSection>
  );
}
