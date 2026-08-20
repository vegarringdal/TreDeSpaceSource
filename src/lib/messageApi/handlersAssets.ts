// Store + asset commands: listing, single-shot import, URL-batch import, the
// chunked upload session, remove/load/unload. See EVENTS.md for the payload
// contracts.
import { dialogs } from '../../components/dialogs/dialogs.actions';
import { acquireImportLock, assetsActions, loadAssetIntoViewer } from '../../state/assets/assets.actions';
import { assetsState, groupOf } from '../../state/assets/assets.state';
import { storesActions } from '../../state/stores/stores.actions';
import { normalizeStoreName, storeExists, storesState } from '../../state/stores/stores.state';
import { db } from '../../state/viewer/db';
import { getRenderer, viewerActions } from '../../state/viewer/viewer.actions';
import { deleteFile, uploadsTempDir } from '../opfs/opfs';
import { ApiError, type ApiHandler, isRecord, records, requireStoreOpt, strings } from './protocol';
import { emitApiEvent } from './transport';

/** Run a `File` through the right importer for `format` and report the assets it
 *  produced (shared by the single-shot `assets.import` and the chunked
 *  `assets.uploadFinish`). Wrapping a Blob/File as the `File` is by reference —
 *  no copy — so this scales to multi-GB inputs. */
async function importAndReport(
  file: File,
  format: unknown,
  folder: string,
  store: string,
  replace: boolean,
  opts: Record<string, unknown>,
): Promise<{ entries: unknown[]; replaced: number }> {
  const before = assetsState.get().assets;
  const beforeIds = new Set(before.map((a) => a.id));
  // replace-if-exists, load-after-import and temp are panel checkboxes; a host
  // must not inherit whatever the user last ticked, so all are passed
  // explicitly. The importer drops the replaced asset(s) AFTER the new one
  // lands, so a failed import never deletes anything.
  const behaviour = { replace, load: false, temp: false };
  switch (format) {
    case 'glb-merged':
      await assetsActions.importSources([{ name: file.name, bytes: () => file.arrayBuffer() }], {
        folder,
        store,
        ...behaviour,
      });
      break;
    case 'glb-standard':
      assetsActions.setStdGlbOptions({
        ...(typeof opts.normals === 'boolean' ? { normals: opts.normals } : {}),
        ...(typeof opts.edges === 'boolean' ? { edges: opts.edges } : {}),
      });
      await assetsActions.importStandardGlb(file, { folder, store, ...behaviour });
      break;
    case 'rvm':
      await assetsActions.importRvm(file, { folder: folder || file.name, store, ...behaviour });
      break;
    case 'ifc':
      await assetsActions.importIfc(file, { folder: folder || file.name, store, ...behaviour });
      break;
    case 'step':
      await assetsActions.importStep(file, { folder, store, ...behaviour });
      break;
    case 'tdp': {
      // already-cooked file: stored as-is (validated as CADM v7–v9 by the
      // importer, which also rebuilds the coarse variant from these bytes and
      // records the md5 of the .tdp itself). The extension routes the
      // importer's cook/store branch, so guarantee it.
      const name = /\.tdp$/i.test(file.name) ? file.name : `${file.name}.tdp`;
      await assetsActions.importSources([{ name, bytes: () => file.arrayBuffer() }], {
        folder,
        store,
        ...behaviour,
      });
      break;
    }
    default:
      throw new ApiError('bad-payload', `unknown format ${String(format)}`);
  }
  const after = assetsState.get().assets;
  const added = after.filter((a) => !beforeIds.has(a.id));
  // the import lock swallows "busy" into a dialog — surface it to the host
  if (added.length === 0) {
    throw new ApiError('busy', 'import produced no entries (busy or failed — see Console)');
  }
  const survivors = new Set(after.map((a) => a.id));
  const replaced = replace ? before.filter((a) => !survivors.has(a.id)).length : 0;
  const entries = added.map((a) => ({
    id: a.id,
    store: a.store,
    name: a.name,
    folder: a.folder,
    fileName: a.fileName,
    md5: a.md5,
    size: a.size,
    kind: a.kind,
    hasNormals: a.hasNormals,
    loaded: false,
  }));
  return { entries, replaced };
}

const IMPORT_FORMATS = new Set(['glb-merged', 'glb-standard', 'rvm', 'ifc', 'step', 'tdp']);

/** Last path segment of a URL (query/hash dropped), for the asset's stored name
 *  when a file gives no explicit `fileName`. Shared with `sql.importUrl`. */
export function fileNameFromUrl(url: string, fallback: string): string {
  try {
    const seg = new URL(url, location.href).pathname.split('/').filter(Boolean).pop();
    return seg ? decodeURIComponent(seg) : fallback;
  } catch {
    return fallback;
  }
}

type ImportUrlOutcome = { url: string; ok: boolean; entries?: unknown[]; replaced?: number; error?: string };

/** Fetch each file in `files` (up to `concurrent` at once) and import it. The
 *  cook is single-locked app-wide (concurrent imports fail 'busy'), so imports
 *  are chained serially while downloads run ahead — `concurrent` is really
 *  download parallelism, and a slot frees only after that file's import ends, so
 *  at most `concurrent` downloaded blobs sit in memory. One outcome per input
 *  file, in order; a download/convert failure is recorded, never thrown. */
async function importUrlBatch(
  files: Record<string, unknown>[],
  concurrent: number,
  store: string,
  replace: boolean,
  batchId: string | undefined,
): Promise<{ imported: number; failed: number; results: ImportUrlOutcome[] }> {
  const total = files.length;
  const results: ImportUrlOutcome[] = new Array(total);
  let completed = 0;
  const emit = (url: string, phase: string) =>
    emitApiEvent('assets.importUrl:progress', { ...(batchId ? { batchId } : {}), completed, total, url, phase });
  const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

  // imports run one at a time (the asset-import Web Lock is single-holder), so
  // every worker's convert step queues behind this chain
  let importChain: Promise<void> = Promise.resolve();

  const handleOne = async (i: number): Promise<void> => {
    const f = files[i];
    const url = typeof f.url === 'string' ? f.url : '';
    if (!url) {
      results[i] = { url: '', ok: false, error: 'url must be a string' };
      completed++;
      emit('', 'error');
      return;
    }
    const format = f.format;
    if (typeof format !== 'string' || !IMPORT_FORMATS.has(format)) {
      results[i] = { url, ok: false, error: `unknown format ${String(format)}` };
      completed++;
      emit(url, 'error');
      return;
    }
    emit(url, 'download');
    let file: File;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      const blob = await res.blob();
      const name = typeof f.fileName === 'string' && f.fileName ? f.fileName : fileNameFromUrl(url, `file-${i}`);
      file = new File([blob], name);
    } catch (e) {
      results[i] = { url, ok: false, error: `download failed: ${errMsg(e)}` };
      completed++;
      emit(url, 'error');
      return;
    }
    emit(url, 'convert');
    const folder = typeof f.folder === 'string' ? f.folder : '';
    const options = isRecord(f.options) ? f.options : {};
    const myTurn = importChain.then(async () => {
      try {
        const r = await importAndReport(file, format, folder, store, replace, options);
        results[i] = { url, ok: true, entries: r.entries, replaced: r.replaced };
      } catch (e) {
        results[i] = { url, ok: false, error: errMsg(e) };
      }
    });
    importChain = myTurn;
    await myTurn;
    completed++;
    emit(url, results[i].ok ? 'done' : 'error');
  };

  // worker pool: `concurrent` workers pull the next index off a shared cursor
  let cursor = 0;
  const worker = async () => {
    for (let i = cursor++; i < total; i = cursor++) {
      await handleOne(i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrent, total) }, worker));

  const imported = results.filter((r) => r?.ok).length;
  return { imported, failed: total - imported, results };
}

/** In-flight chunk uploads: uploadId → staging file name + next expected byte. */
const uploads = new Map<
  string,
  {
    fileName: string;
    received: number;
    total: number;
    handle: FileSystemFileHandle;
    writable: FileSystemWritableFileStream;
    release: () => Promise<void>;
  }
>();

export const assetHandlers: Record<string, ApiHandler> = {
  'stores.list': () => ({
    stores: storesState.get().stores.map((st) => ({
      name: st.name,
      description: st.description,
      count: assetsState.get().assets.filter((a) => a.store === st.name).length,
    })),
  }),

  // Create a store (project) with an optional description. Idempotent: an
  // existing name (or 'main') is not an error — `created:false` reports it.
  'stores.create': async ({ p }) => {
    const name = normalizeStoreName(typeof p.name === 'string' ? p.name : '');
    if (!name) {
      throw new ApiError('bad-payload', 'name is required');
    }
    const description = typeof p.description === 'string' ? p.description : '';
    const existed = storeExists(name);
    await storesActions.addStore(name, description);
    const store = storesState.get().stores.find((st) => st.name === name);
    return {
      created: !existed,
      store: {
        name,
        description: store?.description ?? description,
        count: assetsState.get().assets.filter((a) => a.store === name).length,
      },
    };
  },

  'assets.list': async ({ p }) => {
    const store = requireStoreOpt(p.store);
    const out = [];
    for (const a of assetsState.get().assets) {
      if (store && a.store !== store) {
        continue;
      }
      out.push({
        id: a.id,
        store: a.store,
        name: a.name,
        folder: a.folder,
        fileName: a.fileName,
        md5: a.md5,
        size: a.size,
        kind: a.kind,
        hasNormals: a.hasNormals,
        edges: a.edges,
        loaded: await db.hasModel(a.name, groupOf(a), a.store),
      });
    }
    return { assets: out };
  },

  // Accept a transferred ArrayBuffer OR a Blob/File passed by structured
  // clone. The Blob path is by reference - no >2 GB allocation - but for
  // very large files prefer the chunked upload commands below.
  'assets.import': async ({ p, bytes }) => {
    if (!(bytes instanceof ArrayBuffer) && !(bytes instanceof Blob)) {
      throw new ApiError('bad-payload', 'bytes must be an ArrayBuffer or Blob');
    }
    const fileName = typeof p.fileName === 'string' ? p.fileName : '';
    if (!fileName) {
      throw new ApiError('bad-payload', 'fileName is required');
    }
    const folder = typeof p.folder === 'string' ? p.folder : '';
    const store = requireStoreOpt(p.store) ?? 'main';
    const replace = p.replace === true;
    const opts = isRecord(p.options) ? p.options : {};
    const file = new File([bytes], fileName);
    return await importAndReport(file, p.format, folder, store, replace, opts);
  },

  // The VIEWER downloads each URL (nothing rides postMessage). Every file
  // names its own format (a .glb URL is ambiguous, so nothing is inferred
  // here). Downloads run `concurrent` at a time; cooking stays serial.
  'assets.importUrl': async ({ p }) => {
    const files = records(p.files, 'files');
    if (files.length === 0) {
      throw new ApiError('bad-payload', 'files must be a non-empty array');
    }
    const concurrent = Math.max(1, Math.min(8, typeof p.concurrent === 'number' ? Math.round(p.concurrent) : 3));
    const store = requireStoreOpt(p.store) ?? 'main';
    const replace = p.replace === true;
    const batchId = typeof p.batchId === 'string' ? p.batchId : undefined;
    return await importUrlBatch(files, concurrent, store, replace, batchId);
  },

  // chunk upload (large files: the SDK splits a File into transfers). The
  // cross-tab import lock is held for the whole upload (begin..finish) so no
  // other tab/window imports meanwhile, and a blocking dialog shows progress.
  'assets.uploadBegin': async ({ p }) => {
    const fileName = typeof p.fileName === 'string' ? p.fileName : '';
    if (!fileName) {
      throw new ApiError('bad-payload', 'fileName is required');
    }
    const total = typeof p.size === 'number' ? p.size : 0;
    const release = await acquireImportLock();
    if (!release) {
      throw new ApiError('busy', 'another import is already running');
    }
    try {
      const uploadId = crypto.randomUUID();
      // Keep ONE writable open for the whole upload: sequential appends, no
      // per-chunk open/close (that churn left the file's snapshot unreadable
      // -> NotReadableError at finish). createWritable() truncates to fresh.
      const handle = await (await uploadsTempDir()).getFileHandle(`${uploadId}.part`, { create: true });
      const writable = await handle.createWritable();
      uploads.set(uploadId, { fileName, received: 0, total, handle, writable, release });
      dialogs.loading('Receiving 0 %', `Uploading ${fileName}`);
      return { uploadId };
    } catch (e) {
      await release(); // never strand the lock if staging setup failed
      throw e;
    }
  },

  'assets.uploadChunk': async ({ p, bytes }) => {
    const uploadId = typeof p.uploadId === 'string' ? p.uploadId : '';
    const sess = uploads.get(uploadId);
    if (!sess) {
      throw new ApiError('not-found', 'unknown or finished uploadId');
    }
    if (!(bytes instanceof ArrayBuffer) && !(bytes instanceof Blob)) {
      throw new ApiError('bad-payload', 'chunk bytes must be an ArrayBuffer or Blob');
    }
    await sess.writable.write(bytes); // sequential append to the open stream
    sess.received += bytes instanceof Blob ? bytes.size : bytes.byteLength;
    if (sess.total > 0) {
      dialogs.loading(`Receiving ${Math.floor((sess.received / sess.total) * 100)} %`, `Uploading ${sess.fileName}`);
    }
    return { received: sess.received };
  },

  'assets.uploadFinish': async ({ p }) => {
    const uploadId = typeof p.uploadId === 'string' ? p.uploadId : '';
    const sess = uploads.get(uploadId);
    if (!sess) {
      throw new ApiError('not-found', 'unknown or finished uploadId');
    }
    const folder = typeof p.folder === 'string' ? p.folder : '';
    const store = requireStoreOpt(p.store) ?? 'main';
    const replace = p.replace === true;
    const opts = isRecord(p.options) ? p.options : {};
    uploads.delete(uploadId);
    let released = false;
    const releaseOnce = async () => {
      if (!released) {
        released = true;
        await sess.release();
      }
    };
    try {
      await sess.writable.close(); // flush + drop the OPFS write lock FIRST
      const staged = await sess.handle.getFile(); // now a valid, readable snapshot
      const file = new File([staged], sess.fileName);
      // hand the import lock to the importer (it re-acquires + shows its own
      // dialog); release before importing or it would see the lock busy.
      await releaseOnce();
      return await importAndReport(file, p.format, folder, store, replace, opts);
    } finally {
      await releaseOnce();
      await deleteFile(await uploadsTempDir(), `${uploadId}.part`);
      dialogs.hideLoading();
    }
  },

  'assets.uploadAbort': async ({ p }) => {
    const uploadId = typeof p.uploadId === 'string' ? p.uploadId : '';
    const sess = uploads.get(uploadId);
    uploads.delete(uploadId);
    if (sess) {
      try {
        await sess.writable.abort();
      } catch {
        /* already closed */
      }
      await sess.release();
    }
    await deleteFile(await uploadsTempDir(), `${uploadId}.part`);
    dialogs.hideLoading();
    return {};
  },

  // Deletes the persisted asset only; a copy already loaded into the viewer
  // stays on screen - import -> load -> remove = a session-only model.
  'assets.remove': async ({ p }) => {
    const ids = strings(p.ids, 'ids');
    const store = requireStoreOpt(p.store);
    const targets = assetsState
      .get()
      .assets.filter((a) => ids.includes(a.id) && (!store || a.store === store))
      .map((a) => a.id);
    if (targets.length) {
      await assetsActions.deleteByIds(targets, 'removed');
    }
    return { removed: targets.length };
  },

  'assets.load': async ({ p }) => {
    const ids = strings(p.ids, 'ids');
    const store = requireStoreOpt(p.store);
    let loaded = 0;
    const boxes: { min: number[]; max: number[] }[] = [];
    for (const id of ids) {
      const entry = assetsState.get().assets.find((a) => a.id === id);
      if (!entry || (store && entry.store !== store)) {
        continue;
      }
      if (await loadAssetIntoViewer(id)) {
        loaded++;
        const b = entry.bounds;
        const box = b?.dense ?? b?.full;
        if (box) {
          boxes.push({ min: box.slice(0, 3), max: box.slice(3, 6) });
        }
      }
    }
    if (loaded > 0) {
      viewerActions.bumpModelsVersion();
      if (p.fit !== false && boxes.length > 0) {
        const min = [Infinity, Infinity, Infinity];
        const max = [-Infinity, -Infinity, -Infinity];
        for (const b of boxes) {
          for (let k = 0; k < 3; k++) {
            min[k] = Math.min(min[k], b.min[k]);
            max[k] = Math.max(max[k], b.max[k]);
          }
        }
        getRenderer()?.fitBounds(min, max);
      }
    }
    return { loaded };
  },

  'assets.unload': async ({ p }) => {
    const ids = strings(p.ids, 'ids');
    const entries = assetsState.get().assets.filter((a) => ids.includes(a.id));
    const indices = await db.indicesForPaths(entries.map((a) => ({ name: a.name, group: groupOf(a), store: a.store })));
    if (indices.length > 0) {
      await viewerActions.removeModelsQuiet(indices);
    }
    return { unloaded: indices.length };
  },

  /** Declarative load state: make the loaded set EXACTLY `ids` — anything
   *  loaded but not listed is unloaded, anything listed but not loaded is
   *  loaded, anything already right is untouched. Scoped to `store` when
   *  given (assets in other stores are then never considered, in either
   *  direction). Unloads run before loads so VRAM frees first. */
  'assets.setLoaded': async ({ p }) => {
    const ids = strings(p.ids, 'ids');
    const store = requireStoreOpt(p.store);
    const want = new Set(ids);
    const scoped = assetsState.get().assets.filter((a) => !store || a.store === store);
    const byId = new Map(scoped.map((a) => [a.id, a] as const));
    const missing = ids.filter((id) => !byId.has(id));

    const toUnload: typeof scoped = [];
    const toLoad: string[] = [];
    for (const a of scoped) {
      const isLoaded = await db.hasModel(a.name, groupOf(a), a.store);
      if (want.has(a.id) && !isLoaded) {
        toLoad.push(a.id);
      } else if (!want.has(a.id) && isLoaded) {
        toUnload.push(a);
      }
    }

    if (toUnload.length > 0) {
      const indices = await db.indicesForPaths(
        toUnload.map((a) => ({ name: a.name, group: groupOf(a), store: a.store })),
      );
      if (indices.length > 0) {
        await viewerActions.removeModelsQuiet(indices);
      }
    }

    let loaded = 0;
    for (const id of toLoad) {
      if (await loadAssetIntoViewer(id)) {
        loaded++;
      }
    }
    if (loaded > 0 || toUnload.length > 0) {
      viewerActions.bumpModelsVersion();
    }
    // fit (opt-in — a background sync should not move the camera) frames the
    // union of the whole DESIRED set, not just what this call loaded
    if (p.fit === true) {
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      let any = false;
      for (const id of ids) {
        const b = byId.get(id)?.bounds;
        const box = b?.dense ?? b?.full;
        if (box) {
          any = true;
          for (let k = 0; k < 3; k++) {
            min[k] = Math.min(min[k], box[k]);
            max[k] = Math.max(max[k], box[k + 3]);
          }
        }
      }
      if (any) {
        getRenderer()?.fitBounds(min, max);
      }
    }
    return { loaded, unloaded: toUnload.length, missing };
  },
};
