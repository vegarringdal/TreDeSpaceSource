import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../src/lib/render/axisGizmo';
import { type GizmoSnapInput, gizmoSnapTarget } from '../src/lib/render/gizmoSnap';

const BASE: GizmoSnapInput = {
  kind: 'face',
  direction: [0, -1, 0],
  isShift: false,
  ballClick: 'viewFrom',
  topViewHeading: 'keep',
  northAngle: 0,
  azimuth: 0.6,
  forward: [0.6, 0.7, -0.4],
};

const snap = (patch: Partial<GizmoSnapInput>) => gizmoSnapTarget({ ...BASE, ...patch });

/** The look direction (camera → target) a target gives, as camera.forward() computes it. */
function forwardOf(t: { azimuth: number; elevation: number }): Vec3 {
  const ce = Math.cos(t.elevation);
  return [ce * Math.cos(t.azimuth), ce * Math.sin(t.azimuth), Math.sin(t.elevation)];
}

describe('gizmoSnapTarget', () => {
  it('puts the camera on the clicked face, looking back at the pivot', () => {
    const t = snap({ direction: [0, -1, 0] });
    expect(t.azimuth).toBeCloseTo(Math.PI / 2, 9);
    expect(t.elevation).toBeCloseTo(0, 9);
  });

  it('takes the opposite view with Shift', () => {
    const t = snap({ direction: [0, -1, 0], isShift: true });
    expect(t.azimuth).toBeCloseTo(-Math.PI / 2, 9);
  });

  it('keeps the heading for a top view by default (the camera only tilts)', () => {
    const t = snap({ direction: [0, 0, 1] });
    expect(t.azimuth).toBe(BASE.azimuth);
    expect(t.elevation).toBeCloseTo(-Math.PI / 2, 9);
  });

  it('turns +Y or true north to the top of the screen when asked', () => {
    expect(snap({ direction: [0, 0, 1], topViewHeading: 'model' }).azimuth).toBeCloseTo(Math.PI / 2, 9);
    // north 90° = east: looking down with +X up the screen
    expect(snap({ direction: [0, 0, 1], topViewHeading: 'north', northAngle: 90 }).azimuth).toBeCloseTo(0, 9);
    // from below, the heading reverses so the view is not mirrored
    expect(snap({ direction: [0, 0, -1], topViewHeading: 'model' }).azimuth).toBeCloseTo(-Math.PI / 2, 9);
  });

  it('views from a ball, or looks toward it, per the setting', () => {
    const from = snap({ kind: 'ball', direction: [0, 1, 0] });
    expect(from.azimuth).toBeCloseTo(-Math.PI / 2, 9);
    const toward = snap({ kind: 'ball', direction: [0, 1, 0], ballClick: 'lookToward' });
    expect(toward.azimuth).toBeCloseTo(Math.PI / 2, 9);
  });

  it('flips to the opposite when the camera already looks from that ball', () => {
    const t = snap({ kind: 'ball', direction: [0, 1, 0], forward: [0, -1, 0] });
    expect(t.azimuth).toBeCloseTo(Math.PI / 2, 9);
  });

  it('snaps to an iso dot from above', () => {
    const k = 1 / Math.sqrt(3);
    const t = snap({ kind: 'snap', direction: [k, -k, k] });
    const f = forwardOf(t);
    expect(f[0]).toBeCloseTo(-k, 9);
    expect(f[1]).toBeCloseTo(k, 9);
    expect(f[2]).toBeCloseTo(-k, 9);
  });
});
