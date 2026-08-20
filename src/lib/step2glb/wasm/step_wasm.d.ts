/* tslint:disable */
/* eslint-disable */

/**
 * The result of a conversion: the GLB bytes plus a JSON diagnostics report
 * (`facesOk`, `facesSkipped`, `unsupported*`, `unitAssumedMillimetres`, …).
 */
export class ConvertResult {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * The GLB bytes (a `Uint8Array` in JS).
     */
    readonly glb: Uint8Array;
    /**
     * The JSON diagnostics report.
     */
    readonly info: string;
}

/**
 * Cooked result: the `.tdp` the viewer loads, plus the optional coarse variant
 * the VRAM budget swaps in.
 */
export class CookedResult {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * The coarse `.tdp`, or `undefined` when not requested / not produced.
     */
    readonly coarse: Uint8Array | undefined;
    readonly info: string;
    readonly tdp: Uint8Array;
}

/**
 * Convert a STEP file (raw bytes) to GLB with the default options. Returns a
 * [`ConvertResult`] (GLB bytes + JSON report), or a JS error string.
 */
export function convert_step_to_glb(step_bytes: Uint8Array): ConvertResult;

/**
 * Convert with the knobs a viewer exposes. `cleanup` runs the rvm-style
 * position weld (+ degenerate drop; the simplify step needs meshoptimizer,
 * which the wasm build omits). `merged` selects the one-mesh-per-color world-
 * baked layout vs the hierarchical per-part node tree. `progress.report(done,
 * total)` fires as product nodes are processed — the in-RAM counterpart of the
 * streaming path's `io.progress`, so the UI shows % on this path too.
 */
export function convert_step_to_glb_opts(step_bytes: Uint8Array, deflection_mm: number, max_angle_deg: number, y_up: boolean, keep_normals: boolean, cleanup: boolean, merged: boolean, progress: any): ConvertResult;

/**
 * STEP → cooked `.tdp` in ONE step: the merged model goes straight into the
 * cooker, so no GLB is built, serialised or parsed. Merged mode only — the
 * hierarchical layout carries no draw ranges for the cooker to key items on.
 */
export function convert_step_to_tdp(step_bytes: Uint8Array, deflection_mm: number, max_angle_deg: number, y_up: boolean, keep_normals: boolean, cleanup: boolean, compute_normals: boolean, coarsen: boolean, progress: any): CookedResult;

/**
 * Streaming conversion: input is read **by range** from the `io` handle, the
 * GLB is written through `io.writeOutput`, geometry spills through
 * `io.writeTemp`/`readTemp`, and progress is reported via `io.progress`. The
 * whole file is never materialized in wasm memory. Returns the JSON report
 * (the GLB bytes went out through `io`, not the return value).
 */
export function convert_streaming(io: any, deflection_mm: number, max_angle_deg: number, y_up: boolean, keep_normals: boolean, cleanup: boolean, merged: boolean): string;

/**
 * Install the panic hook once, so a wasm abort (a Rust panic, or an
 * out-of-memory when `memory.grow` fails) surfaces as a readable console
 * message rather than a bare `unreachable` trap.
 */
export function start(): void;

/**
 * Version of the underlying converter, for the demo UI.
 */
export function version(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_convertresult_free: (a: number, b: number) => void;
    readonly __wbg_cookedresult_free: (a: number, b: number) => void;
    readonly convert_step_to_glb: (a: number, b: number) => [number, number, number];
    readonly convert_step_to_glb_opts: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: any) => [number, number, number];
    readonly convert_step_to_tdp: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: any) => [number, number, number];
    readonly convert_streaming: (a: any, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number, number];
    readonly convertresult_glb: (a: number) => [number, number];
    readonly convertresult_info: (a: number) => [number, number];
    readonly cookedresult_coarse: (a: number) => [number, number];
    readonly cookedresult_info: (a: number) => [number, number];
    readonly cookedresult_tdp: (a: number) => [number, number];
    readonly version: () => [number, number];
    readonly start: () => void;
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
