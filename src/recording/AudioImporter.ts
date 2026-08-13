import { WebDemuxer } from '@bfbsoundetch/web-demuxer'
import { ProjectManager } from '../project/ProjectManager'
import { AudioControl } from '../audiocontext/AudioControl'
import { Track } from '../project/Track'
import { cloneWithGetters } from '../global/ObjectUtils'
import { importedClipName, importedTags } from './ImportMetadata'

const DEMUXER_WASM_PATH = new URL('web-demuxer.wasm', document.baseURI).href
const INTERLEAVE_RESAMPLE_BATCH_SIZE_SAMPLES = 1024 * 1024

interface ImportFileOptions {
  onProgress?: (progress: number) => void
  signal?: AbortSignal
}

export class AudioImporter {
  static async importFile(file: File, options: ImportFileOptions = {}): Promise<Track> {
    const startTime = Date.now()
    const demuxer = new WebDemuxer({ wasmFilePath: DEMUXER_WASM_PATH })
    const { onProgress, signal } = options
    let track: Track | null = null

    const writingWorker = new Worker(new URL('./AudioFileWritingWorker.js', import.meta.url), { type: 'module' })
    let resamplingWorker: Worker | null = null

    try {
      throwIfAborted(signal)
      await demuxer.load(file)
      throwIfAborted(signal)
      const [decoderConfig, mediaInfo] = await Promise.all([demuxer.getDecoderConfig('audio'), demuxer.getMediaInfo()])
      const tags = importedTags(mediaInfo.tags, mediaInfo.streams)

      track = await ProjectManager.addClipWithTrack(
        importedClipName(file.name, tags),
        decoderConfig.numberOfChannels,
        0, // to be overwritten
        AudioControl.startPosition,
        null,
        tags,
        file.name,
      )
      ;(window as any).trackListController.draw()
      const clipView = track.clipViews[0]!
      const clip = clipView.clip

      const activeProject = await ProjectManager.getActiveProject()
      const needsResampling = decoderConfig.sampleRate !== activeProject.sampleRate

      const workerInput = {
        dirname: `${activeProject.id}`,
        channelCount: decoderConfig.numberOfChannels,
        clip: cloneWithGetters(clip),
      }
      const writeFinishPromise = Promise.withResolvers<void>()
      const resamplingReadyPromise = Promise.withResolvers<void>()
      const resamplingFinishPromise = Promise.withResolvers<void>()
      const rejectWorkerPromises = (error: unknown) => {
        writeFinishPromise.reject(error)
        resamplingReadyPromise.reject(error)
        resamplingFinishPromise.reject(error)
      }

      writingWorker.addEventListener('error', (e) => rejectWorkerPromises(e.error ?? e))
      writingWorker.addEventListener('messageerror', (e) => rejectWorkerPromises(e))

      writingWorker.addEventListener('message', (e) => {
        if (e.data.type == 'finish') {
          writeFinishPromise.resolve()
        }
      })
      writingWorker.addEventListener('message', clipView.clip.summary.getWorkerMessageListener())
      writingWorker.postMessage({ type: 'init', input: workerInput })

      const encodedReader = demuxer.read('audio').getReader()

      let pendingAudioLength = 0
      let pendingAudioChunks: Array<AudioData> = []
      let progressMs = 0

      const postAudioForWriting = (audioBuffer: ArrayBuffer) => {
        const interleaved = new Float32Array(audioBuffer)
        progressMs += interleaved.length / decoderConfig.sampleRate / decoderConfig.numberOfChannels / mediaInfo.duration
        writingWorker.postMessage({ type: 'audio', audio: interleaved.buffer }, [interleaved.buffer])
        onProgress?.(progressMs)
      }

      if (needsResampling) {
        resamplingWorker = new Worker(new URL('./AudioResamplingWorker.js', import.meta.url), { type: 'module' })
        resamplingWorker.addEventListener('error', (e) => rejectWorkerPromises(e.error ?? e))
        resamplingWorker.addEventListener('messageerror', (e) => rejectWorkerPromises(e))

        resamplingWorker.addEventListener('message', (e) => {
          if (e.data.type == 'ready') {
            resamplingReadyPromise.resolve()
            return
          }

          if (e.data.type == 'audio') {
            postAudioForWriting(e.data.audio)
            return
          }

          if (e.data.type == 'finish') {
            resamplingFinishPromise.resolve()
          }
        })
        resamplingWorker.postMessage({
          type: 'init',
          input: {
            channelCount: decoderConfig.numberOfChannels,
            sourceSampleRate: decoderConfig.sampleRate,
            targetSampleRate: activeProject.sampleRate,
          },
        })
        await resamplingReadyPromise.promise
      } else {
        resamplingReadyPromise.resolve()
        resamplingFinishPromise.resolve()
      }

      const decoder = new AudioDecoder({
        output: (audioData) => {
          throwIfAborted(signal)

          pendingAudioChunks.push(audioData)
          pendingAudioLength += audioData.numberOfChannels * audioData.numberOfFrames

          if (pendingAudioLength >= INTERLEAVE_RESAMPLE_BATCH_SIZE_SAMPLES) {
            postPendingAudio(pendingAudioChunks, pendingAudioLength, resamplingWorker, postAudioForWriting)
            pendingAudioChunks = []
            pendingAudioLength = 0
          }
        },
        error: (e) => {
          rejectWorkerPromises(e)
        },
      })
      decoder.configure(decoderConfig)

      while (true) {
        throwIfAborted(signal)
        const { done, value } = await encodedReader.read()
        if (done) {
          await decoder.flush()
          decoder.close()
          break
        }
        if (decoder.decodeQueueSize > 200) {
          // lets the decoder work
          await new Promise((r) => setTimeout(r))
        }
        decoder.decode(value)
      }

      if (pendingAudioLength > 0) {
        postPendingAudio(pendingAudioChunks, pendingAudioLength, resamplingWorker, postAudioForWriting)
      }

      resamplingWorker?.postMessage({ type: 'stop' })
      await resamplingFinishPromise.promise
      writingWorker.postMessage({ type: 'stop' })
      await writeFinishPromise.promise

      onProgress?.(1)

      console.error('stop', Date.now() - startTime)
      return track
    } catch (error) {
      console.error(error)
      if (track) {
        await cleanupImportedTrack(track)
        ;(window as any).trackListController?.draw()
      }
      throw error
    } finally {
      resamplingWorker?.terminate()
      writingWorker.terminate()
      demuxer.destroy()
    }
  }
}

function postPendingAudio(
  audioDataChunks: AudioData[],
  totalInterleavedLength: number,
  resamplingWorker: Worker | null,
  postAudioForWriting: (audioBuffer: ArrayBuffer) => void,
) {
  const interleaved = concatenateInterleavedAudioData(audioDataChunks, totalInterleavedLength)
  if (resamplingWorker) {
    resamplingWorker.postMessage({ type: 'audio', audio: interleaved.buffer }, [interleaved.buffer])
    return
  }
  postAudioForWriting(interleaved.buffer as ArrayBuffer)
}

function concatenateInterleavedAudioData(audioDataChunks: AudioData[], totalInterleavedLength: number): Float32Array {
  const interleaved = new Float32Array(totalInterleavedLength)
  let offset = 0

  try {
    for (const audioData of audioDataChunks) {
      const chunkInterleaved = toInterleavedAudioData(audioData)
      interleaved.set(chunkInterleaved, offset)
      offset += chunkInterleaved.length
    }
  } finally {
    for (const audioData of audioDataChunks) {
      audioData.close()
    }
  }

  return interleaved
}

async function cleanupImportedTrack(track: Track) {
  const clip = track.clipViews[0]?.clip
  if (clip) {
    await ProjectManager.deleteClip(clip)
  }
  if (track.clipViews.length === 0) {
    await ProjectManager.deleteTrack(track)
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError')
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
