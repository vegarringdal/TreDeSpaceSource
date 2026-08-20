/* tslint:disable */
/* eslint-disable */

/**
 * Every output of one conversion (GLBs + `status_file.json`), held in RAM.
 */
export class ConvertResult {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Bytes of file `i`.
     */
    bytes(i: number): Uint8Array | undefined;
    /**
     * Name of file `i` (e.g. `"HA-PIPE.glb"`, `"status_file.json"`).
     */
    name(i: number): string | undefined;
    /**
     * Small JSON summary (`{"files":N,"warnings":M}`).
     */
    readonly info: string;
    /**
     * Number of files produced.
     */
    readonly len: number;
}

export class Options {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Defaults match the CLI (merged, remove-empty on, weld on, tolerance 0.01, …).
     */
    constructor();
    align_segments: boolean;
    cleanup_position: boolean;
    cleanup_precision: number;
    dry_run: boolean;
    /**
     * Extract the RVM structure as JSON (`<site>.json` + `base.json`) instead of GLB.
     * Overrides `mode`; honours `level`.
     */
    extract_json: boolean;
    highlight_instance: boolean;
    /**
     * Include RVM Line primitives. `false` (the default) skips them entirely —
     * they are numerous and add visual noise.
     */
    include_line: boolean;
    level: number;
    line_width: number;
    meshopt_target_error: number;
    meshopt_threshold: number;
    mode: number;
    remove_empty: boolean;
    tolerance: number;
}

/**
 * Convert RVM bytes entirely in memory; returns all outputs in a [`ConvertResult`].
 */
export function convert_in_ram(input: Uint8Array, opts: Options, source_name: string, progress: any): ConvertResult;

/**
 * Stream a conversion through a JS `Io` (OPFS-backed). Returns a small JSON summary.
 */
export function convert_streaming(io: any, opts: Options, source_name: string): string;

/**
 * RVM → cooked `.tdp` files, streaming through the same JS [`Io`] object as
 * [`convert_streaming`]: each site's merged model goes straight into the
 * cooker, so no GLB is built, serialised or parsed. With `coarsen`, the coarse
 * variant is written next to each site as `<name>.coarse.tdp`.
 */
export function convert_streaming_tdp(io: any, opts: Options, source_name: string, compute_normals: boolean, coarsen: boolean): string;

export function start(): void;

/**
 * Crate version string.
 */
export function version(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly _ZdaPv: (a: number) => void;
    readonly _ZdaPvm: (a: number, b: number) => void;
    readonly _Znam: (a: number) => number;
    readonly __wbg_convertresult_free: (a: number, b: number) => void;
    readonly __wbg_get_options_align_segments: (a: number) => number;
    readonly __wbg_get_options_cleanup_position: (a: number) => number;
    readonly __wbg_get_options_cleanup_precision: (a: number) => number;
    readonly __wbg_get_options_dry_run: (a: number) => number;
    readonly __wbg_get_options_extract_json: (a: number) => number;
    readonly __wbg_get_options_highlight_instance: (a: number) => number;
    readonly __wbg_get_options_include_line: (a: number) => number;
    readonly __wbg_get_options_level: (a: number) => number;
    readonly __wbg_get_options_line_width: (a: number) => number;
    readonly __wbg_get_options_meshopt_target_error: (a: number) => number;
    readonly __wbg_get_options_meshopt_threshold: (a: number) => number;
    readonly __wbg_get_options_mode: (a: number) => number;
    readonly __wbg_get_options_remove_empty: (a: number) => number;
    readonly __wbg_get_options_tolerance: (a: number) => number;
    readonly __wbg_options_free: (a: number, b: number) => void;
    readonly __wbg_set_options_align_segments: (a: number, b: number) => void;
    readonly __wbg_set_options_cleanup_position: (a: number, b: number) => void;
    readonly __wbg_set_options_cleanup_precision: (a: number, b: number) => void;
    readonly __wbg_set_options_dry_run: (a: number, b: number) => void;
    readonly __wbg_set_options_extract_json: (a: number, b: number) => void;
    readonly __wbg_set_options_highlight_instance: (a: number, b: number) => void;
    readonly __wbg_set_options_include_line: (a: number, b: number) => void;
    readonly __wbg_set_options_level: (a: number, b: number) => void;
    readonly __wbg_set_options_line_width: (a: number, b: number) => void;
    readonly __wbg_set_options_meshopt_target_error: (a: number, b: number) => void;
    readonly __wbg_set_options_meshopt_threshold: (a: number, b: number) => void;
    readonly __wbg_set_options_mode: (a: number, b: number) => void;
    readonly __wbg_set_options_remove_empty: (a: number, b: number) => void;
    readonly __wbg_set_options_tolerance: (a: number, b: number) => void;
    readonly convert_in_ram: (a: number, b: number, c: number, d: number, e: number, f: any) => [number, number, number];
    readonly convert_streaming: (a: any, b: number, c: number, d: number) => [number, number, number, number];
    readonly convert_streaming_tdp: (a: any, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly convertresult_bytes: (a: number, b: number) => [number, number];
    readonly convertresult_info: (a: number) => [number, number];
    readonly convertresult_len: (a: number) => number;
    readonly convertresult_name: (a: number, b: number) => [number, number];
    readonly options_new: () => number;
    readonly version: () => [number, number];
    readonly start: () => void;
    readonly _ZdlPv: (a: number) => void;
    readonly _Znwm: (a: number) => number;
    readonly _ZdlPvm: (a: number, b: number) => void;
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
