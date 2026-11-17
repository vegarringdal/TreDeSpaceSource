// .tdpp reader (src/lib/tdpp/tdppFormat.ts) against a small synthetic file
// written by the trueview cook (`tdpp_synth tests/fixtures/synthetic.tdpp
// 40000 --setup`). Expected sums come from trueview's own Rust reader
// (`tdpp_dump`), so this pins TS ↔ Rust agreement, MeshoptDecoder included.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  checkHierarchy,
  decodeNode,
  NORMAL_RING_CODES,
  openTdpp,
  ringNormalTable,
  type TdppSource,
} from '../src/lib/tdpp/tdppFormat';

const root = fileURLToPath(new URL('..', import.meta.url));
const bytes = new Uint8Array(readFileSync(resolve(root, 'tests/fixtures/synthetic.tdpp')));
const src: TdppSource = {
  size: bytes.byteLength,
  read: async (offset, length) => bytes.slice(offset, offset + length),
};

/** Per-node sums printed by trueview's `tdpp_dump`. */
const RUST = [
  {
    node: 0,
    count: 9422,
    sumPos: [1175.807, 793.573, -26213.175],
    sumRgb: 3616329,
    sumIntensity: 307926906,
    sumSetup: 14172,
    sumNormal: 305593812,
  },
  {
    node: 1,
    count: 4143,
    sumPos: [-66214.407, -67465.929, -26771.685],
    sumRgb: 1064598,
    sumIntensity: 134528141,
    sumSetup: 6218,
    sumNormal: 135265034,
  },
  {
    node: 2,
    count: 4835,
    sumPos: [75840.035, -78654.378, -35216.239],
    sumRgb: 1840854,
    sumIntensity: 157895805,
    sumSetup: 7328,
    sumNormal: 156866612,
  },
];

async function open() {
  const f = await openTdpp(src);
  if (!f.data) {
    throw new Error(f.error?.msg);
  }
  return f.data;
}

describe('tdpp reader', () => {
  it('parses header, hierarchy and metadata', async () => {
    const { header, nodes, meta } = await open();
    expect(header.pointCount).toBe(40000);
    expect(header.nodeCount).toBe(9);
    expect(header.origin).toEqual([500000, 6600000, 12]);
    expect(header.hasNormals && header.hasColor && header.hasIntensity && header.hasSetup).toBe(true);
    expect(nodes[0].parent).toBe(-1);
    for (const n of nodes.slice(1)) {
      const p = nodes[n.parent];
      expect(n.parent).toBeLessThan(n.index);
      expect(n.index).toBeGreaterThanOrEqual(p.firstChild);
      expect(n.index).toBeLessThan(p.firstChild + p.childCount);
      expect(n.depth).toBe(p.depth + 1);
    }
    expect(nodes.reduce((s, n) => s + n.pointCount, 0)).toBe(40000);
    expect(meta.gridScale).toBe(0.001);
    expect(meta.setups).toHaveLength(1);
    const s = meta.setups[0];
    expect(s.index).toBe(0);
    expect(s.translation).toEqual([500010, 6600020, 13.5]);
    expect(s.faces?.map((f) => f.levels.length)).toEqual([2, 2, 2, 2, 2, 2]);
  });

  it('reads panorama blobs at their offsets', async () => {
    const { meta } = await open();
    for (const face of meta.setups[0].faces ?? []) {
      const lvl = face.levels[0];
      const blob = await src.read(lvl.offset, lvl.size);
      expect(blob.length).toBe(64);
      expect(blob.every((b) => b === face.face)).toBe(true);
    }
  });

  it('decodes nodes like the Rust reader', async () => {
    const { nodes } = await open();
    for (const want of RUST) {
      const n = nodes[want.node];
      const d = await decodeNode(n, await src.read(n.payloadOffset, n.payloadSize));
      if (!d.data) {
        throw new Error(d.error?.msg);
      }
      const { count, positions, rgbs, intensity, normals, clusterCount } = d.data;
      expect(count).toBe(want.count);
      const sum = [0, 0, 0];
      let rgb = 0;
      let setup = 0;
      let inten = 0;
      let nrm = 0;
      for (let i = 0; i < count; i++) {
        for (let k = 0; k < 3; k++) {
          sum[k] += positions[3 * i + k];
        }
        rgb += rgbs[4 * i] + rgbs[4 * i + 1] + rgbs[4 * i + 2];
        setup += rgbs[4 * i + 3];
        inten += intensity[i];
        nrm += normals ? normals[i] : 0;
      }
      for (let k = 0; k < 3; k++) {
        expect(Math.abs(sum[k] - want.sumPos[k])).toBeLessThan(0.5);
      }
      expect([rgb, inten, setup, nrm]).toEqual([want.sumRgb, want.sumIntensity, want.sumSetup, want.sumNormal]);
      expect(clusterCount.reduce((a, b) => a + b, 0)).toBe(count);
    }
  });

  it('rejects a hierarchy that cannot be walked', async () => {
    const f = await open();
    expect(checkHierarchy(f.nodes, f.nodes.length)).toBeNull();
    expect(checkHierarchy(f.nodes, f.nodes.length + 1)).toMatch(/nodes/);
    // a child range pointing back at the root would loop the LOD walk forever
    const loop = f.nodes.map((n) => (n.index === 1 ? { ...n, firstChild: 0, childCount: 1 } : n));
    expect(checkHierarchy(loop, loop.length)).toMatch(/node 1 has children/);
    const orphan = f.nodes.map((n) => (n.index === 1 ? { ...n, parent: 2 } : n));
    expect(checkHierarchy(orphan, orphan.length)).toMatch(/node 1 has parent 2/);
  });

  it('builds the normal ring table', () => {
    const t = ringNormalTable();
    expect(t.length).toBe(NORMAL_RING_CODES * 3);
    expect([t[0], t[1], t[2]]).toEqual([0, 0, 1]);
    const last = (NORMAL_RING_CODES - 1) * 3;
    expect(t[last + 2]).toBeCloseTo(-1, 6);
    for (let c = 0; c < NORMAL_RING_CODES; c += 997) {
      expect(Math.hypot(t[3 * c], t[3 * c + 1], t[3 * c + 2])).toBeCloseTo(1, 5);
    }
  });
});
