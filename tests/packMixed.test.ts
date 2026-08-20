// packModelMixed decides, PER ITEM, whether its geometry comes from the full
// parse, the coarse parse, or is dropped — the core of mixed residency. These
// tests pin that selection plus the invariants the viewer depends on: the item
// table never changes, streams stay compact, and meshlet records point at the
// right vertices.
import { describe, expect, it } from 'vitest';
import type { ColorGroup, ParsedModel } from '../src/lib/model/format';
import { healItemBounds, INFO_STRIDE_WORDS, ITEM_DROP, packModelMixed } from '../src/lib/model/pack';

// -----------------------------------------------------------------------------
// synthetic ParsedModel: N items in one color group, `meshletsPerItem` each,
// one triangle per meshlet. `tag` distinguishes the full and coarse sources.
// -----------------------------------------------------------------------------

function makeParsed(itemCount: number, meshletsPerItem: number, tag: number): ParsedModel {
  const total = itemCount * meshletsPerItem;
  const descs = new DataView(new ArrayBuffer(total * 40));
  const bounds = new Float32Array(total * 12);
  const drMeshletStarts = new Uint32Array(itemCount);
  const drMeshletCounts = new Uint32Array(itemCount);
  const VERTS = 3;

  for (let m = 0; m < total; m++) {
    const o = m * 40;
    descs.setUint32(o + 0, m * VERTS, true); // vertex_offset
    descs.setUint32(o + 4, m * 3, true); // triangle_offset (3 indices)
    descs.setUint32(o + 8, VERTS, true); // vertex_count
    descs.setUint32(o + 12, 1, true); // triangle_count
    // dequant AABB: min = (item index, tag, 0), scale = 1/65535 → 1 unit box
    const item = Math.floor(m / meshletsPerItem);
    descs.setFloat32(o + 16, item, true);
    descs.setFloat32(o + 20, tag, true);
    descs.setFloat32(o + 24, 0, true);
    descs.setFloat32(o + 28, 1 / 65535, true);
    descs.setFloat32(o + 32, 1 / 65535, true);
    descs.setFloat32(o + 36, 1 / 65535, true);
    bounds[m * 12 + 3] = 1; // radius
    bounds[m * 12 + 10] = 1; // cone cutoff = degenerate marker
  }
  for (let i = 0; i < itemCount; i++) {
    drMeshletStarts[i] = i * meshletsPerItem;
    drMeshletCounts[i] = meshletsPerItem;
  }

  const cg: ColorGroup = {
    color: [1, 0, 0, 1],
    localVertCount: total * VERTS,
    meshletCount: total,
    drawRangeCount: itemCount,
    descs,
    // 6 bytes/vertex (u16 x3); the value encodes the source tag so the packed
    // positions prove WHICH parse an item came from
    positions: new Uint8Array(total * VERTS * 6).fill(tag),
    normals: null,
    tris: new Uint8Array(total * 3).fill(0),
    bounds,
    drIds: new Uint32Array(itemCount).map((_, i) => i),
    drStarts: new Uint32Array(itemCount),
    drCounts: new Uint32Array(itemCount),
    drMeshletStarts,
    drMeshletCounts,
  } as unknown as ColorGroup;

  return {
    name: 'test',
    boundsMin: [0, 0, 0],
    boundsMax: [10, 10, 10],
    denseMin: null,
    denseMax: null,
    itemCount,
    colorGroups: [cg],
    itemToCg: new Uint16Array(itemCount),
    itemToDr: new Uint32Array(itemCount).map((_, i) => i),
    hierarchy: { entryCount: 0 },
  } as unknown as ParsedModel;
}

const FULL_TAG = 0xaa;
const COARSE_TAG = 0x55;

/** Which source each item's first packed vertex came from. */
function sourceOfItems(packed: ReturnType<typeof packModelMixed>, itemCount: number): (number | null)[] {
  const info = new Uint32Array(packed.meshletInfo);
  const cull = new Uint32Array(packed.cull);
  const out: (number | null)[] = new Array(itemCount).fill(null);
  for (let m = 0; m < packed.meshletCount; m++) {
    const item = info[m * INFO_STRIDE_WORDS + 7];
    const baseVertex = cull[m * 9 + 8];
    // positionsQ is u16x4 per vertex; byte pattern came from `positions`
    out[item] = packed.positionsQ[baseVertex * 4] & 0xff;
  }
  return out;
}

describe('packModelMixed', () => {
  const ITEMS = 4;
  const PER_ITEM = 2;

  it('takes each item from the source its mask selects', () => {
    const full = makeParsed(ITEMS, PER_ITEM, FULL_TAG);
    const coarse = makeParsed(ITEMS, PER_ITEM, COARSE_TAG);
    const mask = new Uint8Array([1, 0, 1, 0]); // items 0,2 full; 1,3 coarse
    const packed = packModelMixed(full, coarse, mask);
    expect(sourceOfItems(packed, ITEMS)).toEqual([FULL_TAG, COARSE_TAG, FULL_TAG, COARSE_TAG]);
  });

  it('drops items marked ITEM_DROP entirely', () => {
    const full = makeParsed(ITEMS, PER_ITEM, FULL_TAG);
    const coarse = makeParsed(ITEMS, PER_ITEM, COARSE_TAG);
    const mask = new Uint8Array([1, ITEM_DROP, 1, ITEM_DROP]);
    const packed = packModelMixed(full, coarse, mask);
    // only the two kept items contribute meshlets
    expect(packed.meshletCount).toBe(2 * PER_ITEM);
    const src = sourceOfItems(packed, ITEMS);
    expect(src[1]).toBeNull();
    expect(src[3]).toBeNull();
  });

  it('keeps the item table intact even when everything is dropped', () => {
    const full = makeParsed(ITEMS, PER_ITEM, FULL_TAG);
    const coarse = makeParsed(ITEMS, PER_ITEM, COARSE_TAG);
    const packed = packModelMixed(full, coarse, new Uint8Array(ITEMS).fill(ITEM_DROP));
    expect(packed.itemCount).toBe(ITEMS); // ids/selection/hide state stay valid
    expect(packed.meshletCount).toBe(0);
    expect(packed.triangleCount).toBe(0);
  });

  it('falls back to coarse for every unmarked item (all-coarse pack)', () => {
    const full = makeParsed(ITEMS, PER_ITEM, FULL_TAG);
    const coarse = makeParsed(ITEMS, PER_ITEM, COARSE_TAG);
    const packed = packModelMixed(full, coarse, new Uint8Array(ITEMS));
    expect(sourceOfItems(packed, ITEMS)).toEqual(new Array(ITEMS).fill(COARSE_TAG));
  });

  it('drops unmarked items when there is no coarse parse (cut-only pack)', () => {
    const full = makeParsed(ITEMS, PER_ITEM, FULL_TAG);
    const keep = new Uint8Array([1, 0, 1, 0]);
    const packed = packModelMixed(full, null, keep);
    expect(packed.meshletCount).toBe(2 * PER_ITEM);
    expect(packed.itemCount).toBe(ITEMS);
  });

  it('compacts vertex and index streams (no gaps from skipped meshlets)', () => {
    const full = makeParsed(ITEMS, PER_ITEM, FULL_TAG);
    const coarse = makeParsed(ITEMS, PER_ITEM, COARSE_TAG);
    const packed = packModelMixed(full, coarse, new Uint8Array([1, ITEM_DROP, ITEM_DROP, ITEM_DROP]));
    const kept = PER_ITEM; // one item survives
    expect(packed.meshletCount).toBe(kept);
    expect(packed.positionsQ.length).toBe(kept * 3 * 4); // 3 verts/meshlet, u16x4
    expect(packed.triangleCount).toBe(kept);
  });

  it('rejects a coarse parse whose item table does not match', () => {
    const full = makeParsed(ITEMS, PER_ITEM, FULL_TAG);
    const mismatched = makeParsed(ITEMS + 1, PER_ITEM, COARSE_TAG);
    expect(() => packModelMixed(full, mismatched, new Uint8Array(ITEMS))).toThrow(/does not match/);
  });

  it('reports the same item count regardless of the mask (state stays aligned)', () => {
    const full = makeParsed(ITEMS, PER_ITEM, FULL_TAG);
    const coarse = makeParsed(ITEMS, PER_ITEM, COARSE_TAG);
    for (const mask of [
      new Uint8Array([1, 1, 1, 1]),
      new Uint8Array([0, 0, 0, 0]),
      new Uint8Array([1, 0, ITEM_DROP, 1]),
    ]) {
      expect(packModelMixed(full, coarse, mask).itemCount).toBe(ITEMS);
    }
  });
});

// -----------------------------------------------------------------------------
// healItemBounds — repairs DbModel bounds born from a coarse initial load
// -----------------------------------------------------------------------------

describe('healItemBounds', () => {
  const INF6 = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];

  it('adopts incoming bounds only where the stored ones are non-finite', () => {
    // item 0: finite stored (full-parse) — must survive untouched
    // item 1: Infinity stored (cooker-cut at coarse load) — must heal
    const stored = new Float32Array([0, 0, 0, 1, 1, 1, ...INF6]);
    const incoming = new Float32Array([9, 9, 9, 10, 10, 10, 5, 5, 5, 6, 6, 6]);
    expect(healItemBounds(stored, incoming)).toBe(1);
    expect([...stored.slice(0, 6)]).toEqual([0, 0, 0, 1, 1, 1]);
    expect([...stored.slice(6)]).toEqual([5, 5, 5, 6, 6, 6]);
  });

  it('leaves a hole alone when the incoming pack also lacks the item', () => {
    // a mixed/coarse pack that dropped the item cannot heal it
    const stored = new Float32Array(INF6);
    const incoming = new Float32Array(INF6);
    expect(healItemBounds(stored, incoming)).toBe(0);
    expect(Number.isFinite(stored[0])).toBe(false);
  });

  it('heals bounds produced by a real pack (end to end with packModelMixed)', () => {
    // stored bounds full of holes, as after addModel(coarse bytes); a full
    // pack's bounds fill every hole
    const items = 4;
    const full = makeParsed(items, 2, 100);
    const packed = packModelMixed(full, null, new Uint8Array(items).fill(1));
    const stored = new Float32Array(items * 6);
    for (let i = 0; i < items; i++) {
      stored.set(INF6, i * 6);
    }
    expect(healItemBounds(stored, packed.itemBounds)).toBe(items);
    for (let i = 0; i < items * 6; i++) {
      expect(Number.isFinite(stored[i])).toBe(true);
    }
  });
});
