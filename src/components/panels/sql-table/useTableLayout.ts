import { usePointerDrag } from '@treDeSpaceUI/lib/usePointerDrag';
import { useVirtualRows, type VirtualRows } from '@treDeSpaceUI/lib/useVirtualRows';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { useEffect, useRef, useState } from 'react';

export const ROW_H = 22; // px — fixed, so the visible window is pure arithmetic
const DEFAULT_COL_W = 140;
const MIN_COL_W = 48;

export type TableLayout = Readonly<{
  widths: number[];
  gutterW: number;
  totalW: number;
  scroller: RefObject<HTMLDivElement | null>;
  /** The mounted row window, from the shared virtualization hook. */
  virtual: VirtualRows;
  startResize: (col: number, e: ReactPointerEvent<HTMLElement>) => void;
}>;

/** Column widths (drag-to-resize with a 48px floor) and the virtualized row
 *  window. Resets to the defaults whenever a new result (columns) arrives.
 *  `viewCount` is the FILTERED row count — what the body actually lays out. */
export function useTableLayout(columns: string[], rowCount: number, viewCount: number): TableLayout {
  const [widths, setWidths] = useState<number[]>(() => columns.map(() => DEFAULT_COL_W));
  const scroller = useRef<HTMLDivElement>(null);
  const virtual = useVirtualRows(scroller, viewCount, ROW_H);
  const resizing = useRef({ col: 0, startW: 0 });

  // reset per-result layout when a new payload arrives
  useEffect(() => {
    setWidths(columns.map(() => DEFAULT_COL_W));
    if (scroller.current) {
      scroller.current.scrollTop = 0;
    }
  }, [columns]);

  const drag = usePointerDrag({
    onMove: ({ dx }) => {
      const { col, startW } = resizing.current;
      const w = Math.max(MIN_COL_W, startW + dx);
      setWidths((prev) => prev.map((x, i) => (i === col ? w : x)));
    },
  });

  const startResize = (col: number, e: ReactPointerEvent<HTMLElement>): void => {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = { col, startW: widths[col] };
    drag.start(e);
  };

  const gutterW = Math.max(40, String(rowCount).length * 7 + 18);
  const totalW = gutterW + widths.reduce((a, b) => a + b, 0);

  return { widths, gutterW, totalW, scroller, virtual, startResize };
}
