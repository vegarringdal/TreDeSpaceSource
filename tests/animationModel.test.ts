import { describe, expect, it } from 'vitest';
import { evaluate, evaluateObject, movingObjects, objectMotionTimes, STEP_CARD_PREFIX } from '../src/lib/animation/evaluate';
import { m4TransformPoint, qAngleDeg } from '../src/lib/animation/interp';
import { emptyDoc, parseAnimationDoc, serializeAnimationDoc, validateAnimationDoc } from '../src/lib/animation/io';
import { checkScene } from '../src/lib/animation/problems';
import { rulesAt } from '../src/lib/animation/rules';
import { contentEnd, lastStepAt, neighbourStep, sceneView, stepAt } from '../src/lib/animation/scene';
import type { AnimCamera, ClipStateValue, Step, V3 } from '../src/lib/animation/types';
import { doc, key, object, scene } from './helpers/animDoc';

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

const ctx = { pivots: new Map<string, V3>() };
const at = (m: Float32Array | null | undefined): number[] => (m ? m4TransformPoint(m, [0, 0, 0]).map((v) => Math.round(v * 1e4) / 1e4) : []);
const step = (id: string, start: number, end: number, patch: Partial<Step> = {}): Step => ({
  id,
  name: id,
  text: '',
  start,
  end,
  pauseAtEnd: false,
  ...patch,
});
const view = (az: number): AnimCamera => ({ target: [0, 0, 0], azimuth: az, elevation: 0.3, orbitDistance: 10, orthographic: false });

// -----------------------------------------------------------------------------
// file
// -----------------------------------------------------------------------------

describe('animation file v2', () => {
  it('round-trips a doc and keeps its order', () => {
    const d = doc([scene({ objects: [object('o1', [key(0), key(2, [1, 0, 0], { visible: false })])], steps: [step('a', 0, 2)] })]);
    const back = parseAnimationDoc(serializeAnimationDoc(d));
    expect(back.error).toBeUndefined();
    expect(back.doc).toEqual(d);
    expect(validateAnimationDoc(emptyDoc()).doc?.scenes).toHaveLength(1);
  });

  it('refuses old and newer versions with a clear message', () => {
    const v1 = validateAnimationDoc({ format: 'tredespace.animation', version: 1, actors: [], timelines: [] });
    expect(v1.error).toContain('version 1');
    expect(v1.error).toContain('cannot open');
    expect(validateAnimationDoc({ format: 'tredespace.animation', version: 3, scenes: [] }).error).toContain('newer');
    expect(validateAnimationDoc({ format: 'other', version: 2 }).error).toContain('Not an animation file');
  });

  it('makes up missing ids, reads axis-angle rotations, sorts keys and names the path of an error', () => {
    const r = validateAnimationDoc({
      format: 'tredespace.animation',
      version: 2,
      scenes: [
        {
          objects: [
            {
              items: ['/A/Pump'],
              keys: [
                { t: 2, rotate: { axis: [0, 0, 1], degrees: 90 } },
                { t: 0, move: [0, 0, 1], visible: false, interp: 'hold' },
              ],
            },
          ],
        },
      ],
    });
    expect(r.error).toBeUndefined();
    const o = r.doc?.scenes[0].objects[0];
    expect(o?.id).toMatch(/^o/);
    expect(o?.items).toEqual(['/a/pump']);
    expect(o?.keys.map((k) => k.t)).toEqual([0, 2]);
    expect(qAngleDeg(o?.keys[1].rotate ?? [0, 0, 0, 1])).toBeCloseTo(90, 4);
    expect(o?.keys[1].interp).toBe('smooth');
    expect(r.doc?.scenes[0].stepCard?.component).toBe('preset.stepCard');
    const bad = validateAnimationDoc({ format: 'tredespace.animation', version: 2, scenes: [{ objects: [{ items: ['/a'], keys: [{ t: -1 }] }] }] });
    expect(bad.error).toContain('scenes[0].objects[0].keys[0].t');
  });

  it("reads a key's pivot in every form and keeps it through a round trip", () => {
    const r = validateAnimationDoc({
      format: 'tredespace.animation',
      version: 2,
      scenes: [
        {
          objects: [
            {
              items: ['/door'],
              pivot: 'front',
              keys: [
                { t: 0, pivot: [1, 0, 0] },
                { t: 1, pivot: 'bottom' },
                { t: 2, rotate: { axis: [0, 0, 1], degrees: 90 }, pivot: { at: 'right', offset: [0, 0, 0.2] } },
              ],
            },
          ],
        },
      ],
    });
    expect(r.error).toBeUndefined();
    const o = r.doc?.scenes[0].objects[0];
    expect(o?.pivot).toBe('front');
    expect(o?.keys.map((k) => k.pivot)).toEqual([{ at: [1, 0, 0] }, { at: 'bottom' }, { at: 'right', offset: [0, 0, 0.2] }]);
    expect(parseAnimationDoc(serializeAnimationDoc(r.doc ?? emptyDoc())).doc).toEqual(r.doc);
    const bad = validateAnimationDoc({ format: 'tredespace.animation', version: 2, scenes: [{ objects: [{ items: ['/a'], keys: [{ t: 0, pivot: 'up' }] }] }] });
    expect(bad.error).toContain('scenes[0].objects[0].keys[0].pivot');
  });

  it('reads Labels and Measurements keys strictly and keeps them through a round trip', () => {
    const label = { text: 'P-101', anchor: [1, 2, 3], bg: '#ffffff', textColor: '#000000', muted: true };
    const measurement = { kind: 'line', points: [{ pos: [0, 0, 0] }, { pos: [1, 0, 0] }], label: 'Gap' };
    const r = validateAnimationDoc({
      format: 'tredespace.animation',
      version: 2,
      scenes: [{ labels: [{ t: 2, labels: [label] }, { t: 0, labels: [] }], measurements: [{ t: 1, measurements: [measurement] }] }],
    });
    expect(r.error).toBeUndefined();
    const sc = r.doc?.scenes[0];
    expect(sc?.labels.map((k) => k.t)).toEqual([0, 2]);
    expect(sc?.labels[1].labels[0]).toMatchObject({ text: 'P-101', anchor: [1, 2, 3], offset: [0, 0], muted: true, fullname: null });
    expect(sc?.measurements[0].measurements[0]).toMatchObject({ kind: 'line', label: 'Gap', visible: true, axisLegs: [false, false, false] });
    expect(parseAnimationDoc(serializeAnimationDoc(r.doc ?? emptyDoc())).doc).toEqual(r.doc);
    const css = validateAnimationDoc({
      format: 'tredespace.animation',
      version: 2,
      scenes: [{ labels: [{ t: 0, labels: [{ ...label, bg: 'url(x)' }] }] }],
    });
    expect(css.error).toContain('scenes[0].labels[0].labels[0].bg');
    const kind = validateAnimationDoc({
      format: 'tredespace.animation',
      version: 2,
      scenes: [{ measurements: [{ t: 0, measurements: [{ ...measurement, kind: 'volume' }] }] }],
    });
    expect(kind.error).toContain('scenes[0].measurements[0].measurements[0].kind');
  });

  it('reads leave-outs lower-cased, keeps them through a round trip and drops an empty list', () => {
    const r = validateAnimationDoc({
      format: 'tredespace.animation',
      version: 2,
      scenes: [{ objects: [{ items: ['/Site/M1'], exclude: ['/Site/M1/Foundation'] }, { items: ['/b'], exclude: [] }] }],
    });
    expect(r.error).toBeUndefined();
    const [withOut, without] = r.doc?.scenes[0].objects ?? [];
    expect(withOut?.exclude).toEqual(['/site/m1/foundation']);
    expect(without && 'exclude' in without).toBe(false);
    expect(parseAnimationDoc(serializeAnimationDoc(r.doc ?? emptyDoc())).doc).toEqual(r.doc);
    const bad = validateAnimationDoc({ format: 'tredespace.animation', version: 2, scenes: [{ objects: [{ items: ['/a'], exclude: [3] }] }] });
    expect(bad.error).toContain('scenes[0].objects[0].exclude');
  });

  it('refuses overlapping steps and duplicate ids', () => {
    const overlap = validateAnimationDoc({
      format: 'tredespace.animation',
      version: 2,
      scenes: [{ steps: [{ name: 'A', start: 0, end: 3 }, { name: 'B', start: 2, end: 4 }] }],
    });
    expect(overlap.error).toContain('"B" starts before "A" ends');
    const dupe = validateAnimationDoc({
      format: 'tredespace.animation',
      version: 2,
      scenes: [{ objects: [{ id: 'x', items: ['/a'] }, { id: 'x', items: ['/b'] }] }],
    });
    expect(dupe.error).toBe('Duplicate id "x"');
  });
});

// -----------------------------------------------------------------------------
// evaluation
// -----------------------------------------------------------------------------

describe('evaluate', () => {
  it('stands at the first key before it, holds the last after it, interpolates between', () => {
    const o = object('o', [key(1, [0, 0, 0]), key(3, [2, 0, 0])]);
    expect(at(evaluateObject(o, 0, [0, 0, 0]).pose)).toEqual([0, 0, 0]);
    expect(at(evaluateObject(o, 2, [0, 0, 0]).pose)).toEqual([1, 0, 0]);
    expect(at(evaluateObject(o, 9, [0, 0, 0]).pose)).toEqual([2, 0, 0]);
  });

  it('holds until a hold key, then jumps; smooth eases', () => {
    const hold = object('h', [key(0), key(2, [4, 0, 0], { interp: 'hold' })]);
    expect(at(evaluateObject(hold, 1.99, [0, 0, 0]).pose)).toEqual([0, 0, 0]);
    expect(at(evaluateObject(hold, 2, [0, 0, 0]).pose)).toEqual([4, 0, 0]);
    const smooth = object('s', [key(0), key(2, [4, 0, 0], { interp: 'smooth' })]);
    const x = at(evaluateObject(smooth, 0.5, [0, 0, 0]).pose)[0];
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(1);
  });

  it('keeps instant values from the key that sets them, also before the first key', () => {
    const o = object('o', [
      key(1, [0, 0, 0], { visible: false }),
      key(2),
      key(3, [0, 0, 0], { visible: true, color: '#ff0000' }),
      key(4, [0, 0, 0], { color: null, opacity: 0.4 }),
    ]);
    const s = (T: number) => evaluateObject(o, T, [0, 0, 0]);
    expect(s(0).visible).toBe(false);
    expect(s(2.5).visible).toBe(false);
    expect(s(3).visible).toBe(true);
    expect(s(3.5).color).toBe('#ff0000');
    expect(s(4).color).toBeNull();
    expect(s(4).opacity).toBe(0.4);
    expect(s(2).color).toBeUndefined();
  });

  it('reuses a still pose (the slots skip it) and recomputes a moving one', () => {
    const o = object('o', [key(0), key(1), key(2, [1, 0, 0])]);
    const a = evaluateObject(o, 0.2, [0, 0, 0]).pose;
    expect(evaluateObject(o, 0.7, [0, 0, 0]).pose).toBe(a);
    const m1 = evaluateObject(o, 1.2, [0, 0, 0]).pose;
    expect(evaluateObject(o, 1.5, [0, 0, 0]).pose).not.toBe(m1);
  });

  it('builds the whole frame: objects, rules, camera, section, step and cards', () => {
    const clip = (x: number): ClipStateValue => ({
      box: { enabled: true, boxOn: true, center: [x, 0, 0], size: [1, 1, 1], rotation: [0, 0, 0, 1], inverted: false },
      planes: {
        x: { enabled: false, position: 0, el: 0, az: 0, flipped: false, anchor: null },
        y: { enabled: false, position: 0, el: 0, az: 0, flipped: false, anchor: null },
        z: { enabled: false, position: 0, el: 0, az: 0, flipped: false, anchor: null },
      },
      shapes: [],
    });
    const s = scene({
      objects: [object('o', [key(0, [0, 0, 0], { visible: false }), key(1, [0, 0, 0], { visible: true })]), object('still', [])],
      camera: [
        { t: 0, view: view(0), interp: 'smooth' },
        { t: 2, view: view(1), interp: 'linear' },
      ],
      section: [
        { t: 0, value: clip(0), interp: 'smooth' },
        { t: 2, value: clip(2), interp: 'linear' },
      ],
      colorRules: [{ t: 1, mode: 'hide', rules: [] }],
      steps: [step('a', 0, 1), step('b', 1, 2, { card: null })],
    });
    const v = sceneView(s);
    const f = evaluate(v, 1.5, ctx);
    expect(f.visible.get('o')).toBe(true);
    expect(f.poses.has('still')).toBe(false);
    expect(f.camera?.azimuth).toBeCloseTo(0.75);
    expect(f.clip?.box.center[0]).toBeCloseTo(1.5);
    expect(f.look?.value.mode).toBe('hide');
    expect(f.step).toBe('b');
    expect(f.overlays.map((o) => o.instance)).toEqual([]);
    expect(evaluate(v, 0.5, ctx).overlays.map((o) => o.instance)).toEqual([`${STEP_CARD_PREFIX}a`]);
    expect(evaluate(v, 0.5, ctx).look).toBeNull();
  });

  it('shows the Labels and Measurements key in force: none before the first, then each until the next', () => {
    const k0 = { t: 1, labels: [] };
    const k1 = { t: 3, labels: [] };
    const m0 = { t: 2, measurements: [] };
    const sc = scene({ labels: [k0, k1], measurements: [m0] });
    const view = sceneView(sc);
    expect(evaluate(view, 0.5, ctx).labels).toBeNull();
    expect(evaluate(view, 1, ctx).labels).toBe(k0);
    expect(evaluate(view, 2.9, ctx).labels).toBe(k0);
    expect(evaluate(view, 3.5, ctx).labels).toBe(k1);
    expect(evaluate(view, 1.5, ctx).measurements).toBeNull();
    expect(evaluate(view, 2, ctx).measurements).toBe(m0);
    expect(contentEnd(sc)).toBe(3);
  });

  it('composes append rules on the ones before; reset starts clean', () => {
    const r = { comment: '', enabled: true, filters: [], color: '#ff0000', opacity: 1, store: '' };
    const keys = [
      { t: 0, mode: 'hide' as const, rules: [r] },
      { t: 1, mode: 'append' as const, rules: [r, r] },
      { t: 2, mode: 'reset' as const, rules: [] },
    ];
    expect(rulesAt(keys, 0.5)?.value.rules).toHaveLength(1);
    expect(rulesAt(keys, 1.5)?.value).toMatchObject({ mode: 'hide' });
    expect(rulesAt(keys, 1.5)?.value.rules).toHaveLength(3);
    expect(rulesAt(keys, 2)?.value.rules).toHaveLength(0);
    expect(rulesAt(keys, -1)).toBeNull();
  });

  it('shows callouts in their window with keyed places', () => {
    const s = scene({
      callouts: [
        {
          id: 'c',
          instance: 'ov',
          start: 1,
          end: 3,
          enter: { kind: 'none' },
          exit: { kind: 'none' },
          keys: [
            { t: 0, at: [0, 0], interp: 'linear' },
            { t: 2, at: [10, 0], interp: 'linear' },
          ],
        },
      ],
      stepCard: null,
    });
    const v = sceneView(s);
    expect(evaluate(v, 0.5, ctx).overlays).toHaveLength(0);
    expect(evaluate(v, 2, ctx).overlays[0]?.place).toEqual([5, 0]);
  });

  it('knows which objects move and where to sample them', () => {
    const d = doc([scene({ objects: [object('m', [key(0), key(1, [1, 0, 0])]), object('s', [key(0, [0, 0, 0], { visible: false })])] })]);
    expect([...movingObjects(d)]).toEqual(['m']);
    const times = objectMotionTimes(d.scenes[0].objects[0], 0, 1, 4);
    expect(times[0]).toBe(0);
    expect(times[times.length - 1]).toBe(1);
  });
});

// -----------------------------------------------------------------------------
// scene view and problems
// -----------------------------------------------------------------------------

describe('scene view', () => {
  it('ends at the last key, step or callout, or at the pinned end', () => {
    const s = scene({ objects: [object('o', [key(0), key(4)])], steps: [step('a', 1, 6)] });
    expect(contentEnd(s)).toBe(6);
    expect(sceneView(s).duration).toBe(6);
    expect(sceneView({ ...s, end: 3 }).duration).toBe(3);
  });

  it('names the step at a time, the last one started, and the neighbours', () => {
    const v = sceneView(scene({ steps: [step('b', 3, 5), step('a', 0, 2)] }));
    expect(v.steps.map((x) => x.id)).toEqual(['a', 'b']);
    expect(stepAt(v, 2.5)).toBeNull();
    expect(lastStepAt(v, 2.5)?.id).toBe('a');
    expect(stepAt(v, 2)?.id).toBe('a');
    expect(neighbourStep(v, 1, 1)?.id).toBe('b');
    // ◀ goes back to the current step's start, or to the one before right after it
    expect(neighbourStep(v, 4, -1)?.id).toBe('b');
    expect(neighbourStep(v, 3.2, -1)?.id).toBe('a');
  });

  it('lists objects moving while hidden and overlays missing their design', () => {
    const s = scene({
      objects: [object('h', [key(0, [0, 0, 0], { visible: false }), key(1, [1, 0, 0]), key(2, [2, 0, 0], { visible: true })])],
      callouts: [{ id: 'c', instance: 'gone', start: 0, end: 1, enter: { kind: 'none' }, exit: { kind: 'none' } }],
    });
    const p = checkScene(doc([s]), s, { unresolved: new Map(), shared: [], libraryComponents: new Set(['preset.stepCard']) });
    expect(p).toEqual([
      { kind: 'hiddenMove', object: 'h', t: 0 },
      { kind: 'missingInstance', callout: 'c', instance: 'gone' },
    ]);
  });
});
