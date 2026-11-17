// Keep-on-screen placement for labels attached to a 3D point
// (DESIGN.md › Animation, D32). Pure.

import type { V2 } from './overlayTypes';

/** Margin kept between an attached label and the view edge (px). */
const EDGE_PX = 8;

/** Top-left of an attached label (box cw×ch, wanted offset `off` from its
 *  anchor) kept inside a w×h view: first mirror the offset across the anchor
 *  on the axis that leaves the view, then clamp what is still outside. */
export function keepInView(
  anchor: [number, number],
  off: V2,
  cw: number,
  ch: number,
  w: number,
  h: number,
): [number, number] {
  const fits = (lo: number, size: number, max: number) => lo >= EDGE_PX && lo + size <= max - EDGE_PX;
  let x = anchor[0] + off[0] - cw / 2;
  let y = anchor[1] + off[1] - ch / 2;
  if (!fits(x, cw, w)) {
    const flipped = anchor[0] - off[0] - cw / 2;
    if (fits(flipped, cw, w)) {
      x = flipped;
    }
  }
  if (!fits(y, ch, h)) {
    const flipped = anchor[1] - off[1] - ch / 2;
    if (fits(flipped, ch, h)) {
      y = flipped;
    }
  }
  x = Math.min(Math.max(x, EDGE_PX), Math.max(EDGE_PX, w - cw - EDGE_PX));
  y = Math.min(Math.max(y, EDGE_PX), Math.max(EDGE_PX, h - ch - EDGE_PX));
  return [x, y];
}
