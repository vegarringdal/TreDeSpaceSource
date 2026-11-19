// Pins the per-meshlet GPU cost of each draw path (drawLayout.ts). The
// renderer allocates from these numbers and the residency budget estimates
// with them, so a change here moves how much fits under a VRAM budget.
import { describe, expect, it } from 'vitest';
import { packModel } from '../src/lib/model/pack';
import { gpuSizingOf, indexWidthOf, meshletBytes } from '../src/lib/render/drawLayout';
import type { ColorGroup, ParsedModel } from '../src/lib/model/format';

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const PLAIN = { transparent: false, outline: false };
const GLASS = { transparent: true, outline: false };
const OUTLINE = { transparent: false, outline: true };

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
  it('costs vertex pull 80 B and MDI 112 B per meshlet with no optional list', () => {
    // cull 36 + info 32 + vis 4 + two lists (4 B entries / 20 B records)
    expect(meshletBytes('vp', PLAIN)).toBe(80);
    expect(meshletBytes('mdi', PLAIN)).toBe(112);
  });

  it('adds the sorted list and its candidates only on culling paths', () => {
    expect(meshletBytes('vp', GLASS) - meshletBytes('vp', PLAIN)).toBe(8 + 8);
    expect(meshletBytes('mdi', GLASS) - meshletBytes('mdi', PLAIN)).toBe(20 + 8);
    expect(meshletBytes('full', GLASS)).toBe(meshletBytes('full', PLAIN));
  });

  it('adds one list entry for the outline list and the full list on the no-cull path', () => {
    expect(meshletBytes('vp', OUTLINE) - meshletBytes('vp', PLAIN)).toBe(4);
    expect(meshletBytes('mdi', OUTLINE) - meshletBytes('mdi', PLAIN)).toBe(20);
    expect(meshletBytes('full', PLAIN) - meshletBytes('vp', PLAIN)).toBe(4);
  });

  it('never exceeds the old fixed 164 B, even with every list held', () => {
    const all = { transparent: true, outline: true };
    expect(meshletBytes('mdi', all)).toBeLessThanOrEqual(164);
    expect(meshletBytes('vp', all)).toBeLessThanOrEqual(164);
  });
});

describe('index width', () => {
  it('reads u16 only under MDI', () => {
    expect(indexWidthOf('mdi')).toBe(2);
    expect(indexWidthOf('vp')).toBe(1);
    expect(indexWidthOf('full')).toBe(1);
    expect(gpuSizingOf('vp', PLAIN).indexBytesPerTriangle).toBe(3);
    expect(gpuSizingOf('mdi', PLAIN).indexBytesPerTriangle).toBe(6);
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
