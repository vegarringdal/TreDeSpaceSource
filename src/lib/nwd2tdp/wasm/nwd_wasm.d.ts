/* tslint:disable */
/* eslint-disable */

/**
 * Conversion options (defaults = `ConvertOptions::default()`, as in the CLI).
 */
export class Options {
    free(): void;
    [Symbol.dispose](): void;
    constructor();
    cleanup_position: boolean;
    /**
     * Decimal places of the weld grid, in output units (3 = 1 mm).
     */
    cleanup_precision: number;
    include_line: boolean;
    include_normals: boolean;
    /**
     * Width of the line crosses, in output units (metres).
     */
    line_width: number;
    meshopt_target_error: number;
    meshopt_threshold: number;
    /**
     * Per-root GLB structure — rvm2glb numbering: 0 = merged (default),
     * 2 = standard. (1/3 = instanced modes, not implemented for NWD.)
     */
    mode: number;
    /**
     * Unit factor, model units → metres. `0.0` (the default) = automatic:
     * 0.3048 for a Revit-loader file (stored in feet), otherwise 1. Any
     * positive value is an explicit factor (`1.0` = as stored). The factor
     * that was applied comes back as `unitScale` in the report.
     */
    unit_scale: number;
}

/**
 * Convert an NWD/NWC through the streaming io object; returns a JSON report
 * string. Always split-per-root (rvm2glb "merged" contract).
 */
export function convert_streaming(io: any, opts: Options, source_name: string): string;

/**
 * NWD/NWC → cooked `.tdp` files through the same io object: every root's
 * merged GLB is cooked in memory (never written) into `<root>.tdp`, plus
 * `<root>.coarse.tdp` with `coarsen`; `status_file.json` passes through.
 */
export function convert_streaming_tdp(io: any, opts: Options, source_name: string, compute_normals: boolean, coarsen: boolean): string;

export function start(): void;

export function version(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_get_options_cleanup_position: (a: number) => number;
    readonly __wbg_get_options_cleanup_precision: (a: number) => number;
    readonly __wbg_get_options_include_line: (a: number) => number;
    readonly __wbg_get_options_include_normals: (a: number) => number;
    readonly __wbg_get_options_line_width: (a: number) => number;
    readonly __wbg_get_options_meshopt_target_error: (a: number) => number;
    readonly __wbg_get_options_meshopt_threshold: (a: number) => number;
    readonly __wbg_get_options_mode: (a: number) => number;
    readonly __wbg_get_options_unit_scale: (a: number) => number;
    readonly __wbg_options_free: (a: number, b: number) => void;
    readonly __wbg_set_options_cleanup_position: (a: number, b: number) => void;
    readonly __wbg_set_options_cleanup_precision: (a: number, b: number) => void;
    readonly __wbg_set_options_include_line: (a: number, b: number) => void;
    readonly __wbg_set_options_include_normals: (a: number, b: number) => void;
    readonly __wbg_set_options_line_width: (a: number, b: number) => void;
    readonly __wbg_set_options_meshopt_target_error: (a: number, b: number) => void;
    readonly __wbg_set_options_meshopt_threshold: (a: number, b: number) => void;
    readonly __wbg_set_options_mode: (a: number, b: number) => void;
    readonly __wbg_set_options_unit_scale: (a: number, b: number) => void;
    readonly convert_streaming: (a: any, b: number, c: number, d: number) => [number, number, number, number];
    readonly convert_streaming_tdp: (a: any, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly options_new: () => number;
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
