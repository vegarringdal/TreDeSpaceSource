import { useVirtualRows } from '@treDeSpaceUI/lib/useVirtualRows';
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { openRowTop, revealScrollTop } from './openRowLayout';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type OpenRowVirtualListArgs = Readonly<{
  count: number;
  /** height of one row's slot: the closed row plus the gap under it */
  rowH: number;
  /** index of the open row — the one the measured element belongs to — or -1 */
  openIndex: number;
  /** how much of the measured element lies inside its row's own slot; what
   *  it is taller than that pushes the following rows down */
  inSlotH: number;
}>;

export type OpenRowVirtualList = Readonly<{
  /** attach to the scrolling element */
  scrollerRef: RefObject<HTMLDivElement | null>;
  /** attach to the open row's variable-height element (keep it mounted even
   *  when its row is outside the window) */
  measuredRef: (el: HTMLElement | null) => void;
  /** the [first, last) row window to mount */
  first: number;
  last: number;
  /** height of the `position: relative` spacer the rows sit in */
  spacerH: number;
  onScroll: () => void;
  /** `top` of row `index` inside the spacer */
  rowTop: (index: number) => number;
}>;

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const OVERSCAN_ROWS = 8;

// -----------------------------------------------------------------------------
// Hook
// -----------------------------------------------------------------------------

/** Virtual scrolling for a list of fixed-height rows in which ONE row is
 *  open and taller: its element is measured, and the rows after it are
 *  pushed down by what it needs beyond its slot. The row window is computed
 *  as if every row were closed, so the overscan grows by the rows the open
 *  one displaces.
 *
 *  The list scrolls to the open row when — and only when — another row
 *  becomes the open one; its height is read from the DOM at that moment, so a
 *  later resize of it never moves the list. */
export function useOpenRowVirtualList({ count, rowH, openIndex, inSlotH }: OpenRowVirtualListArgs): OpenRowVirtualList {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const measuredNow = useRef<HTMLElement | null>(null);
  const [measuredEl, setMeasuredEl] = useState<HTMLElement | null>(null);
  const [measuredH, setMeasuredH] = useState(0);

  const pushDown = openIndex >= 0 && measuredEl ? Math.max(0, measuredH - inSlotH) : 0;
  const v = useVirtualRows(scrollerRef, count, rowH, OVERSCAN_ROWS + Math.ceil(pushDown / rowH));

  const measuredRef = useCallback((el: HTMLElement | null): void => {
    measuredNow.current = el;
    setMeasuredEl(el);
  }, []);

  useLayoutEffect(() => {
    if (!measuredEl) {
      return;
    }

    const measure = (): void => setMeasuredH(measuredEl.offsetHeight);
    const ro = new ResizeObserver(measure);
    ro.observe(measuredEl);
    measure();

    return () => ro.disconnect();
  }, [measuredEl]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || openIndex < 0) {
      return;
    }

    const top = openIndex * rowH;
    const beyondSlot = Math.max(0, (measuredNow.current?.offsetHeight ?? 0) - inSlotH);
    scroller.scrollTop = revealScrollTop(top, top + rowH + beyondSlot, scroller.scrollTop, scroller.clientHeight);
  }, [openIndex, rowH, inSlotH]);

  return {
    scrollerRef,
    measuredRef,
    first: v.first,
    last: v.last,
    spacerH: v.totalH + pushDown,
    onScroll: v.onScroll,
    rowTop: (index) => openRowTop(index, rowH, openIndex, pushDown),
  };
}
