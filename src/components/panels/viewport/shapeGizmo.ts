// The armed clip shape mapped onto the oriented-box gizmo handles (native
// priority: the clip gizmo targets the armed shape; the default box is the
// fallback). Sphere = uniform ball, cylinder = XY radius / Z height around its
// mid-point, box = its own frame.

import { quatFromZTo, quatRotate } from '../../../lib/math/quat';
import type { GizmoTargets } from '../../../lib/overlay/ClipGizmo';
import { clipShapesActions } from '../../../state/viewer/clipShapes.actions';
import { clipShapesState, gizmoCenter } from '../../../state/viewer/clipShapes.state';

/** Box-gizmo target for the armed clip shape, or null when none is armed. */
export function shapeGizmoTarget(): GizmoTargets['box'] {
  const shp = clipShapesState.get();
  const shape = shp.shapes.find((x) => x.id === shp.gizmoId);
  if (!shape?.enabled || shp.muted) {
    return null;
  }
  const id = shape.id;
  if (shape.kind === 'box') {
    return {
      mode: shp.gizmoMode,
      center: [...shape.center],
      size: [shape.halfExtents[0] * 2, shape.halfExtents[1] * 2, shape.halfExtents[2] * 2],
      rotation: [...shape.rotation],
      onChange: (c, sz) =>
        clipShapesActions.update(id, {
          center: c,
          halfExtents: [Math.max(sz[0] / 2, 0.01), Math.max(sz[1] / 2, 0.01), Math.max(sz[2] / 2, 0.01)],
        }),
      onRotate: (q) => clipShapesActions.update(id, { rotation: q }),
    };
  }
  if (shape.kind === 'sphere') {
    const d = shape.radius * 2;
    return {
      mode: shp.gizmoMode === 'rotate' ? 'move' : shp.gizmoMode, // spheres can't rotate
      center: [...shape.center],
      size: [d, d, d],
      rotation: [0, 0, 0, 1],
      onChange: (c, sz) =>
        clipShapesActions.update(id, { center: c, radius: Math.max(Math.max(sz[0], sz[1], sz[2]) / 2, 0.01) }),
      onRotate: () => {},
    };
  }
  // cylinder: gizmo at the MID-point; local Z = the axis
  const mid = gizmoCenter(shape);
  const a = shape.axis;
  const al = Math.hypot(a[0], a[1], a[2]) || 1;
  const axis: [number, number, number] = [a[0] / al, a[1] / al, a[2] / al];
  return {
    mode: shp.gizmoMode,
    center: mid,
    size: [shape.radius * 2, shape.radius * 2, shape.height],
    rotation: quatFromZTo(axis),
    onChange: (c, sz) => {
      const radius = Math.max(Math.max(sz[0], sz[1]) / 2, 0.01);
      const height = Math.max(sz[2], 0.01);
      clipShapesActions.update(id, {
        radius,
        height,
        center: [c[0] - axis[0] * (height / 2), c[1] - axis[1] * (height / 2), c[2] - axis[2] * (height / 2)],
      });
    },
    onRotate: (q) => {
      // rotate around the mid-point so the cylinder pivots in place
      const na = quatRotate(q, [0, 0, 1]);
      const h = shape.height / 2;
      clipShapesActions.update(id, {
        axis: na,
        center: [mid[0] - na[0] * h, mid[1] - na[1] * h, mid[2] - na[2] * h],
      });
    },
  };
}
