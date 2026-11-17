import { describe, expect, it } from 'vitest';
import { Md5, md5Hex } from '../src/lib/md5';

const enc = (s: string) => new TextEncoder().encode(s);

// RFC 1321 appendix A.5 test suite
const VECTORS: ReadonlyArray<[string, string]> = [
  ['', 'd41d8cd98f00b204e9800998ecf8427e'],
  ['a', '0cc175b9c0f1b6a831c399e269772661'],
  ['abc', '900150983cd24fb0d6963f7d28e17f72'],
  ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
  ['abcdefghijklmnopqrstuvwxyz', 'c3fcd3d76192e4007dfb496cca67e13b'],
  ['ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 'd174ab98d277d9f5a5611c2c9f419d9f'],
  [
    '12345678901234567890123456789012345678901234567890123456789012345678901234567890',
    '57edf4a22be3c955ac49da2e2107b67a',
  ],
];

describe('md5Hex', () => {
  it('matches the RFC 1321 test suite', () => {
    for (const [input, digest] of VECTORS) {
      expect(md5Hex(enc(input))).toBe(digest);
    }
  });
});

describe('Md5 (incremental)', () => {
  it('matches one-shot for every chunking of a multi-block input', () => {
    const bytes = new Uint8Array(1024 + 37);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = (i * 31 + 7) & 0xff;
    }
    const expected = md5Hex(bytes);
    for (const chunkSize of [1, 3, 63, 64, 65, 128, 500, bytes.length]) {
      const h = new Md5();
      for (let off = 0; off < bytes.length; off += chunkSize) {
        h.update(bytes.subarray(off, off + chunkSize));
      }
      expect(h.hex(), `chunk size ${chunkSize}`).toBe(expected);
    }
  });

  it('handles a subarray view with a non-zero byteOffset', () => {
    const backing = new Uint8Array(200);
    backing.fill(0xab);
    const view = backing.subarray(7, 7 + 100);
    expect(new Md5().update(view).hex()).toBe(md5Hex(new Uint8Array(view)));
  });
});
