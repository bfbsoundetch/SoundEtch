import {
  AudioSample,
  AudioSampleSource,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  canEncodeAudio,
  canEncodeVideo,
  getFirstEncodableVideoCodec,
  type AudioEncodingConfig,
  type StreamTargetChunk,
  type VideoCodec,
} from 'mediabunny'
import { registerAacEncoder } from '@mediabunny/aac-encoder'
import { ProjectManager } from '../project/ProjectManager'
import type { Project } from '../project/Project'
import { Track } from '../project/Track'
import type { SelectedRegion } from '../playback/Player'
import { createRenderingArgument } from '../rendering/RenderingArgumentFactory'
import { Renderer, type AudioSourceWorker } from '../rendering/Renderer'
import {
  RenderingArgument,
  RenderingConsumerPortMessage,
  RenderingEncodingPortMessage,
  RenderingOutputWorkerMessage,
  RenderingWorkerStartMessage,
} from '../rendering/RenderingWorkerProtocol'
import { measureAacEncoderDelay } from './AacEncoderTiming'
import { setMp4PresentationWindow } from './Mp4PresentationWindow'
import { OutputVideoCompositor } from './OutputVideoCompositor'
import { VideoFrameClock } from './VideoFrameClock'

export type VideoExportPresetName = 'youtube' | 'tiktok'

type VideoExportPreset = {
  label: string
  width: number
  height: number
  frameRate: number
  videoBitrate: number
}

const AUDIO_ENCODING_CONFIG = {
  codec: 'aac',
  bitrate: 192_000,
  bitrateMode: 'variable',
} satisfies AudioEncodingConfig

export const VIDEO_EXPORT_PRESETS: Record<VideoExportPresetName, VideoExportPreset> = {
  youtube: {
    label: 'YouTube',
    width: 1920,
    height: 1080,
    frameRate: 60,
    videoBitrate: 12_000_000,
  },
  tiktok: {
    label: 'TikTok',
    width: 1080,
    height: 1920,
    frameRate: 60,
    videoBitrate: 12_000_000,
  },
}

export class VideoRenderer {
  private static cancelExportCallback: (() => void) | null = null
  private static aacEncoderRegistered = false

  static async exportProject(
    presetName: VideoExportPresetName,
    selectedRegion: SelectedRegion | null,
    loudnessTargetLufs: number | null,
  ) {
    const preset = VIDEO_EXPORT_PRESETS[presetName]
    const project = await ProjectManager.getActiveProject()
    const tracks = selectedRegion?.tracks ?? project.getTracks()
    const projectLength = selectedRegion
      ? selectedRegion.endSample - selectedRegion.startSample
      : tracks.reduce((maxLength, track) => Math.max(maxLength, track.length), 0)
    const startPosition = selectedRegion?.startSample ?? 0

    if (projectLength <= 0 || tracks.length === 0) {
      throw new Error('Cannot export a video for an empty project')
    }

    const file = await showSaveFilePicker({
      startIn: 'downloads',
      suggestedName: VideoRenderer.getSuggestedFilename(project.title, presetName),
      types: [
        {
          description: 'MP4 video',
          accept: { 'video/mp4': ['.mp4'] },
        },
      ],
    } as any)

    const abortController = new AbortController()
    const signal = abortController.signal

    // Renderer.cancelRender() stops a running loudness-measuring pass; it is a no-op otherwise.
    VideoRenderer.cancelExportCallback = () => {
      abortController.abort(new DOMException('Video export canceled', 'AbortError'))
      Renderer.cancelRender()
    }

    try {
      VideoRenderer.setProcessingProgress(0.01)

      const channelCount = VideoRenderer.getOutputChannelCount(tracks)
      const videoCodec = await VideoRenderer.getVideoCodec(preset)
      await VideoRenderer.ensureAacEncoder(channelCount, project.sampleRate)
      const audioDelay = await measureAacEncoderDelay(AUDIO_ENCODING_CONFIG, project.sampleRate, channelCount, signal)
      VideoRenderer.throwIfAborted(signal)

      const argument = createRenderingArgument(
        project,
        channelCount,
        startPosition,
        projectLength,
        tracks,
        project.outputEffects,
      )
      const writeVideo = (createSource: () => AudioSourceWorker) =>
        VideoRenderer.writeVideo(file, preset, project, argument, videoCodec, audioDelay, createSource, signal)
      if (loudnessTargetLufs === null) {
        await writeVideo(() => Renderer.createRenderingSource(argument))
      } else {
        await Renderer.withLoudnessNormalizedSource(
          argument,
          loudnessTargetLufs,
          `Publishing ${preset.label} video...`,
          writeVideo,
        )
      }
    } catch (error) {
      if (signal.aborted) throw signal.reason
      throw error
    } finally {
      VideoRenderer.cancelExportCallback = null
    }
  }

  static cancelExport() {
    VideoRenderer.cancelExportCallback?.()
  }

  private static async writeVideo(
    file: FileSystemFileHandle,
    preset: VideoExportPreset,
    project: Project,
    argument: RenderingArgument,
    videoCodec: VideoCodec,
    audioDelay: number,
    createSource: () => AudioSourceWorker,
    signal: AbortSignal,
  ): Promise<void> {
    let output: Output | null = null
    let writable: FileSystemWritableFileStream | null = null
    let compositor: OutputVideoCompositor | null = null
    const movieMetadata: { data: Uint8Array | null; position: number } = { data: null, position: 0 }

    try {
      VideoRenderer.throwIfAborted(signal)
      writable = await file.createWritable()
      VideoRenderer.throwIfAborted(signal)
      const canvas = document.createElement('canvas')
      canvas.width = preset.width
      canvas.height = preset.height
      const context = canvas.getContext('2d')
      if (!context) {
        throw new Error('Could not create a canvas context for video rendering')
      }
      compositor = new OutputVideoCompositor(project, context, preset.width, preset.height, signal)

      const videoSource = new CanvasSource(canvas, {
        codec: videoCodec,
        bitrate: preset.videoBitrate,
        keyFrameInterval: 2,
      })
      const audioSource = new AudioSampleSource(AUDIO_ENCODING_CONFIG)

      output = new Output({
        format: new Mp4OutputFormat({
          fastStart: false,
          onMoov: (data, position) => {
            movieMetadata.data = data
            movieMetadata.position = position
          },
        }),
        // StreamTarget closes even on cancellation. Keep the file transaction open until successful finalization.
        target: new StreamTarget(new WritableStream<StreamTargetChunk>({ write: (chunk) => writable!.write(chunk) }), {
          chunked: true,
          chunkSize: 2 ** 20,
        }),
      })
      // Keep the muxer's fine-grained default timescale: 60 ticks rounds a partial final frame up.
      output.addVideoTrack(videoSource, {
        name: 'Output scenes',
      })
      output.addAudioTrack(audioSource, { name: 'Project audio' })
      output.setMetadataTags({ title: project.title })

      await output.start()
      VideoRenderer.setProcessingProgress(0.05)

      const clock = new VideoFrameClock(argument.sampleRate, preset.frameRate, argument.length, argument.startPosition)
      const duration = argument.length / argument.sampleRate
      const composition = compositor
      await VideoRenderer.pipeRenderedAudioToSource(createSource(), argument, audioSource, signal, async (audio) => {
        await clock.addSamples(
          audio.length / argument.channelCount,
          async (frame, timestamp, frameDuration, sample) => {
            VideoRenderer.throwIfAborted(signal)
            await composition.drawFrame(sample)
            VideoRenderer.throwIfAborted(signal)
            await videoSource.add(timestamp, frameDuration, { keyFrame: frame % (preset.frameRate * 2) === 0 })
            VideoRenderer.setProcessingProgress(0.05 + 0.9 * Math.min(1, (timestamp + frameDuration) / duration))
          },
        )
      })
      videoSource.close()

      VideoRenderer.throwIfAborted(signal)
      await output.finalize()
      VideoRenderer.throwIfAborted(signal)
      if (!movieMetadata.data) throw new Error('Video export did not produce MP4 metadata')
      const metadata = setMp4PresentationWindow(movieMetadata.data, duration, audioDelay)
      await writable.write({ type: 'write', position: movieMetadata.position, data: metadata })
      await writable.truncate(movieMetadata.position + metadata.byteLength)
      VideoRenderer.throwIfAborted(signal)
      await writable.close()
      VideoRenderer.setProcessingProgress(1)
    } catch (error) {
      if (output && output.state !== 'canceled' && output.state !== 'finalized') {
        await output.cancel().catch(() => {})
      }
      await writable?.abort().catch(() => {})
      throw error
    } finally {
      compositor?.dispose()
    }
  }

  private static async pipeRenderedAudioToSource(
    source: AudioSourceWorker,
    argument: RenderingArgument,
    audioSource: AudioSampleSource,
    signal: AbortSignal,
    onAudio: (audio: Float32Array) => Promise<void>,
  ): Promise<void> {
    if (signal.aborted) {
      source.worker.terminate()
      VideoRenderer.throwIfAborted(signal)
    }
    const channel = new MessageChannel()
    let queue = Promise.resolve()
    let writtenFrames = 0
    let finished = false

    return await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        channel.port1.close()
        source.worker.terminate()
        signal.removeEventListener('abort', abort)
      }
      const fail = (error: unknown) => {
        if (finished) {
          return
        }
        finished = true
        cleanup()
        reject(VideoRenderer.toError(error))
      }
      const complete = () => {
        if (finished) {
          return
        }
        finished = true
        cleanup()
        resolve()
      }
      const abort = () => fail(signal.reason)

      signal.addEventListener('abort', abort, { once: true })
      source.worker.onerror = (error) => fail(error)
      source.worker.onmessageerror = (error) => fail(error)
      source.worker.onmessage = (e: MessageEvent<RenderingOutputWorkerMessage | undefined>) => {
        if (e.data?.error) {
          fail(new Error(String(e.data.error)))
        }
      }

      channel.port1.onmessage = (portEvent) => {
        const message = portEvent.data as RenderingEncodingPortMessage
        queue = queue
          .then(async () => {
            VideoRenderer.throwIfAborted(signal)
            if (message.type === 'audio') {
              const audio = new Float32Array(message.buffer, 0, message.length)
              await Promise.all([
                VideoRenderer.addAudioChunkToSource(audio, audioSource, argument, writtenFrames),
                onAudio(audio),
              ])
              writtenFrames += message.length / argument.channelCount
              channel.port1.postMessage({ type: 'consumed' } satisfies RenderingConsumerPortMessage)
              return
            }

            if (writtenFrames !== argument.length)
              throw new Error('Audio rendering ended before the export was complete')
            audioSource.close()
            complete()
          })
          .catch(fail)
      }
      channel.port1.start()

      source.worker.postMessage({ ...source.startMessage, encodingPort: channel.port2, waitForConsumer: true }, [
        channel.port2,
      ])
    })
  }

  private static async addAudioChunkToSource(
    audio: Float32Array,
    audioSource: AudioSampleSource,
    argument: RenderingWorkerStartMessage['argument'],
    startFrame: number,
  ) {
    if (audio.length === 0) {
      return
    }

    const sample = new AudioSample({
      data: audio,
      format: 'f32',
      numberOfChannels: argument.channelCount,
      sampleRate: argument.sampleRate,
      timestamp: startFrame / argument.sampleRate,
    })
    try {
      await audioSource.add(sample)
    } finally {
      sample.close()
    }
  }

  private static async getVideoCodec(preset: VideoExportPreset): Promise<VideoCodec> {
    const options = { width: preset.width, height: preset.height, bitrate: preset.videoBitrate }
    if (await canEncodeVideo('avc', options)) {
      return 'avc'
    }

    const fallback = await getFirstEncodableVideoCodec(['vp9', 'av1', 'hevc'], options)
    if (!fallback) {
      throw new Error('No MP4-compatible video encoder is available in this browser')
    }
    return fallback
  }

  private static async ensureAacEncoder(channelCount: number, sampleRate: number) {
    const options = { numberOfChannels: channelCount, sampleRate, bitrate: AUDIO_ENCODING_CONFIG.bitrate }
    if (await canEncodeAudio('aac', options)) {
      return
    }

    if (!VideoRenderer.aacEncoderRegistered) {
      registerAacEncoder()
      VideoRenderer.aacEncoderRegistered = true
    }

    if (!(await canEncodeAudio('aac', options))) {
      throw new Error('No AAC encoder is available for MP4 video export')
    }
  }

  private static getOutputChannelCount(tracks: Array<Track>): number {
    return tracks.some((track) => track.getChannelCount() === 2) ? 2 : 1
  }

  private static getSuggestedFilename(projectTitle: string, presetName: VideoExportPresetName): string {
    const safeTitle = (projectTitle || 'soundetch').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'soundetch'
    return `${safeTitle}-${presetName}.mp4`
  }

  private static setProcessingProgress(progress: number) {
    ;(window as any).processingModalController?.setProgress(progress)
  }

  private static throwIfAborted(signal: AbortSignal) {
    signal.throwIfAborted()
  }

  private static toError(error: unknown): Error {
    if (error instanceof Error) {
      return error
    }
    if (error instanceof ErrorEvent) {
      return new Error(error.message)
    }
    return new Error(String(error))
  }
}
