// The frame "fit visible" flies to while clipping is on: the visible-items
// box cut down to what the clip volumes keep. Pure — the stores are read by
// state/viewer/clipVolumes.ts.
import { type Aabb, clipAabbByHalfSpace, intersectAabb, unionAabb } from './aabb';
import type { HalfSpace } from './clipPlane';
import { type SelectShape, shapeWorldBounds } from './shapeBounds';

/** What the fit frames while clip volumes are on: `visible` = the visible box
 *  cut down to the volumes' envelope; `bbox` = the volumes' envelope itself. */
export type FitBoundsMode = 'visible' | 'bbox';

/** With keep-volumes on, the frame is their union envelope — intersected with
 *  the visible box in `visible` mode (a volume that misses the model is framed
 *  on its own, so the camera still goes where the clipping is). Every plane
 *  then trims the box exactly; a plane that clears it is skipped rather than
 *  collapsing the frame. No volumes → the visible box in both modes. */
export function fitBoundsWithClipping(
  visible: Aabb,
  mode: FitBoundsMode,
  shapes: readonly SelectShape[],
  planes: readonly HalfSpace[],
): Aabb {
  let box = visible;
  if (shapes.length > 0) {
    const volume = shapes.map(shapeWorldBounds).reduce(unionAabb);
    box = mode === 'bbox' ? volume : (intersectAabb(visible, volume) ?? volume);
  }
  for (const pl of planes) {
    box = clipAabbByHalfSpace(box, pl.n, pl.d) ?? box;
  }
  return box;
}
