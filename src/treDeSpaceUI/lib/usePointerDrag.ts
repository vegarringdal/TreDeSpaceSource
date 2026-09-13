import type { PointerEvent as ReactPointerEvent } from 'react';
import { useCallback, useRef } from 'react';

export type PointerDragDelta = Readonly<{
  /** Movement since the press, in px. */
  dx: number;
  dy: number;
  /** Current pointer position. */
  x: number;
  y: number;
}>;

export interface PointerDragOptions {
  onMove: (d: PointerDragDelta, e: PointerEvent) => void;
  /** Fired once the pointer first passes `threshold`. */
  onStart?: (d: PointerDragDelta) => void;
  /** `moved` is false for a press that never passed the threshold — a click. */
  onEnd?: (moved: boolean) => void;
  /** px of travel before the drag counts as a drag (default 0). */
  threshold?: number;
}

export type PointerDrag = Readonly<{
  /** Attach to onPointerDown of the grab handle. */
  start: (e: ReactPointerEvent<HTMLElement>) => void;
  isDragging: () => boolean;
}>;

/**
 * One press-and-drag gesture, on pointer CAPTURE: every later event retargets
 * to the handle, so the drag survives the pointer crossing an iframe, another
 * panel or the window edge — which window-level listeners do not.
 */
export function usePointerDrag({ onMove, onStart, onEnd, threshold = 0 }: PointerDragOptions): PointerDrag {
  const latest = useRef({ onMove, onStart, onEnd, threshold });
  latest.current = { onMove, onStart, onEnd, threshold };
  const active = useRef(false);

  const start = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const el = e.currentTarget;
    const origin = { x: e.clientX, y: e.clientY };
    const pointerId = e.pointerId;
    let moved = latest.current.threshold === 0;
    active.current = true;
    el.setPointerCapture(pointerId);

    const delta = (ev: PointerEvent): PointerDragDelta => ({
      dx: ev.clientX - origin.x,
      dy: ev.clientY - origin.y,
      x: ev.clientX,
      y: ev.clientY,
    });

    const move = (ev: PointerEvent) => {
      const d = delta(ev);
      if (!moved) {
        if (Math.abs(d.dx) < latest.current.threshold && Math.abs(d.dy) < latest.current.threshold) {
          return;
        }
        moved = true;
        latest.current.onStart?.(d);
      }
      latest.current.onMove(d, ev);
    };

    const end = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      if (el.hasPointerCapture(pointerId)) {
        el.releasePointerCapture(pointerId);
      }
      active.current = false;
      latest.current.onEnd?.(moved);
    };

    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }, []);

  return { start, isDragging: () => active.current };
}
