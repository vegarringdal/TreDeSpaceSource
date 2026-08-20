// Worker-only OPFS writer: stream bytes to a path from the OPFS ROOT with a
// synchronous access handle (createSyncAccessHandle does not exist on the main
// thread). Shared by the modeldb and cooker workers.

export async function opfsDirFromRoot(dirPath: string[], create: boolean): Promise<FileSystemDirectoryHandle> {
  let dir = await navigator.storage.getDirectory();
  for (const part of dirPath) {
    dir = await dir.getDirectoryHandle(part, { create });
  }
  return dir;
}

/** The worker-only sync access handle API, missing from TS's lib.dom. */
interface SyncHandle {
  truncate(n: number): void;
  write(b: Uint8Array, opts: { at: number }): number;
  flush(): void;
  close(): void;
}

async function openSyncHandle(relPath: string): Promise<SyncHandle> {
  const parts = relPath.split('/');
  const fileName = parts.pop();
  if (!fileName) {
    throw new Error(`bad OPFS path: "${relPath}"`);
  }
  const dir = await opfsDirFromRoot(parts, true);
  const fh = await dir.getFileHandle(fileName, { create: true });
  return await (fh as unknown as { createSyncAccessHandle(): Promise<SyncHandle> }).createSyncAccessHandle();
}

/** Write `bytes` to `relPath` (e.g. `temp/export/x.glb`), creating directories
 *  on the way. */
export async function opfsWriteFromRoot(relPath: string, bytes: Uint8Array): Promise<void> {
  const sync = await openSyncHandle(relPath);
  try {
    sync.truncate(0);
    sync.write(bytes, { at: 0 });
    sync.flush();
  } finally {
    sync.close();
  }
}

export interface OpfsByteStream {
  /** Append bytes. The data is copied into the staging buffer (or written
   *  through) before returning — the caller may reuse its array. */
  write(bytes: Uint8Array): void;
  /** Flush and release the handle; returns the final byte size. */
  close(): number;
  /** Release the handle only (partial file left for the caller to clean up). */
  abort(): void;
}

/** Open `relPath` for streamed BINARY writing (worker-only). Small chunks are
 *  batched through an 8 MB staging buffer (many tiny sync writes are slow);
 *  larger chunks write straight through — the whole file never exists in
 *  memory. */
export async function opfsOpenByteStream(relPath: string): Promise<OpfsByteStream> {
  const sync = await openSyncHandle(relPath);
  sync.truncate(0);
  const STAGE = 8 << 20;
  const stage = new Uint8Array(STAGE);
  let fill = 0;
  let at = 0;
  const flush = () => {
    if (fill === 0) {
      return;
    }
    sync.write(stage.subarray(0, fill), { at });
    at += fill;
    fill = 0;
  };
  return {
    write(bytes: Uint8Array) {
      if (bytes.byteLength >= STAGE) {
        flush();
        sync.write(bytes, { at });
        at += bytes.byteLength;
        return;
      }
      if (fill + bytes.byteLength > STAGE) {
        flush();
      }
      stage.set(bytes, fill);
      fill += bytes.byteLength;
    },
    close() {
      flush();
      sync.flush();
      sync.close();
      return at;
    },
    abort() {
      try {
        sync.close();
      } catch {
        /* already closed */
      }
    },
  };
}

/** Open `relPath` for streamed TEXT writing (worker-only, ASCII-ish content —
 *  chars are counted as bytes for the flush threshold). Fragments are buffered
 *  and encoded every ~8 MB, then pass through the byte stream. close()
 *  flushes and returns the final byte size. */
export async function opfsOpenTextStream(relPath: string): Promise<{
  write(text: string): void;
  close(): number;
  abort(): void;
}> {
  const out = await opfsOpenByteStream(relPath);
  const enc = new TextEncoder();
  let buf: string[] = [];
  let len = 0;
  const flush = () => {
    if (len === 0) {
      return;
    }
    out.write(enc.encode(buf.join('')));
    buf = [];
    len = 0;
  };
  return {
    write(text: string) {
      buf.push(text);
      len += text.length;
      if (len >= 8 << 20) {
        flush();
      }
    },
    close() {
      flush();
      return out.close();
    },
    abort() {
      out.abort();
    },
  };
}

/** Read a whole file at `relPath` from the OPFS root. */
export async function opfsReadFromRoot(relPath: string): Promise<ArrayBuffer> {
  const parts = relPath.split('/');
  const fileName = parts.pop();
  if (!fileName) {
    throw new Error(`bad OPFS path: "${relPath}"`);
  }
  const dir = await opfsDirFromRoot(parts, false);
  const fh = await dir.getFileHandle(fileName);
  return (await fh.getFile()).arrayBuffer();
}
