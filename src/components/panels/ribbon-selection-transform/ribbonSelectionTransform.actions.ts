import { selectionState } from '../../../state/viewer/selection.state';
import { viewerActions } from '../../../state/viewer/viewer.actions';
import { consoleActions } from '../console/console.actions';
import { type RibbonSelectionTransformState, ribbonSelectionTransformState } from './ribbonSelectionTransform.state';

const log = (label: string) => consoleActions.log('info', `SelectionTransform → ${label}`);

// Move faces -> world axis + direction (same convention as the clipping box:
// L/R = ±x, F/B = ∓y — front faces the default camera at -y — Bt/T = ±z).
const FACE: Record<string, { axis: 0 | 1 | 2; dir: 1 | -1 }> = {
  L: { axis: 0, dir: -1 },
  R: { axis: 0, dir: 1 },
  F: { axis: 1, dir: -1 },
  B: { axis: 1, dir: 1 },
  Bt: { axis: 2, dir: -1 },
  T: { axis: 2, dir: 1 },
};

// Named 90° reorientations: which world axis takes face A onto face B
// (right-handed rotations; front = -y, so top(+z) -> front is +90° about x).
export const ROTATIONS: Record<string, { axis: 0 | 1 | 2; dir: 1 | -1 }> = {
  topToFront: { axis: 0, dir: 1 },
  topToBack: { axis: 0, dir: -1 },
  topToLeft: { axis: 1, dir: -1 },
  topToRight: { axis: 1, dir: 1 },
  frontToRight: { axis: 2, dir: 1 },
  frontToLeft: { axis: 2, dir: -1 },
};

const UNIT_SCALE = { m: 1, cm: 0.01, mm: 0.001 } as const;

/** Selection center from the cached bounds (fallback for pivot init). */
function boundsCenter(): [number, number, number] | null {
  const b = selectionState.get().bounds;
  return b ? [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2] : null;
}

// Selection changed -> custom pivot back to the selection center (native
// selection.rs does the same reset).
let lastSelKey = '';
selectionState.subscribe(() => {
  const s = selectionState.get();
  const key = `${s.actives.join(',')}|${s.activeGroup ?? ''}|${s.count}`;
  if (key === lastSelKey) {
    return;
  }
  lastSelKey = key;
  const st = ribbonSelectionTransformState.get();
  if (st.pivot || st.pivotSetting) {
    ribbonSelectionTransformState.set({ pivot: null, pivotSetting: false });
  }
});

export const ribbonSelectionTransformActions = {
  setUnit(unit: RibbonSelectionTransformState['unit']) {
    ribbonSelectionTransformState.set({ unit });
    log(`Unit → ${unit}`);
  },
  setStep: (step: number) => ribbonSelectionTransformState.set({ step }),
  stepBump(dir: 1 | -1) {
    const step = Math.max(0.01, +(ribbonSelectionTransformState.get().step + dir * 0.25).toFixed(2));
    ribbonSelectionTransformState.set({ step });
  },
  /** Toggle the viewport gizmo; clicking the active mode hides it. */
  setGizmoMode(mode: 'move' | 'rotate' | 'scale') {
    const cur = ribbonSelectionTransformState.get().gizmoMode;
    const gizmoMode = cur === mode ? 'none' : mode;
    ribbonSelectionTransformState.set({ gizmoMode });
    log(`Gizmo → ${gizmoMode}`);
  },
  /** Move the selection one step in the face direction. */
  nudge(side: string) {
    const f = FACE[side];
    if (!f) {
      return;
    }
    const { step, unit } = ribbonSelectionTransformState.get();
    void viewerActions.transformSelection('move', f.axis, f.dir, step * UNIT_SCALE[unit]);
  },
  /** Uniform scale about the selection center: the largest selection
   * dimension grows/shrinks by one step (in the chosen unit). */
  scale(dir: 1 | -1) {
    const { step, unit, pivot } = ribbonSelectionTransformState.get();
    void viewerActions.transformSelection('scale-uniform', 0, dir, step * UNIT_SCALE[unit], pivot);
  },
  /** 90° reorientation about the pivot / selection center (keys of ROTATIONS). */
  rotate(name: string) {
    const r = ROTATIONS[name];
    if (!r) {
      return;
    }
    const { pivot } = ribbonSelectionTransformState.get();
    void viewerActions.transformSelection('rotate', r.axis, r.dir, 90, pivot);
  },
  // -----------------------------------------------------------------------------
  // custom pivot (native T6 pivot origin: set → drag arrows → lock)
  // -----------------------------------------------------------------------------
  startSetPivot() {
    const st = ribbonSelectionTransformState.get();
    ribbonSelectionTransformState.set({
      pivotSetting: true,
      pivot: st.pivot ?? boundsCenter() ?? [0, 0, 0],
    });
    log('Pivot placement — drag the arrows, then Lock');
  },
  lockPivot() {
    ribbonSelectionTransformState.set({ pivotSetting: false, pivotFromItem: false });
    const p = ribbonSelectionTransformState.get().pivot;
    if (p) {
      log(`Pivot locked at (${p.map((v) => v.toFixed(2)).join(', ')})`);
    }
  },
  cancelPivot() {
    ribbonSelectionTransformState.set({ pivotSetting: false, pivot: null, pivotFromItem: false });
    log('Pivot placement cancelled');
  },
  resetPivot() {
    ribbonSelectionTransformState.set({ pivot: null, pivotSetting: false, pivotFromItem: false });
    log('Pivot reset to selection center');
  },
  movePivot(p: [number, number, number]) {
    ribbonSelectionTransformState.set({ pivot: p });
  },
  /** Placement-mode helper: while on, clicking an item in the 3D view moves
   * the pivot to that item's center instead of dragging the arrows. The
   * click is consumed — the selection (and the pivot session) is untouched. */
  togglePivotFromItem() {
    const on = !ribbonSelectionTransformState.get().pivotFromItem;
    ribbonSelectionTransformState.set({ pivotFromItem: on });
    log(`Item pivot ${on ? 'on — click an item to move the pivot to its center' : 'off'}`);
  },
  /** Called from the viewport on item click while the helper is active. */
  setPivotFromItem(center: [number, number, number]) {
    ribbonSelectionTransformState.set({ pivot: center });
    log(`Pivot → item center (${center.map((v) => v.toFixed(2)).join(', ')})`);
  },
  /** One-shot arm: the next viewport click moves the selection there. */
  toggleMoveToClick() {
    const armed = !ribbonSelectionTransformState.get().moveToClickArmed;
    ribbonSelectionTransformState.set({ moveToClickArmed: armed });
    log(armed ? 'Move to click armed — click a point in the 3D view' : 'Move to click cancelled');
  },
  /** Move the selection so its bounds BOTTOM center lands on `target`. */
  moveSelectionBottomTo(target: [number, number, number]) {
    ribbonSelectionTransformState.set({ moveToClickArmed: false });
    const b = selectionState.get().bounds;
    if (!b) {
      return;
    }
    const from: [number, number, number] = [
      (b.min[0] + b.max[0]) / 2,
      (b.min[1] + b.max[1]) / 2,
      b.min[2], // bottom face
    ];
    const g = new Float32Array([
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      target[0] - from[0],
      target[1] - from[1],
      target[2] - from[2],
      1,
    ]);
    void viewerActions.bakeSelectionTransform(g);
    log('Selection moved to clicked point (bottom aligned)');
  },
  undo: () => void viewerActions.undoTransform(),
  redo: () => void viewerActions.redoTransform(),
  resetSel: () => void viewerActions.resetTransformSel(),
  resetAll: () => void viewerActions.resetAllTransforms(),
};
