// Minimal glTF 2.0 (GLB) writer for the Export panel. Input is a simple node
// tree with per-color triangle primitives; output is a complete .glb binary.
// Everything is wrapped in one Z-up → Y-up root node (the app is Z-up, glTF
// is Y-up). No normals are written — glTF clients flat-shade then, matching
// the app's flatshaded look. Materials are deduplicated per RGBA.

export interface ExportPrimitive {
  positions: Float32Array; // xyz triplets
  indices: Uint32Array;
  min: [number, number, number];
  max: [number, number, number];
  /** 0-1 linear RGBA — becomes a shared baseColorFactor material. */
  color: [number, number, number, number];
}

export interface ExportNode {
  name?: string;
  /** column-major mat4 (glTF layout — same as the app's m4). */
  matrix?: number[];
  primitives?: ExportPrimitive[];
  children?: ExportNode[];
}

// column-major: (x, y, z) -> (x, z, -y)
const Z_UP_TO_Y_UP = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1];

interface GltfNode {
  name?: string;
  matrix?: number[];
  mesh?: number;
  children?: number[];
}

/** Stream a GLB to `write`: one header+JSON block, then every geometry part
 *  as a no-copy view on the caller's arrays, then padding. Returns the total
 *  byte size. Peak allocation is the JSON chunk — the binary payload is never
 *  copied or concatenated. */
export function writeGlb(
  roots: ExportNode[],
  opts: { zUp?: boolean; bareRoot?: boolean },
  write: (bytes: Uint8Array) => void,
): number {
  const binParts: (Float32Array | Uint32Array)[] = [];
  let binLength = 0;
  const bufferViews: object[] = [];
  const accessors: object[] = [];
  const materials: object[] = [];
  const materialIndex = new Map<string, number>();
  const meshes: object[] = [];
  const nodes: GltfNode[] = [];

  const addPart = (data: Float32Array | Uint32Array, target: number): number => {
    const byteOffset = binLength;
    binParts.push(data);
    binLength += data.byteLength; // all parts are 4-byte aligned by element size
    bufferViews.push({ buffer: 0, byteOffset, byteLength: data.byteLength, target });
    return bufferViews.length - 1;
  };

  // Colors go into baseColorFactor UNCONVERTED — a deliberate deviation from
  // the glTF spec (which defines baseColorFactor as linear; spec-correct
  // viewers therefore show these a bit brighter than the app). The director's
  // call (2026-07-27): the app's colors are opaque display values everywhere,
  // no sRGB<->linear conversion in any file path — the generic GLB import is
  // pass-through to match, so files round-trip bit-exactly.
  const materialFor = (color: [number, number, number, number]): number => {
    const key = color.map((c) => c.toFixed(4)).join(',');
    const found = materialIndex.get(key);
    if (found !== undefined) {
      return found;
    }
    const idx = materials.length;
    materials.push({
      pbrMetallicRoughness: {
        baseColorFactor: [...color],
        metallicFactor: 0,
        roughnessFactor: 1,
      },
      doubleSided: true,
      ...(color[3] < 1 ? { alphaMode: 'BLEND' } : {}),
    });
    materialIndex.set(key, idx);
    return idx;
  };

  const addMesh = (prims: ExportPrimitive[]): number => {
    const primitives = prims.map((p) => {
      const posView = addPart(p.positions, 34962);
      // accessor min/max must equal the f32 data EXACTLY (validator checks) —
      // the upstream p.min/p.max are dequantized AABBs and can be a few ulps
      // off the true vertex extremes, so recompute from the array itself
      const mn = [Infinity, Infinity, Infinity];
      const mx = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < p.positions.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          const v = p.positions[i + k];
          if (v < mn[k]) {
            mn[k] = v;
          }
          if (v > mx[k]) {
            mx[k] = v;
          }
        }
      }
      accessors.push({
        bufferView: posView,
        componentType: 5126, // FLOAT
        count: p.positions.length / 3,
        type: 'VEC3',
        min: p.positions.length > 0 ? mn : [0, 0, 0],
        max: p.positions.length > 0 ? mx : [0, 0, 0],
      });
      const posAccessor = accessors.length - 1;
      const idxView = addPart(p.indices, 34963);
      accessors.push({
        bufferView: idxView,
        componentType: 5125, // UNSIGNED_INT
        count: p.indices.length,
        type: 'SCALAR',
      });
      return {
        attributes: { POSITION: posAccessor },
        indices: accessors.length - 1,
        material: materialFor(p.color),
      };
    });
    meshes.push({ primitives });
    return meshes.length - 1;
  };

  const addNode = (n: ExportNode): number => {
    const node: GltfNode = {};
    if (n.name) {
      node.name = n.name;
    }
    if (n.matrix) {
      node.matrix = [...n.matrix];
    }
    if (n.primitives && n.primitives.length > 0) {
      node.mesh = addMesh(n.primitives);
    }
    const idx = nodes.length;
    nodes.push(node);
    if (n.children && n.children.length > 0) {
      node.children = n.children.map((c) => addNode(c));
    }
    return idx;
  };

  // Z-up→Y-up root above everything — unless the caller wants raw Z-up
  // (some pipelines expect it; glTF viewers then show the model tipped).
  // bareRoot skips the wrapper node entirely (the .tdp export: Z-up, no
  // transforms, and no extra hierarchy level after re-import).
  let sceneNodes: number[];
  if (opts.bareRoot) {
    sceneNodes = roots.map((r) => addNode(r));
  } else {
    const rootIdx = nodes.length;
    nodes.push(opts.zUp ? { name: 'root (Z-up)' } : { name: 'root (Z-up to Y-up)', matrix: [...Z_UP_TO_Y_UP] });
    nodes[rootIdx].children = roots.map((r) => addNode(r));
    sceneNodes = [rootIdx];
  }

  const json = {
    asset: { version: '2.0', generator: 'tredespace-export' },
    scene: 0,
    scenes: [{ nodes: sceneNodes }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: binLength }],
  };

  // GLB container: 12 B header + JSON chunk (space-padded) + BIN chunk
  // (zero-padded). Everything through the BIN chunk header goes out as one
  // block, then the parts stream as views on the source arrays.
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPadded = Math.ceil(jsonBytes.length / 4) * 4;
  const binPadded = Math.ceil(binLength / 4) * 4; // = binLength (f32/u32 parts)
  const total = 12 + 8 + jsonPadded + 8 + binPadded;
  const head = new Uint8Array(12 + 8 + jsonPadded + 8);
  const dv = new DataView(head.buffer);
  dv.setUint32(0, 0x46546c67, true); // 'glTF'
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonPadded, true);
  dv.setUint32(16, 0x4e4f534a, true); // 'JSON'
  head.set(jsonBytes, 20);
  head.fill(0x20, 20 + jsonBytes.length, 20 + jsonPadded); // space padding
  const binStart = 20 + jsonPadded;
  dv.setUint32(binStart, binPadded, true);
  dv.setUint32(binStart + 4, 0x004e4942, true); // 'BIN'
  write(head);
  for (const part of binParts) {
    write(new Uint8Array(part.buffer, part.byteOffset, part.byteLength));
  }
  if (binPadded > binLength) {
    write(new Uint8Array(binPadded - binLength));
  }
  return total;
}

/** Assemble a whole GLB in memory (the no-OPFS export path). */
export function buildGlb(roots: ExportNode[], opts: { zUp?: boolean; bareRoot?: boolean } = {}): ArrayBuffer {
  const chunks: Uint8Array[] = [];
  const total = writeGlb(roots, opts, (b) => chunks.push(b));
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out.buffer;
}
