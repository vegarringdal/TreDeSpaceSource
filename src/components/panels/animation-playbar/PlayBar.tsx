// The floating play bar (DESIGN.md › Animation › Player): transport over
// the 3D view while animation mode is on and the Timeline is not open (the
// scene to play, when there are several) —
// presenting, fullscreen, a layout without the Timeline. Touch-first: 40 px
// targets on mobile devices.
import { IconCameraRotate } from '@tabler/icons-react';
import { Button, TransportControls, type TransportStatus } from '@treDeSpaceUI/widgets';
import { useSyncExternalStore } from 'react';
import { stepNumber } from '../../../lib/animation/scene';
import { isMobileDevice } from '../../../lib/render/device';
import { animationDocState } from '../../../state/animation/animationDoc.state';
import { playerActions } from '../../../state/animation/player.actions';
import { playerState } from '../../../state/animation/player.state';
import { presentActions } from '../../../state/animation/present.actions';
import { currentView } from '../../../state/animation/runtime';
import { isAnimationPanelOpen, subscribeAnimationDock } from '../animation/animationPanels';
import { PlayBarScenes } from './PlayBarScenes';

/** The bar itself (renders nothing while the Timeline is open). */
export function PlayBar() {
  const p = playerState.use();
  animationDocState.useSelect((s) => s.revision);
  const timelineOpen = useSyncExternalStore(subscribeAnimationDock, () => isAnimationPanelOpen('animationTimeline'));
  if (p.status === 'off' || timelineOpen) {
    return null;
  }
  const v = currentView();
  const status: TransportStatus = p.status;
  const index = p.step && v ? stepNumber(v, p.step) : 0;
  const title = v?.steps.find((s) => s.id === p.step)?.name ?? '';
  const size = isMobileDevice() ? 'lg' : 'md';
  const len = Math.max(1e-3, v?.duration ?? 0);

  return (
    <div
      role="toolbar"
      aria-label="Animation play bar"
      className="pointer-events-auto flex max-w-[calc(100%-16px)] flex-wrap items-center gap-2 border border-slate-600/60 bg-slate-900/90 px-2 py-1.5 text-slate-200 text-xs shadow-black/50 shadow-lg backdrop-blur-sm"
    >
      <PlayBarScenes size={size} />
      {index > 0 && (
        <span className="max-w-48 truncate">
          {index}/{v?.steps.length} {title}
        </span>
      )}
      <TransportControls
        size={size}
        status={status}
        onPlayPause={playerActions.togglePlay}
        onPrev={(v?.steps.length ?? 0) > 0 ? playerActions.prevStep : undefined}
        onNext={(v?.steps.length ?? 0) > 0 ? playerActions.nextStep : undefined}
        tooltips={{ prev: 'Previous step', next: 'Next step' }}
        shortcuts={{ playPause: 'animation.playPause', prev: 'animation.prevStep', next: 'animation.nextStep' }}
      />
      <input
        type="range"
        className="w-32 accent-sky-400"
        min={0}
        max={len}
        step={0.01}
        value={Math.min(len, p.time)}
        aria-label="Time slider"
        data-tooltip="Scrub the animation"
        onChange={(e) => playerActions.seek(Number(e.target.value))}
      />
      {p.canFollow && (
        <Button
          tooltip={
            p.camera === 'follow'
              ? 'The view follows the camera keys — press to orbit freely (it stays so when you play again)'
              : 'You orbit freely — press to follow the camera keys again'
          }
          size={size}
          active={p.camera === 'follow'}
          icon={<IconCameraRotate />}
          shortcut="animation.toggleCameraFollow"
          onClick={playerActions.toggleCameraFollow}
        >
          Camera keys
        </Button>
      )}
      <Button
        tooltip={
          presentActions.isPresenting()
            ? 'Stop presenting — back to the panels, ribbon and mode from before'
            : 'Leave animation mode — the scene is restored'
        }
        size={size}
        variant="ghost"
        shortcut="animation.exitMode"
        onClick={() => void presentActions.close()}
      >
        Close
      </Button>
    </div>
  );
}
