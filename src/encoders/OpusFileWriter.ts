import { FileSystemSyncAccessHandle } from '../filesystem/FileSystemSyncAccessHandle'
import { OpusEncoderInfo } from './EncoderType'
import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import createModule, { MainModule } from './wasm/opus/opus_encoder'

// Constants defined in
// https://github.com/xiph/opus/blob/b5dc74f26ff9a9ef1f1af9a473b9ae07520eed7d/include/opus_defines.h

export class OpusFileWriter {
  private readonly inputBufferSize = 256 * 1024
  private readonly inputBuffer: Float32Array

  static async create(fileWritable: FileSystemWritableFileStream, flacEncoderInfo: OpusEncoderInfo) {
    const privateTmpFile = await ((await FileSystemUtils.getFileHandle('tmp', 'exportTmp.opus')) as any)
    const module = await createModule()
    return new OpusFileWriter(
      fileWritable,
      flacEncoderInfo,
      module,
      privateTmpFile,
      await privateTmpFile.createSyncAccessHandle(),
    )
  }

  constructor(
    private readonly fileWritable: FileSystemWritableFileStream,
    opusEncoderInfo: OpusEncoderInfo,
    private readonly module: MainModule,
    private readonly privateTmpFile: FileSystemFileHandle,
    private readonly privateTmpFileSync: FileSystemSyncAccessHandle,
  ) {
    privateTmpFileSync.truncate(0)
    let fileWritePosition = 0
    ;(globalThis as any).opusEncoderWriteCallback = function (
      userDataPointer: number,
      bufferPointer: number,
      length: number,
    ) {
      const bytes = module.HEAPU8.slice(bufferPointer, bufferPointer + length)
      const written = privateTmpFileSync.write(bytes, { at: fileWritePosition })
      fileWritePosition += written

      return written === length ? 0 : 1
    }
    ;(globalThis as any).opusEncoderCloseCallback = function () {
      return 0
    }

    const entries = Object.entries(opusEncoderInfo.tags ?? {}).filter(([, value]) => value !== '')
    const metadata = entries.length
      ? new TextEncoder().encode(entries.map(([key, value]) => `${key}=${value}\0`).join('') + '\0')
      : undefined
    const metadataPointer = metadata ? module._malloc(metadata.length) : 0
    if (metadata && !metadataPointer) {
      throw new Error('Unable to allocate Opus metadata')
    }
    try {
      if (metadata) module.HEAPU8.set(metadata, metadataPointer)
      const result = module._create_encoder(
        opusEncoderInfo.sampleRate,
        opusEncoderInfo.channelCount,
        opusEncoderInfo.bitrate,
        opusEncoderInfo.bitrateMode,
        opusEncoderInfo.complexity,
        opusEncoderInfo.bandwidth,
        opusEncoderInfo.application,
        metadataPointer,
      )
      if (result !== 0) throw new Error('Unable to initialize Opus encoder: ' + result)
    } finally {
      if (metadataPointer) module._free(metadataPointer)
    }

    const inputBufferPointer = module._get_input_buffer_pointer(opusEncoderInfo.channelCount, this.inputBufferSize)
    const start = inputBufferPointer / Float32Array.BYTES_PER_ELEMENT
    this.inputBuffer = module.HEAPF32.subarray(start, start + opusEncoderInfo.channelCount * this.inputBufferSize)
  }

  readonly inputSampleFormat = 'interleaved'

  getInputBuffer() {
    return this.inputBuffer
  }

  async writeChunk(length: number) {
    const result = this.module._encode_frame(length)
    if (result !== 0) throw new Error('Opus library returned error: ' + result)
  }

  async finish() {
    const result = this.module._finalize_encoding()
    if (result !== 0) throw new Error('Unable to finish Opus encoding: ' + result)
    this.privateTmpFileSync.flush()
    this.privateTmpFileSync.close()
    await (await this.privateTmpFile.getFile()).stream().pipeTo(this.fileWritable)
    await FileSystemUtils.deleteFile('tmp', 'exportTmp.opus')
  }
}
