// Store + asset commands: listing, single-shot import, URL-batch import, the
// chunked upload session, remove/load/unload. See EVENTS.md for the payload
// contracts.
import { dialogs } from '../../components/dialogs/dialogs.actions';
import { acquireImportLock, assetsActions, loadIdsPooled } from '../../state/assets/assets.actions';
import { type AssetEntry, assetsState, groupOf } from '../../state/assets/assets.state';
import { storesActions } from '../../state/stores/stores.actions';
import { normalizeStoreName, storeExists, storesState } from '../../state/stores/stores.state';
import { db } from '../../state/viewer/db';
import { getRenderer, viewerActions } from '../../state/viewer/viewer.actions';
import { deleteFile, uploadsTempDir } from '../opfs/opfs';
import { applyCameraPayload } from './handlersViewer';
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
  quiet = false,
  meta?: Record<string, unknown>,
): Promise<{ entries: unknown[]; replaced: number }> {
  const before = assetsState.get().assets;
  const beforeIds = new Set(before.map((a) => a.id));
  // replace-if-exists, load-after-import and temp are panel checkboxes; a host
  // must not inherit whatever the user last ticked, so all are passed
  // explicitly. The importer drops the replaced asset(s) AFTER the new one
  // lands, so a failed import never deletes anything.
  const behaviour = { replace, load: false, temp: false, quiet, ...(meta ? { meta } : {}) };
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
    ...(a.meta ? { meta: a.meta } : {}),
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

/** Wire shape of one imported asset. */
const toApiEntry = (a: AssetEntry) => ({
  id: a.id,
  store: a.store,
  name: a.name,
  folder: a.folder,
  fileName: a.fileName,
  md5: a.md5,
  size: a.size,
  kind: a.kind,
  hasNormals: a.hasNormals,
  ...(a.meta ? { meta: a.meta } : {}),
  loaded: false,
});

/** Formats whose whole import is ONE single-file cook, so they ride a single
 *  pooled batch — download and cook pipeline per file, `concurrent` at a time.
 *  The converters (rvm / ifc / step) are multi-phase, spawn their own workers
 *  and stage through shared temp dirs, so they run one after another. */
const POOLED_FORMATS = new Set(['glb-merged', 'glb-standard', 'tdp']);

/** Give a downloaded file the extension its pipeline is routed by (the
 *  importer picks cook vs store-as-cooked off the name, and a URL's last
 *  segment often carries no extension at all). */
function pipelineName(fileName: string, format: string): string {
  if (format === 'tdp') {
    return /\.tdp$/i.test(fileName) ? fileName : `${fileName}.tdp`;
  }
  return /\.glb$/i.test(fileName) ? fileName : `${fileName}.glb`;
}

/** Fetch to an ArrayBuffer, reporting bytes as they arrive. Falls back to a
 *  plain buffer read when the response has no readable body stream. */
async function downloadBytes(url: string, onBytes: (loaded: number, total: number) => void): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  const total = Number(res.headers.get('content-length') ?? 0);
  if (!res.body) {
    const buf = await res.arrayBuffer();
    onBytes(buf.byteLength, buf.byteLength);
    return buf;
  }
  const reader = res.body.getReader();
  // copied per chunk so the array is provably ArrayBuffer-backed (a stream
  // chunk's buffer type is ArrayBufferLike, which a Blob part rejects)
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let loaded = 0;
  let lastReport = 0;
  for (let r = await reader.read(); !r.done; r = await reader.read()) {
    chunks.push(new Uint8Array(r.value));
    loaded += r.value.length;
    // throttle: every 5% of a known total, else every 8 MB
    const step = total > 0 ? total / 20 : 8 * 1024 * 1024;
    if (loaded - lastReport >= step) {
      lastReport = loaded;
      onBytes(loaded, total);
    }
  }
  onBytes(loaded, total || loaded);
  // assemble via a Blob rather than a manual copy: the browser can keep it
  // disk-backed, so a multi-GB file is not held twice in RAM at once
  const blob = new Blob(chunks);
  chunks.length = 0;
  return await blob.arrayBuffer();
}

type UrlJob = {
  index: number;
  url: string;
  format: string;
  fileName: string;
  folder: string;
  options: Record<string, unknown>;
  meta?: Record<string, unknown>;
};

/** Import a batch of files the VIEWER downloads. The whole batch takes the
 *  import lock ONCE, so the per-file imports inside run without re-queuing
 *  behind it: the pooled formats (glb / tdp) download AND cook `concurrent` at
 *  a time in one cooker pool, while the converters (rvm / ifc / step) follow
 *  serially. `quiet` drives no app dialogs — for a host that subscribed to the
 *  progress events and shows its own UI. One outcome per input file, in order;
 *  a download/convert failure is recorded, never thrown. */
async function importUrlBatch(
  files: Record<string, unknown>[],
  concurrent: number,
  store: string,
  replace: boolean,
  batchId: string | undefined,
  quiet: boolean,
): Promise<{ imported: number; failed: number; results: ImportUrlOutcome[] }> {
  const total = files.length;
  const results: ImportUrlOutcome[] = new Array(total);
  let completed = 0;
  const emit = (index: number, url: string, phase: string, extra?: Record<string, number>) =>
    emitApiEvent('assets.importUrl:progress', {
      ...(batchId ? { batchId } : {}),
      completed,
      total,
      index,
      url,
      phase,
      ...extra,
    });
  const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
  const fail = (index: number, url: string, error: string) => {
    results[index] = { url, ok: false, error };
    completed++;
    emit(index, url, 'error');
  };

  // 1. validate every entry up front — a bad one never reaches the lock
  const jobs: UrlJob[] = [];
  for (let i = 0; i < total; i++) {
    const f = files[i];
    const url = typeof f.url === 'string' ? f.url : '';
    if (!url) {
      fail(i, '', 'url must be a string');
      continue;
    }
    const format = f.format;
    if (typeof format !== 'string' || !IMPORT_FORMATS.has(format)) {
      fail(i, url, `unknown format ${String(format)}`);
      continue;
    }
    jobs.push({
      index: i,
      url,
      format,
      fileName: typeof f.fileName === 'string' && f.fileName ? f.fileName : fileNameFromUrl(url, `file-${i}`),
      folder: typeof f.folder === 'string' ? f.folder : '',
      options: isRecord(f.options) ? f.options : {},
      ...(isRecord(f.meta) ? { meta: f.meta } : {}),
    });
  }

  if (jobs.length > 0) {
    // ONE lock for the whole batch: the imports below then run inline instead
    // of each waiting for (and re-showing) the app-wide import lock.
    const release = await acquireImportLock();
    if (!release) {
      throw new ApiError('busy', 'another import is already running');
    }
    const behaviour = { replace, load: false, temp: false, quiet };
    try {
      const pooled = jobs.filter((j) => POOLED_FORMATS.has(j.format));
      const serial = jobs.filter((j) => !POOLED_FORMATS.has(j.format));

      if (pooled.length > 0) {
        // lazy bytes(): the pool slot downloads, then cooks — so `concurrent`
        // files are in flight end-to-end and a slow download never blocks a
        // cook that is ready to run
        const sources = pooled.map((j) => ({
          name: pipelineName(j.fileName, j.format),
          folder: j.folder,
          standardGlb: j.format === 'glb-standard',
          ...(j.meta ? { meta: j.meta } : {}),
          stdOptions: {
            ...(typeof j.options.normals === 'boolean' ? { normals: j.options.normals } : {}),
            ...(typeof j.options.edges === 'boolean' ? { edges: j.options.edges } : {}),
          },
          bytes: async () => {
            emit(j.index, j.url, 'download');
            let buf: ArrayBuffer;
            try {
              buf = await downloadBytes(j.url, (loaded, bytesTotal) =>
                emit(j.index, j.url, 'download', { loaded, totalBytes: bytesTotal }),
              );
            } catch (e) {
              throw new Error(`download failed: ${errMsg(e)}`);
            }
            emit(j.index, j.url, 'convert');
            return buf;
          },
        }));
        const done = await assetsActions.importSourcesLocked(sources, {
          folder: '',
          store,
          concurrency: concurrent,
          ...behaviour,
          onSourceDone: (i, r) => {
            const j = pooled[i];
            if (r.error) {
              // the download phase reports its own failure text verbatim
              fail(j.index, j.url, r.error);
              return;
            }
            completed++;
            emit(j.index, j.url, 'done');
          },
        });
        for (const d of done) {
          const j = pooled[d.index];
          results[j.index] = { url: j.url, ok: true, entries: [toApiEntry(d.entry)], replaced: d.replaced };
        }
      }

      // converters: one at a time (each spawns its own workers and stages
      // through a shared temp dir), but still inside the batch's single lock
      for (const j of serial) {
        try {
          emit(j.index, j.url, 'download');
          let buf: ArrayBuffer;
          try {
            buf = await downloadBytes(j.url, (loaded, bytesTotal) =>
              emit(j.index, j.url, 'download', { loaded, totalBytes: bytesTotal }),
            );
          } catch (e) {
            throw new Error(`download failed: ${errMsg(e)}`);
          }
          emit(j.index, j.url, 'convert');
          const file = new File([buf], j.fileName);
          const r = await importAndReport(file, j.format, j.folder, store, replace, j.options, quiet, j.meta);
          results[j.index] = { url: j.url, ok: true, entries: r.entries, replaced: r.replaced };
          completed++;
          emit(j.index, j.url, 'done');
        } catch (e) {
          fail(j.index, j.url, errMsg(e));
        }
      }
    } finally {
      await release();
    }
  }

  // a pooled source that never ran (pool torn down early) has no result yet
  for (let i = 0; i < total; i++) {
    if (!results[i]) {
      const j = jobs.find((x) => x.index === i);
      results[i] = { url: j?.url ?? '', ok: false, error: 'import produced no entries (see the Console panel)' };
    }
  }

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

/** Load ids for the API, pooled, reporting `assets.load:progress` per model.
 *  `progress: true` (the SDK sets it when a host passes onProgress) means the
 *  host draws its own UI, so the viewer's overlay stays down. Returns the ids
 *  that actually loaded, in input order. */
async function loadWithProgress(ids: string[], p: Record<string, unknown>): Promise<string[]> {
  const quiet = p.progress === true;
  const batchId = typeof p.batchId === 'string' ? p.batchId : undefined;
  const concurrency =
    typeof p.concurrent === 'number' && p.concurrent > 0 ? Math.min(16, Math.round(p.concurrent)) : undefined;
  const total = ids.length;
  let completed = 0;
  const ok = await loadIdsPooled(ids, {
    quiet,
    ...(concurrency ? { concurrency } : {}),
    onDone: (index, id, loaded) => {
      completed++;
      emitApiEvent('assets.load:progress', {
        ...(batchId ? { batchId } : {}),
        completed,
        total,
        index,
        id,
        phase: loaded ? 'done' : 'error',
      });
    },
  });
  // input order, not completion order — hosts index results by their own list
  const okSet = new Set(ok);
  return ids.filter((id) => okSet.has(id));
}

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
        ...(a.meta ? { meta: a.meta } : {}),
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
    const meta = isRecord(p.meta) ? p.meta : undefined;
    return await importAndReport(file, p.format, folder, store, replace, opts, false, meta);
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
    // the host subscribed to the progress events — it draws its own UI, so the
    // viewer drives no import dialogs for this batch
    const quiet = p.progress === true;
    return await importUrlBatch(files, concurrent, store, replace, batchId, quiet);
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
      return await importAndReport(
        file,
        p.format,
        folder,
        store,
        replace,
        opts,
        false,
        isRecord(p.meta) ? p.meta : undefined,
      );
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
    const known = new Map(assetsState.get().assets.map((a) => [a.id, a] as const));
    const wanted = ids.filter((id) => {
      const entry = known.get(id);
      return entry !== undefined && (!store || entry.store === store);
    });
    // an explicit camera REPLACES the fit, and by default moves FIRST — the
    // view is already in place as the models appear, instead of the models
    // popping in and the camera then travelling. `cameraFirst: false` moves
    // after the load (e.g. to animate onto something that just arrived).
    const camera = isRecord(p.camera) ? p.camera : null;
    const cameraFirst = p.cameraFirst !== false;
    if (camera && cameraFirst) {
      applyCameraPayload(camera);
    }
    const loadedIds = await loadWithProgress(wanted, p);
    if (loadedIds.length > 0) {
      viewerActions.bumpModelsVersion();
      if (camera) {
        if (!cameraFirst) {
          applyCameraPayload(camera);
        }
      } else if (p.fit !== false) {
        const min = [Infinity, Infinity, Infinity];
        const max = [-Infinity, -Infinity, -Infinity];
        let any = false;
        for (const id of loadedIds) {
          const b = known.get(id)?.bounds;
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
    }
    return { loaded: loadedIds.length };
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

    // an explicit camera REPLACES the fit (and needs no opt-in: passing one
    // IS the instruction to move); it moves BEFORE the loads unless
    // `cameraFirst: false`
    const camera = isRecord(p.camera) ? p.camera : null;
    const cameraFirst = p.cameraFirst !== false;
    if (camera && cameraFirst) {
      applyCameraPayload(camera);
    }
    const loaded = (await loadWithProgress(toLoad, p)).length;
    if (loaded > 0 || toUnload.length > 0) {
      viewerActions.bumpModelsVersion();
    }
    if (camera) {
      if (!cameraFirst) {
        applyCameraPayload(camera);
      }
    }
    // fit (opt-in — a background sync should not move the camera) frames the
    // union of the whole DESIRED set, not just what this call loaded
    else if (p.fit === true) {
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
