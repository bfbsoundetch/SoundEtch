import type { api } from '@descript/web-audio-js'
import { RawDataAudioContext } from '@descript/web-audio-js'

export interface RenderingAudioSource {
  channelData: Array<Float32Array>
  node: api.AudioBufferSourceNode
}

export function createRenderingAudioSource(
  audioContext: RawDataAudioContext,
  channelCount: number,
): RenderingAudioSource {
  const channelData = Array.from({ length: channelCount }, () => new Float32Array(audioContext.blockSize))
  const node = audioContext.createBufferSource()
  node.buffer = audioContext.createAudioBuffer(audioContext.blockSize, audioContext.sampleRate, channelData)
  node.loop = true
  node.start(audioContext.currentTime, 0, Infinity)

  return { channelData, node }
}
