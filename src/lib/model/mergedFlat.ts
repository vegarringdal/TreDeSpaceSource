// Export tree → the cooker's FLAT merged model: the handful of typed arrays
// the wasm cooker takes for a `.tdp` export (cooker-core `flat.rs` documents
// the layout). Built from the same ExportNode tree the GLB and IFC writers
// consume, so an export never round-trips through a GLB file again. Pure —
// no worker or store imports — so it stays unit-testable.
import type { ExportNode, ExportPrimitive } from './glbWrite';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** The cooker's flat merged model. Every offset/count is in ELEMENTS of the
 *  array it indexes; `indices` are node-local. Positions must already be
 *  world-space Z-up (the export tree's convention). */
export interface MergedFlatModel {
  /** xyz per vertex, all nodes back to back. */
  positions: Float32Array;
  /** all nodes back to back; values are 0..vertexCount of their own node. */
  indices: Uint32Array;
  /** 6 per node: vertexStart, vertexCount, indexStart, indexCount, rangeStart, rangeCount. */
  nodes: Uint32Array;
  /** 4 per node: base colour RGBA (0–1). */
  colors: Float32Array;
  /** 3 per range: id, indexStart (node-local), indexCount. */
  ranges: Uint32Array;
  /** `[[id, name, parentId | null], …]` — exactly one null parent (the root). */
  hierarchyJson: string;
}

type HierarchyEntry = readonly [id: number, name: string, parent: number | null];

interface ColorNode {
  color: readonly [number, number, number, number];
  prims: { prim: ExportPrimitive; id: number }[];
  vertexCount: number;
  indexCount: number;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const NODE_STRIDE = 6;
const RANGE_STRIDE = 3;
/** Sparse ids start at 1 — 0 is the renderer's background. */
const FIRST_ID = 1;

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** 8-bit-per-channel key — the same colour identity the export buckets use. */
function colorKey(c: readonly [number, number, number, number]): number {
  return (
    (Math.round(c[0] * 255) |
      (Math.round(c[1] * 255) << 8) |
      (Math.round(c[2] * 255) << 16) |
      (Math.round(c[3] * 255) << 24)) >>>
    0
  );
}

/** Bake a node's matrix into its primitives' positions (in place) so every
 *  position is world-space, as the merged model requires. Only item nodes
 *  carry matrices and they have no children, but recursing keeps it general. */
export function bakeMatrices(nodes: readonly ExportNode[]): void {
  for (const node of nodes) {
    if (node.matrix && node.primitives) {
      const t = node.matrix;
      for (const p of node.primitives) {
        const pos = p.positions;
        for (let i = 0; i < pos.length; i += 3) {
          const x = pos[i];
          const y = pos[i + 1];
          const z = pos[i + 2];
          pos[i] = t[0] * x + t[4] * y + t[8] * z + t[12];
          pos[i + 1] = t[1] * x + t[5] * y + t[9] * z + t[13];
          pos[i + 2] = t[2] * x + t[6] * y + t[10] * z + t[14];
        }
      }
      node.matrix = undefined;
    }
    if (node.children) {
      bakeMatrices(node.children);
    }
  }
}

/** The ArrayBuffers to hand over with a flat model (postMessage transfer list). */
export function flatTransferables(m: MergedFlatModel): ArrayBuffer[] {
  return [m.positions.buffer, m.indices.buffer, m.nodes.buffer, m.colors.buffer, m.ranges.buffer].filter(
    (b): b is ArrayBuffer => b instanceof ArrayBuffer,
  );
}

// -----------------------------------------------------------------------------
// Conversion
// -----------------------------------------------------------------------------

/**
 * Flatten one export tree into the cooker's merged model. Ids and hierarchy
 * follow the scheme the generic cook applied to the export GLB: a pre-order
 * walk hands every node an entry, then every primitive a leaf entry under it
 * (multi-primitive nodes name their leaves `<name> #n`, single ones reuse the
 * node name), then descends into the children. Primitives are grouped by final
 * colour into one cooker node each, one draw range per primitive. `root` must
 * be the single model root — its name becomes the asset name. Positions must
 * already be world-space (see `bakeMatrices`).
 */
export function exportTreeToFlat(root: ExportNode): MergedFlatModel {
  const hierarchy: HierarchyEntry[] = [];
  const byColor = new Map<number, ColorNode>();
  let nextId = FIRST_ID;
  let unnamed = 0;

  const visit = (node: ExportNode, parent: number | null) => {
    const nodeId = nextId++;
    const name = node.name ?? `node ${unnamed++}`;
    hierarchy.push([nodeId, name, parent]);
    const prims = node.primitives ?? [];
    prims.forEach((prim, pi) => {
      if (prim.indices.length === 0) {
        return;
      }
      const id = nextId++;
      hierarchy.push([id, prims.length > 1 ? `${name} #${pi + 1}` : name, nodeId]);
      const key = colorKey(prim.color);
      let cn = byColor.get(key);
      if (!cn) {
        cn = { color: prim.color, prims: [], vertexCount: 0, indexCount: 0 };
        byColor.set(key, cn);
      }
      cn.prims.push({ prim, id });
      cn.vertexCount += prim.positions.length / 3;
      cn.indexCount += prim.indices.length;
    });
    for (const c of node.children ?? []) {
      visit(c, nodeId);
    }
  };
  visit(root, null);

  const colorNodes = [...byColor.values()];
  const totalVerts = colorNodes.reduce((a, n) => a + n.vertexCount, 0);
  const totalIdx = colorNodes.reduce((a, n) => a + n.indexCount, 0);
  const totalRanges = colorNodes.reduce((a, n) => a + n.prims.length, 0);
  const positions = new Float32Array(totalVerts * 3);
  const indices = new Uint32Array(totalIdx);
  const nodes = new Uint32Array(colorNodes.length * NODE_STRIDE);
  const colors = new Float32Array(colorNodes.length * 4);
  const ranges = new Uint32Array(totalRanges * RANGE_STRIDE);
  let vertexStart = 0;
  let indexStart = 0;
  let rangeStart = 0;
  colorNodes.forEach((cn, n) => {
    nodes.set([vertexStart, cn.vertexCount, indexStart, cn.indexCount, rangeStart, cn.prims.length], n * NODE_STRIDE);
    colors.set(cn.color, n * 4);
    let localVerts = 0;
    let localIdx = 0;
    for (const { prim, id } of cn.prims) {
      positions.set(prim.positions, (vertexStart + localVerts) * 3);
      const dst = indexStart + localIdx;
      for (let i = 0; i < prim.indices.length; i++) {
        indices[dst + i] = prim.indices[i] + localVerts;
      }
      ranges.set([id, localIdx, prim.indices.length], rangeStart * RANGE_STRIDE);
      rangeStart++;
      localVerts += prim.positions.length / 3;
      localIdx += prim.indices.length;
    }
    vertexStart += cn.vertexCount;
    indexStart += cn.indexCount;
  });

  return { positions, indices, nodes, colors, ranges, hierarchyJson: JSON.stringify(hierarchy) };
}
