import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { useEffect, useRef, useState } from 'react';

export const ROW_H = 22; // px — fixed, so the visible window is pure arithmetic
export const OVERSCAN = 8;
const DEFAULT_COL_W = 140;
const MIN_COL_W = 48;
const INITIAL_VIEW_H = 400;

export type TableLayout = Readonly<{
  widths: number[];
  gutterW: number;
  totalW: number;
  scrollTop: number;
  viewH: number;
  scroller: RefObject<HTMLDivElement | null>;
  setScrollTop: (top: number) => void;
  startResize: (col: number, e: ReactPointerEvent) => void;
}>;

/** Column widths (drag-to-resize with a 48px floor), scroll position and the
 *  measured viewport height that drive the virtualized window. Resets to the
 *  defaults whenever a new result (columns) arrives. */
export function useTableLayout(columns: string[], rowCount: number): TableLayout {
  const [widths, setWidths] = useState<number[]>(() => columns.map(() => DEFAULT_COL_W));
  const [scrollTop, setScrollTop] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const [viewH, setViewH] = useState(INITIAL_VIEW_H);

  // reset per-result layout when a new payload arrives
  useEffect(() => {
    setWidths(columns.map(() => DEFAULT_COL_W));
    setScrollTop(0);
    if (scroller.current) {
      scroller.current.scrollTop = 0;
    }
  }, [columns]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) {
      return;
    }
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    setViewH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const startResize = (col: number, e: ReactPointerEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widths[col];
    const move = (ev: PointerEvent): void => {
      const w = Math.max(MIN_COL_W, startW + ev.clientX - startX);
      setWidths((prev) => prev.map((x, i) => (i === col ? w : x)));
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const gutterW = Math.max(40, String(rowCount).length * 7 + 18);
  const totalW = gutterW + widths.reduce((a, b) => a + b, 0);

  return { widths, gutterW, totalW, scrollTop, viewH, scroller, setScrollTop, startResize };
}
