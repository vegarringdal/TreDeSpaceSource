// Animated clipping (DESIGN.md › Animation, D33): the evaluated clip keys
// drive the same stores the clipping ribbons and viewpoints use. Entering
// animation mode puts the viewer's clipping aside (clean start); exit gives
// it back. A state is applied only when it changes, so ribbon edits made
// while paused stay until they are keyed or the playhead moves into a key.

import {
  type RibbonClippingBoxState,
  ribbonClippingBoxState,
} from '../../components/panels/ribbon-clipping-box/ribbonClippingBox.state';
import {
  type PlaneAxis,
  type RibbonClippingPlaneState,
  ribbonClippingPlaneState,
} from '../../components/panels/ribbon-clipping-plane/ribbonClippingPlane.state';
import type { ClipPlaneState, ClipStateValue } from '../../lib/animation/types';
import { clipShapesActions } from '../viewer/clipShapes.actions';
import { clipShapesState } from '../viewer/clipShapes.state';

// -----------------------------------------------------------------------------
// module state
// -----------------------------------------------------------------------------

const CLEAN = '∅';
const AXES: readonly PlaneAxis[] = ['x', 'y', 'z'];

let saved: { box: RibbonClippingBoxState; planes: RibbonClippingPlaneState; shapes: string } | null = null;
let lastSig = '';

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function setShapes(shapes: ClipStateValue['shapes']): void {
  const s = clipShapesState.get();
  clipShapesActions.importJson(
    JSON.stringify({
      shapes: shapes.map((x, i) => ({ ...x, id: i + 1, showHelper: true })),
      muted: s.muted,
      helpers: s.helpers,
    }),
  );
}

function applyClean(): void {
  ribbonClippingBoxState.set({ enabled: false });
  const planes = ribbonClippingPlaneState.get();
  ribbonClippingPlaneState.set({
    x: { ...planes.x, enabled: false },
    y: { ...planes.y, enabled: false },
    z: { ...planes.z, enabled: false },
  });
  setShapes([]);
}

function applyState(c: ClipStateValue, shapesChanged: boolean): void {
  ribbonClippingBoxState.set({
    enabled: c.box.enabled,
    boxOn: c.box.boxOn,
    center: [...c.box.center],
    size: [...c.box.size],
    rotation: [...c.box.rotation],
    inverted: c.box.inverted,
  });
  const planes = ribbonClippingPlaneState.get();
  ribbonClippingPlaneState.set({
    x: { ...planes.x, ...c.planes.x },
    y: { ...planes.y, ...c.planes.y },
    z: { ...planes.z, ...c.planes.z },
  });
  if (shapesChanged) {
    setShapes(c.shapes);
  }
}

// -----------------------------------------------------------------------------
// public api
// -----------------------------------------------------------------------------

/** Session enter: keep the viewer's clipping, start clean (D24, D33). A
 *  re-enter (the actors changed) leaves the clipping on screen as it is. */
export function clipEnter(): void {
  if (saved) {
    return;
  }
  saved = {
    box: structuredClone(ribbonClippingBoxState.get()),
    planes: structuredClone(ribbonClippingPlaneState.get()),
    shapes: clipShapesActions.exportJson(),
  };
  applyClean();
  lastSig = CLEAN;
}

/** Session exit: the viewer's own clipping back exactly. */
export function clipExit(): void {
  if (!saved) {
    return;
  }
  ribbonClippingBoxState.set(saved.box);
  ribbonClippingPlaneState.set(saved.planes);
  clipShapesActions.importJson(saved.shapes);
  saved = null;
  lastSig = '';
}

/** The evaluated clipping of this frame (null = no clip key reached). */
export function syncClip(c: ClipStateValue | null): void {
  if (!saved) {
    return;
  }
  const sig = c ? JSON.stringify(c) : CLEAN;
  if (sig === lastSig) {
    return;
  }
  const prevShapes = lastSig === CLEAN || lastSig === '' ? '[]' : JSON.stringify(JSON.parse(lastSig).shapes);
  lastSig = sig;
  if (c) {
    applyState(c, JSON.stringify(c.shapes) !== prevShapes);
  } else {
    applyClean();
  }
}

/** The clipping on screen now, as a clip key stores it (Clip key). */
export function captureClipState(): ClipStateValue {
  const b = ribbonClippingBoxState.get();
  const p = ribbonClippingPlaneState.get();
  const plane = (axis: PlaneAxis): ClipPlaneState => {
    const x = p[axis];
    return {
      enabled: x.enabled,
      position: x.position,
      el: x.el,
      az: x.az,
      flipped: x.flipped,
      anchor: x.anchor ? [x.anchor[0], x.anchor[1], x.anchor[2]] : null,
    };
  };
  return {
    box: {
      enabled: b.enabled,
      boxOn: b.boxOn,
      center: [...b.center],
      size: [...b.size],
      rotation: [...b.rotation],
      inverted: b.inverted,
    },
    planes: { x: plane(AXES[0]), y: plane(AXES[1]), z: plane(AXES[2]) },
    shapes: clipShapesState.get().shapes.map((s) => ({
      kind: s.kind,
      label: s.label,
      center: [...s.center],
      axis: [...s.axis],
      radius: s.radius,
      height: s.height,
      halfExtents: [...s.halfExtents],
      rotation: [...s.rotation],
      enabled: s.enabled,
      inverted: s.inverted,
    })),
  };
}
