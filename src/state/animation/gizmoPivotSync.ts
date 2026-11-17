// The gizmo turns about the key's pivot while authoring (DESIGN.md ›
// Animation › Authoring): with an object row current, the Transform
// ribbon's pivot sits on the picked key's pivot or the next key's, at the
// object's pose now — where its earlier keys (and a pose not keyed yet) put
// it, so Bottom is the object's own bottom, turned along, not the bottom of
// the box it fills now. Moving that pivot (Set pivot, drag, pick an item)
// writes the key's offset from the side it names, which later keys carry on.

import { ribbonSelectionTransformState } from '../../components/panels/ribbon-selection-transform/ribbonSelectionTransform.state';
import { m4InvertRigid, m4TransformPoint } from '../../lib/animation/interp';
import { choiceOf, keyPivotPoint, pivotSpec, pivotThrough } from '../../lib/animation/pivots';
import type { AnimObject, KeyPivot, V3 } from '../../lib/animation/types';
import { animationDocState } from './animationDoc.state';
import { animationUiState } from './animationUi.state';
import { activeScene } from './docEdit';
import { keysActions } from './keys.actions';
import { playerState } from './player.state';
import { posingActions } from './posing.actions';
import { rowObject } from './rows';
import { evalContext, objectPoseNow, sessionRestBounds } from './runtime';

// -----------------------------------------------------------------------------
// types + module state
// -----------------------------------------------------------------------------

/** The key whose pivot the gizmo shows: a picked one, or the next (null). */
type Target = { object: AnimObject; index: number | null };

/** Closer than this the gizmo's pivot is the key's (offsets are 0.1 mm). */
const SAME_POINT_M = 1e-3;

/** The point this module last put on the Transform ribbon. */
let placed: V3 | null = null;
let removers: (() => void)[] = [];

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function near(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < SAME_POINT_M;
}

function target(): Target | null {
  const ui = animationUiState.get();
  if (ui.mode.kind !== 'author') {
    return null;
  }
  const scene = activeScene();
  const p = ui.picked;
  if (p.kind === 'keys') {
    const object = scene?.objects.find((o) => o.id === rowObject(p.row));
    const index = p.indices[0];
    return object && index !== undefined && object.keys[index] ? { object, index } : null;
  }
  if (p.kind !== 'none') {
    return null;
  }
  const object = scene?.objects.find((o) => o.id === rowObject(ui.current));
  return object ? { object, index: null } : null;
}

/** The pivot the gizmo shows (the picked key's, else the next key's) and
 *  the object's pose at the time slider (a pose not keyed yet on top). */
function pivotAndPose(t: Target): { spec: KeyPivot | undefined; pose: Float64Array } | null {
  const o = t.object;
  if (!sessionRestBounds(o.id)) {
    // made a moment ago, not captured yet: its sides aren't known
    return null;
  }
  let spec: KeyPivot | undefined;
  if (t.index !== null) {
    if (!o.keys[t.index]) {
      return null;
    }
    spec = o.keys[t.index]?.pivot;
  } else {
    const next = posingActions.nextKey(o.id);
    if (!next) {
      return null;
    }
    spec = next.pivot;
  }
  return { spec, pose: objectPoseNow(o) };
}

/** The spec as the Key panel shows it, said as a side and an offset (a
 *  point reads as the Centre plus the offset to it). */
function shownSpec(o: AnimObject, spec: KeyPivot | undefined): KeyPivot | undefined {
  return pivotSpec(choiceOf(spec, sessionRestBounds(o.id)), o.pivot, spec);
}

/** Where `spec` is in the model at `pose`. */
function worldOf(o: AnimObject, spec: KeyPivot | undefined, pose: Float64Array): V3 {
  const ctx = evalContext();
  return m4TransformPoint(pose, keyPivotPoint(spec, ctx.boxes?.get(o.id), ctx.pivots.get(o.id) ?? [0, 0, 0]));
}

/** The key's pivot onto the Transform ribbon (the gizmo turns about it). */
function place(): void {
  const st = ribbonSelectionTransformState.get();
  if (st.pivotSetting || playerState.get().status === 'playing') {
    return;
  }
  const t = target();
  const pp = t ? pivotAndPose(t) : null;
  if (!t || !pp) {
    if (placed && st.pivot && near(st.pivot, placed)) {
      placed = null;
      ribbonSelectionTransformState.set({ pivot: null });
    }
    return;
  }
  placed = worldOf(t.object, pp.spec, pp.pose);
  if (!st.pivot || !near(st.pivot, placed)) {
    ribbonSelectionTransformState.set({ pivot: placed });
  }
}

/** The Transform ribbon's pivot moved by hand: the key's offset follows. */
function onRibbonPivot(): void {
  const p = ribbonSelectionTransformState.get().pivot;
  if (!p) {
    // reset (a new selection, Cancel): back on the key's pivot
    if (placed) {
      placed = null;
      queueMicrotask(place);
    }
    return;
  }
  if (placed && near(p, placed)) {
    return;
  }
  const t = target();
  const pp = t ? pivotAndPose(t) : null;
  if (!t || !pp) {
    return;
  }
  const o = t.object;
  const ctx = evalContext();
  const r = m4TransformPoint(m4InvertRigid(pp.pose, new Float64Array(16)), p);
  const box = ctx.boxes?.get(o.id);
  const objectPoint = ctx.pivots.get(o.id) ?? [0, 0, 0];
  placed = [p[0], p[1], p[2]];
  if (t.index !== null) {
    keysActions.setKeyPivot(o.id, t.index, pivotThrough(shownSpec(o, pp.spec), o.pivot, box, objectPoint, r));
    return;
  }
  const current = animationUiState.get().nextPivot ?? choiceOf(pp.spec, sessionRestBounds(o.id));
  const spec = pivotThrough(pivotSpec(current, o.pivot, pp.spec), o.pivot, box, objectPoint, r);
  posingActions.setNextPivot({ at: current.at, offset: spec?.offset ? [...spec.offset] : [0, 0, 0] });
}

// -----------------------------------------------------------------------------
// actions
// -----------------------------------------------------------------------------

export const gizmoPivotSync = {
  /** Authoring on / off: keep the gizmo's pivot and the key's one point;
   *  off, a pivot this put there goes back to the selection's centre. */
  install(on: boolean): void {
    for (const remove of removers) {
      remove();
    }
    removers = [];
    if (on) {
      removers = [
        animationDocState.subscribe(place),
        animationUiState.subscribe(place),
        playerState.subscribe(place),
        ribbonSelectionTransformState.subscribe(onRibbonPivot),
      ];
      place();
      return;
    }
    const st = ribbonSelectionTransformState.get();
    if (placed && st.pivot && near(st.pivot, placed)) {
      ribbonSelectionTransformState.set({ pivot: null, pivotSetting: false });
    }
    placed = null;
  },
};
