// Model assets — the user's imported library, stored in OPFS under
// model_assets/ (files as <store>/<id>.tdp + index.json metadata). Assets
// are grouped into "stores" (projects) which are REAL directories, shared with
// the SQL Assets panel (state/stores/). The folder tree INSIDE a store stays
// virtual (index.json), so renames and folder moves are pure metadata.
// v1 supports cooked merged (.tdp) files; glb/rvm/ifc/step arrive with the
// cooker.

import * as Comlink from 'comlink';
import { dialogs } from '../../components/dialogs/dialogs.actions';
import { consoleActions } from '../../components/panels/console/console.actions';
import {
  type CookStandardToOpfs,
  type CookToOpfs,
  type StoreTdpToOpfs,
  withCookerPool,
} from '../../lib/cooker/cookerPool';
import type { CookerApi } from '../../lib/cooker/cookerWorker';
import type { Ifc2GlbApi } from '../../lib/ifc2glb/ifc2glbWorker';
import type { Nwd2TdpApi } from '../../lib/nwd2tdp/nwd2tdpWorker';
import {
  clearDir,
  deleteFile,
  modelAssetsDir,
  modelStoreDir,
  readFile,
  readJson,
  rvmTempDir,
  stepTempDir,
  writeFile,
  writeJson,
} from '../../lib/opfs/opfs';
import type { Rvm2GlbApi } from '../../lib/rvm2glb/rvm2glbWorker';
import { storeScanFile } from '../../lib/scan2tdpp/cookScan';
import type { Step2GlbApi, StepProgress } from '../../lib/step2glb/step2glbWorker';
import { spawnComlinkWorker } from '../../lib/worker/spawnComlinkWorker';
import { scansActions } from '../scans/scans.actions';
import { scansState } from '../scans/scans.state';
import { storesActions } from '../stores/stores.actions';
import { MAIN_STORE, type StoreDef, storesState, TEMP_STORE } from '../stores/stores.state';
import { db } from '../viewer/db';
import { residency } from '../viewer/residency';
import { getRenderer, loadModelBytes, viewerActions } from '../viewer/viewer.actions';
import { viewerState } from '../viewer/viewer.state';
import { vramBudgetMb } from '../viewer/vramBudget';
import { readAssetBytes } from './assetBytes';
import {
  type AssetBounds,
  type AssetEntry,
  assetsState,
  groupOf,
  type IfcImportOptions,
  type NwdImportOptions,
  type RvmImportOptions,
  type ScanImportOptions,
  type StdGlbImportOptions,
  type StepImportOptions,
} from './assets.state';
import {
  assetsFromSource,
  describePlaces,
  formatStoreOf,
  hashFile,
  isQuickFormat,
  quickFingerprint,
  type SourceFingerprint,
  type SourceFormat,
  type StoreFormat,
  sourceFormatOf,
} from './sourceImport';
import { scanWorkerCap, workerPoolCap } from './workerPoolCap';

const INDEX = 'index.json';
/** Web Lock every import path takes — one import at a time, across tabs. */
const IMPORT_LOCK = 'asset-import';
/** Largest panorama level a scan cook keeps, px (an E57 face above it is dropped,
 *  not downscaled — the viewer downscales to ≤ 1536 itself). */
const PANO_MAX_PX = 4096;

/** A globally-unique asset id — the OPFS file name is `<id>.tdp`, so a
 *  collision would silently overwrite another asset. crypto.randomUUID gives
 *  122 bits of entropy (works in workers on a secure context, localhost incl.);
 *  the guard regenerates on the astronomically-unlikely clash with an existing
 *  id AND against ids handed out earlier in the SAME import batch (`pending`,
 *  not yet in state). */
function uid(pending?: Set<string>): string {
  const existing = new Set(assetsState.get().assets.map((a) => a.id));
  for (let i = 0; i < 5; i++) {
    const id = crypto.randomUUID();
    if (!existing.has(id) && !pending?.has(id)) {
      pending?.add(id);
      return id;
    }
  }
  // 5 UUIDv4 collisions is impossible in practice — throw rather than overwrite
  throw new Error('could not allocate a unique asset id');
}

async function persistIndex() {
  const dir = await modelAssetsDir();
  const s = assetsState.get();
  await writeJson(dir, INDEX, { assets: s.assets, extraFolders: s.extraFolders });
}

/** Resolve the effective import store (opts override → current importStore →
 *  main), guaranteeing the returned name is an existing store. */
function resolveStore(name?: string): string {
  const want = name ?? assetsState.get().importStore;
  return storesState.get().stores.some((st) => st.name === want) ? want : MAIN_STORE;
}

/** Delete the OPFS files of the given assets, each from its own store dir.
 *  Every deletion route funnels here — the coarse variant must go with the
 *  full file or it would leak (deleteFile swallows not-found). */
async function deleteAssetFiles(entries: AssetEntry[]) {
  for (const a of entries) {
    // an open scan reads its file by range — close it before the file goes
    if (a.kind === 'points') {
      scansActions.closeAsset(a.id);
    }
    const dir = await modelStoreDir(a.store);
    await deleteFile(dir, `${a.id}.tdp`);
    await deleteFile(dir, `${a.id}.coarse.tdp`);
    await deleteFile(dir, `${a.id}.tdpp`);
  }
}

/** Place a scan (offset and coordinate system): shown at once when it is
 *  loaded, saved with the asset either way. The library bounds follow when
 *  the scan is open (they are recomputed from the placed file). */
async function placeScanAsset(id: string, patch: Pick<AssetEntry, 'scanOffset' | 'scanCoordSystem'>) {
  const entry = assetsState.get().assets.find((a) => a.id === id);
  if (!entry) {
    return;
  }
  const next = { ...entry, ...patch };
  const full = scansActions.applyPlacement(id, {
    system: next.scanCoordSystem,
    offset: next.scanOffset ?? [0, 0, 0],
  });
  const placed: AssetEntry = full && next.bounds ? { ...next, bounds: { ...next.bounds, full } } : next;
  assetsState.set((s) => ({ assets: s.assets.map((a) => (a.id === id ? placed : a)) }));
  await persistIndex();
}

/** Offsets are kept to the millimetre. */
const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** An asset's identity for overwrite purposes: same store, same folder, same
 *  display name = the same thing, re-imported. A laser scan and a model are
 *  never the same thing — a scan named like a model in its store must not
 *  replace it. */
const identityKey = (a: { store: string; folder: string; name: string; kind?: AssetEntry['kind'] }) =>
  `${a.store}\0${a.folder}\0${a.name}${a.kind === 'points' ? '\0points' : ''}`;

/** Per-import overrides. The UI never sets these — overwrite is unconditional
 *  in the app, and loading follows the Import Manager checkbox — but the
 *  postMessage API passes both explicitly so a host is never surprised by a
 *  setting the user changed. */
export interface ImportBehaviour {
  /** Replace a pre-existing asset with the same store/folder/name (default). */
  replace?: boolean;
  /** Load what the import produced into the viewer. */
  load?: boolean;
  /** Session-only import: the asset (and its cooked file) is purged on the
   *  next app start. Default = the Import Manager "Temp" checkbox. */
  temp?: boolean;
  /** Host metadata stamped on every asset this import produces (a converter
   *  can yield several). Opaque to the viewer; returned by `assets.list`. */
  meta?: Record<string, unknown>;
  /** MD5 of the converted source file, stamped on every asset the import
   *  produces — what the Import Manager's "already imported" check compares. */
  sourceMd5?: string;
  /** The source's quick fingerprint (size and both ends), stamped likewise. */
  sourceQuick?: string;
  /** Drive NO app dialogs (no progress overlay, no error popup) — for callers
   *  that report progress themselves, e.g. a host driving `assets.importUrl`
   *  with a progress subscription. Console logging is unaffected. */
  quiet?: boolean;
}

/** Run after entries have landed in state: drop the assets the new ones
 *  replace, then optionally load the new ones. Deleting AFTER the import is
 *  deliberate — a failed import must never destroy the previous version.
 *  Returns how many were replaced in total, and per identity key — a batch
 *  import reports `replaced` per file, and only the key says which file's
 *  predecessor went. */
async function finishImport(
  before: AssetEntry[],
  added: AssetEntry[],
  opts: ImportBehaviour,
): Promise<{ replaced: number; byKey: Map<string, number> }> {
  const byKey = new Map<string, number>();
  if (added.length === 0) {
    return { replaced: 0, byKey };
  }
  const s = assetsState.get();
  let replaced = 0;
  // always on for the app's own imports: re-importing a file is an update,
  // and two assets with the same store/folder/name are indistinguishable
  if (opts.replace ?? true) {
    const newKeys = new Set(added.map(identityKey));
    const doomed = before.filter((a) => newKeys.has(identityKey(a)));
    if (doomed.length) {
      for (const a of doomed) {
        byKey.set(identityKey(a), (byKey.get(identityKey(a)) ?? 0) + 1);
      }
      await assetsActions.deleteByIds(doomed.map((a) => a.id));
      replaced = doomed.length;
    }
  }
  // temp imports ALWAYS load — viewing now is their whole point
  if (opts.load ?? (added.some((a) => a.temp) || s.loadAfterImport)) {
    await assetsActions.loadIds(added.map((a) => a.id));
  }
  return { replaced, byKey };
}

/**
 * The offset a re-imported scan takes over from the one it replaces (same
 * store, folder and name): the user is asked whether to keep it — a scan
 * converted again usually sits where the old one did, but a corrected source
 * may not. A quiet (host-driven) import keeps it without asking.
 */
async function keptScanOffset(
  replaced: AssetEntry | undefined,
  target: { name: string },
  quiet: boolean,
): Promise<[number, number, number] | undefined> {
  const old = replaced?.scanOffset;
  if (!old || old.every((v) => v === 0)) {
    return undefined;
  }
  if (quiet) {
    return old;
  }
  const keep = await dialogs.confirm(
    `${target.name} is being replaced. The scan it replaces is moved by an offset of X ${old[0]} m, Y ${old[1]} m, Z ${old[2]} m. Keep that offset for the new one?`,
    { title: 'Keep the scan offset?', okLabel: 'Keep offset', cancelLabel: 'Start at 0' },
  );
  return keep ? old : undefined;
}

/** Depth of import locks THIS tab holds across message dispatches — the
 *  postMessage batch import takes one for the whole batch (acquireImportLock).
 *  Web Locks are not reentrant, so an import action called from inside that
 *  batch must run inline instead of asking for a lock it already owns. */
let heldLocally = 0;

/** Import-phase progress overlay — silent for a `quiet` import, where the
 *  caller (a host driving assets.importUrl) reports progress itself. */
function phaseLoading(opts: ImportBehaviour, msg: string, title: string) {
  if (!opts.quiet) {
    dialogs.loading(msg, title);
  }
}

/** One line for the loading overlay per STEP phase (bytes, faces, products…). */
function describeStepProgress(p: StepProgress): string {
  const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
  switch (p.phase) {
    case 'index':
      return `Indexing ${pct}%`;
    case 'faces': {
      if (p.workers === 0) {
        return `Tessellating ${pct}%`;
      }
      const idle = p.busy < p.workers ? `, ${p.busy} busy` : '';
      return `Tessellating ${pct}% on ${p.workers} workers${idle}`;
    }
    case 'products':
      return `Merging instances ${pct}%`;
    case 'cook':
      return p.total > 1 ? `Cooking ${pct}%` : 'Cooking…';
    default:
      return 'Writing…';
  }
}

function phaseHideLoading(opts: ImportBehaviour) {
  if (!opts.quiet) {
    dialogs.hideLoading();
  }
}

/** One import at a time, across every import path AND every tab (Web Locks).
 *  Returns null (after logging) if another import already holds the lock.
 *  Inside a batch this tab owns, runs inline and lets errors propagate to the
 *  batch orchestrator (which reports them per file). */
async function withImportLock<T>(run: () => Promise<T>): Promise<T | null> {
  if (heldLocally > 0) {
    return await run();
  }
  return navigator.locks.request(IMPORT_LOCK, { ifAvailable: true }, async (lock) => {
    if (!lock) {
      consoleActions.log('error', 'Assets: another import is already running — try again when it finishes');
      dialogs.error('Another import is already running — try again when it finishes.', 'Import busy');
      return null;
    }
    // no silent failures: whatever escapes the import closes the progress
    // dialog and surfaces as an error dialog + console entry.
    // The overlay is HELD for the whole lock window: multi-phase imports
    // (convert → cook → load, or many RVM files in one batch) update the
    // overlay text instead of blinking it on every per-phase hide/show.
    dialogs.holdLoading();
    residency.pause(); // no VRAM-budget swaps while an import appends model slots
    try {
      return await run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      consoleActions.log('error', `Assets: import failed: ${msg}`);
      dialogs.error(msg, 'Import failed');
      return null;
    } finally {
      residency.resume();
      dialogs.releaseLoading();
      dialogs.hideLoading();
    }
  });
}

/** Acquire the cross-tab import lock and HOLD it until the returned release()
 *  resolves — for a multi-step import whose phases span several message
 *  dispatches (chunk upload). Returns null if another import already holds it
 *  (this tab or another). Shows no dialogs; the caller drives its own UI.
 *  release() awaits the lock actually clearing, so the next importer can take
 *  it without racing. */
export function acquireImportLock(): Promise<(() => Promise<void>) | null> {
  return new Promise((resolveOuter) => {
    let releaseHeld!: () => void;
    const held = new Promise<void>((r) => {
      releaseHeld = r;
    });
    let done: Promise<unknown> = Promise.resolve();
    done = navigator.locks
      .request(IMPORT_LOCK, { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolveOuter(null);
          return; // not held — nothing to await
        }
        heldLocally++;
        residency.pause(); // no VRAM-budget swaps while an import appends slots
        resolveOuter(async () => {
          releaseHeld();
          await done;
        });
        return held.finally(() => {
          heldLocally--;
          residency.resume();
        });
      })
      .catch(() => {
        /* request rejected — treat as not acquired */
      });
  });
}

/** A file to import: display name + a way to get its bytes. */
export interface ImportSource {
  name: string;
  bytes: () => Promise<ArrayBuffer>;
  /** Per-file folder override (RVM import: <import folder>/<parent path>). */
  folder?: string;
  /** Pre-cooked coarse variant, when the source is an already-cooked `.tdp`
   *  (the converters cook full + coarse in one pass). GLB sources cook their
   *  own coarse in the cooker worker instead. */
  coarseBytes?: () => Promise<ArrayBuffer>;
  /** Per-file metadata; falls back to the batch's `meta`. */
  meta?: Record<string, unknown>;
  /** This `.glb` is a STANDARD glTF (plain node tree / EXT_mesh_gpu_instancing),
   *  not a merged one — cook it with the generic TS cook on a pool worker.
   *  Default (false) takes the strict merged path, which rejects standard files. */
  standardGlb?: boolean;
  /** Per-file standard-GLB options; defaults to the Import Manager's settings.
   *  Only read when `standardGlb` is set. */
  stdOptions?: { normals?: boolean; edges?: boolean };
}

/** Rewrite every folder path under `oldPath` to live under `newPath`, within
 *  one store only (folders are per-store). */
function reprefixFolder(store: string, oldPath: string, newPath: string) {
  const map = (f: string) =>
    f === oldPath ? newPath : f.startsWith(`${oldPath}/`) ? newPath + f.slice(oldPath.length) : f;
  assetsState.set((s) => ({
    assets: s.assets.map((a) =>
      a.store !== store || map(a.folder) === a.folder ? a : { ...a, folder: map(a.folder) },
    ),
    extraFolders: { ...s.extraFolders, [store]: [...new Set((s.extraFolders[store] ?? []).map(map))] },
  }));
}

/** Read one asset from OPFS into the viewer — no dialog, no version bump.
 *  Exported for the postMessage API (assets.load). */
/** Load ids into the viewer with `concurrency`-way pooling (default: the
 *  Import Manager's load pool). Residency swaps are PAUSED for the batch — a
 *  VRAM-budget swap racing the model-slot appends fights for the same memory.
 *  The overlay ticks per file unless `quiet` (the caller reports progress
 *  itself), and `onDone` fires as each id lands. Returns the ids that loaded.
 *  Camera framing is deliberately NOT here: the panel and the postMessage API
 *  frame differently, so each does its own after this returns. */
export async function loadIdsPooled(
  ids: string[],
  opts: {
    concurrency?: number;
    quiet?: boolean;
    onDone?: (index: number, id: string, ok: boolean) => void;
  } = {},
): Promise<string[]> {
  const okIds: string[] = [];
  if (ids.length === 0) {
    return okIds;
  }
  const pool = Math.max(1, Math.min(workerPoolCap(), opts.concurrency ?? assetsState.get().loadPool));
  let done = 0;
  if (!opts.quiet) {
    dialogs.loading(`File 0 of ${ids.length}`, 'Loading assets');
  }
  residency.pause(); // no VRAM-budget swaps while the batch appends model slots
  try {
    // `pool` runners pull from a shared queue (same shape as importSources)
    const queue = ids.map((id, index) => ({ id, index }));
    await Promise.all(
      Array.from({ length: Math.min(pool, queue.length) }, async () => {
        for (let job = queue.shift(); job; job = queue.shift()) {
          const ok = await loadOne(job.id);
          if (ok) {
            okIds.push(job.id);
          }
          done++;
          if (!opts.quiet) {
            dialogs.loading(`File ${done} of ${ids.length}`, 'Loading assets');
          }
          opts.onDone?.(job.index, job.id, ok);
        }
      }),
    );
  } finally {
    residency.resume();
    if (!opts.quiet) {
      dialogs.hideLoading();
    }
  }
  return okIds;
}

/**
 * Make a just-opened scan's library entry say where it is drawn. The import
 * stamps the box of the coordinate system the file is in; a scan that took
 * over another system from the one it replaced is placed elsewhere (fitting
 * the camera to the stale box would frame empty space), and a taken-over
 * system the new file no longer lists is forgotten.
 */
async function syncScanPlacement(entry: AssetEntry) {
  const placed = scansActions.placed(entry.id);
  if (!placed) {
    return;
  }
  const old = entry.bounds?.full;
  const sameBox = old !== undefined && placed.bounds.every((v, k) => v === old[k]);
  const sameSystem = entry.scanCoordSystem === undefined || entry.scanCoordSystem === placed.system;
  if (sameBox && sameSystem) {
    return;
  }
  const { scanCoordSystem: _stale, ...rest } = entry;
  const next: AssetEntry = {
    ...(sameSystem ? entry : rest),
    bounds: { full: placed.bounds, dense: entry.bounds?.dense ?? null },
  };
  assetsState.set((s) => ({ assets: s.assets.map((a) => (a.id === entry.id ? next : a)) }));
  await persistIndex();
}

export async function loadAssetIntoViewer(id: string): Promise<boolean> {
  return loadOne(id);
}

async function loadOne(id: string): Promise<boolean> {
  const entry = assetsState.get().assets.find((a) => a.id === id);
  if (!entry) {
    return false;
  }
  if (entry.kind === 'points') {
    const res = await scansActions.openAsset(entry);
    if (res.error) {
      consoleActions.log('error', `Assets: failed to load ${entry.name}: ${res.error.msg}`);
      return false;
    }
    await syncScanPlacement(entry);
    return true;
  }
  try {
    // With a VRAM budget active, start from the COARSE variant — the scene
    // never overshoots the budget at load time, and the residency manager
    // promotes the nearest zones to full detail once the camera settles.
    const { bytes, variant } = await readAssetBytes(entry, vramBudgetMb(viewerState.get()) > 0);
    const loaded = await loadModelBytes(entry.name, bytes, groupOf(entry), {
      edges: entry.edges !== false,
      store: entry.store,
    });
    if (loaded !== null) {
      const r = getRenderer();
      if (r) {
        residency.register(entry, loaded.slot, r, variant, loaded.packDropped);
      }
      consoleActions.log('info', `Assets: loaded ${entry.name}${variant === 'coarse' ? ' (coarse)' : ''}`);
      return true;
    }
  } catch (e) {
    consoleActions.log('error', `Assets: failed to load ${entry.name}: ${e}`);
  }
  return false;
}

/**
 * Remove the output of scan conversions that never finished: a reload, a tab
 * crash or an out-of-memory during a multi-minute cook leaves a partial
 * `.tdpp` — often GBs — in the store with no library entry, so nothing in
 * the app could ever delete it. Every finished scan is in the index before
 * the next one starts, so a `.tdpp` the index does not know is such a
 * leftover — unless an import is running right now (this tab or another),
 * which the import lock tells: then nothing is touched. The index is read
 * again under the lock (another tab may have landed a scan since this one
 * read it), and a missing or unreadable index removes nothing.
 */
async function sweepUnfinishedScans(): Promise<void> {
  await navigator.locks.request(IMPORT_LOCK, { ifAvailable: true }, async (lock) => {
    if (!lock) {
      return;
    }
    const root = await modelAssetsDir();
    const idx = await readJson<StoredIndex>(root, INDEX);
    if (!idx?.assets) {
      return;
    }
    const known = new Set(idx.assets.map((a) => `${a.store || MAIN_STORE}/${a.id}.tdpp`));
    let removed = 0;
    for await (const [store, entry] of root.entries()) {
      if (entry.kind !== 'directory') {
        continue;
      }
      const dir = await root.getDirectoryHandle(store);
      const names: string[] = [];
      for await (const name of dir.keys()) {
        names.push(name);
      }
      for (const name of names) {
        if (name.endsWith('.tdpp') && !known.has(`${store}/${name}`)) {
          await deleteFile(dir, name);
          removed++;
        }
      }
    }
    if (removed > 0) {
      consoleActions.log('info', `Assets: removed ${removed} unfinished scan conversion(s) left by an earlier session`);
    }
  });
}

interface StoredIndex {
  /** Written by pre-0.0.19 saves; the registry lives in stores.json now and
   *  storesActions.init() seeds itself from this. */
  stores?: StoreDef[];
  assets?: (AssetEntry & { store?: string })[];
  // pre-store saves used a flat string[]; current saves use a per-store record
  extraFolders?: string[] | Record<string, string[]>;
}

/** What an Import Manager import of a converted source resolved to: its
 *  store and the fingerprint(s) taken of the file. */
interface PreparedSource extends SourceFingerprint {
  store: string;
}

/** Whether the user asked for a whole-file hash of this format (the formats
 *  without the option are always hashed whole). */
function wantsFullFingerprint(format: SourceFormat): boolean {
  if (!isQuickFormat(format)) {
    return true;
  }
  const s = assetsState.get();
  return format === 'nwd' ? s.nwd.fullFingerprint : s.scan.fullFingerprint;
}

/** Fingerprint a source file: the quick one for the formats that have it,
 *  the full MD5 (with a progress overlay — it reads every byte) when wanted. */
async function fingerprintSource(file: File, format: SourceFormat): Promise<SourceFingerprint> {
  const sourceQuick = isQuickFormat(format) ? await quickFingerprint(file) : undefined;
  if (!wantsFullFingerprint(format)) {
    return { sourceQuick };
  }
  const title = `${file.name} — checking the file`;
  dialogs.loading('0%', title);
  try {
    const sourceMd5 = await hashFile(file, (f) => dialogs.loading(`${Math.round(f * 100)}%`, title));
    return { sourceMd5, sourceQuick };
  } finally {
    dialogs.hideLoading();
  }
}

/**
 * Before converting a source file from the Import Manager: fingerprint it
 * (full MD5), ask before converting a file whose assets are already in the
 * library, and resolve the format's store (created on first use). Returns null
 * when the user skips. A caller that names a store (the postMessage API) is
 * left alone — no hash, no question, its store.
 */
async function prepareSource(
  file: File,
  format: SourceFormat,
  opts: { store?: string } & ImportBehaviour,
): Promise<PreparedSource | null> {
  if (opts.store !== undefined) {
    return { store: resolveStore(opts.store) };
  }
  let fp: SourceFingerprint;
  try {
    fp = await fingerprintSource(file, format);
  } catch (e) {
    // runs before the import lock, whose error dialog would not see this: a
    // file changed or moved since it was picked, or on a drive that went away
    const msg = `${file.name} could not be read: ${e instanceof Error ? e.message : String(e)}`;
    consoleActions.log('error', `Assets: ${msg}`);
    dialogs.error(msg, 'Import failed');
    return null;
  }
  const have = assetsFromSource(assetsState.get().assets, fp);
  if (have.length > 0) {
    // a quick match says less than a whole-file one
    const same = fp.sourceMd5 !== undefined ? 'this exact file' : 'a file of the same size with the same start and end';
    const again = await dialogs.confirm(
      `${file.name} is already imported: ${have.length} asset${have.length === 1 ? '' : 's'} in ${describePlaces(have)} came from ${same}. Convert it again?`,
      { title: 'Already imported', okLabel: 'Convert again', cancelLabel: 'Skip' },
    );
    if (!again) {
      consoleActions.log('info', `Assets: ${file.name} skipped — already imported (${describePlaces(have)})`);
      return null;
    }
  }
  const s = assetsState.get();
  const want = formatStoreOf(s.formatStores, format);
  if (!(opts.temp ?? s.importTemp)) {
    await storesActions.addStore(want);
  }
  return { store: resolveStore(want), ...fp };
}

/** prepareSource, then `run` with the resolved store + fingerprint; false when skipped. */
async function importPrepared<O extends { store?: string } & ImportBehaviour>(
  file: File,
  format: SourceFormat,
  opts: O,
  run: (opts: O) => Promise<boolean>,
): Promise<boolean> {
  const prepared = await prepareSource(file, format, opts);
  return prepared ? run({ ...opts, ...prepared }) : false;
}

/** Land a converter's in-RAM cooked outputs (`<name>.tdp` + its
 *  `<name>.coarse.tdp`) in the store, logging the converter's status
 *  warnings — the shared final phase of the IFC and NWD imports. */
async function landCookedOutputs(
  file: File,
  files: readonly { name: string; bytes: ArrayBuffer }[],
  status: string | null,
  label: string,
  t0: number,
  store: string,
  opts: { folder: string } & ImportBehaviour,
): Promise<void> {
  // the warnings first: they are what explains a file that gave nothing
  // (a model that only references external files, say)
  if (status) {
    try {
      const st = JSON.parse(status) as { warnings?: string[]; notes?: string[] };
      for (const w of st.warnings ?? []) {
        consoleActions.log('error', `${label}: ${w}`);
      }
      // what the converter did by itself that the user should know of
      // (a Revit export scaled from feet to metres)
      for (const n of st.notes ?? []) {
        consoleActions.log('info', `${label}: ${n}`);
      }
    } catch {
      /* non-fatal */
    }
  }
  if (files.length === 0) {
    consoleActions.log('error', `Assets: ${file.name} produced no geometry — nothing imported`);
    return;
  }
  const coarseByName = new Map(files.filter((f) => /\.coarse\.tdp$/i.test(f.name)).map((f) => [f.name, f.bytes]));
  const cooked = files.filter((f) => !/\.coarse\.tdp$/i.test(f.name));
  consoleActions.log(
    'info',
    `Assets: ${file.name} → ${cooked.length} cooked file(s) in ${((performance.now() - t0) / 1000).toFixed(1)} s`,
  );
  const sources: ImportSource[] = cooked.map((f) => {
    const c = coarseByName.get(f.name.replace(/\.tdp$/i, '.coarse.tdp'));
    return {
      name: f.name,
      bytes: () => Promise.resolve(f.bytes),
      ...(c ? { coarseBytes: () => Promise.resolve(c) } : {}),
      folder: opts.folder,
    };
  });
  await assetsActions.importSourcesLocked(sources, {
    folder: opts.folder,
    store,
    title: `Importing ${label} — storing`,
    replace: opts.replace,
    load: opts.load,
    temp: opts.temp,
    // the rest of the behaviour must travel too — `quiet` keeps the final
    // phase's overlay down for a host, `meta` tags every asset
    quiet: opts.quiet,
    meta: opts.meta,
    sourceMd5: opts.sourceMd5,
    sourceQuick: opts.sourceQuick,
  });
}

export const assetsActions = {
  /** Collapse every store/folder in the Model Assets tree. */
  collapseTree() {
    assetsState.set((s) => ({ treeCollapseSignal: s.treeCollapseSignal + 1 }));
  },
  /** Expand every store/folder in the Model Assets tree. */
  expandTree() {
    assetsState.set((s) => ({ treeExpandSignal: s.treeExpandSignal + 1 }));
  },

  /** Read index.json once (panel mount). The shared store registry is loaded
   *  separately by storesActions.init() — callers run that FIRST (stores
   *  never import assets state; assets only ask the stores to create a
   *  format's default store). */
  async init() {
    if (assetsState.get().ready) {
      return;
    }
    const dir = await modelAssetsDir();
    const idx = await readJson<StoredIndex>(dir, INDEX);
    let assets = (idx?.assets ?? []).map((a) => ({ ...a, store: a.store || MAIN_STORE }));
    // purge session-only temp imports left by the previous session (checkbox
    // "Temp" in the Import Manager): files first, then the index entries
    const stale = assets.filter((a) => a.temp);
    if (stale.length) {
      assets = assets.filter((a) => !a.temp);
      try {
        await deleteAssetFiles(stale);
      } catch (e) {
        consoleActions.log('error', `Assets: temp-import cleanup failed: ${e}`);
      }
      consoleActions.log('info', `Assets: purged ${stale.length} temp import(s) from the last session`);
    }
    // extraFolders: pre-store saves stored a flat array (→ main)
    let extraFolders: Record<string, string[]> = {};
    if (Array.isArray(idx?.extraFolders)) {
      extraFolders = { [MAIN_STORE]: idx.extraFolders };
    } else if (idx?.extraFolders) {
      extraFolders = idx.extraFolders;
    }
    assetsState.set({ assets, extraFolders, ready: true });
    if (stale.length) {
      await persistIndex();
    }
    try {
      await sweepUnfinishedScans();
    } catch (e) {
      consoleActions.log('error', `Assets: cleanup of unfinished scan conversions failed: ${e}`);
    }
  },

  /** Drop every asset belonging to a store that is being deleted. The store's
   *  DIRECTORY (files included) is removed by storesActions.removeStore, which
   *  is the only caller. */
  async forgetStore(name: string) {
    const s = assetsState.get();
    const doomed = s.assets.filter((a) => a.store === name);
    for (const a of doomed.filter((d) => d.kind === 'points')) {
      scansActions.closeAsset(a.id);
    }
    const { [name]: _dropped, ...extraFolders } = s.extraFolders;
    assetsState.set({
      assets: s.assets.filter((a) => a.store !== name),
      extraFolders,
      importStore: s.importStore === name ? MAIN_STORE : s.importStore,
      selected: {},
    });
    await persistIndex();
    consoleActions.log('info', `Assets: dropped ${doomed.length} asset(s) with store "${name}"`);
  },

  /** Move a laser scan by `offset` (metres from its own coordinates): saved
   *  with the asset, so it is applied again whenever the scan is loaded. */
  async setScanOffset(id: string, offset: readonly [number, number, number]) {
    await placeScanAsset(id, { scanOffset: [round3(offset[0]), round3(offset[1]), round3(offset[2])] });
  },

  /** Show a laser scan in another of its source's coordinate systems
   *  ('' = the source's own frame): saved with the asset. */
  async setScanCoordSystem(id: string, system: string) {
    await placeScanAsset(id, { scanCoordSystem: system });
  },

  /** Step the current scan to its next coordinate system (hotkey). */
  async nextScanCoordSystem() {
    const view = scansState.get().assets.find((a) => a.assetId === scansActions.currentScan());
    if (!view || view.systems.length < 2) {
      return;
    }
    const at = view.systems.indexOf(view.system);
    await assetsActions.setScanCoordSystem(view.assetId, view.systems[(at + 1) % view.systems.length]);
  },

  /** Nudge one axis of the current scan's offset (hotkeys). */
  async stepScanOffset(axis: 0 | 1 | 2, direction: 1 | -1) {
    const id = scansActions.currentScan();
    const entry = assetsState.get().assets.find((a) => a.id === id);
    if (!id || !entry) {
      return;
    }
    const next: [number, number, number] = [...(entry.scanOffset ?? [0, 0, 0])];
    next[axis] += direction * scansState.get().offsetStep;
    await assetsActions.setScanOffset(id, next);
  },

  /** The store Import Manager imports of one format go to ('' = back to its default). */
  setFormatStore(format: StoreFormat, name: string) {
    assetsState.set((s) => ({ formatStores: { ...s.formatStores, [format]: name } }));
  },

  /** Where an Import Manager import of `format` lands: the format's store
   *  (the user's pick, else `<format>-files`), created on first use.
   *  Undefined for a temp import, which needs none. */
  async importTargetStore(format: StoreFormat): Promise<string | undefined> {
    const s = assetsState.get();
    if (s.importTemp) {
      return undefined;
    }
    const want = formatStoreOf(s.formatStores, format);
    await storesActions.addStore(want);
    return want;
  },

  setImportTemp(importTemp: boolean) {
    assetsState.set({ importTemp });
  },

  setPool(pool: number) {
    assetsState.set({ pool: Math.max(1, Math.min(workerPoolCap(), Math.round(pool))) });
  },

  setKeepCamera(v: boolean) {
    assetsState.set({ keepCamera: v });
  },

  setLoadAfterImport(v: boolean) {
    assetsState.set({ loadAfterImport: v });
  },

  setLoadPool(n: number) {
    assetsState.set({ loadPool: Math.max(1, Math.min(workerPoolCap(), Math.round(n))) });
  },

  setRvmOptions(patch: Partial<RvmImportOptions>) {
    assetsState.set((s) => ({ rvm: { ...s.rvm, ...patch } }));
  },

  setIfcOptions(patch: Partial<IfcImportOptions>) {
    assetsState.set((s) => ({ ifc: { ...s.ifc, ...patch } }));
  },

  setStepOptions(patch: Partial<StepImportOptions>) {
    assetsState.set((s) => ({ step: { ...s.step, ...patch } }));
  },

  setNwdOptions(patch: Partial<NwdImportOptions>) {
    assetsState.set((s) => ({ nwd: { ...s.nwd, ...patch } }));
  },

  setScanOptions(patch: Partial<ScanImportOptions>) {
    assetsState.set((s) => {
      const scan = { ...s.scan, ...patch };
      return { scan: { ...scan, workers: Math.max(0, Math.min(scanWorkerCap(), Math.round(scan.workers))) } };
    });
  },

  setStdGlbOptions(patch: Partial<StdGlbImportOptions>) {
    assetsState.set((s) => ({ stdGlb: { ...s.stdGlb, ...patch } }));
  },

  /** Standard-GLB import (single file): plain glTF node trees and
   *  EXT_mesh_gpu_instancing — the TS generic cook, separate from the strict
   *  merged folder flow. Normals kept per the panel option. */
  async importStandardGlb(file: File, opts: { folder: string; store?: string } & ImportBehaviour) {
    const temp = opts.temp ?? assetsState.get().importTemp;
    const store = temp ? TEMP_STORE : resolveStore(opts.store);
    return (
      (await withImportLock(async () => {
        const t0 = performance.now();
        const before = assetsState.get().assets;
        const { normals, edges } = assetsState.get().stdGlb;
        // show the overlay FIRST — before the (slow) worker spin-up — so the UI
        // is blocked the instant Import is clicked, not seconds later
        phaseLoading(opts, `Cooking ${file.name}…`, 'Importing standard GLB');
        const worker = new Worker(new URL('../../lib/cooker/cookerWorker.ts', import.meta.url), { type: 'module' });
        try {
          const cookerApi = Comlink.wrap<CookerApi>(worker);
          const workerDied = new Promise<never>((_, reject) => {
            worker.addEventListener('error', (e) => reject(new Error(e.message || 'cooker worker crashed')));
          });
          const bytes = await file.arrayBuffer();
          const id = uid();
          const cooked = await Promise.race([
            cookerApi.cookStandardToOpfs(Comlink.transfer(bytes, [bytes]), `${store}/${id}.tdp`, normals),
            workerDied,
          ]);
          const entry: AssetEntry = {
            id,
            store,
            name: file.name.replace(/\.glb$/i, ''),
            folder: opts.folder,
            fileName: file.name,
            md5: cooked.md5,
            size: cooked.size,
            importedAt: Date.now(),
            bounds: { full: cooked.bounds, dense: cooked.dense },
            kind: 'standard',
            hasNormals: cooked.hasNormals,
            edges,
            ...(opts.meta ? { meta: opts.meta } : {}),
            ...(temp ? { temp: true } : {}),
          };
          assetsState.set((s) => ({ assets: [...s.assets, entry] }));
          await persistIndex();
          const { replaced } = await finishImport(before, [entry], opts);
          consoleActions.log(
            'info',
            `Assets: imported ${file.name} (standard${cooked.hasNormals ? ', normals' : ''}${
              replaced ? `, replaced ${replaced}` : ''
            }) in ${((performance.now() - t0) / 1000).toFixed(1)} s`,
          );
        } finally {
          worker.terminate();
          phaseHideLoading(opts);
        }
      })) !== null
    );
  },

  /** Copy sources into OPFS with `pool`-way concurrency. Merged GLBs are named
   *  by their hierarchy root (verbatim, "/" included); .tdp files by their
   *  file name. */
  async importSources(sources: ImportSource[], opts: { folder: string; store?: string } & ImportBehaviour) {
    return (await withImportLock(() => this.importSourcesLocked(sources, opts))) !== null;
  },

  /** The importSources body — call only with the import lock held. */
  async importSourcesLocked(
    sources: ImportSource[],
    opts: {
      folder: string;
      store?: string;
      title?: string;
      /** Sources processed at once (default: the Import Manager pool size).
       *  Each slot downloads (`bytes()`) AND cooks, so a batch of URL sources
       *  overlaps the two automatically. */
      concurrency?: number;
      /** Per-source outcome, fired as each finishes — the caller's hook for
       *  per-file progress and for mapping entries back to their input. */
      onSourceDone?: (index: number, result: { entry?: AssetEntry; error?: string }) => void;
    } & ImportBehaviour,
  ) {
    const t0 = performance.now();
    const quiet = opts.quiet === true;
    // block the UI immediately — the cooker pool below can take a moment to
    // spin up, and until now the dialog only appeared after the FIRST cook
    if (!quiet) {
      dialogs.loading(`File 0 of ${sources.length}`, opts.title ?? 'Importing assets');
    }
    const before = assetsState.get().assets;
    const temp = opts.temp ?? assetsState.get().importTemp;
    // temp imports never ask for a store — they land in the reserved 'temp'
    // store (own section in the Model Assets panel, purged on next start)
    const store = temp ? TEMP_STORE : resolveStore(opts.store);
    // the cap also bounds an explicit API `concurrent`: a host cannot know the
    // client's core count, and the failure mode is a tab OOM, not a slow import
    const pool = Math.max(1, Math.min(workerPoolCap(), opts.concurrency ?? assetsState.get().pool));
    const added: AssetEntry[] = [];
    // entries by source index — the batch's per-file result map
    const perSource = new Map<number, AssetEntry>();
    const stdDefaults = assetsState.get().stdGlb;
    // ids handed out this batch aren't in state yet (added is flushed at the
    // end) — track them so concurrent cooks can't pick the same id
    const pending = new Set<string>();
    let done = 0;
    let failed = 0;
    const runBatch = async (cook: CookToOpfs, storeTdp: StoreTdpToOpfs, cookStandard: CookStandardToOpfs) => {
      const work = sources.map((src, index) => async () => {
        try {
          const bytes = await src.bytes();
          const id = uid(pending);
          // the worker that takes the bytes (they are transferred) hashes them
          let md5 = '';
          let rootName = '';
          let size = bytes.byteLength;
          let bounds: AssetBounds | undefined;
          let kind: AssetEntry['kind'];
          let hasNormals = false;
          let edges: boolean | undefined;
          let coarse: AssetEntry['coarse'];
          if (/\.glb$/i.test(src.name)) {
            // GLB → cooker worker: cooks AND writes the .tdp into OPFS
            // itself (sync access handle) — no bytes come back. Merged files
            // use the wasm cooker; a source flagged `standardGlb` takes the
            // generic TS cook (standard node trees + gpu-instanced, authored
            // normals kept) on the same pool worker.
            // The coarse variant (VRAM-budget swap) cooks from the same GLB.
            const cooked = src.standardGlb
              ? await cookStandard(bytes, `${store}/${id}.tdp`, src.stdOptions?.normals ?? stdDefaults.normals)
              : await cook(bytes, `${store}/${id}.tdp`, `${store}/${id}.coarse.tdp`);
            md5 = cooked.md5;
            rootName = cooked.rootName;
            size = cooked.size;
            bounds = { full: cooked.bounds, dense: cooked.dense };
            kind = cooked.kind;
            hasNormals = cooked.hasNormals;
            coarse = cooked.coarseSize !== undefined ? { size: cooked.coarseSize } : undefined;
            if (src.standardGlb) {
              edges = src.stdOptions?.edges ?? stdDefaults.edges;
            }
          } else {
            // .tdp: must really be a cooked file (CADM v7–v9)
            const dv = new DataView(bytes);
            const ver = bytes.byteLength >= 216 ? dv.getUint32(4, true) : 0;
            if (dv.getUint32(0, true) !== 0x4d444143 || ver < 7 || ver > 9) {
              throw new Error('not a cooked TreDeSpace (.tdp) file — skipped');
            }
            const f = (o: number) => dv.getFloat32(o, true);
            bounds = {
              full: [f(48), f(52), f(56), f(60), f(64), f(68)],
              dense: ver >= 8 ? [f(216), f(220), f(224), f(228), f(232), f(236)] : null,
            };
            // normal streams live per color group: any non-zero normOff (h+72)
            const cgCount = dv.getUint32(8, true);
            // v8 adds dense bounds (+24), v9 the cell-table pointer (+16)
            const headerSize = ver >= 9 ? 256 : ver >= 8 ? 240 : 216;
            for (let cg = 0; cg < cgCount && !hasNormals; cg++) {
              if (dv.getBigUint64(headerSize + cg * 128 + 72, true) !== 0n) {
                hasNormals = true;
              }
            }
            // The worker hashes and writes the file and gives it its coarse
            // sibling: the delivered one (converters cook full + coarse in one
            // pass) or, for a bare .tdp (exported, hosted, or panel-imported
            // without its sibling), one rebuilt from the cooked file itself —
            // so every import lands residency-swap ready. A missing/broken
            // coarse variant only costs VRAM headroom. NOTE: storeTdp transfers
            // `bytes` — they are detached past this point.
            let coarseBytes: ArrayBuffer | undefined;
            if (src.coarseBytes) {
              try {
                coarseBytes = await src.coarseBytes();
              } catch (e) {
                consoleActions.log('error', `Assets: coarse variant for ${src.name} unreadable, rebuilding: ${e}`);
              }
            }
            const stored = await storeTdp(bytes, `${store}/${id}.tdp`, `${store}/${id}.coarse.tdp`, coarseBytes);
            md5 = stored.md5;
            if (stored.coarseSize !== undefined) {
              coarse = { size: stored.coarseSize };
            } else {
              consoleActions.log('error', `Assets: coarse variant for ${src.name} skipped: ${stored.coarseError}`);
            }
          }
          // merged GLBs are stored under their hierarchy ROOT name, verbatim
          // (leading "/" kept); .tdp files use their file name
          const displayName = rootName || src.name.replace(/\.(model|glb)$/i, '');
          const entry: AssetEntry = {
            id,
            store,
            name: displayName,
            folder: src.folder ?? opts.folder,
            fileName: src.name,
            md5,
            size,
            importedAt: Date.now(),
            bounds,
            kind,
            hasNormals,
            ...(edges !== undefined ? { edges } : {}),
            ...(coarse ? { coarse } : {}),
            ...((src.meta ?? opts.meta) ? { meta: src.meta ?? opts.meta } : {}),
            ...(opts.sourceMd5 ? { sourceMd5: opts.sourceMd5 } : {}),
            ...(opts.sourceQuick ? { sourceQuick: opts.sourceQuick } : {}),
            ...(temp ? { temp: true } : {}),
          };
          added.push(entry);
          perSource.set(index, entry);
          opts.onSourceDone?.(index, { entry });
        } catch (e) {
          failed++;
          const msg = e instanceof Error ? e.message : String(e);
          consoleActions.log('error', `Assets: failed to import ${src.name}: ${msg}`);
          opts.onSourceDone?.(index, { error: msg });
        } finally {
          done++;
          if (!quiet) {
            dialogs.loading(`File ${done} of ${sources.length}`, opts.title ?? 'Importing assets');
          }
        }
      });
      // simple pool: `pool` runners pull from a shared queue
      const queue = [...work];
      await Promise.all(
        Array.from({ length: Math.min(pool, queue.length) }, async () => {
          for (let job = queue.shift(); job; job = queue.shift()) {
            await job();
          }
        }),
      );
    };
    try {
      // every source goes through a pool worker: GLBs are cooked there, and a
      // .tdp — converter-fed with its coarse sibling or bare — is hashed,
      // written and given its coarse variant there, so the main thread never
      // touches the bytes. No more workers than files.
      await withCookerPool(Math.min(pool, sources.length), runBatch);
    } finally {
      if (!quiet) {
        dialogs.hideLoading();
      }
    }
    assetsState.set((s) => ({ assets: [...s.assets, ...added] }));
    await persistIndex();
    const { replaced, byKey } = await finishImport(before, added, opts);
    consoleActions.log(
      'info',
      `Assets: imported ${added.length} file(s)${replaced ? `, replaced ${replaced}` : ''}${
        failed ? `, ${failed} failed` : ''
      } in ${((performance.now() - t0) / 1000).toFixed(1)} s`,
    );
    if (failed > 0 && !quiet) {
      dialogs.error(
        `${failed} of ${sources.length} file(s) failed to import — see the Console panel.`,
        'Import errors',
      );
    }
    // per-source outcome for a caller that must map results back to inputs
    // (the postMessage batch import); `replaced` is per file, resolved from
    // the identity keys finishImport actually dropped.
    return [...perSource.entries()].map(([index, entry]) => ({
      index,
      entry,
      replaced: byKey.get(identityKey(entry)) ?? 0,
    }));
  },

  /** Laser scans: `.tdpp` files are copied into the store as they are (a Blob
   *  write, never read whole — scans are GBs); Leica `.lgsx` and `.e57` are
   *  cooked to `.tdpp` in a worker, straight into the store. The header is
   *  validated and gives the asset bounds. */
  async importTdpp(files: File[], opts: { folder: string; store?: string } & ImportBehaviour) {
    const prepared = new Map<File, PreparedSource>();
    const todo: File[] = [];
    for (const file of files) {
      const format = sourceFormatOf(file.name);
      const p = format ? await prepareSource(file, format, opts) : undefined;
      if (p === null) {
        continue; // already imported, skipped by the user
      }
      if (p) {
        prepared.set(file, p);
      }
      todo.push(file);
    }
    if (todo.length === 0) {
      return false;
    }
    return (await withImportLock(() => this.importTdppLocked(todo, opts, prepared))) !== null;
  },

  /** `prepared`: the store + fingerprint of each cooked source (LGSX / E57);
   *  a `.tdpp` has none and goes to the import store. */
  async importTdppLocked(
    files: File[],
    opts: { folder: string; store?: string } & ImportBehaviour,
    prepared: ReadonlyMap<File, PreparedSource> = new Map(),
  ) {
    const t0 = performance.now();
    const quiet = opts.quiet === true;
    const before = assetsState.get().assets;
    const temp = opts.temp ?? assetsState.get().importTemp;
    const added: AssetEntry[] = [];
    let failed = 0;
    const scanOpts = assetsState.get().scan;
    const cookOpts = {
      panoMaxSize: scanOpts.panoramas ? PANO_MAX_PX : 0,
      intensity16: scanOpts.intensity16,
      workers: scanOpts.workers,
    };
    // Where every file goes and what it takes over from the scan it replaces,
    // settled for the whole batch BEFORE the first conversion: the "keep the
    // offset?" question must not come up minutes in, under the progress
    // overlay of the file before it (which covers it).
    const targets: {
      file: File;
      source: PreparedSource | undefined;
      store: string;
      name: string;
      scanOffset: [number, number, number] | undefined;
      scanCoordSystem: string | undefined;
    }[] = [];
    for (const file of files) {
      const source = prepared.get(file);
      // a .tdpp copied as it is has no source check: its own format store
      const own = source?.store ?? opts.store ?? (temp ? undefined : await assetsActions.importTargetStore('tdpp'));
      const store = temp ? TEMP_STORE : resolveStore(own);
      const name = file.name.replace(/\.(tdpp|lgsx|e57)$/i, '');
      const key = identityKey({ store, folder: opts.folder, name, kind: 'points' });
      const replacedScan = before.find((b) => identityKey(b) === key);
      targets.push({
        file,
        source,
        store,
        name,
        scanOffset: await keptScanOffset(replacedScan, { name }, quiet),
        // the coordinate system chosen for the scan being replaced carries over
        scanCoordSystem: replacedScan?.scanCoordSystem,
      });
    }
    for (const [i, { file, source, store, name, scanOffset, scanCoordSystem }] of targets.entries()) {
      // an LGSX / E57 is cooked, a .tdpp is already in the local format
      const phase = sourceFormatOf(file.name) ? 'Converting to local format' : 'Copying into local store';
      const title = `${phase} — scan ${i + 1} of ${files.length}`;
      if (!quiet) {
        dialogs.loading(file.name, title);
      }
      const dir = await modelStoreDir(store);
      const id = uid();
      const stored = await storeScanFile(file, dir, `${id}.tdpp`, cookOpts, (msg) => {
        if (!quiet) {
          dialogs.loading(msg, title);
        }
      });
      if (!stored.data) {
        failed++;
        consoleActions.log('error', `Assets: ${stored.error?.msg ?? `${file.name} failed`}`);
        continue;
      }
      if (stored.data.frame) {
        consoleActions.log('info', `Assets: ${file.name} — coordinates: ${stored.data.frame.replace(/ \(.*\)$/, '')}`);
      }
      // everything the source says about coordinates, applied or not: the
      // lines to look at (or pass on) when a scan lands in the wrong place
      for (const line of stored.data.coordinateReport) {
        consoleActions.log('info', `Assets: ${file.name} — source ${line}`);
      }
      const entry: AssetEntry = {
        id,
        store,
        name,
        folder: opts.folder,
        fileName: file.name,
        size: stored.data.size,
        importedAt: Date.now(),
        kind: 'points',
        bounds: {
          full: stored.data.bounds.map((v, k) => v + (scanOffset?.[k % 3] ?? 0)),
          dense: null,
        },
        ...(opts.meta ? { meta: opts.meta } : {}),
        ...(source?.sourceMd5 ? { sourceMd5: source.sourceMd5 } : {}),
        ...(source?.sourceQuick ? { sourceQuick: source.sourceQuick } : {}),
        ...(scanOffset ? { scanOffset } : {}),
        ...(scanCoordSystem !== undefined ? { scanCoordSystem } : {}),
        ...(temp ? { temp: true } : {}),
      };
      added.push(entry);
      // landed in the index at once: a reload or crash later in a long batch
      // must not leave this finished scan as an unlisted multi-GB file
      assetsState.set((s) => ({ assets: [...s.assets, entry] }));
      await persistIndex();
    }
    if (!quiet) {
      dialogs.hideLoading();
    }
    const { replaced } = await finishImport(before, added, opts);
    consoleActions.log(
      'info',
      `Assets: imported ${added.length} scan(s)${replaced ? `, replaced ${replaced}` : ''}${
        failed ? `, ${failed} failed` : ''
      } in ${((performance.now() - t0) / 1000).toFixed(1)} s`,
    );
    if (failed > 0 && !quiet) {
      dialogs.error(
        `${failed} of ${files.length} scan file(s) failed to import — see the Console panel.`,
        'Import errors',
      );
    }
    return added;
  },

  /** RVM import, two phases under one lock: (1) the rvm wasm streams the .rvm
   *  (staged into OPFS temp/rvm-import/) into COOKED `.tdp` files in the same
   *  dir — it cooks the merged model itself, so no GLB is ever built — and
   *  (2) those land in the store like any cooked file. Temp is cleared before
   *  and after, so the user never sees the intermediates. */
  async importRvm(file: File, opts: { folder: string; store?: string } & ImportBehaviour) {
    return importPrepared(
      file,
      'rvm',
      opts,
      async (o) => (await withImportLock(() => this.importRvmLocked(file, o))) !== null,
    );
  },

  /** Import SEVERAL .rvm files in one lock window; each file lands in its own
   *  folder named after the file (the UI disables the folder field for this). */
  async importRvmFiles(files: File[], opts: { store?: string } & ImportBehaviour = {}) {
    const jobs: { file: File; prepared: PreparedSource }[] = [];
    for (const file of files) {
      const prepared = await prepareSource(file, 'rvm', opts);
      if (prepared) {
        jobs.push({ file, prepared });
      }
    }
    if (jobs.length === 0) {
      return false;
    }
    return (
      (await withImportLock(async () => {
        for (const { file, prepared } of jobs) {
          await this.importRvmLocked(file, { ...opts, ...prepared, folder: file.name });
        }
      })) !== null
    );
  },

  /** One RVM convert+cook; the caller holds the import lock. */
  async importRvmLocked(file: File, opts: { folder: string; store?: string } & ImportBehaviour) {
    const store = resolveStore(opts.store);
    {
      const t0 = performance.now();
      // overlay first — before OPFS clear + worker spin-up — so the click lands
      // on a blocked UI, not a still-live one
      phaseLoading(opts, `${file.name}…`, 'Importing RVM — copying into local store');
      const rvmOpts = assetsState.get().rvm;
      const temp = await rvmTempDir();
      await clearDir(temp);
      let started: Worker | undefined;
      try {
        const spawned = await spawnComlinkWorker<Rvm2GlbApi>(
          () => new Worker(new URL('../../lib/rvm2glb/rvm2glbWorker.ts', import.meta.url), { type: 'module' }),
          'rvm2glb',
        );
        if (!spawned.data) {
          throw new Error(spawned.error?.msg);
        }

        const { worker, api: rvm } = spawned.data;
        started = worker;
        // phase 1 — convert (single wasm thread; counter = sites written)
        await writeFile(temp, 'input.rvm', file);
        phaseLoading(opts, `${file.name}…`, 'Importing RVM — converting to local format');
        // if the wasm traps, the worker dies WITHOUT rejecting the Comlink
        // call — race against the worker's error event so we don't hang
        const workerDied = new Promise<never>((_, reject) => {
          worker.addEventListener('error', (e) => reject(new Error(e.message || 'rvm2glb worker crashed')));
        });
        const unit = ['site', 'zone', 'equipment'][rvmOpts.level] ?? 'part';
        let parts = 0;
        const { files } = await Promise.race([
          rvm.convert(
            'input.rvm',
            file.name,
            { ...rvmOpts },
            Comlink.proxy(() => {
              parts++;
              phaseLoading(
                opts,
                `${parts} ${unit}${parts === 1 ? '' : 's'} converted`,
                'Importing RVM — converting to local format',
              );
            }),
          ),
          workerDied,
        ]);
        if (files.length === 0) {
          consoleActions.log('error', `Assets: ${file.name} produced no geometry — nothing imported`);
          return;
        }
        const cooked = files.filter((f) => !/\.coarse\.tdp$/i.test(f.name));
        consoleActions.log(
          'info',
          `Assets: ${file.name} → ${cooked.length} cooked file(s) in ${((performance.now() - t0) / 1000).toFixed(1)} s`,
        );
        // status_file.json (written to the temp dir by the worker): per-GLB
        // parent path (folder hierarchy) + warnings
        const parents = new Map<string, string[]>();
        try {
          const st = JSON.parse(new TextDecoder().decode(await readFile(temp, 'status_file.json'))) as {
            models?: { file_name: string; parent?: string[] }[];
            warnings?: string[];
          };
          for (const m of st.models ?? []) {
            parents.set(m.file_name, m.parent ?? []);
          }
          for (const w of st.warnings ?? []) {
            consoleActions.log('error', `RVM: ${w}`);
          }
        } catch (e) {
          consoleActions.log('error', `RVM: could not read status_file.json: ${e}`);
        }
        // phase 2 — the files are ALREADY cooked; they just move into the
        // store. Each goes under <import folder>/<its parent path>,
        // with its coarse sibling alongside.
        const names = new Set(files.map((f) => f.name));
        const sources: ImportSource[] = cooked.map((f) => {
          const coarseName = f.name.replace(/\.tdp$/i, '.coarse.tdp');
          return {
            name: f.name,
            bytes: () => readFile(temp, f.name),
            ...(names.has(coarseName) ? { coarseBytes: () => readFile(temp, coarseName) } : {}),
            folder: [opts.folder, ...(parents.get(f.name) ?? []).map((p) => p.replace(/^\//, ''))]
              .filter(Boolean)
              .join('/'),
          };
        });
        await this.importSourcesLocked(sources, {
          folder: opts.folder,
          store,
          title: 'Importing RVM — storing',
          replace: opts.replace,
          load: opts.load,
          temp: opts.temp,
          // the rest of the behaviour must travel too — `quiet` keeps the
          // final phase's overlay down for a host, `meta` tags every asset
          quiet: opts.quiet,
          meta: opts.meta,
          sourceMd5: opts.sourceMd5,
        });
      } finally {
        // errors propagate to the lock holder (error dialog + console)
        started?.terminate();
        phaseHideLoading(opts);
        await clearDir(temp);
      }
    }
  },

  /** IFC import: the ifc wasm converts the whole file in RAM and cooks each
   *  merged output itself, yielding 1..N `.tdp` files (split by spatial tier)
   *  plus their coarse siblings — no GLB is built. In-RAM: no OPFS staging,
   *  the cooked buffers pass straight to importSourcesLocked. */
  async importIfc(file: File, opts: { folder: string; store?: string } & ImportBehaviour): Promise<boolean> {
    return importPrepared(file, 'ifc', opts, (o) => this.importIfcPrepared(file, o));
  },

  /** importIfc after the source check: `opts.store` is resolved. */
  async importIfcPrepared(file: File, opts: { folder: string; store?: string } & ImportBehaviour): Promise<boolean> {
    const store = resolveStore(opts.store);
    return (
      (await withImportLock(async () => {
        const t0 = performance.now();
        // overlay first — before the worker spin-up — so the UI blocks on click
        phaseLoading(opts, `Converting ${file.name}…`, 'Importing IFC — converting to local format');
        const ifcOpts = assetsState.get().ifc;
        let started: Worker | undefined;
        try {
          const spawned = await spawnComlinkWorker<Ifc2GlbApi>(
            () => new Worker(new URL('../../lib/ifc2glb/ifc2glbWorker.ts', import.meta.url), { type: 'module' }),
            'ifc2glb',
          );
          if (!spawned.data) {
            throw new Error(spawned.error?.msg);
          }

          const { worker, api: ifc } = spawned.data;
          started = worker;
          // a wasm trap kills the worker without rejecting the Comlink call — race it
          const workerDied = new Promise<never>((_, reject) => {
            worker.addEventListener('error', (e) => reject(new Error(e.message || 'ifc2glb worker crashed')));
          });
          const bytes = await file.arrayBuffer();
          const { files, status } = await Promise.race([
            ifc.convert(
              Comlink.transfer(bytes, [bytes]),
              file.name,
              { ...ifcOpts },
              Comlink.proxy((f: number) =>
                phaseLoading(opts, `${Math.round(f * 100)}% converted`, 'Importing IFC — converting to local format'),
              ),
            ),
            workerDied,
          ]);
          await landCookedOutputs(file, files, status, 'IFC', t0, store, opts);
        } finally {
          started?.terminate();
          phaseHideLoading(opts);
        }
      })) !== null
    );
  },

  /** Navisworks import (.nwd / .nwc): the nwd wasm parses the whole file in
   *  RAM and cooks every root's merged model itself into `.tdp` + coarse — no
   *  GLB is built — and the outputs land like the IFC ones. */
  async importNwd(file: File, opts: { folder: string; store?: string } & ImportBehaviour): Promise<boolean> {
    return importPrepared(file, 'nwd', opts, (o) => this.importNwdPrepared(file, o));
  },

  /** importNwd after the source check: `opts.store` is resolved. */
  async importNwdPrepared(file: File, opts: { folder: string; store?: string } & ImportBehaviour): Promise<boolean> {
    const store = resolveStore(opts.store);
    return (
      (await withImportLock(async () => {
        const t0 = performance.now();
        phaseLoading(opts, `Converting ${file.name}…`, 'Importing NWD — converting to local format');
        let started: Worker | undefined;
        try {
          const spawned = await spawnComlinkWorker<Nwd2TdpApi>(
            () => new Worker(new URL('../../lib/nwd2tdp/nwd2tdpWorker.ts', import.meta.url), { type: 'module' }),
            'nwd2tdp',
          );
          if (!spawned.data) {
            throw new Error(spawned.error?.msg);
          }
          const { worker, api: nwd } = spawned.data;
          started = worker;
          // a wasm trap kills the worker without rejecting the Comlink call — race it
          const workerDied = new Promise<never>((_, reject) => {
            worker.addEventListener('error', (e) => reject(new Error(e.message || 'nwd2tdp worker crashed')));
          });
          const bytes = await file.arrayBuffer();
          const { files, status } = await Promise.race([
            nwd.convert(
              Comlink.transfer(bytes, [bytes]),
              file.name,
              { ...assetsState.get().nwd },
              Comlink.proxy((n: number) =>
                phaseLoading(
                  opts,
                  `${n} file${n === 1 ? '' : 's'} cooked`,
                  'Importing NWD — converting to local format',
                ),
              ),
            ),
            workerDied,
          ]);
          await landCookedOutputs(file, files, status, 'NWD', t0, store, opts);
        } finally {
          started?.terminate();
          phaseHideLoading(opts);
        }
      })) !== null
    );
  },

  /** STEP import, two phases under one lock: (1) the file is staged into OPFS
   *  temp/step-import/ and the step worker streams it — indexing by range,
   *  tessellating over sub-workers, spilling geometry to disk — into one
   *  cooked `.tdp` plus its coarse variant in the same dir (no GLB is ever
   *  built), and (2) those land in the store like any cooked file. Temp is
   *  cleared before and after. */
  async importStep(file: File, opts: { folder: string; store?: string } & ImportBehaviour): Promise<boolean> {
    return importPrepared(file, 'step', opts, (o) => this.importStepPrepared(file, o));
  },

  /** importStep after the source check: `opts.store` is resolved. */
  async importStepPrepared(file: File, opts: { folder: string; store?: string } & ImportBehaviour): Promise<boolean> {
    const store = resolveStore(opts.store);
    return (
      (await withImportLock(async () => {
        const t0 = performance.now();
        const title = 'Importing STEP — converting to local format';
        // overlay first — before OPFS staging + worker spin-up — so the UI
        // blocks on click
        phaseLoading(opts, `${file.name}…`, 'Importing STEP — copying into local store');
        const stepOpts = assetsState.get().step;
        const temp = await stepTempDir();
        await clearDir(temp);
        let started: Worker | undefined;
        try {
          const spawned = await spawnComlinkWorker<Step2GlbApi>(
            () => new Worker(new URL('../../lib/step2glb/step2glbWorker.ts', import.meta.url), { type: 'module' }),
            'step2glb',
          );
          if (!spawned.data) {
            throw new Error(spawned.error?.msg);
          }

          const { worker, api: step } = spawned.data;
          started = worker;
          await writeFile(temp, 'input.step', file);
          // if the wasm traps, the worker dies WITHOUT rejecting the Comlink
          // call — race against the worker's error event so we don't hang
          const workerDied = new Promise<never>((_, reject) => {
            worker.addEventListener('error', (e) => reject(new Error(e.message || 'step2glb worker crashed')));
          });
          const { files, info } = await Promise.race([
            step.convert(
              file.name,
              { ...stepOpts },
              Comlink.proxy((p: StepProgress) => phaseLoading(opts, describeStepProgress(p), title)),
            ),
            workerDied,
          ]);
          try {
            const rep = JSON.parse(info) as { warnings?: string[] };
            for (const w of rep.warnings ?? []) {
              consoleActions.log('error', `STEP: ${w}`);
            }
          } catch {
            /* non-fatal */
          }
          const cooked = files.filter((f) => !/\.coarse\.tdp$/i.test(f.name));
          if (cooked.length === 0) {
            consoleActions.log('error', `Assets: ${file.name} produced no geometry — nothing imported`);
            return;
          }
          const names = new Set(files.map((f) => f.name));
          const sources: ImportSource[] = cooked.map((f) => {
            const coarseName = f.name.replace(/\.tdp$/i, '.coarse.tdp');
            return {
              name: f.name,
              bytes: () => readFile(temp, f.name),
              folder: opts.folder,
              ...(names.has(coarseName) ? { coarseBytes: () => readFile(temp, coarseName) } : {}),
            };
          });
          await this.importSourcesLocked(sources, {
            folder: opts.folder,
            store,
            title: 'Importing STEP — storing',
            replace: opts.replace,
            load: opts.load,
            temp: opts.temp,
            // the rest of the behaviour must travel too — `quiet` keeps the
            // final phase's overlay down for a host, `meta` tags every asset
            quiet: opts.quiet,
            meta: opts.meta,
            sourceMd5: opts.sourceMd5,
          });
          consoleActions.log(
            'info',
            `Assets: ${file.name} imported in ${((performance.now() - t0) / 1000).toFixed(1)} s`,
          );
        } finally {
          started?.terminate();
          await clearDir(temp).catch(() => undefined);
          phaseHideLoading(opts);
        }
      })) !== null
    );
  },

  /** Load one asset into the viewer. */
  async load(id: string) {
    dialogs.loading('1 file', 'Loading asset');
    try {
      if (await loadOne(id)) {
        viewerActions.bumpModelsVersion();
      }
    } finally {
      dialogs.hideLoading();
    }
  },

  /** Load every selected asset — ONE loading dialog for the whole batch.
   *  `only` (the panel's filtered view) restricts which selected ids load. */
  async loadSelected(only?: string[]) {
    const s = assetsState.get();
    let ids = s.assets.filter((a) => s.selected[a.id]).map((a) => a.id);
    if (only) {
      const allow = new Set(only);
      ids = ids.filter((id) => allow.has(id));
    }
    await this.loadIds(ids);
  },

  /** Load these exact assets, selection ignored — the shared body of
   *  loadSelected and of "Load after import". */
  async loadIds(ids: string[]) {
    const s = assetsState.get();
    if (ids.length === 0) {
      return;
    }
    const t0 = performance.now();
    const loaded = (await loadIdsPooled(ids)).length;
    if (loaded > 0) {
      viewerActions.bumpModelsVersion();
      // Fit the camera to what was JUST loaded so a partial load doesn't
      // re-frame the whole scene — unless "Keep camera". With "frame dense
      // bounds" on, the box is the CROSS-model weighted percentile from the
      // worker (a whole outlier file gets trimmed like an outlier vertex —
      // per-file dense boxes can't do that); off, the plain full-box union.
      if (!s.keepCamera) {
        // read again: loading a scan may have corrected its bounds
        const now = assetsState.get().assets;
        const loadedEntries = ids.map((id) => now.find((a) => a.id === id)).filter((a): a is AssetEntry => a != null);
        let dense: { min: number[]; max: number[] } | null = null;
        if (viewerState.get().fitDense) {
          const indices = await db.indicesForPaths(
            loadedEntries.map((a) => ({ name: a.name, group: groupOf(a), store: a.store })),
          );
          dense = await db.sceneDenseBounds(indices);
        }
        const min = [Infinity, Infinity, Infinity];
        const max = [-Infinity, -Infinity, -Infinity];
        for (const a of loadedEntries) {
          const box = a.bounds?.full;
          if (!box) {
            continue;
          }
          for (let k = 0; k < 3; k++) {
            min[k] = Math.min(min[k], box[k]);
            max[k] = Math.max(max[k], box[k + 3]);
          }
        }
        const r = getRenderer();
        if (r) {
          if (dense) {
            r.fitBounds(dense.min, dense.max);
          } else if (Number.isFinite(min[0])) {
            r.fitBounds(min, max);
          } else {
            const t = r.fitTarget; // old imports without bounds → scene box
            r.fitBounds(t.min, t.max);
          }
        }
      }
    }
    consoleActions.log(
      'info',
      `Assets: loaded ${loaded} of ${ids.length} file(s) in ${((performance.now() - t0) / 1000).toFixed(1)} s`,
    );
  },

  /** Unload the selected assets from the VIEWER (files stay in the store).
   *  `only` restricts to the panel's filtered view. */
  async unloadSelected(only?: string[]) {
    const s = assetsState.get();
    let entries = s.assets.filter((a) => s.selected[a.id]);
    if (only) {
      const allow = new Set(only);
      entries = entries.filter((a) => allow.has(a.id));
    }
    if (entries.length === 0) {
      return;
    }
    // laser scans live in the Scans domain, not modeldb
    for (const a of entries.filter((e) => e.kind === 'points')) {
      scansActions.closeAsset(a.id);
    }
    entries = entries.filter((a) => a.kind !== 'points');
    if (entries.length === 0) {
      return;
    }
    const indices = await db.indicesForPaths(entries.map((a) => ({ name: a.name, group: groupOf(a), store: a.store })));
    if (indices.length === 0) {
      consoleActions.log('info', 'Assets: none of the selected assets are loaded');
      return;
    }
    await viewerActions.removeModels(indices);
  },

  /** Create an empty folder in a store — prompts for a name. `parent` = '' for
   *  root, or the folder PATH it nests under. */
  async addFolder(store: string, parent = '') {
    const name = (await dialogs.prompt('Folder name', { title: 'New folder', okLabel: 'Create' }))?.trim();
    if (!name || name.includes('/')) {
      return;
    }
    const path = parent ? `${parent}/${name}` : name;
    const s = assetsState.get();
    const here = s.extraFolders[store] ?? [];
    const taken = new Set([...s.assets.filter((a) => a.store === store).map((a) => a.folder), ...here]);
    if (taken.has(path)) {
      return;
    }
    assetsState.set({ extraFolders: { ...s.extraFolders, [store]: [...here, path] } });
    await persistIndex();
  },

  /** Rename a folder's LAST path segment — subtree + assets move along. */
  async renameFolder(store: string, oldPath: string) {
    const segs = oldPath.split('/');
    const next = (
      await dialogs.prompt('Folder name', {
        title: 'Rename folder',
        defaultValue: segs[segs.length - 1],
        okLabel: 'Rename',
      })
    )?.trim();
    if (!next || next.includes('/') || next === segs[segs.length - 1]) {
      return;
    }
    const newPath = [...segs.slice(0, -1), next].join('/');
    reprefixFolder(store, oldPath, newPath);
    await persistIndex();
  },

  /** Move a whole folder (subtree + assets) under another folder ('' = root).
   *  Dropping into itself/a descendant is refused. */
  async moveFolder(store: string, path: string, targetParent: string) {
    if (targetParent === path || targetParent.startsWith(`${path}/`)) {
      return;
    }
    const last = path.split('/').pop() ?? path;
    const newPath = targetParent ? `${targetParent}/${last}` : last;
    if (newPath === path) {
      return;
    }
    reprefixFolder(store, path, newPath);
    await persistIndex();
  },

  /** Delete a folder: empty folders vanish; contained assets are ungrouped
   *  (the asset FILES are kept — use Delete selected to remove them). */
  async deleteFolder(store: string, path: string) {
    const inSub = (f: string) => f === path || f.startsWith(`${path}/`);
    const s = assetsState.get();
    const contained = s.assets.filter((a) => a.store === store && inSub(a.folder)).length;
    if (contained > 0) {
      const ok = await dialogs.confirm(
        `"${path}" contains ${contained} asset(s) — they will be moved to Ungrouped. Delete the folder?`,
        { okLabel: 'Delete folder' },
      );
      if (!ok) {
        return;
      }
    }
    assetsState.set((st) => ({
      assets: st.assets.map((a) => (a.store === store && inSub(a.folder) ? { ...a, folder: '' } : a)),
      extraFolders: { ...st.extraFolders, [store]: (st.extraFolders[store] ?? []).filter((f) => !inSub(f)) },
    }));
    await persistIndex();
  },

  /** Move assets into a folder ('' = ungrouped) — the drag/drop target. */
  async moveToFolder(ids: string[], folder: string) {
    assetsState.set((s) => ({
      assets: s.assets.map((a) => (ids.includes(a.id) ? { ...a, folder } : a)),
    }));
    await persistIndex();
  },

  toggleSelected(id: string) {
    assetsState.set((s) => ({ selected: { ...s.selected, [id]: !s.selected[id] } }));
  },

  clearSelection() {
    assetsState.set({ selected: {} });
  },

  async rename(id: string, name: string) {
    assetsState.set((s) => ({ assets: s.assets.map((a) => (a.id === id ? { ...a, name } : a)) }));
    await persistIndex();
  },

  /** Delete every selected asset. */
  async removeSelected(only?: string[]) {
    const s = assetsState.get();
    let ids = s.assets.filter((a) => s.selected[a.id]).map((a) => a.id);
    if (only) {
      const allow = new Set(only);
      ids = ids.filter((id) => allow.has(id));
    }
    await deleteAssetFiles(s.assets.filter((a) => ids.includes(a.id)));
    assetsState.set((st) => ({
      assets: st.assets.filter((a) => !ids.includes(a.id)),
      selected: {},
    }));
    await persistIndex();
    consoleActions.log('info', `Assets: deleted ${ids.length} asset(s)`);
  },

  /** Write the selected assets as .tdp files (the cooked bytes, verbatim)
   *  into a directory the user picks — ONE permission prompt, and the store's
   *  virtual folder tree is recreated as real subdirectories. */
  async exportSelected(only?: string[]) {
    const s = assetsState.get();
    // laser scans are GB-sized and opened from OPFS in place — not exported here
    let entries = s.assets.filter((a) => s.selected[a.id] && a.kind !== 'points');
    if (only) {
      const allow = new Set(only);
      entries = entries.filter((a) => allow.has(a.id));
    }
    if (entries.length === 0) {
      if (s.assets.some((a) => s.selected[a.id] && a.kind === 'points')) {
        consoleActions.log('warn', 'Assets: laser scans are not exported — only models are');
      }
      return;
    }
    let root: FileSystemDirectoryHandle;
    try {
      root = await (
        window as unknown as { showDirectoryPicker(o: object): Promise<FileSystemDirectoryHandle> }
      ).showDirectoryPicker({ mode: 'readwrite' });
    } catch {
      return; // user cancelled
    }
    // strip filesystem-hostile characters from a single path segment
    const clean = (seg: string) => seg.replace(/[\\/:*?"<>|]/g, '_').trim() || '_';
    dialogs.loading(`File 0 of ${entries.length}`, 'Exporting assets');
    try {
      for (let i = 0; i < entries.length; i++) {
        const a = entries[i];
        dialogs.loading(`File ${i + 1} of ${entries.length}`, 'Exporting assets');
        const bytes = await readFile(await modelStoreDir(a.store), `${a.id}.tdp`);
        let dir = root;
        for (const seg of a.folder.split('/').filter(Boolean)) {
          dir = await dir.getDirectoryHandle(clean(seg), { create: true });
        }
        const base = clean(a.name.replace(/^\/+/, '')) || a.id;
        await writeFile(dir, `${base}.tdp`, bytes);
      }
      consoleActions.log('info', `Assets: exported ${entries.length} .tdp file(s) to "${root.name}"`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      consoleActions.log('error', `Assets: export failed: ${msg}`);
      dialogs.error(msg, 'Export failed');
    } finally {
      dialogs.hideLoading();
    }
  },

  /** Clear one store — every imported asset in it is deleted from OPFS. The
   *  store itself remains (it's still selectable for import). */
  async clearStore(store: string) {
    const s = assetsState.get();
    const doomed = s.assets.filter((a) => a.store === store);
    await deleteAssetFiles(doomed);
    assetsState.set((st) => ({
      assets: st.assets.filter((a) => a.store !== store),
      selected: {},
      extraFolders: { ...st.extraFolders, [store]: [] },
    }));
    await persistIndex();
    consoleActions.log('info', `Assets: store "${store}" cleared`);
  },

  /** Clear EVERY store's assets (Home → Clear all local data). Stores remain. */
  async clearAll() {
    const s = assetsState.get();
    await deleteAssetFiles(s.assets);
    assetsState.set({ assets: [], selected: {}, extraFolders: {} });
    await persistIndex();
    consoleActions.log('info', 'Assets: all stores cleared');
  },

  async remove(id: string) {
    const entry = assetsState.get().assets.find((a) => a.id === id);
    if (entry) {
      await deleteAssetFiles([entry]);
    }
    assetsState.set((s) => ({
      assets: s.assets.filter((a) => a.id !== id),
      selected: { ...s.selected, [id]: false },
    }));
    await persistIndex();
  },

  /** Delete assets by id (files + entries) — used by the API's replace-if-exists
   *  to drop the prior asset(s) at a store/folder/name after the new one lands,
   *  and by the API's `assets.remove` (session models). `logAs` only picks the
   *  console wording. */
  async deleteByIds(ids: string[], logAs: 'replaced' | 'removed' = 'replaced') {
    if (ids.length === 0) {
      return;
    }
    const del = new Set(ids);
    await deleteAssetFiles(assetsState.get().assets.filter((a) => del.has(a.id)));
    assetsState.set((s) => {
      const selected = { ...s.selected };
      for (const id of ids) {
        delete selected[id];
      }
      return { assets: s.assets.filter((a) => !del.has(a.id)), selected };
    });
    await persistIndex();
    consoleActions.log(
      'info',
      logAs === 'removed'
        ? `Assets: removed ${ids.length} asset(s) from local storage`
        : `Assets: replaced ${ids.length} existing asset(s)`,
    );
  },
};
