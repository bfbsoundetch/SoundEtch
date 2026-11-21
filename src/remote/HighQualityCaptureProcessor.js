import { RingBuffer } from 'ringbuf.js'
import { HQ_CAPTURE_QUANTUM, HQ_CAPTURE_RECORD_LENGTH } from './HighQualityAudioFormat'

/**
 * Writes the meeting member's processed mic, one render quantum per record, into a shared ring that
 * `HighQualityCaptureReader` drains. It never touches `this.port`: posting from the audio thread allocates and can
 * glitch, and a ring survives the page's throttled timers in a hidden tab.
 */
class HighQualityCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options)
    this.ring = new RingBuffer(options.processorOptions.ringBufferArray, Int16Array)
    /** `[started, startFrame, droppedRecords]`. */
    this.counters = new Int32Array(options.processorOptions.counters)
    this.record = new Int16Array(HQ_CAPTURE_RECORD_LENGTH)
    this.startFrame = -1
  }

  process(inputs) {
    if (this.startFrame < 0) {
      this.startFrame = currentFrame
      // Published before anything is pushed, so the reader knows the start whenever it sees data.
      Atomics.store(this.counters, 1, this.startFrame)
      Atomics.store(this.counters, 0, 1)
    }
    const index = (currentFrame - this.startFrame) / HQ_CAPTURE_QUANTUM
    const record = this.record
    record[0] = index & 0xffff
    record[1] = index >>> 16
    const samples = inputs[0]?.[0]
    for (let i = 0; i < HQ_CAPTURE_QUANTUM; ++i) {
      const value = samples?.[i] ?? 0
      const x = value > 1 ? 1 : value < -1 ? -1 : value
      record[i + 2] = Math.round(x < 0 ? x * 32768 : x * 32767)
    }
    // A record is never split, so the ring always holds whole records and the reader can trust its alignment.
    if (this.ring.availableWrite() >= HQ_CAPTURE_RECORD_LENGTH) {
      this.ring.push(record)
    } else {
      Atomics.add(this.counters, 2, 1)
    }
    return true
  }
}

registerProcessor('HighQualityCaptureProcessor', HighQualityCaptureProcessor)
