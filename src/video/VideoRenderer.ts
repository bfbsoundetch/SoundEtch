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
  type StreamTargetChunk,
  type VideoCodec,
} from 'mediabunny'
import { registerAacEncoder } from '@mediabunny/aac-encoder'
import { ProjectManager } from '../project/ProjectManager'
import { Track } from '../project/Track'
import type { SelectedRegion } from '../playback/Player'
import { createRenderingArgument } from '../rendering/RenderingArgumentFactory'
import { RenderingEncodingPortMessage, RenderingWorkerStartMessage } from '../rendering/RenderingWorkerProtocol'
import { OscilloscopeFrames } from './OscilloscopeFrames'

export type VideoExportPresetName = 'youtube' | 'tiktok'

type VideoExportPreset = {
  label: string
  shapeName: string
  width: number
  height: number
  frameRate: number
  videoBitrate: number
}

const AUDIO_BITRATE = 192_000

export const VIDEO_EXPORT_PRESETS: Record<VideoExportPresetName, VideoExportPreset> = {
  youtube: {
    label: 'YouTube',
    shapeName: 'hamburger',
    width: 1920,
    height: 1080,
    frameRate: 60,
    videoBitrate: 12_000_000,
  },
  tiktok: {
    label: 'TikTok',
    shapeName: 'hotdog',
    width: 1080,
    height: 1920,
    frameRate: 60,
    videoBitrate: 12_000_000,
  },
}

export class VideoRenderer {
  private static cancelExportCallback: (() => void) | null = null
  private static aacEncoderRegistered = false

  static async exportProject(presetName: VideoExportPresetName, selectedRegion: SelectedRegion | null) {
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
    let output: Output | null = null

    VideoRenderer.cancelExportCallback = () => abortController.abort()

    try {
      VideoRenderer.setProcessingProgress(0.01)

      const channelCount = VideoRenderer.getOutputChannelCount(tracks)
      const videoCodec = await VideoRenderer.getVideoCodec(preset)
      await VideoRenderer.ensureAacEncoder(channelCount, project.sampleRate)
      VideoRenderer.throwIfAborted(signal)

      const writable = await file.createWritable()
      const canvas = document.createElement('canvas')
      canvas.width = preset.width
      canvas.height = preset.height
      const context = canvas.getContext('2d')
      if (!context) {
        throw new Error('Could not create a canvas context for video rendering')
      }

      const videoSource = new CanvasSource(canvas, {
        codec: videoCodec,
        bitrate: preset.videoBitrate,
        keyFrameInterval: 2,
      })
      const audioSource = new AudioSampleSource({
        codec: 'aac',
        bitrate: AUDIO_BITRATE,
        bitrateMode: 'variable',
      })

      output = new Output({
        format: new Mp4OutputFormat(),
        target: new StreamTarget(writable as unknown as WritableStream<StreamTargetChunk>, {
          chunked: true,
          chunkSize: 2 ** 20,
        }),
      })
      output.addVideoTrack(videoSource, {
        frameRate: preset.frameRate,
        name: `${preset.label} visual`,
      })
      output.addAudioTrack(audioSource, { name: 'Project audio' })
      output.setMetadataTags({ title: project.title })

      await output.start()
      VideoRenderer.setProcessingProgress(0.05)

      const argument = createRenderingArgument(project, channelCount, startPosition, projectLength, tracks)
      const scope = new OscilloscopeFrames(project.sampleRate, preset.frameRate, projectLength, channelCount)
      const duration = projectLength / project.sampleRate
      const trackNames = tracks.map((track) => track.name)
      await VideoRenderer.pipeRenderedAudioToSource(argument, audioSource, signal, async (audio) => {
        await scope.addAudio(audio, async (samples, sampleCount, frame) => {
          VideoRenderer.throwIfAborted(signal)
          const timestamp = frame / preset.frameRate
          const frameDuration = Math.min(1 / preset.frameRate, duration - timestamp)
          VideoRenderer.drawFrame(context, preset, samples, sampleCount, trackNames)
          await videoSource.add(timestamp, frameDuration, { keyFrame: frame % (preset.frameRate * 2) === 0 })
          // Report completed video work within each audio chunk; leave 5% for finalization.
          VideoRenderer.setProcessingProgress(0.05 + 0.9 * Math.min(1, (timestamp + frameDuration) / duration))
        })
      })
      videoSource.close()

      VideoRenderer.throwIfAborted(signal)
      await output.finalize()
      VideoRenderer.setProcessingProgress(1)
    } catch (error) {
      if (output && output.state !== 'canceled' && output.state !== 'finalized') {
        await output.cancel().catch(() => {})
      }
      throw error
    } finally {
      VideoRenderer.cancelExportCallback = null
    }
  }

  static cancelExport() {
    VideoRenderer.cancelExportCallback?.()
  }

  private static async pipeRenderedAudioToSource(
    argument: RenderingWorkerStartMessage['argument'],
    audioSource: AudioSampleSource,
    signal: AbortSignal,
    onAudio: (audio: Float32Array) => Promise<void>,
  ): Promise<void> {
    const renderingWorker = new Worker('./assets/renderingWorker.js', { type: 'module' })
    const channel = new MessageChannel()
    let queue = Promise.resolve()
    let writtenFrames = 0
    let finished = false

    return await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        channel.port1.close()
        renderingWorker.terminate()
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
      const abort = () => fail(new Error('Video export canceled'))

      signal.addEventListener('abort', abort, { once: true })
      renderingWorker.onerror = (error) => fail(error)
      renderingWorker.onmessageerror = (error) => fail(error)

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
              return
            }

            audioSource.close()
            complete()
          })
          .catch(fail)
      }
      channel.port1.start()

      const startMessage: RenderingWorkerStartMessage = {
        argument,
        encodingPort: channel.port2,
      }
      renderingWorker.postMessage(startMessage, [channel.port2])
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

  private static drawFrame(
    context: CanvasRenderingContext2D,
    preset: VideoExportPreset,
    samples: Float32Array,
    sampleCount: number,
    trackNames: Array<string>,
  ) {
    const width = preset.width
    const height = preset.height
    const left = width * 0.07
    const right = width * 0.93
    const center = height * 0.52
    const amplitudeScale = height * (width > height ? 0.28 : 0.22)
    let peak = 0
    for (let i = 0; i < sampleCount; ++i) {
      peak = Math.max(peak, Math.abs(samples[i]))
    }

    const background = context.createLinearGradient(0, 0, width, height)
    background.addColorStop(0, '#111827')
    background.addColorStop(0.48, '#1e1b4b')
    background.addColorStop(1, '#020617')
    context.fillStyle = background
    context.fillRect(0, 0, width, height)
    VideoRenderer.drawGlow(context, width, height, Math.min(1, peak))

    context.save()
    context.strokeStyle = 'rgba(148, 163, 184, 0.15)'
    context.lineWidth = 1
    context.beginPath()
    for (let division = 0; division <= 10; ++division) {
      const x = left + ((right - left) * division) / 10
      context.moveTo(x, center - amplitudeScale)
      context.lineTo(x, center + amplitudeScale)
    }
    for (let division = -4; division <= 4; ++division) {
      const y = center + (amplitudeScale * division) / 4
      context.moveTo(left, y)
      context.lineTo(right, y)
    }
    context.stroke()
    context.strokeStyle = 'rgba(148, 163, 184, 0.4)'
    context.beginPath()
    context.moveTo(left, center)
    context.lineTo(right, center)
    context.stroke()
    context.restore()

    VideoRenderer.drawOscilloscope(context, samples, sampleCount, left, right, center, amplitudeScale, height)
    VideoRenderer.drawTrackNames(context, width, height, trackNames)

    context.save()
    const fontSize = Math.round(Math.min(width, height) * 0.021)
    context.font = `${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, sans-serif`
    context.fillStyle = 'rgba(203, 213, 225, 0.7)'
    context.textAlign = 'right'
    context.textBaseline = 'middle'
    context.fillText('+1', left - fontSize * 0.6, center - amplitudeScale)
    context.fillText('0', left - fontSize * 0.6, center)
    context.fillText('−1', left - fontSize * 0.6, center + amplitudeScale)
    context.restore()
  }

  private static drawGlow(context: CanvasRenderingContext2D, width: number, height: number, amplitude: number) {
    context.save()
    context.globalCompositeOperation = 'lighter'
    const radius = Math.max(width, height) * (0.28 + amplitude * 0.12)
    const gradient = context.createRadialGradient(width * 0.5, height * 0.5, 0, width * 0.5, height * 0.5, radius)
    gradient.addColorStop(0, `rgba(56, 189, 248, ${0.18 + amplitude * 0.2})`)
    gradient.addColorStop(0.45, `rgba(168, 85, 247, ${0.12 + amplitude * 0.18})`)
    gradient.addColorStop(1, 'rgba(15, 23, 42, 0)')
    context.fillStyle = gradient
    context.fillRect(0, 0, width, height)
    context.restore()
  }

  private static drawOscilloscope(
    context: CanvasRenderingContext2D,
    samples: Float32Array,
    sampleCount: number,
    left: number,
    right: number,
    center: number,
    amplitudeScale: number,
    height: number,
  ) {
    context.save()
    // Keep a fixed full-scale display; do not normalize away gain changes or invent signal outside the window.
    context.beginPath()
    context.rect(left, center - amplitudeScale, right - left, amplitudeScale * 2)
    context.clip()
    context.lineJoin = 'round'
    context.lineCap = 'round'
    context.beginPath()
    const step = (right - left) / Math.max(1, sampleCount - 1)
    for (let i = 0; i < sampleCount; ++i) {
      const x = left + i * step
      const y = center - samples[i] * amplitudeScale
      if (i === 0) {
        context.moveTo(x, y)
      } else {
        context.lineTo(x, y)
      }
    }
    if (sampleCount === 1) {
      context.lineTo(right, center - samples[0] * amplitudeScale)
    }
    context.shadowColor = 'rgba(34, 211, 238, 0.8)'
    context.shadowBlur = Math.max(6, height * 0.008)
    context.strokeStyle = '#7dd3fc'
    context.lineWidth = Math.max(2, height * 0.002)
    context.stroke()
    context.restore()
  }

  private static drawTrackNames(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    trackNames: Array<string>,
  ) {
    const fontSize = Math.round(Math.min(width, height) * 0.023)
    const rowHeight = fontSize * 1.65
    const paddingX = fontSize * 0.75
    const left = width * 0.07
    const right = width * 0.93
    let x = left
    let y = height * 0.08

    context.save()
    context.textBaseline = 'middle'
    context.font = `600 ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, sans-serif`
    for (let index = 0; index < Math.min(8, trackNames.length); ++index) {
      const text = VideoRenderer.truncateText(trackNames[index], 34)
      const pillWidth = context.measureText(text).width + paddingX * 2
      if (x + pillWidth > right && x > left) {
        x = left
        y += rowHeight * 1.25
      }
      if (y + rowHeight > height * 0.22) {
        break
      }
      context.beginPath()
      context.roundRect(x, y - rowHeight * 0.45, pillWidth, rowHeight * 0.9, rowHeight * 0.45)
      context.fillStyle = 'rgba(15, 23, 42, 0.5)'
      context.fill()
      context.fillStyle = 'rgba(226, 232, 240, 0.8)'
      context.fillText(text, x + paddingX, y)
      x += pillWidth + paddingX
    }
    context.restore()
  }

  private static truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text
    }
    return `${text.slice(0, Math.max(0, maxLength - 3))}...`
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
    const options = { numberOfChannels: channelCount, sampleRate, bitrate: AUDIO_BITRATE }
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
    if (signal.aborted) {
      throw new Error('Video export canceled')
    }
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
