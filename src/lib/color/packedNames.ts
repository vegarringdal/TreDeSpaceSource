// Packed fullname lists: the flat form a big SQL coloring/selection result
// travels in. Instead of one JS string (+ object) per row, every name is
// lowercased, trimmed and appended to ONE UTF-8 buffer with an offsets array,
// and the per-row color/opacity sit in parallel typed arrays. The buffers are
// transferable, so the SQL worker → main → model-db worker hops move them
// instead of cloning, and nothing is retained per row on the main thread.
// A 4M-row result is ~45 B/row this way versus ~1 KB/row as strings/objects.
import { COLOR_DEFAULT, parseColorToken } from './hexColor';

/** "no per-row color" — the rule's own color applies (distinct from
 *  COLOR_DEFAULT = restore the original mesh color). */
export const PACKED_NO_COLOR = -2;
/** "no per-row opacity" marker in `opacity` (0-100 are real values). */
export const PACKED_NO_OPACITY = 255;

export interface PackedNames {
  /** every name lowercased + trimmed, UTF-8, back to back */
  bytes: Uint8Array;
  /** `count + 1` byte offsets into `bytes` */
  offsets: Uint32Array;
  /** per name: packed RGBA8 (unsigned, so a Float64 lane — an Int32 lane
   *  would sign-flip every alpha-255 color), COLOR_DEFAULT, or PACKED_NO_COLOR */
  colors: Float64Array;
  /** per name: 0-100, or PACKED_NO_OPACITY */
  opacity: Uint8Array;
  count: number;
}

const INITIAL_NAMES = 1024;
const INITIAL_BYTES = 64 * 1024;

/** Append-only builder; `finish()` trims the buffers to what was written. */
export class PackedNamesBuilder {
  private bytes = new Uint8Array(INITIAL_BYTES);
  private offsets = new Uint32Array(INITIAL_NAMES + 1);
  private colors = new Float64Array(INITIAL_NAMES);
  private opacity = new Uint8Array(INITIAL_NAMES).fill(PACKED_NO_OPACITY);
  private used = 0;
  private n = 0;
  private readonly encoder = new TextEncoder();

  get count(): number {
    return this.n;
  }

  /** Add one name (lowercased + trimmed here; blank names are skipped). */
  push(name: string, color: number = PACKED_NO_COLOR, opacity: number = PACKED_NO_OPACITY): void {
    const key = name.trim().toLowerCase();
    if (!key) {
      return;
    }
    if (this.n + 1 >= this.offsets.length) {
      this.growNames();
    }
    this.ensureBytes(key.length * 3); // worst case 3 bytes per UTF-16 unit
    const { written } = this.encoder.encodeInto(key, this.bytes.subarray(this.used));
    this.used += written;
    this.colors[this.n] = color;
    this.opacity[this.n] = opacity;
    this.n++;
    this.offsets[this.n] = this.used;
  }

  /** Add a name straight from an ASCII byte range — the caller has checked
   *  there is no byte >= 0x80, so lowercasing is the +0x20 shift and no JS
   *  string is created. The bytes must already be trimmed. */
  pushAsciiBytes(
    src: Uint8Array,
    start: number,
    end: number,
    color: number = PACKED_NO_COLOR,
    opacity: number = PACKED_NO_OPACITY,
  ): void {
    const len = end - start;
    if (len <= 0) {
      return;
    }
    if (this.n + 1 >= this.offsets.length) {
      this.growNames();
    }
    this.ensureBytes(len);
    for (let i = 0; i < len; i++) {
      const c = src[start + i];
      this.bytes[this.used + i] = c >= 0x41 && c <= 0x5a ? c + 0x20 : c;
    }
    this.used += len;
    this.colors[this.n] = color;
    this.opacity[this.n] = opacity;
    this.n++;
    this.offsets[this.n] = this.used;
  }

  /** Add a `name` + optional color token (`yellow`, `#ff0000:50`, `default`)
   *  the way a two-column Multi paste reads it. An unparseable token counts
   *  as no color. */
  pushWithToken(name: string, token: string | null | undefined): void {
    const parsed = token ? parseColorToken(token) : null;
    if (!parsed) {
      this.push(name);
      return;
    }
    this.push(name, parsed.color, parsed.opacity ?? PACKED_NO_OPACITY);
  }

  finish(): PackedNames {
    return {
      bytes: this.bytes.slice(0, this.used),
      offsets: this.offsets.slice(0, this.n + 1),
      colors: this.colors.slice(0, this.n),
      opacity: this.opacity.slice(0, this.n),
      count: this.n,
    };
  }

  private ensureBytes(extra: number): void {
    while (this.used + extra > this.bytes.length) {
      const next = new Uint8Array(this.bytes.length * 2);
      next.set(this.bytes.subarray(0, this.used));
      this.bytes = next;
    }
  }

  private growNames(): void {
    const cap = this.offsets.length * 2;
    const offsets = new Uint32Array(cap + 1);
    offsets.set(this.offsets);
    const colors = new Float64Array(cap);
    colors.set(this.colors);
    const opacity = new Uint8Array(cap).fill(PACKED_NO_OPACITY);
    opacity.set(this.opacity);
    this.offsets = offsets;
    this.colors = colors;
    this.opacity = opacity;
  }
}

/** The buffers to hand to postMessage / Comlink.transfer (zero-copy). */
export function packedTransferables(p: PackedNames): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  for (const a of [p.bytes, p.offsets, p.colors, p.opacity]) {
    if (a.buffer instanceof ArrayBuffer && !out.includes(a.buffer)) {
      out.push(a.buffer);
    }
  }
  return out;
}

/** Name `i`, decoded on demand (already lowercased). */
export function packedName(p: PackedNames, i: number, decoder: TextDecoder): string {
  return decoder.decode(p.bytes.subarray(p.offsets[i], p.offsets[i + 1]));
}

/** Build from newline `name[<sep>color[:opacity]]` lines — the Multi paste
 *  grammar. Kept for tests and parity with parseMultiColumn. */
export function packedFromLines(value: string): PackedNames {
  const b = new PackedNamesBuilder();
  for (const raw of value.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      continue;
    }
    const m = line.match(/^(.*?)[\t, ]+([^\t, ]+)$/);
    if (m?.[1].trim() && parseColorToken(m[2])) {
      b.pushWithToken(m[1], m[2]);
    } else {
      b.push(line);
    }
  }
  return b.finish();
}

// -----------------------------------------------------------------------------
// byte-level list parsing (the host API's binary name list)
// -----------------------------------------------------------------------------

const LF = 0x0a;
const CR = 0x0d;
const TAB = 0x09;
const SPACE = 0x20;
const COMMA = 0x2c;

const isBlank = (c: number): boolean => c === SPACE || c === TAB || c === CR;
const isSep = (c: number): boolean => c === SPACE || c === TAB || c === COMMA;

/**
 * `packedFromLines` read straight from UTF-8 BYTES — the form a host sends a
 * large name list in. A line's name is copied byte for byte (lowercased in
 * place) instead of becoming a JS string, so a multi-million-name list costs
 * no per-row allocation on the way in; only a line containing non-ASCII falls
 * back to decode + push(), which case-folds the way the rest of the app does.
 * Grammar is the Multi paste's: `fullname` or `fullname<sep>color[:opacity]`,
 * one per line, blank lines skipped.
 */
export function packedFromBytes(src: Uint8Array): PackedNames {
  const b = new PackedNamesBuilder();
  const decoder = new TextDecoder();
  const n = src.length;
  let i = 0;
  while (i < n) {
    let end = i;
    while (end < n && src[end] !== LF) {
      end++;
    }
    let s = i;
    let e = end;
    while (s < e && isBlank(src[s])) {
      s++;
    }
    while (e > s && isBlank(src[e - 1])) {
      e--;
    }
    if (s < e) {
      pushLine(b, src, s, e, decoder);
    }
    i = end + 1;
  }
  return b.finish();
}

/** One trimmed line: split off a trailing color token when it parses (and
 *  something is left in front of it), then append the name. */
function pushLine(b: PackedNamesBuilder, src: Uint8Array, start: number, end: number, decoder: TextDecoder): void {
  let nameEnd = end;
  let color = PACKED_NO_COLOR;
  let opacity = PACKED_NO_OPACITY;
  let sep = end;
  while (sep > start && !isSep(src[sep - 1])) {
    sep--;
  }
  if (sep > start) {
    const parsed = parseColorToken(decoder.decode(src.subarray(sep, end)));
    let head = sep - 1;
    while (head > start && isSep(src[head - 1])) {
      head--;
    }
    if (parsed && head > start) {
      nameEnd = head;
      color = parsed.color;
      opacity = parsed.opacity ?? PACKED_NO_OPACITY;
    }
  }
  let ascii = true;
  for (let k = start; k < nameEnd; k++) {
    if (src[k] >= 0x80) {
      ascii = false;
      break;
    }
  }
  if (ascii) {
    b.pushAsciiBytes(src, start, nameEnd, color, opacity);
    return;
  }
  b.push(decoder.decode(src.subarray(start, nameEnd)), color, opacity);
}

export { COLOR_DEFAULT };
