// MD5 (RFC 1321) — dependency-free, byte-oriented. SubtleCrypto has no MD5,
// and the asset store wants an MD5 of each source file so a host can cheaply
// tell whether a re-import would replace unchanged bytes. Lowercase hex out.
// `Md5` is the incremental form for streamed sources (GB-scale downloads that
// go straight to OPFS); `md5Hex` is the one-shot convenience over it.

// K[i] = floor(2^32 * abs(sin(i+1))) — hardcoded to avoid any float drift.
const K = [
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501, 0x698098d8,
  0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821, 0xf61e2562, 0xc040b340,
  0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8, 0x21e1cde6, 0xc33707d6, 0xf4d50d87,
  0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a, 0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
  0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70, 0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039,
  0xe6db99e5, 0x1fa27cf8, 0xc4ac5665, 0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92,
  0xffeff47d, 0x85845dd1, 0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb,
  0xeb86d391,
];

// per-operation left-rotate amounts
const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4,
  11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const rotl = (x: number, c: number) => (x << c) | (x >>> (32 - c));

const BLOCK = 64;

/** Incremental MD5: `update()` any number of chunks, then `hex()` once.
 *  Constant memory regardless of input size — feed it a download stream. */
export class Md5 {
  private a0 = 0x67452301;
  private b0 = 0xefcdab89;
  private c0 = 0x98badcfe;
  private d0 = 0x10325476;
  private readonly pending = new Uint8Array(BLOCK);
  private pendingLen = 0;
  private totalLen = 0;
  private readonly M = new Int32Array(16);

  update(chunk: Uint8Array): this {
    this.totalLen += chunk.length;
    let off = 0;
    if (this.pendingLen > 0) {
      const take = Math.min(BLOCK - this.pendingLen, chunk.length);
      this.pending.set(chunk.subarray(0, take), this.pendingLen);
      this.pendingLen += take;
      off = take;
      if (this.pendingLen < BLOCK) {
        return this;
      }
      this.block(new DataView(this.pending.buffer), 0);
      this.pendingLen = 0;
    }
    const dv = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    for (; off + BLOCK <= chunk.length; off += BLOCK) {
      this.block(dv, off);
    }
    if (off < chunk.length) {
      this.pending.set(chunk.subarray(off));
      this.pendingLen = chunk.length - off;
    }
    return this;
  }

  /** Finalize and return the lowercase hex digest. Call once. */
  hex(): string {
    // pad to a multiple of 64 with room for 0x80 + an 8-byte length
    const rest = this.pendingLen;
    const total = (((rest + 8) >>> 6) << 6) + 64;
    const buf = new Uint8Array(total);
    buf.set(this.pending.subarray(0, rest));
    buf[rest] = 0x80;
    const dv = new DataView(buf.buffer);
    const bitLen = this.totalLen * 8;
    dv.setUint32(total - 8, bitLen >>> 0, true);
    dv.setUint32(total - 4, Math.floor(bitLen / 0x100000000) >>> 0, true);
    for (let off = 0; off < total; off += BLOCK) {
      this.block(dv, off);
    }

    const hex = (x: number) => {
      let s = '';
      for (let i = 0; i < 4; i++) {
        s += (((x >>> (i * 8)) & 0xff) + 0x100).toString(16).slice(1);
      }
      return s;
    };
    return hex(this.a0) + hex(this.b0) + hex(this.c0) + hex(this.d0);
  }

  private block(dv: DataView, off: number): void {
    const M = this.M;
    for (let i = 0; i < 16; i++) {
      M[i] = dv.getUint32(off + i * 4, true);
    }
    let A = this.a0;
    let B = this.b0;
    let C = this.c0;
    let D = this.d0;
    for (let i = 0; i < 64; i++) {
      let F: number;
      let g: number;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) & 15;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) & 15;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) & 15;
      }
      F = (F + A + K[i] + M[g]) | 0;
      A = D;
      D = C;
      C = B;
      B = (B + rotl(F, S[i])) | 0;
    }
    this.a0 = (this.a0 + A) | 0;
    this.b0 = (this.b0 + B) | 0;
    this.c0 = (this.c0 + C) | 0;
    this.d0 = (this.d0 + D) | 0;
  }
}

export function md5Hex(input: Uint8Array): string {
  return new Md5().update(input).hex();
}
