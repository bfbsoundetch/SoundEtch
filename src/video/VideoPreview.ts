import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny'
import type { WrappedCanvas } from 'mediabunny'
import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import type { VideoFrameTarget } from './VideoFrameResolver'

type Request = {
  directory: string
  sampleRate: number
  target: VideoFrameTarget
  forward: boolean
}

type Source = {
  key: string
  input: Input
  sink: CanvasSink | null
  iterator: AsyncGenerator<WrappedCanvas, void, unknown> | null
  current: WrappedCanvas | null
  next: WrappedCanvas | null
}

/** One active input, one decode operation, and at most two pooled display frames. */
export class VideoPreview {
  private desired: Request | null = null
  private source: Source | null = null
  private sourceEpoch = 0
  private busy = false
  private revision = 0
  private failedSource: string | null = null

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onStatus: (message: string) => void,
    private readonly onError: (error: Error) => void,
  ) {}

  request(directory: string, sampleRate: number, target: VideoFrameTarget, forward: boolean, force = false): void {
    const previous = this.desired
    const key = this.sourceKey(directory, target)
    if (
      !force &&
      previous &&
      previous.directory === directory &&
      previous.sampleRate === sampleRate &&
      previous.target.placement === target.placement &&
      previous.target.segment === target.segment &&
      previous.target.mediaTimeSeconds === target.mediaTimeSeconds &&
      previous.forward === forward
    )
      return
    const reset =
      !previous ||
      this.sourceKey(previous.directory, previous.target) !== key ||
      previous.target.placement !== target.placement ||
      previous.target.segment !== target.segment ||
      target.mediaTimeSeconds < previous.target.mediaTimeSeconds ||
      previous.forward !== forward
    if (reset) {
      this.releaseSource()
      this.clearCanvas()
      if (!previous || this.sourceKey(previous.directory, previous.target) !== key) this.failedSource = null
    } else if (!forward) {
      // A slow scrub must not leave the previous seek's picture visible.
      this.clearCanvas()
    }
    this.desired = { directory, sampleRate, target, forward }
    ++this.revision
    if (this.failedSource === key) return
    if (reset || !forward) this.onStatus('Loading video…')
    void this.drain()
  }

  clear(): void {
    this.desired = null
    ++this.revision
    this.failedSource = null
    this.releaseSource()
    this.clearCanvas()
  }

  private sourceKey(directory: string, target: VideoFrameTarget): string {
    return `${directory}/${target.filename}#${target.segment.trackNumber}`
  }

  private async drain(): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      while (this.desired) {
        const request = this.desired
        const revision = this.revision
        const epoch = this.sourceEpoch
        const key = this.sourceKey(request.directory, request.target)
        if (key === this.failedSource) return
        let source: Source | null = null
        try {
          source = await this.getSource(request)
          if (!source || this.source !== source) continue
          const frame = await this.getFrame(source, request)
          if (this.source !== source || !this.desired) continue
          const latest = this.desired
          // Forward decoding can service a newer clock tick only if this exact frame covers it.
          const coversLatest =
            request.forward &&
            latest.forward &&
            latest.target.placement === request.target.placement &&
            latest.target.segment === request.target.segment &&
            frame !== null &&
            latest.target.mediaTimeSeconds >= frame.timestamp &&
            latest.target.mediaTimeSeconds < (source.next?.timestamp ?? frame.timestamp + frame.duration)
          if (revision === this.revision || coversLatest) {
            if (frame) {
              this.draw(frame)
              this.onStatus('')
            } else {
              this.clearCanvas()
              this.onStatus('No video frame at this position.')
            }
            if (coversLatest || revision === this.revision) return
          }
        } catch (error) {
          // Disposing an obsolete input rejects its in-flight reads; those are not preview failures.
          if (
            !this.desired ||
            epoch !== this.sourceEpoch ||
            (source && source !== this.source) ||
            key !== this.sourceKey(this.desired.directory, this.desired.target)
          )
            continue
          this.failedSource = key
          this.releaseSource()
          this.clearCanvas()
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

  private async getSource(request: Request): Promise<Source | null> {
    const key = this.sourceKey(request.directory, request.target)
    if (this.source?.key === key) return this.source
    const epoch = this.sourceEpoch
    const file = await FileSystemUtils.getExistingFile(request.directory, request.target.filename)
    if (epoch !== this.sourceEpoch) return null
    if (file.size === 0) throw new Error(`Video file ${request.target.filename} is empty`)
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
    const source: Source = { key, input, sink: null, iterator: null, current: null, next: null }
    this.source = source
    try {
      if (!(await input.canRead())) throw new Error('The video container is not supported')
      const tracks = await input.getVideoTracks()
      const track = tracks[request.target.segment.trackNumber - 1]
      if (!track) throw new Error(`Video track ${request.target.segment.trackNumber} is missing`)
      if (!(await track.canDecode())) throw new Error('The selected video track cannot be decoded in this browser')
      if (this.source !== source) return null
      // Defaults apply the stored rotation and display aspect ratio before drawing.
      source.sink = new CanvasSink(track, { poolSize: 2 })
      return source
    } catch (error) {
      if (this.source !== source) return null
      throw error
    }
  }

  private async getFrame(source: Source, request: Request): Promise<WrappedCanvas | null> {
    const sink = source.sink!
    const time = request.target.mediaTimeSeconds
    if (!request.forward) return sink.getCanvas(time)
    if (!source.iterator) {
      const segment = request.target.segment
      source.iterator = sink.canvases(time, segment.mediaStartSeconds + segment.length / request.sampleRate)
      const current = await source.iterator.next()
      source.current = current.done ? null : current.value
      if (this.source !== source) return null
      const next = await source.iterator.next()
      source.next = next.done ? null : next.value
    }
    while (source.next && source.next.timestamp <= time) {
      source.current = source.next
      source.next = null
      // The old current canvas is no longer needed before the two-canvas pool advances.
      const next = await source.iterator.next()
      source.next = next.done ? null : next.value
      if (this.source !== source) return null
    }
    const frame = source.current
    if (!frame || time < frame.timestamp || time >= (source.next?.timestamp ?? frame.timestamp + frame.duration))
      return null
    return frame
  }

  private draw(frame: WrappedCanvas): void {
    const ratio = window.devicePixelRatio || 1
    const width = Math.max(1, Math.round(this.canvas.clientWidth * ratio))
    const height = Math.max(1, Math.round(this.canvas.clientHeight * ratio))
    if (this.canvas.width !== width) this.canvas.width = width
    if (this.canvas.height !== height) this.canvas.height = height
    const context = this.canvas.getContext('2d', { alpha: false })
    if (!context) throw new Error('Video preview requires a 2D canvas')
    context.fillStyle = '#000'
    context.fillRect(0, 0, width, height)
    const scale = Math.min(width / frame.canvas.width, height / frame.canvas.height)
    const drawWidth = frame.canvas.width * scale
    const drawHeight = frame.canvas.height * scale
    context.drawImage(frame.canvas, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight)
  }

  private clearCanvas(): void {
    const context = this.canvas.getContext('2d', { alpha: false })
    if (!context) return
    context.fillStyle = '#000'
    context.fillRect(0, 0, this.canvas.width, this.canvas.height)
  }

  private releaseSource(): void {
    ++this.sourceEpoch
    const source = this.source
    this.source = null
    if (!source) return
    const iterator = source.iterator
    source.iterator = null
    source.current = null
    source.next = null
    if (iterator) void iterator.return().catch(() => {})
    source.input.dispose()
  }
}
