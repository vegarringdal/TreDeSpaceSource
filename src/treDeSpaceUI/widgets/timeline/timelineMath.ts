// Pure timeline geometry: time ↔ px, ruler ticks, snapping and the
// magnetic-link hint (drop near an end → after, near a start → with, end on
// end → ends with). No DOM, so it unit-tests directly.

import type { DropHint, TimelineItem, TimelineSnap, TimelineView } from './timelineTypes';

/** Zoom limits (px per second). */
export const MIN_PX_PER_SEC = 4;
export const MAX_PX_PER_SEC = 2000;
/** How close (px) an edge must come to snap or to propose a link. */
export const SNAP_PX = 8;
/** px inside a strip's edge where a held drag starts panning the view. */
export const EDGE_PAN_ZONE_PX = 8;
/** The fastest edge pan, px per frame. */
export const EDGE_PAN_MAX_PX = 30;

export function timeToX(t: number, view: TimelineView): number {
  return (t - view.offset) * view.pxPerSec;
}

export function xToTime(x: number, view: TimelineView): number {
  return view.offset + x / view.pxPerSec;
}

/** Major tick step (s) so labels sit ~80 px apart: 1-2-5 progression. */
export function tickStep(pxPerSec: number, targetPx = 80): number {
  const raw = targetPx / Math.max(1e-6, pxPerSec);
  const pow = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) {
    if (m * pow >= raw) {
      return m * pow;
    }
  }
  return 10 * pow;
}

/** Ticks inside [from, to]: { t, major } with 5 minors per major. */
export function ticks(from: number, to: number, pxPerSec: number): { t: number; major: boolean }[] {
  const major = tickStep(pxPerSec);
  const minor = major / 5;
  const out: { t: number; major: boolean }[] = [];
  const first = Math.floor(from / minor) * minor;
  for (let i = 0, t = first; t <= to + 1e-9 && i < 2000; i++, t = first + i * minor) {
    out.push({ t: Math.round(t * 1e6) / 1e6, major: Math.abs(t / major - Math.round(t / major)) < 1e-6 });
  }
  return out;
}

/** Zoom by `factor`, keeping the time at `anchorX` (px from the lanes' left
 *  edge; 0 = the left edge) in place; pxPerSec is clamped to 4–2000 and the
 *  offset to ≥ 0. Exported as `zoomTimelineView`. */
export function zoomAt(view: TimelineView, factor: number, anchorX: number): TimelineView {
  const t = xToTime(anchorX, view);
  const pxPerSec = Math.min(MAX_PX_PER_SEC, Math.max(MIN_PX_PER_SEC, view.pxPerSec * factor));
  return { pxPerSec, offset: Math.max(0, t - anchorX / pxPerSec) };
}

/** How far (px, this frame) a drag held at client x pans a strip spanning
 *  [left, right]: 0 inside, then more the further it is into the edge zone
 *  or past the edge (up to EDGE_PAN_MAX_PX); negative on the left. */
export function edgePanStep(x: number, left: number, right: number): number {
  let over = 0;
  if (x > right - EDGE_PAN_ZONE_PX) {
    over = x - (right - EDGE_PAN_ZONE_PX);
  } else if (x < left + EDGE_PAN_ZONE_PX) {
    over = x - (left + EDGE_PAN_ZONE_PX);
  }
  return Math.sign(over) * Math.min(EDGE_PAN_MAX_PX, Math.ceil(Math.abs(over) / 2));
}

/** The view panned the least so `t` sits inside a strip `width` px wide, at
 *  least `margin` px from either edge — the same object when it already does
 *  (or cannot move: the offset stays ≥ 0). */
export function keepInView(view: TimelineView, t: number, width: number, margin: number): TimelineView {
  const x = timeToX(t, view);
  let offset = view.offset;
  if (x < margin) {
    offset = Math.max(0, t - margin / view.pxPerSec);
  } else if (x > width - margin) {
    offset = Math.max(0, t - (width - margin) / view.pxPerSec);
  }
  return offset === view.offset ? view : { ...view, offset };
}

/** Snap a time to the nearest grid step or target within SNAP_PX. */
export function snapTime(t: number, snap: TimelineSnap | undefined, view: TimelineView): number {
  if (!snap?.enabled) {
    return t;
  }
  const tol = SNAP_PX / view.pxPerSec;
  let best = t;
  let bestD = tol;
  for (const s of snap.targets) {
    const d = Math.abs(s - t);
    if (d < bestD) {
      best = s;
      bestD = d;
    }
  }
  if (bestD < tol) {
    return best;
  }
  if (snap.step > 0) {
    const g = Math.round(t / snap.step) * snap.step;
    if (Math.abs(g - t) < tol) {
      return g;
    }
  }
  return t;
}

/** Shift dt so the dragged span [s, e] snaps by its start or end. */
export function snapSpanDelta(
  s: number,
  e: number,
  dt: number,
  snap: TimelineSnap | undefined,
  view: TimelineView,
): number {
  if (!snap?.enabled) {
    return dt;
  }
  const s1 = snapTime(s + dt, snap, view);
  if (s1 !== s + dt) {
    return s1 - s;
  }
  const e1 = snapTime(e + dt, snap, view);
  return e1 !== e + dt ? e1 - e : dt;
}

/** The link a dropped span would make with any other item (any row; never a
 *  locked or fixed one): its start near another's end → after; starts
 *  together → with; ends together → endsWith. The nearest within SNAP_PX wins. */
export function dropHintFor(
  moved: { id: string; start: number; end: number },
  others: readonly TimelineItem[],
  view: TimelineView,
): DropHint | null {
  const tol = SNAP_PX / view.pxPerSec;
  const candidates: { hint: DropHint; d: number }[] = [];
  for (const o of others) {
    if (o.id === moved.id || o.locked || o.fixed) {
      continue;
    }
    candidates.push(
      { hint: { kind: 'after', target: o.id }, d: Math.abs(moved.start - o.end) },
      { hint: { kind: 'with', target: o.id }, d: Math.abs(moved.start - o.start) },
      { hint: { kind: 'endsWith', target: o.id }, d: Math.abs(moved.end - o.end) },
    );
  }
  const near = candidates.filter((c) => c.d < tol).sort((a, b) => a.d - b.d);
  return near[0]?.hint ?? null;
}

/** Bucket entries by their row id, so each lane gets its own list without
 *  filtering the whole array once per row. */
export function groupByRow<T extends { row: string }>(list: readonly T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const e of list) {
    const bucket = out.get(e.row);
    if (bucket) {
      bucket.push(e);
    } else {
      out.set(e.row, [e]);
    }
  }
  return out;
}
