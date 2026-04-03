import { BatchAudioFileWriter } from './BatchAudioFileWriter.ts'
import { Summary } from '../project/Summary.ts'

const WEB_DEMUXER_ESM_URL = 'https://cdn.jsdelivr.net/npm/web-demuxer/+esm'

self.onmessage = async (e) => {
  if (e.data.type !== 'import') {
    return
  }

  const summary = new Summary(e.data.summary.channelCount)
  Object.keys(e.data.summary).forEach((key) => {
    summary[key] = e.data.summary[key]
  })

  const { audioArray, metadata } = await decodeAudio(e.data.arrayBuffer)
  await BatchAudioFileWriter.writeAudioArray(e.data.dirname, e.data.filename, audioArray, summary)

  postMessage({
    type: 'finished',
    length: summary.length,
    metadata,
  })
}

async function decodeAudio(arrayBuffer) {
  const { WebDemuxer } = await import(WEB_DEMUXER_ESM_URL)
  const demuxer = new WebDemuxer()
  await demuxer.load(new File([arrayBuffer], 'imported-audio'))

  const metadata = await demuxer.getMediaInfo()
  const decoderConfig = await demuxer.getDecoderConfig('audio')

  const channelParts = []
  let frameCount = 0

  const decoder = new AudioDecoder({
    output: (audioData) => {
      try {
        if (channelParts.length === 0) {
          for (let i = 0; i < audioData.numberOfChannels; ++i) {
            channelParts.push([])
          }
        }

        const channelData = extractChannelData(audioData)
        frameCount += audioData.numberOfFrames
        for (let channelIndex = 0; channelIndex < channelData.length; ++channelIndex) {
          channelParts[channelIndex].push(channelData[channelIndex])
        }
      } finally {
        audioData.close()
      }
    },
    error: (error) => {
      throw error
    },
  })

  decoder.configure(decoderConfig)

  const reader = demuxer.read('audio').getReader()
  while (true) {
    const { value, done } = await reader.read()
    if (done) {
      break
    }
    decoder.decode(value)
  }

  await decoder.flush()
  decoder.close()
  demuxer.destroy()

  const merged = channelParts.map((parts) => {
    const result = new Float32Array(frameCount)
    let offset = 0
    for (const part of parts) {
      result.set(part, offset)
      offset += part.length
    }
    return result
  })

  return {
    audioArray: merged,
    metadata,
  }
}

function extractChannelData(audioData) {
  const channelCount = audioData.numberOfChannels
  const frameCount = audioData.numberOfFrames
  const planarChannels = new Array(channelCount)

  try {
    for (let i = 0; i < channelCount; ++i) {
      const plane = new Float32Array(frameCount)
      audioData.copyTo(plane, { planeIndex: i, format: 'f32-planar' })
      planarChannels[i] = plane
    }
    return planarChannels
  } catch (_) {
    const interleaved = new Float32Array(frameCount * channelCount)
    audioData.copyTo(interleaved, { planeIndex: 0, format: 'f32' })
    for (let i = 0; i < channelCount; ++i) {
      planarChannels[i] = new Float32Array(frameCount)
    }
    for (let frame = 0; frame < frameCount; ++frame) {
      for (let channel = 0; channel < channelCount; ++channel) {
        planarChannels[channel][frame] = interleaved[frame * channelCount + channel]
      }
    }
    return planarChannels
  }
}

self.onerror = (e) => {
  console.error(e)
}

self.onmessageerror = (e) => {
  console.error(e)
}
