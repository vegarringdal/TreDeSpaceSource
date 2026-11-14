// Scan point streaming, the pure parts: frustum planes + cube culling, the
// projected-spacing priority, best-first selection under a budget
// (lib/tdpp/pointLod.ts), and the GPU packing of a decoded node
// (lib/tdpp/pointPack.ts) — on hand-built trees and on the synthetic .tdpp
// fixture (origin 500 000 / 6 600 000: the per-cloud frame keeps it exact).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CameraController } from '../src/lib/render/camera';
import {
  cubeVisible,
  frustumPlanes,
  type LodCloud,
  nodePriority,
  rangeShare,
  selectNodes,
} from '../src/lib/tdpp/pointLod';
import { packNodePoints } from '../src/lib/tdpp/pointPack';
import { boxContains, nearestToRay } from '../src/lib/tdpp/pointSnap';
import { type DecodedNode, decodeNode, openTdpp, type TdppNode, type TdppSource } from '../src/lib/tdpp/tdppFormat';

const root = fileURLToPath(new URL('..', import.meta.url));
const bytes = new Uint8Array(readFileSync(resolve(root, 'tests/fixtures/synthetic.tdpp')));
const src: TdppSource = {
  size: bytes.byteLength,
  read: async (offset, length) => bytes.slice(offset, offset + length),
};

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const VIEW = { ortho: false, pxScale: 500 };

function node(over: Partial<TdppNode> & Pick<TdppNode, 'index'>): TdppNode {
  return {
    cubeMin: [0, 0, 0],
    cubeSize: 1,
    boundsMin: [0, 0, 0],
    boundsMax: [1, 1, 1],
    spacing: 0.1,
    pointCount: 100,
    parent: -1,
    firstChild: 0,
    childCount: 0,
    depth: 0,
    octant: 0,
    clusterCount: 1,
    payloadSize: 0,
    payloadOffset: 0,
    setupMask: 0n,
    ...over,
  };
}

/** Root cube [0,8)³ with two children: the near one at x [0,4), the far one at x [4,8). */
function tree(): TdppNode[] {
  return [
    node({ index: 0, cubeSize: 8, spacing: 1, firstChild: 1, childCount: 2 }),
    node({ index: 1, cubeSize: 4, spacing: 0.5, parent: 0, depth: 1, firstChild: 3, childCount: 1 }),
    node({ index: 2, cubeMin: [4, 0, 0], cubeSize: 4, spacing: 0.5, parent: 0, depth: 1 }),
    node({ index: 3, cubeSize: 2, spacing: 0.25, parent: 1, depth: 2 }),
  ];
}

/** Planes that accept everything (a huge box). */
const ALL = new Float32Array([1, 0, 0, 1e9, -1, 0, 0, 1e9, 0, 1, 0, 1e9, 0, -1, 0, 1e9, 0, 0, -1, 1e9]);

describe('pointLod culling', () => {
  it('extracts side + near planes (reversed-Z) and culls cubes by them', () => {
    const planes = frustumPlanes(IDENTITY);
    expect(cubeVisible(node({ index: 0, cubeMin: [-0.5, -0.5, 0], cubeSize: 1 }), planes)).toBe(true);
    expect(cubeVisible(node({ index: 0, cubeMin: [2, 0, 0], cubeSize: 1 }), planes)).toBe(false);
    expect(cubeVisible(node({ index: 0, cubeMin: [0, -3, 0], cubeSize: 1 }), planes)).toBe(false);
    expect(cubeVisible(node({ index: 0, cubeMin: [0, 0, 2], cubeSize: 1 }), planes)).toBe(false); // nearer than near
    expect(cubeVisible(node({ index: 0, cubeMin: [0.9, 0.9, 0], cubeSize: 1 }), planes)).toBe(true); // straddles
  });

  it('keeps what a perspective camera sees and drops what is behind it', () => {
    const cam = new CameraController();
    cam.setPose([0, 0, 0], 0.4, 0.2, 10);
    const planes = frustumPlanes(cam.viewProjRelative(1, [0, 0, 0]));
    expect(cubeVisible(node({ index: 0, cubeMin: [-1, -1, -1], cubeSize: 2 }), planes)).toBe(true);
    const eye = cam.eye();
    const f = cam.forward();
    const behind = [eye[0] - 20 * f[0] - 1, eye[1] - 20 * f[1] - 1, eye[2] - 20 * f[2] - 1] as const;
    expect(cubeVisible(node({ index: 0, cubeMin: behind, cubeSize: 2 }), planes)).toBe(false);
  });

  it('projects the spacing over the distance to the cube (flat in ortho)', () => {
    const n = node({ index: 0, cubeMin: [10, 0, 0], cubeSize: 1, spacing: 0.2 });
    expect(nodePriority(n, [0, 0.5, 0.5], VIEW)).toBeCloseTo((0.2 * 500) / 10);
    expect(nodePriority(n, [10.5, 0.5, 0.5], VIEW)).toBeGreaterThan(1e4); // eye inside
    expect(nodePriority(n, [0, 0.5, 0.5], { ortho: true, pxScale: 500 })).toBeCloseTo(100);
  });
});

describe('pointLod selection', () => {
  const cloud = (eye: readonly [number, number, number]): LodCloud => ({ nodes: tree(), planes: ALL, eye });

  it('refines best-first and keeps every parent ahead of its children', () => {
    const picks = selectNodes([cloud([-1, 1, 1])], VIEW, { budget: 1e9, minPx: 0 });
    expect(picks.map((p) => p.node)).toEqual([0, 1, 3, 2]);
    const seen = new Set<number>();
    for (const p of picks) {
      const parent = tree()[p.node].parent;
      expect(parent < 0 || seen.has(parent)).toBe(true);
      seen.add(p.node);
    }
  });

  it('stops at the budget and at the pixel threshold', () => {
    expect(selectNodes([cloud([-1, 1, 1])], VIEW, { budget: 250, minPx: 0 }).map((p) => p.node)).toEqual([0, 1]);
    expect(selectNodes([cloud([-1, 1, 1])], VIEW, { budget: 1e9, minPx: 1e6 }).map((p) => p.node)).toEqual([0]);
  });

  it('shares one budget over several clouds, interleaved by priority', () => {
    const picks = selectNodes([cloud([-1, 1, 1]), cloud([-3, 1, 1])], VIEW, { budget: 400, minPx: 0 });
    expect(picks.map((p) => `${p.cloud}:${p.node}`)).toEqual(['0:0', '0:1', '1:0', '0:3']);
  });
});

describe('max distance', () => {
  it('leaves out nodes whose cube is beyond it, and has no effect in ortho', () => {
    const c: LodCloud = { nodes: tree(), planes: ALL, eye: [-1, 1, 1] };
    const near = selectNodes([c], VIEW, { budget: 1e9, minPx: 0, maxDistance: 3 });
    expect(near.map((p) => p.node)).toEqual([0, 1, 3]); // node 2 starts 5 away
    expect(selectNodes([c], VIEW, { budget: 1e9, minPx: 0, maxDistance: 0 }).length).toBe(4);
    const ortho = selectNodes([c], { ortho: true, pxScale: 500 }, { budget: 1e9, minPx: 0, maxDistance: 3 });
    expect(ortho.length).toBe(4);
  });

  it('charges a node reaching past it only for its share within range', () => {
    const big = node({ index: 0, boundsMax: [8, 1, 1] });
    expect(rangeShare(big, [0, 0.5, 0.5], 100)).toBe(1);
    expect(rangeShare(big, [0, 0.5, 0.5], 4)).toBeCloseTo(0.5);
    expect(rangeShare(big, [-10, 0.5, 0.5], 1)).toBeCloseTo(1 / 64); // never 0
    // budget 300: the root (100), child 1 (100) and node 3 (100) fit without a
    // limit; with one, the root and child 1 are partly out of range and cost
    // less, so the same budget is not used up by them
    const nodes = tree().map((n) => ({ ...n, boundsMax: [n.cubeSize, n.cubeSize, n.cubeSize] as const }));
    const c: LodCloud = { nodes, planes: ALL, eye: [-1, 1, 1] };
    const cost = (far: number) =>
      selectNodes([c], VIEW, { budget: 1e9, minPx: 0, maxDistance: far })
        .map((p) => nodes[p.node].pointCount * rangeShare(nodes[p.node], c.eye, far))
        .reduce((a, b) => a + b, 0);
    expect(cost(3)).toBeLessThan(300);
    const tight = selectNodes([c], VIEW, { budget: 250, minPx: 0, maxDistance: 3 });
    expect(tight.map((p) => p.node)).toEqual([0, 1, 3]); // all three fit in 250 now
    expect(selectNodes([c], VIEW, { budget: 250, minPx: 0 }).map((p) => p.node)).toEqual([0, 1]);
  });
});

describe('setup filter', () => {
  it('walks zero-cost nodes without spending the budget', () => {
    const c: LodCloud = { nodes: tree(), planes: ALL, eye: [-1, 1, 1], cost: (n) => (n.index === 3 ? 100 : 0) };
    expect(selectNodes([c], VIEW, { budget: 100, minPx: 0 }).map((p) => p.node)).toEqual([0, 1, 3, 2]);
  });

  it('packs only the points one setup measured', () => {
    const d: DecodedNode = {
      count: 3,
      positions: new Float32Array([1, 1, 1, 2, 2, 2, 3, 3, 3]),
      intensity: new Uint16Array(3),
      rgbs: new Uint8Array([10, 0, 0, 5, 20, 0, 0, 7, 30, 0, 0, 5]),
      normals: null,
      clusterFirst: new Uint32Array([0]),
      clusterCount: new Uint32Array([3]),
      clusterBounds: new Float32Array(6),
    };
    const header = { hasColor: true, hasIntensity: true };
    const kept = packNodePoints(d, 1, header, 5);
    expect(kept.length).toBe(4 + 2 * 4);
    expect([new Float32Array(kept.buffer)[4], new Float32Array(kept.buffer)[8]]).toEqual([1, 3]);
    expect([kept[7] & 255, kept[11] & 255]).toEqual([10, 30]);
    expect(packNodePoints(d, 1, header, 9).length).toBe(4);
    expect(packNodePoints(d, 1, header).length).toBe(4 + 3 * 4);
  });
});

describe('pointLod on the synthetic fixture', () => {
  it('selects the whole file when the budget allows and packs nodes for the GPU', async () => {
    const f = await openTdpp(src);
    expect(f.error).toBeUndefined();
    const file = f.data!;
    const o = file.header.origin;
    const cam = new CameraController();
    const min = [0, 1, 2].map((k) => o[k] + file.header.boundsMin[k]);
    const max = [0, 1, 2].map((k) => o[k] + file.header.boundsMax[k]);
    cam.fit(min, max);
    cam.viewProj(1);
    const eye = cam.eye();
    const lod: LodCloud = {
      nodes: file.nodes,
      planes: frustumPlanes(cam.viewProjRelative(1, o)),
      eye: [eye[0] - o[0], eye[1] - o[1], eye[2] - o[2]],
    };
    const picks = selectNodes([lod], { ortho: false, pxScale: cam.lastP11 * 400 }, { budget: 1e9, minPx: 0 });
    expect(picks.length).toBe(file.header.nodeCount);
    expect(picks.reduce((s, p) => s + file.nodes[p.node].pointCount, 0)).toBe(40000);

    const n0 = file.nodes[0];
    const dec = await decodeNode(n0, await src.read(n0.payloadOffset, n0.payloadSize));
    const d = dec.data!;
    const words = packNodePoints(d, n0.spacing, file.header);
    const fl = new Float32Array(words.buffer);
    expect(words.length).toBe(4 + 4 * d.count);
    expect(fl[0]).toBeCloseTo(n0.spacing, 5);
    for (const i of [0, 1, d.count - 1]) {
      expect([fl[4 + 4 * i], fl[5 + 4 * i], fl[6 + 4 * i]]).toEqual([...d.positions.subarray(3 * i, 3 * i + 3)]);
      const w = words[7 + 4 * i];
      expect([w & 255, (w >>> 8) & 255, (w >>> 16) & 255]).toEqual([...d.rgbs.subarray(4 * i, 4 * i + 3)]);
      expect(w >>> 24).toBe(d.intensity[i] >> 8);
    }
  });
});

describe('pointPack fallbacks', () => {
  const one: DecodedNode = {
    count: 1,
    positions: new Float32Array([1, 2, 3]),
    intensity: new Uint16Array([0x8000]),
    rgbs: new Uint8Array([200, 100, 50, 0]),
    normals: null,
    clusterFirst: new Uint32Array([0]),
    clusterCount: new Uint32Array([1]),
    clusterBounds: new Float32Array(6),
  };

  it('stores grey as RGB without colour, and luma as grey without intensity', () => {
    const noColor = packNodePoints(one, 1, { hasColor: false, hasIntensity: true })[7];
    expect([noColor & 255, (noColor >>> 8) & 255, (noColor >>> 16) & 255, noColor >>> 24]).toEqual([128, 128, 128, 128]);
    const noIntensity = packNodePoints(one, 1, { hasColor: true, hasIntensity: false })[7];
    expect(noIntensity >>> 24).toBe(Math.round(0.299 * 200 + 0.587 * 100 + 0.114 * 50));
  });
});

describe('measure snap on points', () => {
  const cloud: DecodedNode = {
    count: 4,
    // on the ray's axis region: one 2 mm off at depth 10, one 1 mm off but 1 m behind (through a gap),
    // one 30 mm off, one 1 mm off at depth 10 measured by another setup
    positions: new Float32Array([10, 0.002, 0, 11, 0.001, 0, 10, 0.03, 0, 10, 0, 0.001]),
    intensity: new Uint16Array(4),
    rgbs: new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 2]),
    normals: null,
    clusterFirst: new Uint32Array([0]),
    clusterCount: new Uint32Array([4]),
    clusterBounds: new Float32Array(6),
  };
  const query = { origin: [0, 0, 0], dir: [1, 0, 0], t: 10, radius: 0.01, onlySetup: null } as const;

  it('takes the point nearest the ray on the picked surface, not one behind it', () => {
    expect(nearestToRay(cloud, query)?.point[2]).toBeCloseTo(0.001);
    const one = nearestToRay(cloud, { ...query, onlySetup: 1 });
    expect(one?.point[0]).toBeCloseTo(10);
    expect(one?.point[1]).toBeCloseTo(0.002);
  });

  it('finds nothing outside the radius and keeps a better earlier winner', () => {
    expect(nearestToRay(cloud, { ...query, radius: 0.0005 })).toBeNull();
    const earlier = { point: [10, 0, 0] as [number, number, number], d2: 0 };
    expect(nearestToRay(cloud, query, earlier)).toBe(earlier);
  });

  it('pads the node box by the snap radius', () => {
    expect(boxContains([0, 0, 0], [1, 1, 1], [1.05, 0.5, 0.5], 0.1)).toBe(true);
    expect(boxContains([0, 0, 0], [1, 1, 1], [1.2, 0.5, 0.5], 0.1)).toBe(false);
  });
});

describe('focus distance and in-view budget', () => {
  it('lowers the priority of nodes beyond the focus distance, not of near ones', () => {
    const near = node({ index: 0, cubeMin: [2, 0, 0], spacing: 0.1 });
    const far = node({ index: 0, cubeMin: [40, 0, 0], spacing: 0.1 });
    const eye = [0, 0.5, 0.5] as const;
    expect(nodePriority(near, eye, VIEW, 10)).toBe(nodePriority(near, eye, VIEW));
    expect(nodePriority(far, eye, VIEW, 10)).toBeCloseTo(nodePriority(far, eye, VIEW) / 4); // 40 m = 4 × focus
    expect(nodePriority(far, eye, { ortho: true, pxScale: 500 }, 10)).toBe(0.1 * 500); // ignored in ortho
  });

  it('stops refining far nodes earlier with a focus distance', () => {
    // root [0,8)³ seen from 20 m away: its children project above minPx
    // without a focus, below it with a 2 m focus
    const c: LodCloud = { nodes: tree(), planes: ALL, eye: [-20, 1, 1] };
    const even = selectNodes([c], VIEW, { budget: 1e9, minPx: 15 });
    const focused = selectNodes([c], VIEW, { budget: 1e9, minPx: 15, focusDistance: 2 });
    expect(even.length).toBeGreaterThan(focused.length);
    expect(focused.map((p) => p.node)).toEqual([0]);
  });

  it('charges a node only for its share inside the view', () => {
    // x >= 4 is in view: half of an [0,8) wide node
    const half = new Float32Array([1, 0, 0, -4, -1, 0, 0, 1e9, 0, 1, 0, 1e9, 0, -1, 0, 1e9, 0, 0, -1, 1e9]);
    const wide = node({ index: 0, cubeSize: 8, boundsMax: [8, 8, 8] });
    expect(rangeShare(wide, [0, 0, 0], Number.POSITIVE_INFINITY, half)).toBeCloseTo(0.5);
    expect(rangeShare(wide, [0, 0, 0], Number.POSITIVE_INFINITY, ALL)).toBe(1);
    const nodes = [
      { ...wide, firstChild: 1, childCount: 1 },
      node({ index: 1, cubeMin: [4, 0, 0], cubeSize: 4, boundsMin: [4, 0, 0], boundsMax: [8, 4, 4], parent: 0, depth: 1 }),
    ];
    const c: LodCloud = { nodes, planes: half, eye: [-1, 1, 1] };
    // budget 150: the root (100) then the child (100) do not both fit when
    // every point counts; they do when the root costs its in-view half
    expect(selectNodes([c], VIEW, { budget: 150, minPx: 0 }).length).toBe(1);
    const shared = selectNodes([c], VIEW, { budget: 150, minPx: 0, inViewCost: true });
    expect(shared.length).toBe(2);
    // each pick says what it was charged: the root its in-view half
    expect(shared.map((p) => p.cost)).toEqual([50, 100]);
    expect(selectNodes([c], VIEW, { budget: 150, minPx: 0 })[0].cost).toBe(100);
  });

  it('caps the points of the picked nodes counted whole', () => {
    const half = new Float32Array([1, 0, 0, -4, -1, 0, 0, 1e9, 0, 1, 0, 1e9, 0, -1, 0, 1e9, 0, 0, -1, 1e9]);
    const nodes = [
      { ...node({ index: 0, cubeSize: 8, boundsMax: [8, 8, 8] }), firstChild: 1, childCount: 1 },
      node({ index: 1, cubeMin: [4, 0, 0], cubeSize: 4, boundsMin: [4, 0, 0], boundsMax: [8, 4, 4], parent: 0, depth: 1 }),
    ];
    const c: LodCloud = { nodes, planes: half, eye: [-1, 1, 1] };
    // charged 50 + 100 fits the budget of 150, but the two nodes hold 200
    // points: a cap of 150 whole points stops at the root
    const opts = { budget: 150, minPx: 0, inViewCost: true };
    expect(selectNodes([c], VIEW, { ...opts, maxHeld: 150 }).map((p) => p.node)).toEqual([0]);
    expect(selectNodes([c], VIEW, { ...opts, maxHeld: 200 }).length).toBe(2);
    expect(selectNodes([c], VIEW, { ...opts, maxHeld: 0 }).length).toBe(2); // 0 = no cap
  });
});

describe('clip planes and boxes', () => {
  /** Everything with x >= 4 is cut away (a sphere is gone when it lies wholly there). */
  const cutRight = (p: readonly [number, number, number], radius: number) => p[0] - radius >= 4;

  it('skips a node whose cube is cut away, with everything below it', () => {
    const c: LodCloud = { nodes: tree(), planes: ALL, eye: [-1, 1, 1], clipped: cutRight };
    // node 2 is the cube x [4,8): its bounding sphere reaches below x = 4, so
    // the conservative cube test keeps it; a cube further out is skipped
    const far = tree().map((n) => (n.index === 2 ? { ...n, cubeMin: [8, 0, 0] as const } : n));
    const picks = selectNodes([{ ...c, nodes: far }], VIEW, { budget: 1e9, minPx: 0 });
    expect(picks.map((p) => p.node)).toEqual([0, 1, 3]);
    expect(selectNodes([{ ...c, clipped: undefined }], VIEW, { budget: 1e9, minPx: 0 }).length).toBe(4);
  });

  it('charges a node cut partly only for what is left', () => {
    const wide = node({ index: 0, cubeSize: 8, boundsMax: [8, 8, 8] });
    expect(rangeShare(wide, [0, 0, 0], Number.POSITIVE_INFINITY, undefined, cutRight)).toBeCloseTo(0.5);
    expect(rangeShare(wide, [0, 0, 0], Number.POSITIVE_INFINITY, undefined, () => false)).toBe(1);
    const nodes = [
      { ...wide, firstChild: 1, childCount: 1 },
      node({ index: 1, cubeSize: 4, boundsMax: [4, 4, 4], parent: 0, depth: 1 }),
    ];
    const c: LodCloud = { nodes, planes: ALL, eye: [-1, 1, 1] };
    // budget 150: root (100) + child (100) do not fit; with half the root cut
    // away it costs 50 and both do
    expect(selectNodes([c], VIEW, { budget: 150, minPx: 0 }).length).toBe(1);
    expect(selectNodes([{ ...c, clipped: cutRight }], VIEW, { budget: 150, minPx: 0 }).length).toBe(2);
  });
});
