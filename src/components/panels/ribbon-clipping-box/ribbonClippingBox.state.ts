import { createStore } from '@treDeSpaceUI/lib/createStore';

export interface RibbonClippingBoxState {
  /** GLOBAL clipping on/off (ribbon Enable / Z) — gates the default box AND the
   *  extra clip shapes. */
  enabled: boolean;
  /** The default box itself (the shapes panel's "Hide default" toggles this). */
  boxOn: boolean;
  helper: boolean;
  gizmoMode: 'none' | 'move' | 'rotate' | 'scale';
  /** What X restores: the mode the gizmo last had while on … */
  lastGizmoMode: 'move' | 'rotate' | 'scale';
  /** … and where it was — the main box, or an armed clip shape's id (falls
   *  back to the main box when that shape no longer exists). */
  lastGizmoTarget: 'main' | number;
  /** scale tool variant: false = 3-axis symmetric, true = 6-axis per-face */
  sixAxis: boolean;
  step: number;
  /** Fit Sel +offset: margin (m) added around the selection on every side. */
  fitOffset: number;
  /** Fit Sel / Fit Sel +Off. also re-pivot the orbit point onto the box center. */
  focusOnSet: boolean;
  /** oriented box, world space */
  center: [number, number, number];
  size: [number, number, number];
  /** rotation quaternion [x, y, z, w] */
  rotation: [number, number, number, number];
  /** cut inside instead of outside */
  inverted: boolean;
}

export const ribbonClippingBoxState = createStore<RibbonClippingBoxState>({
  enabled: false,
  boxOn: true,
  helper: true,
  gizmoMode: 'none',
  lastGizmoMode: 'scale',
  lastGizmoTarget: 'main',
  sixAxis: true,
  step: 1,
  fitOffset: 2,
  focusOnSet: true,
  center: [0, 0, 0],
  size: [10, 10, 10],
  rotation: [0, 0, 0, 1],
  inverted: false,
});
