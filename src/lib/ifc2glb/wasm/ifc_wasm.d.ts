/* tslint:disable */
/* eslint-disable */

/**
 * The output files of one conversion. Iterate by index: `len()`, then `name(i)` +
 * `bytes(i)`. Includes the GLB(s) and the trailing `status_file.json`.
 */
export class ConvertedFiles {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * The file's bytes (copied out to JS as a `Uint8Array`).
     */
    bytes(i: number): Uint8Array | undefined;
    name(i: number): string | undefined;
    readonly is_empty: boolean;
    readonly len: number;
    readonly mesh_count: number;
    readonly schema: string | undefined;
    readonly triangle_count: number;
}

/**
 * Conversion options passed from JS. Strings are parsed leniently; unknown values fall
 * back to the defaults.
 */
export class Options {
    free(): void;
    [Symbol.dispose](): void;
    constructor();
    /**
     * `"merged"` | `"standard"`.
     */
    set mode(value: string);
    /**
     * `"skip"` | `"include"` | `"separate"`.
     */
    set openings(value: string);
    /**
     * `"lowest"` | `"low"` | `"medium"` | `"high"` | `"highest"`.
     */
    set quality(value: string);
    set recenter(value: boolean);
    set source_name(value: string);
    /**
     * `"skip"` | `"include"` | `"separate"`.
     */
    set spaces(value: string);
    /**
     * `"none"` | `"site"` | `"building"` | `"storey"`.
     */
    set split(value: string);
}

/**
 * Convert an IFC model to GLB(s) + `status_file.json`.
 *
 * `on_progress` is an optional JS callback `(fraction: number) => void` reporting
 * `0.0..=1.0`; pass `null`/`undefined` to skip. It fires synchronously during the (wasm)
 * conversion — a Web Worker can forward it to the main thread to drive a progress bar.
 */
export function convert_ifc(ifc_bytes: Uint8Array, opts: Options, on_progress?: Function | null): ConvertedFiles;

/**
 * IFC → cooked `.tdp`(s) in ONE step: each merged output goes straight into the
 * cooker, so no GLB is built, serialised or parsed. Names come back as
 * `<stem>.tdp`, each optionally followed by `<stem>.coarse.tdp` when `coarsen`
 * is set, plus the usual trailing `status_file.json`.
 */
export function convert_ifc_tdp(ifc_bytes: Uint8Array, opts: Options, on_progress: Function | null | undefined, compute_normals: boolean, coarsen: boolean): ConvertedFiles;

/**
 * A JSON summary of what a model contains, without producing GLBs.
 */
export function inspect_ifc(ifc_bytes: Uint8Array): string;

/**
 * Install a panic hook that forwards Rust panics to the browser console.
 */
export function start(): void;

/**
 * The `ifc2glb-wasm` crate version.
 */
export function version(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_convertedfiles_free: (a: number, b: number) => void;
    readonly __wbg_options_free: (a: number, b: number) => void;
    readonly convert_ifc: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly convert_ifc_tdp: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly convertedfiles_bytes: (a: number, b: number) => [number, number];
    readonly convertedfiles_is_empty: (a: number) => number;
    readonly convertedfiles_len: (a: number) => number;
    readonly convertedfiles_mesh_count: (a: number) => number;
    readonly convertedfiles_name: (a: number, b: number) => [number, number];
    readonly convertedfiles_schema: (a: number) => [number, number];
    readonly convertedfiles_triangle_count: (a: number) => number;
    readonly inspect_ifc: (a: number, b: number) => [number, number, number, number];
    readonly options_new: () => number;
    readonly options_set_mode: (a: number, b: number, c: number) => void;
    readonly options_set_openings: (a: number, b: number, c: number) => void;
    readonly options_set_quality: (a: number, b: number, c: number) => void;
    readonly options_set_recenter: (a: number, b: number) => void;
    readonly options_set_source_name: (a: number, b: number, c: number) => void;
    readonly options_set_spaces: (a: number, b: number, c: number) => void;
    readonly options_set_split: (a: number, b: number, c: number) => void;
    readonly version: () => [number, number];
    readonly start: () => void;
    readonly meshopt_wasm_alloc: (a: number) => number;
    readonly meshopt_wasm_free: (a: number) => void;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
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
