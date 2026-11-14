// Scan look-around (laser-scan panorama view): the camera eye stays pinned at
// the scanner position whatever animates, and leaving restores the zoom.
import { describe, expect, it } from 'vitest';
import { CameraController } from '../src/lib/render/camera';

const near = (a: readonly number[], b: readonly number[], eps = 1e-6) =>
  a.every((v, i) => Math.abs(v - b[i]) < eps);

describe('camera scan mode', () => {
  it('pins the eye at the setup and keeps it through view snaps', () => {
    const cam = new CameraController();
    cam.setPose([0, 0, 0], 0.3, 0.1, 25);
    const fov = cam.fovY;
    cam.enterScan([10, 20, 1.6]);
    expect(near(cam.eye(), [10, 20, 1.6])).toBe(true);
    cam.setView(Math.PI / 2, -0.2);
    cam.update(0.016);
    expect(near(cam.eye(), [10, 20, 1.6])).toBe(true);
    expect(cam.forward()[1]).toBeGreaterThan(0.9); // turned to look along +Y
    // a goto animation in flight (wall-clock driven) may turn the view only
    cam.snapView(0, 0.3, 0.05);
    cam.update(0.016);
    expect(near(cam.eye(), [10, 20, 1.6])).toBe(true);
    cam.exitScan();
    expect(cam.scanEye).toBeNull();
    expect(cam.fovY).toBe(fov);
  });
});
