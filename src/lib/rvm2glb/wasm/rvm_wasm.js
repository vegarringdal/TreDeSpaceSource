/* @ts-self-types="./rvm_wasm.d.ts" */

/**
 * Every output of one conversion (GLBs + `status_file.json`), held in RAM.
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
     * Bytes of file `i`.
     * @param {number} i
     * @returns {Uint8Array | undefined}
     */
    bytes(i) {
        const ret = wasm.convertresult_bytes(this.__wbg_ptr, i);
        let v1;
        if (ret[0] !== 0) {
            v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * Small JSON summary (`{"files":N,"warnings":M}`).
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
    /**
     * Number of files produced.
     * @returns {number}
     */
    get len() {
        const ret = wasm.convertresult_len(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Name of file `i` (e.g. `"HA-PIPE.glb"`, `"status_file.json"`).
     * @param {number} i
     * @returns {string | undefined}
     */
    name(i) {
        const ret = wasm.convertresult_name(this.__wbg_ptr, i);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
}
if (Symbol.dispose) ConvertResult.prototype[Symbol.dispose] = ConvertResult.prototype.free;

export class Options {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        OptionsFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_options_free(ptr, 0);
    }
    /**
     * @returns {boolean}
     */
    get align_segments() {
        const ret = wasm.__wbg_get_options_align_segments(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {boolean}
     */
    get cleanup_position() {
        const ret = wasm.__wbg_get_options_cleanup_position(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {number}
     */
    get cleanup_precision() {
        const ret = wasm.__wbg_get_options_cleanup_precision(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {boolean}
     */
    get dry_run() {
        const ret = wasm.__wbg_get_options_dry_run(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Extract the RVM structure as JSON (`<site>.json` + `base.json`) instead of GLB.
     * Overrides `mode`; honours `level`.
     * @returns {boolean}
     */
    get extract_json() {
        const ret = wasm.__wbg_get_options_extract_json(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {boolean}
     */
    get highlight_instance() {
        const ret = wasm.__wbg_get_options_highlight_instance(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Include RVM Line primitives. `false` (the default) skips them entirely —
     * they are numerous and add visual noise.
     * @returns {boolean}
     */
    get include_line() {
        const ret = wasm.__wbg_get_options_include_line(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {number}
     */
    get level() {
        const ret = wasm.__wbg_get_options_level(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get line_width() {
        const ret = wasm.__wbg_get_options_line_width(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get meshopt_target_error() {
        const ret = wasm.__wbg_get_options_meshopt_target_error(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get meshopt_threshold() {
        const ret = wasm.__wbg_get_options_meshopt_threshold(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get mode() {
        const ret = wasm.__wbg_get_options_mode(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {boolean}
     */
    get remove_empty() {
        const ret = wasm.__wbg_get_options_remove_empty(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {number}
     */
    get tolerance() {
        const ret = wasm.__wbg_get_options_tolerance(this.__wbg_ptr);
        return ret;
    }
    /**
     * Defaults match the CLI (merged, remove-empty on, weld on, tolerance 0.01, …).
     */
    constructor() {
        const ret = wasm.options_new();
        this.__wbg_ptr = ret;
        OptionsFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {boolean} arg0
     */
    set align_segments(arg0) {
        wasm.__wbg_set_options_align_segments(this.__wbg_ptr, arg0);
    }
    /**
     * @param {boolean} arg0
     */
    set cleanup_position(arg0) {
        wasm.__wbg_set_options_cleanup_position(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set cleanup_precision(arg0) {
        wasm.__wbg_set_options_cleanup_precision(this.__wbg_ptr, arg0);
    }
    /**
     * @param {boolean} arg0
     */
    set dry_run(arg0) {
        wasm.__wbg_set_options_dry_run(this.__wbg_ptr, arg0);
    }
    /**
     * Extract the RVM structure as JSON (`<site>.json` + `base.json`) instead of GLB.
     * Overrides `mode`; honours `level`.
     * @param {boolean} arg0
     */
    set extract_json(arg0) {
        wasm.__wbg_set_options_extract_json(this.__wbg_ptr, arg0);
    }
    /**
     * @param {boolean} arg0
     */
    set highlight_instance(arg0) {
        wasm.__wbg_set_options_highlight_instance(this.__wbg_ptr, arg0);
    }
    /**
     * Include RVM Line primitives. `false` (the default) skips them entirely —
     * they are numerous and add visual noise.
     * @param {boolean} arg0
     */
    set include_line(arg0) {
        wasm.__wbg_set_options_include_line(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set level(arg0) {
        wasm.__wbg_set_options_level(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set line_width(arg0) {
        wasm.__wbg_set_options_line_width(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set meshopt_target_error(arg0) {
        wasm.__wbg_set_options_meshopt_target_error(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set meshopt_threshold(arg0) {
        wasm.__wbg_set_options_meshopt_threshold(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set mode(arg0) {
        wasm.__wbg_set_options_mode(this.__wbg_ptr, arg0);
    }
    /**
     * @param {boolean} arg0
     */
    set remove_empty(arg0) {
        wasm.__wbg_set_options_remove_empty(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set tolerance(arg0) {
        wasm.__wbg_set_options_tolerance(this.__wbg_ptr, arg0);
    }
}
if (Symbol.dispose) Options.prototype[Symbol.dispose] = Options.prototype.free;

/**
 * Convert RVM bytes entirely in memory; returns all outputs in a [`ConvertResult`].
 * @param {Uint8Array} input
 * @param {Options} opts
 * @param {string} source_name
 * @param {any} progress
 * @returns {ConvertResult}
 */
export function convert_in_ram(input, opts, source_name, progress) {
    const ptr0 = passArray8ToWasm0(input, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    _assertClass(opts, Options);
    const ptr1 = passStringToWasm0(source_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.convert_in_ram(ptr0, len0, opts.__wbg_ptr, ptr1, len1, progress);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ConvertResult.__wrap(ret[0]);
}

/**
 * Stream a conversion through a JS `Io` (OPFS-backed). Returns a small JSON summary.
 * @param {any} io
 * @param {Options} opts
 * @param {string} source_name
 * @returns {string}
 */
export function convert_streaming(io, opts, source_name) {
    let deferred3_0;
    let deferred3_1;
    try {
        _assertClass(opts, Options);
        const ptr0 = passStringToWasm0(source_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.convert_streaming(io, opts.__wbg_ptr, ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * RVM → cooked `.tdp` files, streaming through the same JS [`Io`] object as
 * [`convert_streaming`]: each site's merged model goes straight into the
 * cooker, so no GLB is built, serialised or parsed. With `coarsen`, the coarse
 * variant is written next to each site as `<name>.coarse.tdp`.
 * @param {any} io
 * @param {Options} opts
 * @param {string} source_name
 * @param {boolean} compute_normals
 * @param {boolean} coarsen
 * @returns {string}
 */
export function convert_streaming_tdp(io, opts, source_name, compute_normals, coarsen) {
    let deferred3_0;
    let deferred3_1;
    try {
        _assertClass(opts, Options);
        const ptr0 = passStringToWasm0(source_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.convert_streaming_tdp(io, opts.__wbg_ptr, ptr0, len0, compute_normals, coarsen);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

export function start() {
    wasm.start();
}

/**
 * Crate version string.
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
        __wbg_close_edd1d0d94377b783: function(arg0, arg1) {
            arg0.close(arg1);
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
        __wbg_open_5481ff8fceba0a55: function(arg0, arg1, arg2) {
            let deferred0_0;
            let deferred0_1;
            try {
                deferred0_0 = arg1;
                deferred0_1 = arg2;
                const ret = arg0.open(getStringFromWasm0(arg1, arg2));
                return ret;
            } finally {
                wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
            }
        },
        __wbg_progress_ed3ac885ae131a1a: function(arg0, arg1, arg2, arg3, arg4) {
            let deferred0_0;
            let deferred0_1;
            try {
                deferred0_0 = arg2;
                deferred0_1 = arg3;
                arg0.progress(arg1 >>> 0, getStringFromWasm0(arg2, arg3), arg4 >>> 0);
            } finally {
                wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
            }
        },
        __wbg_read_52ad7445bf955f4f: function(arg0, arg1, arg2, arg3) {
            const ret = arg1.read(arg2, arg3);
            const ptr1 = passArray8ToWasm0(ret, wasm.__wbindgen_malloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_report_27fc75a67ae2729b: function(arg0, arg1, arg2, arg3, arg4) {
            let deferred0_0;
            let deferred0_1;
            try {
                deferred0_0 = arg2;
                deferred0_1 = arg3;
                arg0.report(arg1 >>> 0, getStringFromWasm0(arg2, arg3), arg4 >>> 0);
            } finally {
                wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
            }
        },
        __wbg_size_d2a8db57d136d5e5: function(arg0) {
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
        __wbg_write_9fafbea4f12b930f: function(arg0, arg1, arg2, arg3) {
            arg0.write(arg1, getArrayU8FromWasm0(arg2, arg3));
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
        "./rvm_wasm_bg.js": import0,
    };
}

const ConvertResultFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_convertresult_free(ptr, 1));
const OptionsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_options_free(ptr, 1));

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
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
        module_or_path = new URL('rvm_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
