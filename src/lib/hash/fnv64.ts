// FNV-1a 64-bit — the stable item key of the state-snapshot format. The
// algorithm is fixed and unseeded: the same UTF-8 bytes hash to the same
// 64 bits in every session, browser, and app version, so hashes written to a
// .tdsnap file keep matching model fullnames forever. Changing anything here
// is a snapshot-format break (bump SNAP_VERSION).

const FNV_OFFSET_LO = 0x84222325;
const FNV_OFFSET_HI = 0xcbf29ce4;
/** The FNV-1a 64 prime is 2^40 + 0x1B3; the multiply below exploits that. */
const FNV_PRIME_LOW = 0x1b3;
const TWO_32 = 0x100000000;

/** Reusable encode buffer so hashing ~10^6 names allocates nothing per call. */
export interface Fnv64Scratch {
  buf: Uint8Array;
  enc: TextEncoder;
}

export function createFnv64Scratch(): Fnv64Scratch {
  return { buf: new Uint8Array(1024), enc: new TextEncoder() };
}

/**
 * Hash `s` (as UTF-8) with FNV-1a 64 and write the result into
 * `out[outIndex]` (low u32) and `out[outIndex + 1]` (high u32).
 *
 * The 64-bit state lives in two u32 halves; the per-byte multiply by the
 * prime 2^40 + 0x1B3 splits into `hash * 0x1B3` (exact in doubles, products
 * stay < 2^53) plus `hash << 40` (only `lo << 8` survives into the high
 * word mod 2^64).
 */
export function fnv1a64(s: string, scratch: Fnv64Scratch, out: Uint32Array, outIndex: number): void {
  // worst-case UTF-8 expansion is 3 bytes per UTF-16 code unit
  if (scratch.buf.length < s.length * 3) {
    scratch.buf = new Uint8Array(s.length * 3);
  }
  const { written } = scratch.enc.encodeInto(s, scratch.buf);
  const bytes = scratch.buf;
  let lo = FNV_OFFSET_LO;
  let hi = FNV_OFFSET_HI;
  for (let i = 0; i < written; i++) {
    lo = (lo ^ bytes[i]) >>> 0;
    const loProd = lo * FNV_PRIME_LOW;
    const carry = Math.floor(loProd / TWO_32);
    hi = (hi * FNV_PRIME_LOW + carry + lo * 256) % TWO_32;
    lo = loProd % TWO_32;
  }
  out[outIndex] = lo;
  out[outIndex + 1] = hi;
}
