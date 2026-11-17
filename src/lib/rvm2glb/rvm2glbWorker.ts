// RVM → cooked .tdp worker, via the prebuilt rvm wasm (./wasm —
// see its README for how it's built/updated). Phase 1 of the RVM import: the
// main thread stages the picked .rvm into OPFS temp/rvm-import/, we stream it
// through `convert_streaming_tdp` (sync access handle reads, so the whole file
// never sits in wasm memory). The converter cooks each site's merged model
// straight to CADM — no intermediate GLB is built, serialised or parsed. The
// core writes one output at a time
// (open→write→close); each chunk is handed straight to the shared writer
// sub-worker (opfs/tempFileSink.ts), which writes temp/rvm-import/ WHILE the
// wasm call keeps this thread blocked — so a 1000-file zone split streams to
// disk instead of buffering everything and flushing after the last file.
// status_file.json (per-site parents + warnings) goes to disk the same way —
// the main thread reads it back after; other non-.tdp outputs are discarded.
import * as Comlink from 'comlink';
import { openTempFileSink } from '../opfs/tempFileSink';
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

/** The folder under temp/ the import stages into (opfs.ts `rvmTempDir`). */
const RVM_TEMP_DIR = 'rvm-import';

async function rvmTempDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  const temp = await root.getDirectoryHandle('temp', { create: true });
  return temp.getDirectoryHandle(RVM_TEMP_DIR, { create: true });
}

const api = {
  /** Startup handshake for spawnComlinkWorker. */
  ping: () => true,

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
    const sink = openTempFileSink(RVM_TEMP_DIR);
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
      write: (handle: number, bytes: Uint8Array): void => {
        const out = outputs.get(handle);
        if (!out?.keep) {
          return;
        }
        sink.write(out.name, out.at, bytes);
        out.at += bytes.length;
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
        sink.end(out.name, out.at);
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
      await sink.flush();
      return { files, info };
    } finally {
      sink.terminate();
      input.close();
    }
  },
};

export type Rvm2GlbApi = typeof api;
Comlink.expose(api);
