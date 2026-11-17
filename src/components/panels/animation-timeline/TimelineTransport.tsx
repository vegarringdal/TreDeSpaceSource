import { IconArrowBarToLeft, IconArrowBarToRight, IconArrowsLeftRight, IconRepeat } from '@tabler/icons-react';
import { Button, TimeInput, TransportControls, type TransportStatus } from '@treDeSpaceUI/widgets';
import { formatTime } from '../../../lib/animation/timeFormat';
import type { Scene } from '../../../lib/animation/types';
import { playerActions } from '../../../state/animation/player.actions';
import { playerState } from '../../../state/animation/player.state';
import { posingActions } from '../../../state/animation/posing.actions';
import { scenesActions } from '../../../state/animation/scenes.actions';

/** Time box · ⏮ ◀ ⏯ ■ ▶ ⏭ · Loop · Ping-pong. */
export function TimelineTransport({ scene, duration }: { scene: Scene; duration: number }) {
  const p = playerState.use();
  const status: TransportStatus = p.status === 'off' ? 'stopped' : p.status;
  const hasSteps = scene.steps.length > 0;

  return (
    <div className="flex flex-wrap items-center gap-1">
      <TimeInput
        className="w-24"
        tooltip="The time slider, in seconds — type a time or step it with − / +; a pose not keyed yet moves along (on the Timeline ← / → step it too, Shift a whole second)"
        value={p.time}
        onChange={(t) => void posingActions.movePoseTo(t)}
      />
      <span className="text-[11px] text-slate-500 tabular-nums">/ {formatTime(duration)}</span>
      <Button
        iconOnly
        size="sm"
        icon={<IconArrowBarToLeft />}
        tooltip="Time slider to the start (Home)"
        shortcut="animation.gotoStart"
        onClick={() => playerActions.seek(0)}
      />
      <TransportControls
        status={status}
        onPlayPause={playerActions.togglePlay}
        onPrev={hasSteps ? playerActions.prevStep : undefined}
        onNext={hasSteps ? playerActions.nextStep : undefined}
        onStop={playerActions.stop}
        tooltips={{ prev: 'Previous step', next: 'Next step' }}
        shortcuts={{
          playPause: 'animation.playPause',
          prev: 'animation.prevStep',
          next: 'animation.nextStep',
          stop: 'animation.stop',
        }}
      />
      <Button
        iconOnly
        size="sm"
        icon={<IconArrowBarToRight />}
        tooltip="Time slider to the end (End)"
        shortcut="animation.gotoEnd"
        onClick={() => playerActions.seek(duration)}
      />
      <Button
        iconOnly
        size="sm"
        icon={<IconRepeat />}
        active={scene.loop}
        tooltip="Loop: start again at the end"
        shortcut="animation.toggleLoop"
        onClick={scenesActions.toggleLoop}
      />
      <Button
        iconOnly
        size="sm"
        icon={<IconArrowsLeftRight />}
        active={scene.pingPong}
        tooltip="Ping-pong: at the end, play back to the start"
        shortcut="animation.pingPong"
        onClick={scenesActions.togglePingPong}
      />
    </div>
  );
}
