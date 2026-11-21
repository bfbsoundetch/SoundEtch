import { RingBuffer } from 'ringbuf.js'
import { beforeAll, expect, test } from 'vitest'
import { HQ_CAPTURE_QUANTUM, HQ_CAPTURE_RECORD_LENGTH } from './HighQualityAudioFormat'

let Processor

beforeAll(async () => {
  // These globals exist only in the audio rendering thread; the processor module registers itself on load.
  globalThis.AudioWorkletProcessor = class {
    get port() {
      throw new Error('The capture worklet must not use its port')
    }
  }
  globalThis.registerProcessor = (_, processor) => (Processor = processor)
  await import('./HighQualityCaptureProcessor.js')
})

function createProcessor(records) {
  const ringBufferArray = RingBuffer.getStorageForCapacity(records * HQ_CAPTURE_RECORD_LENGTH, Int16Array)
  const counters = new SharedArrayBuffer(3 * Int32Array.BYTES_PER_ELEMENT)
  const processor = new Processor({ processorOptions: { ringBufferArray, counters } })
  return { processor, ring: new RingBuffer(ringBufferArray, Int16Array), counters: new Int32Array(counters) }
}

/** Runs one render quantum at `frame`, as the audio thread would. */
function render(processor, frame, samples) {
  globalThis.currentFrame = frame
  expect(processor.process([[samples]], [], {})).toBe(true)
}

function popRecord(ring) {
  const record = new Int16Array(HQ_CAPTURE_RECORD_LENGTH)
  expect(ring.pop(record)).toBe(HQ_CAPTURE_RECORD_LENGTH)
  return { index: (record[0] & 0xffff) + (record[1] & 0xffff) * 0x10000, samples: record.subarray(2) }
}

test('records carry increasing quantum indexes and clamped int16 samples', () => {
  const { processor, ring, counters } = createProcessor(4)
  const input = new Float32Array(HQ_CAPTURE_QUANTUM)
  input.set([0, 1, -1, 2, -2, 0.5, -0.5])
  const startFrame = 3_000_000 * HQ_CAPTURE_QUANTUM
  render(processor, startFrame, input)
  expect(Array.from(counters)).toEqual([1, startFrame, 0])
  render(processor, startFrame + HQ_CAPTURE_QUANTUM, input)
  // An index past 16 bits checks the high word.
  render(processor, startFrame + 70_000 * HQ_CAPTURE_QUANTUM, new Float32Array(0))

  const first = popRecord(ring)
  expect(first.index).toBe(0)
  expect(Array.from(first.samples.subarray(0, 8))).toEqual([0, 32767, -32768, 32767, -32768, 16384, -16384, 0])
  expect(popRecord(ring).index).toBe(1)
  const silent = popRecord(ring)
  expect(silent.index).toBe(70_000)
  expect(silent.samples.every((sample) => sample === 0)).toBe(true)
})

test('a full ring drops whole records, counts them, and the next record that fits carries its later index', () => {
  const { processor, ring, counters } = createProcessor(2)
  const input = new Float32Array(HQ_CAPTURE_QUANTUM)
  for (let index = 0; index < 4; ++index) render(processor, index * HQ_CAPTURE_QUANTUM, input)
  expect(Atomics.load(counters, 2)).toBe(2)
  expect(ring.availableRead()).toBe(2 * HQ_CAPTURE_RECORD_LENGTH)
  expect(popRecord(ring).index).toBe(0)
  expect(popRecord(ring).index).toBe(1)

  render(processor, 4 * HQ_CAPTURE_QUANTUM, input)
  expect(popRecord(ring).index).toBe(4)
  expect(Atomics.load(counters, 2)).toBe(2)
})
