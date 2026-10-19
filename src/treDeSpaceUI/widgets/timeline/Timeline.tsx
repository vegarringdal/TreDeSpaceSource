import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useMemo,
  useRef,
  useState,
} from 'react';
import { cn } from '../../lib/cn';
import { useVirtualRows } from '../../lib/useVirtualRows';
import { useWheel } from '../../lib/useWheel';
import { LabelWidthHandle } from './LabelWidthHandle';
import { TimelineLane } from './TimelineLane';
import { TimelineOverlays } from './TimelineOverlays';
import { TimelineRowLabel } from './TimelineRowLabel';
import { defaultTimeFormat, TimeRuler } from './TimeRuler';
import { groupByRow, keepInView, timeToX, xToTime, zoomAt } from './timelineMath';
import type { TimelineItem, TimelinePoint, TimelineProps } from './timelineTypes';
import { useTimelineBoxSelect } from './useTimelineBoxSelect';
import { useTimelineDrag } from './useTimelineDrag';

const NONE: readonly never[] = [];
/** ←/→ keep the playhead at least this far (px) inside the lanes. */
const PLAYHEAD_MARGIN_PX = 24;

export type {
  DropHint,
  TimelineItem,
  TimelinePoint,
  TimelineProps,
  TimelineRow,
  TimelineSnap,
  TimelineView,
} from './timelineTypes';

/**
 * A multi-lane timeline: rows (groups and lanes) with a label column, items
 * (span bars, clip blocks) that drag with snapping and propose magnetic links
 * (after / with / ends with — Alt drops without one), edge resize, key points
 * (filled or hollow diamonds, markers), a playhead, an end mark, an optional
 * dimmed outside and an in/out range. Pure
 * presentation: every edit is reported through the callbacks.
 *
 * Mouse: drag the ruler to scrub, Shift+drag it for a range; Ctrl+wheel
 * zooms, Shift+wheel pans; drag empty lane space to box-select. A scrub or a
 * clip / edge / key drag held at or past an edge pans the view and rides
 * along.
 * Keys: ←/→ move the playhead (Shift = 1 s) and keep it in view, +/− zoom.
 *
 * Rows are virtualized (all `rowHeight` tall), so thousands of lanes cost
 * only the ones in view.
 */
export function Timeline(p: TimelineProps) {
  const {
    rows,
    items,
    points,
    playhead,
    duration,
    view,
    range,
    dimOutside,
    endMark,
    labelWidth = 150,
    rowHeight = 22,
    format = defaultTimeFormat,
  } = p;
  const body = useRef<HTMLDivElement>(null);
  const [hint, setHint] = useState<string | null>(null);
  // rows carry a 1 px bottom rule, so they are one pixel taller than rowHeight
  const pitch = rowHeight + 1;
  const vr = useVirtualRows(body, rows.length, pitch);
  const itemsByRow = useMemo(() => groupByRow<TimelineItem>(items), [items]);
  const pointsByRow = useMemo(() => groupByRow<TimelinePoint>(points), [points]);

  /** The lanes' left / right edge in client px (label column and scrollbar excluded). */
  const lanes = () => {
    const el = body.current;
    const left = el?.getBoundingClientRect().left ?? 0;
    return { left: left + labelWidth, right: left + (el?.clientWidth ?? 0) };
  };

  const drag = useTimelineDrag({
    ...p,
    lanes,
    onItemsMove: (ids, dt, h, phase) => {
      setHint(phase === 'drag' ? (h?.target ?? null) : null);
      p.onItemsMove(ids, dt, h, phase);
    },
  });

  const laneX = (clientX: number) => clientX - (body.current?.getBoundingClientRect().left ?? 0) - labelWidth;
  const { box, handleLaneDown } = useTimelineBoxSelect({ ...p, labelWidth, pitch });

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const step = e.shiftKey ? 1 : 0.1;
      const t = Math.max(0, playhead + (e.key === 'ArrowRight' ? step : -step));
      p.onSeek(t);
      const strip = lanes();
      const next = keepInView(view, t, strip.right - strip.left, PLAYHEAD_MARGIN_PX);
      if (next !== view) {
        p.onViewChange(next);
      }
      e.preventDefault();
    } else if (e.key === '+' || e.key === '=' || e.key === '-') {
      p.onViewChange(zoomAt(view, e.key === '-' ? 1 / 1.25 : 1.25, timeToX(playhead, view)));
      e.preventDefault();
    }
  };

  // a plain wheel scrolls the rows; Ctrl / Shift are the timeline's alone
  // (Ctrl+wheel would zoom the whole page too)
  const handleWheel = (e: WheelEvent) => {
    if (e.ctrlKey) {
      e.preventDefault();
      p.onViewChange(zoomAt(view, e.deltaY < 0 ? 1.2 : 1 / 1.2, laneX(e.clientX)));
    } else if (e.shiftKey) {
      e.preventDefault();
      p.onViewChange({ ...view, offset: Math.max(0, view.offset + (e.deltaY || e.deltaX) / view.pxPerSec) });
    }
  };
  useWheel(body, handleWheel);

  const menu = (e: ReactMouseEvent, kind: 'item' | 'row' | 'point' | 'empty', id?: string) => {
    e.preventDefault();
    e.stopPropagation();
    p.onContextMenu({ kind, id, t: Math.max(0, xToTime(laneX(e.clientX), view)) }, { x: e.clientX, y: e.clientY });
  };

  return (
    <div
      role="application"
      aria-label="Timeline"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the timeline is one keyboard-driven widget (arrows scrub, +/- zoom)
      tabIndex={0}
      className={cn('relative flex h-full min-h-0 flex-col outline-none', p.className)}
      onKeyDown={handleKeyDown}
    >
      {p.onLabelWidthChange && <LabelWidthHandle width={labelWidth} onChange={p.onLabelWidthChange} />}
      <div className="flex shrink-0">
        <div className="shrink-0 border-slate-700 border-r border-b bg-slate-900" style={{ width: labelWidth }} />
        <TimeRuler
          className="min-w-0 flex-1"
          view={view}
          duration={duration}
          playhead={playhead}
          format={format}
          range={range}
          onSeek={p.onSeek}
          onViewChange={p.onViewChange}
          onRangeChange={p.onRangeChange}
        />
      </div>
      <div
        ref={body}
        className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
        onPointerDown={handleLaneDown}
        onScroll={vr.onScroll}
        onContextMenu={(e) => menu(e, 'empty')}
      >
        <div className="relative" style={{ height: vr.totalH }}>
          {rows.slice(vr.first, vr.last).map((row, k) => (
            <div
              key={row.id}
              className={cn(
                'absolute right-0 left-0 flex border-slate-800 border-b',
                row.kind === 'group' && 'bg-slate-900/60',
                row.locked && 'opacity-40',
              )}
              style={{ top: (vr.first + k) * pitch }}
            >
              <TimelineRowLabel
                row={row}
                width={labelWidth}
                height={rowHeight}
                onToggle={p.onToggleRow}
                onOpen={(id) => p.onOpen({ kind: 'row', id })}
                onMenu={(e, id) => menu(e, 'row', id)}
              />
              <TimelineLane
                row={row}
                items={itemsByRow.get(row.id) ?? NONE}
                points={pointsByRow.get(row.id) ?? NONE}
                view={view}
                height={rowHeight}
                hint={hint}
                format={format}
                onItemDown={drag.dragItem}
                onEdgeDown={drag.dragEdge}
                onPointDown={drag.dragPoint}
                onItemOpen={(id) => p.onOpen({ kind: 'item', id })}
                onItemMenu={(e, kind, id) => menu(e, kind, id)}
              />
            </div>
          ))}
        </div>
        <TimelineOverlays
          view={view}
          labelWidth={labelWidth}
          playhead={playhead}
          minHeight={vr.totalH}
          dimOutside={dimOutside}
          endMark={endMark}
          box={box}
        />
      </div>
    </div>
  );
}
