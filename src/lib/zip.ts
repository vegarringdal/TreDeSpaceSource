// Minimal ZIP writer: STORED or DEFLATED entries, no data descriptors, no
// ZIP64 — enough for an .xlsx container without a dependency. Sizes stay under
// 4 GB and entry counts under 65,535, which a query export never approaches.
// `zipStored` is pure, so it is unit-tested without a browser; `zipDeflated`
// adds compression through the platform's `CompressionStream`, which is the
// only part that needs a browser (it falls back to STORED without one).

export interface ZipEntry {
  /** Forward-slash path inside the archive, e.g. `xl/workbook.xml`. */
  name: string;
  data: Uint8Array;
}

const LOCAL_HEADER_SIG = 0x04034b50;
const CENTRAL_HEADER_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const LOCAL_HEADER_LEN = 30;
const CENTRAL_HEADER_LEN = 46;
const EOCD_LEN = 22;
/** "Version needed / made by" 2.0 — plain STORED entries. */
const ZIP_VERSION = 20;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;
/** "Version needed" 2.0 covers deflate too. */
/** General-purpose flag bit 11: entry names are UTF-8. */
const FLAG_UTF8 = 0x0800;
const CRC_POLY = 0xedb88320;
const DOS_EPOCH_YEAR = 1980;

const CRC_TABLE = buildCrcTable();

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? CRC_POLY ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

/** CRC-32 (IEEE, the ZIP flavour) of the bytes. */
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** The MS-DOS date + time pair ZIP headers carry (2-second resolution; years
 *  before 1980 clamp to the DOS epoch). */
function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(DOS_EPOCH_YEAR, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - DOS_EPOCH_YEAR) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** One entry ready to be written: its stored bytes plus what the headers need
 *  to describe them. */
interface PackedEntry {
  name: string;
  method: number;
  crc: number;
  rawSize: number;
  data: Uint8Array;
}

/** Pack the entries into one STORED zip archive: every local header + data,
 *  then the central directory, then the end record. */
export function zipStored(entries: readonly ZipEntry[], modified = new Date()): Uint8Array<ArrayBuffer> {
  return assemble(
    entries.map((e) => ({
      name: e.name,
      method: METHOD_STORED,
      crc: crc32(e.data),
      rawSize: e.data.length,
      data: e.data,
    })),
    modified,
  );
}

/**
 * A source whose bytes arrive in pieces — so a big part (a spreadsheet's sheet
 * XML) is never held whole before it is compressed.
 */
export interface ZipSource {
  name: string;
  chunks: () => AsyncIterable<Uint8Array<ArrayBuffer>> | Iterable<Uint8Array<ArrayBuffer>>;
}

/** True when this runtime can deflate (every browser we target; not node's
 *  test runner unless it has the web streams API). */
function canDeflate(): boolean {
  return typeof CompressionStream === 'function';
}

/** Run `chunks` through deflate-raw, returning the compressed bytes, the CRC
 *  of the RAW bytes and the raw length — all computed in one pass. */
async function deflateChunks(
  chunks: AsyncIterable<Uint8Array<ArrayBuffer>> | Iterable<Uint8Array<ArrayBuffer>>,
): Promise<{ crc: number; rawSize: number; parts: Uint8Array[]; rawParts: Uint8Array<ArrayBuffer>[] }> {
  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  const parts: Uint8Array[] = [];
  const rawParts: Uint8Array<ArrayBuffer>[] = [];
  let crc = 0xffffffff;
  let rawSize = 0;

  // drain the compressed side concurrently, or a big input deadlocks on the
  // stream's backpressure
  const drain = (async () => {
    const reader = cs.readable.getReader();
    for (let r = await reader.read(); !r.done; r = await reader.read()) {
      parts.push(r.value);
    }
  })();

  for await (const chunk of chunks) {
    rawParts.push(chunk);
    rawSize += chunk.length;
    for (let i = 0; i < chunk.length; i++) {
      crc = CRC_TABLE[(crc ^ chunk[i]) & 0xff] ^ (crc >>> 8);
    }
    await writer.write(chunk);
  }
  await writer.close();
  await drain;
  return { crc: (crc ^ 0xffffffff) >>> 0, rawSize, parts, rawParts };
}

function concat(parts: readonly Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * Pack the sources into one DEFLATED zip archive. Each source is streamed
 * through the platform deflater, so the caller can hand over a multi-megabyte
 * part in pieces instead of building it as one string. An entry falls back to
 * STORED when deflate is unavailable or did not actually shrink it.
 */
export async function zipDeflated(
  sources: readonly ZipSource[],
  modified = new Date(),
): Promise<Uint8Array<ArrayBuffer>> {
  const packed: PackedEntry[] = [];
  for (const src of sources) {
    if (!canDeflate()) {
      const rawParts: Uint8Array<ArrayBuffer>[] = [];
      let rawSize = 0;
      for await (const chunk of src.chunks()) {
        rawParts.push(chunk);
        rawSize += chunk.length;
      }
      const data = concat(rawParts, rawSize);
      packed.push({ name: src.name, method: METHOD_STORED, crc: crc32(data), rawSize, data });
      continue;
    }
    const { crc, rawSize, parts, rawParts } = await deflateChunks(src.chunks());
    const compressedSize = parts.reduce((n, p) => n + p.length, 0);
    if (compressedSize < rawSize) {
      packed.push({ name: src.name, method: METHOD_DEFLATE, crc, rawSize, data: concat(parts, compressedSize) });
    } else {
      packed.push({ name: src.name, method: METHOD_STORED, crc, rawSize, data: concat(rawParts, rawSize) });
    }
  }
  return assemble(packed, modified);
}

/** Write the local headers + data, the central directory and the end record. */
function assemble(entries: readonly PackedEntry[], modified: Date): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const names = entries.map((e) => enc.encode(e.name));
  const { time, date } = dosDateTime(modified);

  const localTotal = entries.reduce((n, e, i) => n + LOCAL_HEADER_LEN + names[i].length + e.data.length, 0);
  const centralTotal = entries.reduce((n, _e, i) => n + CENTRAL_HEADER_LEN + names[i].length, 0);
  const out = new Uint8Array(new ArrayBuffer(localTotal + centralTotal + EOCD_LEN));
  const view = new DataView(out.buffer);
  let pos = 0;
  const u16 = (v: number): void => {
    view.setUint16(pos, v, true);
    pos += 2;
  };
  const u32 = (v: number): void => {
    view.setUint32(pos, v >>> 0, true);
    pos += 4;
  };
  const bytes = (b: Uint8Array): void => {
    out.set(b, pos);
    pos += b.length;
  };

  const offsets: number[] = [];
  entries.forEach((e, i) => {
    offsets.push(pos);
    u32(LOCAL_HEADER_SIG);
    u16(ZIP_VERSION);
    u16(FLAG_UTF8);
    u16(e.method);
    u16(time);
    u16(date);
    u32(e.crc);
    u32(e.data.length);
    u32(e.rawSize);
    u16(names[i].length);
    u16(0); // extra field
    bytes(names[i]);
    bytes(e.data);
  });

  const centralStart = pos;
  entries.forEach((e, i) => {
    u32(CENTRAL_HEADER_SIG);
    u16(ZIP_VERSION);
    u16(ZIP_VERSION);
    u16(FLAG_UTF8);
    u16(e.method);
    u16(time);
    u16(date);
    u32(e.crc);
    u32(e.data.length);
    u32(e.rawSize);
    u16(names[i].length);
    u16(0); // extra field
    u16(0); // comment
    u16(0); // disk number start
    u16(0); // internal attributes
    u32(0); // external attributes
    u32(offsets[i]);
    bytes(names[i]);
  });
  const centralSize = pos - centralStart;

  u32(EOCD_SIG);
  u16(0); // this disk
  u16(0); // central directory disk
  u16(entries.length);
  u16(entries.length);
  u32(centralSize);
  u32(centralStart);
  u16(0); // comment
  return out;
}
