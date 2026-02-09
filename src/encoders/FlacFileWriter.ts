import { FileSystemSyncAccessHandle } from 'filesystem/FileSystemSyncAccessHandle'
import { FlacEncoderInfo } from './EncoderType'
import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import createModule, { MainModule } from './wasm/flac/flac_encoder'

export class FlacFileWriter {
  private readonly inputBufferSize = 32 * 1024
  private readonly inputBuffer: Float32Array
  private readonly int32BufferView: Int32Array

  static async create(fileWritable: FileSystemWritableFileStream, flacEncoderInfo: FlacEncoderInfo) {
    const privateTmpFile = await ((await FileSystemUtils.getFileHandle('.', 'exportTmp.flac')) as any)
    const module = await createModule()
    return new FlacFileWriter(
      fileWritable,
      flacEncoderInfo,
      module,
      privateTmpFile,
      privateTmpFile.createSyncAccessHandle(),
    )
  }

  constructor(
    private readonly fileWritable: FileSystemWritableFileStream,
    private readonly flacEncoderInfo: FlacEncoderInfo,
    private readonly module: MainModule,
    private readonly privateTmpFile: FileSystemFileHandle,
    private readonly privateTmpFileSync: FileSystemSyncAccessHandle,
  ) {
    const inputBufferPointer = module._get_input_buffer_pointer(flacEncoderInfo.channelCount, this.inputBufferSize)
    const start = inputBufferPointer / Float32Array.BYTES_PER_ELEMENT
    this.inputBuffer = module.HEAPF32.subarray(start, start + flacEncoderInfo.channelCount * this.inputBufferSize)
    this.int32BufferView = module.HEAP32.subarray(start, start + flacEncoderInfo.channelCount * this.inputBufferSize)
    let fileWritePosition = 0
    ;(globalThis as any).flacEncoderWriteCallback = function (bufferPointer: number, length: number, samples: number) {
      privateTmpFileSync.write(module.HEAP8.slice(bufferPointer, bufferPointer + length))
      fileWritePosition += length

      return 0 // FLAC__STREAM_ENCODER_WRITE_STATUS_OK
    }
    ;(globalThis as any).flacEncoderSeekCallback = function (newPosition: number) {
      fileWritePosition = newPosition
      return 0 // FLAC__STREAM_ENCODER_SEEK_STATUS_OK
    }
    ;(globalThis as any).flacEncoderTellCallback = function (valuePointer: number) {
      module.HEAPU32[valuePointer / Uint32Array.BYTES_PER_ELEMENT] = fileWritePosition
      return 0 // FLAC__STREAM_ENCODER_TELL_STATUS_OK
    }
    module._create_encoder(
      flacEncoderInfo.bitDepth,
      flacEncoderInfo.sampleRate,
      flacEncoderInfo.channelCount,
      flacEncoderInfo.compressionLevel,
      0,
    )
  }

  readonly inputSampleFormat = 'planar'

  getInputBuffer() {
    return this.inputBuffer
  }

  async writeChunk(length: number) {
    for (let i = 0; i < this.inputBuffer.length; ++i) {
      this.int32BufferView[i] = this.inputBuffer[i] * ((1 << (this.flacEncoderInfo.bitDepth - 1)) - 1)
    }
    this.module._encode_chunk(length)
  }

  async finish() {
    this.module._finish_encoding()
    this.privateTmpFileSync.close()
    await (await this.privateTmpFile.getFile()).stream().pipeTo(this.fileWritable)
  }
}
