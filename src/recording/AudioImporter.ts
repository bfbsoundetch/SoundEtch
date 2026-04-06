import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import { Summary } from '../project/Summary'
import { WebDemuxer, type WebMediaInfo } from 'web-demuxer'

const DEMUXER_WASM_PATH = 'https://localhost:8443/soundetch_gh/web-demuxer.wasm'

type AudioImportResult = {
  metadata: WebMediaInfo
  length: number
}

export class AudioImporter {
  static async getChannelCount(file: File): Promise<number> {
    const demuxer = new WebDemuxer({ wasmFilePath: DEMUXER_WASM_PATH })
    try {
      await demuxer.load(file)
      const stream = await demuxer.getMediaStream('audio')
      if (!stream.channels) {
        throw new Error('Unable to determine channel count from audio stream metadata.')
      }
      return stream.channels
    } finally {
      demuxer.destroy()
    }
  }

  static async importFile(file: File, dirname: string, filename: string, summary: Summary): Promise<AudioImportResult> {
    const demuxer = new WebDemuxer({ wasmFilePath: DEMUXER_WASM_PATH })
    const summarySyncHandle = await (
      (await FileSystemUtils.getFileHandle(dirname, `${filename}_summary`)) as any
    ).createSyncAccessHandle()
    summary.setSyncFileHandle(summarySyncHandle)

    const fileSyncHandle = await (
      (await FileSystemUtils.getFileHandle(dirname, filename)) as any
    ).createSyncAccessHandle()

    let metadata: WebMediaInfo | null = null
    const outputBuffer = new Float32Array(32 * 1024)
    let outputBufferOffset = 0
    let decodeError: Error | null = null

    const flushOutputBuffer = () => {
      if (outputBufferOffset === 0) {
        return
      }
      fileSyncHandle.write(outputBuffer.slice(0, outputBufferOffset))
      outputBufferOffset = 0
    }

    const appendInterleavedSamples = (interleaved: Float32Array) => {
      let offset = 0
      while (offset < interleaved.length) {
        const toCopy = Math.min(outputBuffer.length - outputBufferOffset, interleaved.length - offset)
        outputBuffer.set(interleaved.subarray(offset, offset + toCopy), outputBufferOffset)
        outputBufferOffset += toCopy
        offset += toCopy

        if (outputBufferOffset === outputBuffer.length) {
          fileSyncHandle.write(outputBuffer)
          outputBufferOffset = 0
        }
      }
    }

    try {
      await demuxer.load(file)
      metadata = await demuxer.getMediaInfo()
      const decoderConfig = await demuxer.getDecoderConfig('audio')
      decoderConfig.sampleRate = 48000

      const decoder = new AudioDecoder({
        output: (audioData) => {
          if (decodeError) {
            audioData.close()
            return
          }

          try {
            const channelData = extractChannelData(audioData)
            const interleavedData = interleaveAudioData(channelData, audioData.numberOfFrames)
            appendInterleavedSamples(interleavedData)
            summary.summarizeInterleavedData(interleavedData, interleavedData.length)
          } catch (error) {
            decodeError = error as Error
          } finally {
            audioData.close()
          }
        },
        error: (error) => {
          decodeError = error
        },
      })

      decoder.configure(decoderConfig)

      const reader = demuxer.read('audio').getReader()
      while (true) {
        if (decodeError) {
          throw decodeError
        }
        const { value, done } = await reader.read()
        if (done) {
          break
        }
        decoder.decode(value)
      }

      await decoder.flush()
      decoder.close()

      if (decodeError) {
        throw decodeError
      }

      flushOutputBuffer()
      summary.finishSummarizing()

      return {
        metadata,
        length: summary.length,
      }
    } finally {
      fileSyncHandle.close()
      demuxer.destroy()
    }
  }
}

function interleaveAudioData(channelData: Float32Array[], frameCount: number): Float32Array {
  const channelCount = channelData.length
  const result = new Float32Array(frameCount * channelCount)
  for (let frame = 0; frame < frameCount; ++frame) {
    for (let channel = 0; channel < channelCount; ++channel) {
      result[frame * channelCount + channel] = channelData[channel]![frame]!
    }
  }
  return result
}

function extractChannelData(audioData: AudioData): Float32Array[] {
  const channelCount = audioData.numberOfChannels
  const frameCount = audioData.numberOfFrames
  const planarChannels = new Array<Float32Array>(channelCount)

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
        planarChannels[channel]![frame] = interleaved[frame * channelCount + channel]!
      }
    }
    return planarChannels
  }
}
