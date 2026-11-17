import { describe, expect, it } from 'vitest';
import {
  distanceToTriangle,
  isTransparentItem,
  type MeasureSnap,
  seamProbe,
  type SnapHit,
} from '../src/lib/render/measureSnap';

type V3 = [number, number, number];

// Camera looking straight down (-z); 100 px per metre, world (0,0) at pixel (500,500).
const worldToPixel = (p: V3): [number, number] => [500 + p[0] * 100, 500 - p[1] * 100];
const footprint = () => 0.01;
const snap: MeasureSnap = { enabled: true, corner: true, edge: true, seam: true, cornerPx: 12, edgePx: 8 };
// the sight line through pixel (500, 500) — its centre is world (0.005, -0.005)
const ray = { origin: [0.005, -0.005, 1] as V3, dir: [0, 0, -1] as V3 };

const hit = (A: V3, B: V3, C: V3, t: number, item: number): SnapHit => ({ t, u: 0.2, v: 0.2, A, B, C, item, flags: 0, color: 0 });
// the floor z = 0, hit right under the cursor
const floor = hit([-10, -10, 0], [10, -10, 0], [0, 10, 0], 1, 1);

describe('seamProbe', () => {
  it('snaps onto the intersection line of a wall standing through the floor', () => {
    const wall = hit([0, -1, -1], [0, 1, -1], [0, 0, 1], 1.2, 2);
    const r = seamProbe(floor, wall, ray, 500, 500, snap, worldToPixel, footprint);
    expect(r?.kind).toBe('edge');
    expect(r?.point.map((v) => +v.toFixed(6))).toEqual([0, -0.005, 0]);
    expect(Math.abs(r?.edgeDir?.[1] ?? 0)).toBeCloseTo(1, 6);
    expect(r?.normal).toEqual([0, 0, 1]); // faces the camera looking down
  });

  it('snaps onto the corner where the seam meets a wall edge', () => {
    const wall = hit([0, 0.02, -1], [0, 0.02, 1], [0, -2, -1], 1.2, 2);
    const r = seamProbe(floor, wall, ray, 500, 500, snap, worldToPixel, footprint);
    expect(r?.kind).toBe('corner');
    expect(r?.point.map((v) => +v.toFixed(6))).toEqual([0, 0.02, 0]);
  });

  it('rejects parallel surfaces and a surface merely hidden below the floor', () => {
    const lowerFloor = hit([-10, -10, -0.3], [10, -10, -0.3], [0, 10, -0.3], 1.3, 2);
    expect(seamProbe(floor, lowerFloor, ray, 500, 500, snap, worldToPixel, footprint)).toBeNull();
    const buriedWall = hit([0, -1, -2], [0, 1, -2], [0, 0, -0.5], 1.2, 2);
    expect(seamProbe(floor, buriedWall, ray, 500, 500, snap, worldToPixel, footprint)).toBeNull();
  });

  it('honours the corner / edge switches', () => {
    const wall = hit([0, 0.02, -1], [0, 0.02, 1], [0, -2, -1], 1.2, 2);
    const noCorner = seamProbe(floor, wall, ray, 500, 500, { ...snap, corner: false }, worldToPixel, footprint);
    expect(noCorner?.kind).toBe('edge');
    const none = seamProbe(floor, wall, ray, 500, 500, { ...snap, corner: false, edge: false }, worldToPixel, footprint);
    expect(none).toBeNull();
  });
});

describe('snap helpers', () => {
  it('distanceToTriangle covers inside, edges and vertices', () => {
    const A: V3 = [0, 0, 0];
    const B: V3 = [1, 0, 0];
    const C: V3 = [0, 1, 0];
    expect(distanceToTriangle([0.2, 0.2, 0.5], A, B, C)).toBeCloseTo(0.5, 9);
    expect(distanceToTriangle([0.5, -1, 0], A, B, C)).toBeCloseTo(1, 9);
    expect(distanceToTriangle([-1, -1, 0], A, B, C)).toBeCloseTo(Math.SQRT2, 9);
  });

  it('isTransparentItem mirrors the shader rule', () => {
    expect(isTransparentItem(0, 0)).toBe(false);
    expect(isTransparentItem(64 | (40 << 25), 0)).toBe(true); // explicit 40 %
    expect(isTransparentItem(64 | (100 << 25), 0)).toBe(false);
    expect(isTransparentItem(16, 0x80ff0000)).toBe(true); // colour override, alpha 128
    expect(isTransparentItem(16, 0xffff0000)).toBe(false);
  });
});
