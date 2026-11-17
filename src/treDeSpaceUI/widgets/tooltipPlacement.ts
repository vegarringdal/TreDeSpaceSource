/**
 * Where a tooltip bubble sits relative to the element it describes.
 *
 * Pure geometry, no DOM — `Tooltip.ts` measures the rects and applies the
 * result.
 */

/** Which side of the anchor the BUBBLE sits on; the arrow pokes out of the
 *  opposite edge. */
export type TooltipSide = 'top' | 'bottom' | 'left' | 'right';

export type TooltipRect = Readonly<{ top: number; left: number; width: number; height: number }>;

export type TooltipSize = Readonly<{ width: number; height: number }>;

export type TooltipPlacement = Readonly<{
  side: TooltipSide;
  left: number;
  top: number;
  /** Arrow offset along the bubble edge facing the anchor, px from the bubble's
   *  top-left corner — down that edge for `left` / `right`, across it otherwise. */
  arrow: number;
}>;

const GAP = 7; // bubble-to-anchor breathing room
const MARGIN = 4; // keep the bubble this far inside the viewport
const ARROW_INSET = 8; // arrow stays this far from the bubble's corners
const ARROW_HALF = 4; // half the rotated arrow square

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/** Arrow offset that points at `centre`, kept away from the bubble's corners. */
function arrowOffset(centre: number, bubbleStart: number, bubbleSpan: number): number {
  return clamp(centre - bubbleStart - ARROW_HALF, ARROW_INSET, bubbleSpan - ARROW_INSET * 2);
}

/**
 * Place a bubble of `tip` size against `anchor`.
 *
 * A free-standing anchor gets the bubble below it, flipped above when there is
 * no room, aligned to its left edge and clamped to the viewport.
 *
 * An anchor inside an open menu or listbox passes that container as `container`
 * and the bubble goes BESIDE the whole container instead — right if it fits,
 * else left — vertically centred on the anchor. A bubble laid over the list
 * would hide the entries the pointer is heading for, which is the one thing a
 * menu cannot afford. With no room on either side it falls back to the
 * free-standing behaviour.
 */
export function computeTooltipPlacement(
  anchor: TooltipRect,
  container: TooltipRect | null,
  tip: TooltipSize,
  viewport: TooltipSize,
): TooltipPlacement {
  if (container) {
    const rightLeft = container.left + container.width + GAP;
    const leftLeft = container.left - GAP - tip.width;
    const fitsRight = rightLeft + tip.width <= viewport.width - MARGIN;
    const fitsLeft = leftLeft >= MARGIN;

    if (fitsRight || fitsLeft) {
      const centre = anchor.top + anchor.height / 2;
      const top = clamp(centre - tip.height / 2, MARGIN, viewport.height - tip.height - MARGIN);

      return {
        side: fitsRight ? 'right' : 'left',
        left: fitsRight ? rightLeft : leftLeft,
        top,
        arrow: arrowOffset(centre, top, tip.height),
      };
    }
  }

  const belowTop = anchor.top + anchor.height + GAP;
  const below = belowTop + tip.height <= viewport.height - MARGIN || anchor.top - GAP - tip.height < MARGIN;
  const top = below ? belowTop : anchor.top - tip.height - GAP;
  const left = clamp(anchor.left, MARGIN, viewport.width - tip.width - MARGIN);

  return {
    side: below ? 'bottom' : 'top',
    left,
    top,
    arrow: arrowOffset(anchor.left + anchor.width / 2, left, tip.width),
  };
}
