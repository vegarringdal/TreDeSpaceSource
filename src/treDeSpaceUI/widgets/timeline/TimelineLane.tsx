import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { cn } from '../../lib/cn';
import { timeToX } from './timelineMath';
import type { TimelineItem, TimelinePoint, TimelineRow, TimelineView } from './timelineTypes';

type Props = Readonly<{
  row: TimelineRow;
  items: readonly TimelineItem[];
  points: readonly TimelinePoint[];
  view: TimelineView;
  height: number;
  hint: string | null;
  format: (t: number) => string;
  onItemDown: (e: ReactPointerEvent<HTMLElement>, item: TimelineItem) => void;
  onEdgeDown: (e: ReactPointerEvent<HTMLElement>, item: TimelineItem, edge: 'start' | 'end') => void;
  onPointDown: (e: ReactPointerEvent<HTMLElement>, point: TimelinePoint) => void;
  onItemOpen: (id: string) => void;
  onItemMenu: (e: ReactMouseEvent, kind: 'item' | 'point', id: string) => void;
}>;

const HATCH = 'repeating-linear-gradient(135deg, rgba(255,255,255,0.12) 0 4px, transparent 4px 8px)';
/** Narrowest an item is drawn when it sets no minWidth (px). */
const MIN_ITEM_PX = 3;

/** One lane: span bars / clip blocks with resize edges, and key points. */
export function TimelineLane({
  row,
  items,
  points,
  view,
  height,
  hint,
  format,
  onItemDown,
  onEdgeDown,
  onPointDown,
  onItemOpen,
  onItemMenu,
}: Props) {
  return (
    <div className="relative min-w-0 flex-1 overflow-hidden" style={{ height }}>
      {items.map((it) => {
        const left = timeToX(it.start, view);
        const width = Math.max(it.minWidth ?? MIN_ITEM_PX, (it.end - it.start) * view.pxPerSec);
        const tint = it.tint ?? row.tint ?? '#3b82f6';
        return (
          <div
            key={it.id}
            role="button"
            tabIndex={-1}
            aria-label={`${it.label}, ${format(it.start)} to ${format(it.end)}`}
            data-tooltip={`${it.label}\n${format(it.start)} → ${format(it.end)}`}
            className={cn(
              'absolute flex items-center overflow-hidden whitespace-nowrap text-[10px] text-slate-50',
              it.span ? 'top-0.5 h-1.5' : 'top-1 bottom-1 px-1',
              it.selected && 'outline outline-2 outline-sky-300',
              hint === it.id && 'outline outline-2 outline-amber-300',
              it.locked && 'cursor-default opacity-40',
              it.fixed && 'cursor-pointer',
              !it.locked && !it.fixed && 'cursor-grab',
            )}
            style={{ left, width, background: it.hatched ? `${HATCH}, ${tint}` : tint, opacity: it.span ? 0.8 : 0.9 }}
            onPointerDown={(e) => onItemDown(e, it)}
            onDoubleClick={() => onItemOpen(it.id)}
            onContextMenu={(e) => onItemMenu(e, 'item', it.id)}
          >
            {!it.span && (
              <>
                {it.linkFrom && <span className="mr-0.5 text-amber-200">⇢</span>}
                {it.icon}
                <span className="truncate">{it.label}</span>
                {!it.locked && !it.fixed && (
                  <>
                    <span
                      className="absolute top-0 bottom-0 left-0 w-1.5 cursor-ew-resize"
                      onPointerDown={(e) => onEdgeDown(e, it, 'start')}
                    />
                    <span
                      className="absolute top-0 right-0 bottom-0 w-1.5 cursor-ew-resize"
                      onPointerDown={(e) => onEdgeDown(e, it, 'end')}
                    />
                  </>
                )}
              </>
            )}
          </div>
        );
      })}
      {points.map((p) => (
        <div
          key={p.id}
          role="button"
          tabIndex={-1}
          aria-label={`${p.label ?? 'Key'} at ${format(p.t)}`}
          data-tooltip={`${p.label ?? 'Key'} · ${format(p.t)}`}
          className={cn(
            'absolute top-1/2 cursor-grab',
            p.shape === 'diamond'
              ? cn(
                  'h-2.5 w-2.5 rotate-45 border',
                  p.selected ? 'border-sky-200 bg-sky-400' : 'border-slate-300 bg-slate-600',
                  p.hollow && (p.selected ? 'bg-slate-900' : 'border-slate-400 bg-slate-900'),
                )
              : cn(
                  'h-0 w-0 border-x-[5px] border-x-transparent border-t-[9px]',
                  p.selected ? 'border-t-sky-300' : 'border-t-amber-400',
                ),
          )}
          style={{ left: timeToX(p.t, view) - 5, marginTop: p.shape === 'diamond' ? -5 : -4 }}
          onPointerDown={(e) => onPointDown(e, p)}
          onContextMenu={(e) => onItemMenu(e, 'point', p.id)}
        />
      ))}
    </div>
  );
}
