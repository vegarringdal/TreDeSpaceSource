import { edgePanStep, xToTime } from './timelineMath';
import type { TimelineView } from './timelineTypes';

/** A held drag's hold on a time strip (the ruler, the lanes). */
export type EdgePan = Readonly<{
  /** The time (s, ≥ 0) at a client x — clamped into the strip, so a pointer
   *  past an edge reads the time at that edge. */
  timeAt: (clientX: number) => number;
  /** The pointer moved: pans while it is held at or past an edge. */
  update: (clientX: number) => void;
  /** The drag ended. */
  stop: () => void;
}>;

/**
 * Edge auto-pan for a drag over a time strip: while the pointer is held at or
 * past the strip's left / right edge, the view scrolls every frame — faster
 * the further past (edgePanStep), never left of time 0 — and `onPan` runs, so
 * the drag can follow the time that moved under the pointer. Works in the view
 * the drag started in, panned by this; `onViewChange` gets every step.
 */
export function edgePan(
  strip: () => { left: number; right: number },
  start: TimelineView,
  onViewChange: (view: TimelineView) => void,
  onPan: () => void,
): EdgePan {
  let view = start;
  let x = 0;
  let frame = 0;

  const step = (): number => {
    const s = strip();
    return edgePanStep(x, s.left, s.right);
  };

  const tick = () => {
    frame = 0;
    const offset = Math.max(0, view.offset + step() / view.pxPerSec);
    if (offset === view.offset) {
      return;
    }
    view = { ...view, offset };
    onViewChange(view);
    onPan();
    frame = requestAnimationFrame(tick);
  };

  return {
    timeAt: (clientX) => {
      const s = strip();
      return Math.max(0, xToTime(Math.min(s.right, Math.max(s.left, clientX)) - s.left, view));
    },
    update: (clientX) => {
      x = clientX;
      if (frame === 0 && step() !== 0) {
        frame = requestAnimationFrame(tick);
      }
    },
    stop: () => {
      cancelAnimationFrame(frame);
      frame = 0;
    },
  };
}
