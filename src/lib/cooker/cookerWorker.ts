// Cooker worker: GLB → cooked CADM off the main thread. Merged GLBs
// (rvm2glb web3dversion 2) go through the Rust wasm cooker (byte-identical to
// the reference); anything else falls back to the TS generic cook — standard
// node trees and EXT_mesh_gpu_instancing, with authored normals. The cooked
// bytes are written straight into OPFS from here with a SYNCHRONOUS access
// handle (createSyncAccessHandle is worker-only), so the main thread never
// touches the payload. The source MD5 the asset index records is computed
// here too — the bytes were transferred in anyway, and a scalar hash over a
// GB-scale file is exactly the stall the main thread must not take.
import * as Comlink from 'comlink';
import { md5Hex } from '../md5';
import type { MergedFlatModel } from '../model/mergedFlat';
import { opfsWriteFromRoot } from '../opfs/opfsSyncWrite';
import { cookGenericGlb } from './cook';
import init, { coarsenTdp, cook, cookMergedModel } from './wasm/cooker_wasm.js';

const ready = init();

/** Write into model_assets/<relPath> — callers pass `<store>/<id>.tdp`
 *  (stores are real directories). */
const opfsSyncWrite = (relPath: string, bytes: Uint8Array) => opfsWriteFromRoot(`model_assets/${relPath}`, bytes);

export interface CookOutcome {
  rootName: string;
  size: number;
  bounds: number[];
  dense: number[] | null;
  /** merged = rvm2glb web3dversion-2 file; standard = generic glTF (incl. instanced) */
  kind: 'merged' | 'standard';
  /** the cooked file carries an authored-normal stream */
  hasNormals: boolean;
  /** MD5 (lowercase hex) of the source bytes as delivered. */
  md5: string;
  /** size of the coarse variant written next to the full cook (absent when
   * not requested, unsupported by the wasm build, or the coarse cook failed) */
  coarseSize?: number;
}

/** What `storeTdpToOpfs` reports back: the source hash plus the coarse
 *  sibling's fate — a coarse failure only costs VRAM headroom, so it is a
 *  message for the console, never an error. */
export interface StoreTdpOutcome {
  md5: string;
  coarseSize?: number;
  coarseError?: string;
}

const api = {
  /** Cook a MERGED GLB (rvm2glb web3dversion 2) and store the result as
   *  model_assets/<outFileName> (callers pass `<store>/<id>.tdp`, and the
   *  store directory is created on the way). Standard files are rejected here — the
   *  dedicated single-file import (cookStandardToOpfs) handles those, so the
   *  bulk folder flow stays strict. `coarsePath` additionally writes the
   *  aggressive low-detail variant (VRAM-budget residency swap), produced by
   *  the SAME cook call from one parse of the GLB. A coarse failure never
   *  fails the import: the cook is retried full-only. */
  async cookToOpfs(glbBytes: ArrayBuffer, outFileName: string, coarsePath?: string): Promise<CookOutcome> {
    await ready;
    const u8 = new Uint8Array(glbBytes);
    const md5 = md5Hex(u8);
    let res = coarsePath ? tryCookBoth(u8, coarsePath) : null;
    res ??= cook(u8, false, false);
    const bytes = res.bytes; // getter copies out of wasm memory
    const coarseBytes = res.coarse;
    const rootName = res.rootName;
    const bounds = Array.from(res.bounds);
    const dense = Array.from(res.dense);
    res.free();
    await opfsSyncWrite(outFileName, bytes);
    let coarseSize: number | undefined;
    if (coarsePath && coarseBytes) {
      try {
        await opfsSyncWrite(coarsePath, coarseBytes);
        coarseSize = coarseBytes.byteLength;
      } catch (e) {
        console.warn(`coarse write failed for ${coarsePath} (full cook unaffected):`, e);
      }
    }
    return { rootName, size: bytes.byteLength, bounds, dense, kind: 'merged', hasNormals: false, md5, coarseSize };
  },

  /** Cook a STANDARD glTF (plain node tree or EXT_mesh_gpu_instancing) via
   *  the TS generic cook. `normals` = keep authored normals (smooth shading;
   *  off = flat shading with the full edge detection). */
  async cookStandardToOpfs(glbBytes: ArrayBuffer, outFileName: string, normals: boolean): Promise<CookOutcome> {
    const md5 = md5Hex(new Uint8Array(glbBytes));
    const { bytes, hasNormals } = await cookGenericGlb(glbBytes, { normals });
    const u8 = new Uint8Array(bytes);
    const dv = new DataView(bytes);
    const bounds = [0, 1, 2, 3, 4, 5].map((k) => dv.getFloat32(48 + k * 4, true));
    await opfsSyncWrite(outFileName, u8);
    return { rootName: '', size: bytes.byteLength, bounds, dense: null, kind: 'standard', hasNormals, md5 };
  },

  /** Store an ALREADY-COOKED `.tdp` as model_assets/<outFileName> and give it
   *  its coarse sibling at model_assets/<coarsePath>: the one delivered with
   *  it (`coarseBytes`, the converters cook full + coarse in one pass) or,
   *  for a bare file, one rebuilt from the cooked geometry itself — so every
   *  import lands residency-swap ready. The caller validates the header before
   *  handing the bytes over (they are transferred). */
  async storeTdpToOpfs(
    tdpBytes: ArrayBuffer,
    outFileName: string,
    coarsePath: string,
    coarseBytes?: ArrayBuffer,
  ): Promise<StoreTdpOutcome> {
    await ready;
    const u8 = new Uint8Array(tdpBytes);
    const md5 = md5Hex(u8);
    await opfsSyncWrite(outFileName, u8);
    try {
      const coarse = coarseBytes ? new Uint8Array(coarseBytes) : coarsenTdp(u8);
      await opfsSyncWrite(coarsePath, coarse);
      return { md5, coarseSize: coarse.byteLength };
    } catch (e) {
      return { md5, coarseError: e instanceof Error ? e.message : String(e) };
    }
  },

  /** Export-panel .tdp: cook the viewer's own geometry, handed over as the
   *  cooker's flat merged model (built in the modeldb worker from the export
   *  tree — no GLB in between), and write the result to `outPath` (from the
   *  OPFS root, temp/export/…). No computed normals: exports mirror the app's
   *  flat-shaded look. */
  async cookMergedModelToOpfs(model: MergedFlatModel, outPath: string): Promise<{ size: number }> {
    await ready;
    const res = cookMergedModel(
      model.positions,
      model.indices,
      model.nodes,
      model.colors,
      model.ranges,
      model.hierarchyJson,
      false,
    );
    const bytes = res.bytes;
    res.free();
    await opfsWriteFromRoot(outPath, bytes);
    return { size: bytes.byteLength };
  },
};

/** Full + coarse from one parse; null when the coarse pass failed so the
 *  caller can fall back to a full-only cook (the old behaviour — a coarse
 *  failure never fails the import). */
function tryCookBoth(u8: Uint8Array, coarsePath: string): ReturnType<typeof cook> | null {
  try {
    return cook(u8, false, true);
  } catch (e) {
    console.warn(`coarse cook failed for ${coarsePath} (retrying full only):`, e);
    return null;
  }
}

export type CookerApi = typeof api;
Comlink.expose(api);
