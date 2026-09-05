import { getRenderer } from '../../../state/viewer/viewer.actions';
import { consoleActions } from '../console/console.actions';
import { sph } from '../viewport/clipPack';
import { type PlaneAxis, type PlaneState, ribbonClippingPlaneState } from './ribbonClippingPlane.state';

const log = (label: string) => consoleActions.log('info', `ClippingPlane → ${label}`);

const patch = (axis: PlaneAxis, p: Partial<PlaneState>) =>
  ribbonClippingPlaneState.set({ [axis]: { ...ribbonClippingPlaneState.get()[axis], ...p } });

const lastClick = (): [number, number, number] | null => getRenderer()?.lastClickWorld ?? null;

const AXIS_INDEX: Record<PlaneAxis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 };
/** Below this the plane's normal has no component along its own axis. */
const AXIS_EPS = 1e-6;

/** The plane's reference point — its anchor, else the scene center (the same
 *  fallback clipPack uses). */
function planeBase(pl: PlaneState): [number, number, number] {
  if (pl.anchor) {
    return pl.anchor;
  }
  const b = getRenderer()?.sceneBounds;
  if (!b || !Number.isFinite(b.min[0])) {
    return [0, 0, 0];
  }
  return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
}

/** World coordinate of the plane's point along its own axis — the absolute
 *  position the ribbon shows and lets the user type, as opposed to the offset
 *  from the anchor the state stores (point = anchor + normal × position). */
export function planeAxisPosition(axis: PlaneAxis, pl: PlaneState = ribbonClippingPlaneState.get()[axis]): number {
  const i = AXIS_INDEX[axis];
  return planeBase(pl)[i] + sph(pl.el, pl.az)[i] * pl.position;
}

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
  /** Show / hide the plane's viewport transform tool (independent of the helper). */
  toggleGizmo(axis: PlaneAxis) {
    const on = !ribbonClippingPlaneState.get()[axis].gizmo;
    patch(axis, { gizmo: on });
    log(`${axis.toUpperCase()} gizmo ${on ? 'on' : 'off'}`);
  },
  center(axis: PlaneAxis) {
    // bring the plane to the last click (falls back to the scene center)
    patch(axis, { anchor: lastClick(), position: 0 });
    log(`${axis.toUpperCase()} centred on last click`);
  },
  setPosition: (axis: PlaneAxis, position: number) => patch(axis, { position }),
  /** Type an absolute coordinate: the offset that puts the plane's point there
   *  along its axis (what the ribbon shows — see planeAxisPosition). A plane
   *  rotated parallel to its axis has no such coordinate; the value is then
   *  the plain offset. */
  setAxisPosition(axis: PlaneAxis, value: number) {
    const pl = ribbonClippingPlaneState.get()[axis];
    const i = AXIS_INDEX[axis];
    const n = sph(pl.el, pl.az)[i];
    patch(axis, { position: Math.abs(n) < AXIS_EPS ? value : (value - planeBase(pl)[i]) / n });
  },
  /** Bump a numeric plane field by ±delta (drives the number-input +/- hotkeys).
   *  A position step moves the plane's axis coordinate by exactly one step. */
  bump(axis: PlaneAxis, field: 'position' | 'step' | 'el' | 'az', delta: number) {
    const cur = ribbonClippingPlaneState.get()[axis];
    if (field === 'position') {
      ribbonClippingPlaneActions.setAxisPosition(axis, +(planeAxisPosition(axis, cur) + delta * cur.step).toFixed(3));
      return;
    }
    const step = field === 'step' ? 0.1 : 5;
    const next = +(cur[field] + delta * step).toFixed(3);
    patch(axis, { [field]: field === 'step' ? Math.max(0.1, next) : next });
  },
  setAnchor: (axis: PlaneAxis, anchor: [number, number, number]) => patch(axis, { anchor }),
  setStep: (axis: PlaneAxis, step: number) => patch(axis, { step }),
  flip(axis: PlaneAxis) {
    patch(axis, { flipped: !ribbonClippingPlaneState.get()[axis].flipped });
    log(`${axis.toUpperCase()} flipped`);
  },
  /** Rotate: toggles rotation mode — unlocks the el/az inputs and swaps the
   * plane's gizmo from move arrows to rotation rings. */
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
        gizmo: true,
        position: 0,
        step: 0.1,
        el: 5,
        az: 0,
        flipped: false,
        anchor: null,
        rotateMode: false,
      },
      y: {
        enabled: false,
        helper: true,
        gizmo: true,
        position: 0,
        step: 0.1,
        el: 0,
        az: 90,
        flipped: false,
        anchor: null,
        rotateMode: false,
      },
      z: {
        enabled: false,
        helper: true,
        gizmo: true,
        position: 0,
        step: 0.1,
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
