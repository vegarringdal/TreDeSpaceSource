// IFC → cooked .tdp worker, via the prebuilt ifc wasm (./wasm).
// One-shot, whole-file-in-RAM: `convert_ifc_tdp` parses the IFC entity graph
// and cooks each merged output straight to CADM — no intermediate GLB is built,
// serialised or parsed — returning 1..N `.tdp` files (one per spatial tier when
// `split` is set), each with its `.coarse.tdp` sibling for the VRAM budget,
// plus a trailing status_file.json.

import * as Comlink from 'comlink';
import init, { convert_ifc_tdp, Options } from './wasm/ifc_wasm.js';

const ready = init(); // fired once at module load, awaited in convert()

/** Mirrors the wasm Options setters (strings are leniently parsed there). */
export interface IfcOptions {
  split: string; // 'none' | 'site' | 'building' | 'storey'
  quality: string; // 'lowest' | 'low' | 'medium' | 'high' | 'highest'
  spaces: string; // 'skip' | 'include' | 'separate'
  openings: string; // 'skip' | 'include' | 'separate'
  recenter: boolean;
}

export interface IfcOutput {
  /** Produced cooked files — `<name>.tdp` and its `<name>.coarse.tdp`
   *  sibling (bytes transferred zero-copy). */
  files: { name: string; bytes: ArrayBuffer }[];
  /** status_file.json text, if the converter emitted one. */
  status: string | null;
}

const api = {
  async convert(
    bytes: ArrayBuffer,
    sourceName: string,
    opts: IfcOptions,
    onProgress: (fraction: number) => void,
  ): Promise<IfcOutput> {
    await ready;
    const o = new Options();
    o.mode = 'merged'; // required — only the merged shape carries draw ranges
    o.split = opts.split;
    o.quality = opts.quality;
    o.spaces = opts.spaces;
    o.openings = opts.openings;
    o.recenter = opts.recenter;
    o.source_name = sourceName;

    // compute_normals=false / coarsen=true — the same flags the cooker worker
    // uses for a merged GLB, so cooked output is unchanged.
    const result = convert_ifc_tdp(new Uint8Array(bytes), o, (f: number) => onProgress(f), false, true);
    o.free();

    const files: { name: string; bytes: ArrayBuffer }[] = [];
    const transfers: ArrayBuffer[] = [];
    let status: string | null = null;
    for (let i = 0; i < result.len; i++) {
      const name = result.name(i);
      const data = result.bytes(i); // wasm-bindgen returns a fresh JS-owned copy
      if (!name || !data) {
        continue;
      }
      if (name.endsWith('.tdp')) {
        const buf = data.buffer as ArrayBuffer; // wasm-bindgen Vec<u8> → JS-owned ArrayBuffer
        files.push({ name, bytes: buf });
        transfers.push(buf);
      } else if (name.endsWith('.json')) {
        status = new TextDecoder().decode(data);
      }
    }
    result.free();
    return Comlink.transfer({ files, status }, transfers);
  },
};

export type Ifc2GlbApi = typeof api;
Comlink.expose(api);
