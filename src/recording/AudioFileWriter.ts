import { FileSystemSyncAccessHandle } from 'filesystem/FileSystemSyncAccessHandle'
import { RingBuffer } from 'ringbuf.js'
import { Summary } from '../project/Summary'
import { Logger } from '../global/Logger'
import { LiveRecordingFiles } from './LiveRecordingFiles'

/** Identifies the clip's file to the high-quality patch service while this writer holds it. */
export interface LiveFileOptions {
  readonly key: string
  readonly summaryHandle: FileSystemSyncAccessHandle
}

export class AudioFileWriter {
  private readonly ringBuffer: RingBuffer
  private readonly writeBuffer: Float32Array
  private readonly overrunSampleCount: Int32Array
  private readonly logger = new Logger('AudioFileWriter')

  private position = 0
  private stopped: boolean = false
  private aborted = false
  private failed = false
  private failure: unknown
  private onError?: (error: unknown) => void
  private pausePromise: Promise<void> | null = null
  private resumeResolver: (() => void) | null = null

  constructor(
    private readonly fileSyncHandle: FileSystemSyncAccessHandle,
    private readonly summary: Summary,
    ringBufferArray: SharedArrayBuffer,
    overrunSampleCount: SharedArrayBuffer,
    private readonly channelCount: number,
    private readonly live: LiveFileOptions | null = null,
  ) {
    this.ringBuffer = new RingBuffer(ringBufferArray, Float32Array)
    const sampleCapacity = 8192 - (8192 % channelCount)
    this.writeBuffer = new Float32Array(sampleCapacity)
    this.overrunSampleCount = new Int32Array(overrunSampleCount)
    if (live) {
      LiveRecordingFiles.register(live.key, {
        handle: fileSyncHandle,
        summaryHandle: live.summaryHandle,
        summary,
        writtenFrames: () => this.writtenFrames(),
      })
    }
  }

  /** Complete frames in the file and in the summary. */
  writtenFrames(): number {
    return this.position / (Float32Array.BYTES_PER_ELEMENT * this.channelCount)
  }

  stop(discardPending = false) {
    this.stopped = true
    this.aborted ||= discardPending
    this.resume()
  }

  pause() {
    const { promise, resolve } = Promise.withResolvers<void>()
    this.pausePromise = promise
    this.resumeResolver = resolve
  }

  resume() {
    this.resumeResolver?.()
    this.pausePromise = null
    this.resumeResolver = null
  }

  async runFileWritingLoop(onError?: (error: unknown) => void): Promise<void> {
    this.onError = onError
    try {
      while (await this.maybeGetChunkAndWrite()) {
        const { promise, resolve } = Promise.withResolvers<void>()
        setTimeout(resolve, 10)
        await promise
      }
    } catch (error) {
      this.recordFailure(error)
    } finally {
      // Before any handle closes, so the patch service never borrows a closed handle.
      if (this.live) LiveRecordingFiles.unregister(this.live.key)
      try {
        this.fileSyncHandle.close()
      } catch (error) {
        this.recordFailure(error)
      }
      try {
        this.summary.finishSummarizing()
      } catch (error) {
        this.recordFailure(error)
      }
      this.logger.log('Closed file handles. Completing the job.')
    }
    if (this.failed) throw this.failure
  }

  async maybeGetChunkAndWrite(): Promise<boolean> {
    if (this.aborted) return false
    const overrunSamples = Atomics.exchange(this.overrunSampleCount, 0, 0)
    if (overrunSamples > 0) {
      const silence = new Float32Array(overrunSamples)
      this.writeSamples(silence, overrunSamples)
    }
    const availableSamples = Math.min(this.writeBuffer.length, this.ringBuffer.availableRead())
    const poppedLength = this.ringBuffer.pop(
      this.writeBuffer,
      availableSamples - (availableSamples % this.channelCount),
    )
    if (poppedLength > 0) {
      if (this.position % 48000 < 128) {
        this.logger.log('Writer heartbeat at frame ' + this.position / Float32Array.BYTES_PER_ELEMENT)
      }
      this.writeSamples(this.writeBuffer, poppedLength)

      return true
    } else if (this.stopped) {
      this.logger.log(`Wrote a file of size ${this.fileSyncHandle.getSize()}`)
      return false
    } else if (this.pausePromise) {
      await this.pausePromise
    } else {
      this.logger.debug('Underrun detected while recording.')
    }
    return true
  }

  private recordFailure(error: unknown) {
    if (this.failed) return
    this.failed = true
    this.failure = error
    this.logger.errorMessage('error ' + error)
    this.onError?.(error)
  }

  private writeSamples(data: Float32Array, length: number) {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, length * Float32Array.BYTES_PER_ELEMENT)
    let written = 0
    try {
      while (written < bytes.byteLength) {
        const byteCount = this.fileSyncHandle.write(bytes.subarray(written), { at: this.position + written })
        if (byteCount <= 0) throw new Error('Audio file write made no progress')
        written += byteCount
      }
    } catch (error) {
      this.recordFailure(error)
    }

    const frameBytes = this.channelCount * Float32Array.BYTES_PER_ELEMENT
    const completeBytes = written - (written % frameBytes)
    this.position += completeBytes
    if (completeBytes !== written) {
      try {
        this.fileSyncHandle.truncate(this.position)
      } catch (error) {
        this.recordFailure(error)
      }
    }
    try {
      this.fileSyncHandle.flush()
    } catch (error) {
      this.recordFailure(error)
    }
    if (completeBytes > 0) {
      try {
        this.summary.summarizeInterleavedData(data, completeBytes / Float32Array.BYTES_PER_ELEMENT)
      } catch (error) {
        this.recordFailure(error)
      }
    }
    if (this.failed) throw this.failure
  }
}
