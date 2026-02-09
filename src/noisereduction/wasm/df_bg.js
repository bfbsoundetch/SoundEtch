let wasm
export function __wbg_set_wasm(val) {
  wasm = val
}

const heap = new Array(128).fill(undefined)

heap.push(undefined, null, true, false)

function getObject(idx) {
  return heap[idx]
}

let heap_next = heap.length

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

const lTextDecoder = typeof TextDecoder === 'undefined' ? (0, module.require)('util').TextDecoder : TextDecoder

let cachedTextDecoder = new lTextDecoder('utf-8', { ignoreBOM: true, fatal: true })

cachedTextDecoder.decode()

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

function addHeapObject(obj) {
  if (heap_next === heap.length) heap.push(heap.length + 1)
  const idx = heap_next
  heap_next = heap[idx]

  heap[idx] = obj
  return idx
}

let WASM_VECTOR_LEN = 0

function passArray8ToWasm0(arg, malloc) {
  const ptr = malloc(arg.length * 1, 1) >>> 0
  getUint8Memory0().set(arg, ptr / 1)
  WASM_VECTOR_LEN = arg.length
  return ptr
}
/**
 * Create a DeepFilterNet Model
 *
 * Args:
 *     - path: File path to a DeepFilterNet tar.gz onnx model
 *     - atten_lim: Attenuation limit in dB.
 *
 * Returns:
 *     - DF state doing the full processing: stft, DNN noise reduction, istft.
 * @param {Uint8Array} model_bytes
 * @param {number} atten_lim
 * @returns {number}
 */
export function df_create(model_bytes, atten_lim) {
  const ptr0 = passArray8ToWasm0(model_bytes, wasm.__wbindgen_malloc)
  const len0 = WASM_VECTOR_LEN
  const ret = wasm.df_create(ptr0, len0, atten_lim)
  return ret >>> 0
}

/**
 * Get DeepFilterNet frame size in samples.
 * @param {number} st
 * @returns {number}
 */
export function df_get_frame_length(st) {
  const ret = wasm.df_get_frame_length(st)
  return ret >>> 0
}

/**
 * Set DeepFilterNet attenuation limit.
 *
 * Args:
 *     - lim_db: New attenuation limit in dB.
 * @param {number} st
 * @param {number} lim_db
 */
export function df_set_atten_lim(st, lim_db) {
  wasm.df_set_atten_lim(st, lim_db)
}

/**
 * Set DeepFilterNet post filter beta. A beta of 0 disables the post filter.
 *
 * Args:
 *     - beta: Post filter attenuation. Suitable range between 0.05 and 0;
 * @param {number} st
 * @param {number} beta
 */
export function df_set_post_filter_beta(st, beta) {
  wasm.df_set_post_filter_beta(st, beta)
}

let cachedFloat32Memory0 = null

function getFloat32Memory0() {
  if (cachedFloat32Memory0 === null || cachedFloat32Memory0.byteLength === 0) {
    cachedFloat32Memory0 = new Float32Array(wasm.memory.buffer)
  }
  return cachedFloat32Memory0
}

function passArrayF32ToWasm0(arg, malloc) {
  const ptr = malloc(arg.length * 4, 4) >>> 0
  getFloat32Memory0().set(arg, ptr / 4)
  WASM_VECTOR_LEN = arg.length
  return ptr
}
/**
 * Processes a chunk of samples.
 *
 * Args:
 *     - df_state: Created via df_create()
 *     - input: Input buffer of length df_get_frame_length()
 *     - output: Output buffer of length df_get_frame_length()
 *
 * Returns:
 *     - Local SNR of the current frame.
 * @param {number} st
 * @param {Float32Array} input
 * @returns {Float32Array}
 */
export function df_process_frame(st, input) {
  const ptr0 = passArrayF32ToWasm0(input, wasm.__wbindgen_malloc)
  const len0 = WASM_VECTOR_LEN
  const ret = wasm.df_process_frame(st, ptr0, len0)
  return takeObject(ret)
}

/**
 * Processes a chunk of samples.
 *
 * Args:
 *     - df_state: Created via df_create()
 *     - input: Input buffer of length df_get_frame_length()
 *     - output: Output buffer of length df_get_frame_length()
 *
 * Returns:
 *     - Local SNR of the current frame.
 * @param {number} st
 * @param {number} input
 * @param {number} output
 * @returns {number}
 */
export function df_process_frame2(st, input, output) {
  const ret = wasm.df_process_frame2(st, input, output)
  return ret
}

/**
 * @param {number} size
 * @returns {number}
 */
export function df_create_frame_buffer(size) {
  const ret = wasm.df_create_frame_buffer(size)
  return ret >>> 0
}

function handleError(f, args) {
  try {
    return f.apply(this, args)
  } catch (e) {
    wasm.__wbindgen_exn_store(addHeapObject(e))
  }
}

const DFStateFinalization =
  typeof FinalizationRegistry === 'undefined'
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry((ptr) => wasm.__wbg_dfstate_free(ptr >>> 0))
/**
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
}

export function __wbindgen_object_drop_ref(arg0) {
  takeObject(arg0)
}

export function __wbg_crypto_566d7465cdbb6b7a(arg0) {
  const ret = getObject(arg0).crypto
  return addHeapObject(ret)
}

export function __wbindgen_is_object(arg0) {
  const val = getObject(arg0)
  const ret = typeof val === 'object' && val !== null
  return ret
}

export function __wbg_process_dc09a8c7d59982f6(arg0) {
  const ret = getObject(arg0).process
  return addHeapObject(ret)
}

export function __wbg_versions_d98c6400c6ca2bd8(arg0) {
  const ret = getObject(arg0).versions
  return addHeapObject(ret)
}

export function __wbg_node_caaf83d002149bd5(arg0) {
  const ret = getObject(arg0).node
  return addHeapObject(ret)
}

export function __wbindgen_is_string(arg0) {
  const ret = typeof getObject(arg0) === 'string'
  return ret
}

export function __wbg_require_94a9da52636aacbf() {
  return handleError(function () {
    const ret = module.require
    return addHeapObject(ret)
  }, arguments)
}

export function __wbindgen_is_function(arg0) {
  const ret = typeof getObject(arg0) === 'function'
  return ret
}

export function __wbindgen_string_new(arg0, arg1) {
  const ret = getStringFromWasm0(arg0, arg1)
  return addHeapObject(ret)
}

export function __wbg_msCrypto_0b84745e9245cdf6(arg0) {
  const ret = getObject(arg0).msCrypto
  return addHeapObject(ret)
}

export function __wbg_randomFillSync_290977693942bf03() {
  return handleError(function (arg0, arg1) {
    getObject(arg0).randomFillSync(takeObject(arg1))
  }, arguments)
}

export function __wbg_getRandomValues_260cc23a41afad9a() {
  return handleError(function (arg0, arg1) {
    getObject(arg0).getRandomValues(getObject(arg1))
  }, arguments)
}

export function __wbg_newnoargs_e258087cd0daa0ea(arg0, arg1) {
  const ret = new Function(getStringFromWasm0(arg0, arg1))
  return addHeapObject(ret)
}

export function __wbg_call_27c0f87801dedf93() {
  return handleError(function (arg0, arg1) {
    const ret = getObject(arg0).call(getObject(arg1))
    return addHeapObject(ret)
  }, arguments)
}

export function __wbindgen_object_clone_ref(arg0) {
  const ret = getObject(arg0)
  return addHeapObject(ret)
}

export function __wbg_self_ce0dbfc45cf2f5be() {
  return handleError(function () {
    const ret = self.self
    return addHeapObject(ret)
  }, arguments)
}

export function __wbg_window_c6fb939a7f436783() {
  return handleError(function () {
    const ret = window.window
    return addHeapObject(ret)
  }, arguments)
}

export function __wbg_globalThis_d1e6af4856ba331b() {
  return handleError(function () {
    const ret = globalThis.globalThis
    return addHeapObject(ret)
  }, arguments)
}

export function __wbg_global_207b558942527489() {
  return handleError(function () {
    const ret = global.global
    return addHeapObject(ret)
  }, arguments)
}

export function __wbindgen_is_undefined(arg0) {
  const ret = getObject(arg0) === undefined
  return ret
}

export function __wbg_call_b3ca7c6051f9bec1() {
  return handleError(function (arg0, arg1, arg2) {
    const ret = getObject(arg0).call(getObject(arg1), getObject(arg2))
    return addHeapObject(ret)
  }, arguments)
}

export function __wbg_buffer_12d079cc21e14bdb(arg0) {
  const ret = getObject(arg0).buffer
  return addHeapObject(ret)
}

export function __wbg_newwithbyteoffsetandlength_aa4a17c33a06e5cb(arg0, arg1, arg2) {
  const ret = new Uint8Array(getObject(arg0), arg1 >>> 0, arg2 >>> 0)
  return addHeapObject(ret)
}

export function __wbg_new_63b92bc8671ed464(arg0) {
  const ret = new Uint8Array(getObject(arg0))
  return addHeapObject(ret)
}

export function __wbg_set_a47bac70306a19a7(arg0, arg1, arg2) {
  getObject(arg0).set(getObject(arg1), arg2 >>> 0)
}

export function __wbg_newwithbyteoffsetandlength_4a659d079a1650e0(arg0, arg1, arg2) {
  const ret = new Float32Array(getObject(arg0), arg1 >>> 0, arg2 >>> 0)
  return addHeapObject(ret)
}

export function __wbg_new_9efabd6b6d2ce46d(arg0) {
  const ret = new Float32Array(getObject(arg0))
  return addHeapObject(ret)
}

export function __wbg_newwithlength_e9b4878cebadb3d3(arg0) {
  const ret = new Uint8Array(arg0 >>> 0)
  return addHeapObject(ret)
}

export function __wbg_subarray_a1f73cd4b5b42fe1(arg0, arg1, arg2) {
  const ret = getObject(arg0).subarray(arg1 >>> 0, arg2 >>> 0)
  return addHeapObject(ret)
}

export function __wbindgen_throw(arg0, arg1) {
  throw new Error(getStringFromWasm0(arg0, arg1))
}

export function __wbindgen_memory() {
  const ret = wasm.memory
  return addHeapObject(ret)
}
