// SpaceMouse: HID report decoding, fly-input shaping, and the camera's
// response (push = fly forward, twist = turn) in fly mode.
import { describe, expect, it } from 'vitest';
import { CameraController } from '../src/lib/render/camera';
import {
  mergeAxes,
  parseReport,
  type SpaceMouseShaping,
  shapeFlyInput,
  ZERO_AXES,
} from '../src/lib/spacemouse/spaceMouseInput';

const SHAPING: SpaceMouseShaping = {
  deadzone: 0,
  dominant: false,
  lookSens: 1,
  invertPitch: false,
  invertYaw: false,
  invertForward: false,
};

function view(values: readonly number[], bytes = values.length * 2): DataView {
  const v = new DataView(new ArrayBuffer(bytes));
  values.forEach((x, i) => v.setInt16(i * 2, x, true));
  return v;
}

describe('SpaceMouse reports', () => {
  it('decodes the combined 12-byte motion report', () => {
    const r = parseReport(1, view([350, -175, 0, 0, 0, 700]));
    expect(r).toEqual({ kind: 'motion', t: [1, -0.5, 0], r: [0, 0, 1] });
  });

  it('merges separate translation and rotation reports (older devices)', () => {
    const t = parseReport(1, view([0, 350, 0]));
    const r = parseReport(2, view([0, 0, -350]));
    expect(mergeAxes(mergeAxes(ZERO_AXES, t), r)).toEqual({ t: [0, 1, 0], r: [0, 0, -1] });
  });

  it('reads the button bitmask', () => {
    const v = new DataView(new ArrayBuffer(2));
    v.setUint8(0, 0b11);
    expect(parseReport(3, v)).toEqual({ kind: 'buttons', mask: 3 });
  });
});

describe('SpaceMouse shaping', () => {
  it('maps push/lift/twist/tilt to fly input', () => {
    const out = shapeFlyInput({ t: [0.5, 1, -1], r: [0.25, 0, 0.5] }, SHAPING);
    expect(out.move).toEqual([0.5, 1, 1]); // right, forward, up (cap lifted = −z)
    expect(out.look).toEqual([0.5, 0.25]); // yaw, pitch
  });

  it('flips push/pull with invertForward', () => {
    const out = shapeFlyInput({ t: [0, 1, 0], r: [0, 0, 0] }, { ...SHAPING, invertForward: true });
    expect(out.move[1]).toBe(-1);
  });

  it('applies the deadzone and the dominant-axis filter', () => {
    const out = shapeFlyInput({ t: [0.05, 0.6, 0], r: [0, 0, 0.3] }, { ...SHAPING, deadzone: 0.1, dominant: true });
    expect(out.move[0]).toBe(0);
    expect(out.move[1]).toBeCloseTo(0.5 / 0.9);
    expect(out.look).toEqual([0, 0]);
  });
});

describe('camera SpaceMouse input', () => {
  it('flies forward along the view and turns with the twist', () => {
    const cam = new CameraController();
    cam.navMode = 'fly';
    cam.setPose([0, 0, 0], 0, 0, 10); // looking along +X
    const x0 = cam.eye()[0];
    cam.spaceMove = [0, 1, 0];
    cam.update(0.016);
    expect(cam.eye()[0]).toBeGreaterThan(x0);
    cam.spaceMove = [0, 0, 0];
    cam.spaceLook = [1, 0];
    const az0 = cam.azimuth;
    for (let i = 0; i < 10; i++) {
      cam.update(0.016);
    }
    expect(cam.azimuth).toBeLessThan(az0); // twist right = turn right (azimuth decreases)
  });

  it('ignores movement in orbit mode and under the input lock', () => {
    const cam = new CameraController();
    cam.navMode = 'orbit';
    cam.setPose([0, 0, 0], 0, 0, 10);
    const eye = cam.eye();
    cam.spaceMove = [0, 1, 0];
    cam.update(0.016);
    expect(cam.eye()).toEqual(eye);
    cam.navMode = 'fly';
    cam.inputLocked = true;
    cam.spaceMove = [0, 1, 0];
    cam.update(0.016);
    expect(cam.eye()).toEqual(eye);
  });
});
