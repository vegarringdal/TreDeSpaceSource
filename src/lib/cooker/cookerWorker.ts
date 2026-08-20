// Cooker worker: GLB → cooked CADM off the main thread. Merged GLBs
// (rvm2glb web3dversion 2) go through the Rust wasm cooker (byte-identical to
// the reference); anything else falls back to the TS generic cook — standard
// node trees and EXT_mesh_gpu_instancing, with authored normals. The cooked
// bytes are written straight into OPFS from here with a SYNCHRONOUS access
// handle (createSyncAccessHandle is worker-only), so the main thread never
// touches the payload.
import * as Comlink from 'comlink';
import { opfsReadFromRoot, opfsWriteFromRoot } from '../opfs/opfsSyncWrite';
import { cookGenericGlb } from './cook';
import init, { cook } from './wasm/cooker_wasm.js';

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
  /** size of the coarse variant written next to the full cook (absent when
   * not requested, unsupported by the wasm build, or the coarse cook failed) */
  coarseSize?: number;
}

const api = {
  /** Cook a MERGED GLB (rvm2glb web3dversion 2) and store the result as
   *  model_assets/<outFileName> (callers pass `<store>/<id>.tdp`, and the
   *  store directory is created on the way). Standard files are rejected here — the
   *  dedicated single-file import (cookStandardToOpfs) handles those, so the
   *  bulk folder flow stays strict. `coarsePath` additionally cooks + writes
   *  the aggressive low-detail variant (VRAM-budget residency swap) from the
   *  same GLB — it must happen here because the bytes were transferred into
   *  this worker. A coarse failure never fails the import. */
  async cookToOpfs(glbBytes: ArrayBuffer, outFileName: string, coarsePath?: string): Promise<CookOutcome> {
    await ready;
    const u8 = new Uint8Array(glbBytes);
    const res = cook(u8, false, false);
    const bytes = res.bytes; // getter copies out of wasm memory
    const rootName = res.rootName;
    const bounds = Array.from(res.bounds);
    const dense = Array.from(res.dense);
    res.free();
    await opfsSyncWrite(outFileName, bytes);
    let coarseSize: number | undefined;
    if (coarsePath) {
      try {
        const cres = cook(u8, false, true);
        const cbytes = cres.bytes;
        cres.free();
        await opfsSyncWrite(coarsePath, cbytes);
        coarseSize = cbytes.byteLength;
      } catch (e) {
        console.warn(`coarse cook failed for ${coarsePath} (full cook unaffected):`, e);
      }
    }
    return { rootName, size: bytes.byteLength, bounds, dense, kind: 'merged', hasNormals: false, coarseSize };
  },

  /** Cook a STANDARD glTF (plain node tree or EXT_mesh_gpu_instancing) via
   *  the TS generic cook. `normals` = keep authored normals (smooth shading;
   *  off = flat shading with the full edge detection). */
  async cookStandardToOpfs(glbBytes: ArrayBuffer, outFileName: string, normals: boolean): Promise<CookOutcome> {
    const { bytes, hasNormals } = await cookGenericGlb(glbBytes, { normals });
    const u8 = new Uint8Array(bytes);
    const dv = new DataView(bytes);
    const bounds = [0, 1, 2, 3, 4, 5].map((k) => dv.getFloat32(48 + k * 4, true));
    await opfsSyncWrite(outFileName, u8);
    return { rootName: '', size: bytes.byteLength, bounds, dense: null, kind: 'standard', hasNormals };
  },

  /** Export-panel .tdp: read a GLB the modeldb worker left in OPFS, generic-cook
   *  it, and stream the result back to OPFS. Paths are from the OPFS root
   *  (temp/export/…) — nothing large ever crosses to the main thread. */
  async cookOpfsGlbToTdp(inPath: string, outPath: string): Promise<{ size: number }> {
    const glb = await opfsReadFromRoot(inPath);
    // no computed normals (exports mirror the app's flat-shaded look); the
    // export GLB is already Z-up with no wrapper — cook it without rotating
    const { bytes } = await cookGenericGlb(glb, { normals: false, zUpInput: true });
    await opfsWriteFromRoot(outPath, new Uint8Array(bytes));
    return { size: bytes.byteLength };
  },
};

export type CookerApi = typeof api;
Comlink.expose(api);
