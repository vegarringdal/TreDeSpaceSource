// Camera-relative rendering: the GPU is handed the world rebased on a
// per-frame origin near the camera. These pin the two properties that make it
// worth doing — the matrix stays correct, and the numbers stay small enough to
// survive f32 (an absolute coordinate 10 km out resolves to only ~1 mm, which
// speckles distant geometry through z-fighting AND through the derivative
// face normal flat shading takes).
import { describe, expect, it } from 'vitest';
import { CameraController } from '../src/lib/render/camera';

const ASPECT = 16 / 9;
/** A plant 12.6 km from the world origin — the case that shows the artifacts. */
const FAR_TARGET: [number, number, number] = [-8693.976, 8997.814, 15.088];

function farCamera(): CameraController {
  const cam = new CameraController();
  cam.target.set(FAR_TARGET);
  cam.orbitDistance = 40;
  cam.azimuth = 0.6;
  cam.elevation = 0.5;
  return cam;
}

/** clip = m * [p, 1] for a column-major mat4. */
function project(m: Float32Array, p: readonly number[]): number[] {
  const out = [0, 0, 0, 0];
  for (let r = 0; r < 4; r++) {
    out[r] = m[0 + r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r];
  }
  return out;
}

describe('camera-relative view-projection', () => {
  it('keeps the translation column small instead of ~9 km', () => {
    const cam = farCamera();
    const eye = cam.eye();
    const origin: [number, number, number] = [Math.round(eye[0]), Math.round(eye[1]), Math.round(eye[2])];

    const abs = cam.viewProj(ASPECT);
    const rel = cam.viewProjRelative(ASPECT, origin);
    const translationMagnitude = (m: Float32Array) => Math.max(...[12, 13, 14].map((i) => Math.abs(m[i])));

    // the absolute matrix carries the whole world offset in its last column,
    // which is exactly what loses the low bits when it meets a big coordinate
    expect(translationMagnitude(abs)).toBeGreaterThan(1000);
    expect(translationMagnitude(rel)).toBeLessThan(100);
  });

  it('projects a rebased point exactly where the absolute matrix puts it', () => {
    const cam = farCamera();
    const eye = cam.eye();
    const origin: [number, number, number] = [Math.round(eye[0]), Math.round(eye[1]), Math.round(eye[2])];
    const abs = cam.viewProj(ASPECT);
    const rel = cam.viewProjRelative(ASPECT, origin);

    for (const offset of [
      [0, 0, 0],
      [5, -3, 2],
      [-12.5, 8.25, -4.75],
    ]) {
      const world = FAR_TARGET.map((v, i) => v + offset[i]);
      const relPoint = world.map((v, i) => v - origin[i]);
      const a = project(abs, world);
      const b = project(rel, relPoint);
      // same clip position (NDC), within the absolute path's own f32 slop
      for (let i = 0; i < 4; i++) {
        expect(b[i] / b[3]).toBeCloseTo(a[i] / a[3], 3);
      }
    }
  });

  it('rebasing before dequantizing recovers ~3 orders of magnitude of precision', () => {
    // Mirrors the vertex shader: world = aabb_min + q * aabb_scale, where
    // aabb_min is the ABSOLUTE f32 world coordinate the cook stored and q is
    // the u16. What matters is how far the COMPUTED vertex lands from where
    // that stored data says it should be — the position handed to the
    // transform, in metres. (The shader never reconstructs the absolute value
    // on the rebased path, so neither does this.)
    const f32 = Math.fround;
    const base = f32(FAR_TARGET[0]); // what the file holds
    const scale = f32(8 / 65535); // an 8 m meshlet quantized to u16
    const origin = Math.round(base);

    let worstAbsolute = 0;
    let worstRebased = 0;
    for (let q = 0; q <= 65535; q += 271) {
      const step = f32(q * scale);
      worstAbsolute = Math.max(worstAbsolute, Math.abs(f32(base + step) - (base + step)));
      // (aabb_min - origin) is an EXACT f32 subtraction (nearby magnitudes),
      // so the sum then happens in small-number space
      const rebased = f32(f32(base - origin) + step);
      worstRebased = Math.max(worstRebased, Math.abs(rebased - (base - origin + step)));
    }

    expect(worstAbsolute).toBeGreaterThan(2e-4); // ~mm — enough to z-fight
    expect(worstRebased).toBeLessThan(1e-6); // sub-micron
  });
});

describe('near plane', () => {
  it('tracks the view distance, not the scene size', () => {
    const cam = new CameraController();
    // a big scene: one model at the origin, one 12.6 km out
    cam.fit([-1, -1, -1], [-8694 + 1, 8998 + 1, 30]);
    const framedNear = cam.near;

    // flying in close must give a close near plane — the old rule pinned it to
    // the scene radius, so anything within ~1.3 m of the camera was clipped
    cam.orbitDistance = 2;
    expect(cam.near).toBeLessThan(0.001 * 2); // sub-millimetre at 2 m out
    expect(cam.near).toBeLessThan(framedNear / 1000);
  });

  it('never goes below the floor, however close the camera gets', () => {
    const cam = new CameraController();
    cam.orbitDistance = 0;
    expect(cam.near).toBe(0.001);
    cam.orbitDistance = 1e-9;
    expect(cam.near).toBe(0.001);
  });

  it('does not go stale when a big model is unloaded and a small one fitted', () => {
    const cam = new CameraController();
    cam.fit([0, 0, 0], [-8694, 8998, 30]); // huge scene
    const big = cam.near;
    cam.fit([0, 0, 0], [2, 2, 3]); // that model unloaded, a small one framed
    expect(cam.near).toBeLessThan(big / 100);
  });
});
