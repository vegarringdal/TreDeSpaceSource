// Decoded .tdpp node → the GPU layout of shaders/points.ts: 16 header words
// (the centre of the node's cube, its spacing, the spacing to size by in each
// octant — the node's own until the streamer knows what is drawn below it —
// and the quantization base and unit), then 3 words per point: its position
// as three 18-bit grid coordinates from the base, the setup that measured it,
// and r | g << 8 | b << 16 | grey << 24. 12 bytes a point where three floats
// and a colour took 16.
import {
  POINT_BASE_WORD,
  POINT_COORD_MAX,
  POINT_HEADER_WORDS,
  POINT_OCTANT_WORD,
  POINT_OCTANTS,
  POINT_WORDS,
} from '../render/shaders/points';
import { layoutRanges, type PartialNode, type PointRanges, RANGE_POINTS, type RangeLayout } from './pointRanges';
import type { DecodedNode, TdppHeader, TdppNode, Vec3 } from './tdppFormat';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type ColorFlags = Pick<TdppHeader, 'hasColor' | 'hasIntensity'>;

/** A node ready for the GPU: its words and, when it is large enough to be
 *  cut, the ranges its points were written in (pointRanges.ts). */
export interface PackedNode {
  readonly words: Uint32Array<ArrayBuffer>;
  readonly ranges: PointRanges | null;
  /** Set when `keep` left ranges out: what the node has and has not. */
  readonly partial: PartialNode | null;
}

/** Whether a range (its box: 6 floats at `o` of `boxes`) is to be uploaded. */
export type KeepRange = (boxes: Float32Array, o: number) => boolean;

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const INTENSITY_SHIFT = 8;
/** The cook's grid, metres (TdppMeta.gridScale): the unit a node is stored in
 *  whenever its extent fits 18 bits of it. */
export const DEFAULT_GRID = 0.001;
const QY_LOW_BITS = 14;
const QY_LOW_MASK = (1 << QY_LOW_BITS) - 1;
const QX_BITS = 18;
const QZ_SHIFT = 4;
const SETUP_SHIFT = 22;
const SETUP_MASK = 255;

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

/**
 * Write a node's points in the order of `layout` (file order without one):
 * range by range, cluster by cluster. `onlySetup` keeps just the points one
 * scanner setup measured; a range it empties is left out. `keep` leaves whole
 * ranges out (the ones outside the view): the node is then partial.
 */
/**
 * The base and unit a node's positions are quantized with: the unit is the
 * cook grid when the node's extent fits 18 bits of it (positions then stay
 * exact), else the extent over 18 bits.
 */
function quantization(d: DecodedNode, grid: number): { base: Vec3; unit: number } {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  const p = d.positions;
  for (let i = 0; i < d.count * 3; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = p[i + k];
      if (v < lo[k]) {
        lo[k] = v;
      }
      if (v > hi[k]) {
        hi[k] = v;
      }
    }
  }
  if (d.count === 0) {
    return { base: [0, 0, 0], unit: grid };
  }

  const extent = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  return { base: [lo[0], lo[1], lo[2]], unit: Math.max(grid, extent / POINT_COORD_MAX) };
}

function pack(
  d: DecodedNode,
  spacing: number,
  centre: Vec3,
  grid: number,
  header: ColorFlags,
  onlySetup: number | null,
  layout: RangeLayout | null,
  keep?: KeepRange,
): PackedNode {
  const out = new Uint32Array(POINT_HEADER_WORDS + d.count * POINT_WORDS);
  const f = new Float32Array(out.buffer);
  f.set(centre, 0);
  f[3] = spacing;
  f.fill(spacing, POINT_OCTANT_WORD, POINT_OCTANT_WORD + POINT_OCTANTS);
  const { base, unit } = quantization(d, grid);
  f.set(base, POINT_BASE_WORD);
  f[POINT_BASE_WORD + 3] = unit;
  // the shader multiplies by the unit as an f32: divide by the same value
  const scale = 1 / f[POINT_BASE_WORD + 3];
  const bx = f[POINT_BASE_WORD];
  const by = f[POINT_BASE_WORD + 1];
  const bz = f[POINT_BASE_WORD + 2];
  const rangeCount = layout ? layout.ends.length : 1;
  const spans: number[] = [];
  const keptRanges: number[] = [];
  const uploaded = new Uint8Array(rangeCount).fill(1);
  let left = 0;
  let kept = 0;
  let at = 0;
  for (let r = 0; r < rangeCount; r++) {
    const rangeFirst = kept;
    const end = layout ? layout.ends[r] : 1;
    if (layout && keep && !keep(layout.boxes, r * 6)) {
      uploaded[r] = 0;
      left++;
      at = end;
      continue;
    }
    for (; at < end; at++) {
      const from = layout ? d.clusterFirst[layout.order[at]] : 0;
      const to = layout ? from + d.clusterCount[layout.order[at]] : d.count;
      for (let i = from; i < to; i++) {
        if (onlySetup !== null && d.rgbs[4 * i + 3] !== onlySetup) {
          continue;
        }
        const o = POINT_HEADER_WORDS + kept * POINT_WORDS;
        kept++;
        const qx = Math.min(POINT_COORD_MAX, Math.max(0, Math.round((d.positions[3 * i] - bx) * scale)));
        const qy = Math.min(POINT_COORD_MAX, Math.max(0, Math.round((d.positions[3 * i + 1] - by) * scale)));
        const qz = Math.min(POINT_COORD_MAX, Math.max(0, Math.round((d.positions[3 * i + 2] - bz) * scale)));
        out[o] = (qx | ((qy & QY_LOW_MASK) << QX_BITS)) >>> 0;
        out[o + 1] =
          ((qy >>> QY_LOW_BITS) | (qz << QZ_SHIFT) | ((d.rgbs[4 * i + 3] & SETUP_MASK) << SETUP_SHIFT)) >>> 0;
        let red = d.rgbs[4 * i];
        let green = d.rgbs[4 * i + 1];
        let blue = d.rgbs[4 * i + 2];
        const grey = header.hasIntensity
          ? d.intensity[i] >> INTENSITY_SHIFT
          : Math.round(0.299 * red + 0.587 * green + 0.114 * blue);
        if (!header.hasColor) {
          red = grey;
          green = grey;
          blue = grey;
        }
        out[o + 2] = (red | (green << 8) | (blue << 16) | (grey << 24)) >>> 0;
      }
    }
    if (kept > rangeFirst) {
      spans.push(rangeFirst, kept - rangeFirst);
      keptRanges.push(r);
    }
  }
  const words = kept === d.count ? out : out.slice(0, POINT_HEADER_WORDS + kept * POINT_WORDS);
  const partial = layout && left > 0 ? { boxes: layout.boxes, kept: uploaded } : null;
  if (!layout || keptRanges.length < 2) {
    return { words, ranges: null, partial };
  }

  const boxes = new Float32Array(keptRanges.length * 6);
  keptRanges.forEach((r, i) => {
    boxes.set(layout.boxes.subarray(r * 6, r * 6 + 6), i * 6);
  });
  return { words, ranges: { spans: Uint32Array.from(spans), boxes }, partial };
}

/**
 * Pack one node in file order. A file without colour stores grey (its
 * intensity) as RGB, and one without intensity uses the colour's luma as grey,
 * so both shading modes always have something to show. `onlySetup` keeps just
 * the points one scanner setup measured (the result is then shorter:
 * header + 3 × kept words). The header's cube centre is left at the origin:
 * every octant is sized alike here, so it does not matter which one a point
 * falls in. `grid` is the file's grid (TdppMeta.gridScale).
 */
export function packNodePoints(
  d: DecodedNode,
  spacing: number,
  header: ColorFlags,
  onlySetup: number | null = null,
  grid: number = DEFAULT_GRID,
): Uint32Array<ArrayBuffer> {
  return pack(d, spacing, [0, 0, 0], grid, header, onlySetup, null).words;
}

/**
 * Pack one node for the streamer: the same points as `packNodePoints`,
 * written range by range so the part of the node outside the view can be left
 * undrawn. `ranges` is null for a node too small to cut (`rangePoints` or
 * fewer points). With `keep`, only the ranges it accepts are written.
 */
export function packNodeRanged(
  d: DecodedNode,
  node: Pick<TdppNode, 'cubeMin' | 'cubeSize' | 'spacing'>,
  header: ColorFlags,
  onlySetup: number | null = null,
  rangePoints: number = RANGE_POINTS,
  keep?: KeepRange,
  grid: number = DEFAULT_GRID,
): PackedNode {
  const half = node.cubeSize / 2;
  const centre: Vec3 = [node.cubeMin[0] + half, node.cubeMin[1] + half, node.cubeMin[2] + half];
  const layout = layoutRanges(d, node.cubeMin, node.cubeSize, rangePoints);
  return pack(d, node.spacing, centre, grid, header, onlySetup, layout, keep);
}

/** One packed point read back the way the vertex shader reads it. */
export interface UnpackedPoint {
  readonly position: Vec3;
  readonly rgb: readonly [number, number, number];
  readonly grey: number;
  readonly setup: number;
}

/** Point `i` of a packed node — the shader's own arithmetic, for the tests
 *  and anything else that must agree with what is drawn. */
export function unpackPoint(words: Uint32Array, i: number): UnpackedPoint {
  const f = new Float32Array(words.buffer, words.byteOffset, POINT_HEADER_WORDS);
  const o = POINT_HEADER_WORDS + i * POINT_WORDS;
  const w0 = words[o];
  const w1 = words[o + 1];
  const rgba = words[o + 2];
  const unit = f[POINT_BASE_WORD + 3];
  const qx = w0 & POINT_COORD_MAX;
  const qy = (w0 >>> QX_BITS) | ((w1 & 15) << QY_LOW_BITS);
  const qz = (w1 >>> QZ_SHIFT) & POINT_COORD_MAX;
  return {
    position: [f[POINT_BASE_WORD] + qx * unit, f[POINT_BASE_WORD + 1] + qy * unit, f[POINT_BASE_WORD + 2] + qz * unit],
    rgb: [rgba & 255, (rgba >>> 8) & 255, (rgba >>> 16) & 255],
    grey: rgba >>> 24,
    setup: (w1 >>> SETUP_SHIFT) & SETUP_MASK,
  };
}
