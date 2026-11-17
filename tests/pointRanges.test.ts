// Ranges of a streamed scan node (lib/tdpp/pointRanges.ts): the grouping of
// its clusters, the range-ordered GPU packing (pointPack.ts) and the per-view
// cull — on a hand-built node: a 4 × 4 × 1 grid of clusters, 100 points each.
import { describe, expect, it } from 'vitest';
import { POINT_HEADER_WORDS as H, POINT_WORDS as W } from '../src/lib/render/shaders/points';
import { frustumPlanes } from '../src/lib/tdpp/pointLod';
import { packNodePoints, packNodeRanged, unpackPoint } from '../src/lib/tdpp/pointPack';
import {
  boxInView,
  layoutRanges,
  needsMore,
  type PointRanges,
  type RangeView,
  visibleRuns,
} from '../src/lib/tdpp/pointRanges';
import type { DecodedNode } from '../src/lib/tdpp/tdppFormat';

const GRID = 4;
const PER_CLUSTER = 100;
const CUBE = { cubeMin: [0, 0, 0] as const, cubeSize: 4, spacing: 0.1 };
const HEADER = { hasColor: true, hasIntensity: true };
const NO_PLANES = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);

/** Planes that keep only x >= `x` (the other four pass everything). */
function keepRightOf(x: number): Float32Array {
  const p = NO_PLANES.slice();
  p.set([1, 0, 0, -x], 0);
  return p;
}

const view = (over: Partial<RangeView> = {}): RangeView => ({
  planes: NO_PLANES,
  eye: [0, 0, 0],
  far: Number.POSITIVE_INFINITY,
  ...over,
});

/**
 * Cluster (cx, cy) fills the unit cell at (cx, cy, 0); its points carry the
 * cluster's number as red and the setup `cx % 2`. The clusters are stored in
 * a scrambled order, as a real file's are not sorted by position.
 */
function gridNode(): DecodedNode {
  const cells = [5, 0, 15, 2, 9, 12, 7, 1, 14, 3, 8, 11, 6, 13, 4, 10];
  const count = cells.length * PER_CLUSTER;
  const positions = new Float32Array(count * 3);
  const rgbs = new Uint8Array(count * 4);
  const clusterBounds = new Float32Array(cells.length * 6);
  cells.forEach((cell, c) => {
    const cx = cell % GRID;
    const cy = Math.floor(cell / GRID);
    clusterBounds.set([cx + 0.1, cy + 0.1, 0.1, cx + 0.9, cy + 0.9, 0.9], c * 6);
    for (let k = 0; k < PER_CLUSTER; k++) {
      const i = c * PER_CLUSTER + k;
      const t = k / (PER_CLUSTER - 1);
      positions.set([cx + 0.1 + 0.8 * t, cy + 0.1 + 0.8 * (1 - t), 0.1 + 0.8 * t], i * 3);
      rgbs.set([cell, 0, 0, cx % 2], i * 4);
    }
  });
  return {
    count,
    positions,
    intensity: new Uint16Array(count),
    rgbs,
    normals: null,
    clusterFirst: Uint32Array.from(cells, (_, c) => c * PER_CLUSTER),
    clusterCount: new Uint32Array(cells.length).fill(PER_CLUSTER),
    clusterBounds,
  };
}

/** The packed points as "x,y,z,rgba" strings, for comparing sets. */
function pointKeys(words: Uint32Array): string[] {
  const out: string[] = [];
  for (let i = 0; i < (words.length - H) / W; i++) {
    const p = unpackPoint(words, i);
    out.push(`${p.position.join(',')},${p.rgb.join(',')},${p.setup}`);
  }
  return out;
}

function rangesOf(packed: { ranges: PointRanges | null }): PointRanges {
  if (!packed.ranges) {
    throw new Error('expected a node with ranges');
  }

  return packed.ranges;
}

describe('layoutRanges', () => {
  it('leaves a small node alone', () => {
    expect(layoutRanges(gridNode(), CUBE.cubeMin, CUBE.cubeSize, 5000)).toBeNull();
  });

  it('groups every cluster once, by position, within the limit', () => {
    const d = gridNode();
    const layout = layoutRanges(d, CUBE.cubeMin, CUBE.cubeSize, 400);
    expect(layout).not.toBeNull();
    expect([...(layout?.order ?? [])].sort((a, b) => a - b)).toEqual([...Array(16).keys()]);
    // 16 clusters of 100 in a 4 x 4 grid: the four quadrants, 4 clusters each
    expect([...(layout?.ends ?? [])]).toEqual([4, 8, 12, 16]);
    const boxes = layout?.boxes ?? new Float32Array(0);
    expect([...boxes.subarray(0, 6)].map((v) => Math.round(v * 10) / 10)).toEqual([0.1, 0.1, 0.1, 1.9, 1.9, 0.9]);
  });

  it('keeps splitting a group that is still too large', () => {
    const layout = layoutRanges(gridNode(), CUBE.cubeMin, CUBE.cubeSize, 100);
    expect(layout?.ends.length).toBe(16);
  });
});

describe('packNodeRanged', () => {
  /** Every point of every span lies in that range's box. */
  function expectPointsInBoxes(words: Uint32Array, ranges: PointRanges) {
    // the test grid is not on the 1 mm grid: a point may sit half a unit off
    const slack = 1e-3;
    for (let r = 0; r < ranges.spans.length / 2; r++) {
      const box = ranges.boxes.subarray(r * 6, r * 6 + 6);
      for (let i = ranges.spans[2 * r]; i < ranges.spans[2 * r] + ranges.spans[2 * r + 1]; i++) {
        const { position } = unpackPoint(words, i);
        for (let k = 0; k < 3; k++) {
          expect(position[k] >= box[k] - slack && position[k] <= box[k + 3] + slack).toBe(true);
        }
      }
    }
  }

  it('leaves a node at or under the limit in file order, without ranges', () => {
    const d = gridNode();
    const packed = packNodeRanged(d, CUBE, HEADER);
    expect(packed.ranges).toBeNull();
    // all but the cube centre in the header, which the plain pack leaves at the origin
    expect([...packed.words.subarray(3)]).toEqual([...packNodePoints(d, CUBE.spacing, HEADER).subarray(3)]);
  });

  it('writes the same points as the plain pack, range by range', () => {
    const d = gridNode();
    const plain = packNodePoints(d, CUBE.spacing, HEADER);
    const packed = packNodeRanged(d, CUBE, HEADER, null, 400);
    expect(packed.words.length).toBe(plain.length);
    // the header: the cube's centre, the spacing, and the spacing per octant
    const head = new Float32Array(packed.words.buffer, 0, H);
    expect([...head.subarray(0, 3)]).toEqual([2, 2, 2]);
    expect([...head.subarray(3, 12)].every((v) => Math.abs(v - CUBE.spacing) < 1e-6)).toBe(true);
    // …then the quantization base (the points' minimum) and unit (the 1 mm grid)
    expect([...head.subarray(12, 15)].map((v) => Math.round(v * 10) / 10)).toEqual([0.1, 0.1, 0.1]);
    expect(head[15]).toBeCloseTo(0.001, 6);
    expect(pointKeys(packed.words).sort()).toEqual(pointKeys(plain).sort());
    const ranges = rangesOf(packed);
    // four quadrants, one after the other in the buffer
    expect([...ranges.spans]).toEqual([0, 400, 400, 400, 800, 400, 1200, 400]);
    expectPointsInBoxes(packed.words, ranges);
  });

  it('counts the spans in kept points under a setup filter', () => {
    const d = gridNode();
    // setup 0 = the even columns: half of every quadrant
    const packed = packNodeRanged(d, CUBE, HEADER, 0, 400);
    expect(packed.words.length).toBe(H + 800 * W);
    const ranges = rangesOf(packed);
    expect([...ranges.spans]).toEqual([0, 200, 200, 200, 400, 200, 600, 200]);
    expectPointsInBoxes(packed.words, ranges);
    // a setup no point has: nothing left, nothing to cut
    const none = packNodeRanged(d, CUBE, HEADER, 9, 400);
    expect(none.words.length).toBe(H);
    expect(none.ranges).toBeNull();
  });
});

describe('load only what is in view', () => {
  const d = gridNode();
  const inView = (v: RangeView) => (boxes: Float32Array, o: number) => boxInView(boxes, o, v);

  it('uploads only the ranges the load view keeps, and remembers the rest', () => {
    // x >= 2: the right-hand quadrants (ranges 1 and 3)
    const packed = packNodeRanged(d, CUBE, HEADER, null, 400, inView(view({ planes: keepRightOf(2) })));
    expect(packed.words.length).toBe(H + 800 * W);
    expect([...rangesOf(packed).spans]).toEqual([0, 400, 400, 400]);
    expect([...(packed.partial?.kept ?? [])]).toEqual([0, 1, 0, 1]);
    expect(packed.partial?.boxes.length).toBe(4 * 6);
    // every uploaded point is on the right
    for (let i = 0; i < 800; i++) {
      expect(unpackPoint(packed.words, i).position[0]).toBeGreaterThanOrEqual(2);
    }
  });

  it('is whole when the load view keeps everything', () => {
    const packed = packNodeRanged(d, CUBE, HEADER, null, 400, inView(view()));
    expect(packed.partial).toBeNull();
    expect(packed.words.length).toBe(H + 1600 * W);
  });

  it('can end up with nothing uploaded, still knowing what it lacks', () => {
    const packed = packNodeRanged(d, CUBE, HEADER, null, 400, () => false);
    expect(packed.words.length).toBe(H);
    expect(packed.ranges).toBeNull();
    expect([...(packed.partial?.kept ?? [])]).toEqual([0, 0, 0, 0]);
  });

  it('asks for a reload only when the view needs a range that was left out', () => {
    const packed = packNodeRanged(d, CUBE, HEADER, null, 400, inView(view({ planes: keepRightOf(2) })));
    const partial = packed.partial;
    if (!partial) {
      throw new Error('expected a partial node');
    }
    const all = view();
    // still looking right of x = 2: nothing missing
    expect(needsMore(partial, view({ planes: keepRightOf(2) }), all)).toBe(false);
    // turned left: the left quadrants (boxes up to x = 1.9) come into view
    expect(needsMore(partial, view({ planes: keepRightOf(1.5) }), all)).toBe(true);
    // …unless they are beyond the max distance from an eye on the far right
    expect(needsMore(partial, view({ planes: keepRightOf(1.5), eye: [9, 0, 0], far: 5 }), all)).toBe(false);
  });

  it('does not ask for a reload that would bring back the same ranges', () => {
    const packed = packNodeRanged(d, CUBE, HEADER, null, 400, inView(view({ planes: keepRightOf(2) })));
    const partial = packed.partial;
    if (!partial) {
      throw new Error('expected a partial node');
    }
    // the need test lets the left quadrants through, but a load now (still
    // packing for x >= 2) would leave them out again: reloading is pointless
    const need = view({ planes: keepRightOf(1.5) });
    const load = view({ planes: keepRightOf(2) });
    expect(needsMore(partial, need, load)).toBe(false);
  });
});

describe('ranges of a node cut into quadrants', () => {
  // the streamer's limit is a constant; build the ranges at a test limit instead
  const d = gridNode();
  const layout = layoutRanges(d, CUBE.cubeMin, CUBE.cubeSize, 400);
  if (!layout) {
    throw new Error('layout expected');
  }
  const spans = new Uint32Array(layout.ends.length * 2);
  let first = 0;
  layout.ends.forEach((end, r) => {
    const from = r === 0 ? 0 : layout.ends[r - 1];
    let points = 0;
    for (let i = from; i < end; i++) {
      points += d.clusterCount[layout.order[i]];
    }
    spans.set([first, points], r * 2);
    first += points;
  });
  const ranges: PointRanges = { spans, boxes: layout.boxes };

  it('draws the node whole when every range is in view', () => {
    expect(visibleRuns(ranges, d.count, view())).toEqual({ runs: null, points: 1600 });
  });

  it('draws only the ranges that touch the view, neighbours joined', () => {
    // x >= 2: the two right-hand quadrants (ranges 1 and 3 in octant order)
    const right = visibleRuns(ranges, d.count, view({ planes: keepRightOf(2) }));
    expect(right.points).toBe(800);
    expect([...(right.runs ?? [])]).toEqual([400, 400, 1200, 400]);
    // x >= 1.95 does not reach the left quadrants' boxes (they end at 1.9)
    expect(visibleRuns(ranges, d.count, view({ planes: keepRightOf(1.95) })).points).toBe(800);
    // x >= 1.5 reaches all four
    expect(visibleRuns(ranges, d.count, view({ planes: keepRightOf(1.5) })).runs).toBeNull();
  });

  it('joins adjacent visible ranges into one run', () => {
    // y >= 2: the two upper quadrants are ranges 2 and 3 — one run
    const p = NO_PLANES.slice();
    p.set([0, 1, 0, -2], 0);
    const upper = visibleRuns(ranges, d.count, view({ planes: p }));
    expect([...(upper.runs ?? [])]).toEqual([800, 800]);
  });

  it('honours the max distance and the clip test', () => {
    // from the corner, 1.5 m reaches only the first quadrant's box
    const near = visibleRuns(ranges, d.count, view({ far: 1.5 }));
    expect([...(near.runs ?? [])]).toEqual([0, 400]);
    const clipped = visibleRuns(ranges, d.count, view({ clipped: (c) => c[0] < 2 }));
    expect([...(clipped.runs ?? [])]).toEqual([400, 400, 1200, 400]);
    expect(visibleRuns(ranges, d.count, view({ clipped: () => true }))).toEqual({
      runs: new Uint32Array(0),
      points: 0,
    });
  });
});

describe('frustumPlanes guard', () => {
  const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const inside = (planes: Float32Array, p: readonly number[]) => {
    for (let i = 0; i < 5; i++) {
      if (planes[i * 4] * p[0] + planes[i * 4 + 1] * p[1] + planes[i * 4 + 2] * p[2] + planes[i * 4 + 3] < 0) {
        return false;
      }
    }
    return true;
  };

  it('widens the sides by the given share of the half view', () => {
    // identity: the view is the clip cube, x and y in -1..1
    expect(inside(frustumPlanes(IDENTITY), [1.05, 0, 0.5])).toBe(false);
    expect(inside(frustumPlanes(IDENTITY, 0.1, 0), [1.05, 0, 0.5])).toBe(true);
    expect(inside(frustumPlanes(IDENTITY, 0.1, 0), [0, 1.05, 0.5])).toBe(false);
    expect(inside(frustumPlanes(IDENTITY, 0, 0.1), [0, -1.05, 0.5])).toBe(true);
    expect(inside(frustumPlanes(IDENTITY, 0.1, 0.1), [1.2, 0, 0.5])).toBe(false);
  });
});

describe('the 12-byte point record', () => {
  const one = (positions: number[], setups: number[]): DecodedNode => {
    const count = setups.length;
    return {
      count,
      positions: new Float32Array(positions),
      intensity: new Uint16Array(count).fill(0x4000),
      rgbs: Uint8Array.from(setups.flatMap((s, i) => [i + 1, 2, 3, s])),
      normals: null,
      clusterFirst: new Uint32Array([0]),
      clusterCount: new Uint32Array([count]),
      clusterBounds: new Float32Array(6),
    };
  };

  it('keeps points on the 1 mm grid exactly, with the setup that measured them', () => {
    // millimetre positions far from the origin, as a real scan has them
    const d = one([512.001, -37.25, 4.999, 512.3, -37.249, 5.0, 600.123, 1.5, 9.876], [0, 7, 255]);
    const words = packNodePoints(d, 0.01, HEADER);
    for (let i = 0; i < 3; i++) {
      const p = unpackPoint(words, i);
      for (let k = 0; k < 3; k++) {
        // within a float's own resolution at this distance from the origin
        expect(Math.abs(p.position[k] - d.positions[3 * i + k])).toBeLessThan(1e-4);
      }
      expect(p.rgb).toEqual([i + 1, 2, 3]);
      expect(p.grey).toBe(0x40);
    }
    expect([0, 1, 2].map((i) => unpackPoint(words, i).setup)).toEqual([0, 7, 255]);
  });

  it('falls back to a coarser unit for a node wider than 18 bits of the grid', () => {
    // 600 m across: the unit becomes 600 / 262143 = 2.3 mm
    const d = one([0, 0, 0, 600, 300, 10, 123.4567, 250.5, 3.25], [0, 0, 0]);
    const words = packNodePoints(d, 1, HEADER);
    const unit = new Float32Array(words.buffer)[15];
    expect(unit).toBeCloseTo(600 / 262143, 7);
    for (let i = 0; i < 3; i++) {
      const p = unpackPoint(words, i);
      for (let k = 0; k < 3; k++) {
        expect(Math.abs(p.position[k] - d.positions[3 * i + k])).toBeLessThanOrEqual(unit / 2 + 1e-4);
      }
    }
  });
});
