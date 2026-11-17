// The clip volumes as the renderer honours them right now, read from the
// clipping ribbons and the clip-shapes store — one definition of "what
// clipping keeps" for shape-select and the clip-aware fit.
import {
  type RibbonClippingBoxState,
  ribbonClippingBoxState,
} from '../../components/panels/ribbon-clipping-box/ribbonClippingBox.state';
import {
  type RibbonClippingPlaneState,
  ribbonClippingPlaneState,
} from '../../components/panels/ribbon-clipping-plane/ribbonClippingPlane.state';
import type { Aabb } from '../../lib/math/aabb';
import { type FitBoundsMode, fitBoundsWithClipping } from '../../lib/math/clipFit';
import { type HalfSpace, planeWorld } from '../../lib/math/clipPlane';
import type { V3 } from '../../lib/math/quat';
import type { SelectShape } from '../../lib/math/shapeBounds';
import { type ClipShapesState, clipShapesState, MAX_CLIP_SHAPES } from './clipShapes.state';

const PLANE_AXES = ['x', 'y', 'z'] as const;

/** The clip volumes an item can be selected in right now: the default box
 *  and the extra shapes that are enabled (global clipping on, shapes not
 *  muted). An INVERTED shape is a hole — it cuts what is inside it — so it is
 *  not a volume to select in and is skipped. Empty means clipping is off. */
export function activeSelectShapes(box: RibbonClippingBoxState, shp: ClipShapesState): SelectShape[] {
  const out: SelectShape[] = [];
  if (!box.enabled) {
    return out;
  }
  if (box.boxOn && !box.inverted) {
    out.push({
      kind: 'box',
      center: box.center,
      half: [box.size[0] / 2, box.size[1] / 2, box.size[2] / 2],
      rotation: box.rotation,
    });
  }
  if (shp.muted) {
    return out;
  }
  for (const s of shp.shapes.slice(0, MAX_CLIP_SHAPES)) {
    if (!s.enabled || s.inverted) {
      continue;
    }
    if (s.kind === 'sphere') {
      out.push({ kind: 'sphere', center: s.center, radius: s.radius });
    } else if (s.kind === 'box') {
      out.push({ kind: 'box', center: s.center, half: s.halfExtents, rotation: s.rotation });
    } else {
      const l = Math.hypot(s.axis[0], s.axis[1], s.axis[2]) || 1;
      out.push({
        kind: 'cylinder',
        base: s.center,
        axis: [s.axis[0] / l, s.axis[1] / l, s.axis[2] / l],
        radius: s.radius,
        height: s.height,
      });
    }
  }
  return out;
}

/** The enabled clipping planes as world half-spaces (flip honoured). The
 *  planes carry their own on/off — the box ribbon's global switch does not
 *  gate them, matching the clip uniform packer. */
export function activeClipPlanes(planes: RibbonClippingPlaneState, sceneCenter: V3): HalfSpace[] {
  const out: HalfSpace[] = [];
  for (const axis of PLANE_AXES) {
    const pl = planes[axis];
    if (!pl.enabled) {
      continue;
    }
    const { n, d } = planeWorld(pl, sceneCenter);
    out.push({ n, d });
  }
  return out;
}

/** The fit-visible frame under the clipping in force (see fitBoundsWithClipping). */
export function clipAwareFitBounds(visible: Aabb, mode: FitBoundsMode, sceneCenter: V3): Aabb {
  const shapes = activeSelectShapes(ribbonClippingBoxState.get(), clipShapesState.get());
  const planes = activeClipPlanes(ribbonClippingPlaneState.get(), sceneCenter);
  return fitBoundsWithClipping(visible, mode, shapes, planes);
}
