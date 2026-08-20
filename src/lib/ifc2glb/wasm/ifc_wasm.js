/* @ts-self-types="./ifc_wasm.d.ts" */

/**
 * The output files of one conversion. Iterate by index: `len()`, then `name(i)` +
 * `bytes(i)`. Includes the GLB(s) and the trailing `status_file.json`.
 */
export class ConvertedFiles {
    static __wrap(ptr) {
        const obj = Object.create(ConvertedFiles.prototype);
        obj.__wbg_ptr = ptr;
        ConvertedFilesFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ConvertedFilesFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_convertedfiles_free(ptr, 0);
    }
    /**
     * The file's bytes (copied out to JS as a `Uint8Array`).
     * @param {number} i
     * @returns {Uint8Array | undefined}
     */
    bytes(i) {
        const ret = wasm.convertedfiles_bytes(this.__wbg_ptr, i);
        let v1;
        if (ret[0] !== 0) {
            v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * @returns {boolean}
     */
    get is_empty() {
        const ret = wasm.convertedfiles_is_empty(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {number}
     */
    get len() {
        const ret = wasm.convertedfiles_len(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get mesh_count() {
        const ret = wasm.convertedfiles_mesh_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} i
     * @returns {string | undefined}
     */
    name(i) {
        const ret = wasm.convertedfiles_name(this.__wbg_ptr, i);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * @returns {string | undefined}
     */
    get schema() {
        const ret = wasm.convertedfiles_schema(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * @returns {number}
     */
    get triangle_count() {
        const ret = wasm.convertedfiles_triangle_count(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) ConvertedFiles.prototype[Symbol.dispose] = ConvertedFiles.prototype.free;

/**
 * Conversion options passed from JS. Strings are parsed leniently; unknown values fall
 * back to the defaults.
 */
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
    constructor() {
        const ret = wasm.options_new();
        this.__wbg_ptr = ret;
        OptionsFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * `"merged"` | `"standard"`.
     * @param {string} v
     */
    set mode(v) {
        const ptr0 = passStringToWasm0(v, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.options_set_mode(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * `"skip"` | `"include"` | `"separate"`.
     * @param {string} v
     */
    set openings(v) {
        const ptr0 = passStringToWasm0(v, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.options_set_openings(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * `"lowest"` | `"low"` | `"medium"` | `"high"` | `"highest"`.
     * @param {string} v
     */
    set quality(v) {
        const ptr0 = passStringToWasm0(v, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.options_set_quality(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {boolean} v
     */
    set recenter(v) {
        wasm.options_set_recenter(this.__wbg_ptr, v);
    }
    /**
     * @param {string} v
     */
    set source_name(v) {
        const ptr0 = passStringToWasm0(v, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.options_set_source_name(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * `"skip"` | `"include"` | `"separate"`.
     * @param {string} v
     */
    set spaces(v) {
        const ptr0 = passStringToWasm0(v, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.options_set_spaces(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * `"none"` | `"site"` | `"building"` | `"storey"`.
     * @param {string} v
     */
    set split(v) {
        const ptr0 = passStringToWasm0(v, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.options_set_split(this.__wbg_ptr, ptr0, len0);
    }
}
if (Symbol.dispose) Options.prototype[Symbol.dispose] = Options.prototype.free;

/**
 * Convert an IFC model to GLB(s) + `status_file.json`.
 *
 * `on_progress` is an optional JS callback `(fraction: number) => void` reporting
 * `0.0..=1.0`; pass `null`/`undefined` to skip. It fires synchronously during the (wasm)
 * conversion — a Web Worker can forward it to the main thread to drive a progress bar.
 * @param {Uint8Array} ifc_bytes
 * @param {Options} opts
 * @param {Function | null} [on_progress]
 * @returns {ConvertedFiles}
 */
export function convert_ifc(ifc_bytes, opts, on_progress) {
    const ptr0 = passArray8ToWasm0(ifc_bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    _assertClass(opts, Options);
    const ret = wasm.convert_ifc(ptr0, len0, opts.__wbg_ptr, isLikeNone(on_progress) ? 0 : addToExternrefTable0(on_progress));
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ConvertedFiles.__wrap(ret[0]);
}

/**
 * IFC → cooked `.tdp`(s) in ONE step: each merged output goes straight into the
 * cooker, so no GLB is built, serialised or parsed. Names come back as
 * `<stem>.tdp`, each optionally followed by `<stem>.coarse.tdp` when `coarsen`
 * is set, plus the usual trailing `status_file.json`.
 * @param {Uint8Array} ifc_bytes
 * @param {Options} opts
 * @param {Function | null | undefined} on_progress
 * @param {boolean} compute_normals
 * @param {boolean} coarsen
 * @returns {ConvertedFiles}
 */
export function convert_ifc_tdp(ifc_bytes, opts, on_progress, compute_normals, coarsen) {
    const ptr0 = passArray8ToWasm0(ifc_bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    _assertClass(opts, Options);
    const ret = wasm.convert_ifc_tdp(ptr0, len0, opts.__wbg_ptr, isLikeNone(on_progress) ? 0 : addToExternrefTable0(on_progress), compute_normals, coarsen);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ConvertedFiles.__wrap(ret[0]);
}

/**
 * A JSON summary of what a model contains, without producing GLBs.
 * @param {Uint8Array} ifc_bytes
 * @returns {string}
 */
export function inspect_ifc(ifc_bytes) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passArray8ToWasm0(ifc_bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.inspect_ifc(ptr0, len0);
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
 * Install a panic hook that forwards Rust panics to the browser console.
 */
export function start() {
    wasm.start();
}

/**
 * The `ifc2glb-wasm` crate version.
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
        __wbg_Error_92b29b0548f8b746: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg___wbindgen_throw_344f42d3211c4765: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_call_a6e5c5dce5018821: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.call(arg1, arg2);
            return ret;
        }, arguments); },
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
        __wbg_stack_3b0d974bbf31e44f: function(arg0, arg1) {
            const ret = arg1.stack;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbindgen_cast_0000000000000001: function(arg0) {
            // Cast intrinsic for `F64 -> Externref`.
            const ret = arg0;
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
        "./ifc_wasm_bg.js": import0,
    };
}

const ConvertedFilesFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_convertedfiles_free(ptr, 1));
const OptionsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_options_free(ptr, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

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

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
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
        module_or_path = new URL('ifc_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
