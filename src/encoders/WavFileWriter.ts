import { WavEncoderInfo, WavSampleFormat } from './EncoderType'

export class WavFileWriter {
  static readonly INPUT_BUFFER_SIZE = 4 * 1024

  private readonly inputBuffer = new Float32Array(WavFileWriter.INPUT_BUFFER_SIZE)

  constructor(
    private readonly fileWritable: FileSystemWritableFileStream,
    private readonly wavEncoderInfo: WavEncoderInfo,
  ) {
    this.fileWritable.write(
      WavFileWriter.getWavHeader(
        wavEncoderInfo.sampleFormat,
        wavEncoderInfo.sampleRate,
        wavEncoderInfo.sampleCount,
        wavEncoderInfo.channelCount,
      ),
    )
  }

  readonly inputSampleFormat = 'interleaved'

  getInputBuffer(): Float32Array {
    return this.inputBuffer
  }

  async writeChunk(length: number) {
    let outputBuffer: ArrayBufferView
    switch (this.wavEncoderInfo.sampleFormat) {
      case 'float32':
        outputBuffer = this.inputBuffer.subarray(0, length)
        break
      case 'int24':
        const outputBuffer24 = new Uint8Array(this.inputBuffer.buffer)
        for (let i = 0; i < length; ++i) {
          const value = this.inputBuffer[i] * ((1 << 23) - 1)
          outputBuffer24[3 * i] = value & 0xff
          outputBuffer24[3 * i + 1] = (value >> 8) & 0xff
          outputBuffer24[3 * i + 2] = (value >> 16) & 0xff
        }
        outputBuffer = outputBuffer24.subarray(0, length * 3)
        break
      case 'int16':
        const outputBuffer16 = new Int16Array(this.inputBuffer.buffer)
        for (let i = 0; i < length; ++i) {
          outputBuffer16[i] = this.inputBuffer[i] * ((1 << 15) - 1)
        }
        outputBuffer = outputBuffer16.subarray(0, length)
        break
      case 'int8':
        const outputBuffer8 = new Uint8Array(this.inputBuffer.buffer)
        for (let i = 0; i < length; ++i) {
          outputBuffer8[i] = this.inputBuffer[i] * ((1 << 7) - 1) + (1 << 7)
        }
        outputBuffer = outputBuffer8.subarray(0, length)
        break
    }
    await this.fileWritable.write(outputBuffer as ArrayBufferView<ArrayBuffer>)
  }

  async finish() {}

  static getWavHeader(sampleFormat: WavSampleFormat, sampleRate: number, sampleCount: number, channelCount: number) {
    let bytesPerSample: number
    switch (sampleFormat) {
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
    const byteRate = sampleRate * channelCount * bytesPerSample

    // WAV header
    const header = new ArrayBuffer(44)
    const view = new DataView(header)

    // RIFF chunk
    view.setUint32(0, 0x52494646, false) // 'RIFF'
    view.setUint32(4, 36 + sampleCount * channelCount * bytesPerSample, true) // File size - 8
    view.setUint32(8, 0x57415645, false) // 'WAVE'

    // Format chunk
    view.setUint32(12, 0x666d7420, false) // 'fmt '
    view.setUint32(16, 16, true)
    view.setUint16(20, sampleFormat === 'float32' ? 3 : 1, true)
    view.setUint16(22, channelCount, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, byteRate, true)
    view.setUint16(32, channelCount * bytesPerSample, true) // BlockAlign
    view.setUint16(34, bytesPerSample * 8, true) // BitsPerSample

    // Data chunk
    view.setUint32(36, 0x64617461, false) // 'data'
    view.setUint32(40, sampleCount * channelCount * bytesPerSample, true) // Data size

    return header
  }
}
