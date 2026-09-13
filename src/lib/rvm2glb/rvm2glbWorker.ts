// RVM → cooked .tdp worker, via the prebuilt rvm wasm (./wasm —
// see its README for how it's built/updated). Phase 1 of the RVM import: the
// main thread stages the picked .rvm into OPFS temp/rvm-import/, we stream it
// through `convert_streaming_tdp` (sync access handle reads, so the whole file
// never sits in wasm memory). The converter cooks each site's merged model
// straight to CADM — no intermediate GLB is built, serialised or parsed. The
// core writes one output at a time
// (open→write→close); each closed file is handed straight to the rvmWriter
// sub-worker (zero-copy transfer), which writes temp/rvm-import/ WHILE the
// wasm call keeps this thread blocked — so a 1000-file zone split streams to
// disk instead of buffering everything and flushing after the last file.
// status_file.json (per-site parents + warnings) goes to disk the same way —
// the main thread reads it back after; other non-.tdp outputs are discarded.
import * as Comlink from 'comlink';
import init, { convert_streaming_tdp, Options } from './wasm/rvm_wasm.js';

const ready = init();

/** UI-facing conversion options (fixed elsewhere: mode=merged, remove_empty). */
export interface RvmOptions {
  /** Hierarchy split depth: 0 SITE, 1 ZONE, 2 EQUIPMENT. */
  level: number;
  /** Tessellation chord-height tolerance. */
  tolerance: number;
  includeLines: boolean;
  lineWidth: number;
  alignElements: boolean;
}

export interface RvmProgress {
  outputIndex: number;
  name: string;
  nodes: number;
}

interface SyncHandle {
  getSize(): number;
  read(b: Uint8Array, opts: { at: number }): number;
  truncate(n: number): void;
  write(b: Uint8Array, opts: { at: number }): number;
  flush(): void;
  close(): void;
}

async function openSync(dir: FileSystemDirectoryHandle, name: string, create: boolean): Promise<SyncHandle> {
  const fh = await dir.getFileHandle(name, { create });
  // worker-only API, missing from TS's lib.dom
  return (fh as unknown as { createSyncAccessHandle(): Promise<SyncHandle> }).createSyncAccessHandle();
}

async function rvmTempDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  const temp = await root.getDirectoryHandle('temp', { create: true });
  return temp.getDirectoryHandle('rvm-import', { create: true });
}

const api = {
  /** Convert temp/rvm-import/<inputName> → cooked `.tdp` files in the same dir
   *  (plus a `<name>.coarse.tdp` per site for the VRAM budget).
   *  `onProgress` fires once per output as the core writes it (single
   *  threaded — the conversion itself blocks this worker). Returns the file
   *  names written. */
  async convert(
    inputName: string,
    sourceName: string,
    opts: RvmOptions,
    onProgress: (p: RvmProgress) => void,
  ): Promise<{ files: { name: string; size: number }[]; info: string }> {
    await ready;
    const dir = await rvmTempDir();
    const input = await openSync(dir, inputName, false);

    const o = new Options(); // CLI defaults: cleanup weld on, meshopt defaults
    o.mode = 0; // merged — the only shape the cooker accepts
    o.remove_empty = true;
    o.level = opts.level;
    o.tolerance = opts.tolerance;
    o.include_line = opts.includeLines;
    o.line_width = opts.lineWidth;
    o.align_segments = opts.alignElements;

    // The core's open/write/close callbacks are synchronous (called from
    // inside wasm), so no promise can progress here until the conversion
    // returns. Each chunk is transferred to the writer worker AS IT ARRIVES
    // (postMessage queues even from a blocked thread), so a file is never held
    // whole on this side and never concatenated — the writer appends it at the
    // running offset.
    const writer = new Worker(new URL('./rvmWriter.ts', import.meta.url), { type: 'module' });
    /** Open outputs: the name, bytes written so far, and whether we keep it. */
    const outputs = new Map<number, { name: string; at: number; keep: boolean }>();
    const files: { name: string; size: number }[] = [];
    let nextId = 0;

    const io = {
      size: () => input.getSize(),
      read: (offset: number, len: number): Uint8Array => {
        const buf = new Uint8Array(len);
        const n = input.read(buf, { at: offset });
        return n === len ? buf : buf.subarray(0, n);
      },
      open: (name: string): number => {
        nextId += 1;
        // keep the cooked files and status_file.json (parents/warnings — the
        // main thread reads it after); drop any other output, and drop it here
        // so its chunks are never copied or posted at all
        const keep = name === 'status_file.json' || /\.tdp$/i.test(name);
        outputs.set(nextId, { name, at: 0, keep });
        return nextId;
      },
      // wasm reuses its linear memory after the call, so the chunk is copied
      // once — straight into the buffer that is transferred to the writer
      write: (handle: number, bytes: Uint8Array): void => {
        const out = outputs.get(handle);
        if (!out?.keep) {
          return;
        }
        const copy = new Uint8Array(bytes);
        const buf = copy.buffer;
        writer.postMessage({ name: out.name, at: out.at, bytes: buf }, [buf]);
        out.at += copy.length;
      },
      close: (handle: number): void => {
        const out = outputs.get(handle);
        outputs.delete(handle);
        if (!out?.keep) {
          return;
        }
        if (out.name !== 'status_file.json') {
          files.push({ name: out.name, size: out.at });
        }
        writer.postMessage({ name: out.name, end: out.at });
      },
      progress: (outputIndex: number, name: string, nodes: number) => {
        onProgress({ outputIndex, name, nodes });
      },
    };

    try {
      // compute_normals=false / coarsen=true — the same flags the cooker
      // worker uses for a merged GLB, so cooked output is unchanged.
      const info = convert_streaming_tdp(io as never, o, sourceName, false, true);
      // flush: wait for the writer to confirm every queued file landed
      const done = new Promise<{ flushed: number; errors: string[] }>((resolve) => {
        writer.onmessage = (e: MessageEvent<{ flushed: number; errors: string[] }>) => resolve(e.data);
      });
      writer.postMessage({ flush: true });
      const { errors } = await done;
      if (errors.length > 0) {
        throw new Error(`failed writing ${errors.length} file(s): ${errors[0]}`);
      }
      return { files, info };
    } finally {
      writer.terminate();
      input.close();
    }
  },
};

export type Rvm2GlbApi = typeof api;
Comlink.expose(api);
