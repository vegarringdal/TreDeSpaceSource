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
  type CoarsenTdpToOpfs,
  type CookStandardToOpfs,
  type CookToOpfs,
  withCookerPool,
} from '../../lib/cooker/cookerPool';
import type { CookerApi } from '../../lib/cooker/cookerWorker';
import type { Ifc2GlbApi } from '../../lib/ifc2glb/ifc2glbWorker';
import { md5Hex } from '../../lib/md5';
import {
  clearDir,
  deleteFile,
  modelAssetsDir,
  modelStoreDir,
  readFile,
  readJson,
  rvmTempDir,
  writeFile,
  writeJson,
} from '../../lib/opfs/opfs';
import type { Rvm2GlbApi } from '../../lib/rvm2glb/rvm2glbWorker';
import type { Step2GlbApi } from '../../lib/step2glb/step2glbWorker';
import { MAIN_STORE, type StoreDef, storesState, TEMP_STORE } from '../stores/stores.state';
import { db } from '../viewer/db';
import { residency } from '../viewer/residency';
import { getRenderer, loadModelBytes, viewerActions } from '../viewer/viewer.actions';
import { viewerState } from '../viewer/viewer.state';
import {
  type AssetBounds,
  type AssetEntry,
  assetsState,
  groupOf,
  type IfcImportOptions,
  type RvmImportOptions,
  type StdGlbImportOptions,
  type StepImportOptions,
} from './assets.state';

const INDEX = 'index.json';

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
    const dir = await modelStoreDir(a.store);
    await deleteFile(dir, `${a.id}.tdp`);
    await deleteFile(dir, `${a.id}.coarse.tdp`);
  }
}

/** An asset's identity for overwrite purposes: same store, same folder, same
 *  display name = the same thing, re-imported. */
const identityKey = (a: { store: string; folder: string; name: string }) => `${a.store}\0${a.folder}\0${a.name}`;

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
  return navigator.locks.request('asset-import', { ifAvailable: true }, async (lock) => {
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
      .request('asset-import', { ifAvailable: true }, (lock) => {
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
  const pool = Math.max(1, opts.concurrency ?? assetsState.get().loadPool);
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

export async function loadAssetIntoViewer(id: string): Promise<boolean> {
  return loadOne(id);
}

async function loadOne(id: string): Promise<boolean> {
  const entry = assetsState.get().assets.find((a) => a.id === id);
  if (!entry) {
    return false;
  }
  try {
    // With a VRAM budget active, start from the COARSE variant — the scene
    // never overshoots the budget at load time, and the residency manager
    // promotes the nearest zones to full detail once the camera settles.
    const dir = await modelStoreDir(entry.store);
    let variant: 'full' | 'coarse' = 'full';
    let bytes: ArrayBuffer;
    if (viewerState.get().maxVramMb > 0 && entry.coarse) {
      try {
        bytes = await readFile(dir, `${entry.id}.coarse.tdp`);
        variant = 'coarse';
      } catch {
        bytes = await readFile(dir, `${entry.id}.tdp`); // missing coarse file
      }
    } else {
      bytes = await readFile(dir, `${entry.id}.tdp`);
    }
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

interface StoredIndex {
  /** Written by pre-0.0.19 saves; the registry lives in stores.json now and
   *  storesActions.init() seeds itself from this. */
  stores?: StoreDef[];
  assets?: (AssetEntry & { store?: string })[];
  // pre-store saves used a flat string[]; current saves use a per-store record
  extraFolders?: string[] | Record<string, string[]>;
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
   *  separately by storesActions.init() — callers run that FIRST (one-way
   *  dependency: stores never import assets state, assets never import store
   *  actions). */
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
  },

  /** Drop every asset belonging to a store that is being deleted. The store's
   *  DIRECTORY (files included) is removed by storesActions.removeStore, which
   *  is the only caller. */
  async forgetStore(name: string) {
    const s = assetsState.get();
    const doomed = s.assets.filter((a) => a.store === name);
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

  /** '' (or an unknown name) = no store chosen — kept imports stay blocked
   *  until the user picks one. */
  setImportStore(name: string) {
    assetsState.set({ importStore: storesState.get().stores.some((st) => st.name === name) ? name : '' });
  },

  setImportTemp(importTemp: boolean) {
    assetsState.set({ importTemp });
  },

  setPool(pool: number) {
    assetsState.set({ pool: Math.max(1, Math.min(10, Math.round(pool))) });
  },

  setKeepCamera(v: boolean) {
    assetsState.set({ keepCamera: v });
  },

  setLoadAfterImport(v: boolean) {
    assetsState.set({ loadAfterImport: v });
  },

  setLoadPool(n: number) {
    assetsState.set({ loadPool: Math.max(1, Math.min(10, Math.round(n))) });
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

  setStdGlbOptions(patch: Partial<StdGlbImportOptions>) {
    assetsState.set((s) => ({ stdGlb: { ...s.stdGlb, ...patch } }));
  },

  /** Standard-GLB import (single file): plain glTF node trees and
   *  EXT_mesh_gpu_instancing — the TS generic cook, separate from the strict
   *  merged folder flow. Normals kept per the panel option. */
  async importStandardGlb(file: File, opts: { folder: string; store?: string } & ImportBehaviour) {
    const temp = opts.temp ?? assetsState.get().importTemp;
    const store = temp ? TEMP_STORE : resolveStore(opts.store);
    await withImportLock(async () => {
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
        const md5 = md5Hex(new Uint8Array(bytes)); // before the cook transfers the buffer
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
          md5,
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
    });
  },

  /** Copy sources into OPFS with `pool`-way concurrency. Merged GLBs are named
   *  by their hierarchy root (verbatim, "/" included); .tdp files by their
   *  file name. */
  async importSources(sources: ImportSource[], opts: { folder: string; store?: string } & ImportBehaviour) {
    await withImportLock(() => this.importSourcesLocked(sources, opts));
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
    const dir = await modelStoreDir(store);
    const pool = Math.max(1, opts.concurrency ?? assetsState.get().pool);
    const added: AssetEntry[] = [];
    // entries by source index — the batch's per-file result map
    const perSource = new Map<number, AssetEntry>();
    const stdDefaults = assetsState.get().stdGlb;
    // ids handed out this batch aren't in state yet (added is flushed at the
    // end) — track them so concurrent cooks can't pick the same id
    const pending = new Set<string>();
    let done = 0;
    let failed = 0;
    const runBatch = async (cook: CookToOpfs, coarsenTdp: CoarsenTdpToOpfs, cookStandard: CookStandardToOpfs) => {
      const work = sources.map((src, index) => async () => {
        try {
          const bytes = await src.bytes();
          // hash BEFORE the cook (the cooker transfers/detaches the buffer)
          const md5 = md5Hex(new Uint8Array(bytes));
          const id = uid(pending);
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
            await writeFile(dir, `${id}.tdp`, bytes);
            if (src.coarseBytes) {
              try {
                const cb = await src.coarseBytes();
                await writeFile(dir, `${id}.coarse.tdp`, cb);
                coarse = { size: cb.byteLength };
              } catch (e) {
                // a missing/broken coarse variant only costs VRAM headroom
                consoleActions.log('error', `Assets: coarse variant for ${src.name} skipped: ${e}`);
              }
            } else {
              // bare .tdp (exported, hosted, or panel-imported without its
              // sibling): rebuild the coarse variant from the cooked file
              // itself, so every import lands residency-swap ready. NOTE:
              // coarsenTdp transfers `bytes` — it is detached past this point.
              try {
                const { size: coarseSize } = await coarsenTdp(bytes, `${store}/${id}.coarse.tdp`);
                coarse = { size: coarseSize };
              } catch (e) {
                consoleActions.log('error', `Assets: coarse cook for ${src.name} skipped: ${e}`);
              }
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
      // the pool is needed to cook GLBs AND to rebuild the coarse variant of
      // any .tdp arriving without its pre-cooked sibling
      if (sources.some((src) => /\.glb$/i.test(src.name) || !src.coarseBytes)) {
        await withCookerPool(pool, runBatch);
      } else {
        // converter-fed .tdp batch (full + coarse pre-cooked) — no worker needed
        await runBatch(
          async () => {
            throw new Error('unexpected GLB in a pre-cooked .tdp batch');
          },
          async () => {
            throw new Error('unexpected coarsen in a pre-cooked .tdp batch');
          },
          async () => {
            throw new Error('unexpected standard GLB in a pre-cooked .tdp batch');
          },
        );
      }
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

  /** RVM import, two phases under one lock: (1) the rvm wasm streams the .rvm
   *  (staged into OPFS temp/rvm-import/) into COOKED `.tdp` files in the same
   *  dir — it cooks the merged model itself, so no GLB is ever built — and
   *  (2) those land in the store like any cooked file. Temp is cleared before
   *  and after, so the user never sees the intermediates. */
  async importRvm(file: File, opts: { folder: string; store?: string } & ImportBehaviour) {
    await withImportLock(() => this.importRvmLocked(file, opts));
  },

  /** Import SEVERAL .rvm files in one lock window; each file lands in its own
   *  folder named after the file (the UI disables the folder field for this). */
  async importRvmFiles(files: File[], opts: { store?: string } & ImportBehaviour = {}) {
    await withImportLock(async () => {
      for (const file of files) {
        await this.importRvmLocked(file, { ...opts, folder: file.name });
      }
    });
  },

  /** One RVM convert+cook; the caller holds the import lock. */
  async importRvmLocked(file: File, opts: { folder: string; store?: string } & ImportBehaviour) {
    const store = resolveStore(opts.store);
    {
      const t0 = performance.now();
      // overlay first — before OPFS clear + worker spin-up — so the click lands
      // on a blocked UI, not a still-live one
      phaseLoading(opts, `Converting ${file.name}…`, 'Importing RVM — phase 1 of 2');
      const rvmOpts = assetsState.get().rvm;
      const temp = await rvmTempDir();
      await clearDir(temp);
      const worker = new Worker(new URL('../../lib/rvm2glb/rvm2glbWorker.ts', import.meta.url), { type: 'module' });
      try {
        // phase 1 — convert (single wasm thread; counter = sites written)
        await writeFile(temp, 'input.rvm', file);
        const rvm = Comlink.wrap<Rvm2GlbApi>(worker);
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
              phaseLoading(opts, `${parts} ${unit}${parts === 1 ? '' : 's'} converted`, 'Importing RVM — phase 1 of 2');
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
          title: 'Importing RVM — final phase',
          replace: opts.replace,
          load: opts.load,
          temp: opts.temp,
          // the rest of the behaviour must travel too — `quiet` keeps the
          // final phase's overlay down for a host, `meta` tags every asset
          quiet: opts.quiet,
          meta: opts.meta,
        });
      } finally {
        // errors propagate to the lock holder (error dialog + console)
        worker.terminate();
        phaseHideLoading(opts);
        await clearDir(temp);
      }
    }
  },

  /** IFC import: the ifc wasm converts the whole file in RAM and cooks each
   *  merged output itself, yielding 1..N `.tdp` files (split by spatial tier)
   *  plus their coarse siblings — no GLB is built. In-RAM: no OPFS staging,
   *  the cooked buffers pass straight to importSourcesLocked. */
  async importIfc(file: File, opts: { folder: string; store?: string } & ImportBehaviour) {
    const store = resolveStore(opts.store);
    await withImportLock(async () => {
      const t0 = performance.now();
      // overlay first — before the worker spin-up — so the UI blocks on click
      phaseLoading(opts, `Converting ${file.name}…`, 'Importing IFC — phase 1 of 2');
      const ifcOpts = assetsState.get().ifc;
      const worker = new Worker(new URL('../../lib/ifc2glb/ifc2glbWorker.ts', import.meta.url), { type: 'module' });
      try {
        const ifc = Comlink.wrap<Ifc2GlbApi>(worker);
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
              phaseLoading(opts, `${Math.round(f * 100)}% converted`, 'Importing IFC — phase 1 of 2'),
            ),
          ),
          workerDied,
        ]);
        if (files.length === 0) {
          consoleActions.log('error', `Assets: ${file.name} produced no geometry — nothing imported`);
          return;
        }
        if (status) {
          try {
            const st = JSON.parse(status) as { warnings?: string[] };
            for (const w of st.warnings ?? []) {
              consoleActions.log('error', `IFC: ${w}`);
            }
          } catch {
            /* non-fatal */
          }
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
        await this.importSourcesLocked(sources, {
          folder: opts.folder,
          store,
          title: 'Importing IFC — final phase',
          replace: opts.replace,
          load: opts.load,
          temp: opts.temp,
          // the rest of the behaviour must travel too — `quiet` keeps the
          // final phase's overlay down for a host, `meta` tags every asset
          quiet: opts.quiet,
          meta: opts.meta,
        });
      } finally {
        worker.terminate();
        phaseHideLoading(opts);
      }
    });
  },

  /** STEP import: the step wasm tessellates the B-rep in RAM and cooks the
   *  merged model itself, yielding one `.tdp` plus its coarse variant — no GLB
   *  is built. */
  async importStep(file: File, opts: { folder: string; store?: string } & ImportBehaviour) {
    const store = resolveStore(opts.store);
    await withImportLock(async () => {
      const t0 = performance.now();
      // overlay first — before the worker spin-up — so the UI blocks on click
      phaseLoading(opts, `Converting ${file.name}…`, 'Importing STEP — phase 1 of 2');
      const stepOpts = assetsState.get().step;
      const worker = new Worker(new URL('../../lib/step2glb/step2glbWorker.ts', import.meta.url), { type: 'module' });
      try {
        const step = Comlink.wrap<Step2GlbApi>(worker);
        const workerDied = new Promise<never>((_, reject) => {
          worker.addEventListener('error', (e) => reject(new Error(e.message || 'step2glb worker crashed')));
        });
        const bytes = await file.arrayBuffer();
        const { tdp, coarse, info } = await Promise.race([
          step.convert(
            Comlink.transfer(bytes, [bytes]),
            { ...stepOpts },
            Comlink.proxy((done: number, total: number) =>
              phaseLoading(
                opts,
                `${total > 0 ? Math.round((done / total) * 100) : 0}% tessellated`,
                'Importing STEP — phase 1 of 2',
              ),
            ),
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
        const name = `${file.name.replace(/\.(step|stp)$/i, '')}.tdp`;
        const source: ImportSource = {
          name,
          bytes: () => Promise.resolve(tdp),
          folder: opts.folder,
          ...(coarse ? { coarseBytes: () => Promise.resolve(coarse) } : {}),
        };
        await this.importSourcesLocked([source], {
          folder: opts.folder,
          store,
          title: 'Importing STEP — final phase',
          replace: opts.replace,
          load: opts.load,
          temp: opts.temp,
          // the rest of the behaviour must travel too — `quiet` keeps the
          // final phase's overlay down for a host, `meta` tags every asset
          quiet: opts.quiet,
          meta: opts.meta,
        });
        consoleActions.log(
          'info',
          `Assets: ${file.name} imported in ${((performance.now() - t0) / 1000).toFixed(1)} s`,
        );
      } finally {
        worker.terminate();
        phaseHideLoading(opts);
      }
    });
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
        const loadedEntries = ids
          .map((id) => s.assets.find((a) => a.id === id))
          .filter((a): a is AssetEntry => a != null);
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
    let entries = s.assets.filter((a) => s.selected[a.id]);
    if (only) {
      const allow = new Set(only);
      entries = entries.filter((a) => allow.has(a.id));
    }
    if (entries.length === 0) {
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
