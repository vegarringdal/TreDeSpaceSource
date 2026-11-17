import { describe, expect, it } from 'vitest';
import type { ExportNode, ExportPrimitive } from '../src/lib/model/glbWrite';
import { bakeMatrices, exportTreeToFlat, flatTransferables } from '../src/lib/model/mergedFlat';

const prim = (color: [number, number, number, number], verts: number[], idx: number[]): ExportPrimitive => ({
  positions: Float32Array.from(verts),
  indices: Uint32Array.from(idx),
  min: [0, 0, 0],
  max: [1, 1, 1],
  color,
});

const RED: [number, number, number, number] = [1, 0, 0, 1];
const BLUE: [number, number, number, number] = [0, 0, 1, 1];

describe('exportTreeToFlat', () => {
  it('groups primitives by colour with node-local indices and one range each', () => {
    const tree: ExportNode = {
      name: '/root',
      children: [
        { name: 'a', primitives: [prim(RED, [0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2])] },
        {
          name: 'b',
          primitives: [prim(BLUE, [5, 5, 5, 6, 5, 5, 5, 6, 5], [0, 1, 2]), prim(RED, [9, 9, 9, 8, 9, 9, 9, 8, 9], [2, 1, 0])],
        },
      ],
    };
    const m = exportTreeToFlat(tree);
    const hier = JSON.parse(m.hierarchyJson) as [number, string, number | null][];
    // pre-order: root, a, a's leaf (single primitive reuses the name), b, b #1, b #2
    expect(hier).toEqual([
      [1, '/root', null],
      [2, 'a', 1],
      [3, 'a', 2],
      [4, 'b', 1],
      [5, 'b #1', 4],
      [6, 'b #2', 4],
    ]);
    // two colour nodes: red (a + b#2), blue (b#1) — first-seen order
    expect(m.nodes.length).toBe(12);
    expect(Array.from(m.nodes.subarray(0, 6))).toEqual([0, 6, 0, 6, 0, 2]);
    expect(Array.from(m.nodes.subarray(6, 12))).toEqual([6, 3, 6, 3, 2, 1]);
    expect(Array.from(m.colors)).toEqual([...RED, ...BLUE]);
    // red node: second primitive's indices are offset by the first's 3 vertices
    expect(Array.from(m.indices.subarray(0, 6))).toEqual([0, 1, 2, 5, 4, 3]);
    expect(Array.from(m.ranges)).toEqual([3, 0, 3, 6, 3, 3, 5, 0, 3]);
    expect(Array.from(m.positions.subarray(18, 27))).toEqual([5, 5, 5, 6, 5, 5, 5, 6, 5]);
    expect(flatTransferables(m)).toHaveLength(5);
  });

  it('skips empty primitives and names unnamed nodes', () => {
    const tree: ExportNode = {
      name: 'r',
      children: [{ primitives: [prim(RED, [], []), prim(RED, [0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2])] }],
    };
    const m = exportTreeToFlat(tree);
    const hier = JSON.parse(m.hierarchyJson) as [number, string, number | null][];
    expect(hier).toEqual([
      [1, 'r', null],
      [2, 'node 0', 1],
      [3, 'node 0 #2', 2],
    ]);
    expect(m.ranges.length).toBe(3);
  });
});

describe('bakeMatrices', () => {
  it('applies a node matrix to its primitives and clears it', () => {
    const node: ExportNode = {
      matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1],
      primitives: [prim(RED, [1, 2, 3], [])],
    };
    bakeMatrices([node]);
    expect(Array.from(node.primitives?.[0].positions ?? [])).toEqual([11, 22, 33]);
    expect(node.matrix).toBeUndefined();
  });
});
