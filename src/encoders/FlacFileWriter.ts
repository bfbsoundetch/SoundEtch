import { FileSystemSyncAccessHandle } from 'filesystem/FileSystemSyncAccessHandle'
import { FlacEncoderInfo } from './EncoderType'
import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import createModule, { MainModule } from './wasm/flac/flac_encoder'

export class FlacFileWriter {
  private readonly inputBufferSize = 256 * 1024
  private readonly inputBuffer: Float32Array

  static async create(fileWritable: FileSystemWritableFileStream, flacEncoderInfo: FlacEncoderInfo) {
    const tmpFileName = `${Date.now()}.flac`
    const privateTmpFile = await ((await FileSystemUtils.getFileHandle('tmp', tmpFileName)) as any)
    const module = await createModule()
    return new FlacFileWriter(
      fileWritable,
      flacEncoderInfo,
      module,
      privateTmpFile,
      await privateTmpFile.createSyncAccessHandle(),
    )
  }

  constructor(
    private readonly fileWritable: FileSystemWritableFileStream,
    private readonly flacEncoderInfo: FlacEncoderInfo,
    private readonly module: MainModule,
    private readonly privateTmpFile: FileSystemFileHandle,
    private readonly privateTmpFileSync: FileSystemSyncAccessHandle,
  ) {
    let fileWritePosition = 0
    ;(globalThis as any).flacEncoderWriteCallback = function (bufferPointer: number, length: BigInt, samples: number) {
      privateTmpFileSync.write(module.HEAPU8.slice(bufferPointer, bufferPointer + Number(length)), {
        at: fileWritePosition,
      })
      fileWritePosition += Number(length)

      return 0 // FLAC__STREAM_ENCODER_WRITE_STATUS_OK
    }
    ;(globalThis as any).flacEncoderSeekCallback = function (newPosition: number) {
      fileWritePosition = Number(newPosition)
      return 0 // FLAC__STREAM_ENCODER_SEEK_STATUS_OK
    }
    ;(globalThis as any).flacEncoderTellCallback = function (valuePointer: number) {
      module.HEAPU32[valuePointer / Uint32Array.BYTES_PER_ELEMENT] = fileWritePosition
      return 0 // FLAC__STREAM_ENCODER_TELL_STATUS_OK
    }
    const entries = Object.entries(flacEncoderInfo.tags ?? {}).filter(([, value]) => value !== '')
    const metadata = entries.length
      ? new TextEncoder().encode(entries.map(([key, value]) => `${key}=${value}\0`).join('') + '\0')
      : undefined
    const metadataPointer = metadata ? module._malloc(metadata.length) : 0
    if (metadata && !metadataPointer) {
      throw new Error('Unable to allocate FLAC metadata')
    }
    try {
      if (metadata) module.HEAPU8.set(metadata, metadataPointer)
      const result = module._create_encoder(
        flacEncoderInfo.bitDepth,
        flacEncoderInfo.sampleRate,
        flacEncoderInfo.channelCount,
        flacEncoderInfo.compressionLevel,
        metadataPointer,
      )
      if (result !== 0) throw new Error('Unable to initialize FLAC encoder: ' + result)
    } finally {
      if (metadataPointer) module._free(metadataPointer)
    }
    // Allocate the PCM view after native initialization and temporary metadata allocations.
    const inputBufferPointer = module._get_input_buffer_pointer(flacEncoderInfo.channelCount, this.inputBufferSize)
    const start = inputBufferPointer / Float32Array.BYTES_PER_ELEMENT
    this.inputBuffer = module.HEAPF32.subarray(start, start + flacEncoderInfo.channelCount * this.inputBufferSize)
  }

  readonly inputSampleFormat = 'planar'

  getInputBuffer() {
    return this.inputBuffer
  }

  async writeChunk(length: number) {
    const result = this.module._encode_chunk(length)
    if (result != 0) {
      throw new Error('FLAC library returned error: ' + result)
    }
  }

  async finish() {
    if (!this.module._finish_encoding()) {
      throw new Error('Unable to finish FLAC encoding')
    }
    this.privateTmpFileSync.flush()
    this.privateTmpFileSync.close()
    await (await this.privateTmpFile.getFile()).stream().pipeTo(this.fileWritable)
    await FileSystemUtils.deleteFile('tmp', this.privateTmpFile.name.split('/')[1])
  }

  checkStatus() {
    if (this.module._get_encoder_state() > 1) {
      throw new Error('FLAC encoder is in a bad state: ' + this.module._get_encoder_state())
    }
  }
}
