// Export domain: decode GPU-read-back geometry into an export node tree and
// serialize it as GLB or IFC (optionally streamed straight into OPFS).
import * as Comlink from 'comlink';
import { parseModel } from '../model/format';
import { buildGlb, type ExportNode, type ExportPrimitive, writeGlb } from '../model/glbWrite';
import { type IfcSink, writeIfc, writeIfcHierarchy } from '../model/ifcWrite';
import { packModel } from '../model/pack';
import { opfsOpenByteStream, opfsOpenTextStream } from '../opfs/opfsSyncWrite';
import { clipCulledSphere } from '../render/clipCull';
import {
  type DbModel,
  HAS_COLOR_OVERRIDE,
  HAS_OPACITY_OVERRIDE,
  IS_HIDDEN,
  models,
  NO_PARENT,
  OPACITY_SHIFT,
} from './dbState';
import { entryName } from './hierarchyIndex';
import { itemWorldBounds, transforms } from './transformPool';

/** GPU-read-back packed geometry for one model (renderer.readModelGeometry). */
export interface GpuGeom {
  model: number;
  meshletCount: number;
  positionsQ: ArrayBuffer;
  indices16: ArrayBuffer;
  cull: ArrayBuffer;
  meshletInfo: ArrayBuffer;
  cgColors: ArrayBuffer;
}

/** The model's FULL cook read from OPFS — for a zone the VRAM budget holds
 *  coarse, mixed or unloaded, whose GPU slot (if any) carries the budget's
 *  cuts. Parsed and packed here in the worker, so an export never depends on
 *  what happens to be resident. */
export interface FileGeom {
  model: number;
  tdp: ArrayBuffer;
}

export type ExportGeom = GpuGeom | FileGeom;

/** The views the decoder walks — the same pack.ts layouts whichever source
 *  the geometry came from. */
interface DecodedGeom {
  meshletCount: number;
  posQ: Uint16Array;
  idx16: Uint16Array;
  cullU: Uint32Array;
  infoU: Uint32Array;
  infoF: Float32Array;
  cgColors: Float32Array;
}

async function resolveGeom(g: ExportGeom, m: DbModel): Promise<DecodedGeom> {
  if (!('tdp' in g)) {
    return {
      meshletCount: g.meshletCount,
      posQ: new Uint16Array(g.positionsQ),
      idx16: new Uint16Array(g.indices16),
      cullU: new Uint32Array(g.cull),
      infoU: new Uint32Array(g.meshletInfo),
      infoF: new Float32Array(g.meshletInfo),
      cgColors: new Float32Array(g.cgColors),
    };
  }
  const parsed = await parseModel(m.name, g.tdp);
  if (parsed.itemCount !== m.itemCount) {
    throw new Error(`the full cook of "${m.name}" has ${parsed.itemCount} items, the loaded model ${m.itemCount}`);
  }
  const p = packModel(parsed);
  return {
    meshletCount: p.meshletCount,
    posQ: p.positionsQ,
    idx16: p.indices16,
    cullU: new Uint32Array(p.cull),
    infoU: new Uint32Array(p.meshletInfo),
    infoF: new Float32Array(p.meshletInfo),
    cgColors: p.cgColors,
  };
}

/** Per item: 1 when its world-space bounding sphere is provably outside every
 *  active clipping plane, box and shape (the cull shader's own test, mirrored
 *  on the CPU) — the parts a clip volume hides entirely. An intersected item
 *  counts as visible, and an item without geometry is never excluded. */
function clippedItems(m: DbModel, clip: Float32Array): Uint8Array {
  const clipU32 = new Uint32Array(clip.buffer, clip.byteOffset, clip.length);
  const out = new Uint8Array(m.itemCount);
  const wb = new Float32Array(6);
  for (let i = 0; i < m.itemCount; i++) {
    if (!itemWorldBounds(m.itemBounds, m.tidx, i, wb)) {
      continue;
    }
    const center: [number, number, number] = [(wb[0] + wb[3]) / 2, (wb[1] + wb[4]) / 2, (wb[2] + wb[5]) / 2];
    const radius = Math.hypot(wb[3] - wb[0], wb[4] - wb[1], wb[5] - wb[2]) / 2;
    if (clipCulledSphere(clip, clipU32, center, radius)) {
      out[i] = 1;
    }
  }
  return out;
}

/** Export options both writers share. `clip` = the packed clip uniform
 *  (renderer.clipData) when clipped-away parts must be left out; null or
 *  absent exports everything that is not hidden, as if clipping were off. */
export interface ExportDecodeOpts {
  clip?: Float32Array | null;
}

export const exportApi = {
  /** Decode packed geometry (pack.ts layouts; read back from the GPU, or the
   *  full cook from disk) into an export node tree — visibility, color/opacity
   *  overrides, committed transforms and (optionally) the clip volume applied.
   *  Shared by the GLB and IFC exporters. merged = one primitive per final
   *  color; hierarchy = the full entry tree with per-item meshes. */
  async decodeExportTree(
    mode: 'merged' | 'hierarchy',
    geoms: ExportGeom[],
    decodeOpts: ExportDecodeOpts = {},
  ): Promise<{ roots: ExportNode[]; tris: number }> {
    const modelRoots: ExportNode[] = [];
    let totalTris = 0;
    // meshlet-local vertex remap scratch, generation-tagged (no per-meshlet clears)
    const remap = new Int32Array(65536);
    const remapGen = new Uint32Array(65536);
    let gen = 0;

    for (const src of geoms) {
      const m = models[src.model];
      if (!m || m.removed) {
        continue;
      }
      const g = await resolveGeom(src, m);
      const { posQ, idx16, cullU, infoU, infoF, cgColors } = g;
      const clipped = decodeOpts.clip ? clippedItems(m, decodeOpts.clip) : null;

      /** Final display RGBA of an item, or null when it must not export. */
      const itemColor = (item: number, cg: number): [number, number, number, number] | null => {
        const flags = m.states[item * 2];
        if (flags & IS_HIDDEN || clipped?.[item] === 1) {
          return null;
        }
        let a = 1;
        if (flags & HAS_OPACITY_OVERRIDE) {
          a = ((flags >> OPACITY_SHIFT) & 127) / 100;
        } else if (flags & HAS_COLOR_OVERRIDE) {
          a = ((m.states[item * 2 + 1] >>> 24) & 255) / 255;
        }
        if (a <= 0) {
          return null;
        }
        if (flags & HAS_COLOR_OVERRIDE) {
          const c = m.states[item * 2 + 1];
          return [(c & 255) / 255, ((c >> 8) & 255) / 255, ((c >> 16) & 255) / 255, a];
        }
        return [cgColors[cg * 4], cgColors[cg * 4 + 1], cgColors[cg * 4 + 2], a];
      };
      const colorKey = (c: [number, number, number, number]) =>
        (Math.round(c[0] * 255) |
          (Math.round(c[1] * 255) << 8) |
          (Math.round(c[2] * 255) << 16) |
          (Math.round(c[3] * 255) << 24)) >>>
        0;

      // pass 1 — index counts per bucket (merged: color; hierarchy: item+color).
      // Vertex caps use the index count as an upper bound (transient overshoot).
      interface Bucket {
        pos: Float32Array;
        idx: Uint32Array;
        nv: number;
        ni: number;
        min: [number, number, number];
        max: [number, number, number];
        color: [number, number, number, number];
      }
      const bucketKeyOf = (item: number, ck: number) => (mode === 'merged' ? String(ck) : `${item}:${ck}`);
      const counts = new Map<string, { n: number; color: [number, number, number, number]; item: number }>();
      for (let mi = 0; mi < g.meshletCount; mi++) {
        const item = infoU[mi * 8 + 7];
        const color = itemColor(item, infoU[mi * 8 + 3]);
        if (!color) {
          continue;
        }
        const key = bucketKeyOf(item, colorKey(color));
        const c = counts.get(key);
        const n = cullU[mi * 9 + 5];
        if (c) {
          c.n += n;
        } else {
          counts.set(key, { n, color, item });
        }
      }
      if (counts.size === 0) {
        continue;
      }
      const buckets = new Map<string, Bucket>();
      for (const [key, c] of counts) {
        buckets.set(key, {
          pos: new Float32Array(c.n * 3),
          idx: new Uint32Array(c.n),
          nv: 0,
          ni: 0,
          min: [Infinity, Infinity, Infinity],
          max: [-Infinity, -Infinity, -Infinity],
          color: c.color,
        });
      }

      // pass 2 — dequantize + (merged) bake transforms + fill buckets
      const bakeTransforms = mode === 'merged';
      for (let mi = 0; mi < g.meshletCount; mi++) {
        const item = infoU[mi * 8 + 7];
        const color = itemColor(item, infoU[mi * 8 + 3]);
        if (!color) {
          continue;
        }
        const b = buckets.get(bucketKeyOf(item, colorKey(color)))!;
        const o = mi * 8;
        const mnx = infoF[o + 0],
          mny = infoF[o + 1],
          mnz = infoF[o + 2];
        const sx = infoF[o + 4],
          sy = infoF[o + 5],
          sz = infoF[o + 6];
        const indexCount = cullU[mi * 9 + 5];
        const firstIndex = cullU[mi * 9 + 6];
        const baseVertex = cullU[mi * 9 + 8];
        const slot = bakeTransforms ? m.tidx[item] : 0;
        const t = slot !== 0 ? transforms : null;
        const ts = slot * 16;
        gen++;
        for (let k = 0; k < indexCount; k++) {
          const local = idx16[firstIndex + k];
          if (remapGen[local] !== gen) {
            remapGen[local] = gen;
            const v = (baseVertex + local) * 4;
            let x = mnx + posQ[v] * sx;
            let y = mny + posQ[v + 1] * sy;
            let z = mnz + posQ[v + 2] * sz;
            if (t) {
              const wx = t[ts] * x + t[ts + 4] * y + t[ts + 8] * z + t[ts + 12];
              const wy = t[ts + 1] * x + t[ts + 5] * y + t[ts + 9] * z + t[ts + 13];
              const wz = t[ts + 2] * x + t[ts + 6] * y + t[ts + 10] * z + t[ts + 14];
              x = wx;
              y = wy;
              z = wz;
            }
            const nv = b.nv;
            b.pos[nv * 3] = x;
            b.pos[nv * 3 + 1] = y;
            b.pos[nv * 3 + 2] = z;
            if (x < b.min[0]) {
              b.min[0] = x;
            }
            if (y < b.min[1]) {
              b.min[1] = y;
            }
            if (z < b.min[2]) {
              b.min[2] = z;
            }
            if (x > b.max[0]) {
              b.max[0] = x;
            }
            if (y > b.max[1]) {
              b.max[1] = y;
            }
            if (z > b.max[2]) {
              b.max[2] = z;
            }
            remap[local] = nv;
            b.nv++;
          }
          b.idx[b.ni++] = remap[local];
        }
        totalTris += indexCount / 3;
      }

      const toPrimitive = (b: Bucket): ExportPrimitive => ({
        positions: b.pos.subarray(0, b.nv * 3),
        indices: b.idx.subarray(0, b.ni),
        min: b.min,
        max: b.max,
        color: b.color,
      });

      if (mode === 'merged') {
        modelRoots.push({ name: m.name, primitives: [...buckets.values()].map(toPrimitive) });
        continue;
      }

      // hierarchy mode: primitives grouped per item; entry tree pruned to
      // ancestors of visible items; item transforms become node matrices
      const itemPrims = new Map<number, ExportPrimitive[]>();
      for (const [key, b] of buckets) {
        const item = Number(key.split(':')[0]);
        const list = itemPrims.get(item);
        if (list) {
          list.push(toPrimitive(b));
        } else {
          itemPrims.set(item, [toPrimitive(b)]);
        }
      }
      const entryCount = m.hierarchy.entryParent.length;
      const keep = new Uint8Array(entryCount);
      const entryItems = new Map<number, number[]>();
      const orphanItems: number[] = [];
      for (const item of itemPrims.keys()) {
        const e = m.itemToEntry[item];
        if (e === NO_PARENT || e >= entryCount) {
          orphanItems.push(item);
          continue;
        }
        const list = entryItems.get(e);
        if (list) {
          list.push(item);
        } else {
          entryItems.set(e, [item]);
        }
        for (let p = e; p !== NO_PARENT && !keep[p]; p = m.hierarchy.entryParent[p]) {
          keep[p] = 1;
        }
      }
      const itemNode = (item: number): ExportNode => {
        const slot = m.tidx[item];
        return {
          primitives: itemPrims.get(item),
          ...(slot !== 0 ? { matrix: Array.from(transforms.slice(slot * 16, slot * 16 + 16)) } : {}),
        };
      };
      const buildEntry = (entry: number): ExportNode => {
        const children: ExportNode[] = [];
        for (let c = m.childStart[entry]; c < m.childStart[entry + 1]; c++) {
          const child = m.childList[c];
          if (keep[child]) {
            children.push(buildEntry(child));
          }
        }
        const items = entryItems.get(entry) ?? [];
        const node: ExportNode = { name: entryName(m, entry) || undefined };
        // untransformed single-item entries inline their mesh; transformed or
        // multi-item entries attach child nodes so a matrix never leaks onto
        // child entries
        if (items.length === 1 && m.tidx[items[0]] === 0) {
          node.primitives = itemPrims.get(items[0]);
        } else {
          for (const it of items) {
            children.push(itemNode(it));
          }
        }
        if (children.length > 0) {
          node.children = children;
        }
        return node;
      };
      const rootNodes: ExportNode[] = [];
      for (const r of m.roots) {
        if (keep[r]) {
          rootNodes.push(buildEntry(r));
        }
      }
      for (const it of orphanItems) {
        rootNodes.push(itemNode(it));
      }
      modelRoots.push({ name: m.name, children: rootNodes });
    }

    return { roots: modelRoots, tris: totalTris };
  },

  /** Recenter on the union bounding box: building coordinates far from the
   *  origin destroy f32 precision (and some viewers, e.g. Office, misbehave).
   *  The shift is BAKED into vertex data on plain nodes and into the matrix
   *  translation on transformed item nodes, so accessors become origin-local.
   *  GLB-only: IFC always keeps true world coordinates. Returns the removed
   *  centre (the world offset). */
  recenterExportTree(roots: ExportNode[]): [number, number, number] {
    {
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      const growWorld = (node: ExportNode) => {
        for (const p of node.primitives ?? []) {
          if (node.matrix) {
            // transformed node: bounds are local — take the 8 box corners
            const t = node.matrix;
            for (let c = 0; c < 8; c++) {
              const x = c & 1 ? p.max[0] : p.min[0];
              const y = c & 2 ? p.max[1] : p.min[1];
              const z = c & 4 ? p.max[2] : p.min[2];
              const wx = t[0] * x + t[4] * y + t[8] * z + t[12];
              const wy = t[1] * x + t[5] * y + t[9] * z + t[13];
              const wz = t[2] * x + t[6] * y + t[10] * z + t[14];
              for (const [k, w] of [wx, wy, wz].entries()) {
                if (w < min[k]) {
                  min[k] = w;
                }
                if (w > max[k]) {
                  max[k] = w;
                }
              }
            }
          } else {
            for (let k = 0; k < 3; k++) {
              if (p.min[k] < min[k]) {
                min[k] = p.min[k];
              }
              if (p.max[k] > max[k]) {
                max[k] = p.max[k];
              }
            }
          }
        }
        for (const c of node.children ?? []) {
          growWorld(c);
        }
      };
      for (const r of roots) {
        growWorld(r);
      }
      const cx = (min[0] + max[0]) / 2;
      const cy = (min[1] + max[1]) / 2;
      const cz = (min[2] + max[2]) / 2;
      const shift = (node: ExportNode) => {
        if (node.matrix) {
          // matrix nodes: shift the translation, leave local vertex data alone
          node.matrix[12] -= cx;
          node.matrix[13] -= cy;
          node.matrix[14] -= cz;
        } else {
          for (const p of node.primitives ?? []) {
            for (let i = 0; i < p.positions.length; i += 3) {
              p.positions[i] -= cx;
              p.positions[i + 1] -= cy;
              p.positions[i + 2] -= cz;
            }
            p.min = [p.min[0] - cx, p.min[1] - cy, p.min[2] - cz];
            p.max = [p.max[0] - cx, p.max[1] - cy, p.max[2] - cz];
          }
          for (const c of node.children ?? []) {
            shift(c);
          }
        }
      };
      for (const r of roots) {
        shift(r);
      }
      return [cx, cy, cz];
    }
  },

  /** GLB export (Export panel). */
  /** With `opts.opfsOut` (a path from the OPFS root, e.g. `temp/export/x.glb`)
   *  the bytes are streamed into OPFS from THIS worker (sync access handle)
   *  and only the size crosses back — the main thread never holds the file. */
  async exportGlb(
    mode: 'merged' | 'hierarchy',
    geoms: ExportGeom[],
    opts: { zUp?: boolean; bareRoot?: boolean; recenter?: boolean; opfsOut?: string } & ExportDecodeOpts = {},
  ): Promise<{ glb: ArrayBuffer | null; tris: number; size: number }> {
    const { roots, tris } = await exportApi.decodeExportTree(mode, geoms, { clip: opts.clip });
    if (tris === 0) {
      throw new Error('nothing visible to export');
    }
    if (opts.recenter) {
      exportApi.recenterExportTree(roots);
    }
    // streamed into OPFS: header+JSON block, then the geometry arrays as
    // views — the assembled GLB never exists in memory
    if (opts.opfsOut) {
      const out = await opfsOpenByteStream(opts.opfsOut);
      let size: number;
      try {
        writeGlb(roots, { zUp: opts.zUp, bareRoot: opts.bareRoot }, out.write);
        size = out.close();
      } catch (e) {
        out.abort();
        throw e;
      }
      return { glb: null, tris, size };
    }
    const glb = buildGlb(roots, { zUp: opts.zUp, bareRoot: opts.bareRoot });
    return Comlink.transfer({ glb, tris, size: glb.byteLength }, [glb]);
  },

  /** IFC4 export (Export panel): TRIANGULATED face sets + surface styles under
   *  one default building. merged = one proxy per final color; hierarchy = the
   *  app's tree as nested IfcRelAggregates with named proxies. IFC is natively
   *  Z-up and in metres, and meshes KEEP their true world positions — no
   *  recentering ever (BIM coordination depends on real coordinates, and IFC's
   *  text reals have no f32 precision problem). */
  async exportIfc(
    mode: 'merged' | 'hierarchy',
    geoms: ExportGeom[],
    opts: { opfsOut?: string } & ExportDecodeOpts = {},
  ): Promise<{ ifc: ArrayBuffer | null; tris: number; size: number }> {
    const { roots, tris } = await exportApi.decodeExportTree(mode, geoms, { clip: opts.clip });
    if (tris === 0) {
      throw new Error('nothing visible to export');
    }
    let emit: (sink: IfcSink) => void;
    if (mode === 'merged') {
      const hex = (c: number) =>
        Math.round(c * 255)
          .toString(16)
          .padStart(2, '0');
      const sections = roots.flatMap((r) =>
        (r.primitives ?? []).map((p) => ({
          name: `${r.name ?? 'model'} #${hex(p.color[0])}${hex(p.color[1])}${hex(p.color[2])}`,
          prim: p,
        })),
      );
      emit = (sink) => writeIfc(sections, sink);
    } else {
      // IFC placements cannot carry arbitrary matrices — bake the item
      // transforms the hierarchy decode left as node matrices into positions
      const bake = (node: ExportNode) => {
        if (node.matrix && node.primitives) {
          const t = node.matrix;
          for (const p of node.primitives) {
            const pos = p.positions;
            for (let i = 0; i < pos.length; i += 3) {
              const x = pos[i],
                y = pos[i + 1],
                z = pos[i + 2];
              pos[i] = t[0] * x + t[4] * y + t[8] * z + t[12];
              pos[i + 1] = t[1] * x + t[5] * y + t[9] * z + t[13];
              pos[i + 2] = t[2] * x + t[6] * y + t[10] * z + t[14];
            }
          }
          node.matrix = undefined;
        }
        for (const c of node.children ?? []) {
          bake(c);
        }
      };
      for (const r of roots) {
        bake(r);
      }
      emit = (sink) => writeIfcHierarchy(roots, sink);
    }
    // Streamed into OPFS in ~8 MB flushes — the STEP text (which can be
    // several GB) never exists in memory as a whole.
    if (opts.opfsOut) {
      const out = await opfsOpenTextStream(opts.opfsOut);
      try {
        emit(out.write);
      } catch (e) {
        out.abort();
        throw e;
      }
      return { ifc: null, tris, size: out.close() };
    }
    // no OPFS target: buffer encoded ~8 MB chunks, concatenate once at the end
    const enc = new TextEncoder();
    const chunks: Uint8Array[] = [];
    let buf: string[] = [];
    let len = 0;
    const flush = () => {
      if (len === 0) {
        return;
      }
      chunks.push(enc.encode(buf.join('')));
      buf = [];
      len = 0;
    };
    emit((text) => {
      buf.push(text);
      len += text.length;
      if (len >= 8 << 20) {
        flush();
      }
    });
    flush();
    const size = chunks.reduce((a, c) => a + c.byteLength, 0);
    const bytes = new Uint8Array(size);
    let off = 0;
    for (const c of chunks) {
      bytes.set(c, off);
      off += c.byteLength;
    }
    return Comlink.transfer({ ifc: bytes.buffer as ArrayBuffer, tris, size }, [bytes.buffer as ArrayBuffer]);
  },
};
