// GLB reading layer for the TS cooker: container parse, accessor readers and
// node-transform math. Pure input-side code — the cook pipeline (meshletize +
// encode + CADM write) lives in cook.ts.

// -----------------------------------------------------------------------------
// GLB container
// -----------------------------------------------------------------------------

export interface Gltf {
  scene?: number;
  asset?: { extras?: { web3dversion?: number } };
  scenes?: { nodes?: number[]; extras?: Record<string, unknown> }[];
  nodes?: {
    name?: string;
    children?: number[];
    mesh?: number;
    matrix?: number[];
    translation?: number[];
    rotation?: number[];
    scale?: number[];
    extensions?: { EXT_mesh_gpu_instancing?: { attributes?: Record<string, number> } };
  }[];
  meshes?: { name?: string; primitives: Primitive[] }[];
  materials?: { pbrMetallicRoughness?: { baseColorFactor?: number[] } }[];
  accessors?: {
    bufferView?: number;
    byteOffset?: number;
    componentType: number;
    normalized?: boolean;
    count: number;
    type: string;
  }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
}

export interface Primitive {
  attributes: Record<string, number>;
  indices?: number;
  material?: number;
  mode?: number;
}

export function parseGlb(bytes: ArrayBuffer): { gltf: Gltf; bin: Uint8Array } {
  const dv = new DataView(bytes);
  if (dv.getUint32(0, true) !== 0x46546c67) {
    throw new Error('not a GLB (bad magic)');
  }
  const total = dv.getUint32(8, true);
  let off = 12;
  let json: Gltf | null = null;
  let bin = new Uint8Array(0);
  while (off + 8 <= total) {
    const len = dv.getUint32(off, true);
    const type = dv.getUint32(off + 4, true);
    const chunk = new Uint8Array(bytes, off + 8, len);
    if (type === 0x4e4f534a) {
      json = JSON.parse(new TextDecoder().decode(chunk)) as Gltf;
    } else if (type === 0x004e4942) {
      bin = chunk;
    }
    off += 8 + len + (len % 4 === 0 ? 0 : 4 - (len % 4));
  }
  if (!json) {
    throw new Error('GLB has no JSON chunk');
  }
  return { gltf: json, bin };
}

// -----------------------------------------------------------------------------
// accessors
// -----------------------------------------------------------------------------

export function readPositions(g: Gltf, bin: Uint8Array, accessor: number): Float32Array {
  const a = g.accessors?.[accessor];
  if (a?.componentType !== 5126 || a.type !== 'VEC3') {
    throw new Error('POSITION must be float VEC3');
  }
  const bv = g.bufferViews?.[a.bufferView ?? -1];
  if (!bv) {
    throw new Error('POSITION has no bufferView');
  }
  const stride = bv.byteStride ?? 12;
  const base = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const out = new Float32Array(a.count * 3);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  for (let i = 0; i < a.count; i++) {
    const o = base + i * stride;
    out[i * 3] = dv.getFloat32(o, true);
    out[i * 3 + 1] = dv.getFloat32(o + 4, true);
    out[i * 3 + 2] = dv.getFloat32(o + 8, true);
  }
  return out;
}

const TYPE_COMPS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/** Generic float attribute reader: float32, plus (s/u)norm 8/16 when the
 *  accessor is `normalized` (EXT_mesh_gpu_instancing rotations etc). */
export function readFloats(g: Gltf, bin: Uint8Array, accessor: number, expectComps: number): Float32Array {
  const a = g.accessors?.[accessor];
  if (!a) {
    throw new Error('missing accessor');
  }
  const comps = TYPE_COMPS[a.type];
  if (comps !== expectComps) {
    throw new Error(`accessor type ${a.type}, expected ${expectComps} components`);
  }
  const bv = g.bufferViews?.[a.bufferView ?? -1];
  if (!bv) {
    throw new Error('accessor has no bufferView');
  }
  const compSize = a.componentType === 5126 ? 4 : a.componentType === 5122 || a.componentType === 5123 ? 2 : 1;
  const stride = bv.byteStride ?? comps * compSize;
  const base = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const out = new Float32Array(a.count * comps);
  for (let i = 0; i < a.count; i++) {
    const o = base + i * stride;
    for (let c = 0; c < comps; c++) {
      let v: number;
      switch (a.componentType) {
        case 5126:
          v = dv.getFloat32(o + c * 4, true);
          break;
        case 5122: // SHORT (snorm when normalized)
          v = dv.getInt16(o + c * 2, true);
          if (a.normalized) {
            v = Math.max(-1, v / 32767);
          }
          break;
        case 5123: // UNSIGNED_SHORT
          v = dv.getUint16(o + c * 2, true);
          if (a.normalized) {
            v /= 65535;
          }
          break;
        case 5120: // BYTE
          v = dv.getInt8(o + c);
          if (a.normalized) {
            v = Math.max(-1, v / 127);
          }
          break;
        case 5121: // UNSIGNED_BYTE
          v = dv.getUint8(o + c);
          if (a.normalized) {
            v /= 255;
          }
          break;
        default:
          throw new Error(`unsupported componentType ${a.componentType}`);
      }
      out[i * comps + c] = v;
    }
  }
  return out;
}

export function readIndices(g: Gltf, bin: Uint8Array, accessor: number | undefined, vertCount: number): Uint32Array {
  if (accessor == null) {
    const out = new Uint32Array(vertCount);
    for (let i = 0; i < vertCount; i++) {
      out[i] = i;
    }
    return out;
  }
  const a = g.accessors?.[accessor];
  if (!a) {
    throw new Error('bad index accessor');
  }
  const bv = g.bufferViews?.[a.bufferView ?? -1];
  if (!bv) {
    throw new Error('indices have no bufferView');
  }
  const base = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const out = new Uint32Array(a.count);
  if (a.componentType === 5123) {
    for (let i = 0; i < a.count; i++) {
      out[i] = dv.getUint16(base + i * 2, true);
    }
  } else if (a.componentType === 5125) {
    for (let i = 0; i < a.count; i++) {
      out[i] = dv.getUint32(base + i * 4, true);
    }
  } else if (a.componentType === 5121) {
    for (let i = 0; i < a.count; i++) {
      out[i] = dv.getUint8(base + i);
    }
  } else {
    throw new Error(`unsupported index componentType ${a.componentType}`);
  }
  return out;
}

// -----------------------------------------------------------------------------
// node transforms
// -----------------------------------------------------------------------------

export type M4 = Float64Array; // column-major

export function m4Identity(): M4 {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function m4Mul(a: M4, b: M4): M4 {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

export function nodeLocal(n: NonNullable<Gltf['nodes']>[number]): M4 {
  if (n.matrix) {
    return Float64Array.from(n.matrix);
  }
  const t = n.translation ?? [0, 0, 0];
  const q = n.rotation ?? [0, 0, 0, 1];
  const s = n.scale ?? [1, 1, 1];
  const [x, y, z, w] = q;
  const m = m4Identity();
  m[0] = (1 - 2 * (y * y + z * z)) * s[0];
  m[1] = 2 * (x * y + z * w) * s[0];
  m[2] = 2 * (x * z - y * w) * s[0];
  m[4] = 2 * (x * y - z * w) * s[1];
  m[5] = (1 - 2 * (x * x + z * z)) * s[1];
  m[6] = 2 * (y * z + x * w) * s[1];
  m[8] = 2 * (x * z + y * w) * s[2];
  m[9] = 2 * (y * z - x * w) * s[2];
  m[10] = (1 - 2 * (x * x + y * y)) * s[2];
  m[12] = t[0];
  m[13] = t[1];
  m[14] = t[2];
  return m;
}

/** Normal matrix (inverse-transpose of the upper-left 3x3), column-major 3x3.
 *  Returns null for a degenerate transform. */
export function m3NormalMatrix(m: M4): Float64Array | null {
  const a = m[0],
    b = m[1],
    c = m[2],
    d = m[4],
    e = m[5],
    f = m[6],
    g = m[8],
    h = m[9],
    i = m[10];
  const det = a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e);
  if (Math.abs(det) < 1e-12) {
    return null;
  }
  const inv = 1 / det;
  // inverse (cofactor/det), then transpose = write cofactors row-major
  const o = new Float64Array(9);
  o[0] = (e * i - f * h) * inv;
  o[1] = (f * g - d * i) * inv;
  o[2] = (d * h - e * g) * inv;
  o[3] = (c * h - b * i) * inv;
  o[4] = (a * i - c * g) * inv;
  o[5] = (b * g - a * h) * inv;
  o[6] = (b * f - c * e) * inv;
  o[7] = (c * d - a * f) * inv;
  o[8] = (a * e - b * d) * inv;
  return o;
}
