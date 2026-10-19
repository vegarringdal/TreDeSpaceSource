import type { PointerEvent as ReactPointerEvent } from 'react';
import { edgePan } from './edgePan';
import { dropHintFor, snapSpanDelta, snapTime } from './timelineMath';
import type { DropHint, TimelineItem, TimelinePoint, TimelineProps } from './timelineTypes';

/** px of travel before a press on an item becomes a drag (else a click). */
const DRAG_THRESHOLD = 3;

type Deps = Pick<
  TimelineProps,
  'view' | 'snap' | 'items' | 'points' | 'onItemsMove' | 'onItemResize' | 'onPointsMove' | 'onSelect' | 'onViewChange'
> & {
  /** The lanes' left / right edge in client px — where a held drag pans. */
  lanes: () => { left: number; right: number };
};

/** One pointer gesture on capture: past the threshold `move(dt, ev)` gets the
 *  seconds between the press and the time now under the pointer — held at or
 *  past an edge of the lanes the view pans and the drag rides along — then
 *  `end(moved, ev)`. */
function gesture(
  e: ReactPointerEvent<HTMLElement>,
  d: Deps,
  move: (dt: number, ev: PointerEvent) => void,
  end: (moved: boolean, ev: PointerEvent) => void,
): void {
  const el = e.currentTarget;
  const x0 = e.clientX;
  let last: PointerEvent | null = null;
  const follow = () => {
    if (last) {
      move(pan.timeAt(last.clientX) - t0, last);
    }
  };
  const pan = edgePan(d.lanes, d.view, d.onViewChange, follow);
  const t0 = pan.timeAt(x0);
  el.setPointerCapture(e.pointerId);
  const onMove = (ev: PointerEvent) => {
    if (!last && Math.abs(ev.clientX - x0) < DRAG_THRESHOLD) {
      return;
    }
    last = ev;
    pan.update(ev.clientX);
    follow();
  };
  const onUp = (ev: PointerEvent) => {
    pan.stop();
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onUp);
    end(last !== null, ev);
  };
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
}

/** The item / edge / point drag gestures of the Timeline. */
export function useTimelineDrag(d: Deps): {
  dragItem: (e: ReactPointerEvent<HTMLElement>, item: TimelineItem) => void;
  dragEdge: (e: ReactPointerEvent<HTMLElement>, item: TimelineItem, edge: 'start' | 'end') => void;
  dragPoint: (e: ReactPointerEvent<HTMLElement>, point: TimelinePoint) => void;
} {
  const additive = (e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) =>
    e.shiftKey || e.ctrlKey || e.metaKey;

  const dragItem = (e: ReactPointerEvent<HTMLElement>, item: TimelineItem) => {
    e.stopPropagation();
    if (item.locked) {
      return;
    }
    if (!item.selected || additive(e)) {
      d.onSelect({ items: [item.id], points: [] }, additive(e));
    }
    if (item.fixed) {
      return;
    }
    const ids = item.selected ? d.items.filter((i) => i.selected && !i.locked && !i.fixed).map((i) => i.id) : [item.id];
    const moving = new Set(ids);
    const others = d.items.filter((i) => !moving.has(i.id));
    let last: { dt: number; hint: DropHint | null } = { dt: 0, hint: null };
    gesture(
      e,
      d,
      (moveDt, ev) => {
        const dt = snapSpanDelta(item.start, item.end, moveDt, d.snap, d.view);
        const hint = ev.altKey
          ? null
          : dropHintFor({ id: item.id, start: item.start + dt, end: item.end + dt }, others, d.view);
        last = { dt, hint };
        d.onItemsMove(ids, dt, hint, 'drag');
      },
      (moved, ev) => {
        if (moved) {
          d.onItemsMove(ids, last.dt, ev.altKey ? null : last.hint, 'end');
        }
      },
    );
  };

  const dragEdge = (e: ReactPointerEvent<HTMLElement>, item: TimelineItem, edge: 'start' | 'end') => {
    e.stopPropagation();
    if (item.locked || item.fixed) {
      return;
    }
    const base = edge === 'start' ? item.start : item.end;
    let lastT = base;
    gesture(
      e,
      d,
      (moveDt, ev) => {
        lastT = Math.max(0, snapTime(base + moveDt, d.snap, d.view));
        d.onItemResize(item.id, edge, lastT, ev.shiftKey, 'drag');
      },
      (moved, ev) => {
        if (moved) {
          d.onItemResize(item.id, edge, lastT, ev.shiftKey, 'end');
        }
      },
    );
  };

  const dragPoint = (e: ReactPointerEvent<HTMLElement>, point: TimelinePoint) => {
    e.stopPropagation();
    if (!point.selected || additive(e)) {
      d.onSelect({ items: [], points: [point.id] }, additive(e));
    }
    const ids = point.selected ? d.points.filter((p) => p.selected).map((p) => p.id) : [point.id];
    let lastDt = 0;
    gesture(
      e,
      d,
      (moveDt) => {
        lastDt = snapTime(point.t + moveDt, d.snap, d.view) - point.t;
        d.onPointsMove(ids, lastDt, 'drag');
      },
      (moved) => {
        if (moved) {
          d.onPointsMove(ids, lastDt, 'end');
        }
      },
    );
  };

  return { dragItem, dragEdge, dragPoint };
}
