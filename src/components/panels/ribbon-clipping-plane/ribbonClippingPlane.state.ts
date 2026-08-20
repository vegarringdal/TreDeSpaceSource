import { createStore } from '@treDeSpaceUI/lib/createStore';

export type PlaneAxis = 'x' | 'y' | 'z';

export interface PlaneState {
  enabled: boolean;
  helper: boolean;
  position: number;
  step: number;
  el: number;
  az: number;
  /** cut the other side (negates the plane) */
  flipped: boolean;
  /** plane anchor (last click when enabled/centred); null = scene center */
  anchor: [number, number, number] | null;
  /** rotation mode: unlocks the el/az inputs (rotation gizmo in phase B) */
  rotateMode: boolean;
}

export type RibbonClippingPlaneState = Record<PlaneAxis, PlaneState>;

const plane = (el: number, az: number): PlaneState => ({
  enabled: false,
  helper: true,
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
