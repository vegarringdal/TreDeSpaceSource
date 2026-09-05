import { describe, expect, it } from 'vitest';
import {
  collectSpheres,
  concatLines,
  hexAbgr,
  hexRgb01,
  MarkerCache,
  sphereInstances,
  sphereLineVerts,
} from '../src/components/panels/viewport/markerLines';
import type { SceneLabel } from '../src/state/viewer/labels.state';
import type { Measurement } from '../src/state/viewer/measurements.state';
import { readSphereMarker } from '../src/state/viewer/sphereMarker';

const label = (patch: Partial<SceneLabel> = {}): SceneLabel => ({
  id: 1,
  text: 'a',
  fullname: null,
  anchor: [1, 2, 3],
  offset: [0, 0],
  selected: false,
  bg: '#fff',
  opacity: 1,
  textColor: '#000',
  sphere: { size: 0.5, color: '#ef4444', solid: false, opacity: 1 },
  ...patch,
});

const measurement = (patch: Partial<Measurement> = {}): Measurement => ({
  id: 1,
  kind: 'line',
  points: [{ pos: [0, 0, 0] }, { pos: [1, 0, 0] }],
  label: '',
  visible: true,
  showLabel: true,
  showPerp: false,
  axisLegs: [false, false, false],
  axisLabels: [false, false, false],
  legsInLabel: false,
  slopeInLabel: false,
  sphere: { size: 0.1, color: '#3b82f6', solid: false, opacity: 1 },
  ...patch,
});

describe('sphere markers', () => {
  it('packs colours the way the clip helper does', () => {
    expect(hexAbgr('#ef4444')).toBe(0xff4444ef);
    expect(hexAbgr('#3b82f6')).toBe(0xfff6823b);
    expect(hexAbgr('nope')).toBe(0xffffffff);
  });

  it('sanitizes marker input', () => {
    expect(readSphereMarker(undefined)).toBeNull();
    expect(readSphereMarker(false)).toBeNull();
    expect(readSphereMarker(true)).toEqual({ size: 0.1, color: '#ff8800', solid: false, opacity: 0.6 });
    expect(readSphereMarker({ size: -1, color: 'red', opacity: 7 })).toEqual({
      size: 0.1,
      color: '#ff8800',
      solid: false,
      opacity: 0.6,
    });
    expect(readSphereMarker({ size: 0.3, color: '#00FF00', solid: true, opacity: 1 })).toEqual({
      size: 0.3,
      color: '#00FF00',
      solid: true,
      opacity: 1,
    });
    expect(hexRgb01('#ff8800')).toEqual([1, 136 / 255, 0]);
  });

  it('collects one sphere per label anchor and per measurement point, skipping hidden ones', () => {
    const spheres = collectSpheres(
      [label(), label({ id: 2, muted: true }), label({ id: 3, sphere: null })],
      false,
      [measurement(), measurement({ id: 2, visible: false })],
      false,
    );
    expect(spheres.map((s) => s.center)).toEqual([
      [1, 2, 3],
      [0, 0, 0],
      [1, 0, 0],
    ]);
    expect(collectSpheres([label()], true, [measurement()], true)).toEqual([]);
  });

  it('emits three rings of chords per sphere with the colour bits in slot 4', () => {
    const verts = sphereLineVerts([{ center: [0, 0, 0], radius: 2, color: 0xff4444ef }]);
    expect(verts.length).toBe(3 * 24 * 2 * 4);
    expect(new Uint32Array(verts.buffer)[3]).toBe(0xff4444ef);
    expect(verts[0]).toBeCloseTo(2); // first xy chord starts at (r, 0, 0)
    expect(concatLines(new Float32Array([1]), verts).length).toBe(verts.length + 1);
  });

  it('packs solid spheres as instances, opaque ones first', () => {
    const solid = (opacity: number, x: number) =>
      label({ id: x, anchor: [x, 0, 0], sphere: { size: 0.2, color: '#ff8800', solid: true, opacity } });
    const spheres = collectSpheres([solid(0.5, 1), solid(1, 2), label({ id: 3 })], false, [], false);
    const wire = spheres.filter((s) => !s.solid);
    expect(wire.map((s) => s.center[0])).toEqual([1]);
    const { data, opaqueCount } = sphereInstances(spheres.filter((s) => s.solid));
    expect(opaqueCount).toBe(1);
    expect(data.length).toBe(16);
    expect(data[0]).toBe(2); // the opaque one leads
    expect(data[7]).toBe(1);
    expect(data[8]).toBe(1);
    expect(data[15]).toBe(0.5);
  });

  it('bumps its version only when the vertices really change', () => {
    const cache = new MarkerCache();
    const labels = [label()];
    cache.update(labels, false, [], false);
    expect(cache.version).toBe(1);
    cache.update([label()], false, [], false); // new array, same spheres
    expect(cache.version).toBe(1);
    cache.update([label({ anchor: [9, 9, 9] })], false, [], false);
    expect(cache.version).toBe(2);
    cache.update([], false, [], false);
    expect(cache.version).toBe(3);
    expect(cache.lines.length).toBe(0);
  });
});
