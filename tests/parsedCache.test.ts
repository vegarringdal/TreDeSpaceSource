import { describe, expect, it } from 'vitest';
import type { ParsedModel } from '../src/lib/model/format';
import { ParsedLru, parsedBytes } from '../src/lib/modeldb/parsedCache';

/** A parse whose decoded footprint is exactly `bytes` (one positions array). */
function fakeParsed(bytes: number): ParsedModel {
  return {
    name: 'm',
    boundsMin: [0, 0, 0],
    boundsMax: [1, 1, 1],
    denseMin: null,
    denseMax: null,
    colorGroups: [
      {
        color: [1, 1, 1, 1],
        meshletCount: 0,
        localVertCount: 0,
        triByteCount: 0,
        drawRangeCount: 0,
        drMeshletStarts: new Uint32Array(0),
        drMeshletCounts: new Uint32Array(0),
        descs: new DataView(new ArrayBuffer(0)),
        tris: new Uint8Array(0),
        bounds: new Float32Array(0),
        positions: new Uint8Array(bytes),
        normals: null,
      },
    ],
    itemCount: 0,
    itemToCg: new Uint16Array(0),
    itemToDr: new Uint32Array(0),
    hierarchy: {
      namePool: new Uint8Array(0),
      entryId: new Uint32Array(0),
      entryNameOffset: new Uint32Array(0),
      entryParent: new Uint32Array(0),
      entryNameLen: new Uint16Array(0),
      idItemIds: new Uint32Array(0),
      idItemItems: new Uint32Array(0),
    },
    cells: null,
  };
}

describe('parsedBytes', () => {
  it('sums every typed array the parse holds', () => {
    const p = fakeParsed(100);
    p.itemToDr = new Uint32Array(5); // 20 B
    p.hierarchy.namePool = new Uint8Array(7);
    expect(parsedBytes(p)).toBe(127);
  });
});

describe('ParsedLru', () => {
  it('hits only while size and mtime match, and drops a stale entry', () => {
    const c = new ParsedLru(1000, 4);
    const p = fakeParsed(10);
    c.put('a', 10, 1, 0, p);
    expect(c.get('a', 10, 1)).toBe(p);
    expect(c.get('a', 11, 1)).toBeNull();
    expect(c.size).toBe(0);
    expect(c.totalBytes).toBe(0);
  });

  it('evicts least recently used first under the byte cap', () => {
    const c = new ParsedLru(100, 10);
    c.put('a', 1, 1, 0, fakeParsed(40));
    c.put('b', 1, 1, 1, fakeParsed(40));
    c.get('a', 1, 1); // a is now most recently used
    c.put('c', 1, 1, 2, fakeParsed(40)); // needs room: b goes
    expect(c.get('b', 1, 1)).toBeNull();
    expect(c.get('a', 1, 1)).not.toBeNull();
    expect(c.get('c', 1, 1)).not.toBeNull();
    expect(c.totalBytes).toBe(80);
  });

  it('honours the entry cap', () => {
    const c = new ParsedLru(1000, 2);
    c.put('a', 1, 1, 0, fakeParsed(1));
    c.put('b', 1, 1, 1, fakeParsed(1));
    c.put('c', 1, 1, 2, fakeParsed(1));
    expect(c.size).toBe(2);
    expect(c.get('a', 1, 1)).toBeNull();
  });

  it('does not keep a parse larger than the whole cache', () => {
    const c = new ParsedLru(50, 4);
    c.put('big', 1, 1, 0, fakeParsed(60));
    expect(c.size).toBe(0);
    expect(c.get('big', 1, 1)).toBeNull();
  });

  it('replaces an entry with the same key instead of double-counting it', () => {
    const c = new ParsedLru(1000, 4);
    c.put('a', 1, 1, 0, fakeParsed(30));
    c.put('a', 2, 2, 0, fakeParsed(40));
    expect(c.size).toBe(1);
    expect(c.totalBytes).toBe(40);
    expect(c.get('a', 2, 2)).not.toBeNull();
  });

  it('forgets every parse of an owner and clears entirely', () => {
    const c = new ParsedLru(1000, 4);
    c.put('a.full', 1, 1, 3, fakeParsed(1));
    c.put('a.coarse', 1, 1, 3, fakeParsed(1));
    c.put('b.full', 1, 1, 4, fakeParsed(1));
    c.forgetOwner(3);
    expect(c.size).toBe(1);
    expect(c.get('b.full', 1, 1)).not.toBeNull();
    c.clear();
    expect(c.size).toBe(0);
    expect(c.totalBytes).toBe(0);
  });
});
