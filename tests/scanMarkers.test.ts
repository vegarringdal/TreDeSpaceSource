// Laser-scan setup markers: instance packing, CPU picking and the splice into
// the renderer's opaque-first marker-sphere list.
import { describe, expect, it } from 'vitest';
import { MARKER_INSTANCE_FLOATS as N } from '../src/lib/render/markerInstance';
import {
  markerInFront,
  mergeMarkerInstances,
  pickScanMarker,
  SCAN_MARKER_RADIUS,
  type ScanMarker,
  scanMarkerInstances,
} from '../src/state/scans/scanMarkers';

const MARKERS: ScanMarker[] = [
  { key: 'a:0', center: [10, 0, 1.6], selected: false },
  { key: 'a:1', center: [20, 0, 1.6], selected: true },
  { key: 'a:2', center: [0, 15, 1.6], selected: false },
];

/** Two label-style spheres, the first opaque and the second see-through. */
function twoSpheres(): Float32Array {
  const base = new Float32Array(2 * N).fill(1, 0, N).fill(2, N);
  base[N + 7] = 0.5;
  return base;
}

describe('scan markers', () => {
  it('packs one opaque sphere per setup, the selected one highlighted', () => {
    const d = scanMarkerInstances(MARKERS);
    expect(d.length).toBe(3 * N);
    expect([d[0], d[1], d[2], d[3]]).toEqual([10, 0, 1.6, SCAN_MARKER_RADIUS].map(Math.fround));
    expect(d[7]).toBe(1);
    expect(d[N + 4]).not.toBe(d[4]); // selected colour differs
  });

  it('keeps a setup in national-grid coordinates where it is, not where float32 rounds it', () => {
    // a northing of millions of metres: float32 steps are 0.5 m there
    const center = [6_600_123.337, 512_345.678, 12.345] as const;
    const d = scanMarkerInstances([{ key: 'a:0', center, selected: false }]);
    for (let axis = 0; axis < 3; axis++) {
      expect(Math.abs(d[axis] - center[axis])).toBeLessThanOrEqual(0.25);
      // the float32 part plus its remainder is the true coordinate again
      expect(d[axis] + d[8 + axis]).toBeCloseTo(center[axis], 3);
    }
    expect(Math.abs(d[0] - center[0])).toBeGreaterThan(0.05); // float32 alone is visibly off
  });

  it('picks the nearest marker along the ray, never one behind it', () => {
    const ray = { origin: [0, 0, 1.6] as const, dir: [1, 0, 0] as const };
    expect(pickScanMarker(ray, MARKERS)).toEqual({ key: 'a:0', t: 10 });
    expect(pickScanMarker({ origin: [15, 0, 1.6], dir: [1, 0, 0] }, MARKERS)?.key).toBe('a:1');
    expect(pickScanMarker({ origin: [0, 0, 1.6], dir: [-1, 0, 0] }, MARKERS)).toBeNull();
    expect(pickScanMarker({ origin: [0, 0, 5], dir: [1, 0, 0] }, MARKERS)).toBeNull();
  });

  it('lets a surface in front of a marker hide it from the pick', () => {
    const ray = { origin: [0, 0, 1.6] as const, dir: [1, 0, 0] as const };
    const hit = pickScanMarker(ray, MARKERS);
    if (!hit) {
      throw new Error('no marker picked');
    }
    expect(markerInFront(ray, hit, null)).toBe(true); // background
    expect(markerInFront(ray, hit, [10 - SCAN_MARKER_RADIUS, 0, 1.6])).toBe(true); // the sphere itself
    expect(markerInFront(ray, hit, [30, 0, 1.6])).toBe(true); // see-through marker, wall behind
    expect(markerInFront(ray, hit, [5, 0, 1.6])).toBe(false); // wall in front
  });

  it('splices scan markers after the opaque block', () => {
    const base = twoSpheres();
    const scans = scanMarkerInstances(MARKERS.slice(0, 1));
    const m = mergeMarkerInstances(base, 1, scans);
    expect(m.opaqueCount).toBe(2);
    expect(Array.from(m.data.slice(0, N))).toEqual(Array.from(base.slice(0, N)));
    expect(Array.from(m.data.slice(N, 2 * N))).toEqual(Array.from(scans));
    expect(Array.from(m.data.slice(2 * N))).toEqual(Array.from(base.slice(N)));
    expect(mergeMarkerInstances(base, 1, new Float32Array(0)).data).toBe(base);
  });

  it('appends see-through scan markers to the blended block', () => {
    const base = twoSpheres();
    const scans = scanMarkerInstances(MARKERS.slice(0, 1), 0.3);
    expect(scans[7]).toBe(Math.fround(0.3));
    const m = mergeMarkerInstances(base, 1, scans, false);
    expect(m.opaqueCount).toBe(1);
    expect(Array.from(m.data.slice(0, 2 * N))).toEqual(Array.from(base));
    expect(Array.from(m.data.slice(2 * N))).toEqual(Array.from(scans));
  });
});
