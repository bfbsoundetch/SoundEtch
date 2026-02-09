import { WavSampleFormat } from './EncoderType'

export class WavWritableStream implements WritableStream {
  constructor(
    private readonly dataSampleCount: number,
    private readonly sampleRate: number,
    private readonly channelCount: number,
    private readonly outputFormat: WavSampleFormat,
  ) {}

  locked: boolean
  abort(reason?: any): Promise<void> {
    throw new Error('Method not implemented.')
  }
  close(): Promise<void> {
    throw new Error('Method not implemented.')
  }
  getWriter(): WritableStreamDefaultWriter<any> {
    throw new Error('Method not implemented.')
  }
}

class WavWritableStreamDefaultWriter implements WritableStreamDefaultWriter {
  private outputBuffer24: Uint8Array | null = null

  private constructor(
    private readonly outputFormat: WavSampleFormat,
    private readonly fileOut: FileSystemFileHandle,
    private readonly writableStream: FileSystemWritableFileStream,
  ) {
    if (this.outputFormat == 'int24') {
      this.outputBuffer24 = new Uint8Array(32 * 1024)
    }
  }

  closed: Promise<void>
  desiredSize: number | null
  ready = Promise.resolve()
  abort(reason?: any): Promise<void> {
    throw new Error('Method not implemented.')
  }
  close(): Promise<void> {
    throw new Error('Method not implemented.')
  }
  releaseLock(): void {
    throw new Error('Method not implemented.')
  }
  async write(chunk: Float32Array): Promise<void> {
    switch (this.outputFormat) {
      case 'float32':
        controller.enqueue(chunk.buffer)
        break
      case 'int24':
        if (this.outputBuffer24!.length < chunk.length * 3) {
          this.outputBuffer24 = new Uint8Array(chunk.length * 3)
        }
        for (let i = 0; i < chunk.length; ++i) {
          const value = chunk[i] > 0 ? chunk[i] * ((1 << 24) - 1) : chunk[i] * (1 << 24)
          this.outputBuffer24![3 * i] = value & 0xff
          this.outputBuffer24![3 * i + 1] = (value >> 8) & 0xff
          this.outputBuffer24![3 * i + 2] = (value >> 16) & 0xff
        }
        controller.enqueue(this.outputBuffer24!.slice(0, 3 * chunk.length).buffer)
        break
      case 'int16':
        const outputBuffer16 = new Int16Array(chunk.buffer)
        for (let i = 0; i < chunk.length; ++i) {
          outputBuffer16[i] = chunk[i] > 0 ? chunk[i] * 65535 : chunk[i] * 65536
        }
        controller.enqueue(outputBuffer16.slice(0, chunk.length).buffer)
        break
      case 'int8':
        const outputBuffer8 = new Uint8Array(chunk.buffer)
        for (let i = 0; i < chunk.length; ++i) {
          outputBuffer8[i] = (chunk[i] > 0 ? chunk[i] * 127 : chunk[i] * 128) + 128
        }
        controller.enqueue(outputBuffer8.slice(0, chunk.length).buffer)
        break
    }
  }
}
