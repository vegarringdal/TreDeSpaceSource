// Minimal ZIP writer: STORED (uncompressed) entries only, no data descriptors,
// no ZIP64 — enough for an .xlsx container without a dependency. Sizes stay
// under 4 GB and entry counts under 65,535, which a query export never
// approaches. Pure, so it is unit-tested without a browser.

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

/** Pack the entries into one STORED zip archive: every local header + data,
 *  then the central directory, then the end record. */
export function zipStored(entries: readonly ZipEntry[], modified = new Date()): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const names = entries.map((e) => enc.encode(e.name));
  const crcs = entries.map((e) => crc32(e.data));
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
    u16(METHOD_STORED);
    u16(time);
    u16(date);
    u32(crcs[i]);
    u32(e.data.length);
    u32(e.data.length);
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
    u16(METHOD_STORED);
    u16(time);
    u16(date);
    u32(crcs[i]);
    u32(e.data.length);
    u32(e.data.length);
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
