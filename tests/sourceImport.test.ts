// Converted-source imports (state/assets/sourceImport.ts): format detection,
// the per-format default store, the "already imported" lookup by source MD5,
// and the chunked file hash against node's MD5.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AssetEntry } from '../src/state/assets/assets.state';
import {
  assetsFromSource,
  defaultFormatStore,
  describePlaces,
  formatStoreOf,
  hashFile,
  isQuickFormat,
  quickFingerprint,
  type SourceFormat,
  sourceFormatOf,
  storeFormatOf,
} from '../src/state/assets/sourceImport';

const asset = (over: Partial<AssetEntry>): AssetEntry => ({
  id: 'a',
  store: 'rvm-files',
  name: 'n',
  folder: '',
  fileName: 'n.tdp',
  size: 1,
  importedAt: 0,
  ...over,
});

describe('source formats', () => {
  it('maps extensions to formats, case-insensitively, and leaves cooked files alone', () => {
    expect(sourceFormatOf('Plant.RVM')).toBe('rvm');
    expect(sourceFormatOf('part.stp')).toBe('step');
    expect(sourceFormatOf('part.step')).toBe('step');
    expect(sourceFormatOf('house.ifc')).toBe('ifc');
    expect(sourceFormatOf('model.nwc')).toBe('nwd');
    expect(sourceFormatOf('scan.e57')).toBe('e57');
    expect(sourceFormatOf('scan.lgsx')).toBe('lgsx');
    expect(sourceFormatOf('scan.tdpp')).toBeNull();
    expect(sourceFormatOf('model.glb')).toBeNull();
    expect(sourceFormatOf('noextension')).toBeNull();
  });

  it('gives every importable file a store format, cooked and GLB files included', () => {
    expect(storeFormatOf('Model.GLB')).toBe('glb');
    expect(storeFormatOf('cooked.tdp')).toBe('tdp');
    expect(storeFormatOf('scan.tdpp')).toBe('tdpp');
    expect(storeFormatOf('Plant.rvm')).toBe('rvm');
    expect(storeFormatOf('notes.txt')).toBeNull();
    expect(defaultFormatStore('glb')).toBe('glb-files');
    expect(formatStoreOf({ tdp: 'project-a' }, 'tdp')).toBe('project-a');
    expect(formatStoreOf({}, 'tdpp')).toBe('tdpp-files');
  });

  it('defaults each format to its own "<format>-files" store unless one is picked', () => {
    expect(defaultFormatStore('lgsx')).toBe('lgsx-files');
    expect(formatStoreOf({}, 'rvm')).toBe('rvm-files');
    expect(formatStoreOf({ rvm: 'project-a' }, 'rvm')).toBe('project-a');
    expect(formatStoreOf({ rvm: '' }, 'rvm')).toBe('rvm-files'); // cleared pick
    expect(formatStoreOf({ rvm: 'project-a' }, 'ifc')).toBe('ifc-files');
  });
});

describe('already-imported lookup', () => {
  const assets = [
    asset({ id: '1', sourceMd5: 'aaa', folder: 'plant.rvm' }),
    asset({ id: '2', sourceMd5: 'aaa', folder: 'plant.rvm' }),
    asset({ id: '3', sourceMd5: 'aaa', store: 'temp', temp: true }),
    asset({ id: '4', sourceMd5: 'bbb', store: 'main' }),
    asset({ id: '5' }),
  ];

  it('finds the kept assets converted from the same source, never temp ones', () => {
    expect(assetsFromSource(assets, { sourceMd5: 'aaa' }).map((a) => a.id)).toEqual(['1', '2']);
    expect(assetsFromSource(assets, { sourceMd5: 'ccc' })).toEqual([]);
  });

  it('matches on the quick fingerprint unless both sides have a full MD5 that says otherwise', () => {
    const scans = [
      asset({ id: 'q', sourceQuick: 'q1' }),
      asset({ id: 'both', sourceQuick: 'q1', sourceMd5: 'full-a' }),
      asset({ id: 'other', sourceQuick: 'q2', sourceMd5: 'full-b' }),
      asset({ id: 'temp', sourceQuick: 'q1', temp: true }),
    ];
    // checked quickly now: everything with the same ends
    expect(assetsFromSource(scans, { sourceQuick: 'q1' }).map((a) => a.id)).toEqual(['q', 'both']);
    // checked in full now: the full MD5 decides where the asset has one too
    expect(assetsFromSource(scans, { sourceQuick: 'q1', sourceMd5: 'full-a' }).map((a) => a.id)).toEqual(['q', 'both']);
    expect(assetsFromSource(scans, { sourceQuick: 'q1', sourceMd5: 'full-x' }).map((a) => a.id)).toEqual(['q']);
    expect(assetsFromSource(scans, {})).toEqual([]);
  });

  it('names each distinct place once', () => {
    expect(describePlaces(assetsFromSource(assets, { sourceMd5: 'aaa' }))).toBe('rvm-files / plant.rvm');
    expect(describePlaces([assets[0], assets[3]])).toBe('rvm-files / plant.rvm, main');
  });
});

describe('hashFile', () => {
  it('matches MD5 over a file spanning several chunks and reports progress to 1', async () => {
    const bytes = new Uint8Array(33 * 1024 * 1024 + 7);
    for (let i = 0; i < bytes.length; i += 4099) {
      bytes[i] = i & 255;
    }
    const steps: number[] = [];
    const got = await hashFile(new Blob([bytes]), (f) => steps.push(f));
    expect(got).toBe(createHash('md5').update(bytes).digest('hex'));
    expect(steps.length).toBe(3);
    expect(steps[steps.length - 1]).toBe(1);
    expect(await hashFile(new Blob([]))).toBe(createHash('md5').update('').digest('hex'));
  });
});

describe('quickFingerprint', () => {
  const QUICK = 4 * 1024 * 1024;
  const fill = (n: number, seed: number) => {
    const b = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      b[i] = (i * 31 + seed) & 0xff;
    }
    return b;
  };

  it('is used for the big binary formats only', () => {
    const quick: SourceFormat[] = ['nwd', 'e57', 'lgsx'];
    const whole: SourceFormat[] = ['rvm', 'step', 'ifc'];
    expect(quick.every(isQuickFormat)).toBe(true);
    expect(whole.some(isQuickFormat)).toBe(false);
  });

  it('sees a change in the size or in either end, not one in the middle of a large file', async () => {
    const big = fill(3 * QUICK, 1);
    const base = await quickFingerprint(new Blob([big]));
    expect(await quickFingerprint(new Blob([big]))).toBe(base);

    const head = big.slice();
    head[10] ^= 1;
    const tail = big.slice();
    tail[big.length - 10] ^= 1;
    const middle = big.slice();
    middle[QUICK + 100] ^= 1;
    expect(await quickFingerprint(new Blob([head]))).not.toBe(base);
    expect(await quickFingerprint(new Blob([tail]))).not.toBe(base);
    expect(await quickFingerprint(new Blob([big.slice(0, big.length - 1)]))).not.toBe(base);
    expect(await quickFingerprint(new Blob([middle]))).toBe(base);
  });

  it('covers a small file whole', async () => {
    const small = fill(1000, 7);
    const changed = small.slice();
    changed[500] ^= 1;
    expect(await quickFingerprint(new Blob([changed]))).not.toBe(await quickFingerprint(new Blob([small])));
  });
});
