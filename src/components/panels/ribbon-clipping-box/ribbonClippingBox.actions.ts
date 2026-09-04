import { quatAxes } from '../../../lib/math/quat';
import { clipShapesActions } from '../../../state/viewer/clipShapes.actions';
import { clipShapesState } from '../../../state/viewer/clipShapes.state';
import { db } from '../../../state/viewer/db';
import { getRenderer } from '../../../state/viewer/viewer.actions';
import { openClipShapesPanel } from '../clip-shapes/clipShapesPanel';
import { consoleActions } from '../console/console.actions';
import { type RibbonClippingBoxState, ribbonClippingBoxState } from './ribbonClippingBox.state';

const log = (label: string) => consoleActions.log('info', `ClippingBox → ${label}`);

// Faces: L/R = ±x, F/B = ∓y (front faces the default camera at -y), Bt/T = ±z.
const FACE: Record<string, { axis: 0 | 1 | 2; dir: 1 | -1 }> = {
  L: { axis: 0, dir: -1 },
  R: { axis: 0, dir: 1 },
  F: { axis: 1, dir: -1 },
  B: { axis: 1, dir: 1 },
  Bt: { axis: 2, dir: -1 },
  T: { axis: 2, dir: 1 },
};

const get = () => ribbonClippingBoxState.get();

export const ribbonClippingBoxActions = {
  toggleEnabled() {
    const enabled = !get().enabled;
    ribbonClippingBoxState.set({ enabled });
    if (enabled) {
      const click = getRenderer()?.lastClickWorld;
      if (click) {
        // start as a 5 m cube around the last clicked point (like the planes)
        ribbonClippingBoxState.set({ center: [...click], size: [5, 5, 5] });
      } else if (get().size.every((v) => v === 10) && get().center.every((v) => v === 0)) {
        ribbonClippingBoxActions.fitScene(); // nothing clicked yet: cover the scene
      }
    }
    log(enabled ? 'Enabled' : 'Disabled');
  },
  /** Turn box clipping off (idempotent) — host API `clip.box.disable`. */
  disable() {
    if (!get().enabled) {
      return;
    }
    ribbonClippingBoxState.set({ enabled: false });
    log('Disabled');
  },
  /** The default box itself — global clipping (enabled) stays as it is. */
  toggleBoxOn() {
    ribbonClippingBoxState.set((s) => ({ boxOn: !s.boxOn }));
  },

  toggleHelper() {
    ribbonClippingBoxState.set({ helper: !get().helper });
  },
  flipCutDir() {
    ribbonClippingBoxState.set({ inverted: !get().inverted });
    log(`Cut ${get().inverted ? 'inside' : 'outside'}`);
  },
  setGizmoMode(gizmoMode: RibbonClippingBoxState['gizmoMode']) {
    ribbonClippingBoxState.set(gizmoMode === 'none' ? { gizmoMode } : { gizmoMode, lastGizmoMode: gizmoMode });
    log(`Gizmo mode → ${gizmoMode}`);
  },
  /** The M hotkey: cycle move → rotate → scale on whatever the gizmo targets —
   *  the armed clip shape, else the main box (off → on at the last mode). */
  cycleGizmoMode() {
    if (clipShapesState.get().gizmoId !== null) {
      clipShapesActions.cycleGizmoMode();
      return;
    }
    const order = ['move', 'rotate', 'scale'] as const;
    const { gizmoMode, lastGizmoMode } = ribbonClippingBoxState.get();
    const next = gizmoMode === 'none' ? lastGizmoMode : order[(order.indexOf(gizmoMode) + 1) % order.length];
    ribbonClippingBoxActions.setGizmoMode(next);
  },
  /** The X hotkey: gizmo off / on. Off remembers where it was (main box or
   *  armed shape) and its mode; on brings that back — a shape that no longer
   *  exists falls back to the main box. Clipping itself (Z) is left alone. */
  toggleGizmo() {
    const shp = clipShapesState.get();
    const s = ribbonClippingBoxState.get();
    const armed = shp.shapes.find((x) => x.id === shp.gizmoId);
    if (armed || s.gizmoMode !== 'none') {
      ribbonClippingBoxState.set({
        gizmoMode: 'none',
        lastGizmoMode: s.gizmoMode === 'none' ? s.lastGizmoMode : s.gizmoMode,
        lastGizmoTarget: armed ? armed.id : 'main',
      });
      if (armed) {
        clipShapesActions.armGizmo(null);
      }
      log('Gizmo off');
      return;
    }
    const target = s.lastGizmoTarget;
    const shape = target === 'main' ? undefined : shp.shapes.find((x) => x.id === target);
    if (shape) {
      clipShapesActions.armGizmo(shape.id);
      log(`Gizmo on → shape "${shape.label}"`);
      return;
    }
    ribbonClippingBoxState.set({ gizmoMode: s.lastGizmoMode, lastGizmoTarget: 'main' });
    log(`Gizmo on → main box (${s.lastGizmoMode})${s.enabled ? '' : ' — clipping is off, press Z to enable'}`);
  },
  toggleSixAxis() {
    ribbonClippingBoxState.set({ sixAxis: !ribbonClippingBoxState.get().sixAxis });
  },
  async fitSel(margin = 0) {
    const bounds = await db.selectionBounds();
    if (!bounds) {
      log('Fit selection — nothing selected');
      return;
    }
    const { min, max } = bounds;
    const center: [number, number, number] = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    ribbonClippingBoxState.set({
      enabled: true,
      center,
      size: [max[0] - min[0] + margin * 2, max[1] - min[1] + margin * 2, max[2] - min[2] + margin * 2],
      rotation: [0, 0, 0, 1],
    });
    if (get().focusOnSet) {
      getRenderer()?.camera.rePivot(center);
    }
    log(margin > 0 ? `Fit selection +${margin}m` : 'Fit selection');
  },
  /** Fit Sel with the user-set offset (the ribbon's number input). */
  fitSelOffset() {
    void ribbonClippingBoxActions.fitSel(ribbonClippingBoxState.get().fitOffset);
  },
  setFitOffset(v: number) {
    ribbonClippingBoxState.set({ fitOffset: Math.max(0, v) });
  },
  toggleFocusOnSet() {
    ribbonClippingBoxState.set((s) => ({ focusOnSet: !s.focusOnSet }));
    log(`Focus on set ${get().focusOnSet ? 'on' : 'off'}`);
  },
  fitScene() {
    const r = getRenderer();
    if (!r) {
      return;
    }
    const { min, max } = r.sceneBounds;
    if (!Number.isFinite(min[0])) {
      return;
    }
    ribbonClippingBoxState.set({
      center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
      size: [max[0] - min[0] + 1, max[1] - min[1] + 1, max[2] - min[2] + 1],
      rotation: [0, 0, 0, 1], // fit is axis-aligned by definition
    });
    log('Fit scene');
  },
  /** "L+" grows the box through its left face by one step; "L-" shrinks it.
   * Faces are the box's LOCAL faces once rotated. */
  resize(side: string) {
    const grow = side.endsWith('+') ? 1 : -1;
    const f = FACE[side.slice(0, -1)];
    if (!f) {
      return;
    }
    const { center, size, step, rotation } = get();
    const axes = quatAxes(rotation);
    const newSize: [number, number, number] = [...size];
    newSize[f.axis] = Math.max(0.1, size[f.axis] + grow * step);
    const delta = ((newSize[f.axis] - size[f.axis]) / 2) * f.dir;
    const a = axes[f.axis];
    ribbonClippingBoxState.set({
      center: [center[0] + a[0] * delta, center[1] + a[1] * delta, center[2] + a[2] * delta],
      size: newSize,
    });
  },
  setStep: (step: number) => ribbonClippingBoxState.set({ step }),
  stepBump: (dir: 1 | -1) =>
    ribbonClippingBoxState.set({ step: Math.max(0.1, +(ribbonClippingBoxState.get().step + dir * 0.1).toFixed(2)) }),
  /** Move the whole box one step toward the named face (box-local axes). */
  move(side: string) {
    const f = FACE[side];
    if (!f) {
      return;
    }
    const { center, step, rotation } = get();
    const a = quatAxes(rotation)[f.axis];
    const d = f.dir * step;
    ribbonClippingBoxState.set({
      center: [center[0] + a[0] * d, center[1] + a[1] * d, center[2] + a[2] * d],
    });
  },
  /** Open the Clip Shapes panel (docks right; the column is recreated if it was closed away). */
  shapes: () => openClipShapesPanel(),
};
