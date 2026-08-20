/* tslint:disable */
/* eslint-disable */

export class CookResult {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Full AABB [minX,minY,minZ,maxX,maxY,maxZ].
     */
    readonly bounds: Float32Array;
    readonly bytes: Uint8Array;
    /**
     * 10th–90th percentile dense bounds, same layout.
     */
    readonly dense: Float32Array;
    readonly rootName: string;
}

/**
 * Build the coarse variant of an already-cooked `.tdp` (CADM v7–v9) — no
 * source file needed. Geometry is rebuilt from the packed meshlet streams and
 * re-coarsened with the default settings; the item table, hierarchy, cell
 * table and bounds are copied verbatim, so the output is a valid residency
 * swap partner for the input. Throws on wrong magic/version or a truncated
 * file.
 */
export function coarsenTdp(tdp: Uint8Array): Uint8Array;

/**
 * Cook one merged GLB. Throws (JS exception) with the cooker's error message
 * on non-merged input or malformed GLBs. `coarsen` produces the aggressive
 * low-detail variant for the VRAM-budget residency swap (same item table as
 * the full cook — only geometry shrinks).
 */
export function cook(glb: Uint8Array, compute_normals: boolean, coarsen: boolean): CookResult;

/**
 * Cooker version — part of any future cache key.
 */
export function cookerVersion(): number;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_cookresult_free: (a: number, b: number) => void;
    readonly coarsenTdp: (a: number, b: number) => [number, number, number, number];
    readonly cook: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly cookerVersion: () => number;
    readonly cookresult_bounds: (a: number) => [number, number];
    readonly cookresult_bytes: (a: number) => [number, number];
    readonly cookresult_dense: (a: number) => [number, number];
    readonly cookresult_rootName: (a: number) => [number, number];
    readonly meshopt_wasm_alloc: (a: number) => number;
    readonly meshopt_wasm_free: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
