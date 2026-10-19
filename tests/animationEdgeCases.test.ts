import { describe, expect, it } from 'vitest';
import { sampleClipState } from '../src/lib/animation/clipState';
import { evaluate, evaluateObject } from '../src/lib/animation/evaluate';
import {
  m4TransformPoint,
  poseMatrix,
  qAxisAngle,
  qRotate,
  sampleTransform,
  sampleTransformMatrix,
} from '../src/lib/animation/interp';
import { validateAnimationDoc } from '../src/lib/animation/io';
import { insertObjectKey, keyHere, rePivot } from '../src/lib/animation/keyRows';
import { advancePlayhead } from '../src/lib/animation/playhead';
import { checkScene } from '../src/lib/animation/problems';
import { neighbourStep, sceneView } from '../src/lib/animation/scene';
import { sweptBoundsAll } from '../src/lib/animation/swept';
import { formatTime } from '../src/lib/animation/timeFormat';
import type { ClipPlaneState, ClipStateValue, ObjectKey, Step, V3 } from '../src/lib/animation/types';
import { doc, key, object, scene } from './helpers/animDoc';

const ORIGIN: V3 = [0, 0, 0];
const ctx = { pivots: new Map<string, V3>() };

function step(id: string, start: number, end: number, patch: Partial<Step> = {}): Step {
  return { id, name: id.toUpperCase(), text: '', start, end, pauseAtEnd: false, ...patch };
}

/** Angle (degrees, −180..180) the pose at T has turned the +X axis about Z. */
function turnedAt(keys: readonly ObjectKey[], T: number): number {
  const r = qRotate(sampleTransform(keys, T).rotate, [1, 0, 0]);
  return (Math.atan2(r[1], r[0]) * 180) / Math.PI;
}

describe('the same place, within float noise', () => {
  it('a key pressed twice without moving is a pause on the smooth path, far from the origin too', () => {
    const far: V3 = [234_000, 168_000, 7];
    const o = object(
      'o',
      [
        key(0, far),
        key(2, [far[0] + 10, far[1], far[2]]),
        key(4, [far[0] + 10 + 5e-5, far[1] - 3e-5, far[2]]),
        key(6, far),
      ],
      { path: 'smooth' },
    );
    for (const T of [2.5, 3, 3.5]) {
      const x = m4TransformPoint(evaluateObject(o, T, ORIGIN).pose ?? new Float32Array(16), [0, 0, 0])[0];
      expect(Math.abs(x - (far[0] + 10))).toBeLessThan(0.05);
    }
  });

  it('keeps the pose through rePivot far from the origin', () => {
    const k = { move: [12, -3, 0] as V3, rotate: qAxisAngle([0, 0, 1], 30) };
    const a: V3 = [100_000, 100_000, 0];
    const b: V3 = [100_001, 100_000, 2];
    const back = rePivot(rePivot(k, a, b), b, a);
    expect(Math.max(...back.move.map((x, i) => Math.abs(x - k.move[i])))).toBeLessThan(1e-6);
  });
});

describe('the smooth path around a hold', () => {
  it('stops at the key before a hold and sets off from the jump without dipping', () => {
    const into = object('o', [key(0), key(1, [10, 0, 0]), key(2, [-100, 0, 0], { interp: 'hold' })], { path: 'smooth' });
    const xs = [0.2, 0.5, 0.8, 0.95].map((T) => sampleTransform(into.keys, T, true).move[0]);
    expect(Math.max(...xs)).toBeLessThanOrEqual(10 + 1e-9);
    const out = object('o', [key(0, [100, 0, 0]), key(1, [10, 0, 0], { interp: 'hold' }), key(2, [20, 0, 0])], {
      path: 'smooth',
    });
    const after = [1.1, 1.3, 1.5].map((T) => sampleTransform(out.keys, T, true).move[0]);
    expect(Math.min(...after)).toBeGreaterThanOrEqual(10 - 1e-9);
  });
});

describe('a key inserted into a row', () => {
  it('inside a spin takes its share of the turns, so the spin carries on as it was', () => {
    const o = object('o', [key(0), key(2, [0, 0, 0], { spin: { axis: [0, 0, 1], degrees: 720 } })]);
    const before = [0.25, 0.5, 0.75, 1, 1.5].map((T) => turnedAt(o.keys, T));
    const keys = insertObjectKey(o.keys, { ...keyHere(o, 0.6, 'linear'), visible: false });
    expect(keys).toHaveLength(3);
    const after = [0.25, 0.5, 0.75, 1, 1.5].map((T) => turnedAt(keys, T));
    after.forEach((a, i) => {
      expect(Math.abs(((a - before[i] + 540) % 360) - 180)).toBeLessThan(1e-6);
    });
    expect((keys[1].spin?.degrees ?? 0) + (keys[2].spin?.degrees ?? 0)).toBeCloseTo(720);
  });

  it('before the first key takes its instant values, so an object hidden from the start stays hidden', () => {
    const o = object('o', [key(3, [0, 0, 0], { visible: false, color: '#ff0000' })]);
    const k = { ...keyHere(o, 1, 'smooth'), opacity: 0.5 };
    const keys = insertObjectKey(o.keys, k);
    const next = object('o', keys);
    for (const T of [0, 1, 2, 3]) {
      expect(evaluateObject(next, T, ORIGIN).visible).toBe(false);
    }
    expect(evaluateObject(next, 2, ORIGIN).color).toBe('#ff0000');
  });
});

describe('playing a step or a looping scene', () => {
  const v = sceneView(
    scene({
      objects: [object('o', [key(0), key(10)])],
      steps: [step('a', 0, 4, { pauseAtEnd: true }), step('b', 4, 10, { pauseAtEnd: true })],
    }),
  );
  const tick = (time: number, dt: number, extra: Partial<Parameters<typeof advancePlayhead>[0]> = {}) =>
    advancePlayhead({ time, dt, direction: 1, view: v, scope: { kind: 'all' }, loop: false, pingPong: false, ...extra });

  it('one step stops at its end even when the scene loops or turns round', () => {
    const scope = { kind: 'step', step: 'b' } as const;
    expect(tick(9.9, 0.5, { scope, loop: true })).toMatchObject({ time: 10, stop: { kind: 'end' }, looped: false });
    expect(tick(9.9, 0.5, { scope, pingPong: true })).toMatchObject({ time: 10, stop: { kind: 'end' } });
  });

  it('a pausing step at the scene end still pauses when the scene loops, then Continue wraps', () => {
    expect(tick(9.9, 0.5, { loop: true })).toMatchObject({ time: 10, stop: { kind: 'stepEnd', step: 'b' } });
    expect(tick(10, 0.5, { loop: true })).toMatchObject({ looped: true });
  });

  it('◀ step before the first step stays put', () => {
    const late = sceneView(scene({ steps: [step('a', 5, 8)] }));
    expect(neighbourStep(late, 0, -1)).toBeNull();
    expect(neighbourStep(late, 7, -1)?.id).toBe('a');
  });
});

describe('waiting at the end of a step', () => {
  it('keeps that step and its card on screen until Continue', () => {
    const v = sceneView(scene({ steps: [step('a', 0, 4, { pauseAtEnd: true }), step('b', 4, 8)] }));
    const free = evaluate(v, 4, ctx);
    expect(free.step).toBe('b');
    const held = evaluate(v, 4, ctx, 'a');
    expect(held.step).toBe('a');
    expect(held.overlays.find((f) => f.instance === 'step:a')).toMatchObject({ progress: 1, phase: 'shown' });
  });
});

describe('short overlays', () => {
  it('never pop between overlapping enter and exit fades', () => {
    const fade = { kind: 'fade', duration: 0.3 } as const;
    const v = sceneView(scene({ callouts: [{ id: 'c', instance: 'i', start: 0, end: 0.4, enter: fade, exit: fade }] }));
    const at = (T: number) => evaluate(v, T, ctx).overlays[0]?.progress ?? 0;
    for (let T = 0; T < 0.4; T += 0.01) {
      expect(Math.abs(at(T + 0.01) - at(T))).toBeLessThan(0.05);
    }
  });
});

describe('clipping planes', () => {
  const plane = (anchor: V3 | null, position: number): ClipPlaneState => ({
    enabled: true,
    position,
    el: 0,
    az: 0,
    flipped: false,
    anchor,
  });
  const value = (x: ClipPlaneState): ClipStateValue => ({
    box: { enabled: false, boxOn: false, center: [0, 0, 0], size: [1, 1, 1], rotation: [0, 0, 0, 1], inverted: false },
    planes: { x, y: { ...x, enabled: false }, z: { ...x, enabled: false } },
    shapes: [],
  });

  it('keep a key’s own anchor at its time, and switch an anchor that only one side has at the next key', () => {
    const keys = [
      { t: 0, value: value(plane(null, 0)), interp: 'linear' as const },
      { t: 1, value: value(plane([10, 0, 0], 0)), interp: 'linear' as const },
      { t: 2, value: value(plane(null, 5)), interp: 'linear' as const },
    ];
    expect(sampleClipState(keys, 0.01)?.planes.x.anchor).toBeNull();
    expect(sampleClipState(keys, 1)?.planes.x.anchor).toEqual([10, 0, 0]);
    expect(sampleClipState(keys, 1.5)?.planes.x.anchor).toEqual([10, 0, 0]);
  });
});

describe('the time read-out', () => {
  it('rounds before splitting minutes and seconds', () => {
    expect(formatTime(9.96)).toBe('00:10.0');
    expect(formatTime(59.96)).toBe('01:00.0');
    expect(formatTime(119.97)).toBe('02:00.0');
    expect(formatTime(4.04)).toBe('00:04.0');
  });
});

describe('opening a file', () => {
  it('accepts a zero-length step in either order, and a step card theme of null (Auto)', () => {
    for (const steps of [
      [step('a', 2, 5), step('z', 2, 2)],
      [step('z', 2, 2), step('a', 2, 5)],
    ]) {
      expect(validateAnimationDoc(doc([scene({ steps })])).error).toBeUndefined();
    }
    const d = doc([scene({ steps: [step('a', 0, 2)] })]);
    const card = { component: 'preset.stepCard', values: {}, theme: null };
    const raw = { ...d, scenes: [{ ...d.scenes[0], steps: [{ ...step('a', 0, 2), card }] }] };
    const r = validateAnimationDoc(raw);
    expect(r.error).toBeUndefined();
    expect(r.doc?.scenes[0].steps[0].card).toEqual({ component: 'preset.stepCard', values: {} });
  });
});

describe('the Problems list', () => {
  const inputs = { unresolved: new Map<string, number>(), shared: [], libraryComponents: new Set<string>() };
  const problemsOf = (keys: ObjectKey[]) =>
    checkScene(doc(), scene({ objects: [object('o', keys)] }), inputs).filter((p) => p.kind === 'hiddenMove');

  it('lists a hidden object that only spins, not one keyed twice in place', () => {
    expect(
      problemsOf([key(0, [0, 0, 0], { visible: false }), key(2, [0, 0, 0], { spin: { axis: [0, 0, 1], degrees: 720 } })]),
    ).toHaveLength(1);
    expect(problemsOf([key(0, [5, 0, 0], { visible: false }), key(2, [5 + 2e-5, 0, 0])])).toHaveLength(0);
  });
});

describe('swept bounds', () => {
  it('cover the whole circle of a fast spin', () => {
    const arm = object('arm', [key(0), key(1, [0, 0, 0], { spin: { axis: [0, 0, 1], degrees: 720 } })], {
      pivot: [0, 0, 0],
    });
    const s = scene({ objects: [arm] });
    const box = sweptBoundsAll(s, 1, new Map([['arm', [0, -0.05, -0.05, 2, 0.05, 0.05]]]), new Map([['arm', ORIGIN]]));
    expect(box.get('arm')?.[0] ?? 0).toBeLessThan(-1.95);
    expect(box.get('arm')?.[1] ?? 0).toBeLessThan(-1.95);
  });
});

describe('sampled poses stay rigid', () => {
  it('poseMatrix in double precision matches the float one near the origin', () => {
    const k = { move: [1, 2, 3] as V3, rotate: qAxisAngle([0, 1, 0], 40) };
    const f32 = poseMatrix(k, [0.5, 0, 0]);
    const f64 = poseMatrix(k, [0.5, 0, 0], new Float64Array(16));
    f32.forEach((x, i) => {
      expect(x).toBeCloseTo(f64[i], 5);
    });
    expect(sampleTransformMatrix([key(0)], 0, new Float32Array(16))[15]).toBe(1);
  });
});
