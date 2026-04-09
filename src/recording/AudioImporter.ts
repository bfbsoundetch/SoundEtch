import { ProjectManager } from '../project/ProjectManager'
import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import { Summary } from '../project/Summary'
import { WebDemuxer, type WebMediaInfo } from 'web-demuxer'
import { AudioControl } from '../audiocontext/AudioControl'
import { create, ConverterType } from '@alexanderolsen/libsamplerate-js'
import { Track } from '../project/Track'

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

  static async importFile(file: File, track: Track): Promise<AudioImportResult> {
    const activeProject = await ProjectManager.getActiveProject()

    const demuxer = new WebDemuxer({ wasmFilePath: DEMUXER_WASM_PATH })
    let writable: FileSystemWritableFileStream | null = null
    let importError: unknown = null
    let resampler: Awaited<ReturnType<typeof create>> | null = null

    try {
      await demuxer.load(file)
      const metadata = await demuxer.getMediaInfo()
      const decoderConfig = await demuxer.getDecoderConfig('audio')
      const sourceSampleRate = decoderConfig.sampleRate
      const targetSampleRate = activeProject.sampleRate || AudioControl.audioContext?.sampleRate || sourceSampleRate
      const needsResampling = sourceSampleRate !== targetSampleRate
      resampler = needsResampling
        ? await create(decoderConfig.numberOfChannels, sourceSampleRate, targetSampleRate, {
            converterType: ConverterType.SRC_SINC_MEDIUM_QUALITY,
          })
        : null
      const clipView = track.clipViews[0]!
      const clip = clipView.clip
      const summary = clip.summary
      const dirname = `${activeProject.id}`
      const filename = clip.filename
      const fileHandle = await FileSystemUtils.getFileHandle(dirname, filename)
      writable = await fileHandle.createWritable()
      ;(window as any).trackListController.draw()

      let outputBuffer = new Float32Array(32 * 1024)
      let outputBufferOffset = 0
      let writeChain = Promise.resolve()
      const resampleInputChunkSize = 32 * 1024
      const resampleInputBuffer = resampler ? new Float32Array(resampleInputChunkSize) : null
      let resampleInputOffset = 0

      const queueWrite = (buffer: Float32Array): Promise<void> => {
        writeChain = writeChain.then(async () => {
          if (!writable) {
            throw new Error('Audio output writable stream was not initialized.')
          }
          await writable.write(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength))
        })
        return writeChain
      }

      const flushOutputBuffer = async () => {
        if (outputBufferOffset === 0) {
          return
        }
        const pendingChunk = outputBuffer.slice(0, outputBufferOffset)
        outputBufferOffset = 0
        await queueWrite(pendingChunk)
      }

      const appendInterleavedSamples = (interleaved: Float32Array) => {
        let offset = 0
        while (offset < interleaved.length) {
          const toCopy = Math.min(outputBuffer.length - outputBufferOffset, interleaved.length - offset)
          outputBuffer.set(interleaved.subarray(offset, offset + toCopy), outputBufferOffset)
          outputBufferOffset += toCopy
          offset += toCopy

          if (outputBufferOffset === outputBuffer.length) {
            const pendingChunk = outputBuffer
            outputBuffer = new Float32Array(32 * 1024)
            outputBufferOffset = 0
            void queueWrite(pendingChunk).catch((error) => {
              decodeError = error as Error
            })
          }
        }
      }

      const processInterleavedSamples = (interleaved: Float32Array) => {
        if (!resampler || !resampleInputBuffer) {
          appendInterleavedSamples(interleaved)
          summary.summarizeInterleavedData(interleaved, interleaved.length)
          return
        }

        let offset = 0
        while (offset < interleaved.length) {
          const toCopy = Math.min(resampleInputBuffer.length - resampleInputOffset, interleaved.length - offset)
          resampleInputBuffer.set(interleaved.subarray(offset, offset + toCopy), resampleInputOffset)
          resampleInputOffset += toCopy
          offset += toCopy

          if (resampleInputOffset === resampleInputBuffer.length) {
            const resampled = resampler.full(resampleInputBuffer)
            if (resampled.length > 0) {
              appendInterleavedSamples(resampled)
              summary.summarizeInterleavedData(resampled, resampled.length)
            }
            resampleInputOffset = 0
          }
        }
      }

      let decodeError: Error | null = null
      const decoder = new AudioDecoder({
        output: (audioData) => {
          if (decodeError) {
            audioData.close()
            return
          }

          try {
            const interleavedData = toInterleavedAudioData(audioData)
            processInterleavedSamples(interleavedData)
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

      if (resampler) {
        if (resampleInputBuffer && resampleInputOffset > 0) {
          const pendingResampleInput = resampleInputBuffer.subarray(0, resampleInputOffset)
          const resampledPendingInput = resampler.full(pendingResampleInput)
          if (resampledPendingInput.length > 0) {
            appendInterleavedSamples(resampledPendingInput)
            summary.summarizeInterleavedData(resampledPendingInput, resampledPendingInput.length)
          }
        }

        const flushedInterleaved = resampler.full(new Float32Array(0))
        if (flushedInterleaved.length > 0) {
          appendInterleavedSamples(flushedInterleaved)
          summary.summarizeInterleavedData(flushedInterleaved, flushedInterleaved.length)
        }
      }

      await flushOutputBuffer()
      await writeChain
      summary.finishSummarizing()

      return {
        metadata,
        length: summary.length,
      }
    } catch (error) {
      importError = error
      throw error
    } finally {
      try {
        resampler?.destroy()
      } catch {
        // best-effort cleanup
      }
      if (writable) {
        try {
          if (importError && typeof writable.abort === 'function') {
            await writable.abort()
          } else {
            await writable.close()
          }
        } catch (closeError) {
          if (!importError) {
            throw closeError
          }
        }
      }
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

function toInterleavedAudioData(audioData: AudioData): Float32Array {
  const sourceFormat = audioData.format
  const frameCount = audioData.numberOfFrames
  const channelCount = audioData.numberOfChannels

  if (!sourceFormat?.endsWith('-planar')) {
    const interleaved = new Float32Array(frameCount * channelCount)
    audioData.copyTo(interleaved, { planeIndex: 0, format: 'f32' })
    return interleaved
  }

  const channelData = extractChannelData(audioData)
  return interleaveAudioData(channelData, frameCount)
}

function extractChannelData(audioData: AudioData): Float32Array[] {
  const sourceFormat = audioData.format
  const channelCount = audioData.numberOfChannels
  const frameCount = audioData.numberOfFrames
  const planarChannels = new Array<Float32Array>(channelCount)

  if (!sourceFormat?.endsWith('-planar')) {
    throw new Error(`extractChannelData expects planar AudioData, received "${sourceFormat}".`)
  }

  for (let i = 0; i < channelCount; ++i) {
    const plane = new Float32Array(frameCount)
    audioData.copyTo(plane, { planeIndex: i, format: 'f32-planar' })
    planarChannels[i] = plane
  }
  return planarChannels
}
