import type { Viewpoint } from '../../../state/viewer/viewpoints.state';
import { useOpenRowVirtualList } from './useOpenRowVirtualList';
import { ViewpointRow } from './ViewpointRow';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type ViewpointEditorListProps = Readonly<{
  list: readonly Viewpoint[];
  activeId: string | null;
  /** the viewpoint whose editor row is open, or null */
  selectedId: string | null;
}>;

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** A closed row: the Collapsible header (28) inside its 1 px border. */
const CLOSED_H = 30;
const ROW_GAP = 6;
const ROW_H = CLOSED_H + ROW_GAP;

// -----------------------------------------------------------------------------
// Render
// -----------------------------------------------------------------------------

/** The Viewpoint Editor's rows as a virtualized list — only the rows in view
 *  are mounted, so a set of thousands stays quick. Closed rows are a fixed
 *  height; the one open row (the selected viewpoint) is measured and pushes
 *  the rows after it down. It stays mounted when scrolled out of view, so its
 *  height is always known and a field being typed in is never dropped. The
 *  list scrolls to a viewpoint when it becomes the selected one. */
export function ViewpointEditorList({ list, activeId, selectedId }: ViewpointEditorListProps) {
  const openIndex = selectedId === null ? -1 : list.findIndex((vp) => vp.id === selectedId);
  const v = useOpenRowVirtualList({ count: list.length, rowH: ROW_H, openIndex, inSlotH: CLOSED_H });

  const mounted: number[] = [];
  for (let i = v.first; i < v.last; i++) {
    mounted.push(i);
  }
  if (openIndex >= 0 && (openIndex < v.first || openIndex >= v.last)) {
    mounted.push(openIndex);
  }

  return (
    <div ref={v.scrollerRef} className="min-h-0 flex-1 overflow-y-auto" onScroll={v.onScroll}>
      <div className="relative" style={{ height: v.spacerH }}>
        {mounted.map((i) => {
          const vp = list[i];
          const isOpen = i === openIndex;

          return (
            <div
              key={vp.id}
              ref={isOpen ? v.measuredRef : undefined}
              className="absolute right-0 left-0"
              style={{ top: v.rowTop(i), height: isOpen ? undefined : CLOSED_H }}
            >
              <ViewpointRow vp={vp} active={activeId === vp.id} expanded={isOpen} idx={i} total={list.length} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
