// STEP → cooked .tdp worker, via the prebuilt step wasm (./wasm).
// One-shot, whole-file-in-RAM (`convert_step_to_tdp`): tessellates the B-rep
// and cooks the merged model straight to CADM — no intermediate GLB is built,
// serialised or parsed — returning the `.tdp`, its coarse variant for the VRAM
// budget, and a JSON diagnostics report. (The converter also has a
// streaming/OPFS path for very large files — not wired here yet.)

import * as Comlink from 'comlink';
import init, { convert_step_to_tdp } from './wasm/step_wasm.js';

const ready = init();

export interface StepOptions {
  /** Chordal sag tolerance (mm) — smaller = smoother curves, more triangles. */
  deflectionMm: number;
  /** Max chord turn angle (deg) — smaller = smoother curves, more triangles. */
  maxAngleDeg: number;
  /** Weld positions (drops normals) — matches the app's flatshaded rendering. */
  cleanup: boolean;
}

export interface StepOutput {
  /** The cooked CADM file the viewer loads. */
  tdp: ArrayBuffer;
  /** Coarse variant for the VRAM budget, when the cook produced one. */
  coarse: ArrayBuffer | null;
  /** JSON diagnostics report (faces skipped, warnings, unit info…). */
  info: string;
}

const api = {
  async convert(
    bytes: ArrayBuffer,
    opts: StepOptions,
    onProgress: (done: number, total: number) => void,
  ): Promise<StepOutput> {
    await ready;
    // the wasm calls progress.report(done, total) synchronously
    const progress = { report: (done: number, total: number) => onProgress(done, total) };
    const result = convert_step_to_tdp(
      new Uint8Array(bytes),
      opts.deflectionMm,
      opts.maxAngleDeg,
      true, // y_up: rotate STEP Z-up → glTF Y-up
      false, // keep_normals: app is flatshaded; cleanup welds + drops normals
      opts.cleanup,
      false, // compute_normals: same flag the cooker worker uses for merged
      true, // coarsen: write the VRAM-budget variant in the same pass
      progress,
    );
    const tdpArr = result.tdp; // fresh JS-owned copy out of wasm
    const coarseArr = result.coarse;
    const info = result.info;
    result.free();
    // wasm-bindgen Vec<u8> → JS-owned ArrayBuffer
    const tdp = tdpArr.buffer as ArrayBuffer;
    const coarse = coarseArr ? (coarseArr.buffer as ArrayBuffer) : null;
    return Comlink.transfer({ tdp, coarse, info }, coarse ? [tdp, coarse] : [tdp]);
  },
};

export type Step2GlbApi = typeof api;
Comlink.expose(api);
