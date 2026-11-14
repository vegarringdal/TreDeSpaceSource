// Decoded .tdpp node → the GPU layout of shaders/points.ts: 4 header words
// (x = effective spacing, f32 bits), then 4 words per point — x, y, z as f32
// bits (relative to the file origin) and r | g << 8 | b << 16 | grey << 24.
import { POINT_HEADER_WORDS, POINT_WORDS } from '../render/shaders/points';
import type { DecodedNode, TdppHeader } from './tdppFormat';

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const INTENSITY_SHIFT = 8;

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

/**
 * Pack one node. A file without colour stores grey (its intensity) as RGB, and
 * one without intensity uses the colour's luma as grey, so both shading modes
 * always have something to show. `onlySetup` keeps just the points one scanner
 * setup measured (the result is then shorter: 4 + 4 × kept words).
 */
export function packNodePoints(
  d: DecodedNode,
  spacing: number,
  header: Pick<TdppHeader, 'hasColor' | 'hasIntensity'>,
  onlySetup: number | null = null,
): Uint32Array<ArrayBuffer> {
  const out = new Uint32Array(POINT_HEADER_WORDS + d.count * POINT_WORDS);
  const f = new Float32Array(out.buffer);
  f[0] = spacing;
  let kept = 0;
  for (let i = 0; i < d.count; i++) {
    if (onlySetup !== null && d.rgbs[4 * i + 3] !== onlySetup) {
      continue;
    }
    const o = POINT_HEADER_WORDS + kept * POINT_WORDS;
    kept++;
    f[o] = d.positions[3 * i];
    f[o + 1] = d.positions[3 * i + 1];
    f[o + 2] = d.positions[3 * i + 2];
    let r = d.rgbs[4 * i];
    let g = d.rgbs[4 * i + 1];
    let b = d.rgbs[4 * i + 2];
    const grey = header.hasIntensity
      ? d.intensity[i] >> INTENSITY_SHIFT
      : Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    if (!header.hasColor) {
      r = grey;
      g = grey;
      b = grey;
    }
    out[o + 3] = (r | (g << 8) | (b << 16) | (grey << 24)) >>> 0;
  }
  return kept === d.count ? out : out.slice(0, POINT_HEADER_WORDS + kept * POINT_WORDS);
}
