import type { MouseEvent as ReactMouseEvent } from 'react';
import { useEffect, useRef, useState } from 'react';

export type TableSelection = Readonly<{
  selected: Set<number>;
  clickRow: (viewPos: number, e: ReactMouseEvent) => void;
}>;

/** Row-number selection keyed by ORIGINAL row indices — stable across
 *  sort/filter. Plain click = select one, Ctrl = toggle, Shift = range over
 *  the current VIEW order (Ctrl+Shift keeps the existing selection). Clears
 *  when a new result arrives. */
export function useTableSelection(columns: string[], viewIdx: number[]): TableSelection {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const anchor = useRef<number | null>(null); // view position of the last non-shift click

  // reset per-result state when a new payload arrives
  // biome-ignore lint/correctness/useExhaustiveDependencies: columns is the new-result signal, not read inside
  useEffect(() => {
    setSelected(new Set());
    anchor.current = null;
  }, [columns]);

  const clickRow = (viewPos: number, e: ReactMouseEvent): void => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.shiftKey && anchor.current != null) {
      const [lo, hi] = anchor.current < viewPos ? [anchor.current, viewPos] : [viewPos, anchor.current];
      const next = ctrl ? new Set(selected) : new Set<number>();
      for (let p = lo; p <= hi; p++) {
        next.add(viewIdx[p]);
      }
      setSelected(next);
      return;
    }

    const ri = viewIdx[viewPos];
    if (ctrl) {
      const next = new Set(selected);
      if (next.has(ri)) {
        next.delete(ri);
      } else {
        next.add(ri);
      }
      setSelected(next);
    } else {
      setSelected(selected.size === 1 && selected.has(ri) ? new Set() : new Set([ri]));
    }
    anchor.current = viewPos;
  };

  return { selected, clickRow };
}
