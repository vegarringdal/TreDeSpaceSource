// OPFS writer for the RVM import. The rvm2glb worker is BLOCKED inside the
// synchronous wasm conversion, so it can't write files itself until the whole
// conversion returns — with a zone/equipment split that means a thousand GLBs
// buffered in memory and a long stall after the last one. Instead it posts
// each finished file here (zero-copy transfer) and this worker writes them to
// temp/rvm-import/ while the conversion keeps running.
//
// Protocol: { name, bytes } per file, then { flush: true } once — answered
// with { flushed, errors } after every queued write has landed.

type WriterRequest = { name: string; bytes: ArrayBuffer } | { flush: true };

const dir = (async () => {
  const root = await navigator.storage.getDirectory();
  const temp = await root.getDirectoryHandle('temp', { create: true });
  return temp.getDirectoryHandle('rvm-import', { create: true });
})();

let flushed = 0;
const errors: string[] = [];
// chain writes so flush can simply await the tail
let tail: Promise<void> = Promise.resolve();

async function writeOne(name: string, bytes: ArrayBuffer) {
  try {
    const fh = await (await dir).getFileHandle(name, { create: true });
    // worker-only API, missing from TS's lib.dom
    const sync = await (
      fh as unknown as {
        createSyncAccessHandle(): Promise<{
          truncate(n: number): void;
          write(b: Uint8Array, opts: { at: number }): number;
          flush(): void;
          close(): void;
        }>;
      }
    ).createSyncAccessHandle();
    try {
      sync.truncate(0);
      sync.write(new Uint8Array(bytes), { at: 0 });
      sync.flush();
    } finally {
      sync.close();
    }
    flushed++;
  } catch (e) {
    errors.push(`${name}: ${e instanceof Error ? e.message : e}`);
  }
}

self.onmessage = (e: MessageEvent<WriterRequest>) => {
  const req = e.data;
  if ('flush' in req) {
    void tail.then(() => self.postMessage({ flushed, errors }));
    return;
  }
  tail = tail.then(() => writeOne(req.name, req.bytes));
};
