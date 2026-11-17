import { IconCamera, IconCameraRotate, IconEye, IconRotate360 } from '@tabler/icons-react';
import { Button } from '@treDeSpaceUI/widgets';
import type { Scene } from '../../../lib/animation/types';
import { keysActions } from '../../../state/animation/keys.actions';
import { playerActions } from '../../../state/animation/player.actions';
import { playerState } from '../../../state/animation/player.state';
import { runtimeRenderer } from '../../../state/animation/runtime';
import { flyCameraTo } from '../../../state/animation/runtimeCamera';
import { CameraKeyPoints } from './CameraKeyPoints';
import { InspectorFrame } from './InspectorFrame';
import { type ArriveOption, KeySceneRowKey } from './KeySceneRowKey';

const ARRIVE: readonly ArriveOption[] = [
  {
    value: 'smooth',
    label: 'Glide',
    tooltip: 'The view glides here, easing in and out',
    shortcut: 'animation.cameraKey.glide',
  },
  {
    value: 'linear',
    label: 'Even',
    tooltip: 'The view moves here at an even speed',
    shortcut: 'animation.cameraKey.even',
  },
  { value: 'hold', label: 'Cut', tooltip: 'The view jumps here at the key', shortcut: 'animation.cameraKey.cut' },
];

/** The Camera row, or one of its keys: take the view, go there, glide or
 *  cut; the orbit helper. */
export function KeyCamera({ scene, index, indices }: { scene: Scene; index: number | null; indices: number[] }) {
  const p = playerState.use();
  const key = index !== null ? scene.camera[index] : undefined;

  const handleGoThere = () => {
    const r = runtimeRenderer();
    if (key && r) {
      playerActions.seek(key.t);
      flyCameraTo(r, key.view);
    }
  };

  const keyButton = (
    <Button
      size="sm"
      icon={<IconCamera />}
      tooltip="The view now as a camera key at the time slider (I)"
      shortcut="animation.cameraKey"
      onClick={() => keysActions.keyCamera()}
    >
      Key view
    </Button>
  );
  const n = scene.camera.length;

  return (
    <InspectorFrame
      kind={key ? 'Camera key' : 'Camera'}
      name={key ? `${key.t.toFixed(2)} s` : `${n} key${n === 1 ? '' : 's'}`}
      actions={keyButton}
    >
      {key && index !== null && (
        <>
          <KeySceneRowKey row="@camera" index={index} indices={indices} t={key.t} interp={key.interp} arrive={ARRIVE} />
          <CameraKeyPoints cameraKey={key} index={index} />
          <div className="flex flex-wrap gap-1">
            <Button
              size="sm"
              icon={<IconCamera />}
              tooltip="This key takes the view now"
              shortcut="animation.cameraKey.take"
              onClick={() => keysActions.setCameraView(index)}
            >
              Take this view
            </Button>
            <Button
              size="sm"
              icon={<IconEye />}
              tooltip="Look through this key (the time slider goes there)"
              shortcut="animation.cameraKey.goto"
              onClick={handleGoThere}
            >
              Go there
            </Button>
          </div>
        </>
      )}
      <span className="text-[11px] text-slate-400">
        {n === 0
          ? 'No camera keys: the view is yours while it plays. Set up the view and Key view to fix it here.'
          : n === 1
            ? 'One key: the view is set there while it plays. Key another view elsewhere to make it move.'
            : 'The view glides between the keys. Moving the view yourself frees it until you Key, press Play or R — Camera keys switched off keep it free until switched on.'}
      </span>
      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          icon={<IconRotate360 />}
          tooltip="One turn around what the view looks at, from the time slider (8 s)"
          shortcut="animation.preset.orbit"
          onClick={keysActions.cameraOrbit}
        >
          Orbit
        </Button>
        {p.camera === 'free' && n > 0 && (
          <Button
            size="sm"
            icon={<IconCameraRotate />}
            tooltip="Back to the animation's view"
            shortcut="animation.returnCamera"
            onClick={playerActions.returnCamera}
          >
            Return to the camera keys
          </Button>
        )}
      </div>
    </InspectorFrame>
  );
}
