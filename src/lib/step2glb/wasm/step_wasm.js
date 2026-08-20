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
 * Convert with the knobs a viewer exposes. `cleanup` runs the rvm-style
 * position weld (+ degenerate drop; the simplify step needs meshoptimizer,
 * which the wasm build omits). `merged` selects the one-mesh-per-color world-
 * baked layout vs the hierarchical per-part node tree. `progress.report(done,
 * total)` fires as product nodes are processed — the in-RAM counterpart of the
 * streaming path's `io.progress`, so the UI shows % on this path too.
 * @param {Uint8Array} step_bytes
 * @param {number} deflection_mm
 * @param {number} max_angle_deg
 * @param {boolean} y_up
 * @param {boolean} keep_normals
 * @param {boolean} cleanup
 * @param {boolean} merged
 * @param {any} progress
 * @returns {ConvertResult}
 */
export function convert_step_to_glb_opts(step_bytes, deflection_mm, max_angle_deg, y_up, keep_normals, cleanup, merged, progress) {
    const ptr0 = passArray8ToWasm0(step_bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.convert_step_to_glb_opts(ptr0, len0, deflection_mm, max_angle_deg, y_up, keep_normals, cleanup, merged, progress);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ConvertResult.__wrap(ret[0]);
}

/**
 * STEP → cooked `.tdp` in ONE step: the merged model goes straight into the
 * cooker, so no GLB is built, serialised or parsed. Merged mode only — the
 * hierarchical layout carries no draw ranges for the cooker to key items on.
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
 * Streaming conversion: input is read **by range** from the `io` handle, the
 * GLB is written through `io.writeOutput`, geometry spills through
 * `io.writeTemp`/`readTemp`, and progress is reported via `io.progress`. The
 * whole file is never materialized in wasm memory. Returns the JSON report
 * (the GLB bytes went out through `io`, not the return value).
 * @param {any} io
 * @param {number} deflection_mm
 * @param {number} max_angle_deg
 * @param {boolean} y_up
 * @param {boolean} keep_normals
 * @param {boolean} cleanup
 * @param {boolean} merged
 * @returns {string}
 */
export function convert_streaming(io, deflection_mm, max_angle_deg, y_up, keep_normals, cleanup, merged) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.convert_streaming(io, deflection_mm, max_angle_deg, y_up, keep_normals, cleanup, merged);
        var ptr1 = ret[0];
        var len1 = ret[1];
        if (ret[3]) {
            ptr1 = 0; len1 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred2_0 = ptr1;
        deferred2_1 = len1;
        return getStringFromWasm0(ptr1, len1);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Install the panic hook once, so a wasm abort (a Rust panic, or an
 * out-of-memory when `memory.grow` fails) surfaces as a readable console
 * message rather than a bare `unreachable` trap.
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
        __wbg_new_227d7c05414eb861: function() {
            const ret = new Error();
            return ret;
        },
        __wbg_progress_116aa93080c01089: function(arg0, arg1, arg2) {
            arg0.progress(arg1, arg2);
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
        __wbg_writeOutput_0ce7fa44b9acf6c6: function(arg0, arg1, arg2) {
            arg0.writeOutput(getArrayU8FromWasm0(arg1, arg2));
        },
        __wbg_writeTemp_b3e6ede81ca95d46: function(arg0, arg1, arg2, arg3) {
            arg0.writeTemp(arg1, getArrayU8FromWasm0(arg2, arg3));
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

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
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
