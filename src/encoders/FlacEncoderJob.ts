import { ControllableWorkerJob } from '../audiocontext/ControllableWorkerJob'
import { FileSystemUtils } from '../filesystem/FileSystemUtils'
// @ts-ignore
// @vite-ignore
import createModule from './wasm/flac_encoder.mjs'

export class FlacEncoderJob implements ControllableWorkerJob {
  private readonly bitsPerSample: number
  private readonly sampleRate: number
  private readonly compressionLevel: number
  private readonly metadata: string // TODO: implement
  private readonly dirName: string
  private readonly fileName: string
  private readonly channelCount: number
  private Module: any = null
  private inputBufferPointer: number = 0

  constructor(argument: any) {
    this.bitsPerSample = argument.data.bitsPerSample
    this.sampleRate = argument.data.sampleRate(globalThis as any).channelCount = argument.data.channelCount
    this.compressionLevel = argument.data.compressionLevel
    this.metadata = argument.data.metadata
    this.dirName = argument.data.dirName
    this.fileName = argument.data.fileName
    this.channelCount = argument.data.channelCount
  }

  async start(): Promise<any> {
    this.Module = createModule()
    const inputBufferLength = 1 << 16
    this.inputBufferPointer = this.Module._malloc(inputBufferLength * Int32Array.BYTES_PER_ELEMENT)(
      globalThis as any,
    ).outputFile = await (
      (await FileSystemUtils.getFileHandle(this.fileName, this.dirName)) as any
    ).createSyncAccessHandle()
    this.Module._create_encoder(this.bitsPerSample, this.sampleRate, this.channelCount, this.compressionLevel)
    const inputBuffer = new Int32Array(
      this.Module.HEAP8.subarray(this.inputBufferPointer, this.inputBufferPointer + inputBufferLength),
    )
    if (!(this.Module.HEAP8.buffer instanceof SharedArrayBuffer)) {
      throw new Error("WASM memory isn't shared. Do you need pthreads=1?")
    }
    postMessage({
      inputBuffer: this.Module.HEAP8.buffer,
      pointer: this.inputBufferPointer,
      length: inputBufferLength,
    })
  }

  onReceiveChunk(length: number) {
    this.Module._encode_chunk(this.inputBufferPointer, Math.floor(length / this.channelCount))
    postMessage({ samplesWritten: (globalThis as any).samplesWritten })
  }

  async onInputFinished() {
    await this.Module._finish_encoding()(globalThis as any).outputFile.close()
    postMessage({ finished: true })
  }

  pause(): void {
    throw new Error('Method not implemented.')
  }

  resume(): void {
    throw new Error('Method not implemented.')
  }
  stop(): void {
    throw new Error('Method not implemented.')
  }
}
