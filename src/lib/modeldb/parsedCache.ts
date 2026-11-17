// A small LRU of parsed model variants, keyed by their OPFS path. Residency
// repacks the same zone again and again as the camera moves (every mixed
// repack re-centres the sharp region), and each repack used to decode both
// variants' meshopt streams from scratch. An entry is valid only while the
// file's size and mtime still match, so a re-import under the same id never
// serves the old parse. Byte-capped: the decoded arrays of a big zone are
// hundreds of MB, so this holds the few zones around the camera, not the scene.
import type { ParsedModel } from '../model/format';

export const PARSED_CACHE_BYTES = 256 << 20;
export const PARSED_CACHE_ENTRIES = 4;

interface Entry {
  key: string;
  size: number;
  mtime: number;
  /** The model slot the parse belongs to — dropped with the model. */
  owner: number;
  bytes: number;
  parsed: ParsedModel;
}

function bytesOfTables(obj: object): number {
  let n = 0;
  for (const v of Object.values(obj)) {
    if (ArrayBuffer.isView(v)) {
      n += v.byteLength;
    }
  }
  return n;
}

/** Decoded footprint of a parse: every typed array / DataView it holds. */
export function parsedBytes(p: ParsedModel): number {
  let n = bytesOfTables(p) + bytesOfTables(p.hierarchy);
  for (const cg of p.colorGroups) {
    n += bytesOfTables(cg);
  }
  if (p.cells) {
    n += bytesOfTables(p.cells);
  }
  return n;
}

export class ParsedLru {
  /** Least recently used first. */
  private entries: Entry[] = [];
  private total = 0;
  private readonly maxBytes: number;
  private readonly maxEntries: number;

  constructor(maxBytes = PARSED_CACHE_BYTES, maxEntries = PARSED_CACHE_ENTRIES) {
    this.maxBytes = maxBytes;
    this.maxEntries = maxEntries;
  }

  /** The cached parse of `key` when the file still has this size and mtime;
   *  a stale entry is dropped on the way. A hit becomes most recently used. */
  get(key: string, size: number, mtime: number): ParsedModel | null {
    const i = this.entries.findIndex((e) => e.key === key);
    if (i < 0) {
      return null;
    }
    const [e] = this.entries.splice(i, 1);
    if (e.size !== size || e.mtime !== mtime) {
      this.total -= e.bytes;
      return null;
    }
    this.entries.push(e);
    return e.parsed;
  }

  /** Remember a parse; evicts least recently used entries until it fits. A
   *  parse bigger than the whole cache is not kept. */
  put(key: string, size: number, mtime: number, owner: number, parsed: ParsedModel): void {
    const bytes = parsedBytes(parsed);
    this.drop((e) => e.key === key);
    if (bytes > this.maxBytes) {
      return;
    }
    while (this.entries.length > 0 && (this.total + bytes > this.maxBytes || this.entries.length >= this.maxEntries)) {
      const victim = this.entries.shift()!;
      this.total -= victim.bytes;
    }
    this.entries.push({ key, size, mtime, owner, bytes, parsed });
    this.total += bytes;
  }

  /** Drop every parse that belongs to a model slot (explicit unload). */
  forgetOwner(owner: number): void {
    this.drop((e) => e.owner === owner);
  }

  clear(): void {
    this.entries = [];
    this.total = 0;
  }

  get totalBytes(): number {
    return this.total;
  }

  get size(): number {
    return this.entries.length;
  }

  private drop(pred: (e: Entry) => boolean): void {
    this.entries = this.entries.filter((e) => {
      if (pred(e)) {
        this.total -= e.bytes;
        return false;
      }
      return true;
    });
  }
}

export const parsedCache = new ParsedLru();
