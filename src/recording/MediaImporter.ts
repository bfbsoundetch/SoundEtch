import { WebDemuxer } from '@bfbsoundetch/web-demuxer'
import type { WebAVStream } from '@bfbsoundetch/web-demuxer'
import { ALL_FORMATS, BlobSource, Input, VideoSampleSink } from 'mediabunny'
import { ProjectManager } from '../project/ProjectManager'
import { AudioControl } from '../audiocontext/AudioControl'
import type { Track } from '../project/Track'
import type { VideoSegment } from '../project/Video'
import { cloneWithGetters } from '../global/ObjectUtils'
import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import { importedClipName, importedTags } from './ImportMetadata'
import { getAudioChunkPlacement } from './MediaTiming'

const INTERLEAVE_RESAMPLE_BATCH_SIZE_SAMPLES = 1024 * 1024

interface ImportFileOptions {
  onProgress?: (progress: number) => void
  signal?: AbortSignal
}

export class MediaImporter {
  static async importFile(file: File, options: ImportFileOptions = {}): Promise<Track> {
    const { onProgress, signal } = options
    const demuxer = new WebDemuxer({ wasmFilePath: new URL('web-demuxer.wasm', document.baseURI).href })
    let input: Input | null = null
    let track: Track | null = null
    let writingWorker: Worker | null = null
    let resamplingWorker: Worker | null = null
    let decoder: AudioDecoder | null = null
    let encodedReader: ReadableStreamDefaultReader<EncodedAudioChunk> | null = null
    const failure = Promise.withResolvers<never>()
    // A failure may arrive between awaited operations; retain it without an unhandled rejection.
    void failure.promise.catch(() => {})
    const onAbort = () => failure.reject(new DOMException('The operation was aborted.', 'AbortError'))
    const waitFor = <T>(operation: Promise<T>): Promise<T> => Promise.race([operation, failure.promise])
    signal?.addEventListener('abort', onAbort, { once: true })

    try {
      throwIfAborted(signal)
      await waitFor(demuxer.load(file))
      const mediaInfo = await waitFor(demuxer.getMediaInfo())
      const audioStreams = mediaInfo.streams.filter((stream) => stream.codec_type_string === 'audio')
      const videoStreams = mediaInfo.streams.filter((stream) => stream.codec_type_string === 'video')
      const audioStream = audioStreams.length ? await waitFor(demuxer.getMediaStream('audio')) : null
      const videoStream = videoStreams.length ? await waitFor(demuxer.getMediaStream('video')) : null
      if (!audioStream && !videoStream) {
        throw new Error('The file contains no audio or video stream')
      }
      const tags = importedTags(mediaInfo.tags, audioStream ? mediaInfo.streams : videoStream ? [videoStream] : [])
      const decoderConfig = audioStream ? await waitFor(demuxer.getDecoderConfig('audio')) : null
      if (decoderConfig) {
        if (typeof AudioDecoder === 'undefined') {
          throw new Error('Audio import requires WebCodecs audio decoding support')
        }
        if (!(await waitFor(AudioDecoder.isConfigSupported(decoderConfig))).supported) {
          throw new Error(`Unsupported audio codec: ${decoderConfig.codec}`)
        }
      }

      const project = await waitFor(ProjectManager.getActiveProject())
      let segment: VideoSegment | null = null
      let leadingAudioOffsetSeconds = 0
      if (videoStream) {
        const videoOrdinal = selectedStreamOrdinal(videoStreams, videoStream)
        input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
        if (!(await waitFor(input.canRead()))) {
          throw new Error('Unsupported video container')
        }
        const videoTracks = await waitFor(input.getVideoTracks())
        if (videoTracks.length !== videoStreams.length || !videoTracks[videoOrdinal - 1]) {
          throw new Error('Video stream ordinals do not match between media parsers')
        }
        const videoTrack = videoTracks[videoOrdinal - 1]!
        if (!(await waitFor(videoTrack.canDecode()))) {
          throw new Error(`Unsupported video codec: ${videoStream.codec_name}`)
        }
        const firstVideoPTS = await waitFor(videoTrack.getFirstTimestamp())
        const videoEndPTS = await waitFor(videoTrack.computeDuration())
        if (!Number.isFinite(firstVideoPTS) || !Number.isFinite(videoEndPTS) || videoEndPTS <= firstVideoPTS) {
          throw new Error('Video stream has no finite, nonempty presentation interval')
        }
        await waitFor(
          new VideoSampleSink(videoTrack).getSample(firstVideoPTS).then((sample) => {
            if (!sample) throw new Error('The selected video stream contains no decodable frames')
            // Close inside the operation, even if cancellation has already won the outer race.
            sample.close()
          }),
        )
        let originSeconds = firstVideoPTS
        if (audioStream) {
          const audioOrdinal = selectedStreamOrdinal(audioStreams, audioStream)
          const audioTracks = await waitFor(input.getAudioTracks())
          if (audioTracks.length !== audioStreams.length || !audioTracks[audioOrdinal - 1]) {
            throw new Error('Audio stream ordinals do not match between media parsers')
          }
          const audioTrack = audioTracks[audioOrdinal - 1]!
          if (!(await waitFor(audioTrack.canDecode()))) {
            throw new Error(`Unsupported audio codec: ${audioStream.codec_name}`)
          }
          const firstAudioPTS = await waitFor(audioTrack.getFirstTimestamp())
          if (!Number.isFinite(firstAudioPTS)) {
            throw new Error('Audio stream has no finite presentation timestamp')
          }
          originSeconds = Math.min(firstVideoPTS, firstAudioPTS)
          leadingAudioOffsetSeconds = firstAudioPTS - originSeconds
        }
        segment = {
          index: 0,
          trackNumber: videoOrdinal,
          startSample: Math.round((firstVideoPTS - originSeconds) * project.sampleRate),
          length: Math.round((videoEndPTS - firstVideoPTS) * project.sampleRate),
          mediaStartSeconds: firstVideoPTS,
          mimeType: file.type,
        }
        if (
          !Number.isSafeInteger(segment.startSample) ||
          !Number.isSafeInteger(segment.length) ||
          !Number.isSafeInteger(segment.startSample + segment.length) ||
          segment.length <= 0
        ) {
          throw new Error('Video presentation interval is outside the supported sample range')
        }
        input.dispose()
        input = null
      }

      throwIfAborted(signal)
      // Do not race publication: rollback must receive the created track even if cancellation arrives while saving it.
      track = await ProjectManager.addClipWithTrack(
        importedClipName(file.name, tags),
        decoderConfig?.numberOfChannels ?? 1,
        0,
        AudioControl.startPosition,
        null,
        tags,
        file.name,
      )
      const clip = track.clipViews[0]!.clip
      clip.audioPresent = decoderConfig !== null
      if (segment) {
        clip.videoSegments = [segment]
        clip.videoLength = segment.startSample + segment.length
        await copyVideoFile(file, project.directoryName, `${clip.filename}_video_0`, signal, (progress) => {
          onProgress?.(progress * (decoderConfig ? 0.25 : 0.95))
        })
      }
      throwIfAborted(signal)

      if (decoderConfig) {
        const channelCount = decoderConfig.numberOfChannels
        const needsResampling = decoderConfig.sampleRate !== project.sampleRate
        const writeReady = Promise.withResolvers<void>()
        const writeFinish = Promise.withResolvers<void>()
        const resamplingReady = Promise.withResolvers<void>()
        const resamplingFinish = Promise.withResolvers<void>()
        const onWorkerError = (event: ErrorEvent) => failure.reject(event.error ?? new Error(event.message))
        const onWorkerMessageError = () => failure.reject(new Error('Media import worker message could not be decoded'))
        const onWorkerFailure = (event: MessageEvent) => {
          if (event.data.type === 'error') {
            failure.reject(new Error(String(event.data.error)))
          }
        }
        writingWorker = new Worker(new URL('./AudioFileWritingWorker.js', import.meta.url), { type: 'module' })
        writingWorker.addEventListener('error', onWorkerError)
        writingWorker.addEventListener('messageerror', onWorkerMessageError)
        writingWorker.addEventListener('message', onWorkerFailure)
        writingWorker.addEventListener('message', (event) => {
          if (event.data.type === 'ready') writeReady.resolve()
          if (event.data.type === 'finish') writeFinish.resolve()
        })
        writingWorker.addEventListener('message', clip.summary.getWorkerMessageListener())
        writingWorker.postMessage({
          type: 'init',
          input: { dirname: project.directoryName, channelCount, clip: cloneWithGetters(clip) },
        })
        await waitFor(writeReady.promise)

        let outputFrames = 0
        const postAudioForWriting = (audioBuffer: ArrayBuffer) => {
          outputFrames += audioBuffer.byteLength / Float32Array.BYTES_PER_ELEMENT / channelCount
          writingWorker!.postMessage({ type: 'audio', audio: audioBuffer }, [audioBuffer])
          const audioProgress = mediaInfo.duration > 0 ? outputFrames / project.sampleRate / mediaInfo.duration : 0
          onProgress?.(Math.min(0.95, (segment ? 0.25 : 0) + audioProgress * (segment ? 0.7 : 0.95)))
        }
        if (needsResampling) {
          resamplingWorker = new Worker(new URL('./AudioResamplingWorker.js', import.meta.url), { type: 'module' })
          resamplingWorker.addEventListener('error', onWorkerError)
          resamplingWorker.addEventListener('messageerror', onWorkerMessageError)
          resamplingWorker.addEventListener('message', onWorkerFailure)
          resamplingWorker.addEventListener('message', (event) => {
            if (event.data.type === 'ready') resamplingReady.resolve()
            if (event.data.type === 'audio') postAudioForWriting(event.data.audio)
            if (event.data.type === 'finish') resamplingFinish.resolve()
          })
          resamplingWorker.postMessage({
            type: 'init',
            input: { channelCount, sourceSampleRate: decoderConfig.sampleRate, targetSampleRate: project.sampleRate },
          })
          await waitFor(resamplingReady.promise)
        } else {
          resamplingFinish.resolve()
        }

        let pendingAudioLength = 0
        let pendingAudioChunks: Float32Array[] = []
        const flushPendingAudio = () => {
          if (!pendingAudioLength) return
          const interleaved = new Float32Array(pendingAudioLength)
          let offset = 0
          for (const chunk of pendingAudioChunks) {
            interleaved.set(chunk, offset)
            offset += chunk.length
          }
          pendingAudioChunks = []
          pendingAudioLength = 0
          if (resamplingWorker) {
            resamplingWorker.postMessage({ type: 'audio', audio: interleaved.buffer }, [interleaved.buffer])
          } else {
            postAudioForWriting(interleaved.buffer)
          }
        }
        const appendAudio = (audio: Float32Array) => {
          pendingAudioChunks.push(audio)
          pendingAudioLength += audio.length
          if (pendingAudioLength >= INTERLEAVE_RESAMPLE_BATCH_SIZE_SAMPLES) flushPendingAudio()
        }
        let firstTimestampUs: number | null = null
        let framesWritten = 0
        let decodedFrames = 0
        decoder = new AudioDecoder({
          output: (audioData) => {
            try {
              throwIfAborted(signal)
              decodedFrames += audioData.numberOfFrames
              let skipFrames = 0
              if (segment) {
                firstTimestampUs ??= audioData.timestamp
                const placement = getAudioChunkPlacement(
                  audioData.timestamp,
                  firstTimestampUs,
                  audioData.numberOfFrames,
                  decoderConfig.sampleRate,
                  framesWritten,
                  leadingAudioOffsetSeconds,
                )
                skipFrames = placement.skipFrames
                let gapFrames = placement.gapFrames
                while (gapFrames > 0) {
                  const frames = Math.min(
                    gapFrames,
                    Math.max(1, Math.floor(INTERLEAVE_RESAMPLE_BATCH_SIZE_SAMPLES / channelCount)),
                  )
                  appendAudio(new Float32Array(frames * channelCount))
                  gapFrames -= frames
                }
                framesWritten += placement.gapFrames
              }
              const remainingFrames = audioData.numberOfFrames - skipFrames
              if (remainingFrames > 0) {
                appendAudio(toInterleavedAudioData(audioData, skipFrames))
                framesWritten += remainingFrames
              }
            } catch (error) {
              failure.reject(error)
            } finally {
              audioData.close()
            }
          },
          error: (error) => failure.reject(error),
        })
        decoder.configure(decoderConfig)
        encodedReader = demuxer.read('audio').getReader()
        while (true) {
          throwIfAborted(signal)
          const { done, value } = await waitFor(encodedReader.read())
          if (done) break
          while (decoder.decodeQueueSize > 200) {
            await waitFor(new Promise<void>((resolve) => setTimeout(resolve)))
          }
          decoder.decode(value)
        }
        await waitFor(decoder.flush())
        decoder.close()
        decoder = null
        if (segment && decodedFrames === 0) {
          throw new Error('The selected audio stream contains no decodable samples')
        }
        flushPendingAudio()
        resamplingWorker?.postMessage({ type: 'stop' })
        await waitFor(resamplingFinish.promise)
        writingWorker.postMessage({ type: 'stop' })
        await waitFor(writeFinish.promise)
      }

      throwIfAborted(signal)
      await ProjectManager.saveClip(clip)
      await ProjectManager.saveTrack(track)
      throwIfAborted(signal)
      onProgress?.(1)
      return track
    } catch (error) {
      // Stop workers before deleting their OPFS files. Silent sources never start PCM workers.
      if (decoder && decoder.state !== 'closed') decoder.close()
      resamplingWorker?.terminate()
      writingWorker?.terminate()
      if (track) {
        try {
          await cleanupImportedTrack(track)
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            `${error instanceof Error ? error.message : String(error)}; import cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
          )
        }
      }
      throw error
    } finally {
      signal?.removeEventListener('abort', onAbort)
      if (decoder && decoder.state !== 'closed') decoder.close()
      if (encodedReader) {
        // The demuxer owns the underlying worker. Do not await its cancellation handshake after a parser failure.
        void encodedReader.cancel().catch(() => {})
        encodedReader.releaseLock()
      }
      resamplingWorker?.terminate()
      writingWorker?.terminate()
      input?.dispose()
      demuxer.destroy()
    }
  }
}

function selectedStreamOrdinal(streams: WebAVStream[], selected: WebAVStream): number {
  const index = streams.findIndex((stream) => stream.index === selected.index)
  if (index < 0) throw new Error('Selected media stream was not found in the container stream list')
  return index + 1
}

async function copyVideoFile(
  file: File,
  directoryName: string,
  filename: string,
  signal: AbortSignal | undefined,
  onProgress: (progress: number) => void,
) {
  const writer = await FileSystemUtils.createFileWriter(directoryName, filename)
  const reader = file.stream().getReader()
  let copiedBytes = 0
  try {
    while (true) {
      throwIfAborted(signal)
      const { done, value } = await reader.read()
      if (done) break
      await writer.write(value)
      copiedBytes += value.byteLength
      onProgress(copiedBytes / file.size)
    }
    throwIfAborted(signal)
    await writer.close()
  } catch (error) {
    try {
      await writer.abort()
    } catch (abortError) {
      throw new AggregateError(
        [error, abortError],
        `${error instanceof Error ? error.message : String(error)}; video file cleanup failed: ${abortError instanceof Error ? abortError.message : String(abortError)}`,
      )
    }
    throw error
  } finally {
    try {
      await reader.cancel()
    } finally {
      reader.releaseLock()
    }
  }
}

async function cleanupImportedTrack(track: Track) {
  const clip = track.clipViews[0]?.clip
  try {
    if (clip) await ProjectManager.deleteClip(clip)
  } finally {
    await ProjectManager.deleteTrack(track)
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
}

function toInterleavedAudioData(audioData: AudioData, skipFrames: number): Float32Array {
  const frameCount = audioData.numberOfFrames - skipFrames
  const channelCount = audioData.numberOfChannels
  const interleaved = new Float32Array(frameCount * channelCount)
  if (!audioData.format?.endsWith('-planar')) {
    audioData.copyTo(interleaved, { planeIndex: 0, format: 'f32', frameOffset: skipFrames, frameCount })
    return interleaved
  }
  const plane = new Float32Array(frameCount)
  for (let channel = 0; channel < channelCount; ++channel) {
    audioData.copyTo(plane, { planeIndex: channel, format: 'f32-planar', frameOffset: skipFrames, frameCount })
    for (let frame = 0; frame < frameCount; ++frame) {
      interleaved[frame * channelCount + channel] = plane[frame]!
    }
  }
  return interleaved
}
