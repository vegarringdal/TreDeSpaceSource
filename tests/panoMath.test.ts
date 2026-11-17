// Scan photo math (lib/render/panoMath.ts): the cube-face numbering the
// shader and the .tdpp format share, which faces a view touches, the texture
// resolution a zoom level asks for, and the spherical-image span with its
// bad-metadata fallback. Plus the sphere metadata the .tdpp reader parses.
import { describe, expect, it } from 'vitest';
import { cubeFaceOf, facePxNeeded, facesInView, sphereSpan, worldToPhotoRows } from '../src/lib/render/panoMath';
import { parseMeta } from '../src/lib/tdpp/tdppFormat';

const IDENTITY = [1, 0, 0, 0] as const;

describe('cube faces', () => {
  it('numbers faces +Y, −Y, −X, +X, +Z, −Z', () => {
    expect(cubeFaceOf([0, 1, 0])).toBe(0);
    expect(cubeFaceOf([0, -1, 0])).toBe(1);
    expect(cubeFaceOf([-1, 0, 0])).toBe(2);
    expect(cubeFaceOf([1, 0, 0])).toBe(3);
    expect(cubeFaceOf([0, 0, 1])).toBe(4);
    expect(cubeFaceOf([0, 0, -1])).toBe(5);
    expect(cubeFaceOf([0.2, 0.9, -0.3])).toBe(0);
  });

  it('finds one face for a narrow view at its centre and more toward a corner', () => {
    const narrow = Math.tan((15 * Math.PI) / 360);
    expect([...facesInView([0, 1, 0], narrow, narrow, IDENTITY)]).toEqual([0]);
    const corner = facesInView([Math.SQRT1_2, Math.SQRT1_2, 0], narrow, narrow, IDENTITY);
    expect(corner.has(0) && corner.has(3)).toBe(true);
    expect(facesInView([0.577, 0.577, 0.577], 0.6, 0.6, IDENTITY).size).toBe(3);
  });

  it('rotates the view into the photo frame (90° about Z: world +X is the photo −Y)', () => {
    const q = [Math.SQRT1_2, 0, 0, Math.SQRT1_2] as const;
    const rows = worldToPhotoRows(q);
    const d = rows.map((r) => r[0]);
    expect(d[0]).toBeCloseTo(0);
    expect(d[1]).toBeCloseTo(-1);
    expect([...facesInView([1, 0, 0], 0.05, 0.05, q)]).toEqual([1]);
  });

  it('asks for more texture as the view narrows', () => {
    expect(facePxNeeded(1080, Math.PI / 2)).toBeCloseTo(1080);
    expect(facePxNeeded(1080, Math.PI / 12)).toBeCloseTo(6480);
  });
});

describe('spherical photo', () => {
  it('uses plausible pixel sizes as they are', () => {
    const pw = (2 * Math.PI) / 8192;
    const [az, el] = sphereSpan(pw, pw, 8192, 3000);
    expect(az).toBeCloseTo(2 * Math.PI);
    expect(el).toBeCloseTo(pw * 3000);
  });

  it('treats nonsense pixel sizes as a full 360° panorama with square pixels', () => {
    expect(sphereSpan(5e-6, 5e-6, 8192, 4096)).toEqual([2 * Math.PI, Math.PI]);
    const [az, el] = sphereSpan(1, 1, 8000, 2000);
    expect(az).toBeCloseTo(2 * Math.PI);
    expect(el).toBeCloseTo(Math.PI / 2);
  });

  it('is read from the .tdpp metadata next to cube photos', () => {
    const meta = {
      format: 'tdpp',
      setups: [
        {
          index: 0,
          name: 'S1',
          pose: { rotation: [1, 0, 0, 0], translation: [1, 2, 3] },
          panorama: {
            kind: 'sphere',
            rotation: [0, 0, 0, 1],
            pixel_width: 0.001,
            pixel_height: 0.001,
            levels: [{ width: 6283, height: 3000, format: 'jpg', offset: 128, size: 9 }],
          },
        },
        { index: 1, name: 'S2', pose: {}, panorama: { kind: 'sphere', levels: [] } },
      ],
    };
    const parsed = parseMeta(new TextEncoder().encode(JSON.stringify(meta)));
    const [s1, s2] = parsed.data?.setups ?? [];
    expect(s1.faces).toBeNull();
    expect(s1.sphere?.rotation).toEqual([0, 0, 0, 1]);
    expect(s1.sphere?.levels[0]).toEqual({ width: 6283, height: 3000, format: 'jpg', offset: 128, size: 9 });
    expect(s2.sphere).toBeNull(); // no image, no pixel size
  });
});
