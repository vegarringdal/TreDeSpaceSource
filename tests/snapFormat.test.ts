import { describe, expect, it } from 'vitest';
import {
  encodeBlock,
  parseBlockBody,
  parseBlockHeader,
  parseFileHeader,
  SNAP_FILE_HEADER_SIZE,
  SNAP_VERSION,
  writeFileHeader,
} from '../src/lib/snapshot/snapshotFormat';

const HEADER = parseFileHeader(new DataView(writeFileHeader(0).buffer));

function block(group: string, name: string, store: string): Uint8Array {
  const groups = new Uint32Array([0b1, 0x11223344, 0xffffffff, 2]);
  const hashes = new Uint32Array([1, 2, 3, 4]);
  return encodeBlock(group, name, store, new Float32Array(0), groups, hashes);
}

describe('snapshot format v2 (store per block)', () => {
  it('writes the current version', () => {
    const dv = new DataView(writeFileHeader(0).buffer);
    expect(dv.getUint32(4, true)).toBe(SNAP_VERSION);
    expect(SNAP_FILE_HEADER_SIZE).toBe(24);
  });

  it('round-trips group/name/store through encode → parse', () => {
    const bytes = block('Area/Sub', 'ModelHuldra.rvm', 'asp2');
    const bh = parseBlockHeader(new DataView(bytes.buffer), HEADER);
    expect(bh.storeLen).toBe(4);
    expect(bh.blockByteLength).toBe(bytes.length);
    const body = parseBlockBody(bytes, HEADER);
    expect(body.group).toBe('Area/Sub');
    expect(body.name).toBe('ModelHuldra.rvm');
    expect(body.store).toBe('asp2');
    expect(body.hashCount).toBe(2);
  });

  it('reads a v1 file: reserved word doubles as storeLen 0 → store empty', () => {
    // a v1 block is byte-identical to a v2 block with an empty store
    const bytes = block('g', 'n.rvm', '');
    const v1Header = writeFileHeader(0);
    new DataView(v1Header.buffer).setUint32(4, 1, true);
    const header = parseFileHeader(new DataView(v1Header.buffer));
    const bh = parseBlockHeader(new DataView(bytes.buffer), header);
    expect(bh.storeLen).toBe(0);
    const body = parseBlockBody(bytes, header);
    expect(body.store).toBe('');
    expect(body.name).toBe('n.rvm');
  });

  it('rejects versions newer than the reader', () => {
    const h = writeFileHeader(0);
    new DataView(h.buffer).setUint32(4, SNAP_VERSION + 1, true);
    expect(() => parseFileHeader(new DataView(h.buffer))).toThrow(/unsupported snapshot version/);
  });
});
