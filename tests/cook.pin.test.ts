// Pins the exact CADM bytes cooked from small synthetic GLBs, so the cook.ts
// module split is provably a pure move. Regenerate snapshots only for
// intentional cooker changes (npx vitest run -u).
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { cookGenericGlb, cookGlb } from '../src/lib/cooker/cook';

// -----------------------------------------------------------------------------
// GLB builder
// -----------------------------------------------------------------------------

function buildGlb(json: object, bin: Uint8Array): ArrayBuffer {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const binPad = (4 - (bin.length % 4)) % 4;
  const total = 12 + 8 + jsonBytes.length + jsonPad + 8 + bin.length + binPad;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length + jsonPad, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  out.fill(0x20, 20 + jsonBytes.length, 20 + jsonBytes.length + jsonPad);
  const binHead = 20 + jsonBytes.length + jsonPad;
  dv.setUint32(binHead, bin.length + binPad, true);
  dv.setUint32(binHead + 4, 0x004e4942, true);
  out.set(bin, binHead + 8);
  return out.buffer;
}

// Quad in the XY plane: 4 verts, 2 triangles, authored +Z normals.
const POSITIONS = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
const NORMALS = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
const INDICES = new Uint16Array([0, 1, 2, 0, 2, 3]);

function quadBin(): Uint8Array {
  const bin = new Uint8Array(POSITIONS.byteLength + NORMALS.byteLength + INDICES.byteLength);
  bin.set(new Uint8Array(POSITIONS.buffer), 0);
  bin.set(new Uint8Array(NORMALS.buffer), POSITIONS.byteLength);
  bin.set(new Uint8Array(INDICES.buffer), POSITIONS.byteLength + NORMALS.byteLength);
  return bin;
}

const QUAD_BUFFER_VIEWS = [
  { buffer: 0, byteOffset: 0, byteLength: POSITIONS.byteLength },
  { buffer: 0, byteOffset: POSITIONS.byteLength, byteLength: NORMALS.byteLength },
  { buffer: 0, byteOffset: POSITIONS.byteLength + NORMALS.byteLength, byteLength: INDICES.byteLength },
];

const QUAD_ACCESSORS = [
  { bufferView: 0, componentType: 5126, count: 4, type: 'VEC3' },
  { bufferView: 1, componentType: 5126, count: 4, type: 'VEC3' },
  { bufferView: 2, componentType: 5123, count: 6, type: 'SCALAR' },
];

function genericGlb(): ArrayBuffer {
  return buildGlb(
    {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0, 1] }],
      nodes: [
        { name: 'red-quad', mesh: 0 },
        { name: 'green-quad', mesh: 1, translation: [2, 0, 0] },
      ],
      meshes: [
        { primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] },
        { primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 1 }] },
      ],
      materials: [
        { pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1] } },
        { pbrMetallicRoughness: { baseColorFactor: [0, 1, 0, 0.5] } },
      ],
      accessors: QUAD_ACCESSORS,
      bufferViews: QUAD_BUFFER_VIEWS,
      buffers: [{ byteLength: quadBin().length }],
    },
    quadBin(),
  );
}

function mergedGlb(): ArrayBuffer {
  return buildGlb(
    {
      asset: { version: '2.0', extras: { web3dversion: 2 } },
      scene: 0,
      scenes: [
        {
          nodes: [0],
          extras: {
            id_hierarchy: { '1': ['Root', '*'], '2': ['Part', '1'] },
            draw_ranges_node0: { '2': [0, 6] },
          },
        },
      ],
      nodes: [{ name: 'node0', mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 2, material: 0 }] }],
      materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.2, 0.4, 0.6, 1] } }],
      accessors: QUAD_ACCESSORS,
      bufferViews: QUAD_BUFFER_VIEWS,
      buffers: [{ byteLength: quadBin().length }],
    },
    quadBin(),
  );
}

function sha(bytes: ArrayBuffer): string {
  return createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
}

// -----------------------------------------------------------------------------
// pins
// -----------------------------------------------------------------------------

describe('cook output pins', () => {
  it('cooks a generic GLB with authored normals', async () => {
    const r = await cookGenericGlb(genericGlb());
    expect(r.hasNormals).toBe(true);
    expect(sha(r.bytes)).toMatchSnapshot();
  });

  it('cooks a generic GLB flat-shaded and Z-up', async () => {
    const r = await cookGenericGlb(genericGlb(), { normals: false, zUpInput: true });
    expect(r.hasNormals).toBe(false);
    expect(sha(r.bytes)).toMatchSnapshot();
  });

  it('cooks a merged (web3dversion 2) GLB', async () => {
    const r = await cookGlb(mergedGlb());
    expect(r.rootName).toBe('Root');
    expect(sha(r.bytes)).toMatchSnapshot();
  });

  it('rejects a non-merged GLB in the merged path', async () => {
    await expect(cookGlb(genericGlb())).rejects.toThrow(/web3dversion/);
  });
});
