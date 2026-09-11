/* @ts-self-types="./step_wasm.d.ts" */

/**
 * The result of a conversion: the GLB bytes plus a JSON diagnostics report
 * (`facesOk`, `facesSkipped`, `unsupported*`, `unitAssumedMillimetres`, …).
 */
export class ConvertResult {
    static __wrap(ptr) {
        const obj = Object.create(ConvertResult.prototype);
        obj.__wbg_ptr = ptr;
        ConvertResultFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ConvertResultFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_convertresult_free(ptr, 0);
    }
    /**
     * The GLB bytes (a `Uint8Array` in JS).
     * @returns {Uint8Array}
     */
    get glb() {
        const ret = wasm.convertresult_glb(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * The JSON diagnostics report.
     * @returns {string}
     */
    get info() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.convertresult_info(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) ConvertResult.prototype[Symbol.dispose] = ConvertResult.prototype.free;

/**
 * Cooked result: the `.tdp` the viewer loads, plus the optional coarse variant
 * the VRAM budget swaps in.
 */
export class CookedResult {
    static __wrap(ptr) {
        const obj = Object.create(CookedResult.prototype);
        obj.__wbg_ptr = ptr;
        CookedResultFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        CookedResultFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_cookedresult_free(ptr, 0);
    }
    /**
     * The coarse `.tdp`, or `undefined` when not requested / not produced.
     * @returns {Uint8Array | undefined}
     */
    get coarse() {
        const ret = wasm.cookedresult_coarse(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * @returns {string}
     */
    get info() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.cookedresult_info(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {Uint8Array}
     */
    get tdp() {
        const ret = wasm.cookedresult_tdp(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
}
if (Symbol.dispose) CookedResult.prototype[Symbol.dispose] = CookedResult.prototype.free;

/**
 * One STEP conversion, held open between calls so the browser can interleave
 * its own async work (spawning sub-workers, handing out batches) between the
 * synchronous stages. Created on the coordinator AND on every tessellation
 * sub-worker (each indexes the same staged file through its own handle).
 */
export class StepSession {
    static __wrap(ptr) {
        const obj = Object.create(StepSession.prototype);
        obj.__wbg_ptr = ptr;
        StepSessionFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        StepSessionFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_stepsession_free(ptr, 0);
    }
    /**
     * Faces in the file — the denominator of the phase-1 progress.
     * @returns {number}
     */
    faceCount() {
        const ret = wasm.stepsession_faceCount(this.__wbg_ptr);
        return ret;
    }
    /**
     * Merge, cook and write. `keys/slots/offsets/lens` are the record table
     * gathered from the sub-workers (empty ⇒ tessellate here, in-process);
     * `worker_stats` their `statsWire` blobs joined by U+001E. The full
     * `.tdp` goes to `Io.open(out_name)`, the coarse variant (when `coarsen`)
     * to `<stem>.coarse.tdp` — derived from the cooked bytes, so the model is
     * dropped before the second cook. Returns the JSON report.
     * @param {Uint32Array} keys
     * @param {Uint32Array} slots
     * @param {Float64Array} offsets
     * @param {Uint32Array} lens
     * @param {string} worker_stats
     * @param {string} out_name
     * @param {boolean} coarsen
     * @param {boolean} compute_normals
     * @returns {string}
     */
    finish(keys, slots, offsets, lens, worker_stats, out_name, coarsen, compute_normals) {
        let deferred8_0;
        let deferred8_1;
        try {
            const ptr0 = passArray32ToWasm0(keys, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passArray32ToWasm0(slots, wasm.__wbindgen_malloc);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passArrayF64ToWasm0(offsets, wasm.__wbindgen_malloc);
            const len2 = WASM_VECTOR_LEN;
            const ptr3 = passArray32ToWasm0(lens, wasm.__wbindgen_malloc);
            const len3 = WASM_VECTOR_LEN;
            const ptr4 = passStringToWasm0(worker_stats, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len4 = WASM_VECTOR_LEN;
            const ptr5 = passStringToWasm0(out_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len5 = WASM_VECTOR_LEN;
            const ret = wasm.stepsession_finish(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5, coarsen, compute_normals);
            var ptr7 = ret[0];
            var len7 = ret[1];
            if (ret[3]) {
                ptr7 = 0; len7 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred8_0 = ptr7;
            deferred8_1 = len7;
            return getStringFromWasm0(ptr7, len7);
        } finally {
            wasm.__wbindgen_free(deferred8_0, deferred8_1, 1);
        }
    }
    /**
     * A session over the same file built from the index file the coordinator
     * wrote with `writeIndex` (`Io.indexSize` / `Io.readIndex`): no scan, no
     * phase-0 progress, and the index is parsed in bounded pieces so this
     * worker's heap holds the table, never the file. What every tessellation
     * sub-worker opens.
     * @param {any} io
     * @param {number} deflection_mm
     * @param {number} max_angle_deg
     * @param {boolean} y_up
     * @param {boolean} keep_normals
     * @param {boolean} cleanup
     * @returns {StepSession}
     */
    static fromIndexFile(io, deflection_mm, max_angle_deg, y_up, keep_normals, cleanup) {
        const ret = wasm.stepsession_fromIndexFile(io, deflection_mm, max_angle_deg, y_up, keep_normals, cleanup);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return StepSession.__wrap(ret[0]);
    }
    /**
     * 0 = keys are product definitions, 1 = standalone solids (no structure).
     * @returns {number}
     */
    jobKind() {
        const ret = wasm.stepsession_jobKind(this.__wbg_ptr);
        return ret;
    }
    /**
     * The independent tessellation work units (see `jobKind`).
     * @returns {Uint32Array}
     */
    jobs() {
        const ret = wasm.stepsession_jobs(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Index the input (`Io.read` by range; `Io.progress` phase 0 = bytes
     * scanned), resolve units, build the colour map and assembly.
     * @param {any} io
     * @param {number} deflection_mm
     * @param {number} max_angle_deg
     * @param {boolean} y_up
     * @param {boolean} keep_normals
     * @param {boolean} cleanup
     */
    constructor(io, deflection_mm, max_angle_deg, y_up, keep_normals, cleanup) {
        const ret = wasm.stepsession_new(io, deflection_mm, max_angle_deg, y_up, keep_normals, cleanup);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        StepSessionFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {number}
     */
    productCount() {
        const ret = wasm.stepsession_productCount(this.__wbg_ptr);
        return ret;
    }
    /**
     * This worker's tessellation tally, for the coordinator's report.
     * @returns {string}
     */
    statsWire() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.stepsession_statsWire(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Tessellate a batch of jobs, appending each result record to the temp
     * handle (`Io.writeTemp` at `Io.tempLen`). Returns `[key, offset, len]`
     * triples — the coordinator collects them from every sub-worker for
     * [`Self::finish`]. Face ticks go to `Io.progress` phase 1.
     * @param {Uint32Array} keys
     * @returns {Float64Array}
     */
    tessellate(keys) {
        const ptr0 = passArray32ToWasm0(keys, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.stepsession_tessellate(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v2;
    }
    /**
     * Stream the file's index to `Io.open(name)` in 1 MB pieces — never held
     * whole in wasm memory — for the sub-workers' `fromIndexFile`.
     * @param {string} name
     */
    writeIndex(name) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.stepsession_writeIndex(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
}
if (Symbol.dispose) StepSession.prototype[Symbol.dispose] = StepSession.prototype.free;

/**
 * Convert a STEP file (raw bytes) to GLB with the default options. Returns a
 * [`ConvertResult`] (GLB bytes + JSON report), or a JS error string.
 * @param {Uint8Array} step_bytes
 * @returns {ConvertResult}
 */
export function convert_step_to_glb(step_bytes) {
    const ptr0 = passArray8ToWasm0(step_bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.convert_step_to_glb(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ConvertResult.__wrap(ret[0]);
}

/**
 * STEP → cooked `.tdp` in ONE call, whole file in RAM: the merged model goes
 * straight into the cooker, so no GLB is built, serialised or parsed. Merged
 * mode only — the hierarchical layout carries no draw ranges for the cooker to
 * key items on. Prefer [`StepSession`] for anything large.
 * @param {Uint8Array} step_bytes
 * @param {number} deflection_mm
 * @param {number} max_angle_deg
 * @param {boolean} y_up
 * @param {boolean} keep_normals
 * @param {boolean} cleanup
 * @param {boolean} compute_normals
 * @param {boolean} coarsen
 * @param {any} progress
 * @returns {CookedResult}
 */
export function convert_step_to_tdp(step_bytes, deflection_mm, max_angle_deg, y_up, keep_normals, cleanup, compute_normals, coarsen, progress) {
    const ptr0 = passArray8ToWasm0(step_bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.convert_step_to_tdp(ptr0, len0, deflection_mm, max_angle_deg, y_up, keep_normals, cleanup, compute_normals, coarsen, progress);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return CookedResult.__wrap(ret[0]);
}

/**
 * Install the panic hook once, so a wasm abort (a Rust panic, or an
 * out-of-memory when `memory.grow` fails) surfaces as a readable console
 * message rather than a bare `unreachable`.
 */
export function start() {
    wasm.start();
}

/**
 * Version of the underlying converter, for the demo UI.
 * @returns {string}
 */
export function version() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.version();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_344f42d3211c4765: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_close_468cb880dac82f17: function(arg0, arg1) {
            arg0.close(arg1 >>> 0);
        },
        __wbg_error_a6fa202b58aa1cd3: function(arg0, arg1) {
            let deferred0_0;
            let deferred0_1;
            try {
                deferred0_0 = arg0;
                deferred0_1 = arg1;
                console.error(getStringFromWasm0(arg0, arg1));
            } finally {
                wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
            }
        },
        __wbg_indexSize_f726b5573047da71: function(arg0) {
            const ret = arg0.indexSize();
            return ret;
        },
        __wbg_new_227d7c05414eb861: function() {
            const ret = new Error();
            return ret;
        },
        __wbg_open_e7bc380d73803497: function(arg0, arg1, arg2) {
            const ret = arg0.open(getStringFromWasm0(arg1, arg2));
            return ret;
        },
        __wbg_progress_427682132c5960b0: function(arg0, arg1, arg2, arg3) {
            arg0.progress(arg1, arg2, arg3);
        },
        __wbg_readIndex_57c6a164a1688ae1: function(arg0, arg1, arg2, arg3) {
            const ret = arg1.readIndex(arg2, arg3);
            const ptr1 = passArray8ToWasm0(ret, wasm.__wbindgen_malloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_readSlot_8387d1bcd6b7874a: function(arg0, arg1, arg2, arg3, arg4) {
            const ret = arg1.readSlot(arg2 >>> 0, arg3, arg4);
            const ptr1 = passArray8ToWasm0(ret, wasm.__wbindgen_malloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_readTemp_fa178be562ab7d98: function(arg0, arg1, arg2, arg3) {
            const ret = arg1.readTemp(arg2, arg3);
            const ptr1 = passArray8ToWasm0(ret, wasm.__wbindgen_malloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_read_a3a159fcd543cd39: function(arg0, arg1, arg2, arg3) {
            const ret = arg1.read(arg2, arg3);
            const ptr1 = passArray8ToWasm0(ret, wasm.__wbindgen_malloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_report_6984504519c821a4: function(arg0, arg1, arg2) {
            arg0.report(arg1, arg2);
        },
        __wbg_size_df5886715a77e494: function(arg0) {
            const ret = arg0.size();
            return ret;
        },
        __wbg_stack_3b0d974bbf31e44f: function(arg0, arg1) {
            const ret = arg1.stack;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_tempLen_7840caaf57c80c75: function(arg0) {
            const ret = arg0.tempLen();
            return ret;
        },
        __wbg_writeTemp_b3e6ede81ca95d46: function(arg0, arg1, arg2, arg3) {
            arg0.writeTemp(arg1, getArrayU8FromWasm0(arg2, arg3));
        },
        __wbg_write_90430f871536d0c0: function(arg0, arg1, arg2, arg3) {
            arg0.write(arg1 >>> 0, getArrayU8FromWasm0(arg2, arg3));
        },
        __wbindgen_cast_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./step_wasm_bg.js": import0,
    };
}

const ConvertResultFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_convertresult_free(ptr, 1));
const CookedResultFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_cookedresult_free(ptr, 1));
const StepSessionFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_stepsession_free(ptr, 1));

function getArrayF64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passArray32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getUint32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF64ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 8, 8) >>> 0;
    getFloat64ArrayMemory0().set(arg, ptr / 8);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedFloat64ArrayMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('step_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
