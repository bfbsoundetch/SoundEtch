/// <reference lib="webworker" />

/**
 * Drains the capture worklet's ring into frames. It runs in a dedicated worker because a hidden tab throttles the
 * page's timers to once a second or less, which would overflow the ring while a guest talks from another tab.
 */

import { RingBuffer } from 'ringbuf.js'
import { HQ_CAPTURE_QUANTUM, HQ_CAPTURE_RECORD_LENGTH, HQ_CAPTURE_RING_RECORDS } from './HighQualityAudioFormat'
import { HighQualityFrameAssembler } from './HighQualityFrameAssembler'

const HQ_CAPTURE_POLL_MS = 25

export type HighQualityCaptureReaderCommand = {
  type: 'start'
  ringBufferArray: SharedArrayBuffer
  /** `[started, startFrame, droppedRecords]`, written by the worklet. */
  counters: SharedArrayBuffer
}

export type HighQualityCaptureReaderMessage =
  { type: 'frame'; seq: number; pcm: ArrayBuffer } | { type: 'dropped'; records: number }

const worker = self as unknown as DedicatedWorkerGlobalScope

function post(message: HighQualityCaptureReaderMessage, transfer: Transferable[] = []) {
  worker.postMessage(message, transfer)
}

worker.onmessage = (event: MessageEvent<HighQualityCaptureReaderCommand>) => {
  const { ringBufferArray, counters } = event.data
  const ring = new RingBuffer(ringBufferArray, Int16Array)
  const dropCounter = new Int32Array(counters)
  const assembler = new HighQualityFrameAssembler((seq, pcm) => post({ type: 'frame', seq, pcm }, [pcm]))
  const records = new Int16Array(HQ_CAPTURE_RING_RECORDS * HQ_CAPTURE_RECORD_LENGTH)
  let dropped = 0
  setInterval(() => {
    const count = Math.floor(ring.availableRead() / HQ_CAPTURE_RECORD_LENGTH)
    ring.pop(records, count * HQ_CAPTURE_RECORD_LENGTH)
    for (let record = 0; record < count; ++record) {
      const offset = record * HQ_CAPTURE_RECORD_LENGTH
      // The words are stored as int16, so mask off the sign before joining them.
      const index = (records[offset] & 0xffff) + (records[offset + 1] & 0xffff) * 0x10000
      assembler.addQuantum(index, records.subarray(offset + 2, offset + 2 + HQ_CAPTURE_QUANTUM))
    }
    const total = Atomics.load(dropCounter, 2)
    if (total > dropped) {
      post({ type: 'dropped', records: total - dropped })
      dropped = total
    }
  }, HQ_CAPTURE_POLL_MS)
}
