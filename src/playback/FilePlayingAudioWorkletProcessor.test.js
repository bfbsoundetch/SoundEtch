import {} from '../tests/StubAudio.js'
import { expect, test } from 'vitest'
import { FilePlayingAudioWorkletProcessor } from './FilePlayingAudioWorkletProcessor.js'
import { RingBuffer } from 'ringbuf.js'

function createTestData(...data) {
  const result = new Float32Array(data.length)
  for (let i = 0; i < data.length; ++i) {
    result[i] = data[i]
  }
  return result
}

test('underrun then filled', async () => {
  FilePlayingAudioWorkletProcessor.RENDER_QUANTUM = 128
  const ringBufferArray = RingBuffer.getStorageForCapacity(1024, Float32Array)
  const ringBuffer = new RingBuffer(ringBufferArray, Float32Array)
  const input = [1, -1, 1, -1, 1, -1]
  ringBuffer.push(createTestData(...input))
  const underrunBits = new BigUint64Array(1)
  const processor = new FilePlayingAudioWorkletProcessor({
    processorOptions: {
      ringBufferArray: ringBufferArray,
      length: 5000,
      underrunBits: underrunBits,
      index: 0,
    },
  })

  const outputArray = new Array(128).fill(0)
  processor.process(null, [[outputArray]])

  expect(outputArray.slice(0, input.length)).toEqual(input)
  expect(underrunBits[0]).toEqual(1n)

  outputArray.fill(0)
  ringBuffer.push(createTestData(-1, 1))

  processor.process(null, [[outputArray]])

  expect(outputArray.slice(0, input.length + 2)).toEqual([0, 0, 0, 0, 0, 0, -1, 1])
  expect(underrunBits[0]).toEqual(1n)
})

test('another track underrun, this track does not pull data', async () => {
  FilePlayingAudioWorkletProcessor.RENDER_QUANTUM = 128
  const ringBufferArray = RingBuffer.getStorageForCapacity(1024, Float32Array)
  const ringBuffer = new RingBuffer(ringBufferArray, Float32Array)
  ringBuffer.push(createTestData(1))
  const underrunBits = new BigUint64Array(1)
  underrunBits[0] = 2n
  const processor = new FilePlayingAudioWorkletProcessor({
    processorOptions: {
      ringBufferArray: ringBufferArray,
      length: 5000,
      underrunBits: underrunBits,
      index: 0,
    },
  })

  const outputArray = new Array(128)
  processor.process(null, [[outputArray]])

  expect(outputArray[0]).toBeUndefined()
})

test('two tracks underrun, then one gets filled', async () => {
  FilePlayingAudioWorkletProcessor.RENDER_QUANTUM = 128
  const ringBufferArray = RingBuffer.getStorageForCapacity(1024, Float32Array)
  const ringBuffer = new RingBuffer(ringBufferArray, Float32Array)
  ringBuffer.push(createTestData(1))
  const underrunBits = new BigUint64Array(1)
  underrunBits[0] = 3n
  const processor = new FilePlayingAudioWorkletProcessor({
    processorOptions: {
      ringBufferArray: ringBufferArray,
      length: 5000,
      underrunBits: underrunBits,
      index: 0,
    },
  })

  const outputArray = new Array(128)
  processor.process(null, [[outputArray]])

  expect(outputArray[0]).toBeUndefined()

  underrunBits[0] = 1n // now only our track is set
  ringBuffer.push(createTestData(1))

  processor.process(null, [[outputArray]])

  expect(outputArray[0]).toBeDefined()
})

test('no underrun', async () => {
  FilePlayingAudioWorkletProcessor.RENDER_QUANTUM = 4
  const ringBufferArray = RingBuffer.getStorageForCapacity(1024, Float32Array)
  const ringBuffer = new RingBuffer(ringBufferArray, Float32Array)
  const input = [1, -1, 1, -1, -1, -1, 1, -1]
  ringBuffer.push(createTestData(...input))
  const underrunBits = new BigUint64Array(1)
  const processor = new FilePlayingAudioWorkletProcessor({
    processorOptions: {
      ringBufferArray: ringBufferArray,
      length: 5000,
      underrunBits: underrunBits,
      index: 0,
    },
  })

  const outputArray = new Array(4)
  processor.process(null, [[outputArray]])

  expect(outputArray).toEqual(input.slice(0, 4))
  expect(underrunBits[0]).toEqual(0n)

  processor.process(null, [[outputArray]])

  expect(outputArray).toEqual(input.slice(4))
  expect(underrunBits[0]).toEqual(0n)
})

test('silence', async () => {
  FilePlayingAudioWorkletProcessor.RENDER_QUANTUM = 4
  const ringBufferArray = RingBuffer.getStorageForCapacity(1024, Float32Array)
  const ringBuffer = new RingBuffer(ringBufferArray, Float32Array)
  ringBuffer.push(createTestData(1, NaN, 6, -1))
  const underrunBits = new BigUint64Array(1)
  const processor = new FilePlayingAudioWorkletProcessor({
    processorOptions: {
      ringBufferArray: ringBufferArray,
      length: 5000,
      underrunBits: underrunBits,
      index: 0,
    },
  })

  const outputArray = new Array(4).fill(0)
  processor.process(null, [[outputArray]])

  expect(outputArray).toEqual([1, 0, 0, 0])
  expect(underrunBits[0]).toEqual(0n)

  outputArray.fill(0)
  processor.process(null, [[outputArray]])

  expect(outputArray).toEqual([0, 0, 0, -1])
  expect(underrunBits[0]).toEqual(0n)
})

test('multiple silences', async () => {
  FilePlayingAudioWorkletProcessor.RENDER_QUANTUM = 128
  const ringBufferArray = RingBuffer.getStorageForCapacity(1024, Float32Array)
  const ringBuffer = new RingBuffer(ringBufferArray, Float32Array)
  ringBuffer.push(createTestData(1, NaN, 8, NaN, 6, -1))
  const underrunBits = new BigUint64Array(1)
  const processor = new FilePlayingAudioWorkletProcessor({
    processorOptions: {
      ringBufferArray: ringBufferArray,
      length: 5000,
      underrunBits: underrunBits,
      index: 0,
    },
  })

  const outputArray = new Array(128).fill(0)
  processor.process(null, [[outputArray]])

  expect(outputArray.slice(0, 16)).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -1])
})

test('length', async () => {
  FilePlayingAudioWorkletProcessor.RENDER_QUANTUM = 128
  const ringBufferArray = RingBuffer.getStorageForCapacity(1024, Float32Array)
  const ringBuffer = new RingBuffer(ringBufferArray, Float32Array)
  ringBuffer.push(createTestData(...new Array(200).fill(1)))
  const underrunBits = new BigUint64Array(1)
  const processor = new FilePlayingAudioWorkletProcessor({
    processorOptions: {
      ringBufferArray: ringBufferArray,
      length: 200,
      underrunBits: underrunBits,
      index: 0,
    },
  })

  const outputArray = new Array(128).fill(0)
  processor.process(null, [[outputArray]])

  expect(outputArray).toEqual(new Array(128).fill(1))
  expect(underrunBits[0]).toEqual(0n)

  global.currentFrame = 128

  outputArray.fill(0)
  processor.process(null, [[outputArray]])

  expect(outputArray).toEqual(new Array(72).fill(1).concat(new Array(56).fill(0)))
  expect(underrunBits[0]).toEqual(0n)
})

test('length and start position', async () => {
  FilePlayingAudioWorkletProcessor.RENDER_QUANTUM = 128
  const ringBufferArray = RingBuffer.getStorageForCapacity(1024, Float32Array)
  const ringBuffer = new RingBuffer(ringBufferArray, Float32Array)
  ringBuffer.push(createTestData(...new Array(10).fill(1)))
  const underrunBits = new BigUint64Array(1)
  const processor = new FilePlayingAudioWorkletProcessor({
    processorOptions: {
      ringBufferArray: ringBufferArray,
      length: 200,
      startPosition: 190,
      underrunBits: underrunBits,
      index: 0,
    },
  })

  const outputArray = new Array(128).fill(0)
  processor.process(null, [[outputArray]])

  expect(outputArray).toEqual(new Array(10).fill(1).concat(new Array(118).fill(0)))
  expect(underrunBits[0]).toEqual(0n)
})

test('exhausts buffer', async () => {
  FilePlayingAudioWorkletProcessor.RENDER_QUANTUM = 4
  const ringBufferArray = RingBuffer.getStorageForCapacity(6, Float32Array)
  const ringBuffer = new RingBuffer(ringBufferArray, Float32Array)
  ringBuffer.push(createTestData(1, 1, 1, 1, 1, 1))
  const underrunBits = new BigUint64Array(1)
  const processor = new FilePlayingAudioWorkletProcessor({
    processorOptions: {
      ringBufferArray: ringBufferArray,
      length: 200,
      underrunBits: underrunBits,
      index: 0,
    },
  })

  const outputArray = new Array(4).fill(0)
  processor.process(null, [[outputArray]])

  expect(outputArray).toEqual(new Array(4).fill(1))
  expect(underrunBits[0]).toEqual(0n)

  ringBuffer.push(createTestData(1, 1, 1, 1, 1, 1))
  outputArray.fill(0)

  processor.process(null, [[outputArray]])

  expect(outputArray).toEqual(new Array(4).fill(1))
  expect(underrunBits[0]).toEqual(0n)

  outputArray.fill(0)

  processor.process(null, [[outputArray]])

  expect(outputArray).toEqual(new Array(4).fill(1))
  expect(underrunBits[0]).toEqual(0n)
})
