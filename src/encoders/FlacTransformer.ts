import { WasmModule } from './wasm/flac_encoder'

export class Mp3Transformer implements Transformer<Float32Array, ArrayBuffer | SharedArrayBuffer> {
  constructor(
    private readonly channelCount: number,
    private readonly Module: WasmModule,
  ) {}

  static async create() {
    const Module = await (await import(new URL('./wasm/flac_encoder.mjs', import.meta.url).toString())).createModule()
  }

  flush(controller: TransformStreamDefaultController<ArrayBuffer | SharedArrayBuffer>) {}
  start: TransformerStartCallback<ArrayBuffer | SharedArrayBuffer> = (
    controller: TransformStreamDefaultController<ArrayBuffer | SharedArrayBuffer>,
  ) => {}

  transform: TransformerTransformCallback<Float32Array, ArrayBuffer | SharedArrayBuffer> = (
    chunk: Float32Array,
    controller: TransformStreamDefaultController<ArrayBuffer | SharedArrayBuffer>,
  ) => {
    this.Module._encode_chunk(inputBufferPointer, chunk.length / this.channelCount)
  }
}
