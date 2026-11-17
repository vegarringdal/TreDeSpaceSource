import { describe, expect, it } from 'vitest';
import {
  dropHintFor,
  EDGE_PAN_MAX_PX,
  edgePanStep,
  keepInView,
  snapSpanDelta,
  snapTime,
  tickStep,
  ticks,
  timeToX,
  xToTime,
  zoomAt,
} from '../src/treDeSpaceUI/widgets/timeline/timelineMath';

const view = { pxPerSec: 100, offset: 2 };

describe('timeline math', () => {
  it('maps time and px both ways', () => {
    expect(timeToX(3, view)).toBe(100);
    expect(xToTime(250, view)).toBe(4.5);
  });

  it('picks 1-2-5 tick steps about 80 px apart', () => {
    expect(tickStep(100)).toBe(1);
    expect(tickStep(30)).toBe(5);
    expect(tickStep(1000)).toBe(0.1);
    const t = ticks(0, 2, 100);
    expect(t.filter((x) => x.major).map((x) => x.t)).toEqual([0, 1, 2]);
    expect(t.length).toBe(11);
  });

  it('zooms about the anchor', () => {
    const z = zoomAt(view, 2, 100);
    expect(xToTime(100, z)).toBeCloseTo(xToTime(100, view));
    expect(z.pxPerSec).toBe(200);
  });

  it('snaps to targets before the grid, within 8 px', () => {
    const snap = { enabled: true, step: 1, targets: [3.04] };
    expect(snapTime(3.07, snap, view)).toBe(3.04);
    expect(snapTime(4.05, snap, view)).toBe(4);
    expect(snapTime(4.3, snap, view)).toBe(4.3);
    expect(snapTime(4.05, { ...snap, enabled: false }, view)).toBe(4.05);
    expect(snapSpanDelta(1, 2, 1.96, snap, view)).toBeCloseTo(2); // end snaps to 4
  });

  it('proposes after / with / ends-with links near an edge', () => {
    const others = [{ id: 'a', row: 'r', start: 0, end: 2, label: 'a' }];
    expect(dropHintFor({ id: 'b', start: 2.03, end: 3 }, others, view)).toEqual({ kind: 'after', target: 'a' });
    expect(dropHintFor({ id: 'b', start: 0.02, end: 1 }, others, view)).toEqual({ kind: 'with', target: 'a' });
    expect(dropHintFor({ id: 'b', start: 1, end: 2.01 }, others, view)).toEqual({ kind: 'endsWith', target: 'a' });
    expect(dropHintFor({ id: 'b', start: 5, end: 6 }, others, view)).toBeNull();
  });

  it('pans a held drag only at or past an edge, faster further out, capped', () => {
    // a strip from x 100 to 500; the zone starts 8 px inside each edge
    expect(edgePanStep(300, 100, 500)).toBe(0);
    expect(edgePanStep(492, 100, 500)).toBe(0);
    expect(edgePanStep(500, 100, 500)).toBe(4);
    expect(edgePanStep(540, 100, 500)).toBe(24);
    expect(edgePanStep(5000, 100, 500)).toBe(EDGE_PAN_MAX_PX);
    expect(edgePanStep(100, 100, 500)).toBe(-4);
    expect(edgePanStep(-5000, 100, 500)).toBe(-EDGE_PAN_MAX_PX);
  });

  it('keeps a time in view with a margin, panning the least, never left of 0', () => {
    // view: 100 px/s from 2 s, a 400 px strip (2 s … 6 s), margin 20 px (0.2 s)
    expect(keepInView(view, 4, 400, 20)).toBe(view);
    expect(keepInView(view, 6.1, 400, 20).offset).toBeCloseTo(2.3);
    expect(keepInView(view, 1, 400, 20).offset).toBeCloseTo(0.8);
    expect(keepInView({ ...view, offset: 0 }, 0.1, 400, 20).offset).toBe(0);
  });
});
