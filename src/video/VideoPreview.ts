import { ALL_FORMATS, BlobSource, EncodedPacketSink, Input, VideoSampleSink } from 'mediabunny'
import type { VideoSample } from 'mediabunny'
import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import type { VideoFrameTarget } from './VideoFrameResolver'
import { paintVideoFrame } from './VideoFramePainter'

/**
 * A restart must skip more than this much decoding to pay for a new decoder and the frames the running one has
 * already queued; shorter forward moves, including every playback tick, advance the running decoder.
 */
const RESTART_SAVING_SECONDS = 0.25

type Request = {
  directory: string
  sampleRate: number
  target: VideoFrameTarget
}

type Source = {
  key: string
  input: Input
  sink: VideoSampleSink | null
  packets: EncodedPacketSink | null
  iterator: AsyncGenerator<VideoSample, void, unknown> | null
  iteratorEnd: number
  current: VideoSample | null
  next: VideoSample | null
}

function sourceKey(directory: string, target: VideoFrameTarget): string {
  return `${directory}/${target.filename}#${target.segment.trackNumber}`
}

function covers(frame: VideoSample, next: VideoSample | null, time: number): boolean {
  return time >= frame.timestamp && time < (next?.timestamp ?? frame.timestamp + frame.duration)
}

/**
 * One open input with one sequential decoder that playback and forward scrubbing advance instead of seeking. It holds
 * at most three frames: the decoder's current and next frames and the displayed picture.
 */
export class VideoPreview {
  private desired: Request | null = null
  private source: Source | null = null
  private sourceEpoch = 0
  private busy = false
  private revision = 0
  private failedSource: string | null = null
  private shown: VideoSample | null = null
  private shownOriginal: VideoSample | null = null
  private fit: 'contain' | 'cover' = 'contain'
  private cropX = 0.5
  private cropY = 0.5
  private cornerRadius = 0
  private readonly cropOverflow = { x: 0, y: 0 }

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onStatus: (message: string) => void,
    private readonly onError: (error: Error) => void,
  ) {}

  /** Changes composition without decoding the retained picture again. Track previews default to contain. */
  setFraming(fit: 'contain' | 'cover', x = 0.5, y = 0.5, cornerRadius = this.cornerRadius): void {
    x = Math.max(0, Math.min(1, x))
    y = Math.max(0, Math.min(1, y))
    cornerRadius = Math.max(0, cornerRadius)
    const radiusChanged = cornerRadius !== this.cornerRadius
    const fitChanged =
      fit !== this.fit &&
      this.shown !== null &&
      this.shown.displayWidth * this.canvas.height !== this.shown.displayHeight * this.canvas.width
    const cropChanged = (x !== this.cropX && this.cropOverflow.x > 0) || (y !== this.cropY && this.cropOverflow.y > 0)
    this.fit = fit
    this.cropX = x
    this.cropY = y
    this.cornerRadius = cornerRadius
    if (this.shown && (fitChanged || radiusChanged || (fit === 'cover' && cropChanged))) this.paint(this.shown)
  }

  /** CSS-pixel travel of the displayed picture; the cached object is updated by each paint. */
  getCropOverflow(): Readonly<{ x: number; y: number }> | null {
    return this.shown && this.fit === 'cover' ? this.cropOverflow : null
  }

  /** `redraw` repaints the displayed picture after the canvas size changes; it never decodes again. */
  request(directory: string, sampleRate: number, target: VideoFrameTarget, redraw = false): void {
    const previous = this.desired
    if (
      previous &&
      previous.directory === directory &&
      previous.sampleRate === sampleRate &&
      previous.target.placement === target.placement &&
      previous.target.segment === target.segment &&
      previous.target.mediaTimeSeconds === target.mediaTimeSeconds
    ) {
      if (redraw && this.shown) this.paint(this.shown)
      return
    }
    const key = sourceKey(directory, target)
    if (!previous || sourceKey(previous.directory, previous.target) !== key) {
      // Another file's picture must not stand in for this one.
      this.failedSource = null
      this.blank()
    } else if (redraw && this.shown) this.paint(this.shown)
    this.desired = { directory, sampleRate, target }
    ++this.revision
    if (this.failedSource === key) return
    // Seeks within a source keep the previous picture until the new frame replaces it.
    if (!this.shown) this.onStatus('Loading video…')
    void this.drain()
  }

  /** Stops decoding and blanks the picture; the input stays open for a return to the same footage. */
  clear(): void {
    this.desired = null
    ++this.revision
    this.failedSource = null
    if (this.source) this.stopIterator(this.source)
    this.blank()
  }

  release(): void {
    this.clear()
    this.releaseSource()
  }

  private async drain(): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      while (this.desired) {
        const request = this.desired
        const revision = this.revision
        const epoch = this.sourceEpoch
        const key = sourceKey(request.directory, request.target)
        if (key === this.failedSource) return
        let source: Source | null = null
        try {
          source = await this.getSource(request, key)
          if (!source || this.source !== source) continue
          const frame = await this.seek(source, request)
          if (this.source !== source) continue
          const latest = this.desired
          // Show frames decoded for superseded positions too: a continuous scrub would otherwise display nothing.
          if (frame && latest && sourceKey(latest.directory, latest.target) === key) {
            this.show(frame)
            this.onStatus('')
          }
          if (revision !== this.revision) continue
          if (!frame) {
            this.blank()
            this.onStatus('No video frame at this position.')
          }
          return
        } catch (error) {
          // Disposing an obsolete input rejects its in-flight reads; those are not preview failures.
          if (
            !this.desired ||
            epoch !== this.sourceEpoch ||
            (source && source !== this.source) ||
            key !== sourceKey(this.desired.directory, this.desired.target)
          )
            continue
          this.failedSource = key
          this.releaseSource()
          this.blank()
          const failure = error instanceof Error ? error : new Error(String(error))
          this.onStatus(`Video preview unavailable: ${failure.message}`)
          this.onError(failure)
          return
        }
      }
    } finally {
      this.busy = false
    }
  }

  private async getSource(request: Request, key: string): Promise<Source | null> {
    if (this.source?.key === key) return this.source
    this.releaseSource()
    const epoch = this.sourceEpoch
    const file = await FileSystemUtils.getExistingFile(request.directory, request.target.filename)
    if (epoch !== this.sourceEpoch) return null
    if (file.size === 0) throw new Error(`Video file ${request.target.filename} is empty`)
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
    const source: Source = {
      key,
      input,
      sink: null,
      packets: null,
      iterator: null,
      iteratorEnd: 0,
      current: null,
      next: null,
    }
    this.source = source
    try {
      if (!(await input.canRead())) throw new Error('The video container is not supported')
      const tracks = await input.getVideoTracks()
      const track = tracks[request.target.segment.trackNumber - 1]
      if (!track) throw new Error(`Video track ${request.target.segment.trackNumber} is missing`)
      if (!(await track.canDecode())) throw new Error('The selected video track cannot be decoded in this browser')
      if (this.source !== source) return null
      // Samples carry the stored rotation and display aspect ratio; drawing applies both.
      source.sink = new VideoSampleSink(track)
      source.packets = new EncodedPacketSink(track)
      return source
    } catch (error) {
      if (this.source !== source) return null
      throw error
    }
  }

  private async seek(source: Source, request: Request): Promise<VideoSample | null> {
    const time = request.target.mediaTimeSeconds
    const segment = request.target.segment
    const end = segment.mediaStartSeconds + segment.length / request.sampleRate
    const current = source.current
    if (source.iterator && current && source.iteratorEnd === end && time >= current.timestamp) {
      if (covers(current, source.next, time)) return current
      let reachable = time - current.timestamp <= RESTART_SAVING_SECONDS
      if (!reachable) {
        // A restart decodes from the key frame at or before the target.
        const key = await source.packets!.getKeyPacket(time, { metadataOnly: true })
        if (this.source !== source || source.current !== current) return null
        reachable = !key || key.timestamp - current.timestamp <= RESTART_SAVING_SECONDS
      }
      if (reachable) return this.advance(source, time)
    }
    this.stopIterator(source)
    const iterator = source.sink!.samples(time, end)
    source.iterator = iterator
    source.iteratorEnd = end
    source.current = await this.pull(source, iterator)
    if (source.current) source.next = await this.pull(source, iterator)
    return this.advance(source, time)
  }

  private async advance(source: Source, time: number): Promise<VideoSample | null> {
    const iterator = source.iterator
    while (iterator && source.iterator === iterator && source.next && source.next.timestamp <= time) {
      // Skipped frames are closed without drawing.
      source.current?.close()
      source.current = source.next
      source.next = null
      source.next = await this.pull(source, iterator)
    }
    const frame = source.current
    return frame && source.iterator === iterator && covers(frame, source.next, time) ? frame : null
  }

  private async pull(
    source: Source,
    iterator: AsyncGenerator<VideoSample, void, unknown>,
  ): Promise<VideoSample | null> {
    const result = await iterator.next()
    const sample = result.done ? null : result.value
    if (source.iterator === iterator) return sample
    // The iterator was stopped while this frame decoded.
    sample?.close()
    return null
  }

  private show(frame: VideoSample): void {
    if (this.shownOriginal === frame && this.shown) return
    this.shown?.close()
    // A clone shares the decoded picture but survives the decoder advancing past it, for redraws.
    this.shown = frame.clone()
    this.shownOriginal = frame
    this.paint(this.shown)
  }

  private paint(frame: VideoSample): void {
    const ratio = window.devicePixelRatio || 1
    const cssWidth = this.canvas.clientWidth
    const cssHeight = this.canvas.clientHeight
    const width = Math.max(1, Math.round(cssWidth * ratio))
    const height = Math.max(1, Math.round(cssHeight * ratio))
    if (this.canvas.width !== width) this.canvas.width = width
    if (this.canvas.height !== height) this.canvas.height = height
    const context = this.canvas.getContext('2d', { alpha: false })
    if (!context) throw new Error('Video preview requires a 2D canvas')
    context.fillStyle = '#000'
    context.fillRect(0, 0, width, height)
    paintVideoFrame(
      context,
      frame,
      0,
      0,
      width,
      height,
      this.fit,
      this.cropX,
      this.cropY,
      this.cornerRadius * ratio,
      this.cropOverflow,
    )
    // Account for rounded backing dimensions rather than assuming an exact integer DPR.
    this.cropOverflow.x = (this.cropOverflow.x * cssWidth) / width
    this.cropOverflow.y = (this.cropOverflow.y * cssHeight) / height
  }

  private blank(): void {
    this.shown?.close()
    this.shown = null
    this.shownOriginal = null
    this.cropOverflow.x = 0
    this.cropOverflow.y = 0
    const context = this.canvas.getContext('2d', { alpha: false })
    if (!context) return
    context.fillStyle = '#000'
    context.fillRect(0, 0, this.canvas.width, this.canvas.height)
  }

  private stopIterator(source: Source): void {
    const iterator = source.iterator
    source.iterator = null
    source.current?.close()
    source.current = null
    source.next?.close()
    source.next = null
    if (iterator) void iterator.return().catch(() => {})
  }

  private releaseSource(): void {
    ++this.sourceEpoch
    const source = this.source
    this.source = null
    if (!source) return
    this.stopIterator(source)
    source.input.dispose()
  }
}
