// Main-thread side of the in-app scan cook: spawn the scan2tdpp worker, cook
// one LGSX / E57 file into an OPFS file, and clean up after a failure (the
// partial output is removed; a wasm trap that kills the worker is caught).
import * as Comlink from 'comlink';
import { writeFile } from '../opfs/opfs';
import type { Result } from '../result';
import { boxToScene } from '../tdpp/cloudFrame';
import { parseHeader, parseMeta, TDPP_HEADER_SIZE, type TdppHeader } from '../tdpp/tdppFormat';
import { spawnComlinkWorker } from '../worker/spawnComlinkWorker';
import type { Scan2TdppApi } from './scan2tdppWorker';
import type { ScanCookOptions, ScanCookReport } from './scanShared';

const REMOVE_ATTEMPTS = 5;
const REMOVE_RETRY_MS = 100;

/** Source formats the cook reads (the .tdpp itself is copied, not cooked). */
export const SCAN_SOURCE_RE = /\.(lgsx|e57)$/i;

/** Cook `file` into `dir/name`; progress lines go to `onProgress`. */
export async function cookScanTo(
  file: File,
  dir: FileSystemDirectoryHandle,
  name: string,
  opts: ScanCookOptions,
  onProgress: (message: string) => void,
): Promise<Result<ScanCookReport>> {
  const spawned = await spawnComlinkWorker<Scan2TdppApi>(
    () => new Worker(new URL('./scan2tdppWorker.ts', import.meta.url), { type: 'module' }),
    'scan2tdpp',
  );
  if (!spawned.data) {
    return { error: spawned.error ?? { err: null, msg: 'scan2tdpp worker failed to start' } };
  }
  const { worker, api } = spawned.data;
  // a wasm trap kills the worker without rejecting the Comlink call — race it
  const workerDied = new Promise<never>((_, reject) => {
    worker.addEventListener('error', (e) => reject(new Error(e.message || 'scan2tdpp worker crashed')));
  });
  try {
    const out = await dir.getFileHandle(name, { create: true });
    const report = await Promise.race([api.cook(file, out, opts, Comlink.proxy(onProgress)), workerDied]);
    return { data: report };
  } catch (e) {
    // the worker first: after a crash it may still hold the output's sync
    // access handle, and a locked file cannot be removed
    worker.terminate();
    await removePartial(dir, name);
    return { error: { err: e, msg: `${file.name}: ${e instanceof Error ? e.message : String(e)}` } };
  } finally {
    worker.terminate();
  }
}

/** Remove a partial output. The lock of a just-terminated worker is released
 *  a moment after `terminate()` returns, so a refused removal is retried. */
async function removePartial(dir: FileSystemDirectoryHandle, name: string) {
  for (let attempt = 0; attempt < REMOVE_ATTEMPTS; attempt++) {
    try {
      await dir.removeEntry(name);
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'NotFoundError') {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, REMOVE_RETRY_MS));
    }
  }
}

/** Min xyz, max xyz. */
type SceneBounds = number[];

interface Placement {
  readonly bounds: SceneBounds;
  /** What the coordinates are (the file's `frame`). */
  readonly frame: string;
  readonly coordinateReport: readonly string[];
}

async function readHeader(blob: Blob): Promise<Result<TdppHeader>> {
  const h = parseHeader(new Uint8Array(await blob.slice(0, TDPP_HEADER_SIZE).arrayBuffer()));
  if (h.data && h.data.fileSize !== blob.size) {
    return { error: { err: null, msg: 'the file is truncated' } };
  }
  return h;
}

/** Where the cloud sits: its bounds in the coordinates it is placed in (the
 *  header box is along the stored axes, which the metadata may turn) and
 *  what those coordinates are. */
async function placement(blob: Blob, h: TdppHeader): Promise<Placement> {
  const bytes = new Uint8Array(await blob.slice(h.metaOffset, h.metaOffset + h.metaSize).arrayBuffer());
  const meta = parseMeta(bytes).data;
  const box = boxToScene(meta?.axes ?? null, h.boundsMin, h.boundsMax);
  const o = h.origin;
  return {
    bounds: [
      o[0] + box.min[0],
      o[1] + box.min[1],
      o[2] + box.min[2],
      o[0] + box.max[0],
      o[1] + box.max[1],
      o[2] + box.max[2],
    ],
    frame: meta?.frame ?? '',
    coordinateReport: meta?.coordinateReport ?? [],
  };
}

/**
 * Put one scan into `dir/name` as a `.tdpp`: an LGSX / E57 source is cooked
 * (the worker writes straight into the store), a `.tdpp` is validated and
 * copied as it is (a Blob write — never read whole). Either way the stored
 * file's header is checked; a bad result leaves nothing behind.
 */
export async function storeScanFile(
  file: File,
  dir: FileSystemDirectoryHandle,
  name: string,
  opts: ScanCookOptions,
  onProgress: (message: string) => void,
): Promise<Result<{ header: TdppHeader; size: number } & Placement>> {
  const fail = (msg: string, err: unknown = null) => ({ error: { err, msg: `${file.name}: ${msg}` } });
  if (SCAN_SOURCE_RE.test(file.name)) {
    const cooked = await cookScanTo(file, dir, name, opts, onProgress);
    if (cooked.error) {
      return { error: cooked.error };
    }
  } else {
    const h = await readHeader(file);
    if (!h.data) {
      return fail(`not a complete .tdpp scan — ${h.error?.msg}`);
    }
    try {
      await writeFile(dir, name, file);
    } catch (e) {
      await dir.removeEntry(name).catch(() => undefined);
      return fail(`could not be stored: ${e}`, e);
    }
  }
  const stored = await (await dir.getFileHandle(name)).getFile();
  const h = await readHeader(stored);
  if (!h.data) {
    await dir.removeEntry(name).catch(() => undefined);
    return fail(`the stored scan is unreadable — ${h.error?.msg}`);
  }
  return { data: { header: h.data, size: stored.size, ...(await placement(stored, h.data)) } };
}
