import { describe, expect, it } from 'vitest';
import { m4Multiply, m4TransformPoint, qAxisAngle } from '../src/lib/animation/interp';
import { parseTransformDoc, serializeTransformDoc } from '../src/lib/transform/io';
import {
  applyWorld,
  decomposePose,
  identityMatrix,
  invertAffine,
  isIdentityPose,
  parentMatrix,
  pivotPoint,
  poseMatrix,
  rePivot,
  reParent,
  ridesOn,
  treeOrder,
  worldMatrices,
} from '../src/lib/transform/pose';
import { poseSummary } from '../src/lib/transform/summary';
import type { Pose, TransformObject, V3 } from '../src/lib/transform/types';

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

const BOX = [0, 0, 0, 2, 4, 6];
const CORNER: V3 = [2, 4, 6];

function object(id: string, patch: Partial<TransformObject> = {}): TransformObject {
  return {
    id,
    name: id,
    items: [`/${id}`],
    pivot: { at: 'center' },
    move: [0, 0, 0],
    rotate: [0, 0, 0, 1],
    scale: [1, 1, 1],
    ...patch,
  };
}

function translate(v: V3): Float64Array {
  const m = identityMatrix();
  m[12] = v[0];
  m[13] = v[1];
  m[14] = v[2];
  return m;
}

/** A turn of `degrees` about Z through world point `c`. */
function turnZ(degrees: number, c: V3): Float64Array {
  const rad = (degrees * Math.PI) / 180;
  const m = identityMatrix();
  m[0] = Math.cos(rad);
  m[1] = Math.sin(rad);
  m[4] = -Math.sin(rad);
  m[5] = Math.cos(rad);
  const at = m4TransformPoint(m, c);
  m[12] = c[0] - at[0];
  m[13] = c[1] - at[1];
  m[14] = c[2] - at[2];
  return m;
}

function scaleAbout(f: V3, c: V3): Float64Array {
  const m = identityMatrix();
  m[0] = f[0];
  m[5] = f[1];
  m[10] = f[2];
  m[12] = c[0] - f[0] * c[0];
  m[13] = c[1] - f[1] * c[1];
  m[14] = c[2] - f[2] * c[2];
  return m;
}

function expectPoint(got: V3, want: V3): void {
  for (let k = 0; k < 3; k++) {
    expect(got[k]).toBeCloseTo(want[k], 4);
  }
}

function expectMatrix(got: ArrayLike<number>, want: ArrayLike<number>): void {
  for (let k = 0; k < 16; k++) {
    expect(got[k]).toBeCloseTo(want[k], 4);
  }
}

// -----------------------------------------------------------------------------
// pose math
// -----------------------------------------------------------------------------

describe('transform object pose', () => {
  it('turns and scales about the pivot, then moves', () => {
    const pose: Pose = { move: [10, 0, 0], rotate: qAxisAngle([0, 0, 1], 90), scale: [2, 1, 1] };
    const q: V3 = [1, 2, 3];
    const m = poseMatrix(pose, q);
    expectPoint(m4TransformPoint(m, q), [11, 2, 3]);
    // one metre along X from the pivot: doubled, then turned onto +Y
    expectPoint(m4TransformPoint(m, [2, 2, 3]), [11, 4, 3]);
  });

  it('decomposes what it composes', () => {
    const pose: Pose = { move: [1.5, -2, 0.25], rotate: qAxisAngle([1, 2, 3], 37), scale: [1.5, 0.5, 2] };
    const q: V3 = [4, 5, 6];
    const back = decomposePose(poseMatrix(pose, q), q);
    expectMatrix(poseMatrix(back, q), poseMatrix(pose, q));
  });

  it('inverts an affine matrix', () => {
    const m = poseMatrix({ move: [3, 4, 5], rotate: qAxisAngle([0, 1, 0], 50), scale: [2, 3, 0.5] }, CORNER);
    expectMatrix(m4Multiply(invertAffine(m), m, new Float64Array(16)), identityMatrix());
  });

  it('says the same placement about another pivot', () => {
    const pose: Pose = { move: [1, 2, 3], rotate: qAxisAngle([0, 0, 1], 30), scale: [1, 2, 1] };
    const from = pivotPoint({ at: 'center' }, BOX);
    const to = pivotPoint({ at: 'bottom', offset: [0.5, 0, 0] }, BOX);
    expectPoint(to, [1.5, 2, 0]);
    expectMatrix(poseMatrix(rePivot(pose, from, to), to), poseMatrix(pose, from));
  });

  it('knows an untouched pose', () => {
    expect(isIdentityPose({ move: [0, 0, 0], rotate: [0, 0, 0, -1], scale: [1, 1, 1] })).toBe(true);
    expect(isIdentityPose({ move: [0, 0, 0.01], rotate: [0, 0, 0, 1], scale: [1, 1, 1] })).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// moving on top of where it is drawn
// -----------------------------------------------------------------------------

describe('applyWorld', () => {
  const q = pivotPoint({ at: 'center' }, BOX);

  it('lands where the world matrix puts it', () => {
    const o = object('a', { move: [1, 0, 0], rotate: qAxisAngle([0, 0, 1], 20) });
    const g = m4Multiply(translate([0, 5, 0]), turnZ(70, [9, 9, 0]), new Float64Array(16));
    const pose = applyWorld(o, q, identityMatrix(), g);
    expectMatrix(poseMatrix(pose, q), m4Multiply(g, poseMatrix(o, q), new Float64Array(16)));
  });

  it('a turn about its own pivot leaves the move alone', () => {
    const o = object('a', { move: [3, 0, 0] });
    const pose = applyWorld(o, q, identityMatrix(), turnZ(90, [q[0] + 3, q[1], q[2]]));
    expectPoint(pose.move, [3, 0, 0]);
    expect(poseSummary(pose)).toBe('3 m · 90°');
  });

  it('moves a child in its parent’s frame', () => {
    const above = poseMatrix({ move: [0, 0, 0], rotate: qAxisAngle([0, 0, 1], 90), scale: [1, 1, 1] }, [0, 0, 0]);
    const child = object('c');
    // the parent is turned a quarter: a world step along +Y is +X for the child
    const pose = applyWorld(child, q, above, translate([0, 2, 0]));
    expectPoint(pose.move, [2, 0, 0]);
    const drawn = m4Multiply(above, poseMatrix(pose, q), new Float64Array(16));
    const before = m4Multiply(above, poseMatrix(child, q), new Float64Array(16));
    expectMatrix(drawn, m4Multiply(translate([0, 2, 0]), before, new Float64Array(16)));
  });

  it('takes a stretch along the object’s own axes', () => {
    const o = object('a', { rotate: qAxisAngle([0, 0, 1], 90) });
    // turned a quarter, its own X points along world Y
    const pose = applyWorld(o, q, identityMatrix(), scaleAbout([1, 3, 1], q));
    expectPoint(pose.scale, [3, 1, 1]);
    expectMatrix(
      poseMatrix(pose, q),
      m4Multiply(scaleAbout([1, 3, 1], q), poseMatrix(o, q), new Float64Array(16)),
    );
  });
});

// -----------------------------------------------------------------------------
// what rides on what
// -----------------------------------------------------------------------------

describe('parents', () => {
  const boxes = new Map([
    ['a', BOX],
    ['b', BOX],
  ]);

  it('draws a child on top of its parent', () => {
    const a = object('a', { move: [10, 0, 0] });
    const b = object('b', { parent: 'a', move: [0, 1, 0] });
    const world = worldMatrices([a, b], boxes);
    expectPoint(m4TransformPoint(world.get('b') ?? identityMatrix(), [0, 0, 0]), [10, 1, 0]);
  });

  it('a muted parent stands at rest, its child keeps its own pose', () => {
    const a = object('a', { move: [10, 0, 0], muted: true });
    const b = object('b', { parent: 'a', move: [0, 1, 0] });
    const world = worldMatrices([a, b], boxes);
    expectPoint(m4TransformPoint(world.get('b') ?? identityMatrix(), [0, 0, 0]), [0, 1, 0]);
  });

  it('survives a loop and a missing parent', () => {
    const a = object('a', { parent: 'b', move: [1, 0, 0] });
    const b = object('b', { parent: 'a', move: [0, 1, 0] });
    const c = object('c', { parent: 'gone', move: [0, 0, 1] });
    const world = worldMatrices([a, b, c], boxes);
    expect(world.size).toBe(3);
    expectPoint(m4TransformPoint(world.get('c') ?? identityMatrix(), [0, 0, 0]), [0, 0, 1]);
    expect(treeOrder([a, b, c]).map((r) => r.depth)).toEqual([0, 0, 0]);
  });

  it('keeps the placement when the parent changes', () => {
    const a = object('a', { move: [10, 0, 0], rotate: qAxisAngle([0, 0, 1], 45) });
    const b = object('b', { parent: 'a', move: [0, 1, 0], rotate: qAxisAngle([1, 0, 0], 30) });
    const q = pivotPoint(b.pivot, BOX);
    const world = worldMatrices([a, b], boxes);
    const from = parentMatrix([a, b], boxes, 'b', world);
    const free = reParent(b, q, from, identityMatrix());
    expectMatrix(poseMatrix(free, q), world.get('b') ?? identityMatrix());
  });

  it('orders the tree and knows who rides on whom', () => {
    const list = [object('c', { parent: 'b' }), object('a'), object('b', { parent: 'a' }), object('d')];
    expect(treeOrder(list).map((r) => `${r.object.id}${r.depth}`)).toEqual(['a0', 'b1', 'c2', 'd0']);
    expect(ridesOn(list, 'c', 'a')).toBe(true);
    expect(ridesOn(list, 'a', 'c')).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// file
// -----------------------------------------------------------------------------

describe('transform objects file', () => {
  it('round-trips', () => {
    const list = [
      object('a', { move: [1, 2, 3], exclude: ['/a/x'] }),
      object('b', { parent: 'a', pivot: { at: 'bottom', offset: [0, 0, 0.5] }, muted: true }),
    ];
    const parsed = parseTransformDoc(serializeTransformDoc(list));
    expect(parsed.error).toBeUndefined();
    expect(parsed.doc?.objects).toEqual(list);
  });

  it('fills in what a hand-written file leaves out', () => {
    const parsed = parseTransformDoc(
      JSON.stringify({ format: 'tredespace.transforms', version: 1, objects: [{ items: ['/SITE/Pump'] }] }),
    );
    const [o] = parsed.doc?.objects ?? [];
    expect(o.items).toEqual(['/site/pump']);
    expect(o.pivot).toEqual({ at: 'center' });
    expect(isIdentityPose(o)).toBe(true);
  });

  it('names the field that is wrong', () => {
    const bad = (objects: unknown) =>
      parseTransformDoc(JSON.stringify({ format: 'tredespace.transforms', version: 1, objects })).error;
    expect(bad([{ items: [] }])).toContain('objects[0].items');
    expect(bad([{ items: ['/a'], move: [1, 2] }])).toContain('objects[0].move');
    expect(bad([{ items: ['/a'], rotate: [0, 0, 0, 0] }])).toContain('objects[0].rotate');
    expect(parseTransformDoc('{').error).toContain('Not valid JSON');
    expect(parseTransformDoc(JSON.stringify({ format: 'other' })).error).toContain('Not a transform objects file');
  });

  it('drops parents that are missing or loop', () => {
    const parsed = parseTransformDoc(
      serializeTransformDoc([object('a', { parent: 'b' }), object('b', { parent: 'a' }), object('c', { parent: 'x' })]),
    );
    expect(parsed.doc?.objects.every((o) => o.parent === undefined)).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// readout
// -----------------------------------------------------------------------------

describe('poseSummary', () => {
  it('names only what is not at rest', () => {
    expect(poseSummary({ move: [0, 0, 0], rotate: [0, 0, 0, 1], scale: [1, 1, 1] })).toBe('at rest');
    expect(poseSummary({ move: [3, 4, 0], rotate: [0, 0, 0, 1], scale: [1, 1, 1] })).toBe('5 m');
    expect(poseSummary({ move: [0, 0, 0], rotate: qAxisAngle([0, 0, 1], 90), scale: [2, 2, 2] })).toBe('90° · ×2');
    expect(poseSummary({ move: [0, 0, 0], rotate: [0, 0, 0, 1], scale: [1, 2, 1] })).toBe('×1 / 2 / 1');
  });
});
