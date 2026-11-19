// WebHID access to a 3Dconnexion SpaceMouse: pairing (needs a user gesture),
// silent re-open of an already-paired device, and report streaming.

import type { Result } from '../result';
import { mergeAxes, parseReport, type SpaceMouseAxes, ZERO_AXES } from './spaceMouseInput';
import { type Hid, type HidDevice, type HidDeviceFilter, isInputReportEvent } from './webhid';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type SpaceMouseHandlers = Readonly<{
  onAxes: (axes: SpaceMouseAxes) => void;
  onButtons: (mask: number) => void;
}>;

/** An opened device. `close` stops the stream; `forget` also revokes the pairing. */
export type SpaceMouseConnection = Readonly<{
  device: HidDevice;
  name: string;
  close: () => void;
  forget: () => Promise<void>;
}>;

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const VENDOR_3DCONNEXION = 0x256f;
/** Older SpaceMouse / SpaceNavigator units carry Logitech's vendor id. */
const VENDOR_LOGITECH = 0x046d;
const USAGE_PAGE_GENERIC_DESKTOP = 0x01;
/** HID "Multi-axis Controller" — what keeps Logitech mice/keyboards out of the picker. */
const USAGE_MULTI_AXIS = 0x08;

const FILTERS: readonly HidDeviceFilter[] = [VENDOR_3DCONNEXION, VENDOR_LOGITECH].map((vendorId) => ({
  vendorId,
  usagePage: USAGE_PAGE_GENERIC_DESKTOP,
  usage: USAGE_MULTI_AXIS,
}));

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

/** A 3Dconnexion multi-axis controller (also used to match connect events). */
export function isSpaceMouse(device: HidDevice): boolean {
  const vendorOk = device.vendorId === VENDOR_3DCONNEXION || device.vendorId === VENDOR_LOGITECH;

  return (
    vendorOk &&
    device.collections.some((c) => c.usagePage === USAGE_PAGE_GENERIC_DESKTOP && c.usage === USAGE_MULTI_AXIS)
  );
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------

/** WebHID handle, or null where the browser lacks it (Firefox, Safari, insecure origin). */
export function getHid(): Hid | null {
  return typeof navigator !== 'undefined' && navigator.hid ? navigator.hid : null;
}

/** Shows the browser's device picker. Must run inside a user gesture (a click).
 *  `data` is null when the user closed the picker without choosing. */
export async function requestSpaceMouse(hid: Hid): Promise<Result<HidDevice | null>> {
  try {
    const devices = await hid.requestDevice({ filters: FILTERS });
    return { data: devices.find(isSpaceMouse) ?? null };
  } catch (err) {
    return { error: { err, msg: errorMessage(err, 'Could not open the device picker') } };
  }
}

/** A device the user paired on an earlier visit (no prompt needed), if plugged in. */
export async function findPairedSpaceMouse(hid: Hid): Promise<HidDevice | null> {
  try {
    const devices = await hid.getDevices();
    return devices.find(isSpaceMouse) ?? null;
  } catch {
    return null;
  }
}

/**
 * Opens the device and streams its reports: every motion report hands over the
 * merged 6-axis state, every button report the bitmask. The device sends an
 * all-zero motion report when the cap is released, so the last state holds
 * between reports.
 */
export async function openSpaceMouse(
  device: HidDevice,
  handlers: SpaceMouseHandlers,
): Promise<Result<SpaceMouseConnection>> {
  try {
    if (!device.opened) {
      await device.open();
    }
  } catch (err) {
    return {
      error: { err, msg: errorMessage(err, 'Could not open the SpaceMouse (is another app holding it?)') },
    };
  }

  let axes: SpaceMouseAxes = ZERO_AXES;
  const onReport = (e: Event) => {
    if (!isInputReportEvent(e)) {
      return;
    }

    const report = parseReport(e.reportId, e.data);
    if (report.kind === 'buttons') {
      handlers.onButtons(report.mask);
      return;
    }

    if (report.kind !== 'ignored') {
      axes = mergeAxes(axes, report);
      handlers.onAxes(axes);
    }
  };
  device.addEventListener('inputreport', onReport);

  const close = () => {
    device.removeEventListener('inputreport', onReport);
    void device.close().catch(() => undefined);
  };
  const forget = async () => {
    close();
    await device.forget?.().catch(() => undefined);
  };

  return { data: { device, name: device.productName || 'SpaceMouse', close, forget } };
}
