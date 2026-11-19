// The TS generic cook reorders each draw range for the vertex cache before
// building meshlets (cook.ts cacheOrderedIndices). The reorder may only change
// triangle ORDER — every triangle, its winding and its (global) vertex ids
// must survive, including for ranges that index a shared positions array.
import { MeshoptEncoder } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';
import { cacheOrderedIndices } from '../src/lib/cooker/cook';

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** An n×n quad grid as triangles, vertex ids offset by `base` (a range inside
 *  a model-wide positions array), rows emitted in a cache-hostile order. */
function grid(n: number, base: number): Uint32Array {
  const out: number[] = [];
  const v = (x: number, y: number) => base + y * (n + 1) + x;
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      out.push(v(x, y), v(x + 1, y), v(x + 1, y + 1), v(x, y), v(x + 1, y + 1), v(x, y + 1));
    }
  }
  return Uint32Array.from(out);
}

/** Triangles as winding-preserving keys (rotated to start at the smallest id). */
function triangleKeys(idx: Uint32Array): string[] {
  const keys: string[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    const tri = [idx[t], idx[t + 1], idx[t + 2]];
    const r = tri.indexOf(Math.min(...tri));
    keys.push([tri[r], tri[(r + 1) % 3], tri[(r + 2) % 3]].join(','));
  }
  return keys.sort();
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe('cacheOrderedIndices', () => {
  beforeAll(async () => {
    await MeshoptEncoder.ready;
  });

  it('keeps every triangle with its winding and global ids', () => {
    const input = grid(24, 100_000);
    const before = input.slice();
    const out = cacheOrderedIndices(input);
    expect(triangleKeys(out)).toEqual(triangleKeys(input));
    expect([...input]).toEqual([...before]); // input untouched
  });

  it('actually reorders a cache-hostile range', () => {
    const input = grid(24, 0);
    expect([...cacheOrderedIndices(input)]).not.toEqual([...input]);
  });
});
