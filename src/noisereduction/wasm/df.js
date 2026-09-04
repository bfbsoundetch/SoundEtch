let wasm

const cachedTextDecoder =
  typeof TextDecoder !== 'undefined'
    ? new TextDecoder('utf-8', { ignoreBOM: true, fatal: true })
    : {
        decode: () => {
          throw Error('TextDecoder not available')
        },
      }

if (typeof TextDecoder !== 'undefined') {
  cachedTextDecoder.decode()
}

let cachedUint8Memory0 = null

function getUint8Memory0() {
  if (cachedUint8Memory0 === null || cachedUint8Memory0.byteLength === 0) {
    cachedUint8Memory0 = new Uint8Array(wasm.memory.buffer)
  }
  return cachedUint8Memory0
}

function getStringFromWasm0(ptr, len) {
  ptr = ptr >>> 0
  return cachedTextDecoder.decode(getUint8Memory0().subarray(ptr, ptr + len))
}

const heap = new Array(128).fill(undefined)

heap.push(undefined, null, true, false)

let heap_next = heap.length

function addHeapObject(obj) {
  if (heap_next === heap.length) heap.push(heap.length + 1)
  const idx = heap_next
  heap_next = heap[idx]

  heap[idx] = obj
  return idx
}

function getObject(idx) {
  return heap[idx]
}

function dropObject(idx) {
  if (idx < 132) return
  heap[idx] = heap_next
  heap_next = idx
}

function takeObject(idx) {
  const ret = getObject(idx)
  dropObject(idx)
  return ret
}

let cachedFloat32Memory0 = null

function getFloat32Memory0() {
  if (cachedFloat32Memory0 === null || cachedFloat32Memory0.byteLength === 0) {
    cachedFloat32Memory0 = new Float32Array(wasm.memory.buffer)
  }
  return cachedFloat32Memory0
}

let cachedInt32Memory0 = null

function getInt32Memory0() {
  if (cachedInt32Memory0 === null || cachedInt32Memory0.byteLength === 0) {
    cachedInt32Memory0 = new Int32Array(wasm.memory.buffer)
  }
  return cachedInt32Memory0
}

let WASM_VECTOR_LEN = 0

function passArray8ToWasm0(arg, malloc) {
  const ptr = malloc(arg.length * 1, 1) >>> 0
  getUint8Memory0().set(arg, ptr / 1)
  WASM_VECTOR_LEN = arg.length
  return ptr
}

function _assertClass(instance, klass) {
  if (!(instance instanceof klass)) {
    throw new Error(`expected instance of ${klass.name}`)
  }
  return instance.ptr
}

const cachedTextEncoder =
  typeof TextEncoder !== 'undefined'
    ? new TextEncoder('utf-8')
    : {
        encode: () => {
          throw Error('TextEncoder not available')
        },
      }

const encodeString =
  typeof cachedTextEncoder.encodeInto === 'function'
    ? function (arg, view) {
        return cachedTextEncoder.encodeInto(arg, view)
      }
    : function (arg, view) {
        const buf = cachedTextEncoder.encode(arg)
        view.set(buf)
        return {
          read: arg.length,
          written: buf.length,
        }
      }

function passStringToWasm0(arg, malloc, realloc) {
  if (realloc === undefined) {
    const buf = cachedTextEncoder.encode(arg)
    const ptr = malloc(buf.length, 1) >>> 0
    getUint8Memory0()
      .subarray(ptr, ptr + buf.length)
      .set(buf)
    WASM_VECTOR_LEN = buf.length
    return ptr
  }

  let len = arg.length
  let ptr = malloc(len, 1) >>> 0

  const mem = getUint8Memory0()

  let offset = 0

  for (; offset < len; offset++) {
    const code = arg.charCodeAt(offset)
    if (code > 0x7f) break
    mem[ptr + offset] = code
  }

  if (offset !== len) {
    if (offset !== 0) {
      arg = arg.slice(offset)
    }
    ptr = realloc(ptr, len, (len = offset + arg.length * 3), 1) >>> 0
    const view = getUint8Memory0().subarray(ptr + offset, ptr + len)
    const ret = encodeString(arg, view)

    offset += ret.written
    ptr = realloc(ptr, len, offset, 1) >>> 0
  }

  WASM_VECTOR_LEN = offset
  return ptr
}

function handleError(f, args) {
  try {
    return f.apply(this, args)
  } catch (e) {
    wasm.__wbindgen_export_3(addHeapObject(e))
  }
}

const DFRuntimeParamsFinalization =
  typeof FinalizationRegistry === 'undefined'
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry((ptr) => wasm.__wbg_dfruntimeparams_free(ptr >>> 0))
/**
 */
export class DFRuntimeParams {
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr
    this.__wbg_ptr = 0
    DFRuntimeParamsFinalization.unregister(this)
    return ptr
  }

  free() {
    const ptr = this.__destroy_into_raw()
    wasm.__wbg_dfruntimeparams_free(ptr)
  }
  /**
   * Minimum local SNR threshold in dB.
   * @returns {number}
   */
  get min_db_thresh() {
    const ret = wasm.__wbg_get_dfruntimeparams_min_db_thresh(this.__wbg_ptr)
    return ret
  }
  /**
   * Minimum local SNR threshold in dB.
   * @param {number} arg0
   */
  set min_db_thresh(arg0) {
    wasm.__wbg_set_dfruntimeparams_min_db_thresh(this.__wbg_ptr, arg0)
  }
  /**
   * Maximum local SNR threshold for running the ERB decoder in dB.
   * @returns {number}
   */
  get max_db_erb_thresh() {
    const ret = wasm.__wbg_get_dfruntimeparams_max_db_erb_thresh(this.__wbg_ptr)
    return ret
  }
  /**
   * Maximum local SNR threshold for running the ERB decoder in dB.
   * @param {number} arg0
   */
  set max_db_erb_thresh(arg0) {
    wasm.__wbg_set_dfruntimeparams_max_db_erb_thresh(this.__wbg_ptr, arg0)
  }
  /**
   * Maximum local SNR threshold for running the DF decoder in dB.
   * @returns {number}
   */
  get max_db_df_thresh() {
    const ret = wasm.__wbg_get_dfruntimeparams_max_db_df_thresh(this.__wbg_ptr)
    return ret
  }
  /**
   * Maximum local SNR threshold for running the DF decoder in dB.
   * @param {number} arg0
   */
  set max_db_df_thresh(arg0) {
    wasm.__wbg_set_dfruntimeparams_max_db_df_thresh(this.__wbg_ptr, arg0)
  }
  /**
   * Post-filter attenuation. A value of 0 disables the post-filter.
   * @returns {number}
   */
  get post_filter_beta() {
    const ret = wasm.__wbg_get_dfruntimeparams_post_filter_beta(this.__wbg_ptr)
    return ret
  }
  /**
   * Post-filter attenuation. A value of 0 disables the post-filter.
   * @param {number} arg0
   */
  set post_filter_beta(arg0) {
    wasm.__wbg_set_dfruntimeparams_post_filter_beta(this.__wbg_ptr, arg0)
  }
  /**
   */
  constructor() {
    const ret = wasm.dfruntimeparams_new()
    this.__wbg_ptr = ret >>> 0
    return this
  }
}

const DFStateFinalization =
  typeof FinalizationRegistry === 'undefined'
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry((ptr) => wasm.__wbg_dfstate_free(ptr >>> 0))
/**
 * DeepFilterNet state with stable, reusable frame buffers.
 *
 * `input_ptr` and `output_ptr` are offsets into WebAssembly linear memory.
 * Create `Float32Array` views over those offsets after constructing the state,
 * and recreate the views whenever `WebAssembly.Memory.buffer` changes.
 */
export class DFState {
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr
    this.__wbg_ptr = 0
    DFStateFinalization.unregister(this)
    return ptr
  }

  free() {
    const ptr = this.__destroy_into_raw()
    wasm.__wbg_dfstate_free(ptr)
  }
  /**
   * Offset of the reusable output frame in WebAssembly linear memory.
   * @returns {number}
   */
  output_ptr() {
    const ret = wasm.dfstate_output_ptr(this.__wbg_ptr)
    return ret >>> 0
  }
  /**
   * Frame length in samples.
   * @returns {number}
   */
  get frame_length() {
    const ret = wasm.dfstate_frame_length(this.__wbg_ptr)
    return ret >>> 0
  }
  /**
   * Process the current input frame into the reusable output frame.
   *
   * Returns the local SNR estimate for the frame.
   * @returns {number}
   */
  process_frame() {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16)
      wasm.dfstate_process_frame(retptr, this.__wbg_ptr)
      var r0 = getFloat32Memory0()[retptr / 4 + 0]
      var r1 = getInt32Memory0()[retptr / 4 + 1]
      var r2 = getInt32Memory0()[retptr / 4 + 2]
      if (r2) {
        throw takeObject(r1)
      }
      return r0
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16)
    }
  }
  /**
   * Set the attenuation limit in dB.
   * @param {number} lim_db
   */
  set_atten_lim(lim_db) {
    wasm.dfstate_set_atten_lim(this.__wbg_ptr, lim_db)
  }
  /**
   * Set the minimum local SNR threshold in dB.
   * @param {number} min_db_thresh
   */
  set_min_db_thresh(min_db_thresh) {
    wasm.dfstate_set_min_db_thresh(this.__wbg_ptr, min_db_thresh)
  }
  /**
   * Set the maximum local SNR threshold for running the DF decoder in dB.
   * @param {number} max_db_df_thresh
   */
  set_max_db_df_thresh(max_db_df_thresh) {
    wasm.dfstate_set_max_db_df_thresh(this.__wbg_ptr, max_db_df_thresh)
  }
  /**
   * Set post-filter attenuation. A value of 0 disables the post-filter.
   * @param {number} beta
   */
  set_post_filter_beta(beta) {
    wasm.dfstate_set_post_filter_beta(this.__wbg_ptr, beta)
  }
  /**
   * Set the maximum local SNR threshold for running the ERB decoder in dB.
   * @param {number} max_db_erb_thresh
   */
  set_max_db_erb_thresh(max_db_erb_thresh) {
    wasm.dfstate_set_max_db_erb_thresh(this.__wbg_ptr, max_db_erb_thresh)
  }
  /**
   * Create a mono DeepFilterNet runtime from tar.gz ONNX model bytes.
   * @param {Uint8Array} model_bytes
   * @param {number} atten_lim
   * @param {DFRuntimeParams} params
   */
  constructor(model_bytes, atten_lim, params) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16)
      const ptr0 = passArray8ToWasm0(model_bytes, wasm.__wbindgen_export_0)
      const len0 = WASM_VECTOR_LEN
      _assertClass(params, DFRuntimeParams)
      wasm.dfstate_new(retptr, ptr0, len0, atten_lim, params.__wbg_ptr)
      var r0 = getInt32Memory0()[retptr / 4 + 0]
      var r1 = getInt32Memory0()[retptr / 4 + 1]
      var r2 = getInt32Memory0()[retptr / 4 + 2]
      if (r2) {
        throw takeObject(r1)
      }
      this.__wbg_ptr = r0 >>> 0
      return this
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16)
    }
  }
  /**
   * Offset of the reusable input frame in WebAssembly linear memory.
   * @returns {number}
   */
  input_ptr() {
    const ret = wasm.dfstate_input_ptr(this.__wbg_ptr)
    return ret >>> 0
  }
}

async function __wbg_load(module, imports) {
  if (typeof Response === 'function' && module instanceof Response) {
    if (typeof WebAssembly.instantiateStreaming === 'function') {
      try {
        return await WebAssembly.instantiateStreaming(module, imports)
      } catch (e) {
        if (module.headers.get('Content-Type') != 'application/wasm') {
          console.warn(
            '`WebAssembly.instantiateStreaming` failed because your server does not serve wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n',
            e,
          )
        } else {
          throw e
        }
      }
    }

    const bytes = await module.arrayBuffer()
    return await WebAssembly.instantiate(bytes, imports)
  } else {
    const instance = await WebAssembly.instantiate(module, imports)

    if (instance instanceof WebAssembly.Instance) {
      return { instance, module }
    } else {
      return instance
    }
  }
}

function __wbg_get_imports() {
  const imports = {}
  imports.wbg = {}
  imports.wbg.__wbindgen_string_new = function (arg0, arg1) {
    const ret = getStringFromWasm0(arg0, arg1)
    return addHeapObject(ret)
  }
  imports.wbg.__wbg_new_abda76e883ba8a5f = function () {
    const ret = new Error()
    return addHeapObject(ret)
  }
  imports.wbg.__wbg_stack_658279fe44541cf6 = function (arg0, arg1) {
    const ret = getObject(arg1).stack
    const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_export_0, wasm.__wbindgen_export_2)
    const len1 = WASM_VECTOR_LEN
    getInt32Memory0()[arg0 / 4 + 1] = len1
    getInt32Memory0()[arg0 / 4 + 0] = ptr1
  }
  imports.wbg.__wbg_error_f851667af71bcfc6 = function (arg0, arg1) {
    let deferred0_0
    let deferred0_1
    try {
      deferred0_0 = arg0
      deferred0_1 = arg1
      console.error(getStringFromWasm0(arg0, arg1))
    } finally {
      wasm.__wbindgen_export_1(deferred0_0, deferred0_1, 1)
    }
  }
  imports.wbg.__wbindgen_object_drop_ref = function (arg0) {
    takeObject(arg0)
  }
  imports.wbg.__wbg_randomFillSync_290977693942bf03 = function () {
    return handleError(function (arg0, arg1) {
      getObject(arg0).randomFillSync(takeObject(arg1))
    }, arguments)
  }
  imports.wbg.__wbg_getRandomValues_260cc23a41afad9a = function () {
    return handleError(function (arg0, arg1) {
      getObject(arg0).getRandomValues(getObject(arg1))
    }, arguments)
  }
  imports.wbg.__wbg_crypto_566d7465cdbb6b7a = function (arg0) {
    const ret = getObject(arg0).crypto
    return addHeapObject(ret)
  }
  imports.wbg.__wbindgen_is_object = function (arg0) {
    const val = getObject(arg0)
    const ret = typeof val === 'object' && val !== null
    return ret
  }
  imports.wbg.__wbg_process_dc09a8c7d59982f6 = function (arg0) {
    const ret = getObject(arg0).process
    return addHeapObject(ret)
  }
  imports.wbg.__wbg_versions_d98c6400c6ca2bd8 = function (arg0) {
    const ret = getObject(arg0).versions
    return addHeapObject(ret)
  }
  imports.wbg.__wbg_node_caaf83d002149bd5 = function (arg0) {
    const ret = getObject(arg0).node
    return addHeapObject(ret)
  }
  imports.wbg.__wbindgen_is_string = function (arg0) {
    const ret = typeof getObject(arg0) === 'string'
    return ret
  }
  imports.wbg.__wbg_require_94a9da52636aacbf = function () {
    return handleError(function () {
      const ret = module.require
      return addHeapObject(ret)
    }, arguments)
  }
  imports.wbg.__wbg_msCrypto_0b84745e9245cdf6 = function (arg0) {
    const ret = getObject(arg0).msCrypto
    return addHeapObject(ret)
  }
  imports.wbg.__wbindgen_object_clone_ref = function (arg0) {
    const ret = getObject(arg0)
    return addHeapObject(ret)
  }
  imports.wbg.__wbg_self_ce0dbfc45cf2f5be = function () {
    return handleError(function () {
      const ret = self.self
      return addHeapObject(ret)
    }, arguments)
  }
  imports.wbg.__wbg_window_c6fb939a7f436783 = function () {
    return handleError(function () {
      const ret = window.window
      return addHeapObject(ret)
    }, arguments)
  }
  imports.wbg.__wbg_globalThis_d1e6af4856ba331b = function () {
    return handleError(function () {
      const ret = globalThis.globalThis
      return addHeapObject(ret)
    }, arguments)
  }
  imports.wbg.__wbg_global_207b558942527489 = function () {
    return handleError(function () {
      const ret = global.global
      return addHeapObject(ret)
    }, arguments)
  }
  imports.wbg.__wbindgen_is_undefined = function (arg0) {
    const ret = getObject(arg0) === undefined
    return ret
  }
  imports.wbg.__wbg_newnoargs_e258087cd0daa0ea = function (arg0, arg1) {
    const ret = new Function(getStringFromWasm0(arg0, arg1))
    return addHeapObject(ret)
  }
  imports.wbg.__wbg_call_27c0f87801dedf93 = function () {
    return handleError(function (arg0, arg1) {
      const ret = getObject(arg0).call(getObject(arg1))
      return addHeapObject(ret)
    }, arguments)
  }
  imports.wbg.__wbindgen_is_function = function (arg0) {
    const ret = typeof getObject(arg0) === 'function'
    return ret
  }
  imports.wbg.__wbg_buffer_12d079cc21e14bdb = function (arg0) {
    const ret = getObject(arg0).buffer
    return addHeapObject(ret)
  }
  imports.wbg.__wbg_call_b3ca7c6051f9bec1 = function () {
    return handleError(function (arg0, arg1, arg2) {
      const ret = getObject(arg0).call(getObject(arg1), getObject(arg2))
      return addHeapObject(ret)
    }, arguments)
  }
  imports.wbg.__wbg_newwithbyteoffsetandlength_aa4a17c33a06e5cb = function (arg0, arg1, arg2) {
    const ret = new Uint8Array(getObject(arg0), arg1 >>> 0, arg2 >>> 0)
    return addHeapObject(ret)
  }
  imports.wbg.__wbg_new_63b92bc8671ed464 = function (arg0) {
    const ret = new Uint8Array(getObject(arg0))
    return addHeapObject(ret)
  }
  imports.wbg.__wbg_set_a47bac70306a19a7 = function (arg0, arg1, arg2) {
    getObject(arg0).set(getObject(arg1), arg2 >>> 0)
  }
  imports.wbg.__wbg_newwithlength_e9b4878cebadb3d3 = function (arg0) {
    const ret = new Uint8Array(arg0 >>> 0)
    return addHeapObject(ret)
  }
  imports.wbg.__wbg_subarray_a1f73cd4b5b42fe1 = function (arg0, arg1, arg2) {
    const ret = getObject(arg0).subarray(arg1 >>> 0, arg2 >>> 0)
    return addHeapObject(ret)
  }
  imports.wbg.__wbindgen_memory = function () {
    const ret = wasm.memory
    return addHeapObject(ret)
  }
  imports.wbg.__wbindgen_throw = function (arg0, arg1) {
    throw new Error(getStringFromWasm0(arg0, arg1))
  }

  return imports
}

function __wbg_init_memory(imports, maybe_memory) {}

function __wbg_finalize_init(instance, module) {
  wasm = instance.exports
  __wbg_init.__wbindgen_wasm_module = module
  cachedFloat32Memory0 = null
  cachedInt32Memory0 = null
  cachedUint8Memory0 = null

  return wasm
}

function initSync(module) {
  if (wasm !== undefined) return wasm

  const imports = __wbg_get_imports()

  __wbg_init_memory(imports)

  if (!(module instanceof WebAssembly.Module)) {
    module = new WebAssembly.Module(module)
  }

  const instance = new WebAssembly.Instance(module, imports)

  return __wbg_finalize_init(instance, module)
}

async function __wbg_init(input) {
  if (wasm !== undefined) return wasm

  if (typeof input === 'undefined') {
    throw new TypeError('WASM input is required')
  }
  const imports = __wbg_get_imports()

  if (
    typeof input === 'string' ||
    (typeof Request === 'function' && input instanceof Request) ||
    (typeof URL === 'function' && input instanceof URL)
  ) {
    input = fetch(input)
  }

  __wbg_init_memory(imports)

  const { instance, module } = await __wbg_load(await input, imports)

  return __wbg_finalize_init(instance, module)
}

export { initSync }
export default __wbg_init
