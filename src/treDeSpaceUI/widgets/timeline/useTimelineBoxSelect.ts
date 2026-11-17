import { type PointerEvent as ReactPointerEvent, useState } from 'react';
import { xToTime } from './timelineMath';
import type { TimelineProps } from './timelineTypes';

export type SelectBox = { x0: number; y0: number; x1: number; y1: number };

type Deps = Pick<TimelineProps, 'rows' | 'items' | 'points' | 'view' | 'onSeek' | 'onSelect'> & {
  labelWidth: number;
  /** row pitch in px (row height + its 1 px rule) */
  pitch: number;
};

/** Empty lane space: a click seeks (and clears the selection unless Shift /
 *  Ctrl), a drag rubber-band selects items and points. */
export function useTimelineBoxSelect(d: Deps): {
  box: SelectBox | null;
  handleLaneDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
} {
  const [box, setBox] = useState<SelectBox | null>(null);

  const handleLaneDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    if (e.button !== 0 || e.clientX - r.left < d.labelWidth) {
      return;
    }
    const at = (ev: { clientX: number; clientY: number }) => ({
      x: ev.clientX - r.left,
      y: ev.clientY - r.top + el.scrollTop,
    });
    const start = at(e);
    const additive = e.shiftKey || e.ctrlKey;
    el.setPointerCapture(e.pointerId);
    let moved = false;
    const move = (ev: PointerEvent) => {
      moved = moved || Math.abs(ev.clientX - e.clientX) > 3 || Math.abs(ev.clientY - e.clientY) > 3;
      if (moved) {
        const p = at(ev);
        setBox({ x0: start.x, y0: start.y, x1: p.x, y1: p.y });
      }
    };
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      setBox(null);
      const end = at(ev);
      if (!moved) {
        d.onSeek(Math.max(0, xToTime(end.x - d.labelWidth, d.view)));
        if (!additive) {
          d.onSelect({ items: [], points: [] }, false);
        }
        return;
      }
      const t0 = xToTime(Math.min(start.x, end.x) - d.labelWidth, d.view);
      const t1 = xToTime(Math.max(start.x, end.x) - d.labelWidth, d.view);
      const r0 = Math.floor(Math.min(start.y, end.y) / d.pitch);
      const r1 = Math.floor(Math.max(start.y, end.y) / d.pitch);
      const inRows = new Set(d.rows.slice(r0, r1 + 1).map((x) => x.id));
      d.onSelect(
        {
          items: d.items.filter((i) => inRows.has(i.row) && i.end >= t0 && i.start <= t1).map((i) => i.id),
          points: d.points.filter((q) => inRows.has(q.row) && q.t >= t0 && q.t <= t1).map((q) => q.id),
        },
        additive,
      );
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  return { box, handleLaneDown };
}
