// .tdpp v1 — laser-scan point cloud + setups + panoramas, cooked from LGSX /
// E57 by rust_src/crates/scan-cook (spec: its docs/TDPP_FORMAT.md).
// Pure parsing: callers fetch byte ranges (OPFS File.slice, HTTP Range) and
// pass them in — a .tdpp is GBs and is never read whole.

import { MeshoptDecoder } from 'meshoptimizer';
import type { Result } from '../result';
import { axesOfQuat, type CloudAxes } from './cloudFrame';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type Vec3 = readonly [number, number, number];
export type Quat = readonly [number, number, number, number];

export interface TdppHeader {
  readonly fileSize: number;
  readonly hierarchyOffset: number;
  readonly nodeCount: number;
  readonly clusterSize: number;
  readonly metaOffset: number;
  readonly metaSize: number;
  readonly pointCount: number;
  /** Position of local (0,0,0) in the coordinates the cloud is placed in;
   *  node/point coordinates are relative to it, along the stored axes
   *  (TdppMeta.axes turns them when the source has a rotated system). */
  readonly origin: Vec3;
  readonly boundsMin: Vec3;
  readonly boundsMax: Vec3;
  readonly hasColor: boolean;
  readonly hasIntensity: boolean;
  readonly hasSetup: boolean;
  readonly hasNormals: boolean;
  readonly setupCount: number;
}

export interface TdppNode {
  readonly index: number;
  readonly cubeMin: Vec3;
  readonly cubeSize: number;
  /** Tight bounds of the node's own points (origin-relative). */
  readonly boundsMin: Vec3;
  readonly boundsMax: Vec3;
  /** Approximate point spacing in metres — the LOD metric. */
  readonly spacing: number;
  readonly pointCount: number;
  /** -1 for the root. */
  readonly parent: number;
  readonly firstChild: number;
  readonly childCount: number;
  readonly depth: number;
  readonly octant: number;
  /** The attribute stream stores r − g, g, b − g (undone by `decodeNode`). */
  readonly colorDelta: boolean;
  readonly clusterCount: number;
  readonly payloadSize: number;
  readonly payloadOffset: number;
  /** Bit s = setup s has points here (bit 63: s >= 63). */
  readonly setupMask: bigint;
}

export interface TdppPanoramaLevel {
  readonly width: number;
  readonly height: number;
  readonly format: string;
  readonly offset: number;
  readonly size: number;
}

export interface TdppPanoramaFace {
  readonly face: number;
  readonly view: string;
  /** Camera → setup rotation [w, x, y, z]; the face camera looks down −Z, +Y up. */
  readonly rotation: Quat;
  /** Mip chain, largest first. */
  readonly levels: readonly TdppPanoramaLevel[];
}

/** One equirectangular photo (E57 spherical image). A direction d in the
 *  image frame (Z up) lands on column width/2 − atan2(d.y, d.x)/pixelWidth,
 *  row height/2 − asin(d.z)/pixelHeight. */
export interface TdppPanoramaSphere {
  /** Image frame → source frame (absolute). */
  readonly rotation: Quat;
  /** Radians per pixel. */
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly levels: readonly TdppPanoramaLevel[];
}

export interface TdppSetup {
  /** Value of the per-point setup byte, or null when points don't carry one. */
  readonly index: number | null;
  readonly name: string;
  readonly label: string;
  /** Setup → source frame (absolute, not origin-relative). */
  readonly rotation: Quat;
  readonly translation: Vec3;
  /** Six faces in CUBE_FACES order, or null without a panorama. */
  readonly faces: readonly TdppPanoramaFace[] | null;
  /** Spherical photo, when the setup has one instead of a cube. */
  readonly sphere: TdppPanoramaSphere | null;
}

/** A coordinate system of the scan's source (LGSX: a user coordinate system
 *  or the one made from survey control). */
export interface TdppCoordSystem {
  readonly name: string;
  /** The one the file's origin, axes rotation and setup poses are in. */
  readonly used: boolean;
  /** Made from applied survey control: ties the scan to site coordinates. */
  readonly control: boolean;
  /** Pose of the system in the source's own frame: system coordinates →
   *  source frame ([w, x, y, z] + translation). */
  readonly rotation: Quat;
  readonly translation: Vec3;
}

export interface TdppMeta {
  /** What the coordinates are (free text, e.g. the source's coordinate system). */
  readonly frame: string;
  /** Rotation from the stored points' axes to the coordinates the cloud is
   *  placed in (header origin, setup poses); null = the same axes. */
  readonly axes: CloudAxes;
  /** The same rotation as a quaternion [w, x, y, z]; null = identity. */
  readonly rotation: Quat | null;
  /** Every coordinate system the source has (empty for most scans). */
  readonly coordinateSystems: readonly TdppCoordSystem[];
  /** What the source says about coordinates, applied or not, one line each
   *  (LGSX: the coordinate-related database rows) — shown at import. */
  readonly coordinateReport: readonly string[];
  readonly gridScale: number;
  readonly setups: readonly TdppSetup[];
}

export interface DecodedNode {
  readonly count: number;
  /** xyz per point, relative to the header origin. */
  readonly positions: Float32Array;
  /** Raw 16-bit intensity (÷ 65535 = 0..1); the low byte is 0 in a file
   *  cooked with 8-bit intensity. */
  readonly intensity: Uint16Array;
  /** r, g, b, setup per point. */
  readonly rgbs: Uint8Array;
  /** Normal ring code per point (see ringNormalTable), or null. */
  readonly normals: Uint16Array | null;
  readonly clusterFirst: Uint32Array;
  readonly clusterCount: Uint32Array;
  /** Per cluster: tight min xyz, max xyz (origin-relative, 6 floats). */
  readonly clusterBounds: Float32Array;
}

/** Random-access byte source of a .tdpp (OPFS file, HTTP Range, …). */
export interface TdppSource {
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array<ArrayBuffer>>;
}

/** A parsed file: header + resident hierarchy + metadata. */
export interface TdppFile {
  readonly header: TdppHeader;
  readonly nodes: readonly TdppNode[];
  readonly meta: TdppMeta;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

export const TDPP_HEADER_SIZE = 128;
export const TDPP_NODE_RECORD_SIZE = 96;
const MAGIC = 0x50504454; // "TDPP" little-endian
const VERSION = 1;
const PAYLOAD_HEADER_SIZE = 20;
const CLUSTER_RECORD_SIZE = 32;
const POS_STRIDE = 8;
const ATTR_STRIDE = 4;
const NORMAL_STRIDE = 4;
/** Node record flag (byte 59): the attribute stream is r − g, g, b − g. */
const NODE_COLOR_DELTA = 1;
/** Valid normal ring codes; 65535 = no normal. */
export const NORMAL_RING_CODES = 65144;

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const u64 = (dv: DataView, o: number) => Number(dv.getBigUint64(o, true));
const vec3 = (dv: DataView, o: number): Vec3 => [
  dv.getFloat32(o, true),
  dv.getFloat32(o + 4, true),
  dv.getFloat32(o + 8, true),
];
const fail = <T>(msg: string, err: unknown = null): Result<T> => ({ error: { err, msg } });

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
function tuple3(v: unknown): Vec3 {
  const a = list(v);
  return [num(a[0]), num(a[1]), num(a[2])];
}
function quat(v: unknown): Quat {
  const a = list(v);
  return a.length === 4 ? [num(a[0], 1), num(a[1]), num(a[2]), num(a[3])] : [1, 0, 0, 0];
}

function parseLevels(levels: unknown): TdppPanoramaLevel[] {
  return list(levels)
    .filter(isRecord)
    .map((l) => ({
      width: num(l.width),
      height: num(l.height),
      format: str(l.format),
      offset: num(l.offset),
      size: num(l.size),
    }));
}

function parseFaces(pano: unknown): TdppPanoramaFace[] | null {
  if (!isRecord(pano) || pano.kind !== 'cube') {
    return null;
  }
  const faces = list(pano.faces)
    .filter(isRecord)
    .map(
      (f): TdppPanoramaFace => ({
        face: num(f.face),
        view: str(f.view),
        rotation: quat(f.rotation),
        levels: parseLevels(f.levels),
      }),
    );
  return faces.length === 6 ? faces.sort((a, b) => a.face - b.face) : null;
}

function parseSphere(pano: unknown): TdppPanoramaSphere | null {
  if (!isRecord(pano) || pano.kind !== 'sphere') {
    return null;
  }
  const sphere = {
    rotation: quat(pano.rotation),
    pixelWidth: num(pano.pixel_width),
    pixelHeight: num(pano.pixel_height),
    levels: parseLevels(pano.levels),
  };
  return sphere.levels.length > 0 && sphere.pixelWidth > 0 && sphere.pixelHeight > 0 ? sphere : null;
}

// -----------------------------------------------------------------------------
// Parsing
// -----------------------------------------------------------------------------

export function parseHeader(bytes: Uint8Array): Result<TdppHeader> {
  if (bytes.byteLength < TDPP_HEADER_SIZE) {
    return fail('file too small for a .tdpp header');
  }
  const dv = view(bytes);
  if (dv.getUint32(0, true) !== MAGIC) {
    return fail('not a .tdpp file');
  }
  const version = dv.getUint32(4, true);
  if (version !== VERSION) {
    return fail(`.tdpp version ${version} is not supported (expected ${VERSION})`);
  }
  if (dv.getUint32(8, true) !== TDPP_HEADER_SIZE || dv.getUint32(12, true) !== TDPP_NODE_RECORD_SIZE) {
    return fail('.tdpp header / node record size mismatch');
  }
  const flags = dv.getUint32(112, true);
  return {
    data: {
      fileSize: u64(dv, 16),
      hierarchyOffset: u64(dv, 24),
      nodeCount: dv.getUint32(32, true),
      clusterSize: dv.getUint32(36, true),
      metaOffset: u64(dv, 40),
      metaSize: u64(dv, 48),
      pointCount: u64(dv, 56),
      origin: [dv.getFloat64(64, true), dv.getFloat64(72, true), dv.getFloat64(80, true)],
      boundsMin: vec3(dv, 88),
      boundsMax: vec3(dv, 100),
      hasColor: (flags & 1) !== 0,
      hasIntensity: (flags & 2) !== 0,
      hasSetup: (flags & 4) !== 0,
      hasNormals: (flags & 8) !== 0,
      setupCount: dv.getUint32(116, true),
    },
  };
}

export function parseHierarchy(bytes: Uint8Array): TdppNode[] {
  const dv = view(bytes);
  const nodes: TdppNode[] = [];
  for (let i = 0; i + TDPP_NODE_RECORD_SIZE <= bytes.byteLength; i += TDPP_NODE_RECORD_SIZE) {
    const parent = dv.getUint32(i + 48, true);
    nodes.push({
      index: nodes.length,
      cubeMin: vec3(dv, i),
      cubeSize: dv.getFloat32(i + 12, true),
      boundsMin: vec3(dv, i + 16),
      boundsMax: vec3(dv, i + 28),
      spacing: dv.getFloat32(i + 40, true),
      pointCount: dv.getUint32(i + 44, true),
      parent: parent === 0xffffffff ? -1 : parent,
      firstChild: dv.getUint32(i + 52, true),
      childCount: dv.getUint8(i + 56),
      depth: dv.getUint8(i + 57),
      octant: dv.getUint8(i + 58),
      colorDelta: (dv.getUint8(i + 59) & NODE_COLOR_DELTA) !== 0,
      clusterCount: dv.getUint32(i + 60, true),
      payloadSize: dv.getUint32(i + 64, true),
      payloadOffset: u64(dv, i + 68),
      setupMask: dv.getBigUint64(i + 76, true),
    });
  }
  return nodes;
}

/**
 * Why a parsed hierarchy cannot be walked, or null when it can. The nodes are
 * stored breadth-first, so a parent always precedes its children; a file that
 * breaks that (a damaged or hand-made one) could send the LOD walk round in
 * circles or out of the array.
 */
export function checkHierarchy(nodes: readonly TdppNode[], nodeCount: number): string | null {
  if (nodes.length !== nodeCount) {
    return `${nodes.length} of ${nodeCount} nodes`;
  }
  for (const n of nodes) {
    if (n.parent >= n.index) {
      return `node ${n.index} has parent ${n.parent}`;
    }
    if (n.childCount > 0 && (n.firstChild <= n.index || n.firstChild + n.childCount > nodeCount)) {
      return `node ${n.index} has children ${n.firstChild}–${n.firstChild + n.childCount - 1}`;
    }
  }
  return null;
}

export function parseMeta(bytes: Uint8Array): Result<TdppMeta> {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch (e) {
    return fail('.tdpp metadata is not JSON', e);
  }
  if (!isRecord(raw) || raw.format !== 'tdpp') {
    return fail('.tdpp metadata is not a tdpp object');
  }
  const setups = list(raw.setups)
    .filter(isRecord)
    .map((s): TdppSetup => {
      const pose = isRecord(s.pose) ? s.pose : {};
      return {
        index: typeof s.index === 'number' ? s.index : null,
        name: str(s.name),
        label: str(s.label, str(s.name)),
        rotation: quat(pose.rotation),
        translation: tuple3(pose.translation),
        faces: parseFaces(s.panorama),
        sphere: parseSphere(s.panorama),
      };
    });
  const rotation = raw.rotation === undefined ? null : quat(raw.rotation);
  const axes = rotation ? axesOfQuat(rotation) : null;
  const coordinateReport = list(raw.coordinate_report).filter((l) => typeof l === 'string');
  const coordinateSystems = list(raw.coordinate_systems)
    .filter(isRecord)
    .map((c): TdppCoordSystem => {
      const pose = isRecord(c.pose) ? c.pose : {};
      return {
        name: str(c.name),
        // files written before the flag existed were in the active system
        used: typeof c.used === 'boolean' ? c.used : c.active === true,
        control: c.control === true,
        rotation: quat(pose.rotation),
        translation: tuple3(pose.translation),
      };
    })
    .filter((c) => c.name !== '');
  return {
    data: {
      frame: str(raw.frame),
      axes,
      rotation,
      coordinateSystems,
      coordinateReport,
      gridScale: num(raw.grid_scale, 0.001),
      setups,
    },
  };
}

/** Read header, hierarchy and metadata (three small range reads). */
export async function openTdpp(src: TdppSource): Promise<Result<TdppFile>> {
  try {
    const h = parseHeader(await src.read(0, TDPP_HEADER_SIZE));
    if (!h.data) {
      return { error: h.error };
    }
    const header = h.data;
    if (header.fileSize !== src.size) {
      return fail(`.tdpp header says ${header.fileSize} bytes, the file has ${src.size}`);
    }
    const nodes = parseHierarchy(await src.read(header.hierarchyOffset, header.nodeCount * TDPP_NODE_RECORD_SIZE));
    const bad = checkHierarchy(nodes, header.nodeCount);
    if (bad) {
      return fail(`.tdpp hierarchy is damaged: ${bad}`);
    }
    const m = parseMeta(await src.read(header.metaOffset, header.metaSize));
    if (!m.data) {
      return { error: m.error };
    }
    return { data: { header, nodes, meta: m.data } };
  } catch (e) {
    return fail(`.tdpp read failed: ${e}`, e);
  }
}

/** Decode one node payload (the bytes at `node.payloadOffset`). */
export async function decodeNode(node: TdppNode, payload: Uint8Array): Promise<Result<DecodedNode>> {
  await MeshoptDecoder.ready;
  if (payload.byteLength < PAYLOAD_HEADER_SIZE) {
    return fail(`node ${node.index}: payload too short`);
  }
  const dv = view(payload);
  const n = dv.getUint32(0, true);
  const nc = dv.getUint32(4, true);
  const posSize = dv.getUint32(8, true);
  const attrSize = dv.getUint32(12, true);
  const normalSize = dv.getUint32(16, true);
  if (n !== node.pointCount || nc !== node.clusterCount) {
    return fail(`node ${node.index}: payload header disagrees with the hierarchy`);
  }
  const posAt = PAYLOAD_HEADER_SIZE + nc * CLUSTER_RECORD_SIZE;
  const attrAt = posAt + Math.ceil(posSize / 4) * 4;
  const normalAt = attrAt + Math.ceil(attrSize / 4) * 4;
  if (normalAt + normalSize > payload.byteLength) {
    return fail(`node ${node.index}: payload streams overrun`);
  }
  const pos = new Uint8Array(n * POS_STRIDE);
  const rgbs = new Uint8Array(n * ATTR_STRIDE);
  let normals: Uint16Array | null = null;
  try {
    MeshoptDecoder.decodeVertexBuffer(pos, n, POS_STRIDE, payload.subarray(posAt, posAt + posSize));
    MeshoptDecoder.decodeVertexBuffer(rgbs, n, ATTR_STRIDE, payload.subarray(attrAt, attrAt + attrSize));
    if (normalSize > 0) {
      const nb = new Uint8Array(n * NORMAL_STRIDE);
      MeshoptDecoder.decodeVertexBuffer(nb, n, NORMAL_STRIDE, payload.subarray(normalAt, normalAt + normalSize));
      const words = new Uint16Array(nb.buffer, 0, n * 2);
      normals = new Uint16Array(n);
      for (let i = 0; i < n; i++) {
        normals[i] = words[2 * i];
      }
    }
  } catch (e) {
    return fail(`node ${node.index}: stream decode failed: ${e}`, e);
  }
  if (node.colorDelta) {
    for (let i = 0; i < rgbs.length; i += ATTR_STRIDE) {
      const g = rgbs[i + 1];
      rgbs[i] += g;
      rgbs[i + 2] += g;
    }
  }
  const q = new Uint16Array(pos.buffer, 0, n * 4);
  const positions = new Float32Array(n * 3);
  const intensity = new Uint16Array(n);
  const clusterFirst = new Uint32Array(nc);
  const clusterCount = new Uint32Array(nc);
  const clusterBounds = new Float32Array(nc * 6);
  for (let c = 0; c < nc; c++) {
    const o = PAYLOAD_HEADER_SIZE + c * CLUSTER_RECORD_SIZE;
    const mx = node.cubeMin[0] + dv.getFloat32(o, true);
    const my = node.cubeMin[1] + dv.getFloat32(o + 4, true);
    const mz = node.cubeMin[2] + dv.getFloat32(o + 8, true);
    const sx = dv.getFloat32(o + 12, true);
    const sy = dv.getFloat32(o + 16, true);
    const sz = dv.getFloat32(o + 20, true);
    const first = dv.getUint32(o + 24, true);
    const count = dv.getUint32(o + 28, true);
    if (first + count > n) {
      return fail(`node ${node.index}: cluster ${c} out of range`);
    }
    clusterFirst[c] = first;
    clusterCount[c] = count;
    let qx = 0;
    let qy = 0;
    let qz = 0;
    for (let i = first; i < first + count; i++) {
      const a = q[4 * i];
      const b = q[4 * i + 1];
      const d = q[4 * i + 2];
      positions[3 * i] = mx + a * sx;
      positions[3 * i + 1] = my + b * sy;
      positions[3 * i + 2] = mz + d * sz;
      intensity[i] = q[4 * i + 3];
      qx = Math.max(qx, a);
      qy = Math.max(qy, b);
      qz = Math.max(qz, d);
    }
    clusterBounds.set([mx, my, mz, mx + qx * sx, my + qy * sy, mz + qz * sz], c * 6);
  }
  return { data: { count: n, positions, intensity, rgbs, normals, clusterFirst, clusterCount, clusterBounds } };
}

/**
 * Unit normal per ring code, 3 floats each: ring k = 0..226 at polar angle
 * k·π/226 from +Z, ⌈452·sin θ⌉ codes per ring, azimuth −π + (j + ½)·2π/size.
 * Build once (780 KB) and index by code (CPU or GPU storage buffer).
 */
export function ringNormalTable(): Float32Array {
  const out = new Float32Array(NORMAL_RING_CODES * 3);
  let code = 0;
  for (let k = 0; k <= 226; k++) {
    const th = (k * Math.PI) / 226;
    const size = Math.max(1, Math.ceil(452 * Math.sin(th) - 1e-9));
    for (let j = 0; j < size; j++, code++) {
      const ph = -Math.PI + ((j + 0.5) * 2 * Math.PI) / size;
      out.set([Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)], code * 3);
    }
  }
  return out;
}

/** A TdppSource over a File / Blob (OPFS `getFile()`, a picked file). */
export function blobSource(blob: Blob): TdppSource {
  return {
    size: blob.size,
    read: async (offset, length) => new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer()),
  };
}
