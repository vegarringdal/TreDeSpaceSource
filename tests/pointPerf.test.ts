import { beforeEach, describe, expect, it } from 'vitest';
import { type NodeLoadSample, pointPerf } from '../src/state/scans/pointPerf';

const node = (over: Partial<NodeLoadSample> = {}): NodeLoadSample => ({
  readMs: 10,
  decodeMs: 2,
  packMs: 1,
  uploadMs: 0.5,
  isOffThread: false,
  points: 1000,
  bytes: 16000,
  ...over,
});

describe('pointPerf', () => {
  beforeEach(() => {
    pointPerf.reset();
  });

  it('has nothing to show before anything ran', () => {
    expect(pointPerf.snapshot(0)).toEqual({ select: null, burst: null });
  });

  it('sums the selection rounds of a second and keeps the last full one', () => {
    pointPerf.selection(1, 2, 100, 0);
    pointPerf.selection(3, 6, 120, 500);
    // the running second shows until a full one exists
    expect(pointPerf.snapshot(600).select).toEqual({
      rounds: 2,
      walkAvgMs: 2,
      walkMaxMs: 3,
      roundAvgMs: 4,
      roundMaxMs: 6,
      picks: 120,
    });
    pointPerf.selection(10, 10, 5, 1200);
    expect(pointPerf.snapshot(1300).select?.rounds).toBe(2);
    // the camera stopped: the last second it moved in stays
    expect(pointPerf.snapshot(5000).select).toMatchObject({ rounds: 1, walkAvgMs: 10, picks: 5 });
  });

  it('times a burst from the first fetch until a round finds nothing in flight', () => {
    pointPerf.loadStarted(100);
    pointPerf.loadStarted(150);
    pointPerf.nodeLoaded(node());
    pointPerf.nodeLoaded(node({ decodeMs: 6, points: 3000, bytes: 48000 }));
    expect(pointPerf.snapshot(400).burst).toMatchObject({ isRunning: true, nodes: 2, points: 4000, wallMs: 300 });
    pointPerf.frame();
    pointPerf.settled(600);
    expect(pointPerf.snapshot(9000).burst).toMatchObject({
      isRunning: false,
      wallMs: 500,
      bytes: 64000,
      readMs: 20,
      decodeMs: 8,
      packMs: 2,
      uploadMs: 1,
      worstNodeMs: 7.5,
    });
  });

  it('finds the heaviest frame: what landed between two frames counts together', () => {
    pointPerf.loadStarted(0);
    pointPerf.nodeLoaded(node());
    pointPerf.frame();
    pointPerf.nodeLoaded(node());
    pointPerf.nodeLoaded(node({ bytes: 4000 }));
    pointPerf.frame();
    pointPerf.nodeLoaded(node());
    pointPerf.frame();
    expect(pointPerf.snapshot(1).burst).toMatchObject({
      worstFrameMs: 7,
      worstFrameNodes: 2,
      worstFrameBytes: 20000,
    });
  });

  it('charges the main thread only the upload of a node decoded on a worker', () => {
    pointPerf.loadStarted(0);
    pointPerf.nodeLoaded(node({ decodeMs: 9, packMs: 4, isOffThread: true }));
    pointPerf.frame();
    // the worker's time is still reported in the sums
    expect(pointPerf.snapshot(1).burst).toMatchObject({ decodeMs: 9, packMs: 4, worstNodeMs: 0.5, worstFrameMs: 0.5 });
  });

  it('counts the nodes that came too late, and starts over with the next burst', () => {
    pointPerf.loadStarted(0);
    pointPerf.nodeLoaded(node());
    pointPerf.notWanted();
    pointPerf.dropped();
    pointPerf.settled(50);
    expect(pointPerf.snapshot(60).burst).toMatchObject({ notWanted: 1, dropped: 1, nodes: 1 });
    pointPerf.loadStarted(1000);
    expect(pointPerf.snapshot(1010).burst).toMatchObject({ isRunning: true, nodes: 0, notWanted: 0, wallMs: 10 });
  });
});
