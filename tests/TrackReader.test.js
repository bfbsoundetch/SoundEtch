import { Clip } from '../src/project/Clip.js'
import { ClipView } from '../src/project/ClipView.js'
import { MemoryTrackReader } from '../src/playback/MemoryTrackReader.js'

function getInputArray(data) {
  const result = new Float32Array(new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT * data.length))
  for (let i = 0; i < data.length; ++i) {
    result[i] = data[i]
  }
  return result
}

test('addIntoBuffer_dataMatches', async () => {
  const firstClip = new Clip('test', 2)
  const secondClip = new Clip('test2', 2)
  const thirdClip = new Clip('test3', 2)

  firstClip.addData([getInputArray([1, 1, 1]), getInputArray([0, 0, 1])])
  const firstClipView = new ClipView(firstClip, 0, 3, 1)
  secondClip.addData([getInputArray([1, 1, 1]), getInputArray([1, 0, 0])])
  const secondClipView = new ClipView(secondClip, 0, 3, 5)
  thirdClip.addData([getInputArray([1, 1, 1]), getInputArray([0, 1, 0])])
  const thirdClipView = new ClipView(thirdClip, 0, 3, 9)

  const reader = new MemoryTrackReader([firstClipView, secondClipView, thirdClipView])

  const targetBuffer = [new Float32Array(15), new Float32Array(15)]
  reader.addIntoBuffer(targetBuffer)

  expect(targetBuffer).toEqual([
    new Float32Array([0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 0, 0]),
    new Float32Array([0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0]),
  ])
})

test('addIntoMultipleBuffers_dataMatches', async () => {
  const firstClip = new Clip('test1', 2)
  const secondClip = new Clip('test2', 2)
  const thirdClip = new Clip('test3', 2)

  firstClip.addData([getInputArray([1, 1, 1]), getInputArray([0, 0, 1])])
  const firstClipView = new ClipView(firstClip, 0, 3, 1)
  secondClip.addData([getInputArray([1, 1, 1]), getInputArray([1, 0, 0])])
  const secondClipView = new ClipView(secondClip, 0, 3, 5)
  thirdClip.addData([getInputArray([1, 1, 1]), getInputArray([0, 1, 0])])
  const thirdClipView = new ClipView(thirdClip, 0, 3, 9)

  const reader = new MemoryTrackReader([firstClipView, secondClipView, thirdClipView])

  const targetBuffer1 = [new Float32Array(5), new Float32Array(5)]
  const targetBuffer2 = [new Float32Array(5), new Float32Array(5)]
  const targetBuffer3 = [new Float32Array(5), new Float32Array(5)]

  reader.addIntoBuffer(targetBuffer1)
  reader.addIntoBuffer(targetBuffer2)
  reader.addIntoBuffer(targetBuffer3)

  expect(targetBuffer1).toEqual([new Float32Array([0, 1, 1, 1, 0]), new Float32Array([0, 0, 0, 1, 0])])
  expect(targetBuffer2).toEqual([new Float32Array([1, 1, 1, 0, 1]), new Float32Array([1, 0, 0, 0, 0])])
  expect(targetBuffer3).toEqual([new Float32Array([1, 1, 0, 0, 0]), new Float32Array([1, 0, 0, 0, 0])])
})

test('Reader_addIntoBuffer_bufferLengthsInconsistent_throwsError', async () => {
  expect(() => {
    new MemoryTrackReader([]).addIntoBuffer([new Float32Array(5), new Float32Array(4)])
  }).toThrow('Input buffer channel 1 has length 4, but channel 0 has length 5')
})
