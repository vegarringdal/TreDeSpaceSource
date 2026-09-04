import type { SelectShape } from '../../../lib/math/shapeBounds';
import { type ClipShapesState, MAX_CLIP_SHAPES } from '../../../state/viewer/clipShapes.state';
import type { RibbonClippingBoxState } from '../ribbon-clipping-box/ribbonClippingBox.state';

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
