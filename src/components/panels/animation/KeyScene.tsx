import { IconPin, IconPinnedOff } from '@tabler/icons-react';
import { Button, Checkbox, TextInput } from '@treDeSpaceUI/widgets';
import { contentEnd } from '../../../lib/animation/scene';
import { formatTime } from '../../../lib/animation/timeFormat';
import type { Scene } from '../../../lib/animation/types';
import { scenesActions } from '../../../state/animation/scenes.actions';
import { InspectorFrame } from './InspectorFrame';
import { SceneStepCardField } from './SceneStepCardField';

const LABEL_W = 72;

/** Nothing picked: the scene — name, end, Loop / Ping-pong, the step card,
 *  labels kept on screen — and how to start. */
export function KeyScene({ scene }: { scene: Scene }) {
  const pinned = scene.end !== undefined;

  return (
    <InspectorFrame kind="Scene" name={scene.name}>
      <TextInput
        tooltip="The scene's name (the Timeline's Scene ▾)"
        label="Name"
        labelPosition="left"
        labelWidth={LABEL_W}
        value={scene.name}
        onChange={scenesActions.rename}
      />
      <div className="flex items-center gap-1 text-xs">
        <span className="min-w-0 flex-1 text-slate-400">
          Ends at {formatTime(pinned ? (scene.end ?? 0) : contentEnd(scene))}
          {pinned ? ' (pinned)' : ' (its last key, step or overlay)'}
        </span>
        {pinned ? (
          <Button
            size="xs"
            icon={<IconPinnedOff />}
            tooltip="The end follows the content again"
            shortcut="animation.end.unpin"
            onClick={() => scenesActions.setEnd(null)}
          >
            Unpin
          </Button>
        ) : (
          <Button
            size="xs"
            icon={<IconPin />}
            tooltip="Pin the end at the time slider"
            shortcut="animation.end.pin"
            onClick={scenesActions.pinEndHere}
          >
            Pin here
          </Button>
        )}
      </div>
      <div className="flex gap-3">
        <Checkbox
          tooltip="Start again at the end"
          shortcut="animation.toggleLoop"
          label="Loop"
          checked={scene.loop}
          onChange={scenesActions.toggleLoop}
        />
        <Checkbox
          tooltip="At the end, play back to the start"
          shortcut="animation.pingPong"
          label="Ping-pong"
          checked={scene.pingPong}
          onChange={scenesActions.togglePingPong}
        />
      </div>
      <SceneStepCardField scene={scene} />
      <Checkbox
        tooltip="Labels hanging from objects flip and clamp to stay inside the view"
        shortcut="animation.overlaysOnScreen"
        label="Keep labels on screen"
        checked={scene.keepOverlaysOnScreen !== false}
        onChange={scenesActions.toggleOverlaysOnScreen}
      />
      <span className="text-[11px] text-slate-500">
        {scene.objects.length === 0
          ? 'Select items and press + Object (or Key) in the Timeline to make the first object.'
          : 'Pick a row or a key in the Timeline to edit it here.'}
      </span>
    </InspectorFrame>
  );
}
