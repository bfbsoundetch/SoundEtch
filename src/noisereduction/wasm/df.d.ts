/* tslint:disable */
/* eslint-disable */
/**
 */
export class DFRuntimeParams {
  free(): void
  /**
   */
  constructor()
  /**
   * Maximum local SNR threshold for running the DF decoder in dB.
   */
  max_db_df_thresh: number
  /**
   * Maximum local SNR threshold for running the ERB decoder in dB.
   */
  max_db_erb_thresh: number
  /**
   * Minimum local SNR threshold in dB.
   */
  min_db_thresh: number
  /**
   * Post-filter attenuation. A value of 0 disables the post-filter.
   */
  post_filter_beta: number
}
/**
 * DeepFilterNet state with stable, reusable frame buffers.
 *
 * `input_ptr` and `output_ptr` are offsets into WebAssembly linear memory.
 * Create `Float32Array` views over those offsets after constructing the state,
 * and recreate the views whenever `WebAssembly.Memory.buffer` changes.
 */
export class DFState {
  free(): void
  /**
   * Offset of the reusable output frame in WebAssembly linear memory.
   * @returns {number}
   */
  output_ptr(): number
  /**
   * Process the current input frame into the reusable output frame.
   *
   * Returns the local SNR estimate for the frame.
   * @returns {number}
   */
  process_frame(): number
  /**
   * Set the attenuation limit in dB.
   * @param {number} lim_db
   */
  set_atten_lim(lim_db: number): void
  /**
   * Set the minimum local SNR threshold in dB.
   * @param {number} min_db_thresh
   */
  set_min_db_thresh(min_db_thresh: number): void
  /**
   * Set the maximum local SNR threshold for running the DF decoder in dB.
   * @param {number} max_db_df_thresh
   */
  set_max_db_df_thresh(max_db_df_thresh: number): void
  /**
   * Set post-filter attenuation. A value of 0 disables the post-filter.
   * @param {number} beta
   */
  set_post_filter_beta(beta: number): void
  /**
   * Set the maximum local SNR threshold for running the ERB decoder in dB.
   * @param {number} max_db_erb_thresh
   */
  set_max_db_erb_thresh(max_db_erb_thresh: number): void
  /**
   * Create a mono DeepFilterNet runtime from tar.gz ONNX model bytes.
   * @param {Uint8Array} model_bytes
   * @param {number} atten_lim
   * @param {DFRuntimeParams} params
   */
  constructor(model_bytes: Uint8Array, atten_lim: number, params: DFRuntimeParams)
  /**
   * Offset of the reusable input frame in WebAssembly linear memory.
   * @returns {number}
   */
  input_ptr(): number
  /**
   * Frame length in samples.
   */
  readonly frame_length: number
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module

export interface InitOutput {
  readonly memory: WebAssembly.Memory
  readonly __wbg_dfruntimeparams_free: (a: number) => void
  readonly __wbg_dfstate_free: (a: number) => void
  readonly __wbg_get_dfruntimeparams_max_db_df_thresh: (a: number) => number
  readonly __wbg_get_dfruntimeparams_max_db_erb_thresh: (a: number) => number
  readonly __wbg_get_dfruntimeparams_min_db_thresh: (a: number) => number
  readonly __wbg_get_dfruntimeparams_post_filter_beta: (a: number) => number
  readonly __wbg_set_dfruntimeparams_max_db_df_thresh: (a: number, b: number) => void
  readonly __wbg_set_dfruntimeparams_max_db_erb_thresh: (a: number, b: number) => void
  readonly __wbg_set_dfruntimeparams_min_db_thresh: (a: number, b: number) => void
  readonly __wbg_set_dfruntimeparams_post_filter_beta: (a: number, b: number) => void
  readonly dfruntimeparams_new: () => number
  readonly dfstate_frame_length: (a: number) => number
  readonly dfstate_input_ptr: (a: number) => number
  readonly dfstate_new: (a: number, b: number, c: number, d: number, e: number) => void
  readonly dfstate_output_ptr: (a: number) => number
  readonly dfstate_process_frame: (a: number, b: number) => void
  readonly dfstate_set_atten_lim: (a: number, b: number) => void
  readonly dfstate_set_max_db_df_thresh: (a: number, b: number) => void
  readonly dfstate_set_max_db_erb_thresh: (a: number, b: number) => void
  readonly dfstate_set_min_db_thresh: (a: number, b: number) => void
  readonly dfstate_set_post_filter_beta: (a: number, b: number) => void
  readonly __wbindgen_add_to_stack_pointer: (a: number) => number
  readonly __wbindgen_export_0: (a: number, b: number) => number
  readonly __wbindgen_export_1: (a: number, b: number, c: number) => void
  readonly __wbindgen_export_2: (a: number, b: number, c: number, d: number) => number
  readonly __wbindgen_export_3: (a: number) => void
}

export type SyncInitInput = BufferSource | WebAssembly.Module
/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {SyncInitInput} module
 *
 * @returns {InitOutput}
 */
export function initSync(module: SyncInitInput): InitOutput

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {InitInput | Promise<InitInput>} module_or_path
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init(module_or_path: InitInput | Promise<InitInput>): Promise<InitOutput>
