import { cn } from '@treDeSpaceUI/lib/cn';
import { useVirtualRows } from '@treDeSpaceUI/lib/useVirtualRows';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { viewpointsActions as act } from '../../../state/viewer/viewpoints.actions';
import type { Viewpoint } from '../../../state/viewer/viewpoints.state';
import { RichText } from '../../shared/RichText';
import { VIEWER_DESCRIPTION, VIEWER_ROW_ACTIVE, VIEWER_ROW_IDLE } from './viewpointViewerStyles';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type ViewpointViewerListProps = Readonly<{
  list: readonly Viewpoint[];
  /** index of the active viewpoint in `list`, -1 when none is active */
  activeIndex: number;
}>;

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** One list row: the name button plus the gap under it. */
const ROW_H = 30;
const ROW_GAP = 4;
const OVERSCAN_ROWS = 8;

// -----------------------------------------------------------------------------
// Render
// -----------------------------------------------------------------------------

/** The viewpoint names as a virtualized list — only the rows in view are
 *  mounted, so a set of thousands scrolls like a short one. Rows are a fixed
 *  height (long names are cut with an ellipsis); the one exception is the
 *  active viewpoint's description, which hangs under its row: it is measured,
 *  and the rows after it are pushed down by that height. The row window is
 *  computed as if the description were not there, so the overscan grows by
 *  the rows it displaces. A newly activated row is scrolled into view. */
export function ViewpointViewerList({ list, activeIndex }: ViewpointViewerListProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const descRef = useRef<HTMLDivElement>(null);
  const [descH, setDescH] = useState(0);

  const active = activeIndex >= 0 ? list[activeIndex] : null;
  const description = active?.description.trim() ? active.description : '';
  const pushDown = description ? descH : 0;
  const v = useVirtualRows(scroller, list.length, ROW_H, OVERSCAN_ROWS + Math.ceil(pushDown / ROW_H));
  const rowTop = (i: number): number => i * ROW_H + (i > activeIndex && activeIndex >= 0 ? pushDown : 0);

  useLayoutEffect(() => {
    const el = descRef.current;
    if (!el || !description) {
      return;
    }
    const measure = (): void => setDescH(el.offsetHeight);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [description]);

  useEffect(() => {
    const el = scroller.current;
    if (!el || activeIndex < 0) {
      return;
    }
    const top = activeIndex * ROW_H;
    const bottom = top + ROW_H + pushDown;
    if (top < el.scrollTop) {
      el.scrollTop = top;
    } else if (bottom > el.scrollTop + el.clientHeight) {
      el.scrollTop = Math.min(top, bottom - el.clientHeight);
    }
  }, [activeIndex, pushDown]);

  return (
    <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto" onScroll={v.onScroll}>
      <div className="relative" style={{ height: v.totalH + pushDown }}>
        {list.slice(v.first, v.last).map((vp, k) => (
          <button
            key={vp.id}
            type="button"
            data-tooltip="Activate this viewpoint"
            className={cn(
              'absolute right-0 left-0 cursor-pointer truncate border px-2 text-left text-xs transition-colors',
              v.first + k === activeIndex ? VIEWER_ROW_ACTIVE : VIEWER_ROW_IDLE,
            )}
            style={{ top: rowTop(v.first + k), height: ROW_H - ROW_GAP }}
            onClick={() => void act.activate(vp.id)}
          >
            {vp.name}
          </button>
        ))}
        {description && (
          <div ref={descRef} className="absolute right-0 left-0" style={{ top: (activeIndex + 1) * ROW_H - ROW_GAP }}>
            <RichText block text={description} className={VIEWER_DESCRIPTION} />
          </div>
        )}
      </div>
    </div>
  );
}
