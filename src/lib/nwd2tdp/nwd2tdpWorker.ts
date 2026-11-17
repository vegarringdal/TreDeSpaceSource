// NWD / NWC → cooked .tdp worker, via the prebuilt nwd wasm (./wasm — see its
// README for how it is built). Nothing is held in this worker's memory: the
// converter pulls the picked file through io.read in slices, straight from
// disk (FileReaderSync), and every cooked output leaves through io.write to a
// writer sub-worker that appends it to OPFS temp/nwd-import/ while the
// conversion runs. Only wasm holds the file — its parser needs random access
// over the inflated container. Every root's merged model is cooked into
// `<root>.tdp` + `<root>.coarse.tdp` — no GLB is built — and the main thread
// reads the files back from the temp folder to land them in a store.
import * as Comlink from 'comlink';
import { NWD_TEMP_DIR } from '../opfs/opfs';
import { openTempFileSink } from '../opfs/tempFileSink';
import { describeConverterFailure } from '../worker/converterFailure';
import { fileInputIo } from '../worker/fileInput';
import { nwdMeshoptOptions } from './nwdSimplify';
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
  /** Simplify each part after the weld (meshopt). */
  simplify: boolean;
  /** Lowest percentage of a part's triangles the simplifier may leave. */
  simplifyKeep: number;
  /** Error budget of the simplifier, percent of the part's size. */
  simplifyError: number;
  /** What the file's coordinates are in (the output is metres). */
  units: NwdUnits;
}

export interface NwdOutput {
  /** Cooked files written to OPFS temp/nwd-import/ — `<name>.tdp` and its
   *  `<name>.coarse.tdp` sibling. */
  readonly files: { name: string; size: number }[];
  /** status_file.json text, if the converter emitted one. */
  readonly status: string | null;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const STATUS_FILE = 'status_file.json';

const api = {
  /** Startup handshake for spawnComlinkWorker. */
  ping: () => true,

  /** Convert + cook `file` into OPFS temp/nwd-import/ (the caller clears it
   *  before and after); `onProgress` fires once per cooked model. */
  async convert(
    file: File,
    sourceName: string,
    opts: NwdOptions,
    onProgress: (outputs: number) => void,
  ): Promise<NwdOutput> {
    const wasm = await ready;
    const sink = openTempFileSink(NWD_TEMP_DIR);
    /** Open outputs: the name and the bytes written so far. The status file
     *  is small and wanted as text, so it is kept here instead of on disk. */
    const outputs = new Map<number, { name: string; at: number; text: Uint8Array[] }>();
    const files: { name: string; size: number }[] = [];
    let status: string | null = null;
    let nextId = 0;
    let written = 0;
    const io = {
      ...fileInputIo(file),
      open: (name: string): number => {
        nextId += 1;
        outputs.set(nextId, { name, at: 0, text: [] });
        return nextId;
      },
      write: (handle: number, chunk: Uint8Array) => {
        const out = outputs.get(handle);
        if (!out) {
          return;
        }
        if (out.name === STATUS_FILE) {
          out.text.push(new Uint8Array(chunk));
        } else if (/\.tdp$/i.test(out.name)) {
          sink.write(out.name, out.at, chunk);
        }
        out.at += chunk.length;
      },
      close: (handle: number) => {
        const out = outputs.get(handle);
        outputs.delete(handle);
        if (!out) {
          return;
        }
        if (out.name === STATUS_FILE) {
          const decoder = new TextDecoder();
          status = out.text.map((part) => decoder.decode(part, { stream: true })).join('') + decoder.decode();
        } else if (/\.tdp$/i.test(out.name)) {
          sink.end(out.name, out.at);
          files.push({ name: out.name, size: out.at });
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
    const meshopt = nwdMeshoptOptions(opts);
    o.meshopt_threshold = meshopt.threshold;
    o.meshopt_target_error = meshopt.targetError;
    o.unit_scale = nwdUnitScale(opts.units);
    try {
      try {
        // compute_normals follows the option; coarsen=true like every cooked import
        convert_streaming_tdp(io, o, sourceName, opts.normals, true);
      } catch (error) {
        // no o.free(): after a trap the module is dead, and this worker is
        // terminated as soon as the call returns
        const msg = describeConverterFailure({
          error,
          converter: 'Navisworks',
          sourceName,
          sourceBytes: file.size,
          memoryBytes: wasm.memory.buffer.byteLength,
        });
        throw msg ? new Error(msg) : error;
      }
      o.free();
      // every queued chunk must be on disk before the main thread reads the files
      await sink.flush();

      return { files, status };
    } finally {
      sink.terminate();
    }
  },
};

export type Nwd2TdpApi = typeof api;
Comlink.expose(api);
