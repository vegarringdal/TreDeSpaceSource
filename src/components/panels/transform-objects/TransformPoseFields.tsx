import { RotationInput, Vec3Input } from '@treDeSpaceUI/widgets';
import { MIN_SCALE } from '../../../lib/transform/pose';
import type { TransformObject } from '../../../lib/transform/types';
import { transformActions as act } from '../../../state/transform/transform.actions';
import { FieldCaption } from './FieldCaption';

const MOVE_STEP_M = 0.05;
const MOVE_PRECISION = 3;
const SCALE_STEP = 0.05;
const SCALE_PRECISION = 3;
const ROTATE_STEP_DEG = 5;

/** How far the object stands from where the model has it: move (m), rotate
 *  (X/Y/Z degrees) and scale along its own axes. Typing here moves it. */
export function TransformPoseFields({ object }: { object: TransformObject }) {
  return (
    <>
      <FieldCaption>Move X / Y / Z (m)</FieldCaption>
      <Vec3Input
        step={MOVE_STEP_M}
        precision={MOVE_PRECISION}
        tooltips={[
          'Moved along X (m) from where the model has it',
          'Moved along Y (m) from where the model has it',
          'Moved along Z (m) from where the model has it',
        ]}
        value={object.move}
        onChange={(move) => act.setPose(object.id, { move }, 'move')}
      />
      <FieldCaption>Rotate X / Y / Z (°)</FieldCaption>
      <RotationInput
        step={ROTATE_STEP_DEG}
        value={object.rotate}
        onChange={(rotate) => act.setPose(object.id, { rotate }, 'rotate')}
      />
      <FieldCaption>Scale X / Y / Z (×, along its own axes)</FieldCaption>
      <Vec3Input
        step={SCALE_STEP}
        min={MIN_SCALE}
        precision={SCALE_PRECISION}
        tooltips={[
          "Scale along the object's own X axis",
          "Scale along the object's own Y axis",
          "Scale along the object's own Z axis",
        ]}
        value={object.scale}
        onChange={(scale) => act.setPose(object.id, { scale }, 'scale')}
      />
    </>
  );
}
