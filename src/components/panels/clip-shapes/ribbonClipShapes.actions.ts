import type { V3 } from '../../../lib/math/quat';
import { clipShapesActions } from '../../../state/viewer/clipShapes.actions';
import { type ClipShapeKind, clipShapesState } from '../../../state/viewer/clipShapes.state';
import { db } from '../../../state/viewer/db';
import { consoleActions } from '../console/console.actions';
import { openClipShapesPanel } from './clipShapesPanel';

// Scene centre + a scene-scaled radius, fed each frame from the viewport so a
// freshly-added shape lands on the model instead of the world origin.
let sceneCenter: V3 = [0, 0, 0];
let sceneRadius = 5;
export function setClipShapeSeed(center: V3, radius: number) {
  sceneCenter = center;
  sceneRadius = radius;
}

const log = (m: string) => consoleActions.log('info', `Clip shapes → ${m}`);

/** Add a shape: fitted to the selection when there is one (native "fit selected
 *  on add"), else the scene-centre default placement. Opens the list panel. */
async function addShape(kind: ClipShapeKind) {
  const sel = await db.selectionBounds();
  clipShapesActions.add(kind, sceneCenter, sceneRadius, sel ? { mn: sel.min, mx: sel.max } : undefined);
  openClipShapesPanel();
  log(`Add ${kind}`);
}

export const ribbonClipShapesActions = {
  addSphere: () => void addShape('sphere'),
  addCylinder: () => void addShape('cylinder'),
  addBox: () => void addShape('box'),
  toggleMuted() {
    clipShapesActions.toggleMuted();
    log(clipShapesState.get().muted ? 'Muted' : 'Unmuted');
  },
  toggleHelpers() {
    clipShapesActions.toggleHelpers();
    log(`Helpers ${clipShapesState.get().helpers ? 'on' : 'off'}`);
  },
  list() {
    openClipShapesPanel();
    log('List');
  },
};
