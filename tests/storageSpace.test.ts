import { describe, expect, it } from 'vitest';
import { formatBytes, importSpaceNeeded, judgeSpace } from '../src/lib/opfs/storageSpace';

const GB = 1024 ** 3;

describe('importSpaceNeeded', () => {
  it('asks for the source size', () => {
    expect(importSpaceNeeded(3 * GB, false)).toBe(3 * GB);
  });

  it('asks for a second copy when the source is staged in OPFS', () => {
    expect(importSpaceNeeded(3 * GB, true)).toBe(6 * GB);
  });
});

describe('judgeSpace', () => {
  it('fits when the quota leaves enough', () => {
    expect(judgeSpace({ usage: 2 * GB, quota: 10 * GB }, 8 * GB)).toEqual({ fits: true });
  });

  it('reports what is missing when it does not fit', () => {
    expect(judgeSpace({ usage: 9 * GB, quota: 10 * GB }, 4 * GB)).toEqual({ fits: false, needed: 4 * GB, free: GB });
  });

  it('never reports negative free space', () => {
    expect(judgeSpace({ usage: 11 * GB, quota: 10 * GB }, 1)).toEqual({ fits: false, needed: 1, free: 0 });
  });
});

describe('formatBytes', () => {
  it('picks a readable unit', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(1536)).toBe('1.5 kB');
    expect(formatBytes(512 * 1024 ** 2)).toBe('512 MB');
    expect(formatBytes(1.4 * GB)).toBe('1.4 GB');
  });
});
