import { timeToX } from './timelineMath';
import type { TimelineView } from './timelineTypes';
import type { SelectBox } from './useTimelineBoxSelect';

type Props = Readonly<{
  view: TimelineView;
  labelWidth: number;
  playhead: number;
  minHeight: number;
  dimOutside?: { from: number; to: number } | null;
  endMark?: number | null;
  box: SelectBox | null;
}>;

/** Over the lanes: the dimmed outside of a focus window, the end mark, the
 *  playhead line and the rubber-band box. */
export function TimelineOverlays({ view, labelWidth, playhead, minHeight, dimOutside, endMark, box }: Props) {
  return (
    <>
      {dimOutside && (
        <>
          <div
            className="pointer-events-none absolute top-0 bottom-0 bg-slate-950/60"
            style={{ left: labelWidth, width: Math.max(0, timeToX(dimOutside.from, view)) }}
          />
          <div
            className="pointer-events-none absolute top-0 right-0 bottom-0 bg-slate-950/60"
            style={{ left: labelWidth + Math.max(0, timeToX(dimOutside.to, view)) }}
          />
        </>
      )}
      {endMark !== undefined && endMark !== null && (
        <div
          className="pointer-events-none absolute top-0 bottom-0 border-rose-500/70 border-l-2 border-dashed"
          style={{ left: labelWidth + timeToX(endMark, view), minHeight }}
        />
      )}
      <div
        className="pointer-events-none absolute top-0 bottom-0 w-px bg-red-400/80"
        style={{ left: labelWidth + timeToX(playhead, view), minHeight }}
      />
      {box && (
        <div
          className="pointer-events-none absolute border border-sky-300 bg-sky-400/10"
          style={{
            left: Math.min(box.x0, box.x1),
            top: Math.min(box.y0, box.y1),
            width: Math.abs(box.x1 - box.x0),
            height: Math.abs(box.y1 - box.y0),
          }}
        />
      )}
    </>
  );
}
