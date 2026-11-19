// SpaceMouse (3Dconnexion 6-DOF controller) input: HID report parsing and the
// shaping that turns raw axes into camera fly input. Pure functions — the
// device handling lives in spaceMouseDevice.ts.

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type Vec3 = readonly [number, number, number];

/** One decoded HID input report. Axes are device-raw, normalised to −1..1:
 *  t = [x right, y forward (away from the user), z down (pressing the cap)],
 *  r = rotation about those same axes. */
export type SpaceMouseReport =
  | Readonly<{ kind: 'translate'; t: Vec3 }>
  | Readonly<{ kind: 'rotate'; r: Vec3 }>
  | Readonly<{ kind: 'motion'; t: Vec3; r: Vec3 }>
  | Readonly<{ kind: 'buttons'; mask: number }>
  | Readonly<{ kind: 'ignored' }>;

export type SpaceMouseAxes = Readonly<{ t: Vec3; r: Vec3 }>;

export type SpaceMouseShaping = Readonly<{
  /** Fraction of full deflection ignored around rest (0..0.9). */
  deadzone: number;
  /** Keep only the most-deflected axis, so a push never drifts into a turn. */
  dominant: boolean;
  /** Turn-rate multiplier. Move speed has no multiplier of its own: full
   *  deflection flies at the Fly/Walk speed setting (Shift = sprint speed). */
  lookSens: number;
  invertPitch: boolean;
  invertYaw: boolean;
  /** Flip push/pull (fly forward on pull instead of push). */
  invertForward: boolean;
}>;

/** Camera fly input. move = [right, forward, up] (−1..1, fraction of the fly
 *  speed); look = [yaw (+right), pitch (+up)]. */
export type SpaceMouseFlyInput = Readonly<{
  move: Vec3;
  look: readonly [number, number];
}>;

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** Raw count at full deflection — 3Dconnexion devices report about ±350. */
const RAW_FULL_SCALE = 350;
const REPORT_TRANSLATE = 1;
const REPORT_ROTATE = 2;
const REPORT_BUTTONS = 3;
const AXIS_BYTES = 6;
const MAX_DEADZONE = 0.9;

export const ZERO_AXES: SpaceMouseAxes = { t: [0, 0, 0], r: [0, 0, 0] };
export const ZERO_FLY_INPUT: SpaceMouseFlyInput = { move: [0, 0, 0], look: [0, 0] };

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

function readAxis(data: DataView, offset: number): number {
  return Math.max(-1, Math.min(1, data.getInt16(offset, true) / RAW_FULL_SCALE));
}

function readVec(data: DataView, offset: number): Vec3 {
  return [readAxis(data, offset), readAxis(data, offset + 2), readAxis(data, offset + 4)];
}

function applyDeadzone(v: number, deadzone: number): number {
  const dz = Math.max(0, Math.min(MAX_DEADZONE, deadzone));
  const a = Math.abs(v);
  if (a <= dz) {
    return 0;
  }

  return (Math.sign(v) * (a - dz)) / (1 - dz);
}

// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------

/**
 * Decodes one SpaceMouse input report. Older devices send translation (id 1)
 * and rotation (id 2) as separate 6-byte reports; newer ones (SpaceMouse
 * Wireless/Pro/Compact) send both in a 12-byte report 1. Report 3 is the
 * button bitmask (bit 0 = left, bit 1 = right). The report id is not part of
 * `data` (WebHID strips it).
 */
export function parseReport(reportId: number, data: DataView): SpaceMouseReport {
  if (reportId === REPORT_TRANSLATE && data.byteLength >= AXIS_BYTES * 2) {
    return { kind: 'motion', t: readVec(data, 0), r: readVec(data, AXIS_BYTES) };
  }
  if (reportId === REPORT_TRANSLATE && data.byteLength >= AXIS_BYTES) {
    return { kind: 'translate', t: readVec(data, 0) };
  }
  if (reportId === REPORT_ROTATE && data.byteLength >= AXIS_BYTES) {
    return { kind: 'rotate', r: readVec(data, 0) };
  }
  if (reportId === REPORT_BUTTONS && data.byteLength >= 1) {
    let mask = 0;
    for (let i = 0; i < Math.min(4, data.byteLength); i++) {
      mask |= data.getUint8(i) << (8 * i);
    }
    return { kind: 'buttons', mask: mask >>> 0 };
  }

  return { kind: 'ignored' };
}

/** Folds a decoded report into the latest axis state (buttons leave it as is). */
export function mergeAxes(prev: SpaceMouseAxes, report: SpaceMouseReport): SpaceMouseAxes {
  switch (report.kind) {
    case 'motion':
      return { t: report.t, r: report.r };
    case 'translate':
      return { t: report.t, r: prev.r };
    case 'rotate':
      return { t: prev.t, r: report.r };
    default:
      return prev;
  }
}

/**
 * Raw device axes → camera fly input (the SpaceMouse "camera mode": you steer
 * the eye, not the model). Push forward = fly forward, push sideways = strafe,
 * lift = rise, twist right = turn right, tilt back = look up. Deadzone first,
 * then the optional dominant-axis filter, then the look sensitivity.
 */
export function shapeFlyInput(axes: SpaceMouseAxes, s: SpaceMouseShaping): SpaceMouseFlyInput {
  const t = axes.t.map((v) => applyDeadzone(v, s.deadzone));
  const r = axes.r.map((v) => applyDeadzone(v, s.deadzone));
  const values = [t[0], t[1], -t[2], r[2], r[0]];
  if (s.dominant) {
    let best = 0;
    for (let i = 1; i < values.length; i++) {
      if (Math.abs(values[i]) > Math.abs(values[best])) {
        best = i;
      }
    }
    for (let i = 0; i < values.length; i++) {
      values[i] = i === best ? values[i] : 0;
    }
  }
  const [right, forward, up, yaw, pitch] = values;

  return {
    move: [right, s.invertForward ? -forward : forward, up],
    look: [yaw * s.lookSens * (s.invertYaw ? -1 : 1), pitch * s.lookSens * (s.invertPitch ? -1 : 1)],
  };
}

/** True when the shaped input would move the camera at all. */
export function isFlyInputActive(input: SpaceMouseFlyInput): boolean {
  return input.move.some((v) => v !== 0) || input.look.some((v) => v !== 0);
}
