// TypeScript bindings for emscripten-generated code.  Automatically generated at compile time.
declare namespace RuntimeExports {
    /**
     * @param {string=} returnType
     * @param {Array=} argTypes
     * @param {Object=} opts
     */
    function cwrap(ident: any, returnType?: string | undefined, argTypes?: any[] | undefined, opts?: any | undefined): any;
    let HEAPU8: Uint8Array;
    let HEAPF32: Float32Array;
}
interface WasmModule {
  _init_lame(_0: number, _1: number, _2: number, _3: number, _4: number, _5: number): number;
  _malloc(_0: number): number;
  _encode_samples(_0: number): number;
  _flush_lame(): number;
  _get_lame_tag(): number;
  _getLeftInputBufferPointer(): number;
  _getRightInputBufferPointer(): number;
  _getOutputBufferPointer(): number;
  _close_lame(): void;
  _free(_0: number): void;
}

export type MainModule = WasmModule & typeof RuntimeExports;
export default function MainModuleFactory (options?: unknown): Promise<MainModule>;
