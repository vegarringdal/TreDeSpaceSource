import { createStore } from '@treDeSpaceUI/lib/createStore';

export type PlaneAxis = 'x' | 'y' | 'z';

export interface PlaneState {
  enabled: boolean;
  /** the 3×3 m marker drawn on the plane */
  helper: boolean;
  /** the viewport transform tool (move arrows / rotation rings) */
  gizmo: boolean;
  position: number;
  step: number;
  el: number;
  az: number;
  /** cut the other side (negates the plane) */
  flipped: boolean;
  /** plane anchor (last click when enabled/centred); null = scene center */
  anchor: [number, number, number] | null;
  /** rotation mode: unlocks the el/az inputs and swaps the gizmo to rings */
  rotateMode: boolean;
}

export type RibbonClippingPlaneState = Record<PlaneAxis, PlaneState>;

const plane = (el: number, az: number): PlaneState => ({
  enabled: false,
  helper: true,
  gizmo: true,
  position: 0,
  step: 0.5,
  el,
  az,
  flipped: false,
  anchor: null,
  rotateMode: false,
});

export const ribbonClippingPlaneState = createStore<RibbonClippingPlaneState>({
  x: plane(5, 0),
  y: plane(0, 90),
  z: plane(90, 0),
});
