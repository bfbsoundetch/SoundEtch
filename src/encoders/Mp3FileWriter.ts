import { Mp3EncoderInfo } from './EncoderType'
import createModule, { MainModule } from './wasm/mp3/mp3_encoder'

export class Mp3FileWriter {
  static readonly INPUT_BUFFER_SAMPLE_SIZE = 256 * 1024
  private static readonly INPUT_BUFFER_BYTE_SIZE =
    Mp3FileWriter.INPUT_BUFFER_SAMPLE_SIZE * Float32Array.BYTES_PER_ELEMENT

  private readonly inputBuffer
  private readonly outputBufferPointer

  readonly inputSampleFormat = 'planar'

  private constructor(
    private readonly fileWritable: FileSystemWritableFileStream,
    private readonly module: MainModule,
    mp3EncoderInfo: Mp3EncoderInfo,
  ) {
    module._init_lame(
      mp3EncoderInfo.channelCount,
      48000,
      mp3EncoderInfo.sampleRate,
      Mp3FileWriter.INPUT_BUFFER_SAMPLE_SIZE,
      mp3EncoderInfo.bitrate ?? -1,
      mp3EncoderInfo.vbrQuality ?? -1,
    )
    const inputBufferPointer = module._getLeftInputBufferPointer()
    this.inputBuffer = module.HEAPF32.subarray(
      inputBufferPointer / Float32Array.BYTES_PER_ELEMENT,
      inputBufferPointer / Float32Array.BYTES_PER_ELEMENT +
        Mp3FileWriter.INPUT_BUFFER_SAMPLE_SIZE * mp3EncoderInfo.channelCount,
    )
    this.outputBufferPointer = module._getOutputBufferPointer()
  }

  static async create(fileWritable: FileSystemWritableFileStream, mp3EncoderInfo: Mp3EncoderInfo) {
    const module = await createModule()
    return new Mp3FileWriter(fileWritable, module, mp3EncoderInfo)
  }

  getInputBuffer(): Float32Array {
    return this.inputBuffer
  }

  async writeChunk(length: number) {
    const outputSize = this.module._encode_samples(length)
    await this.fileWritable.write(
      this.module.HEAPU8.subarray(this.outputBufferPointer, this.outputBufferPointer + outputSize) as any,
    )
  }

  async finish() {
    const outputSize = this.module._flush_lame()
    await this.fileWritable.write(
      this.module.HEAPU8.subarray(this.outputBufferPointer, this.outputBufferPointer + outputSize) as any,
    )

    const tagSize = this.module._get_lame_tag()
    this.fileWritable.seek(0)
    await this.fileWritable.write(
      this.module.HEAPU8.subarray(this.outputBufferPointer, this.outputBufferPointer + tagSize) as any,
    )

    this.module._close_lame()
    await this.fileWritable.close()
  }
}
