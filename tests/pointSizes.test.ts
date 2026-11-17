// Adaptive point size in the additive LOD (lib/tdpp/pointSizes.ts): each drawn
// node is sized, per octant, by the finest level drawn there.
import { describe, expect, it } from 'vitest';
import { octantSpacings, sameSizes } from '../src/lib/tdpp/pointSizes';
import type { TdppNode } from '../src/lib/tdpp/tdppFormat';

function node(over: Partial<TdppNode> & Pick<TdppNode, 'index' | 'spacing'>): TdppNode {
  return {
    cubeMin: [0, 0, 0],
    cubeSize: 1,
    boundsMin: [0, 0, 0],
    boundsMax: [1, 1, 1],
    pointCount: 100,
    parent: -1,
    firstChild: 0,
    childCount: 0,
    depth: 0,
    octant: 0,
    colorDelta: false,
    clusterCount: 1,
    payloadSize: 0,
    payloadOffset: 0,
    setupMask: 1n,
    ...over,
  };
}

/**
 * root (spacing 8) → children in octants 1 and 6 (spacing 4) → the octant-1
 * child has one child in its octant 3 (spacing 2), which has one in its
 * octant 0 (spacing 1). Breadth-first, as a file stores them.
 */
function tree(): TdppNode[] {
  return [
    node({ index: 0, spacing: 8, firstChild: 1, childCount: 2 }),
    node({ index: 1, spacing: 4, parent: 0, octant: 1, firstChild: 3, childCount: 1 }),
    node({ index: 2, spacing: 4, parent: 0, octant: 6 }),
    node({ index: 3, spacing: 2, parent: 1, octant: 3, firstChild: 4, childCount: 1 }),
    node({ index: 4, spacing: 1, parent: 3, octant: 0 }),
  ];
}

const NEVER_EMPTY = () => false;
const sizesOf = (drawn: number[], isEmpty: (i: number) => boolean = NEVER_EMPTY) =>
  octantSpacings(tree(), new Set(drawn), isEmpty);
const table = (octants: Record<number, number>, own: number) =>
  Array.from({ length: 8 }, (_, k) => octants[k] ?? own);

describe('octantSpacings', () => {
  it('sizes a node drawn alone by its own spacing everywhere', () => {
    expect([...(sizesOf([0]).get(0) ?? [])]).toEqual(table({}, 8));
  });

  it('sizes an octant with a drawn child by the child, the others by the node', () => {
    const s = sizesOf([0, 1, 2]);
    expect([...(s.get(0) ?? [])]).toEqual(table({ 1: 4, 6: 4 }, 8));
    expect([...(s.get(1) ?? [])]).toEqual(table({}, 4));
  });

  it('follows the finest level down: a deep refinement shrinks every node above it there', () => {
    const s = sizesOf([0, 1, 2, 3, 4]);
    // the root's octant 1 holds a level of spacing 1, its octant 6 one of 4
    expect([...(s.get(0) ?? [])]).toEqual(table({ 1: 1, 6: 4 }, 8));
    expect([...(s.get(1) ?? [])]).toEqual(table({ 3: 1 }, 4));
    expect([...(s.get(3) ?? [])]).toEqual(table({ 0: 1 }, 2));
    expect([...(s.get(4) ?? [])]).toEqual(table({}, 1));
  });

  it('ignores a child that is not drawn', () => {
    // node 3 is resident but its parent chain stops at 1: only 0 and 1 are drawn
    expect([...(sizesOf([0, 1]).get(0) ?? [])]).toEqual(table({ 1: 4 }, 8));
  });

  it('looks through a drawn node without points', () => {
    // node 1 is empty (structural, or emptied by the setup filter)
    const empty = (i: number) => i === 1;
    const alone = sizesOf([0, 1], empty);
    // nothing is drawn in octant 1 after all: the root fills it itself
    expect([...(alone.get(0) ?? [])]).toEqual(table({}, 8));
    expect(alone.has(1)).toBe(false);
    // …but what is drawn below the empty node still counts
    const below = sizesOf([0, 1, 3], empty);
    expect([...(below.get(0) ?? [])]).toEqual(table({ 1: 2 }, 8));
  });
});

describe('sameSizes', () => {
  it('compares two octant tables', () => {
    const a = new Float32Array(8).fill(2);
    const b = new Float32Array(8).fill(2);
    expect(sameSizes(a, b)).toBe(true);
    b[5] = 1;
    expect(sameSizes(a, b)).toBe(false);
  });
});
