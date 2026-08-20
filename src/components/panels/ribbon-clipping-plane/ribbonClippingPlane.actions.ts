import { getRenderer } from '../../../state/viewer/viewer.actions';
import { consoleActions } from '../console/console.actions';
import { type PlaneAxis, type PlaneState, ribbonClippingPlaneState } from './ribbonClippingPlane.state';

const log = (label: string) => consoleActions.log('info', `ClippingPlane → ${label}`);

const patch = (axis: PlaneAxis, p: Partial<PlaneState>) =>
  ribbonClippingPlaneState.set({ [axis]: { ...ribbonClippingPlaneState.get()[axis], ...p } });

const lastClick = (): [number, number, number] | null => getRenderer()?.lastClickWorld ?? null;

export const ribbonClippingPlaneActions = {
  toggleEnabled(axis: PlaneAxis) {
    const on = !ribbonClippingPlaneState.get()[axis].enabled;
    // enabling starts the plane at the last clicked point (native behavior);
    // the click point is also the rotation pivot
    patch(axis, on ? { enabled: on, anchor: lastClick(), position: 0 } : { enabled: on });
    log(`${axis.toUpperCase()} plane ${on ? 'enabled' : 'disabled'}`);
  },
  toggleHelper(axis: PlaneAxis) {
    const on = !ribbonClippingPlaneState.get()[axis].helper;
    patch(axis, { helper: on });
    log(`${axis.toUpperCase()} helper ${on ? 'on' : 'off'}`);
  },
  center(axis: PlaneAxis) {
    // bring the plane to the last click (falls back to the scene center)
    patch(axis, { anchor: lastClick(), position: 0 });
    log(`${axis.toUpperCase()} centred on last click`);
  },
  setPosition: (axis: PlaneAxis, position: number) => patch(axis, { position }),
  /** Bump a numeric plane field by ±delta (drives the number-input +/- hotkeys). */
  bump(axis: PlaneAxis, field: 'position' | 'step' | 'el' | 'az', delta: number) {
    const cur = ribbonClippingPlaneState.get()[axis];
    const step = field === 'position' ? cur.step : field === 'step' ? 0.1 : 5;
    const next = +((cur[field] as number) + delta * step).toFixed(3);
    patch(axis, { [field]: field === 'step' ? Math.max(0.1, next) : next });
  },
  setAnchor: (axis: PlaneAxis, anchor: [number, number, number]) => patch(axis, { anchor }),
  setStep: (axis: PlaneAxis, step: number) => patch(axis, { step }),
  flip(axis: PlaneAxis) {
    patch(axis, { flipped: !ribbonClippingPlaneState.get()[axis].flipped });
    log(`${axis.toUpperCase()} flipped`);
  },
  /** Rotate: toggles rotation mode — unlocks the el/az inputs now, and will
   * show the rotation gizmo in phase B. */
  rotate(axis: PlaneAxis) {
    patch(axis, { rotateMode: !ribbonClippingPlaneState.get()[axis].rotateMode });
  },
  setEl: (axis: PlaneAxis, el: number) => patch(axis, { el }),
  setAz: (axis: PlaneAxis, az: number) => patch(axis, { az }),
  resetAll() {
    ribbonClippingPlaneState.set({
      x: {
        enabled: false,
        helper: true,
        position: 0,
        step: 0.5,
        el: 5,
        az: 0,
        flipped: false,
        anchor: null,
        rotateMode: false,
      },
      y: {
        enabled: false,
        helper: true,
        position: 0,
        step: 0.5,
        el: 0,
        az: 90,
        flipped: false,
        anchor: null,
        rotateMode: false,
      },
      z: {
        enabled: false,
        helper: true,
        position: 0,
        step: 0.5,
        el: 90,
        az: 0,
        flipped: false,
        anchor: null,
        rotateMode: false,
      },
    });
    log('Reset all planes');
  },
};
