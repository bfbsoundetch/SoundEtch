import { WavSampleFormat } from './EncoderType'

export class WavTransformer implements Transformer<Float32Array, ArrayBuffer | SharedArrayBuffer> {
  constructor(
    private readonly dataSampleCount: number,
    private readonly sampleRate: number,
    private readonly channelCount: number,
    private readonly outputFormat: WavSampleFormat,
  ) {}

  flush() {}
  start: TransformerStartCallback<ArrayBuffer | SharedArrayBuffer> = (
    controller: TransformStreamDefaultController<ArrayBuffer | SharedArrayBuffer>,
  ) => {
    let bytesPerSample: number
    switch (this.outputFormat) {
      case 'float32':
        bytesPerSample = 4
        break
      case 'int24':
        bytesPerSample = 3
        break
      case 'int16':
        bytesPerSample = 2
        break
      case 'int8':
        bytesPerSample = 1
        break
    }
    const byteRate = this.sampleRate * this.channelCount * bytesPerSample

    // WAV header
    const header = new ArrayBuffer(44)
    const view = new DataView(header)

    // RIFF chunk
    view.setUint32(0, 0x52494646, false) // 'RIFF'
    view.setUint32(4, 36 + this.dataSampleCount * this.channelCount * bytesPerSample, true) // File size - 8
    view.setUint32(8, 0x57415645, false) // 'WAVE'

    // Format chunk
    view.setUint32(12, 0x666d7420, false) // 'fmt '
    view.setUint32(16, 16, true)
    view.setUint16(20, 3, true) // AudioFormat (3 = IEEE float)
    view.setUint16(22, this.channelCount, true)
    view.setUint32(24, this.sampleRate, true)
    view.setUint32(28, byteRate, true)
    view.setUint16(32, this.channelCount * bytesPerSample, true) // BlockAlign
    view.setUint16(34, bytesPerSample * 8, true) // BitsPerSample

    // Data chunk
    view.setUint32(36, 0x64617461, false) // 'data'
    view.setUint32(40, this.dataSampleCount * this.channelCount * bytesPerSample, true) // Data size

    controller.enqueue(header)
  }
  transform: TransformerTransformCallback<Float32Array, ArrayBuffer | SharedArrayBuffer> = (
    chunk: Float32Array,
    controller: TransformStreamDefaultController<ArrayBuffer | SharedArrayBuffer>,
  ) => {
    switch (this.outputFormat) {
      case 'float32':
        controller.enqueue(chunk.buffer)
        break
      case 'int24':
        const outputBuffer24 = new Uint8Array(chunk.buffer)
        for (let i = 0; i < chunk.length; ++i) {
          const value = chunk[i] * ((1 << 23) - 1)
          outputBuffer24[3 * i] = value & 0xff
          outputBuffer24[3 * i + 1] = (value >> 8) & 0xff
          outputBuffer24[3 * i + 2] = (value >> 16) & 0xff
        }
        controller.enqueue(outputBuffer24.slice(0, 3 * chunk.length).buffer)
        break
      case 'int16':
        const outputBuffer16 = new Int16Array(chunk.buffer)
        for (let i = 0; i < chunk.length; ++i) {
          outputBuffer16[i] = chunk[i] * ((1 << 15) - 1)
        }
        controller.enqueue(outputBuffer16.slice(0, chunk.length).buffer)
        break
      case 'int8':
        const outputBuffer8 = new Uint8Array(chunk.buffer)
        for (let i = 0; i < chunk.length; ++i) {
          outputBuffer8[i] = chunk[i] * ((1 << 7) - 1)
        }
        controller.enqueue(outputBuffer8.slice(0, chunk.length).buffer)
        break
    }
  }
}
