// Pins the per-meshlet GPU cost of each draw path (drawLayout.ts). The
// renderer allocates from these numbers and the residency budget estimates
// with them, so a change here moves how much fits under a VRAM budget.
import { describe, expect, it } from 'vitest';
import { packModel } from '../src/lib/model/pack';
import { gpuSizingOf, indexWidthOf, meshletBytes } from '../src/lib/render/drawLayout';
import type { ColorGroup, ParsedModel } from '../src/lib/model/format';

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** One colour group, one meshlet per triangle list in `tris`. */
function parsedWithTris(trisPerMeshlet: readonly number[][]): ParsedModel {
  const total = trisPerMeshlet.length;
  const descs = new DataView(new ArrayBuffer(total * 40));
  const flat: number[] = [];
  trisPerMeshlet.forEach((t, m) => {
    descs.setUint32(m * 40 + 4, flat.length, true);
    descs.setUint32(m * 40 + 8, 3, true);
    descs.setUint32(m * 40 + 12, t.length / 3, true);
    flat.push(...t);
  });
  const cg = {
    color: [1, 1, 1, 1],
    localVertCount: total * 3,
    meshletCount: total,
    drawRangeCount: 1,
    descs,
    positions: new Uint8Array(total * 3 * 6),
    normals: null,
    tris: Uint8Array.from(flat),
    bounds: new Float32Array(total * 12),
    drIds: new Uint32Array([0]),
    drStarts: new Uint32Array(1),
    drCounts: new Uint32Array(1),
    drMeshletStarts: new Uint32Array([0]),
    drMeshletCounts: new Uint32Array([total]),
  } as unknown as ColorGroup;
  return {
    name: 't',
    boundsMin: [0, 0, 0],
    boundsMax: [1, 1, 1],
    denseMin: null,
    denseMax: null,
    itemCount: 1,
    colorGroups: [cg],
    itemToCg: new Uint16Array(1),
    itemToDr: new Uint32Array(1),
  } as unknown as ParsedModel;
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe('meshletBytes', () => {
  it('costs vertex pull 100 B, MDI 160 B and the no-cull path 88 B per meshlet', () => {
    // cull 36 + info 32 + vis 4 + pass-1, pass-2, outline lists + sorted list
    // and candidates (culling paths) or the full list (no-cull path)
    expect(meshletBytes('vp')).toBe(36 + 32 + 4 + 3 * 4 + 8 + 8);
    expect(meshletBytes('mdi')).toBe(36 + 32 + 4 + 3 * 20 + 20 + 8);
    expect(meshletBytes('full')).toBe(36 + 32 + 4 + 3 * 4 + 4);
  });

  it('never exceeds the old fixed 164 B', () => {
    for (const path of ['vp', 'mdi', 'full'] as const) {
      expect(meshletBytes(path)).toBeLessThanOrEqual(164);
    }
  });
});

describe('index width', () => {
  it('reads u16 only under MDI', () => {
    expect(indexWidthOf('mdi')).toBe(2);
    expect(indexWidthOf('vp')).toBe(1);
    expect(indexWidthOf('full')).toBe(1);
    expect(gpuSizingOf('vp').indexBytesPerTriangle).toBe(3);
    expect(gpuSizingOf('mdi').indexBytesPerTriangle).toBe(6);
  });

  it('packs meshlet-local indices as u8, padded to whole words', () => {
    const packed = packModel(
      parsedWithTris([
        [0, 1, 2],
        [2, 1, 63, 5, 6, 7],
      ]),
    );
    expect(packed.indices8.length % 4).toBe(0);
    expect([...packed.indices8.subarray(0, 9)]).toEqual([0, 1, 2, 2, 1, 63, 5, 6, 7]);
    const cull = new Uint32Array(packed.cull);
    // first_index of meshlet 1 counts indices, not bytes or words
    expect(cull[9 + 6]).toBe(3);
  });
});
