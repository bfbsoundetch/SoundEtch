import { expect, test } from 'vitest'
import { RawDataAudioContext } from '@descript/web-audio-js'
import { createRenderingAudioSource } from './RenderingAudioSource'

test('renders the current source block without startup latency', () => {
  const blockSize = 128
  const audioContext = new RawDataAudioContext({ sampleRate: 48000, blockSize, numberOfChannels: 1 })
  const source = createRenderingAudioSource(audioContext, 1)
  source.node.connect(audioContext.destination, 0, 0)
  audioContext.resume()

  source.channelData[0].fill(1)
  const firstOutput = new Float32Array(blockSize)
  audioContext.process([firstOutput])

  source.channelData[0].fill(2)
  const secondOutput = new Float32Array(blockSize)
  audioContext.process([secondOutput])

  expect(firstOutput).toEqual(new Float32Array(blockSize).fill(1))
  expect(secondOutput).toEqual(new Float32Array(blockSize).fill(2))
})
