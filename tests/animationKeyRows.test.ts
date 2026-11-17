import { describe, expect, it } from 'vitest';
import { evaluateObject } from '../src/lib/animation/evaluate';
import { m4TransformPoint, poseMatrix, qAxisAngle } from '../src/lib/animation/interp';
import {
  copyKeys,
  instantAt,
  keyHere,
  keyPivotWorld,
  pasteKeys,
  rePivot,
  retimeKeys,
  slideInKeys,
  upsertKey,
} from '../src/lib/animation/keyRows';
import { choiceOf, keyPivotPoint, pivotResolver, pivotSpec, pivotThrough } from '../src/lib/animation/pivots';
import { advancePlayhead } from '../src/lib/animation/playhead';
import type { KeyPivot } from '../src/lib/animation/types';
import { sceneView } from '../src/lib/animation/scene';
import { key, object, scene } from './helpers/animDoc';

const times = (keys: readonly { t: number }[]) => keys.map((k) => k.t);

describe('key rows', () => {
  it('inserts in time order and replaces a key at the same time', () => {
    const keys = upsertKey(upsertKey([key(0), key(2)], key(1)), key(2, [5, 0, 0]));
    expect(times(keys)).toEqual([0, 1, 2]);
    expect(keys[2].move).toEqual([5, 0, 0]);
  });

  it('retimes a selection, never before 0, replacing keys it lands on', () => {
    const r = retimeKeys([key(0), key(1), key(2), key(3)], [1, 2], 1);
    expect(times(r.keys)).toEqual([0, 2, 3]);
    expect(r.indices).toEqual([1, 2]);
    expect(times(retimeKeys([key(1), key(2)], [0, 1], -5).keys)).toEqual([0, 1]);
  });

  it('copies keys from 0 and pastes them at a time', () => {
    const clip = copyKeys([key(1), key(2, [1, 0, 0]), key(4)], [1, 2]);
    expect(times(clip)).toEqual([0, 2]);
    expect(times(pasteKeys([key(0)], clip, 10))).toEqual([0, 10, 12]);
  });

  it('keys where the object stands and reads its instant values', () => {
    const o = object('o', [key(0, [0, 0, 0], { visible: false }), key(2, [2, 0, 0], { visible: true })]);
    expect(keyHere(o, 1, 'smooth').move).toEqual([1, 0, 0]);
    expect(instantAt(o, 1)).toEqual({ visible: false });
    expect(instantAt(o, 3)).toEqual({ visible: true });
  });

  it('slides in: hidden away until T, appears there, in place by T + duration', () => {
    const o = object('o', []);
    const keys = slideInKeys(o, 2, [0, 0, 1], 1.5, 2, 'smooth');
    expect(times(keys)).toEqual([0, 2, 4]);
    expect(keys[0]).toMatchObject({ move: [0, 0, 1.5], visible: false, interp: 'hold' });
    expect(keys[1]).toMatchObject({ move: [0, 0, 1.5], visible: true });
    expect(keys[2].move).toEqual([0, 0, 0]);
    const slid = { ...o, keys };
    const z = (T: number) => m4TransformPoint(evaluateObject(slid, T, [0, 0, 0]).pose ?? new Float32Array(16), [0, 0, 0])[2];
    expect(z(1)).toBeCloseTo(1.5);
    expect(z(3)).toBeGreaterThan(0);
    expect(z(3)).toBeLessThan(1.5);
    expect(z(5)).toBeCloseTo(0);
    // at 0 it is visible from the start (nothing to wait before)
    expect(slideInKeys(o, 0, [1, 0, 0], 1, 1, 'smooth')[0]).toMatchObject({ t: 0, visible: true });
  });
});

describe('playhead', () => {
  const v = sceneView(
    scene({
      objects: [object('o', [key(0), key(10)])],
      steps: [
        { id: 'a', name: 'A', text: '', start: 0, end: 4, pauseAtEnd: true },
        { id: 'b', name: 'B', text: '', start: 4, end: 8, pauseAtEnd: false },
      ],
    }),
  );
  const tick = (time: number, dt: number, extra: Partial<Parameters<typeof advancePlayhead>[0]> = {}) =>
    advancePlayhead({ time, dt, direction: 1, view: v, scope: { kind: 'all' }, loop: false, pingPong: false, ...extra });

  it('stops at the end of a step that pauses, and Continue goes on', () => {
    expect(tick(3.9, 0.5)).toMatchObject({ time: 4, stop: { kind: 'stepEnd', step: 'a' } });
    expect(tick(4, 0.5).stop.kind).toBe('none');
  });

  it('ends, loops or turns round at the end', () => {
    expect(tick(9.9, 0.5)).toMatchObject({ time: 10, stop: { kind: 'end' } });
    expect(tick(9.9, 0.5, { loop: true }).time).toBeCloseTo(0.4);
    const back = tick(9.9, 0.5, { pingPong: true });
    expect(back).toMatchObject({ direction: -1, looped: true });
    expect(back.time).toBeCloseTo(9.6);
    expect(tick(0.2, 0.5, { direction: -1 })).toMatchObject({ time: 0, stop: { kind: 'end' } });
    expect(tick(0.2, 0.5, { direction: -1, loop: true, pingPong: true }).direction).toBe(1);
  });

  it('plays one step and stops at its end', () => {
    expect(tick(7.9, 0.5, { scope: { kind: 'step', step: 'b' } })).toMatchObject({ time: 8, stop: { kind: 'end' } });
  });
});

describe("a key's pivot", () => {
  // a door 2 m wide, 1 m deep and high, centred on the origin; its hinge is
  // the middle of its right side (+X)
  const P: [number, number, number] = [0, 0, 0];
  const BOX = [-1, -0.5, -0.5, 1, 0.5, 0.5];
  const HINGE: [number, number, number] = [1, 0, 0];
  const r6 = (v: readonly number[]) => v.map((x) => Math.round(x * 1e6) / 1e6 + 0);
  const turned = qAxisAngle([0, 0, 1], 90);
  const door = (pivot?: KeyPivot) =>
    object('door', [key(0), key(1, [0, 0, 0], { rotate: turned, ...(pivot ? { pivot } : {}) })]);
  const pointAt = (o: ReturnType<typeof door>, t: number, x: [number, number, number]) =>
    r6(m4TransformPoint(evaluateObject(o, t, P, BOX).pose, x));

  it('Move and Rotate are about it: turned on its right side, the hinge stays put all the way', () => {
    for (const t of [0.25, 0.5, 1]) {
      expect(pointAt(door({ at: 'right' }), t, HINGE)).toEqual([1, 0, 0]);
    }
    expect(pointAt(door({ at: 'right' }), 1, [-1, 0, 0])).toEqual([1, -2, 0]);
    expect(pointAt(door(), 1, HINGE)).toEqual([0, 1, 0]);
  });

  it('resolves the sides of the box, a point and an offset', () => {
    const at = (spec: KeyPivot) => r6(keyPivotPoint(spec, BOX, P));
    expect(at({ at: 'center' })).toEqual([0, 0, 0]);
    expect(at({ at: 'bottom' })).toEqual([0, 0, -0.5]);
    expect(at({ at: 'top' })).toEqual([0, 0, 0.5]);
    expect(at({ at: 'front' })).toEqual([0, -0.5, 0]);
    expect(at({ at: 'back' })).toEqual([0, 0.5, 0]);
    expect(at({ at: 'left' })).toEqual([-1, 0, 0]);
    expect(at({ at: 'right', offset: [0, 0.1, 0.2] })).toEqual([1, 0.1, 0.2]);
    expect(at({ at: [3, 4, 5] })).toEqual([3, 4, 5]);
    expect(r6(keyPivotPoint(undefined, BOX, [7, 8, 9]))).toEqual([7, 8, 9]);
  });

  it('an inserted key carries the pivot of the key after it; a new pivot keeps the pose', () => {
    const o = door({ at: 'right' });
    const pivotOf = pivotResolver(BOX, P);
    const mid = keyHere(o, 0.5, 'linear', pivotOf);
    expect(mid.pivot).toEqual({ at: 'right' });
    expect(r6(m4TransformPoint(poseMatrix(mid, pivotOf(mid)), HINGE))).toEqual([1, 0, 0]);
    const k = o.keys[1];
    const moved = { ...k, ...rePivot(k, pivotOf(k), [0, 0, 0]) };
    expect(r6(m4TransformPoint(poseMatrix(moved, [0, 0, 0]), [-1, 0, 0]))).toEqual([1, -2, 0]);
    expect(r6(keyPivotWorld(k, pivotOf))).toEqual([1, 0, 0]);
  });

  it('the Key panel choice becomes a pivot: sides, offsets; a point reads as the Centre plus the offset to it', () => {
    const none: [number, number, number] = [0, 0, 0];
    expect(pivotSpec({ at: 'object', offset: none }, 'center')).toBeUndefined();
    expect(pivotSpec({ at: 'object', offset: [0, 0, 1] }, 'bottom')).toEqual({ at: 'bottom', offset: [0, 0, 1] });
    expect(pivotSpec({ at: 'top', offset: none }, 'center')).toEqual({ at: 'top' });
    expect(pivotSpec({ at: 'point', offset: [0, 0, 1] }, 'center', { at: [1, 2, 3] })).toEqual({
      at: [1, 2, 3],
      offset: [0, 0, 1],
    });
    expect(pivotSpec({ at: 'point', offset: none }, 'center', { at: 'left' })).toEqual({ at: 'left' });
    expect(choiceOf({ at: [1, 0.25, 0], offset: [0, 0, 0.5] }, BOX)).toEqual({ at: 'center', offset: [1, 0.25, 0.5] });
    expect(choiceOf({ at: [1, 2, 3] })).toEqual({ at: 'point', offset: [0, 0, 0] });
    expect(choiceOf({ at: 'bottom', offset: [0, 0.7, 0.4] }, BOX)).toEqual({ at: 'bottom', offset: [0, 0.7, 0.4] });
    expect(choiceOf(undefined)).toEqual({ at: 'object', offset: [0, 0, 0] });
    const hinge = { at: [1, 0.25, 0] as [number, number, number] };
    expect(r6(keyPivotPoint(pivotSpec(choiceOf(hinge, BOX), 'center', hinge), BOX, P))).toEqual([1, 0.25, 0]);
  });

  it('a pivot dragged to a point of the object becomes the offset from the side the key names', () => {
    const through = (spec: KeyPivot | undefined, rest: [number, number, number]) =>
      pivotThrough(spec, 'center', BOX, P, rest);
    expect(through({ at: 'bottom', offset: [0, 0.7, 0.4] }, [0.25, 0.1, -0.5])).toEqual({
      at: 'bottom',
      offset: [0.25, 0.1, 0],
    });
    expect(through({ at: 'bottom' }, [0, 0, -0.5])).toEqual({ at: 'bottom' });
    expect(through(undefined, [0, 0, 0])).toBeUndefined();
    expect(through(undefined, [1, 0, 0])).toEqual({ at: 'center', offset: [1, 0, 0] });
    expect(through({ at: [1, 2, 3] }, [1, 2, 4])).toEqual({ at: [1, 2, 3], offset: [0, 0, 1] });
    const spec = through({ at: 'right' }, [1.123456, 0, 0]);
    expect(spec).toEqual({ at: 'right', offset: [0.1235, 0, 0] });
    expect(r6(keyPivotPoint(spec, BOX, P))).toEqual([1.1235, 0, 0]);
  });
});
