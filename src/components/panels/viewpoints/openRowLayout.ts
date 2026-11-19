// Layout arithmetic of a virtualized list whose rows are all one height
// except a single "open" row that is taller (see useOpenRowVirtualList).
// Pure — shared by the hook and its tests.

/** Top of row `index`: rows after the open one sit lower by `pushDown`, the
 *  height the open row needs beyond its own slot. `openIndex` is -1 when no
 *  row is open. */
export function openRowTop(index: number, rowH: number, openIndex: number, pushDown: number): number {
  const isAfterOpen = openIndex >= 0 && index > openIndex;

  return index * rowH + (isAfterOpen ? pushDown : 0);
}

/** The scroll position that brings the span `top`..`bottom` into a viewport
 *  `viewH` tall that is now at `scrollTop` — unchanged when the span is
 *  already in view. A span taller than the viewport is aligned at its top,
 *  so a row's header never ends up above the fold. */
export function revealScrollTop(top: number, bottom: number, scrollTop: number, viewH: number): number {
  if (top < scrollTop) {
    return top;
  }

  if (bottom > scrollTop + viewH) {
    return Math.min(top, bottom - viewH);
  }

  return scrollTop;
}
