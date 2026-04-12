import { WebDemuxer } from 'web-demuxer'
import SoxrResampler, { SoxrDatatype, SoxrQuality } from 'wasm-audio-resampler'
import { ProjectManager } from '../project/ProjectManager'
import { AudioControl } from '../audiocontext/AudioControl'
import { Track } from '../project/Track'
import { cloneWithGetters } from '../global/ObjectUtils'

const DEMUXER_WASM_PATH = 'https://localhost:8443/soundetch_gh/web-demuxer.wasm'
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

    const writingWorker = new Worker(new URL('./AudioFileWritingWorker.js', import.meta.url), {type: 'module'})

    try {
      throwIfAborted(signal)
      await demuxer.load(file)
      throwIfAborted(signal)
      const [decoderConfig, mediaInfo] = await Promise.all([demuxer.getDecoderConfig('audio'), demuxer.getMediaInfo()])

      track = await ProjectManager.addClipWithTrack(
        file.name,
        decoderConfig.numberOfChannels,
        0, // to be overwritten
        AudioControl.startPosition,
        'File',
      )
      ;(window as any).trackListController.draw()
      const clipView = track.clipViews[0]!
      const clip = clipView.clip

      const activeProject = await ProjectManager.getActiveProject()

      const workerInput = {
        dirname: `${activeProject.id}`,
        channelCount: decoderConfig.numberOfChannels,
        clip: cloneWithGetters(clip),
      }
      const writeFinishPromise = Promise.withResolvers()
      writingWorker.addEventListener('message', (e) => {
        if (e.data.type == 'finish') {
          writeFinishPromise.resolve('')
        }
      })
      writingWorker.addEventListener('message', clipView.clip.summary.getWorkerMessageListener())
      writingWorker.postMessage({type: 'init', input: workerInput})

      const sourceSampleRate = decoderConfig.sampleRate
      const targetSampleRate = activeProject.sampleRate
      const resampler =
        sourceSampleRate !== targetSampleRate
          ? new SoxrResampler(
              decoderConfig.numberOfChannels,
              sourceSampleRate,
              targetSampleRate,
              SoxrDatatype.SOXR_FLOAT32,
              SoxrDatatype.SOXR_FLOAT32,
              SoxrQuality.SOXR_MQ,
            )
          : null

      const encodedReader = demuxer.read('audio').getReader()

      let pendingAudioLength = 0
      let pendingAudioChunks: Array<AudioData> = []
      let progressMs = 0
      const decoder = new AudioDecoder({
        output: (audioData) => { 
          throwIfAborted(signal)

          if (pendingAudioLength >= INTERLEAVE_RESAMPLE_BATCH_SIZE_SAMPLES) {
            let interleaved = concatenateInterleavedAudioData(pendingAudioChunks, pendingAudioLength)

            if (resampler) {
              interleaved = resampleInterleavedData(resampler, interleaved)
            }

            progressMs += interleaved.length / decoderConfig.sampleRate / mediaInfo.duration
            writingWorker.postMessage({type: 'audio', audio: interleaved.buffer}, [interleaved.buffer])

            onProgress?.(progressMs)

            pendingAudioChunks.splice(0)
            pendingAudioLength = 0
          } else {
            pendingAudioChunks.push(audioData)
            pendingAudioLength += audioData.numberOfChannels * audioData.numberOfFrames
          }
        },
        error: (e) => { writeFinishPromise.reject(e) }
      })
      decoder.configure(decoderConfig)
      await resampler?.init()

      while (true) {
        throwIfAborted(signal)
        const {done, value} = await encodedReader.read()
        if (done) {
          await decoder.flush()
          decoder.close()
          break
        }
        if (decoder.decodeQueueSize > 100) {
          await new Promise(r => setTimeout(r))
        }
        decoder.decode(value)
      }

      if (resampler) {
        const result = flushResampler(resampler)
        writingWorker.postMessage({type: 'audio', audio: result.buffer}, [result.buffer])
      }
      writingWorker.postMessage({type: 'stop'})
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
      writingWorker.terminate()
      demuxer.destroy()
    }
  }
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

function resampleInterleavedData(resampler: SoxrResampler, interleaved: Float32Array): Float32Array {
  return new Float32Array(resampler.processChunk(float32ToUint8Array(interleaved)).buffer as ArrayBuffer)
}

function flushResampler(resampler: SoxrResampler): Float32Array {
  return new Float32Array(resampler.processChunk(null as any).buffer as ArrayBuffer)
}

function float32ToUint8Array(data: Float32Array): Uint8Array {
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
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
