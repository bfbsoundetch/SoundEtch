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
import { Project } from '../project/Project'
import { ProjectManager } from '../project/ProjectManager'
import { Track } from '../project/Track'
import { SummaryGenerator } from '../project/SummaryGenerator'
import { SelectedRegion } from '../playback/Player'
import { createRenderingArgument } from '../rendering/RenderingArgumentFactory'
import { RenderingEncodingPortMessage, RenderingWorkerStartMessage } from '../rendering/RenderingWorkerProtocol'

export type VideoExportPresetName = 'youtube' | 'tiktok'

type VideoExportPreset = {
  label: string
  shapeName: string
  width: number
  height: number
  frameRate: number
  videoBitrate: number
}

type VideoVisualData = {
  mixColumns: Float32Array
  tracks: Array<TrackVisualData>
}

type TrackVisualData = {
  name: string
  columns: Float32Array
}

const AUDIO_BITRATE = 192_000
const VISUAL_COLUMN_CAP = 2400

export const VIDEO_EXPORT_PRESETS: Record<VideoExportPresetName, VideoExportPreset> = {
  youtube: {
    label: 'YouTube',
    shapeName: 'hamburger',
    width: 1920,
    height: 1080,
    frameRate: 30,
    videoBitrate: 8_000_000,
  },
  tiktok: {
    label: 'TikTok',
    shapeName: 'hotdog',
    width: 1080,
    height: 1920,
    frameRate: 30,
    videoBitrate: 8_000_000,
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
      const visualData = await VideoRenderer.createVisualData(
        project,
        startPosition,
        projectLength,
        tracks,
        preset,
        signal,
      )
      VideoRenderer.setProcessingProgress(0.05)

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

      let audioProgress = 0
      let videoProgress = 0
      const updateProgress = () => {
        VideoRenderer.setProcessingProgress(0.05 + 0.95 * (audioProgress * 0.45 + videoProgress * 0.55))
      }

      const argument = createRenderingArgument(project, channelCount, startPosition, projectLength, tracks)
      await Promise.all([
        VideoRenderer.pipeRenderedAudioToSource(argument, audioSource, signal, (progress) => {
          audioProgress = progress
          updateProgress()
        }),
        VideoRenderer.renderVideoFrames(
          project,
          preset,
          visualData,
          videoSource,
          context,
          projectLength,
          signal,
          (progress) => {
            videoProgress = progress
            updateProgress()
          },
        ),
      ])

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

  private static async createVisualData(
    project: Project,
    startPosition: number,
    projectLength: number,
    tracks: Array<Track>,
    preset: VideoExportPreset,
    signal: AbortSignal,
  ): Promise<VideoVisualData> {
    const columnCount = Math.min(preset.width, VISUAL_COLUMN_CAP)
    const samplesPerColumn = Math.max(1, Math.ceil(projectLength / columnCount))
    const trackVisuals = tracks.map((track) => {
      return {
        name: track.name,
        columns: new Float32Array(columnCount),
      }
    })
    const projectEnd = startPosition + projectLength

    for (let trackIndex = 0; trackIndex < tracks.length; ++trackIndex) {
      const track = tracks[trackIndex]
      const trackColumns = trackVisuals[trackIndex].columns
      VideoRenderer.throwIfAborted(signal)
      for (const clipView of track.clipViews) {
        const visibleStart = Math.max(startPosition, clipView.startPosition)
        const visibleEnd = Math.min(projectEnd, clipView.getEndPosition())
        if (visibleEnd <= visibleStart) {
          continue
        }

        const clipStart = clipView.offset + visibleStart - clipView.startPosition
        const clipEnd = clipView.offset + visibleEnd - clipView.startPosition
        const summary = await SummaryGenerator.summarizeClipChannel(
          clipView.clip,
          Math.max(0, clipStart),
          Math.min(clipView.clip.length, clipEnd),
          samplesPerColumn,
        )
        const startColumn = Math.floor((visibleStart - startPosition) / samplesPerColumn)
        const trackGain = project.isTrackAudible(track) ? Math.max(0, track.getGain()) : 0

        for (let channel = 0; channel < summary.length; ++channel) {
          const channelSummary = summary[channel]
          if (!channelSummary) {
            continue
          }
          for (let i = 0; i < channelSummary.length; i += 2) {
            const column = startColumn + i / 2
            if (column < 0 || column >= trackColumns.length) {
              continue
            }
            const amplitude = Math.max(Math.abs(channelSummary[i] ?? 0), Math.abs(channelSummary[i + 1] ?? 0))
            trackColumns[column] = Math.max(trackColumns[column], Math.min(1, amplitude * trackGain))
          }
        }
      }
    }

    const mixColumns = new Float32Array(columnCount)
    for (const trackVisual of trackVisuals) {
      for (let i = 0; i < mixColumns.length; ++i) {
        mixColumns[i] = Math.max(mixColumns[i], trackVisual.columns[i])
      }
    }

    let peak = 0
    for (const value of mixColumns) {
      peak = Math.max(peak, value)
    }

    const normalization = Math.max(0.15, peak)
    for (let i = 0; i < mixColumns.length; ++i) {
      mixColumns[i] = Math.min(1, mixColumns[i] / normalization)
    }
    for (const trackVisual of trackVisuals) {
      for (let i = 0; i < trackVisual.columns.length; ++i) {
        trackVisual.columns[i] = Math.min(1, trackVisual.columns[i] / normalization)
      }
    }

    return { mixColumns, tracks: trackVisuals }
  }

  private static async pipeRenderedAudioToSource(
    argument: RenderingWorkerStartMessage['argument'],
    audioSource: AudioSampleSource,
    signal: AbortSignal,
    onProgress: (progress: number) => void,
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
              await VideoRenderer.addAudioChunkToSource(message, audioSource, argument, writtenFrames)
              writtenFrames += message.length / argument.channelCount
              onProgress(Math.min(1, writtenFrames / argument.length))
              return
            }

            audioSource.close()
            onProgress(1)
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
    message: Extract<RenderingEncodingPortMessage, { type: 'audio' }>,
    audioSource: AudioSampleSource,
    argument: RenderingWorkerStartMessage['argument'],
    startFrame: number,
  ) {
    if (message.length === 0) {
      return
    }

    const audio = new Float32Array(message.buffer, 0, message.length)
    const sample = new AudioSample({
      data: audio,
      format: 'f32',
      numberOfChannels: argument.channelCount,
      sampleRate: argument.sampleRate,
      timestamp: startFrame / argument.sampleRate,
    })
    await audioSource.add(sample)
    sample.close()
  }

  private static async renderVideoFrames(
    project: Project,
    preset: VideoExportPreset,
    visualData: VideoVisualData,
    videoSource: CanvasSource,
    context: CanvasRenderingContext2D,
    projectLength: number,
    signal: AbortSignal,
    onProgress: (progress: number) => void,
  ) {
    const duration = projectLength / project.sampleRate
    const frameDuration = 1 / preset.frameRate
    const frameCount = Math.max(1, Math.ceil(duration * preset.frameRate))

    for (let frame = 0; frame < frameCount; ++frame) {
      VideoRenderer.throwIfAborted(signal)
      const timestamp = frame / preset.frameRate
      const actualDuration = Math.min(frameDuration, Math.max(0, duration - timestamp))
      if (actualDuration <= 0) {
        break
      }

      VideoRenderer.drawFrame(context, preset, visualData, timestamp, duration)
      if (frame % Math.round(preset.frameRate * 2) === 0) {
        await videoSource.add(timestamp, actualDuration, { keyFrame: true })
      } else {
        await videoSource.add(timestamp, actualDuration)
      }
      onProgress((frame + 1) / frameCount)
    }

    videoSource.close()
    onProgress(1)
  }

  private static drawFrame(
    context: CanvasRenderingContext2D,
    preset: VideoExportPreset,
    visualData: VideoVisualData,
    timestamp: number,
    duration: number,
  ) {
    const width = preset.width
    const height = preset.height
    const progress = duration <= 0 ? 0 : Math.min(1, timestamp / duration)
    const currentColumn = VideoRenderer.getColumnForProgress(visualData.mixColumns, progress)
    const loudestTrackIndex = VideoRenderer.getLoudestTrackIndex(visualData, currentColumn)
    const currentAmplitude = VideoRenderer.getSmoothedAmplitude(visualData.mixColumns, currentColumn, 4)

    context.clearRect(0, 0, width, height)
    const background = context.createLinearGradient(0, 0, width, height)
    background.addColorStop(0, '#111827')
    background.addColorStop(0.48, '#1e1b4b')
    background.addColorStop(1, '#020617')
    context.fillStyle = background
    context.fillRect(0, 0, width, height)

    VideoRenderer.drawGrid(context, width, height, timestamp)
    VideoRenderer.drawGlow(context, width, height, currentAmplitude)
    VideoRenderer.drawFastOscilloscope(context, width, height, visualData, progress, timestamp, loudestTrackIndex)
    VideoRenderer.drawSpectralBars(context, width, height, visualData, progress, timestamp)
    VideoRenderer.drawTrackNames(context, width, height, visualData, currentColumn, loudestTrackIndex)
  }

  private static drawGrid(context: CanvasRenderingContext2D, width: number, height: number, timestamp: number) {
    context.save()
    context.strokeStyle = 'rgba(148, 163, 184, 0.12)'
    context.lineWidth = 1
    const spacing = Math.max(48, Math.min(width, height) / 12)
    const offset = (timestamp * spacing * 0.8) % spacing
    context.beginPath()
    for (let x = -spacing + offset; x < width + spacing; x += spacing) {
      context.moveTo(x, 0)
      context.lineTo(x, height)
    }
    for (let y = -spacing; y < height + spacing; y += spacing) {
      context.moveTo(0, y)
      context.lineTo(width, y)
    }
    context.stroke()
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

  private static drawFastOscilloscope(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    visualData: VideoVisualData,
    progress: number,
    timestamp: number,
    loudestTrackIndex: number,
  ) {
    const left = width * 0.07
    const right = width * 0.93
    const scopeWidth = right - left
    const center = height * (width > height ? 0.49 : 0.45)
    const amplitudeScale = height * (width > height ? 0.25 : 0.2)
    const columns = loudestTrackIndex >= 0 ? visualData.tracks[loudestTrackIndex].columns : visualData.mixColumns
    const currentColumn = VideoRenderer.getColumnForProgress(columns, progress)
    const windowColumns = Math.max(18, Math.min(96, Math.round(columns.length * 0.035)))
    const points = width > height ? 760 : 540

    context.save()
    context.lineJoin = 'round'
    context.lineCap = 'round'

    context.strokeStyle = 'rgba(148, 163, 184, 0.18)'
    context.lineWidth = Math.max(1, height * 0.0012)
    context.beginPath()
    context.moveTo(left, center)
    context.lineTo(right, center)
    context.stroke()

    context.beginPath()
    for (let i = 0; i < points; ++i) {
      const normalized = i / (points - 1)
      const sourceIndex = Math.round(currentColumn + (normalized - 0.5) * windowColumns)
      const envelope = VideoRenderer.getSmoothedAmplitude(columns, sourceIndex, 2)
      const mixEnvelope = VideoRenderer.getSmoothedAmplitude(visualData.mixColumns, sourceIndex, 2)
      const amplitude = Math.max(envelope, mixEnvelope * 0.35)
      const carrier = Math.sin(i * 0.18 + timestamp * 42)
      const harmonic = Math.sin(i * 0.047 - timestamp * 27) * 0.38
      const jitter = Math.sin(i * 0.011 + timestamp * 91) * 0.12
      const x = left + normalized * scopeWidth
      const y = center + (carrier + harmonic + jitter) * amplitude * amplitudeScale
      if (i === 0) {
        context.moveTo(x, y)
      } else {
        context.lineTo(x, y)
      }
    }

    context.shadowColor = 'rgba(34, 211, 238, 0.95)'
    context.shadowBlur = Math.max(18, height * 0.025)
    context.strokeStyle = 'rgba(125, 211, 252, 0.92)'
    context.lineWidth = Math.max(3, height * 0.005)
    context.stroke()

    context.shadowBlur = 0
    context.strokeStyle = 'rgba(244, 114, 182, 0.68)'
    context.lineWidth = Math.max(1.5, height * 0.002)
    context.beginPath()
    for (let i = 0; i < points; ++i) {
      const normalized = i / (points - 1)
      const sourceIndex = Math.round(currentColumn + (normalized - 0.5) * windowColumns * 0.7)
      const amplitude = VideoRenderer.getSmoothedAmplitude(visualData.mixColumns, sourceIndex, 3)
      const x = left + normalized * scopeWidth
      const y = center + Math.sin(i * 0.13 - timestamp * 54) * amplitude * amplitudeScale * 0.62
      if (i === 0) {
        context.moveTo(x, y)
      } else {
        context.lineTo(x, y)
      }
    }
    context.stroke()
    context.restore()
  }

  private static drawSpectralBars(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    visualData: VideoVisualData,
    progress: number,
    timestamp: number,
  ) {
    const columns = visualData.mixColumns
    const barCount = width > height ? 84 : 52
    const bandWidth = width * 0.76
    const left = (width - bandWidth) / 2
    const baseline = height * (width > height ? 0.82 : 0.76)
    const maxHeight = height * (width > height ? 0.16 : 0.24)
    const playheadColumn = progress * (columns.length - 1)

    context.save()
    context.globalCompositeOperation = 'lighter'
    for (let i = 0; i < barCount; ++i) {
      const normalizedPosition = i / Math.max(1, barCount - 1)
      const wobble = Math.sin(timestamp * 9 + i * 0.47) * 2
      const relativeIndex = (normalizedPosition - 0.5) * barCount * 0.9 + wobble
      const sourceIndex = Math.min(columns.length - 1, Math.max(0, Math.round(playheadColumn + relativeIndex)))
      const amplitude = columns[sourceIndex] ?? 0
      const easedAmplitude = Math.pow(amplitude, 0.72)
      const barHeight = Math.max(3, easedAmplitude * maxHeight)
      const x = left + normalizedPosition * bandWidth
      const barWidth = Math.max(4, bandWidth / barCount / 2)
      const hue = 185 + normalizedPosition * 120
      context.fillStyle = `hsla(${hue}, 95%, ${58 + easedAmplitude * 20}%, ${0.28 + easedAmplitude * 0.54})`
      context.fillRect(x - barWidth / 2, baseline - barHeight / 2, barWidth, barHeight)
    }
    context.restore()
  }

  private static drawTrackNames(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    visualData: VideoVisualData,
    currentColumn: number,
    loudestTrackIndex: number,
  ) {
    if (loudestTrackIndex < 0 || visualData.tracks.length === 0) {
      return
    }

    const visibleTrackIndexes = VideoRenderer.getVisibleTrackIndexes(visualData.tracks.length, loudestTrackIndex)
    const x = width * 0.07
    const yStart = height * (width > height ? 0.09 : 0.07)
    const fontSize = Math.round(height * (width > height ? 0.025 : 0.018))
    const rowHeight = fontSize * 1.65
    const paddingX = fontSize * 0.75

    context.save()
    context.textBaseline = 'middle'
    visibleTrackIndexes.forEach((trackIndex, visibleIndex) => {
      const track = visualData.tracks[trackIndex]
      const isLoudest = trackIndex === loudestTrackIndex
      const amplitude = VideoRenderer.getSmoothedAmplitude(track.columns, currentColumn, 3)
      const text = VideoRenderer.truncateText(track.name, isLoudest ? 34 : 26)
      context.font = `${isLoudest ? 800 : 600} ${isLoudest ? fontSize * 1.18 : fontSize}px system-ui, -apple-system, BlinkMacSystemFont, sans-serif`
      const textWidth = context.measureText(text).width
      const pillWidth = textWidth + paddingX * 2
      const y = yStart + visibleIndex * rowHeight
      const radius = rowHeight * 0.45

      context.beginPath()
      context.roundRect(x, y - rowHeight * 0.45, pillWidth, rowHeight * 0.9, radius)
      context.fillStyle = isLoudest ? `rgba(34, 211, 238, ${0.22 + amplitude * 0.5})` : 'rgba(15, 23, 42, 0.36)'
      context.fill()

      if (isLoudest) {
        context.strokeStyle = 'rgba(226, 232, 240, 0.7)'
        context.lineWidth = Math.max(1, height * 0.0015)
        context.stroke()
      }

      context.fillStyle = isLoudest ? 'rgba(248, 250, 252, 0.96)' : 'rgba(203, 213, 225, 0.48)'
      context.fillText(text, x + paddingX, y)
    })
    context.restore()
  }

  private static getColumnForProgress(columns: Float32Array, progress: number): number {
    return Math.min(columns.length - 1, Math.max(0, Math.round(progress * (columns.length - 1))))
  }

  private static getSmoothedAmplitude(columns: Float32Array, column: number, radius: number): number {
    if (columns.length === 0) {
      return 0
    }

    let amplitude = 0
    const start = Math.max(0, column - radius)
    const end = Math.min(columns.length - 1, column + radius)
    for (let i = start; i <= end; ++i) {
      amplitude = Math.max(amplitude, columns[i] ?? 0)
    }
    return amplitude
  }

  private static getLoudestTrackIndex(visualData: VideoVisualData, currentColumn: number): number {
    let loudestIndex = -1
    let loudestAmplitude = 0
    for (let i = 0; i < visualData.tracks.length; ++i) {
      const amplitude = VideoRenderer.getSmoothedAmplitude(visualData.tracks[i].columns, currentColumn, 4)
      if (amplitude > loudestAmplitude) {
        loudestAmplitude = amplitude
        loudestIndex = i
      }
    }
    return loudestIndex
  }

  private static getVisibleTrackIndexes(trackCount: number, loudestTrackIndex: number): Array<number> {
    const maxVisible = 8
    if (trackCount <= maxVisible) {
      return new Array(trackCount).fill(0).map((_, index) => index)
    }

    const indexes = [loudestTrackIndex]
    for (let i = 0; i < trackCount && indexes.length < maxVisible; ++i) {
      if (i !== loudestTrackIndex) {
        indexes.push(i)
      }
    }
    return indexes
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
