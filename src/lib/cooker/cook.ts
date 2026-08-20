// In-browser GLB → cooked CADM cooker (TypeScript port of the reference
// cad-cooker pipeline, meshoptimizer JS for clusterize/encode). Produces files
// our own parser (format.ts) reads — round-trip tested. The Rust/wasm cooker
// (rust_src/ → src/lib/cooker/wasm/) is now the primary path; this TS cook
// remains as a fallback and for the generic/standard-GLB route. Same format
// contract either way.
//
// Scope: GLB container (JSON + BIN chunk), TRIANGLES primitives, POSITION +
// NORMAL + indices, node transforms, EXT_mesh_gpu_instancing (instances baked
// out so every instance is a selectable item), material baseColorFactor →
// color groups. Authored normals are oct-encoded into the CADM normal stream
// (models without them shade with per-fragment flat normals). NOT supported:
// textures/UVs, skinning, morph targets, Draco/quantization extensions.
import { MeshoptClusterizer, MeshoptEncoder } from 'meshoptimizer';
import {
  type Gltf,
  type M4,
  m3NormalMatrix,
  m4Mul,
  nodeLocal,
  parseGlb,
  readFloats,
  readIndices,
  readPositions,
} from './glbRead';

const MAGIC = 0x4d444143; // "CADM"
const FORMAT_VERSION = 7;
const HEADER_SIZE = 216;
const CG_HEADER_SIZE = 128;
const MAX_VERTS = 64;
const MAX_TRIS = 124;

// -----------------------------------------------------------------------------
// cook pipeline
// -----------------------------------------------------------------------------

interface DrawRangeGeo {
  id: number; // sparse draw-range id (hierarchy leaf id)
  name: string;
  parentEntry: number; // hierarchy entry index of the owning node
  positions: Float32Array; // world space
  /** world-space unit normals (parallel to positions), or null = flat shading */
  normals: Float32Array | null;
  indices: Uint32Array;
  colorKey: string;
  color: [number, number, number, number];
}

interface HierEntry {
  id: number;
  name: string;
  parent: number; // 0xFFFFFFFF = root
}

export interface CookResult {
  bytes: ArrayBuffer;
  /** The hierarchy root's name (merged GLBs) — '' for generic GLBs. */
  rootName: string;
}

export async function cookGlb(glbBytes: ArrayBuffer): Promise<CookResult> {
  await Promise.all([MeshoptClusterizer.ready, MeshoptEncoder.ready]);
  const { gltf, bin } = parseGlb(glbBytes);
  // merged GLBs (rvm2glb, web3dversion 2) carry draw ranges + the full id
  // hierarchy in scene extras — the format the reference cooker was built for.
  // Anything else is rejected: the importer skips it with a Console note.
  if (gltf.asset?.extras?.web3dversion !== 2) {
    throw new Error('not a merged GLB (asset.extras.web3dversion !== 2) — skipped');
  }
  return cookMerged(gltf, bin);
}

/** Generic (non-merged) GLB cook: any exporter's node tree, plus the
 *  rvm2glb CLI's "standard" and EXT_mesh_gpu_instancing "instanced" outputs.
 *  The importer falls back to this when the merged cook rejects a file. */
export async function cookGenericGlb(
  glbBytes: ArrayBuffer,
  opts: { normals?: boolean; zUpInput?: boolean } = {},
): Promise<{ bytes: ArrayBuffer; hasNormals: boolean }> {
  await Promise.all([MeshoptClusterizer.ready, MeshoptEncoder.ready]);
  const { gltf, bin } = parseGlb(glbBytes);
  return cookGeneric(gltf, bin, opts.normals !== false, opts.zUpInput === true);
}

// -----------------------------------------------------------------------------
// merged (rvm2glb) front-end
// -----------------------------------------------------------------------------
// Mirrors cad-cooker/cook.rs: one COLOR GROUP per geometry node ("node<N>"),
// draw ranges = index spans within that node (scene extras), hierarchy from
// id_hierarchy (leaf ids == draw-range ids). Positions are used as-is (the
// reference ignores node transforms for these files).
async function cookMerged(gltf: Gltf, bin: Uint8Array): Promise<CookResult> {
  const scene = gltf.scenes?.[gltf.scene ?? 0];
  const extras = scene?.extras ?? {};

  // hierarchy: { "<id>": [name, "<parentId>" | "*"] }
  const hierRaw = extras.id_hierarchy as Record<string, [string, string]> | undefined;
  if (!hierRaw) {
    throw new Error('merged GLB: scene extras missing id_hierarchy');
  }
  const hierIds = Object.keys(hierRaw);
  const idToEntry = new Map<number, number>();
  hierIds.forEach((k, i) => {
    idToEntry.set(Number(k), i);
  });
  const entries: HierEntry[] = hierIds.map((k) => {
    const [name, parent] = hierRaw[k];
    return {
      id: Number(k),
      name,
      parent: parent === '*' ? 0xffffffff : (idToEntry.get(Number(parent)) ?? 0xffffffff),
    };
  });
  const rootName = entries.find((e) => e.parent === 0xffffffff)?.name ?? '';

  // draw_ranges_node<N>: { "<drawRangeId>": [indexStart, indexCount] }
  interface Dr {
    id: number;
    start: number;
    count: number;
  }
  const byNode = new Map<number, Dr[]>();
  for (const [key, val] of Object.entries(extras)) {
    const m = /^draw_ranges_node(\d+)$/.exec(key);
    if (!m) {
      continue;
    }
    const nodeIdx = Number(m[1]);
    const list: Dr[] = Object.entries(val as Record<string, [number, number]>).map(([id, r]) => ({
      id: Number(id),
      start: r[0],
      count: r[1],
    }));
    list.sort((a, b) => a.id - b.id);
    byNode.set(nodeIdx, list);
  }
  if (byNode.size === 0) {
    throw new Error('merged GLB: no draw_ranges_node* in scene extras');
  }

  // geometry per node<N> (name lookup, like the reference)
  const nodeByName = new Map<number, NonNullable<Gltf['nodes']>[number]>();
  for (const n of gltf.nodes ?? []) {
    const m = n.name && /^node(\d+)$/.exec(n.name);
    if (m) {
      nodeByName.set(Number(m[1]), n);
    }
  }

  const cgs: CgInput[] = [];
  for (const nodeIdx of [...byNode.keys()].sort((a, b) => a - b)) {
    const node = nodeByName.get(nodeIdx);
    const mesh = node?.mesh != null ? gltf.meshes?.[node.mesh] : undefined;
    const prim = mesh?.primitives[0];
    if (!prim || prim.attributes.POSITION == null) {
      throw new Error(`merged GLB: node${nodeIdx} referenced in draw_ranges but has no geometry`);
    }
    const positions = readPositions(gltf, bin, prim.attributes.POSITION);
    // rotate from glTF Y-up to Z-up (native cook.rs): (x, y, z) → (x, -z, y)
    for (let v = 0; v < positions.length; v += 3) {
      const y = positions[v + 1];
      positions[v + 1] = -positions[v + 2];
      positions[v + 2] = y;
    }
    const indices = readIndices(gltf, bin, prim.indices, positions.length / 3);
    const mat = gltf.materials?.[prim.material ?? -1];
    const c = mat?.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1];
    const drs = byNode.get(nodeIdx) ?? [];
    cgs.push({
      color: [c[0] ?? 1, c[1] ?? 1, c[2] ?? 1, c[3] ?? 1],
      ranges: drs.map((dr) => ({
        id: dr.id,
        positions,
        indices: indices.subarray(dr.start, dr.start + dr.count),
      })),
    });
  }

  return { bytes: assemble(cgs, entries).bytes, rootName };
}

// -----------------------------------------------------------------------------
// generic GLB front-end (any exporter)
// -----------------------------------------------------------------------------
// Reads plain node trees AND EXT_mesh_gpu_instancing (the rvm2glb CLI's
// "standard" and "instanced" outputs): instances are baked out, each instance
// becoming its own selectable hierarchy leaf. Authored NORMALs come along.
async function cookGeneric(
  gltf: Gltf,
  bin: Uint8Array,
  includeNormals: boolean,
  zUpInput = false,
): Promise<{ bytes: ArrayBuffer; hasNormals: boolean }> {
  const nodes = gltf.nodes ?? [];
  const sceneRoots = gltf.scenes?.[gltf.scene ?? 0]?.nodes ?? [];

  // Traverse: one hierarchy entry per node; one draw range per (node, primitive)
  // — or per (instance, primitive) under instanced nodes.
  const entries: HierEntry[] = [];
  const ranges: DrawRangeGeo[] = [];
  let nextId = 1; // sparse ids start at 1 (0 = background)

  /** Emit every TRIANGLES primitive of `meshIdx` transformed by `world`,
   *  as hierarchy leaves under `parentEntry` (named `baseName`). */
  const emitMesh = (meshIdx: number, parentEntry: number, baseName: string, world: M4) => {
    const mesh = gltf.meshes?.[meshIdx];
    const nm = m3NormalMatrix(world);
    (mesh?.primitives ?? []).forEach((prim, pi) => {
      if ((prim.mode ?? 4) !== 4 || prim.attributes.POSITION == null) {
        return; // TRIANGLES only
      }
      const local = readPositions(gltf, bin, prim.attributes.POSITION);
      const positions = new Float32Array(local.length);
      for (let v = 0; v < local.length / 3; v++) {
        const x = local[v * 3];
        const y = local[v * 3 + 1];
        const z = local[v * 3 + 2];
        positions[v * 3] = world[0] * x + world[4] * y + world[8] * z + world[12];
        positions[v * 3 + 1] = world[1] * x + world[5] * y + world[9] * z + world[13];
        positions[v * 3 + 2] = world[2] * x + world[6] * y + world[10] * z + world[14];
      }
      // authored normals → world space via the inverse-transpose, renormalized
      let normals: Float32Array | null = null;
      if (includeNormals && prim.attributes.NORMAL != null && nm) {
        try {
          const ln = readFloats(gltf, bin, prim.attributes.NORMAL, 3);
          if (ln.length === local.length) {
            normals = new Float32Array(ln.length);
            for (let v = 0; v < ln.length / 3; v++) {
              const x = ln[v * 3];
              const y = ln[v * 3 + 1];
              const z = ln[v * 3 + 2];
              const wx = nm[0] * x + nm[3] * y + nm[6] * z;
              const wy = nm[1] * x + nm[4] * y + nm[7] * z;
              const wz = nm[2] * x + nm[5] * y + nm[8] * z;
              const len = Math.hypot(wx, wy, wz) || 1;
              normals[v * 3] = wx / len;
              normals[v * 3 + 1] = wy / len;
              normals[v * 3 + 2] = wz / len;
            }
          }
        } catch {
          normals = null; // odd normal accessor — fall back to flat shading
        }
      }
      const indices = readIndices(gltf, bin, prim.indices, local.length / 3);
      const mat = gltf.materials?.[prim.material ?? -1];
      // baseColorFactor passes through UNCONVERTED — the app treats colors as
      // opaque display values in every file path (director's call 2026-07-27:
      // no sRGB<->linear anywhere; this app's own GLB export writes raw values
      // to match, so import/export cycles round-trip bit-exactly). Spec GLBs
      // authored with linear factors (e.g. Blender) render a bit darker here.
      const c = mat?.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1];
      const color: [number, number, number, number] = [c[0] ?? 1, c[1] ?? 1, c[2] ?? 1, c[3] ?? 1];
      const rangeId = nextId++;
      // the primitive is a hierarchy LEAF under its node (single-primitive
      // meshes collapse: the leaf reuses the node name)
      const leafName = (mesh?.primitives.length ?? 0) > 1 ? `${baseName} #${pi + 1}` : baseName;
      entries.push({ id: rangeId, name: leafName, parent: parentEntry });
      ranges.push({
        id: rangeId,
        name: leafName,
        parentEntry,
        positions,
        normals,
        indices,
        colorKey: color.join(','),
        color,
      });
    });
  };

  const visit = (ni: number, parentEntry: number, parentM: M4) => {
    const n = nodes[ni];
    if (!n) {
      return;
    }
    const world = m4Mul(parentM, nodeLocal(n));
    const entryIdx = entries.length;
    const nodeId = nextId++;
    const nodeName = n.name ?? `node ${ni}`;
    entries.push({ id: nodeId, name: nodeName, parent: parentEntry });
    const inst = n.extensions?.EXT_mesh_gpu_instancing?.attributes;
    if (n.mesh != null && inst) {
      // instanced node: bake every instance out as its own leaf so each one
      // is individually selectable/colorable
      const t = inst.TRANSLATION != null ? readFloats(gltf, bin, inst.TRANSLATION, 3) : null;
      const r = inst.ROTATION != null ? readFloats(gltf, bin, inst.ROTATION, 4) : null;
      const s = inst.SCALE != null ? readFloats(gltf, bin, inst.SCALE, 3) : null;
      const count = (t ? t.length / 3 : 0) || (r ? r.length / 4 : 0) || (s ? s.length / 3 : 0);
      for (let i = 0; i < count; i++) {
        const local = nodeLocal({
          translation: t ? [t[i * 3], t[i * 3 + 1], t[i * 3 + 2]] : undefined,
          rotation: r ? [r[i * 4], r[i * 4 + 1], r[i * 4 + 2], r[i * 4 + 3]] : undefined,
          scale: s ? [s[i * 3], s[i * 3 + 1], s[i * 3 + 2]] : undefined,
        });
        emitMesh(n.mesh, entryIdx, `${nodeName} [${i + 1}]`, m4Mul(world, local));
      }
    } else if (n.mesh != null) {
      emitMesh(n.mesh, entryIdx, nodeName, world);
    }
    for (const c of n.children ?? []) {
      visit(c, entryIdx, world);
    }
  };
  // glTF is Y-up, the app is Z-up: (x, y, z) → (x, -z, y), fed in as the root
  // matrix so baked positions AND normals both convert (same as cookMerged).
  // zUpInput (this app's own .tdp export GLBs): already Z-up — no rotation.
  const rootMatrix = zUpInput
    ? Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
    : Float64Array.from([1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1]);
  for (const r of sceneRoots) {
    visit(r, 0xffffffff, rootMatrix);
  }
  if (ranges.length === 0) {
    throw new Error('GLB contains no triangle geometry');
  }

  // Group draw ranges by material color → color groups (stable order).
  const cgKeys: string[] = [];
  const cgOf = new Map<string, number>();
  for (const r of ranges) {
    if (!cgOf.has(r.colorKey)) {
      cgOf.set(r.colorKey, cgKeys.length);
      cgKeys.push(r.colorKey);
    }
  }
  const cgs: CgInput[] = cgKeys.map(() => ({ color: [1, 1, 1, 1], ranges: [] }));
  for (const r of ranges) {
    const cg = cgs[cgOf.get(r.colorKey) ?? 0];
    cg.color = r.color;
    cg.ranges.push({ id: r.id, positions: r.positions, normals: r.normals, indices: r.indices });
  }
  return assemble(cgs, entries);
}

// -----------------------------------------------------------------------------
// shared back-end: meshletize + quantize + encode + write CADM v7
// -----------------------------------------------------------------------------

interface CgInput {
  color: [number, number, number, number];
  /** One entry per draw range (dense item), in the CG's item order. Ranges may
   *  share a positions array (merged) or carry their own (generic). */
  ranges: { id: number; positions: Float32Array; normals?: Float32Array | null; indices: Uint32Array }[];
}

function assemble(cgsIn: CgInput[], entries: HierEntry[]): { bytes: ArrayBuffer; hasNormals: boolean } {
  const boundsMin = [Infinity, Infinity, Infinity];
  const boundsMax = [-Infinity, -Infinity, -Infinity];

  interface CookedCg {
    color: [number, number, number, number];
    descs: Uint8Array;
    tris: Uint8Array;
    bounds: Uint8Array;
    positions: Uint8Array;
    /** 2× snorm16 octahedral per local vertex, empty when flat-shaded. */
    normals: Uint8Array;
    meshletCount: number;
    localVertCount: number;
    drIds: number[];
    drMeshletStarts: number[];
    drMeshletCounts: number[];
  }
  const cooked: CookedCg[] = [];
  // dense items in (cg, dr) order + the sparse id → item map
  const itemToCg: number[] = [];
  const itemToDr: number[] = [];
  const idToItem: [number, number][] = [];

  // normal stream is all-or-nothing per file: every non-empty range must
  // carry normals, else the whole model falls back to flat shading
  const withNormals = cgsIn.every((cg) => cg.ranges.every((r) => r.indices.length === 0 || r.normals != null));

  /** Octahedral encode a unit normal → two snorm16 (the CADM normal format). */
  const octEncode = (x: number, y: number, z: number): [number, number] => {
    const l = Math.abs(x) + Math.abs(y) + Math.abs(z) || 1;
    let px = x / l;
    let py = y / l;
    if (z < 0) {
      const ox = px;
      px = (1 - Math.abs(py)) * (ox >= 0 ? 1 : -1);
      py = (1 - Math.abs(ox)) * (py >= 0 ? 1 : -1);
    }
    return [
      Math.max(-32767, Math.min(32767, Math.round(px * 32767))),
      Math.max(-32767, Math.min(32767, Math.round(py * 32767))),
    ];
  };

  for (let cgIdx = 0; cgIdx < cgsIn.length; cgIdx++) {
    const input = cgsIn[cgIdx];
    const descs: number[] = [];
    const tris: number[] = [];
    const mbounds: number[] = [];
    const pool: number[] = [];
    const normPool: number[] = [];
    let meshletCount = 0;
    let localVertCount = 0;
    const drIds: number[] = [];
    const drMeshletStarts: number[] = [];
    const drMeshletCounts: number[] = [];

    for (let d = 0; d < input.ranges.length; d++) {
      const r = input.ranges[d];
      const item = itemToCg.length;
      itemToCg.push(cgIdx);
      itemToDr.push(d);
      idToItem.push([r.id, item]);
      drIds.push(r.id);
      drMeshletStarts.push(meshletCount);

      if (r.indices.length === 0) {
        drMeshletCounts.push(0);
        continue;
      }
      const built = MeshoptClusterizer.buildMeshlets(r.indices, r.positions, 3, MAX_VERTS, MAX_TRIS);
      const mB = MeshoptClusterizer.computeMeshletBounds(built, r.positions, 3);
      for (let m = 0; m < built.meshletCount; m++) {
        const ml = MeshoptClusterizer.extractMeshlet(built, m);
        const vCount = ml.vertices.length;
        const tCount = ml.triangles.length / 3;
        const mn = [Infinity, Infinity, Infinity];
        const mx = [-Infinity, -Infinity, -Infinity];
        for (const gv of ml.vertices) {
          for (let ax = 0; ax < 3; ax++) {
            const v = r.positions[gv * 3 + ax];
            if (v < mn[ax]) {
              mn[ax] = v;
            }
            if (v > mx[ax]) {
              mx[ax] = v;
            }
            if (v < boundsMin[ax]) {
              boundsMin[ax] = v;
            }
            if (v > boundsMax[ax]) {
              boundsMax[ax] = v;
            }
          }
        }
        const scale = [0, 1, 2].map((ax) => (mx[ax] - mn[ax]) / 65535);
        const vOff = localVertCount;
        const tOff = tris.length;
        const db = new DataView(new ArrayBuffer(40));
        db.setUint32(0, vOff, true);
        db.setUint32(4, tOff, true);
        db.setUint32(8, vCount, true);
        db.setUint32(12, tCount, true);
        for (let ax = 0; ax < 3; ax++) {
          db.setFloat32(16 + ax * 4, mn[ax], true);
          db.setFloat32(28 + ax * 4, scale[ax], true);
        }
        descs.push(...new Uint8Array(db.buffer));
        for (const gv of ml.vertices) {
          for (let ax = 0; ax < 3; ax++) {
            const sc = scale[ax];
            const q = sc > 0 ? Math.min(65535, Math.max(0, Math.round((r.positions[gv * 3 + ax] - mn[ax]) / sc))) : 0;
            pool.push(q & 255, q >> 8);
          }
          if (withNormals && r.normals) {
            const [ox, oy] = octEncode(r.normals[gv * 3], r.normals[gv * 3 + 1], r.normals[gv * 3 + 2]);
            normPool.push(ox & 255, (ox >> 8) & 255, oy & 255, (oy >> 8) & 255);
          }
        }
        localVertCount += vCount;
        for (let t = 0; t < tCount * 3; t++) {
          tris.push(ml.triangles[t]);
        }
        while (tris.length % 4 !== 0) {
          tris.push(0);
        }
        const b = mB[m];
        const bb = new DataView(new ArrayBuffer(48));
        [
          b.centerX,
          b.centerY,
          b.centerZ,
          b.radius,
          b.coneApexX,
          b.coneApexY,
          b.coneApexZ,
          b.coneAxisX,
          b.coneAxisY,
          b.coneAxisZ,
          b.coneCutoff,
          0,
        ].forEach((v, k) => {
          bb.setFloat32(k * 4, v, true);
        });
        mbounds.push(...new Uint8Array(bb.buffer));
        meshletCount++;
      }
      drMeshletCounts.push(built.meshletCount);
    }

    cooked.push({
      color: input.color,
      descs: Uint8Array.from(descs),
      tris: Uint8Array.from(tris),
      bounds: Uint8Array.from(mbounds),
      positions: Uint8Array.from(pool),
      normals: Uint8Array.from(normPool),
      meshletCount,
      localVertCount,
      drIds,
      drMeshletStarts,
      drMeshletCounts,
    });
  }
  if (!Number.isFinite(boundsMin[0])) {
    boundsMin.fill(0);
    boundsMax.fill(0);
  }

  // -----------------------------------------------------------------------------
  // file layout
  // -----------------------------------------------------------------------------
  const enc = (src: Uint8Array, count: number, stride: number): Uint8Array => {
    if (count === 0) {
      return new Uint8Array(0);
    }
    const padded = new Uint8Array(count * stride);
    padded.set(src.subarray(0, Math.min(src.length, padded.length)));
    return MeshoptEncoder.encodeVertexBuffer(padded, count, stride);
  };

  const parts: { bytes: Uint8Array; at: number }[] = [];
  let cursor = HEADER_SIZE + cooked.length * CG_HEADER_SIZE;
  const put = (bytes: Uint8Array): number => {
    const at = cursor;
    parts.push({ bytes, at });
    cursor += bytes.length;
    cursor = Math.ceil(cursor / 8) * 8;
    return at;
  };

  const cgHeaders = new Uint8Array(cooked.length * CG_HEADER_SIZE);
  const cgh = new DataView(cgHeaders.buffer);
  cooked.forEach((cg, i) => {
    const D = cg.drIds.length;
    const dr = new Uint8Array(D * 20);
    const drv = new DataView(dr.buffer);
    for (let d = 0; d < D; d++) {
      drv.setUint32(d * 4, cg.drIds[d], true);
      drv.setUint32(D * 12 + d * 4, cg.drMeshletStarts[d], true);
      drv.setUint32(D * 16 + d * 4, cg.drMeshletCounts[d], true);
    }
    const drOff = put(dr);
    const descsEnc = enc(cg.descs, cg.meshletCount, 40);
    const descOff = put(descsEnc);
    const trisEnc = enc(cg.tris, cg.tris.length / 4, 4);
    const trisOff = put(trisEnc);
    const boundsEnc = enc(cg.bounds, cg.meshletCount, 48);
    const boundsOff = put(boundsEnc);
    const posElems = Math.ceil((cg.localVertCount * 6) / 12);
    const posEnc = enc(cg.positions, posElems, 12);
    const posOff = put(posEnc);
    // optional octahedral normal stream (2× snorm16 per local vertex)
    const hasNorm = withNormals && cg.normals.length > 0;
    const normEnc = hasNorm ? enc(cg.normals, cg.localVertCount, 4) : new Uint8Array(0);
    const normOff = hasNorm ? put(normEnc) : 0;

    const h = i * CG_HEADER_SIZE;
    for (let k = 0; k < 4; k++) {
      cgh.setFloat32(h + k * 4, cg.color[k], true);
    }
    cgh.setUint32(h + 24, D, true);
    cgh.setUint32(h + 28, cg.meshletCount, true);
    cgh.setBigUint64(h + 32, BigInt(drOff), true);
    cgh.setBigUint64(h + 40, BigInt(descOff), true);
    cgh.setBigUint64(h + 48, BigInt(trisOff), true);
    cgh.setBigUint64(h + 56, BigInt(boundsOff), true);
    cgh.setBigUint64(h + 64, BigInt(posOff), true);
    cgh.setBigUint64(h + 72, BigInt(normOff), true);
    cgh.setUint32(h + 80, cg.tris.length, true);
    cgh.setUint32(h + 84, cg.localVertCount, true);
    cgh.setUint32(h + 88, descsEnc.length, true);
    cgh.setUint32(h + 92, trisEnc.length, true);
    cgh.setUint32(h + 96, boundsEnc.length, true);
    cgh.setUint32(h + 100, posEnc.length, true);
    cgh.setUint32(h + 104, normEnc.length, true);
  });

  // items
  const itemCount = itemToCg.length;
  const itemsHead = new Uint8Array(24);
  const cgArr = new Uint8Array(itemCount * 2);
  const cgArrV = new DataView(cgArr.buffer);
  for (let i = 0; i < itemCount; i++) {
    cgArrV.setUint16(i * 2, itemToCg[i], true);
  }
  const drArr = new Uint8Array(itemCount * 4);
  const drArrV = new DataView(drArr.buffer);
  for (let i = 0; i < itemCount; i++) {
    drArrV.setUint32(i * 4, itemToDr[i], true);
  }
  const itemsOffset = put(itemsHead);
  const itemToCgOff = put(cgArr);
  const itemToDrOff = put(drArr);
  const ihv = new DataView(itemsHead.buffer);
  ihv.setUint32(0, itemCount, true);
  ihv.setBigUint64(8, BigInt(itemToCgOff), true);
  ihv.setBigUint64(16, BigInt(itemToDrOff), true);

  // hierarchy
  const te = new TextEncoder();
  const nameBytes: Uint8Array[] = [];
  let nameLen = 0;
  const entryRecs = new Uint8Array(entries.length * 16);
  const erv = new DataView(entryRecs.buffer);
  entries.forEach((e, i) => {
    const nb = te.encode(e.name);
    erv.setUint32(i * 16, e.id, true);
    erv.setUint32(i * 16 + 4, nameLen, true);
    erv.setUint32(i * 16 + 8, e.parent, true);
    erv.setUint16(i * 16 + 12, nb.length, true);
    nameBytes.push(nb);
    nameLen += nb.length;
  });
  const namePool = new Uint8Array(nameLen);
  let np = 0;
  for (const nb of nameBytes) {
    namePool.set(nb, np);
    np += nb.length;
  }
  idToItem.sort((a, b) => a[0] - b[0]);
  const idItems = new Uint8Array(idToItem.length * 8);
  const iiv = new DataView(idItems.buffer);
  idToItem.forEach(([id, item], i) => {
    iiv.setUint32(i * 8, id, true);
    iiv.setUint32(i * 8 + 4, item, true);
  });
  const hierHead = new Uint8Array(40);
  const hierarchyOffset = put(hierHead);
  const namePoolOff = put(namePool);
  const entriesOff = put(entryRecs);
  const idItemOff = put(idItems);
  const hhv = new DataView(hierHead.buffer);
  hhv.setUint32(0, entries.length, true);
  hhv.setUint32(4, idToItem.length, true);
  hhv.setUint32(8, namePool.length, true);
  hhv.setBigUint64(16, BigInt(namePoolOff), true);
  hhv.setBigUint64(24, BigInt(entriesOff), true);
  hhv.setBigUint64(32, BigInt(idItemOff), true);

  const out = new Uint8Array(cursor);
  const hv = new DataView(out.buffer);
  hv.setUint32(0, MAGIC, true);
  hv.setUint32(4, FORMAT_VERSION, true);
  hv.setUint32(8, cooked.length, true);
  for (let ax = 0; ax < 3; ax++) {
    hv.setFloat32(48 + ax * 4, boundsMin[ax], true);
    hv.setFloat32(60 + ax * 4, boundsMax[ax], true);
  }
  hv.setBigUint64(72, BigInt(itemsOffset), true);
  hv.setBigUint64(80, BigInt(hierarchyOffset), true);
  out.set(cgHeaders, HEADER_SIZE);
  for (const p of parts) {
    out.set(p.bytes, p.at);
  }
  return { bytes: out.buffer, hasNormals: withNormals && cooked.some((c) => c.normals.length > 0) };
}
