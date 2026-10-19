import { Vec3Input } from '@treDeSpaceUI/widgets';
import { eyeOf } from '../../../lib/animation/cameraEye';
import type { CameraKey } from '../../../lib/animation/types';
import { keysActions } from '../../../state/animation/keys.actions';

const LABEL_W = 56;
const STEP_M = 0.5;

/** A camera key as two points in the model: where it looks from and what it
 *  looks at — typed values move the key's view. */
export function CameraKeyPoints({ cameraKey, index }: { cameraKey: CameraKey; index: number }) {
  const eye = eyeOf(cameraKey.view);
  const target = cameraKey.view.target;

  return (
    <div className="flex flex-col gap-1">
      <Vec3Input
        label="Position"
        labelWidth={LABEL_W}
        step={STEP_M}
        precision={2}
        tooltips={['Where the eye is: X (m)', 'Where the eye is: Y (m)', 'Where the eye is: Z (m)']}
        value={eye}
        onChange={(p) => keysActions.setCameraPoints(index, p, target)}
      />
      <Vec3Input
        label="Target"
        labelWidth={LABEL_W}
        step={STEP_M}
        precision={2}
        tooltips={['What it looks at: X (m)', 'What it looks at: Y (m)', 'What it looks at: Z (m)']}
        value={target}
        onChange={(t) => keysActions.setCameraPoints(index, eye, t)}
      />
      <span className="text-[11px] text-slate-400">
        {Math.round(cameraKey.view.orbitDistance * 100) / 100} m apart
        {cameraKey.view.orthographic ? ' · orthographic' : ''}
      </span>
    </div>
  );
}
