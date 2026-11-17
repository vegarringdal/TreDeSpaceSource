// OPFS writer for the converter imports (RVM, NWD). A converter worker is
// BLOCKED inside the synchronous wasm conversion, so it can't write files
// itself until the whole conversion returns — which means every output
// buffered in memory and a long stall after the last one. Instead it posts
// each CHUNK here as the core emits it (zero-copy transfer) and this worker
// appends it to temp/<dir>/ while the conversion keeps running, so no file is
// ever held whole on either side. The converter workers reach it through
// tempFileSink.ts.
//
// Protocol: { dir } first (the folder under temp/), then { name, at, bytes }
// per chunk (ascending `at` per name), then { name, end: size } to finish
// that file, then { flush: true } once — answered with { flushed, errors }
// after every queued write has landed.

type WriterRequest =
  | { dir: string }
  | { name: string; at: number; bytes: ArrayBuffer }
  | { name: string; end: number }
  | { flush: true };

interface SyncHandle {
  truncate(n: number): void;
  write(b: Uint8Array, opts: { at: number }): number;
  flush(): void;
  close(): void;
}

let dir: Promise<FileSystemDirectoryHandle> = Promise.reject(new Error('no directory named yet'));
// a write before { dir } reports through `errors`; the rejection itself is handled there
dir.catch(() => undefined);

async function openDir(name: string): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  const temp = await root.getDirectoryHandle('temp', { create: true });

  return temp.getDirectoryHandle(name, { create: true });
}

let flushed = 0;
const errors: string[] = [];
// chain writes so flush can simply await the tail, and so the chunks of one
// file land in the order they were posted
let tail: Promise<void> = Promise.resolve();
/** Sync access handles of the files currently being appended to. */
const open = new Map<string, SyncHandle>();

async function handleFor(name: string): Promise<SyncHandle> {
  const existing = open.get(name);
  if (existing) {
    return existing;
  }
  const fh = await (await dir).getFileHandle(name, { create: true });
  // worker-only API, missing from TS's lib.dom
  const sync = await (fh as unknown as { createSyncAccessHandle(): Promise<SyncHandle> }).createSyncAccessHandle();
  sync.truncate(0);
  open.set(name, sync);
  return sync;
}

async function appendChunk(name: string, at: number, bytes: ArrayBuffer) {
  try {
    (await handleFor(name)).write(new Uint8Array(bytes), { at });
  } catch (e) {
    errors.push(`${name}: ${e instanceof Error ? e.message : e}`);
  }
}

async function endFile(name: string, size: number) {
  const sync = open.get(name);
  open.delete(name);
  if (!sync) {
    return;
  }
  try {
    sync.truncate(size);
    sync.flush();
    flushed++;
  } catch (e) {
    errors.push(`${name}: ${e instanceof Error ? e.message : e}`);
  } finally {
    sync.close();
  }
}

self.onmessage = (e: MessageEvent<WriterRequest>) => {
  const req = e.data;
  if ('dir' in req) {
    dir = openDir(req.dir);
    return;
  }
  if ('flush' in req) {
    void tail.then(() => self.postMessage({ flushed, errors }));
    return;
  }
  if ('end' in req) {
    tail = tail.then(() => endFile(req.name, req.end));
    return;
  }
  tail = tail.then(() => appendChunk(req.name, req.at, req.bytes));
};
