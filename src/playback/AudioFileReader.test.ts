import { AudioFileReader } from './AudioFileReader'
import { RingBuffer } from 'ringbuf.js'
import { MemoryBackedFileSystem } from '../filesystem/MemoryBackedFileSystem'
import { GlobalSettings } from '../global/GlobalSettings'
import { vi } from 'vitest'
import { Clip } from '../project/Clip'
import { ClipView, cloneClipViewWithNewStartPosition } from '../project/ClipView'
import { expect, test } from 'vitest'

GlobalSettings.useMemoryFS = true

test('basic test', async () => {
  const ringBufferArray = RingBuffer.getStorageForCapacity(8 * 1024, Float32Array)
  const ringBuffer = new RingBuffer(ringBufferArray, Float32Array)
  MemoryBackedFileSystem.deleteFile('test', '1')
  const file1 = MemoryBackedFileSystem.getFileHandle('test', '1')
  file1.write(getInputArrayBuffer(0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7))
  const clipView1 = {
    startPosition: 5,
    offset: 1,
    length: 3,
    clip: { id: 1, channelCount: 1 },
  }
  const clipView2 = {
    startPosition: 100,
    offset: 2,
    length: 4,
    clip: { id: 1, channelCount: 1 },
  }
  const audioFileReader = new AudioFileReader('test', 0, 999, [clipView1, clipView2], 1, false, ringBufferArray)

  await audioFileReader.runBufferFillingLoop()
  const outputArray = new Float32Array(16)
  ringBuffer.pop(outputArray)

  const testArray = new Float32Array(16)
  testArray.set([Number.NaN, 5, 0.2, 0.3, 0.4, Number.NaN, 92, 0.3, 0.4, 0.5, 0.6])
  expect(outputArray).toEqual(testArray)
})

test('moved clip view starts playback on a whole sample', async () => {
  const ringBufferArray = RingBuffer.getStorageForCapacity(32, Float32Array)
  const ringBuffer = new RingBuffer(ringBufferArray, Float32Array)
  MemoryBackedFileSystem.deleteFile('test', '13')
  const file = MemoryBackedFileSystem.getFileHandle('test', '13')
  file.write(getInputArrayBuffer(0.1, 0.2, 0.3))
  const clip = new Clip('test', 1, 3)
  const movedClipView = cloneClipViewWithNewStartPosition(new ClipView(clip, 0, 0, 3), 2.5)
  const playbackClipView = {
    startPosition: movedClipView.startPosition,
    offset: movedClipView.offset,
    length: movedClipView.length,
    clip: { id: 13, channelCount: 1 },
  }
  const audioFileReader = new AudioFileReader('test', 0, 6, [playbackClipView], 1, false, ringBufferArray)

  await audioFileReader.runBufferFillingLoop()
  const output = new Float32Array(5)
  ringBuffer.pop(output)

  expect(output).toEqual(new Float32Array([Number.NaN, 3, 0.1, 0.2, 0.3]))
})

test('equal-power crossfade', async () => {
  const ringBufferArray = RingBuffer.getStorageForCapacity(32, Float32Array)
  const ringBuffer = new RingBuffer(ringBufferArray, Float32Array)
  const firstFile = MemoryBackedFileSystem.getFileHandle('test', '11')
  const secondFile = MemoryBackedFileSystem.getFileHandle('test', '12')
  firstFile.write(getInputArrayBuffer(1, 1, 1, 1))
  secondFile.write(getInputArrayBuffer(2, 2, 2, 2))
  const clipViews = [
    { startPosition: 0, offset: 0, length: 4, clip: { id: 11, channelCount: 1 } },
    { startPosition: 2, offset: 0, length: 4, clip: { id: 12, channelCount: 1 } },
  ]
  const audioFileReader = new AudioFileReader('test', 0, 6, clipViews, 1, false, ringBufferArray)

  await audioFileReader.runBufferFillingLoop()
  const output = new Float32Array(6)
  ringBuffer.pop(output)

  expect(output).toEqual(new Float32Array([1, 1, 1, 3 / Math.sqrt(2), 2, 2]))
})

test('timed wait test', async () => {
  vi.useFakeTimers()
  const ringBufferArray = RingBuffer.getStorageForCapacity(5, Float32Array)
  const ringBuffer = new RingBuffer(ringBufferArray, Float32Array)
  MemoryBackedFileSystem.deleteFile('test', '1')
  const file1 = MemoryBackedFileSystem.getFileHandle('test', '1')
  file1.write(getInputArrayBuffer(0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7))
  const clipView1 = {
    startPosition: 5,
    offset: 1,
    length: 3,
    clip: { id: 1, channelCount: 1 },
  }
  const clipView2 = {
    startPosition: 100,
    offset: 2,
    length: 4,
    clip: { id: 1, channelCount: 1 },
  }
  const audioFileReader = new AudioFileReader('test', 0, 999, [clipView1, clipView2], 1, false, ringBufferArray)

  audioFileReader.runBufferFillingLoop()

  const outputArray = new Float32Array(10)
  await waitForFullRingBuffer(ringBuffer)
  await stepAwaitsForward()

  ringBuffer.pop(outputArray)

  const testArray = new Float32Array(10)
  testArray.set([10, 0.2, 0.3, 0.4, 184])
  expect(outputArray).toEqual(testArray)

  await stepAwaitsForward()

  expect(ringBuffer.availableRead()).toBe(0)

  // clipView2 startPosition 100 - clipView1 startPosition 5 - length 3 = 92 samples
  // sample rate is 1, then * 1000 milliseconds per second, finally subtract 250ms
  vi.advanceTimersByTime(92 * 1000 - 250)
  await stepAwaitsForward()
  ringBuffer.pop(outputArray, 4, 5)

  testArray.set([10, 0.2, 0.3, 0.4, 184, 0.3, 0.4, 0.5, 0.6])
  expect(outputArray).toEqual(testArray)
})

test('pause and resume', async () => {
  const ringBufferArray = RingBuffer.getStorageForCapacity(4, Float32Array)
  const ringBuffer = new RingBuffer(ringBufferArray, Float32Array)
  MemoryBackedFileSystem.deleteFile('test', '1')
  const file1 = MemoryBackedFileSystem.getFileHandle('test', '1')
  file1.write(getInputArrayBuffer(1.1, 2.2, 3.3, 4.4, 5.5, 6.6, 7.7))
  const clipView1 = {
    startPosition: 5,
    offset: 1,
    length: 3,
    clip: { id: 1, channelCount: 1 },
  }
  const audioFileReader = new AudioFileReader('test', 5, 999, [clipView1], 1, false, ringBufferArray)

  audioFileReader.pause()
  audioFileReader.runBufferFillingLoop()
  await stepAwaitsForward()

  expect(ringBuffer.availableRead()).toBe(0)

  audioFileReader.resume()
  await stepAwaitsForward()

  expect(ringBuffer.availableRead()).toBeGreaterThan(0)
})

test('stop test', async () => {
  const ringBufferArray = RingBuffer.getStorageForCapacity(4, Float32Array)
  const ringBuffer = new RingBuffer(ringBufferArray, Float32Array)
  MemoryBackedFileSystem.deleteFile('test', '1')
  const file1 = MemoryBackedFileSystem.getFileHandle('test', '1')
  file1.write(getInputArrayBuffer(1.1, 2.2, 3.3, 4.4, 5.5, 6.6, 7.7))
  const clipView1 = {
    startPosition: 0,
    offset: 1,
    length: 3,
    clip: { id: 1, channelCount: 1 },
  }
  const audioFileReader = new AudioFileReader('test', 0, 999, [clipView1], 1, false, ringBufferArray)

  audioFileReader.pause()
  const result = audioFileReader.runBufferFillingLoop()
  await stepAwaitsForward()

  expect(ringBuffer.availableRead()).toBe(0)

  audioFileReader.stop()
  await result

  expect(ringBuffer.availableRead()).toBe(0)
})

test('large silence', async () => {
  const ringBufferArray = RingBuffer.getStorageForCapacity(5, Float32Array)
  const ringBuffer = new RingBuffer(ringBufferArray, Float32Array)
  MemoryBackedFileSystem.deleteFile('test', '1')
  const file1 = MemoryBackedFileSystem.getFileHandle('test', '1')
  file1.write(getInputArrayBuffer(0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7))
  const clipView1 = {
    startPosition: 33_554_433, // max exact int * 2 + 1
    offset: 1,
    length: 2,
    clip: { id: 1, channelCount: 1 },
  }
  const audioFileReader = new AudioFileReader('test', 0, 999, [clipView1], 1, false, ringBufferArray)

  audioFileReader.runBufferFillingLoop()

  const outputArray = new Float32Array(5)
  await waitForFullRingBuffer(ringBuffer)
  await stepAwaitsForward()

  ringBuffer.pop(outputArray)

  const expected = new Float32Array(5)
  expected.set([33554432, 33554432, 2, 0.2, 0.3])
  expect(outputArray).toEqual(expected)
  expect(ringBuffer.availableRead()).toBe(0)
})

function getInputArrayBuffer(...data: Array<number>): ArrayBuffer {
  const result = new Float32Array(new ArrayBuffer(Float32Array.BYTES_PER_ELEMENT * data.length))
  for (let i = 0; i < data.length; ++i) {
    result[i] = data[i]
  }
  return result.buffer
}

//TODO: more elegantly wait for buffer filling loop to hit await
async function waitForFullRingBuffer(ringBuffer: RingBuffer) {
  while (ringBuffer.availableWrite() || !ringBuffer.availableRead()) {
    await Promise.resolve(null)
  }
}

async function stepAwaitsForward() {
  for (let i = 0; i < 100; ++i) {
    await Promise.resolve(null)
  }
}
