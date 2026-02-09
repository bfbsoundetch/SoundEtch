import { Clip } from '../src/project/Clip'
import { Constants } from '../src/Constants'
import { MemoryClipReader } from '../src/playback/MemoryClipReader'

function getInputArray(data) {
  const result = new Float32Array(new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT * data.length))
  for (let i = 0; i < data.length; ++i) {
    result[i] = data[i]
  }
  return result
}

test('addIntoBuffer_dataMatches', async () => {
  const clip = new Clip('test', 2)
  clip.addData([getInputArray([1, 2, 3, 4]), getInputArray([2, 3, 4, 5])])
  const reader = new MemoryClipReader(clip, 0, 4)
  const targetBuffer = [new Float32Array(4), new Float32Array(4)]

  reader.addIntoBuffer(targetBuffer, 0)

  expect(targetBuffer[0]).toEqual(new Float32Array([1, 2, 3, 4]))
  expect(targetBuffer[1]).toEqual(new Float32Array([2, 3, 4, 5]))
})

test('addIntoBuffer_noData_bufferUnchanged', async () => {
  const clip = new Clip('test', 2)
  const reader = new MemoryClipReader(clip, 0, 4)
  const targetBuffer = [new Float32Array([1]), new Float32Array([2])]

  reader.addIntoBuffer(targetBuffer, 0)

  expect(targetBuffer[0]).toEqual(new Float32Array([1]))
  expect(targetBuffer[1]).toEqual(new Float32Array([2]))
})

test('addIntoBuffer_loadTest', async () => {
  const clip = new Clip('test', 2)
  const dataToAdd = [
    new Float32Array(new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT * Constants.CHUNK_SIZE * 2)),
    new Float32Array(new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT * Constants.CHUNK_SIZE * 2)),
  ]
  for (let i = 0; i < dataToAdd[0].length; ++i) {
    dataToAdd[0][i] = (i % 1024) / 1024
    dataToAdd[1][i] = (i % 1024) / 1024
  }
  clip.addData(dataToAdd)
  const reader = new MemoryClipReader(clip, 0, dataToAdd[0].length)
  const targetBuffer = [new Float32Array(Constants.CHUNK_SIZE * 2), new Float32Array(Constants.CHUNK_SIZE * 2)]

  reader.addIntoBuffer(targetBuffer, 3)

  for (let i = 3; i < dataToAdd[0].length; ++i) {
    expect(targetBuffer[0][i]).toBe(((i - 3) % 1024) / 1024)
    expect(targetBuffer[1][i]).toBe(((i - 3) % 1024) / 1024)
  }
})

test('addIntoBuffer_loadTest2', async () => {
  const clip = new Clip('test', 2)
  for (let i = 0; i < 32; ++i) {
    const dataToAdd = [
      new Float32Array(new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT * 1024)),
      new Float32Array(new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT * 1024)),
    ]
    for (let j = 0; j < dataToAdd[0].length; ++j) {
      dataToAdd[0][j] = ((i + j) % 1024) / 1024
      dataToAdd[1][j] = ((i + j) % 1024) / 1024
    }
    clip.addData(dataToAdd)
  }
  const reader = new MemoryClipReader(clip, 0, 32 * 1024)

  var totalRead = 0
  while (totalRead < 32 * 1024) {
    const targetBuffer = [new Float32Array(384), new Float32Array(384)]
    const read = reader.addIntoBuffer(targetBuffer, 0)

    if (totalRead == 32 * 1024 - 128) {
      expect(read).toBe(128)
    } else {
      expect(read).toBe(384)
    }

    for (let i = 0; i < targetBuffer[0].length; ++i) {
      if (totalRead == 32 * 1024) {
        expect(targetBuffer[0][i]).toBe(0)
        expect(targetBuffer[1][i]).toBe(0)
      } else {
        expect(targetBuffer[0][i]).toBe(((Math.trunc(totalRead / 1024) + totalRead) % 1024) / 1024)
        expect(targetBuffer[1][i]).toBe(((Math.trunc(totalRead / 1024) + totalRead) % 1024) / 1024)
        ++totalRead
      }
    }
  }
})

test('addIntoBuffer_respectsOffset', async () => {
  const clip = new Clip('test', 2)
  clip.addData([getInputArray([1, 2, 3, 4]), getInputArray([2, 3, 4, 5])])
  const reader = new MemoryClipReader(clip, 0, 4)
  const targetBuffer = [new Float32Array(6), new Float32Array(6)]

  reader.addIntoBuffer(targetBuffer, 2)

  expect(targetBuffer[0]).toEqual(new Float32Array([0, 0, 1, 2, 3, 4]))
  expect(targetBuffer[1]).toEqual(new Float32Array([0, 0, 2, 3, 4, 5]))
})

test('addIntoBuffer_wrongChannelCount_throwsError', async () => {
  const clip = new Clip('test', 1)
  const reader = new MemoryClipReader(clip, 0, 4)
  const targetBuffer = [new Float32Array(6), new Float32Array(6)]

  expect(() => {
    reader.addIntoBuffer(targetBuffer, 0)
  }).toThrow()
})

test('addIntoBuffer_badOffset_throwsError', async () => {
  const clip = new Clip('test', 2)
  const reader = new MemoryClipReader(clip, 0, 4)
  const targetBuffer = [new Float32Array(6), new Float32Array(6)]

  expect(() => {
    reader.addIntoBuffer(targetBuffer, 7)
  }).toThrow()
})

test('addIntoBuffer_inconsistentInputBufferLength_throwsError', async () => {
  const clip = new Clip('test', 2)
  const reader = new MemoryClipReader(clip, 0, 4)
  const targetBuffer = [new Float32Array(7), new Float32Array(6)]

  expect(() => {
    reader.addIntoBuffer(targetBuffer, 0)
  }).toThrow()
})

test('setPosition_readsFromPosition', async () => {
  Constants.CHUNK_SIZE = 2
  const clip = new Clip('test', 2)
  clip.addData([getInputArray([-1, 0, 1, 2, 3, 4]), getInputArray([0, 1, 2, 3, 4, 5])])
  const reader = new MemoryClipReader(clip, 0, 6)
  const targetBuffer = [new Float32Array(6), new Float32Array(6)]

  reader.setPosition(4)
  reader.addIntoBuffer(targetBuffer, 4)

  expect(targetBuffer[0]).toEqual(new Float32Array([0, 0, 0, 0, 3, 4]))
  expect(targetBuffer[1]).toEqual(new Float32Array([0, 0, 0, 0, 4, 5]))

  reader.setPosition(2)
  reader.addIntoBuffer(targetBuffer, 0)

  expect(targetBuffer[0]).toEqual(new Float32Array([1, 2, 3, 4, 3, 4]))
  expect(targetBuffer[1]).toEqual(new Float32Array([2, 3, 4, 5, 4, 5]))
})

test('skip_readsAfterSkippedSamples', async () => {
  Constants.CHUNK_SIZE = 2
  const clip = new Clip('test', 2)
  clip.addData([getInputArray([-1, 0, 1, 2, 3, 4]), getInputArray([0, 1, 2, 3, 4, 5])])
  const reader = new MemoryClipReader(clip, 0, 6)
  const targetBuffer = [new Float32Array(6), new Float32Array(6)]

  reader.setPosition(4)
  reader.addIntoBuffer(targetBuffer, 4)

  expect(targetBuffer[0]).toEqual(new Float32Array([0, 0, 0, 0, 3, 4]))
  expect(targetBuffer[1]).toEqual(new Float32Array([0, 0, 0, 0, 4, 5]))

  reader.setPosition(2)
  reader.addIntoBuffer(targetBuffer, 0)

  expect(targetBuffer[0]).toEqual(new Float32Array([1, 2, 3, 4, 3, 4]))
  expect(targetBuffer[1]).toEqual(new Float32Array([2, 3, 4, 5, 4, 5]))
})
