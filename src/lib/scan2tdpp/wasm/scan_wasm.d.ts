/* tslint:disable */
/* eslint-disable */

/**
 * An E57 cook spread over sub-workers — this is the coordinator's side: it
 * owns the output, merges what the workers ([`E57Part`]) return, plans, and
 * writes. The caller drives the stages in order:
 *
 * ```text
 * new → tables() to every worker
 * add_stats(part.stats(i0, i1)) over all blocks
 * stats() → add_counts(part.counts(stats, i0, i1)) over all blocks
 * plan() to every worker → add_batch(part.batch(b)) for b in 0..batches(), IN ORDER
 * finish()
 * ```
 */
export class E57Cook {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Write batch `index` — batches must be added in order.
     */
    add_batch(index: number, part: Uint8Array): void;
    add_counts(part: Uint8Array): void;
    add_stats(part: Uint8Array): void;
    batches(): number;
    /**
     * Record blocks to run the stats and the counts stages over.
     */
    blocks(): number;
    /**
     * The tree above the chunks, the panoramas and the header. Returns the
     * same JSON report as [`cook`].
     */
    finish(): string;
    /**
     * Opens the E57 and walks its packet headers (the slow part of opening).
     */
    constructor(io: any, options_json: string);
    /**
     * Plan the batches (every block must have been counted) and open the
     * output. Returns the plan for [`E57Part::set_plan`].
     */
    plan(): Uint8Array;
    /**
     * The merged stats, for [`E57Part::counts`].
     */
    stats(): Uint8Array;
    /**
     * The packet tables, for [`E57Part::new`].
     */
    tables(): Uint8Array;
}

/**
 * A sub-worker's side of an E57 cook: decodes record blocks and builds whole
 * batches, each call independent of the other workers. Reads the input
 * through its own `io` (only `size` and `read` are used).
 */
export class E57Part {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Build batch `index`: its encoded nodes and chunk roots, for
     * [`E57Cook::add_batch`].
     */
    batch(index: number): Uint8Array;
    /**
     * Stage 2 over blocks `[i0, i1)`; `stats` = [`E57Cook::stats`].
     */
    counts(stats: Uint8Array, i0: number, i1: number): Uint8Array;
    /**
     * `tables` = [`E57Cook::tables`] (so the packet headers are walked once).
     */
    constructor(io: any, tables: Uint8Array, options_json: string);
    set_plan(plan: Uint8Array): void;
    /**
     * Stage 1 over blocks `[i0, i1)`.
     */
    stats(i0: number, i1: number): Uint8Array;
}

/**
 * An LGSX cook spread over sub-workers — the coordinator's side: it owns
 * the output and writes the node runs the workers ([`LgsxPart`]) encode,
 * in node order, then the photos and the header.
 */
export class LgsxCook {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Write the run starting at node `first` — runs must be added in order.
     */
    add_nodes(first: number, part: Uint8Array): void;
    /**
     * The setups, their photos and the header. Returns the same JSON report
     * as [`cook`].
     */
    finish(): string;
    constructor(io: any, options_json: string);
    /**
     * Octree nodes to encode ([`LgsxPart::nodes`] over all of them).
     */
    nodes(): number;
}

/**
 * A sub-worker's side of an LGSX cook: decodes and re-encodes runs of
 * octree nodes through its own `io` (only `size` and `read` are used).
 */
export class LgsxPart {
    free(): void;
    [Symbol.dispose](): void;
    constructor(io: any, options_json: string);
    /**
     * Encode nodes `[i0, i1)`, for [`LgsxCook::add_nodes`].
     */
    nodes(i0: number, i1: number): Uint8Array;
}

/**
 * Cook the input into `.tdpp` through `io.write`. Returns a JSON report
 * (point count, node count, file size).
 */
export function cook(io: any, options_json: string): string;

/**
 * JSON summary of an LGSX / E57 input: format, point count, setups with
 * poses, panorama availability. Cheap — reads only metadata.
 */
export function info(io: any): string;

export function start(): void;

export function version(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_e57cook_free: (a: number, b: number) => void;
    readonly __wbg_e57part_free: (a: number, b: number) => void;
    readonly __wbg_lgsxcook_free: (a: number, b: number) => void;
    readonly __wbg_lgsxpart_free: (a: number, b: number) => void;
    readonly cook: (a: any, b: number, c: number) => [number, number, number, number];
    readonly e57cook_add_batch: (a: number, b: number, c: number, d: number) => [number, number];
    readonly e57cook_add_counts: (a: number, b: number, c: number) => [number, number];
    readonly e57cook_add_stats: (a: number, b: number, c: number) => [number, number];
    readonly e57cook_batches: (a: number) => number;
    readonly e57cook_blocks: (a: number) => number;
    readonly e57cook_finish: (a: number) => [number, number, number, number];
    readonly e57cook_new: (a: any, b: number, c: number) => [number, number, number];
    readonly e57cook_plan: (a: number) => [number, number, number, number];
    readonly e57cook_stats: (a: number) => [number, number];
    readonly e57cook_tables: (a: number) => [number, number];
    readonly e57part_batch: (a: number, b: number) => [number, number, number, number];
    readonly e57part_counts: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly e57part_new: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly e57part_set_plan: (a: number, b: number, c: number) => [number, number];
    readonly e57part_stats: (a: number, b: number, c: number) => [number, number, number, number];
    readonly info: (a: any) => [number, number, number, number];
    readonly lgsxcook_add_nodes: (a: number, b: number, c: number, d: number) => [number, number];
    readonly lgsxcook_finish: (a: number) => [number, number, number, number];
    readonly lgsxcook_new: (a: any, b: number, c: number) => [number, number, number];
    readonly lgsxcook_nodes: (a: number) => number;
    readonly lgsxpart_new: (a: any, b: number, c: number) => [number, number, number];
    readonly lgsxpart_nodes: (a: number, b: number, c: number) => [number, number, number, number];
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
