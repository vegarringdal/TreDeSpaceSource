// Measurements of the scan point streamer (state/scans/scanPoints.ts): what a
// selection round costs and what streaming nodes costs the main thread. Plain
// counters, read by the Statistics rows — not a store, nothing here re-renders.
// Pure (no imports) so it is unit-tested as it is.

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** One node that reached the GPU. */
export interface NodeLoadSample {
  /** Waiting for the file read (wall time; overlapping reads each count theirs). */
  readonly readMs: number;
  /** Time of the stream decode and the pack — on a decode worker when
   *  `isOffThread`, else on the main thread — and of the buffer upload call
   *  (always main thread). */
  readonly decodeMs: number;
  readonly packMs: number;
  readonly uploadMs: number;
  /** Decode and pack ran on a worker: they cost the main thread nothing. */
  readonly isOffThread: boolean;
  readonly points: number;
  /** Bytes uploaded. */
  readonly bytes: number;
}

/** The selection rounds of one second (the last one that had any). */
export interface SelectStats {
  readonly rounds: number;
  /** The LOD walk alone (`selectNodes`). */
  readonly walkAvgMs: number;
  readonly walkMaxMs: number;
  /** The whole round: walk, draw set, eviction, readout. */
  readonly roundAvgMs: number;
  readonly roundMaxMs: number;
  /** Nodes the last round picked. */
  readonly picks: number;
}

/** One streaming burst: from the first fetch until nothing is wanted any more. */
export interface BurstStats {
  readonly isRunning: boolean;
  readonly nodes: number;
  readonly points: number;
  readonly bytes: number;
  readonly wallMs: number;
  readonly readMs: number;
  readonly decodeMs: number;
  readonly packMs: number;
  readonly uploadMs: number;
  /** Most main-thread time one node took (the upload call, plus decode and
   *  pack when they could not run on a worker). */
  readonly worstNodeMs: number;
  /** The frame that took most: its main-thread time, bytes and nodes. */
  readonly worstFrameMs: number;
  readonly worstFrameBytes: number;
  readonly worstFrameNodes: number;
  /** Loaded, then not picked by the next round (the view had moved on). */
  readonly notWanted: number;
  /** Finished after its scan was closed or the filter changed: never uploaded. */
  readonly dropped: number;
}

export interface PointPerfSnapshot {
  readonly select: SelectStats | null;
  readonly burst: BurstStats | null;
}

interface SelectBucket {
  start: number;
  rounds: number;
  walkSum: number;
  walkMax: number;
  roundSum: number;
  roundMax: number;
  picks: number;
}

interface Burst {
  start: number;
  /** Set when the burst ended. */
  end: number | null;
  nodes: number;
  points: number;
  bytes: number;
  readMs: number;
  decodeMs: number;
  packMs: number;
  uploadMs: number;
  worstNodeMs: number;
  worstFrameMs: number;
  worstFrameBytes: number;
  worstFrameNodes: number;
  notWanted: number;
  dropped: number;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** Selection rounds are summed up per this long. */
const SELECT_WINDOW_MS = 1000;

// -----------------------------------------------------------------------------
// State
// -----------------------------------------------------------------------------

let bucket: SelectBucket | null = null;
let lastSelect: SelectStats | null = null;
let burst: Burst | null = null;
/** What landed since the last frame. */
let frameMs = 0;
let frameBytes = 0;
let frameNodes = 0;

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

function closeBucket(b: SelectBucket): SelectStats {
  return {
    rounds: b.rounds,
    walkAvgMs: b.walkSum / b.rounds,
    walkMaxMs: b.walkMax,
    roundAvgMs: b.roundSum / b.rounds,
    roundMaxMs: b.roundMax,
    picks: b.picks,
  };
}

function newBurst(now: number): Burst {
  return {
    start: now,
    end: null,
    nodes: 0,
    points: 0,
    bytes: 0,
    readMs: 0,
    decodeMs: 0,
    packMs: 0,
    uploadMs: 0,
    worstNodeMs: 0,
    worstFrameMs: 0,
    worstFrameBytes: 0,
    worstFrameNodes: 0,
    notWanted: 0,
    dropped: 0,
  };
}

// -----------------------------------------------------------------------------
// Actions
// -----------------------------------------------------------------------------

export const pointPerf = {
  /** One selection round ran: the walk's and the whole round's time. */
  selection(walkMs: number, roundMs: number, picks: number, now: number) {
    if (bucket && now - bucket.start >= SELECT_WINDOW_MS) {
      lastSelect = closeBucket(bucket);
      bucket = null;
    }
    bucket ??= { start: now, rounds: 0, walkSum: 0, walkMax: 0, roundSum: 0, roundMax: 0, picks: 0 };
    bucket.rounds++;
    bucket.walkSum += walkMs;
    bucket.walkMax = Math.max(bucket.walkMax, walkMs);
    bucket.roundSum += roundMs;
    bucket.roundMax = Math.max(bucket.roundMax, roundMs);
    bucket.picks = picks;
  },

  /** A node fetch started: opens a burst unless one is running. */
  loadStarted(now: number) {
    if (!burst || burst.end !== null) {
      burst = newBurst(now);
    }
  },

  /** A node reached the GPU. */
  nodeLoaded(s: NodeLoadSample) {
    if (!burst) {
      return;
    }

    const mainMs = (s.isOffThread ? 0 : s.decodeMs + s.packMs) + s.uploadMs;
    burst.nodes++;
    burst.points += s.points;
    burst.bytes += s.bytes;
    burst.readMs += s.readMs;
    burst.decodeMs += s.decodeMs;
    burst.packMs += s.packMs;
    burst.uploadMs += s.uploadMs;
    burst.worstNodeMs = Math.max(burst.worstNodeMs, mainMs);
    frameMs += mainMs;
    frameBytes += s.bytes;
    frameNodes++;
  },

  /** A finished node was thrown away (scan closed, filter changed). */
  dropped() {
    if (burst) {
      burst.dropped++;
    }
  },

  /** A loaded node was not picked by the round after its load. */
  notWanted() {
    if (burst) {
      burst.notWanted++;
    }
  },

  /** A viewport frame begins: what landed since the last one is one frame's load. */
  frame() {
    if (burst && frameMs > burst.worstFrameMs) {
      burst.worstFrameMs = frameMs;
      burst.worstFrameBytes = frameBytes;
      burst.worstFrameNodes = frameNodes;
    }
    frameMs = 0;
    frameBytes = 0;
    frameNodes = 0;
  },

  /** A round ran with nothing in flight: the running burst is over. */
  settled(now: number) {
    if (burst && burst.end === null) {
      burst.end = now;
    }
  },

  snapshot(now: number): PointPerfSnapshot {
    if (bucket && now - bucket.start >= SELECT_WINDOW_MS) {
      lastSelect = closeBucket(bucket);
      bucket = null;
    }
    // the last full second; the running one until there is a full one
    const select = lastSelect ?? (bucket ? closeBucket(bucket) : null);
    if (!burst) {
      return { select, burst: null };
    }

    const { start, end, ...totals } = burst;
    return { select, burst: { ...totals, isRunning: end === null, wallMs: (end ?? now) - start } };
  },

  reset() {
    bucket = null;
    lastSelect = null;
    burst = null;
    frameMs = 0;
    frameBytes = 0;
    frameNodes = 0;
  },
};
