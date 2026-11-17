import { playerState } from '../animation/player.state';

/** What the UI says wherever a transform object cannot be edited meanwhile. */
export const TRANSFORM_RESTING_HINT =
  'Animation is active: transform objects are shown where the model has them and cannot be moved or edited. Leave the animation to work with them again.';

/** True while animation mode is on: it starts clean and owns the transform
 *  slots, so the transform objects rest — every edit is refused — until the
 *  animation is left. Controls that edit them grey out on this. */
export function useTransformResting(): boolean {
  return playerState.useSelect((p) => p.status !== 'off');
}
