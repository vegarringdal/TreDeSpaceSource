// Arrow keys pan the camera the way the arrow points (screen space): ArrowRight
// moves the view right, ArrowUp moves it up.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CameraController } from '../src/lib/render/camera';

const win = new EventTarget();

function key(type: 'keydown' | 'keyup', k: string): void {
  win.dispatchEvent(Object.assign(new Event(type), { key: k }));
}

function tap(cam: CameraController, k: string): void {
  key('keydown', k);
  cam.update(0.016);
  key('keyup', k);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('camera arrow-key pan', () => {
  it('moves right on ArrowRight and up on ArrowUp', () => {
    vi.stubGlobal('window', win);
    // only addEventListener + style are touched by attach(); a DOM-less stand-in
    const canvas = Object.assign(new EventTarget(), { style: { touchAction: '' } });
    const cam = new CameraController();
    cam.attach(canvas as unknown as HTMLCanvasElement, () => undefined);
    cam.setPose([0, 0, 0], 0, 0, 10); // looking along +X: screen-right is −Y, up is +Z
    tap(cam, 'ArrowRight');
    expect(cam.target[1]).toBeLessThan(0);
    tap(cam, 'ArrowUp');
    expect(cam.target[2]).toBeGreaterThan(0);
  });
});
