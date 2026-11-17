import { describe, expect, it } from 'vitest';
import { composePoses, evaluate, worldPoseAt } from '../src/lib/animation/evaluate';
import { m4TransformPoint, qAxisAngle } from '../src/lib/animation/interp';
import { parseAnimationDoc, serializeAnimationDoc, validateAnimationDoc } from '../src/lib/animation/io';
import { sceneView } from '../src/lib/animation/scene';
import { sweptBoundsAll } from '../src/lib/animation/swept';
import type { V3 } from '../src/lib/animation/types';
import { ridersFirst, ridersOf, ridesOn, treeOrder, withoutRiders } from '../src/lib/objectTree';
import { doc, key, object, scene } from './helpers/animDoc';

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

const ctx = { pivots: new Map<string, V3>() };
const round = (v: number): number => Math.round(v * 1e4) / 1e4 || 0;
const at = (m: ArrayLike<number> | null | undefined, p: V3 = [0, 0, 0]): number[] =>
  m ? m4TransformPoint(m, p).map(round) : [];

/** A parent sliding 4 m along X over 4 s, with a part lifting 2 m over the same time. */
function parentAndPart() {
  const parent = object('skid', [key(0), key(4, [4, 0, 0])]);
  const part = object('valve', [key(0), key(4, [0, 0, 2])], { parent: 'skid' });
  return scene({ objects: [parent, part] });
}

// -----------------------------------------------------------------------------
// tree
// -----------------------------------------------------------------------------

describe('objects that ride on each other', () => {
  const list = [
    { id: 'a' },
    { id: 'b', parent: 'a' },
    { id: 'c', parent: 'b' },
    { id: 'd' },
    { id: 'e', parent: 'gone' },
  ];

  it('walks the tree', () => {
    expect(treeOrder(list).map((r) => `${r.object.id}${r.depth}`)).toEqual(['a0', 'b1', 'c2', 'd0', 'e0']);
    expect(ridesOn(list, 'c', 'a')).toBe(true);
    expect(ridesOn(list, 'a', 'c')).toBe(false);
    expect(ridersOf(list, 'a').map((o) => o.id)).toEqual(['b', 'c']);
  });

  it('puts riders before what they ride on, and drops them from a move', () => {
    expect(ridersFirst(list).map((o) => o.id)).toEqual(['c', 'b', 'a', 'd', 'e']);
    expect(withoutRiders(list, ['c', 'a', 'd'])).toEqual(['a', 'd']);
    expect(withoutRiders(list, ['c', 'd'])).toEqual(['c', 'd']);
  });

  it('survives a loop', () => {
    const loop = [
      { id: 'x', parent: 'y' },
      { id: 'y', parent: 'x' },
    ];
    expect(treeOrder(loop).map((r) => r.depth)).toEqual([0, 0]);
    expect(ridersFirst(loop)).toHaveLength(2);
  });
});

// -----------------------------------------------------------------------------
// evaluation
// -----------------------------------------------------------------------------

describe('a sub-object rides on its parent', () => {
  it('is drawn with its own keys on top of the parent’s', () => {
    const f = evaluate(sceneView(parentAndPart()), 2, ctx);
    expect(at(f.poses.get('skid'))).toEqual([2, 0, 0]);
    expect(at(f.poses.get('valve'))).toEqual([2, 0, 1]);
    expect(at(f.own.get('valve'))).toEqual([0, 0, 1]);
  });

  it('follows a parent without keys of its own, and a turning parent turns it', () => {
    const parent = object('skid', [key(0), key(2, [0, 0, 0], { rotate: qAxisAngle([0, 0, 1], 90) })]);
    const part = object('valve', [], { parent: 'skid' });
    const f = evaluate(sceneView(scene({ objects: [parent, part] })), 2, ctx);
    // a point 1 m along X from the parent's pivot swings onto +Y
    expect(at(f.poses.get('valve'), [1, 0, 0])).toEqual([0, 1, 0]);
  });

  it('hands back the same matrix while nothing above or in it moves', () => {
    const parent = object('skid', [key(0), key(1, [1, 0, 0]), key(5, [1, 0, 0])]);
    const part = object('valve', [key(0, [0, 0, 1])], { parent: 'skid' });
    const view = sceneView(scene({ objects: [parent, part] }));
    expect(evaluate(view, 2, ctx).poses.get('valve')).toBe(evaluate(view, 3, ctx).poses.get('valve'));
    expect(evaluate(view, 0.5, ctx).poses.get('valve')).not.toBe(evaluate(view, 3, ctx).poses.get('valve'));
  });

  it('a muted parent stands at rest; the part keeps its own keys', () => {
    const s = parentAndPart();
    const muted = scene({ objects: [{ ...s.objects[0], muted: true }, s.objects[1]] });
    const f = evaluate(sceneView(muted), 2, ctx);
    expect(f.poses.get('skid')).toBeUndefined();
    expect(at(f.poses.get('valve'))).toEqual([0, 0, 1]);
  });

  it('takes hide, opacity and colour from above unless it keys them itself', () => {
    const parent = object('skid', [key(0, [0, 0, 0], { visible: false, opacity: 0.5, color: '#ff0000' })]);
    const follows = object('valve', [key(0)], { parent: 'skid' });
    const own = object('gauge', [key(0, [0, 0, 0], { visible: true, color: null })], { parent: 'skid' });
    const free = object('pipe', [key(0)]);
    const f = evaluate(sceneView(scene({ objects: [parent, follows, own, free] })), 1, ctx);
    expect([f.visible.get('valve'), f.opacity.get('valve'), f.colors.get('valve')]).toEqual([false, 0.5, '#ff0000']);
    expect([f.visible.get('gauge'), f.opacity.get('gauge'), f.colors.get('gauge')]).toEqual([true, 0.5, null]);
    expect(f.visible.has('pipe')).toBe(false);
  });

  it('samples any time, and sweeps the whole chain’s motion', () => {
    const s = parentAndPart();
    expect(at(worldPoseAt(s.objects, s.objects[1], 4, ctx))).toEqual([4, 0, 2]);
    const box = new Map([
      ['skid', [0, 0, 0, 1, 1, 1]],
      ['valve', [0, 0, 0, 1, 1, 1]],
    ]);
    const swept = sweptBoundsAll(s, 4, box, ctx.pivots).get('valve');
    expect(swept?.[3]).toBeGreaterThan(4.9);
    expect(swept?.[5]).toBeGreaterThan(2.9);
  });

  it('draws a pose not keyed yet on a parent under its sub-objects too', () => {
    const s = parentAndPart();
    const f = evaluate(sceneView(s), 0, ctx);
    const lift = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 5, 0, 1]);
    const drawn = composePoses(
      s.objects,
      (o) => f.own.get(o.id) ?? null,
      (o) => (o.id === 'skid' ? lift : null),
    );
    expect(at(drawn.get('skid'))).toEqual([0, 5, 0]);
    expect(at(drawn.get('valve'))).toEqual([0, 5, 0]);
  });
});

// -----------------------------------------------------------------------------
// file
// -----------------------------------------------------------------------------

describe('parents in the animation file', () => {
  it('round-trips', () => {
    const d = doc([parentAndPart()]);
    const back = parseAnimationDoc(serializeAnimationDoc(d));
    expect(back.error).toBeUndefined();
    expect(back.doc?.scenes[0].objects[1].parent).toBe('skid');
  });

  it('takes a parent by name when ids are left out', () => {
    const r = validateAnimationDoc({
      format: 'tredespace.animation',
      version: 2,
      scenes: [{ objects: [{ name: 'Skid', items: ['/skid'] }, { name: 'Valve', items: ['/skid/valve'], parent: 'Skid' }] }],
    });
    const [skid, valve] = r.doc?.scenes[0].objects ?? [];
    expect(r.error).toBeUndefined();
    expect(valve.parent).toBe(skid.id);
  });

  it('refuses a parent that is not there, and a loop', () => {
    const file = (objects: unknown) => validateAnimationDoc({ format: 'tredespace.animation', version: 2, scenes: [{ objects }] });
    expect(file([{ id: 'a', items: ['/a'], parent: 'nobody' }]).error).toContain('objects[0].parent');
    expect(file([{ id: 'a', items: ['/a'], parent: 'a' }]).error).toContain('objects[0].parent');
    expect(
      file([
        { id: 'a', items: ['/a'], parent: 'b' },
        { id: 'b', items: ['/b'], parent: 'a' },
      ]).error,
    ).toContain('loop');
  });
});
