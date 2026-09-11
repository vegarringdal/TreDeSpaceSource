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
 * One STEP conversion, held open between calls so the browser can interleave
 * its own async work (spawning sub-workers, handing out batches) between the
 * synchronous stages. Created on the coordinator AND on every tessellation
 * sub-worker (each indexes the same staged file through its own handle).
 */
export class StepSession {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Faces in the file — the denominator of the phase-1 progress.
     */
    faceCount(): number;
    /**
     * Merge, cook and write. `keys/slots/offsets/lens` are the record table
     * gathered from the sub-workers (empty ⇒ tessellate here, in-process);
     * `worker_stats` their `statsWire` blobs joined by U+001E. The full
     * `.tdp` goes to `Io.open(out_name)`, the coarse variant (when `coarsen`)
     * to `<stem>.coarse.tdp` — derived from the cooked bytes, so the model is
     * dropped before the second cook. Returns the JSON report.
     */
    finish(keys: Uint32Array, slots: Uint32Array, offsets: Float64Array, lens: Uint32Array, worker_stats: string, out_name: string, coarsen: boolean, compute_normals: boolean): string;
    /**
     * A session over the same file built from the index file the coordinator
     * wrote with `writeIndex` (`Io.indexSize` / `Io.readIndex`): no scan, no
     * phase-0 progress, and the index is parsed in bounded pieces so this
     * worker's heap holds the table, never the file. What every tessellation
     * sub-worker opens.
     */
    static fromIndexFile(io: any, deflection_mm: number, max_angle_deg: number, y_up: boolean, keep_normals: boolean, cleanup: boolean): StepSession;
    /**
     * 0 = keys are product definitions, 1 = standalone solids (no structure).
     */
    jobKind(): number;
    /**
     * The independent tessellation work units (see `jobKind`).
     */
    jobs(): Uint32Array;
    /**
     * Index the input (`Io.read` by range; `Io.progress` phase 0 = bytes
     * scanned), resolve units, build the colour map and assembly.
     */
    constructor(io: any, deflection_mm: number, max_angle_deg: number, y_up: boolean, keep_normals: boolean, cleanup: boolean);
    productCount(): number;
    /**
     * This worker's tessellation tally, for the coordinator's report.
     */
    statsWire(): string;
    /**
     * Tessellate a batch of jobs, appending each result record to the temp
     * handle (`Io.writeTemp` at `Io.tempLen`). Returns `[key, offset, len]`
     * triples — the coordinator collects them from every sub-worker for
     * [`Self::finish`]. Face ticks go to `Io.progress` phase 1.
     */
    tessellate(keys: Uint32Array): Float64Array;
    /**
     * Stream the file's index to `Io.open(name)` in 1 MB pieces — never held
     * whole in wasm memory — for the sub-workers' `fromIndexFile`.
     */
    writeIndex(name: string): void;
}

/**
 * Convert a STEP file (raw bytes) to GLB with the default options. Returns a
 * [`ConvertResult`] (GLB bytes + JSON report), or a JS error string.
 */
export function convert_step_to_glb(step_bytes: Uint8Array): ConvertResult;

/**
 * STEP → cooked `.tdp` in ONE call, whole file in RAM: the merged model goes
 * straight into the cooker, so no GLB is built, serialised or parsed. Merged
 * mode only — the hierarchical layout carries no draw ranges for the cooker to
 * key items on. Prefer [`StepSession`] for anything large.
 */
export function convert_step_to_tdp(step_bytes: Uint8Array, deflection_mm: number, max_angle_deg: number, y_up: boolean, keep_normals: boolean, cleanup: boolean, compute_normals: boolean, coarsen: boolean, progress: any): CookedResult;

/**
 * Install the panic hook once, so a wasm abort (a Rust panic, or an
 * out-of-memory when `memory.grow` fails) surfaces as a readable console
 * message rather than a bare `unreachable`.
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
    readonly __wbg_stepsession_free: (a: number, b: number) => void;
    readonly convert_step_to_glb: (a: number, b: number) => [number, number, number];
    readonly convert_step_to_tdp: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: any) => [number, number, number];
    readonly convertresult_glb: (a: number) => [number, number];
    readonly convertresult_info: (a: number) => [number, number];
    readonly cookedresult_coarse: (a: number) => [number, number];
    readonly cookedresult_info: (a: number) => [number, number];
    readonly cookedresult_tdp: (a: number) => [number, number];
    readonly stepsession_faceCount: (a: number) => number;
    readonly stepsession_finish: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number) => [number, number, number, number];
    readonly stepsession_fromIndexFile: (a: any, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly stepsession_jobKind: (a: number) => number;
    readonly stepsession_jobs: (a: number) => [number, number];
    readonly stepsession_new: (a: any, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly stepsession_productCount: (a: number) => number;
    readonly stepsession_statsWire: (a: number) => [number, number];
    readonly stepsession_tessellate: (a: number, b: number, c: number) => [number, number, number, number];
    readonly stepsession_writeIndex: (a: number, b: number, c: number) => [number, number];
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
