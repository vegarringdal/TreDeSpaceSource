// NWD / NWC → cooked .tdp worker, via the prebuilt nwd wasm (./wasm — see its
// README for how it is built). The Navisworks parser needs random access over
// the inflated container, so the file is handed over whole (transferred, not
// copied) and pulled into wasm through io.read. Every root's merged model is
// cooked in memory into `<root>.tdp` + `<root>.coarse.tdp` — no GLB is
// written — and the outputs come back as transferred buffers, the same
// in-RAM shape as the IFC import.
import * as Comlink from 'comlink';
import { type NwdUnits, nwdUnitScale } from './nwdUnits';
import init, { convert_streaming_tdp, Options } from './wasm/nwd_wasm.js';

const ready = init();

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** UI-facing conversion options (the Navisworks section's settings). */
export interface NwdOptions {
  /** Smooth shading: per-vertex normals in the cooked model. */
  normals: boolean;
  includeLines: boolean;
  lineWidth: number;
  /** Weld coincident vertex positions per mesh. */
  cleanup: boolean;
  /** Decimal places of the weld grid. */
  precision: number;
  /** What the file's coordinates are in (the output is metres). */
  units: NwdUnits;
}

export interface NwdOutput {
  /** Cooked files — `<name>.tdp` and its `<name>.coarse.tdp` sibling. */
  readonly files: { name: string; bytes: ArrayBuffer }[];
  /** status_file.json text, if the converter emitted one. */
  readonly status: string | null;
}

const api = {
  /** Startup handshake for spawnComlinkWorker. */
  ping: () => true,

  /** Convert + cook; `onProgress` fires once per cooked model. */
  async convert(
    bytes: ArrayBuffer,
    sourceName: string,
    opts: NwdOptions,
    onProgress: (outputs: number) => void,
  ): Promise<NwdOutput> {
    await ready;
    const input = new Uint8Array(bytes);
    /** Open outputs: name + chunks (each chunk arrives as its own copy out
     *  of wasm memory, so it is kept as it is). */
    const outputs = new Map<number, { name: string; chunks: Uint8Array[] }>();
    const files: { name: string; bytes: ArrayBuffer }[] = [];
    let status: string | null = null;
    let nextId = 0;
    let written = 0;
    const io = {
      size: () => input.byteLength,
      read: (offset: number, len: number): Uint8Array => input.subarray(offset, offset + len),
      open: (name: string): number => {
        nextId += 1;
        outputs.set(nextId, { name, chunks: [] });
        return nextId;
      },
      write: (handle: number, chunk: Uint8Array) => {
        outputs.get(handle)?.chunks.push(chunk);
      },
      close: (handle: number) => {
        const out = outputs.get(handle);
        outputs.delete(handle);
        if (!out) {
          return;
        }
        const size = out.chunks.reduce((n, c) => n + c.byteLength, 0);
        const whole = new Uint8Array(size);
        let at = 0;
        for (const c of out.chunks) {
          whole.set(c, at);
          at += c.byteLength;
        }
        if (/\.tdp$/i.test(out.name)) {
          files.push({ name: out.name, bytes: whole.buffer });
        } else if (out.name === 'status_file.json') {
          status = new TextDecoder().decode(whole);
        }
      },
      // one model = its .tdp; the coarse variant and the status file ride along
      progress: (_index: number, name: string) => {
        if (/\.tdp$/i.test(name) && !/\.coarse\.tdp$/i.test(name)) {
          written += 1;
          onProgress(written);
        }
      },
    };
    // merged per root. No normals in the intermediate model: the cook derives
    // them from the positions itself (compute_normals below)
    const o = new Options();
    o.include_line = opts.includeLines;
    o.line_width = opts.lineWidth;
    o.cleanup_position = opts.cleanup;
    o.cleanup_precision = opts.precision;
    o.unit_scale = nwdUnitScale(opts.units);
    try {
      // compute_normals follows the option; coarsen=true like every cooked import
      convert_streaming_tdp(io, o, sourceName, opts.normals, true);
    } finally {
      o.free();
    }
    return Comlink.transfer(
      { files, status },
      files.map((f) => f.bytes),
    );
  },
};

export type Nwd2TdpApi = typeof api;
Comlink.expose(api);
