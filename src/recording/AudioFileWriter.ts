import { FileSystemSyncAccessHandle } from 'filesystem/FileSystemSyncAccessHandle'
import { RingBuffer } from 'ringbuf.js'
import { Summary } from '../project/Summary'
import { Logger } from '../global/Logger'

export class AudioFileWriter {
  private readonly ringBuffer: RingBuffer
  private readonly writeBuffer: Float32Array
  private readonly overrunSampleCount: Int32Array
  private readonly logger = new Logger('AudioFileWriter')

  private position = 0
  private stopped: boolean = false
  private pausePromise: Promise<any> | null = null
  private resumeResolver: ((_: any) => any) | null = null

  constructor(
    private readonly fileSyncHandle: FileSystemSyncAccessHandle,
    private readonly summary: Summary,
    ringBufferArray: SharedArrayBuffer,
    overrunSampleCount: SharedArrayBuffer,
  ) {
    this.ringBuffer = new RingBuffer(ringBufferArray, Float32Array)
    this.writeBuffer = new Float32Array(new ArrayBuffer(32 * 1024))
    this.overrunSampleCount = new Int32Array(overrunSampleCount)
  }

  stop() {
    this.stopped = true
  }

  pause() {
    this.pausePromise = new Promise((resolve, reject) => (this.resumeResolver = resolve))
  }

  resume() {
    this.resumeResolver?.('')
    this.pausePromise = null
    this.resumeResolver = null
  }

  async runFileWritingLoop(): Promise<any> {
    try {
      while (await this.maybeGetChunkAndWrite()) {
        await new Promise((resolver) => setTimeout(resolver, 10))
      }
    } catch (e: any) {
      this.logger.errorMessage('error ' + e)
      postMessage({ error: e })
    } finally {
      this.fileSyncHandle.close()
      this.summary.finishSummarizing()
      this.logger.log('Closed file handle. Completing the job.')
    }
  }

  async maybeGetChunkAndWrite(): Promise<boolean> {
    const overrunSamples = Atomics.exchange(this.overrunSampleCount, 0, 0)
    if (overrunSamples > 0) {
      const silence = new Float32Array(overrunSamples)
      this.fileSyncHandle.write(silence, { at: this.position })
      this.summary.summarizeInterleavedData(silence, overrunSamples)
      this.position += overrunSamples * Float32Array.BYTES_PER_ELEMENT
      this.fileSyncHandle.flush()
    }
    const poppedLength = this.ringBuffer.pop(this.writeBuffer)
    if (poppedLength > 0) {
      if (this.position % 48000 < 128) {
        this.logger.log('Writer heartbeat at frame ' + this.position / Float32Array.BYTES_PER_ELEMENT)
      }
      this.fileSyncHandle.write(
        (this.writeBuffer.buffer as ArrayBuffer).slice(0, poppedLength * Float32Array.BYTES_PER_ELEMENT),
        { at: this.position },
      )

      this.summary.summarizeInterleavedData(this.writeBuffer, poppedLength)
      this.position += poppedLength * Float32Array.BYTES_PER_ELEMENT
      this.fileSyncHandle.flush()

      return true
    } else if (this.stopped) {
      this.logger.log(`Wrote a file of size ${this.fileSyncHandle.getSize()}`)
      return false
    } else if (this.pausePromise) {
      await this.pausePromise
    } else {
      this.logger.log('Underrun detected while recording.')
    }
    return true
  }
}
