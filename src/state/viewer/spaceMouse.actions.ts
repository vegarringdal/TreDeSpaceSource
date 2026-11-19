// SpaceMouse (3Dconnexion) via WebHID: connection lifecycle, button actions,
// and the per-frame feed into the camera. The open device and its latest axis
// state are live handles, so they live here rather than in the store.

import type { CameraController } from '../../lib/render/camera';
import {
  findPairedSpaceMouse,
  getHid,
  isSpaceMouse,
  openSpaceMouse,
  requestSpaceMouse,
  type SpaceMouseConnection,
} from '../../lib/spacemouse/spaceMouseDevice';
import {
  isFlyInputActive,
  type SpaceMouseAxes,
  type SpaceMouseFlyInput,
  shapeFlyInput,
  ZERO_AXES,
  ZERO_FLY_INPUT,
} from '../../lib/spacemouse/spaceMouseInput';
import type { HidDevice } from '../../lib/spacemouse/webhid';
import { isConnectionEvent } from '../../lib/spacemouse/webhid';
import { navActions, navState } from './nav.state';
import { spaceMouseState } from './spaceMouse.state';
import { getRenderer } from './viewer.actions';

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const BUTTON_LEFT = 1 << 0;
const BUTTON_RIGHT = 1 << 1;
/** How long after a SpaceMouse button press/release a canvas click is treated
 *  as the driver's echo of it (3DxWare can emulate a mouse click per button). */
const BUTTON_CLICK_ECHO_MS = 600;

// -----------------------------------------------------------------------------
// Live handles
// -----------------------------------------------------------------------------

let connection: SpaceMouseConnection | null = null;
let axes: SpaceMouseAxes = ZERO_AXES;
let buttons = 0;
let isStarted = false;
/** Button actions aimed at the viewport centre — registered by the viewport, which owns the canvas. */
export type SpaceMouseCenterActions = Readonly<{
  select: () => void;
  flyTo: () => void;
}>;

let centerActions: SpaceMouseCenterActions | null = null;
let lastActiveT = 0;
let lastButtonChangeT = 0;

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

/** Both buttons act on what sits at the screen centre (aim by flying): left =
 *  select it, right = fly to it (the Space+click move). On press, not release. */
function handleButtons(mask: number): void {
  const pressed = mask & ~buttons;
  if (mask !== buttons) {
    lastButtonChangeT = performance.now();
  }
  buttons = mask;
  if (getRenderer()?.camera.inputLocked) {
    return;
  }

  if (pressed !== 0) {
    lastActiveT = performance.now();
  }
  if (pressed & BUTTON_LEFT) {
    centerActions?.select();
  }
  if (pressed & BUTTON_RIGHT) {
    centerActions?.flyTo();
  }
}

function dropConnection(): void {
  connection = null;
  axes = ZERO_AXES;
  buttons = 0;
}

async function attach(device: HidDevice): Promise<void> {
  if (connection?.device === device) {
    return;
  }

  connection?.close();
  dropConnection();
  spaceMouseState.set({ status: { kind: 'connecting' } });
  const result = await openSpaceMouse(device, {
    onAxes: (next) => {
      axes = next;
    },
    onButtons: handleButtons,
  });
  if (result.error || !result.data) {
    spaceMouseState.set({ status: { kind: 'disconnected', error: result.error?.msg ?? 'Could not open the device' } });
    return;
  }

  connection = result.data;
  spaceMouseState.set({ status: { kind: 'connected', deviceName: result.data.name } });
}

function handleHidDisconnect(e: Event): void {
  if (!isConnectionEvent(e) || connection?.device !== e.device) {
    return;
  }

  dropConnection();
  spaceMouseState.set({ status: { kind: 'disconnected', error: null } });
}

function handleHidConnect(e: Event): void {
  if (!isConnectionEvent(e) || connection || !isSpaceMouse(e.device)) {
    return;
  }

  void attach(e.device);
}

/** The camera gets nothing while another window has focus — the device keeps
 *  streaming then, and the view must not drift behind the user's back. */
function readFlyInput(): SpaceMouseFlyInput {
  if (!connection || !document.hasFocus()) {
    return ZERO_FLY_INPUT;
  }

  const nav = navState.get();

  return shapeFlyInput(axes, {
    deadzone: nav.spaceDeadzone,
    dominant: nav.spaceDominant,
    lookSens: nav.spaceLookSens,
    invertPitch: nav.spaceInvertPitch,
    invertYaw: nav.spaceInvertYaw,
    invertForward: nav.spaceInvertForward,
  });
}

// -----------------------------------------------------------------------------
// Actions
// -----------------------------------------------------------------------------

export const spaceMouseActions = {
  /** Idempotent start-up: re-opens a device paired on an earlier visit and
   *  follows plug/unplug from then on. */
  init(): void {
    if (isStarted) {
      return;
    }

    isStarted = true;
    const hid = getHid();
    if (!hid) {
      spaceMouseState.set({ status: { kind: 'unsupported' } });
      return;
    }

    hid.addEventListener('connect', handleHidConnect);
    hid.addEventListener('disconnect', handleHidDisconnect);
    void findPairedSpaceMouse(hid).then((device) => {
      if (device) {
        void attach(device);
      }
    });
  },

  /** Pair a device through the browser's picker — call from a click handler. */
  async connect(): Promise<void> {
    spaceMouseActions.init();
    const hid = getHid();
    if (!hid) {
      return;
    }

    const result = await requestSpaceMouse(hid);
    if (result.error) {
      spaceMouseState.set({ status: { kind: 'disconnected', error: result.error.msg } });
      return;
    }

    if (!result.data) {
      return;
    }

    await attach(result.data);
  },

  /** Close the device and revoke the pairing, so it is not re-opened next visit. */
  async disconnect(): Promise<void> {
    const current = connection;
    dropConnection();
    spaceMouseState.set({ status: { kind: 'disconnected', error: null } });
    await current?.forget();
  },

  /** The viewport's centre-aimed button actions (null on unmount). */
  setCenterActions(actions: SpaceMouseCenterActions | null): void {
    centerActions = actions;
  },

  /** Per frame, before the camera update: hand the shaped input to the camera
   *  and leave orbit for fly the moment the cap is pushed. */
  feed(camera: CameraController): void {
    const input = readFlyInput();
    camera.spaceMove = [input.move[0], input.move[1], input.move[2]];
    camera.spaceLook = [input.look[0], input.look[1]];
    if (isFlyInputActive(input) && !camera.inputLocked) {
      lastActiveT = performance.now();
      navActions.spaceActivate();
    }
  },

  /** True while a canvas click is likely the driver's mouse-click echo of a
   *  SpaceMouse button (just pressed or released) — the viewport drops it, or
   *  it would re-select whatever sits under the mouse pointer. */
  isButtonClickEcho(now: number): boolean {
    return buttons !== 0 || (lastButtonChangeT > 0 && now - lastButtonChangeT < BUTTON_CLICK_ECHO_MS);
  },

  /** performance.now() of the last SpaceMouse move or button press (0 = never) —
   *  drives the centre crosshair's fade. */
  lastActiveTime(): number {
    return lastActiveT;
  },
};
