import createModule from './wasm/mp3/mp3_encoder'

export type Mp3CbrValue = 8 | 16 | 24 | 32 | 40 | 48 | 64 | 80 | 96 | 112 | 128 | 160 | 192 | 224 | 256 | 320
export type Mp3OutputSampleRate = 8000 | 11025 | 12000 | 16000 | 22050 | 24000 | 32000 | 44100 | 48000

export class Mp3Transformer implements Transformer<Float32Array, ArrayBuffer | SharedArrayBuffer> {
  static async createCbrEncoder(
    inputSampleRate: number,
    outputSampleRate: Mp3OutputSampleRate,
    channelCount: 1 | 2,
    cbrValue: Mp3CbrValue,
  ) {
    const encoder = await createModule()

    encoder.configure({
      channels: channelCount,
      sampleRate: inputSampleRate,
      // outputSampleRate: outputSampleRate,
      bitrate: cbrValue,
    })
    console.error(`${channelCount} ${inputSampleRate} ${outputSampleRate} ${cbrValue}`)
    return new Mp3Transformer(channelCount, encoder)
  }

  static async createVbrEncoder(
    inputSampleRate: number,
    outputSampleRate: Mp3OutputSampleRate,
    channelCount: 1 | 2,
    vbrQuality: number,
  ) {
    if (vbrQuality < 0 || vbrQuality >= 10) {
      throw new Error(`vbrQuality must be between 0 and 10. Received: ${vbrQuality}`)
    }
    const encoder = await createMp3Encoder()

    encoder.configure({
      channels: channelCount,
      sampleRate: inputSampleRate,
      outputSampleRate: outputSampleRate,
      vbrQuality: vbrQuality,
    })
    return new Mp3Transformer(channelCount, encoder)
  }

  constructor(
    private readonly channelCount: 1 | 2,
    private readonly encoder: WasmMediaEncoder<'audio/mpeg'>,
  ) {}

  flush(controller: TransformStreamDefaultController<ArrayBuffer | SharedArrayBuffer>) {
    const encoded = this.encoder.finalize()
    controller.enqueue(encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength))
  }
  start: TransformerStartCallback<ArrayBuffer | SharedArrayBuffer> = (
    controller: TransformStreamDefaultController<ArrayBuffer | SharedArrayBuffer>,
  ) => {}

  transform: TransformerTransformCallback<Float32Array, ArrayBuffer | SharedArrayBuffer> = (
    chunk: Float32Array,
    controller: TransformStreamDefaultController<ArrayBuffer | SharedArrayBuffer>,
  ) => {
    let encoded: Uint8Array
    switch (this.channelCount) {
      case 1: {
        encoded = this.encoder.encode([chunk])
        break
      }
      case 2: {
        encoded = this.encoder.encode([chunk.subarray(0, chunk.length / 2), chunk.subarray(chunk.length / 2)])
        break
      }
    }
    if (encoded.length == 0) {
      return
    }
    // console.error(encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength).byteLength)
    controller.enqueue(encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength))
  }
}
