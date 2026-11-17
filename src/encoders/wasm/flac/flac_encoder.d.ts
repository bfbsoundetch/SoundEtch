// TypeScript bindings for emscripten-generated code.  Automatically generated at compile time.
declare namespace RuntimeExports {
  let HEAPU8: Uint8Array
  let HEAPF32: Float32Array
  let HEAP32: Int32Array
  let HEAPU32: Uint32Array
}
interface WasmModule {
  _create_encoder(_0: number, _1: number, _2: number, _3: number, _4: number): number
  _encode_chunk(_0: number): number
  _get_encoder_state(): number
  _get_input_buffer_pointer(_0: number, _1: number): number
  _finish_encoding(): number
  _free(_0: number): void
  _malloc(_0: number): number
}

export type MainModule = WasmModule & typeof RuntimeExports
export default function MainModuleFactory(options?: unknown): Promise<MainModule>
