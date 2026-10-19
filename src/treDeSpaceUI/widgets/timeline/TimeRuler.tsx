import { type PointerEvent as ReactPointerEvent, useRef } from 'react';
import { cn } from '../../lib/cn';
import { useElementWidth } from '../../lib/useElementWidth';
import { useWheel } from '../../lib/useWheel';
import { edgePan } from './edgePan';
import { ticks, timeToX, xToTime, zoomAt } from './timelineMath';
import type { TimelineView } from './timelineTypes';

export interface TimeRulerProps {
  /** the visible window (as Timeline's `view`) */
  view: TimelineView;
  /** total length (s) — the ruler is dimmed past it */
  duration: number;
  /** playhead time (s), the red marker */
  playhead: number;
  /** label format for major ticks (default "12.5s" / "1:05") */
  format?: (t: number) => string;
  /** ad-hoc in/out range, or null */
  range?: { from: number; to: number } | null;
  /** click / drag = seek */
  onSeek: (t: number) => void;
  /** wheel: Ctrl = zoom about the pointer, otherwise pan; a scrub held at or
   *  past an edge pans too */
  onViewChange: (view: TimelineView) => void;
  /** Shift+drag reports an in/out range, a Shift+click clears it (null); without it Shift+drag just scrubs */
  onRangeChange?: (range: { from: number; to: number } | null) => void;
  className?: string;
}

/** Default label: seconds below a minute, m:ss above. */
export function defaultTimeFormat(t: number): string {
  if (t < 60) {
    return `${Number(t.toFixed(2))}s`;
  }
  const m = Math.floor(t / 60);
  const s = Math.round(t - m * 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * A time ruler: ticks and labels that adapt to the zoom, the playhead, an
 * optional in/out range. Scrub by dragging — held at or past an edge, the view
 * pans and the playhead rides along; wheel pans, Ctrl+wheel zooms.
 */
export function TimeRuler({
  view,
  duration,
  playhead,
  format = defaultTimeFormat,
  range,
  onSeek,
  onViewChange,
  onRangeChange,
  className = '',
}: TimeRulerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref);
  const to = xToTime(width, view);
  const marks = width > 0 ? ticks(Math.max(0, view.offset), to, view.pxPerSec) : [];

  // scrub (or Shift: a range); held at or past an edge the view pans and the
  // playhead / the range's far end rides along on that edge
  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const ranging = e.shiftKey ? onRangeChange : undefined;
    const strip = () => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right };
    };
    let x = e.clientX;
    let moved = false;
    const follow = () => {
      const t = pan.timeAt(x);
      if (ranging) {
        ranging({ from: Math.min(t0, t), to: Math.max(t0, t) });
      } else {
        onSeek(t);
      }
    };
    const pan = edgePan(strip, view, onViewChange, follow);
    const t0 = pan.timeAt(x);
    if (!ranging) {
      onSeek(t0);
    }
    const move = (ev: PointerEvent) => {
      moved = true;
      x = ev.clientX;
      pan.update(x);
      follow();
    };
    const up = () => {
      pan.stop();
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      if (ranging && !moved) {
        ranging(null);
      }
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  // every wheel over the ruler is the ruler's: no page scroll, no page zoom
  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    const r = ref.current?.getBoundingClientRect();
    if (e.ctrlKey) {
      onViewChange(zoomAt(view, e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX - (r?.left ?? 0)));
      return;
    }
    const d = (e.deltaX || e.deltaY) / view.pxPerSec;
    onViewChange({ ...view, offset: Math.max(0, view.offset + d) });
  };
  useWheel(ref, handleWheel);

  return (
    <div
      ref={ref}
      role="slider"
      aria-label="Time ruler"
      aria-valuenow={playhead}
      tabIndex={-1}
      className={cn(
        'relative h-6 cursor-ew-resize select-none overflow-hidden border-slate-700 border-b bg-slate-900 text-[10px] text-slate-400',
        className,
      )}
      onPointerDown={handlePointerDown}
    >
      {duration < to && (
        <div
          className="absolute top-0 bottom-0 bg-slate-950/60"
          style={{ left: Math.max(0, timeToX(duration, view)), right: 0 }}
        />
      )}
      {range && (
        <div
          className="absolute top-0 bottom-0 border-sky-400 border-x bg-sky-500/20"
          style={{ left: timeToX(range.from, view), width: Math.max(1, (range.to - range.from) * view.pxPerSec) }}
        />
      )}
      {marks.map((m) => (
        <div key={m.t} className="absolute bottom-0" style={{ left: timeToX(m.t, view) }}>
          <div className={cn('w-px bg-slate-600', m.major ? 'h-2.5' : 'h-1')} />
          {m.major && <span className="absolute bottom-2.5 left-1 whitespace-nowrap">{format(m.t)}</span>}
        </div>
      ))}
      <div
        className="pointer-events-none absolute top-0 bottom-0 w-px bg-red-400"
        style={{ left: timeToX(playhead, view) }}
      >
        <div className="absolute top-0 -left-1 h-0 w-0 border-x-4 border-x-transparent border-t-[6px] border-t-red-400" />
      </div>
    </div>
  );
}
