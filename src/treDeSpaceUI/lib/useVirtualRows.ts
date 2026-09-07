import { type RefObject, useEffect, useState } from 'react';

export type VirtualRows = Readonly<{
  /** the [first, last) row window to mount — includes the overscan */
  first: number;
  last: number;
  /** full content height: give the spacer the rows sit in this height */
  totalH: number;
  /** attach to the scroller's onScroll (or call after setting scrollTop) */
  onScroll: () => void;
}>;

const DEFAULT_OVERSCAN = 8;
const INITIAL_VIEW_H = 400;

/** Fixed-height row virtualization: which rows of `count` are in view in the
 *  `scroller` (a scrolling element the caller renders), plus the height of
 *  the spacer to lay them out in. Rows must all be `rowH` tall, so the window
 *  is pure arithmetic — no measuring. Mount only [first, last), each row
 *  absolutely positioned at `index * rowH` inside a `position: relative`
 *  spacer of `totalH`. The viewport height follows the element (ResizeObserver). */
export function useVirtualRows(
  scroller: RefObject<HTMLElement | null>,
  count: number,
  rowH: number,
  overscan: number = DEFAULT_OVERSCAN,
): VirtualRows {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(INITIAL_VIEW_H);

  useEffect(() => {
    const el = scroller.current;
    if (!el) {
      return;
    }
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    setViewH(el.clientHeight);
    return () => ro.disconnect();
  }, [scroller]);

  const first = Math.max(0, Math.floor(scrollTop / rowH) - overscan);
  const last = Math.min(count, Math.ceil((scrollTop + viewH) / rowH) + overscan);
  const onScroll = () => setScrollTop(scroller.current?.scrollTop ?? 0);

  return { first, last, totalH: count * rowH, onScroll };
}
