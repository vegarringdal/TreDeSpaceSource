// Import formats: which store an Import Manager import of each lands in by
// default (`rvm-files`, `glb-files` …), and — for the converted source
// formats (RVM, STEP, IFC, Navisworks, E57, LGSX) — the source fingerprint
// that lets the Import Manager warn before converting the same file twice.
// Pure helpers — the state lives in assets.state.ts, the flow in
// assets.actions.ts.
import { Md5 } from '../../lib/md5';
import type { AssetEntry } from './assets.state';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type SourceFormat = 'rvm' | 'step' | 'ifc' | 'nwd' | 'e57' | 'lgsx';
/** Every format with a default store: the converted ones plus the files
 *  imported as they are or through the GLB cook. */
export type StoreFormat = SourceFormat | 'glb' | 'tdp' | 'tdpp';

/** What identifies a converted source file — either or both. */
export interface SourceFingerprint {
  /** MD5 of the whole file. */
  readonly sourceMd5?: string;
  /** MD5 of the file's size, its first and its last QUICK_BYTES. */
  readonly sourceQuick?: string;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** File extension → format (`.stp` is STEP, `.nwc` is Navisworks). */
const EXTENSIONS: Readonly<Record<string, SourceFormat>> = {
  rvm: 'rvm',
  step: 'step',
  stp: 'step',
  ifc: 'ifc',
  nwd: 'nwd',
  nwc: 'nwd',
  e57: 'e57',
  lgsx: 'lgsx',
};
const HASH_CHUNK_BYTES = 16 * 1024 * 1024;
/** Bytes of each end of a file that go into the quick fingerprint. */
const QUICK_BYTES = 4 * 1024 * 1024;
/** Formats checked by the quick fingerprint unless the full one is asked for:
 *  binary containers that run to many GB, where a change shows in the size or
 *  the ends (header, index, trailer). The text formats — RVM, STEP, IFC — can
 *  change a digit in the middle at the same length, so they are always
 *  hashed whole. */
const QUICK_FORMATS: ReadonlySet<SourceFormat> = new Set<SourceFormat>(['nwd', 'e57', 'lgsx']);

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

/** The converted format a file name belongs to, or null (GLB, .tdp, .tdpp …). */
export function sourceFormatOf(fileName: string): SourceFormat | null {
  const ext = /\.([a-z0-9]+)$/i.exec(fileName)?.[1].toLowerCase() ?? '';
  return EXTENSIONS[ext] ?? null;
}

/** The format whose store a file imports into, or null (not an importable file). */
export function storeFormatOf(fileName: string): StoreFormat | null {
  const ext = /\.([a-z0-9]+)$/i.exec(fileName)?.[1].toLowerCase() ?? '';
  return ext === 'glb' || ext === 'tdp' || ext === 'tdpp' ? ext : sourceFormatOf(fileName);
}

/** The store a format imports into unless the user picked another one. */
export function defaultFormatStore(format: StoreFormat): string {
  return `${format}-files`;
}

/** The store imports of `format` go to: the user's pick, else the default. */
export function formatStoreOf(picks: Partial<Record<StoreFormat, string>>, format: StoreFormat): string {
  return picks[format] || defaultFormatStore(format);
}

/** Whether a format is checked by the quick fingerprint by default. */
export function isQuickFormat(format: SourceFormat): boolean {
  return QUICK_FORMATS.has(format);
}

/**
 * Kept (non-temp) assets converted from a source with this fingerprint. The
 * full MD5 decides wherever both sides have one; the quick fingerprint stands
 * in where one side has no full MD5 (the source was only checked quickly then,
 * or now).
 */
export function assetsFromSource(assets: readonly AssetEntry[], fp: SourceFingerprint): AssetEntry[] {
  return assets.filter((a) => {
    if (a.temp) {
      return false;
    }
    if (fp.sourceMd5 !== undefined && a.sourceMd5 !== undefined) {
      return a.sourceMd5 === fp.sourceMd5;
    }
    return fp.sourceQuick !== undefined && a.sourceQuick === fp.sourceQuick;
  });
}

/** Where the assets of an earlier import live, for the duplicate question:
 *  `store / folder` per distinct place. */
export function describePlaces(assets: readonly AssetEntry[]): string {
  const places = new Set(assets.map((a) => (a.folder ? `${a.store} / ${a.folder}` : a.store)));
  return [...places].join(', ');
}

/** Full MD5 of a file, read in chunks (constant memory — scans are many GB).
 *  `onProgress` gets 0..1 after each chunk. */
export async function hashFile(file: Blob, onProgress?: (fraction: number) => void): Promise<string> {
  const md5 = new Md5();
  for (let at = 0; at < file.size; at += HASH_CHUNK_BYTES) {
    md5.update(new Uint8Array(await file.slice(at, at + HASH_CHUNK_BYTES).arrayBuffer()));
    onProgress?.(Math.min(1, (at + HASH_CHUNK_BYTES) / file.size));
  }
  return md5.hex();
}

/**
 * Quick fingerprint of a file: MD5 of its size and its two ends. Reads at
 * most 2 × QUICK_BYTES, so it is instant on a file of any size; a file no
 * larger than that goes in whole.
 */
export async function quickFingerprint(file: Blob): Promise<string> {
  const md5 = new Md5();
  md5.update(new TextEncoder().encode(`${file.size}:`));
  if (file.size <= 2 * QUICK_BYTES) {
    md5.update(new Uint8Array(await file.arrayBuffer()));
    return md5.hex();
  }
  md5.update(new Uint8Array(await file.slice(0, QUICK_BYTES).arrayBuffer()));
  md5.update(new Uint8Array(await file.slice(file.size - QUICK_BYTES).arrayBuffer()));
  return md5.hex();
}
