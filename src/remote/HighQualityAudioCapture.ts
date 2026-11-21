import { RingBuffer } from 'ringbuf.js'
import { Logger } from '../global/Logger'
import { HQ_CAPTURE_RECORD_LENGTH, HQ_CAPTURE_RING_RECORDS, HQ_SAMPLE_RATE } from './HighQualityAudioFormat'
import type { HighQualityCaptureReaderCommand, HighQualityCaptureReaderMessage } from './HighQualityCaptureReader'

export interface FrameCapture {
  start(track: MediaStreamTrack): Promise<boolean>
  stop(): void
  /** Samples since the first captured one, on the capture context's clock; null before the first or when stopped. */
  elapsedSamples(): number | null
}

const logger = new Logger('HighQualityAudioCapture')

/**
 * Captures a track as 48 kHz 16-bit frames. It uses its own context rather than `AudioControl`'s, because that one is
 * replaced on every play, record or monitor change.
 */
export class HighQualityAudioCapture implements FrameCapture {
  private generation = 0
  private audioContext: AudioContext | null = null
  private worker: Worker | null = null
  private counters: Int32Array<SharedArrayBuffer> | null = null

  constructor(private readonly onFrame: (seq: number, pcm: ArrayBuffer) => void) {}

  async start(track: MediaStreamTrack): Promise<boolean> {
    this.stop()
    const generation = ++this.generation
    try {
      const ringBufferArray = RingBuffer.getStorageForCapacity(
        HQ_CAPTURE_RING_RECORDS * HQ_CAPTURE_RECORD_LENGTH,
        Int16Array,
      )
      const counters = new SharedArrayBuffer(3 * Int32Array.BYTES_PER_ELEMENT)
      this.counters = new Int32Array(counters)
      const ctx = new AudioContext({ sampleRate: HQ_SAMPLE_RATE })
      this.audioContext = ctx
      await ctx.audioWorklet.addModule('./assets/hqCaptureWorklet.js')
      if (generation !== this.generation) return false
      const source = ctx.createMediaStreamSource(new MediaStream([track]))
      const node = new AudioWorkletNode(ctx, 'HighQualityCaptureProcessor', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
        channelCountMode: 'explicit',
        processorOptions: { ringBufferArray, counters },
      })
      const worker = new Worker(new URL('./HighQualityCaptureReader.ts', import.meta.url), { type: 'module' })
      this.worker = worker
      worker.onmessage = (event: MessageEvent<HighQualityCaptureReaderMessage>) => {
        if (generation !== this.generation) return
        const message = event.data
        if (message.type === 'frame') this.onFrame(message.seq, message.pcm)
        else logger.errorMessage(`The capture ring overflowed; dropped ${message.records} records`)
      }
      const command: HighQualityCaptureReaderCommand = { type: 'start', ringBufferArray, counters }
      worker.postMessage(command)
      source.connect(node)
      await ctx.resume()
      return generation === this.generation && ctx.state === 'running'
    } catch (e) {
      // Firefox, for one, rejects a media stream source whose sample rate differs from the context's.
      logger.errorMessage(`Could not start high-quality capture: ${e instanceof Error ? e.message : e}`)
      if (generation === this.generation) this.stop()
      return false
    }
  }

  stop(): void {
    ++this.generation
    // Records still in the ring are lost; this ends a session, which is a recorder pause or stop.
    this.worker?.terminate()
    this.audioContext?.close().catch((e) => logger.error(e))
    this.worker = null
    this.audioContext = null
    this.counters = null
  }

  elapsedSamples(): number | null {
    const ctx = this.audioContext
    const counters = this.counters
    if (!ctx || !counters || Atomics.load(counters, 0) !== 1) return null
    return Math.round(ctx.currentTime * HQ_SAMPLE_RATE) - Atomics.load(counters, 1)
  }
}
