import { cn } from '@treDeSpaceUI/lib/cn';
import { viewpointsActions as act } from '../../../state/viewer/viewpoints.actions';
import type { Viewpoint } from '../../../state/viewer/viewpoints.state';
import { RichText } from '../../shared/RichText';
import { useOpenRowVirtualList } from './useOpenRowVirtualList';
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
/** The description hangs wholly under its row: none of it is inside the slot. */
const DESCRIPTION_IN_SLOT_H = 0;

// -----------------------------------------------------------------------------
// Render
// -----------------------------------------------------------------------------

/** The viewpoint names as a virtualized list — only the rows in view are
 *  mounted, so a set of thousands scrolls like a short one. Rows are a fixed
 *  height (long names are cut with an ellipsis); the one exception is the
 *  active viewpoint's description, which hangs under its row: it is measured,
 *  and the rows after it are pushed down by that height. A newly activated
 *  row is scrolled into view. */
export function ViewpointViewerList({ list, activeIndex }: ViewpointViewerListProps) {
  const active = activeIndex >= 0 ? list[activeIndex] : null;
  const description = active?.description.trim() ? active.description : '';
  const v = useOpenRowVirtualList({
    count: list.length,
    rowH: ROW_H,
    openIndex: activeIndex,
    inSlotH: DESCRIPTION_IN_SLOT_H,
  });

  return (
    <div ref={v.scrollerRef} className="min-h-0 flex-1 overflow-y-auto" onScroll={v.onScroll}>
      <div className="relative" style={{ height: v.spacerH }}>
        {list.slice(v.first, v.last).map((vp, k) => (
          <button
            key={vp.id}
            type="button"
            data-tooltip="Activate this viewpoint"
            className={cn(
              'absolute right-0 left-0 cursor-pointer truncate border px-2 text-left text-xs transition-colors',
              v.first + k === activeIndex ? VIEWER_ROW_ACTIVE : VIEWER_ROW_IDLE,
            )}
            style={{ top: v.rowTop(v.first + k), height: ROW_H - ROW_GAP }}
            onClick={() => void act.activate(vp.id)}
          >
            {vp.name}
          </button>
        ))}
        {description && (
          <div
            ref={v.measuredRef}
            className="absolute right-0 left-0"
            style={{ top: (activeIndex + 1) * ROW_H - ROW_GAP }}
          >
            <RichText block text={description} className={VIEWER_DESCRIPTION} />
          </div>
        )}
      </div>
    </div>
  );
}
