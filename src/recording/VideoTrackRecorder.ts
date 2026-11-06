import {
  ALL_FORMATS,
  BlobSource,
  getFirstEncodableVideoCodec,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  StreamTarget,
  VideoSample,
  VideoSampleSource,
} from 'mediabunny'
import type { StreamTargetChunk, VideoCodec, VideoEncodingConfig } from 'mediabunny'
import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import type { VideoSegment } from '../project/Video'
import { getMediaPresentation } from './MediaTiming'
import { VideoFileWriter } from './VideoFileWriter'
import { VideoFrameClock } from './VideoFrameClock'

const PREFERRED_CODECS: VideoCodec[] = ['avc', 'vp9', 'av1']
const MAXIMUM_HEIGHT = 1080
const DEFAULT_FRAME_RATE = 30
/** A source's first frame arriving this soon after the recording starts is shown from the start. */
const FIRST_FRAME_LEAD_IN_SECONDS = 0.5

type FrameProcessor = new (init: { track: MediaStreamTrack }) => { readonly readable: ReadableStream<VideoFrame> }
// TypeScript's DOM library lacks MediaStreamTrackProcessor, which only Chromium exposes on the main thread.
const FrameProcessorConstructor =
  'MediaStreamTrackProcessor' in globalThis ? (globalThis.MediaStreamTrackProcessor as FrameProcessor) : null

type Pump = { readonly track: MediaStreamTrack; stop(): void }

export interface VideoTrackRecorderOptions {
  readonly directory: string
  readonly filename: string
  readonly sampleRate: number
  /** Seconds since the first recorded sample, and whether the timeline is advancing (not paused). */
  readonly timeline: () => { seconds: number; running: boolean }
  /** Encodes at least this height, for guest streams that start small while their connection ramps up. */
  readonly minimumHeight: number
  /** The recorded footage now reaches `endSeconds`. */
  readonly onProgress: (endSeconds: number) => void
  readonly onError: (error: Error) => void
}

/** The encoded size for footage whose first frame is `width`×`height`: even, contained, at most 1080 lines high. */
export function getRecordingSize(width: number, height: number, minimumHeight: number) {
  const outputHeight = Math.min(MAXIMUM_HEIGHT, Math.max(height, minimumHeight))
  const even = (value: number) => Math.max(2, 2 * Math.round(value / 2))
  return { width: even((width * outputHeight) / height), height: even(outputHeight) }
}

/**
 * Records one camera or screen source into an MP4 sidecar. Frames are timestamped on the audio sample clock, so the
 * footage lines up with the clip's audio; a source that disappears mid-recording leaves black until it returns. The
 * sidecar is a fragmented MP4 written through a worker that flushes every write, so a closed tab keeps every complete
 * fragment.
 */
export class VideoTrackRecorder {
  private readonly clock = new VideoFrameClock()
  private writer: VideoFileWriter | null = null
  private output: Output | null = null
  private source: VideoSampleSource | null = null
  private size: { width: number; height: number } | null = null
  private frameDuration = 1 / DEFAULT_FRAME_RATE
  private lastTimestamp = -Infinity
  private pump: Pump | null = null
  /** Serializes frame additions across track replacements and black frames. */
  private queue: Promise<void> = Promise.resolve()
  private failure: Error | null = null
  private finished = false
  private finishPromise: Promise<VideoSegment | null> | null = null
  private closePromise: Promise<void> | null = null

  constructor(private readonly options: VideoTrackRecorderOptions) {}

  /** Records `track` from now on, or black while `null` (the source is gone). */
  attach(track: MediaStreamTrack | null): void {
    if (this.finished || this.failure || this.pump?.track === track) return
    const previous = this.pump
    this.pump = null
    previous?.stop()
    if (!track) {
      if (previous) void this.enqueue(() => this.addBlackFrame())
      return
    }
    // A replacement track has its own capture clock and may have its own frame rate.
    this.clock.reset()
    const frameRate = track.getSettings().frameRate
    this.frameDuration = 1 / (frameRate && frameRate >= 1 ? Math.min(frameRate, 120) : DEFAULT_FRAME_RATE)
    this.pump = this.startPump(track)
  }

  /** Finalizes the file; returns its placement within the clip, or null when nothing was recorded. */
  finish(): Promise<VideoSegment | null> {
    if (this.finishPromise) return this.finishPromise
    this.finished = true
    this.stopPump()
    return (this.finishPromise = this.finishRecording())
  }

  private async finishRecording(): Promise<VideoSegment | null> {
    await this.queue
    if (!this.failure && this.output) {
      try {
        await this.output.finalize()
        if (this.failure) throw this.failure
        return await readRecordedVideoSegment(this.options.directory, this.options.filename, this.options.sampleRate)
      } catch (error) {
        this.fail(error)
      }
    }
    if (!this.failure) return null
    await this.closePromise
    if (this.failure.name == 'QuotaExceededError') {
      // The failed muxer must no longer be able to write into the prefix we are about to recover.
      const playable = await VideoFileWriter.trimInterruptedFile(this.options.directory, this.options.filename)
      if (playable > 0) {
        return readRecordedVideoSegment(this.options.directory, this.options.filename, this.options.sampleRate)
      }
      await FileSystemUtils.deleteFile(this.options.directory, this.options.filename)
    } else if (this.writer) {
      await FileSystemUtils.deleteFile(this.options.directory, this.options.filename)
    }
    return null
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(task)
    this.queue = run.catch(() => {})
    return run
  }

  private startPump(track: MediaStreamTrack): Pump {
    return FrameProcessorConstructor
      ? this.startProcessorPump(track, FrameProcessorConstructor)
      : this.startElementPump(track)
  }

  private startProcessorPump(track: MediaStreamTrack, Processor: FrameProcessor): Pump {
    const reader = new Processor({ track }).readable.getReader()
    const pump: Pump = { track, stop: () => void reader.cancel().catch(() => {}) }
    void (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          // Awaiting the encoder applies backpressure; the processor drops stale frames meanwhile.
          await this.enqueue(() => this.addFrame(value))
        }
      } catch {
        // A failing track stream ends this track like a stopped one.
      }
      this.handlePumpEnd(pump)
    })()
    return pump
  }

  /** Without MediaStreamTrackProcessor (e.g. Firefox, Safari's main thread), sample a hidden video element. */
  private startElementPump(track: MediaStreamTrack): Pump {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.style.cssText = 'position:fixed;left:-10000px;top:0;width:1px;height:1px;opacity:0;pointer-events:none'
    video.srcObject = new MediaStream([track])
    document.body.appendChild(video)
    void video.play().catch(() => {})
    let busy = false
    const timer = window.setInterval(() => {
      if (track.readyState == 'ended') {
        stop()
        this.handlePumpEnd(pump)
        return
      }
      if (busy || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
      busy = true
      const frame = new VideoFrame(video, { timestamp: Math.round(performance.now() * 1000) })
      void this.enqueue(() => this.addFrame(frame)).finally(() => (busy = false))
    }, this.frameDuration * 1000)
    const stop = () => {
      window.clearInterval(timer)
      video.srcObject = null
      video.remove()
    }
    const pump: Pump = { track, stop }
    return pump
  }

  private handlePumpEnd(pump: Pump) {
    if (this.pump !== pump) return
    this.pump = null
    if (!this.finished && !this.failure) void this.enqueue(() => this.addBlackFrame())
  }

  private async addFrame(frame: VideoFrame): Promise<void> {
    try {
      if (this.finished || this.failure) return
      const { seconds, running } = this.options.timeline()
      if (!running) return
      const mapped = this.clock.map(frame.timestamp / 1e6, seconds)
      // The camera was already running: its first frame stands for the moment recording began, not a black gap.
      const timestamp = this.lastTimestamp == -Infinity && mapped < FIRST_FRAME_LEAD_IN_SECONDS ? 0 : mapped
      if (!(timestamp > this.lastTimestamp)) return
      if (!this.source) await this.open(frame)
      await this.addSample(new VideoSample(frame, { timestamp, duration: this.frameDuration }))
    } catch (error) {
      this.fail(error)
    } finally {
      frame.close()
    }
  }

  private async addBlackFrame(): Promise<void> {
    if (this.finished || this.failure || !this.source || !this.size) return
    const timestamp = Math.max(this.options.timeline().seconds, this.lastTimestamp + this.frameDuration)
    const canvas = document.createElement('canvas')
    canvas.width = this.size.width
    canvas.height = this.size.height
    const context = canvas.getContext('2d')!
    context.fillStyle = '#000'
    context.fillRect(0, 0, canvas.width, canvas.height)
    try {
      await this.addSample(new VideoSample(canvas, { timestamp, duration: this.frameDuration }))
    } catch (error) {
      this.fail(error)
    }
  }

  private async addSample(sample: VideoSample) {
    try {
      await this.source!.add(sample)
    } finally {
      sample.close()
    }
    this.lastTimestamp = sample.timestamp
    this.options.onProgress(sample.timestamp + this.frameDuration)
  }

  private async open(frame: VideoFrame) {
    const size = getRecordingSize(frame.displayWidth, frame.displayHeight, this.options.minimumHeight)
    const format = new Mp4OutputFormat({ fastStart: 'fragmented' })
    const supported = format.getSupportedVideoCodecs()
    const codec = await getFirstEncodableVideoCodec(
      PREFERRED_CODECS.filter((candidate) => supported.includes(candidate)),
      size,
    )
    if (!codec) throw new Error('This browser cannot encode video')
    const writer = await VideoFileWriter.open(this.options.directory, this.options.filename)
    this.writer = writer
    const output = new Output({
      format,
      target: new StreamTarget(
        new WritableStream<StreamTargetChunk>({
          write: async ({ data, position }) => {
            try {
              await writer.write(data, position)
            } catch (error) {
              // StreamTarget otherwise defers write failures until the next frame or finalization.
              this.fail(error)
              throw error
            }
          },
          close: () => writer.close(),
        }),
      ),
    })
    this.output = output
    const unchanged =
      frame.codedWidth == size.width &&
      frame.codedHeight == size.height &&
      frame.displayWidth == size.width &&
      frame.displayHeight == size.height
    const config: VideoEncodingConfig = {
      codec,
      quality: new Quality('high'),
      keyFrameInterval: 2,
      // Live sources must keep up; an overloaded encoder drops frames rather than falling behind.
      latencyMode: 'realtime',
      // Guests' resolution changes with their connection; later frames are fitted into the first box.
      ...(unchanged
        ? { sizeChangeBehavior: 'contain' }
        : { sizeChangeBehavior: 'passThrough', transform: { ...size, fit: 'contain' } }),
    }
    const source = new VideoSampleSource(config)
    output.addVideoTrack(source)
    this.source = source
    this.size = size
    await output.start()
    if (this.failure) throw this.failure
  }

  private fail(error: unknown) {
    if (this.failure) return
    this.failure = toError(error)
    this.stopPump()
    // Never await cleanup from a frame or stream write: cancellation may itself wait for that write to settle.
    this.closePromise = this.closeOutput()
    this.options.onError(this.failure)
  }

  private stopPump() {
    this.pump?.stop()
    this.pump = null
  }

  private async closeOutput() {
    const output = this.output
    this.output = null
    this.source = null
    try {
      // Closing first blocks every later muxer write and releases the worker's exclusive file handle.
      await this.writer?.close()
    } catch {
      // VideoFileWriter always terminates the worker, including when flushing the full disk fails.
    }
    try {
      await output?.cancel()
    } catch {
      // A failed/finalizing output may reject cancellation; it can no longer write to the closed worker.
    }
  }
}

/** Where the recorded sidecar `filename` sits within its clip, which starts with the recording at media time zero. */
export async function readRecordedVideoSegment(
  directory: string,
  filename: string,
  sampleRate: number,
): Promise<VideoSegment> {
  const file = await FileSystemUtils.getExistingFile(directory, filename)
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  try {
    const track = (await input.getVideoTracks())[0]
    if (!track) throw new Error('The recorded video has no video track')
    const presentation = getMediaPresentation(
      await track.getFirstTimestamp(),
      await track.computeDuration(),
      0,
      sampleRate,
    )
    return {
      index: 0,
      trackNumber: 1,
      startSample: presentation.videoStartSample,
      length: presentation.videoLength,
      mediaStartSeconds: presentation.videoMediaStartSeconds,
      mimeType: 'video/mp4',
    }
  } finally {
    input.dispose()
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
