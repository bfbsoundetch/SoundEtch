import type { CanvasSink, EncodedPacketSink, Input } from 'mediabunny'
import { FileSystemUtils } from '../filesystem/FileSystemUtils'
import type { VideoPlacement } from './VideoFrameResolver'
import { getVideoThumbnailTiles, VIDEO_LANE_HEIGHT, VIDEO_THUMBNAIL_WIDTH } from './VideoThumbnailLayout'
import type { VideoThumbnailFrame, VideoThumbnailTile } from './VideoThumbnailLayout'

const IMAGE_CACHE_LIMIT = 96
const FRAME_CHOICE_LIMIT = 4096

type Span = { x: number; width: number }
type Tile = {
  layout: VideoThumbnailTile
  spans: Span[]
  sourceKey: string
  /** Names the tile's media window; it resolves to the timestamp of the frame that represents the window. */
  windowKey: string
}
type Request = {
  frame: VideoThumbnailFrame
  backgrounds: Span[]
  tiles: Tile[]
}
type Thumbnail = HTMLCanvasElement | OffscreenCanvas
type CachedThumbnail = { sourceKey: string; image: Thumbnail | null }
type Decoders = { sink: CanvasSink; packets: EncodedPacketSink }

/** An opened container; its packet index and track setup outlive individual redraws. */
class ThumbnailSource {
  readonly ready: Promise<Decoders>
  private input: Input | null = null
  private disposed = false

  constructor(
    readonly key: string,
    directory: string,
    filename: string,
    trackNumber: number,
  ) {
    this.ready = this.open(directory, filename, trackNumber)
    // The drain loop observes failures; an abandoned open must not surface as unhandled.
    this.ready.catch(() => {})
  }

  dispose(): void {
    this.disposed = true
    this.input?.dispose()
  }

  private async open(directory: string, filename: string, trackNumber: number): Promise<Decoders> {
    // Mediabunny loads with the first video so that projects without video keep it out of the initial chunk.
    const [file, { ALL_FORMATS, BlobSource, CanvasSink, EncodedPacketSink, Input }] = await Promise.all([
      FileSystemUtils.getExistingFile(directory, filename),
      import('mediabunny'),
    ])
    if (this.disposed) throw new DOMException('The thumbnail source was released.', 'AbortError')
    if (file.size === 0) throw new Error('The stored video file is empty')
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
    this.input = input
    if (!(await input.canRead())) throw new Error('The video container is not supported')
    const track = (await input.getVideoTracks())[trackNumber - 1]
    if (!track) throw new Error(`Video track ${trackNumber} is missing`)
    if (!(await track.canDecode())) throw new Error('The selected video track cannot be decoded in this browser')
    return {
      // Default rotation and square-pixel display dimensions honor the file metadata before fitting.
      // No pool: every thumbnail gets its own canvas, which the cache keeps without copying.
      sink: new CanvasSink(track, { width: VIDEO_THUMBNAIL_WIDTH, height: VIDEO_LANE_HEIGHT, fit: 'contain' }),
      packets: new EncodedPacketSink(track),
    }
  }
}

/**
 * Prefers a key frame inside the tile's window: it decodes without the rest of its group of pictures. Otherwise the
 * frame shown at the window's sample time is used; sorted batches decode such a group once.
 */
async function chooseFrame(packets: EncodedPacketSink, tile: VideoThumbnailTile): Promise<number | null> {
  const options = { metadataOnly: true }
  const time = tile.target.mediaTimeSeconds
  const key = await packets.getKeyPacket(time, options)
  if (key && key.timestamp >= tile.startSeconds) return key.timestamp
  const nextKey = key ? await packets.getNextKeyPacket(key, options) : await packets.getFirstKeyPacket(options)
  if (nextKey && nextKey.timestamp < tile.endSeconds) return nextKey.timestamp
  return (await packets.getPacket(time, options))?.timestamp ?? null
}

function thumbnailKey(sourceKey: string, timestamp: number): string {
  return `${sourceKey}|${timestamp}`
}

/** A linked filmstrip: sources stay open while referenced, and one bounded cache holds small, independent images. */
export class VideoThumbnailRenderer {
  private desired: Request | null = null
  private readonly cache = new Map<string, CachedThumbnail>()
  private readonly frameChoices = new Map<string, number | null>()
  private readonly failedSources = new Set<string>()
  private readonly sources = new Map<string, ThumbnailSource>()
  private observer: IntersectionObserver | null = null
  private visible = false
  private busy = false
  private destroyed = false
  private generation = 0

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onError: (error: Error) => void,
  ) {}

  draw(frame: VideoThumbnailFrame): void {
    if (this.destroyed || (this.desired && this.matchesFrame(this.desired.frame, frame))) return
    const snapshot: VideoThumbnailFrame = {
      ...frame,
      placements: frame.placements.map((placement) => ({
        offset: placement.offset,
        startPosition: placement.startPosition,
        length: placement.length,
        clip: {
          filename: placement.clip.filename,
          videoSegments: placement.clip.videoSegments.map((segment) => ({ ...segment })),
        },
      })),
    }
    const sourceKeys = new Set<string>()
    for (const placement of snapshot.placements) {
      for (const segment of placement.clip.videoSegments) {
        sourceKeys.add(
          JSON.stringify([
            snapshot.projectDirectory,
            `${placement.clip.filename}_video_${segment.index}`,
            segment.trackNumber,
          ]),
        )
      }
    }
    for (const [key, source] of this.sources) {
      if (sourceKeys.has(key)) continue
      source.dispose()
      this.sources.delete(key)
    }
    for (const [key, cached] of this.cache) {
      if (!sourceKeys.has(cached.sourceKey)) this.evict(key, cached)
    }
    for (const key of this.failedSources) {
      if (!sourceKeys.has(key)) this.failedSources.delete(key)
    }
    // Decoding continues across redraws; the drain loop serves whichever request is current between frames.
    this.desired = this.makeRequest(snapshot)
    this.observeVisibility()
    // Clear old geometry immediately, even when an observer has not reported visibility yet.
    this.paint(this.desired)
    if (this.visible) void this.drain()
  }

  clear(): void {
    ++this.generation
    this.desired = null
    this.observer?.disconnect()
    this.observer = null
    this.visible = false
    // Disposing an input rejects its in-flight reads, which stops a running decode.
    for (const source of this.sources.values()) source.dispose()
    this.sources.clear()
    for (const [key, cached] of this.cache) this.evict(key, cached)
    this.frameChoices.clear()
    this.failedSources.clear()
    this.canvas.getContext('2d')?.clearRect(0, 0, this.canvas.width, this.canvas.height)
  }

  destroy(): void {
    this.destroyed = true
    this.clear()
  }

  private matchesFrame(previous: VideoThumbnailFrame, next: VideoThumbnailFrame): boolean {
    if (
      previous.projectDirectory !== next.projectDirectory ||
      previous.sampleRate !== next.sampleRate ||
      previous.timelineStart !== next.timelineStart ||
      previous.samplesPerPixel !== next.samplesPerPixel ||
      previous.cssWidth !== next.cssWidth ||
      previous.cssHeight !== next.cssHeight ||
      previous.dpr !== next.dpr ||
      previous.placements.length !== next.placements.length
    )
      return false
    for (let i = 0; i < previous.placements.length; i++) {
      const a = previous.placements[i]
      const b = next.placements[i]
      if (
        a.offset !== b.offset ||
        a.startPosition !== b.startPosition ||
        a.length !== b.length ||
        a.clip.filename !== b.clip.filename ||
        a.clip.videoSegments.length !== b.clip.videoSegments.length
      )
        return false
      for (let j = 0; j < a.clip.videoSegments.length; j++) {
        const x = a.clip.videoSegments[j]
        const y = b.clip.videoSegments[j]
        if (
          x.index !== y.index ||
          x.trackNumber !== y.trackNumber ||
          x.startSample !== y.startSample ||
          x.length !== y.length ||
          x.mediaStartSeconds !== y.mediaStartSeconds ||
          x.mimeType !== y.mimeType
        )
          return false
      }
    }
    return true
  }

  private makeRequest(frame: VideoThumbnailFrame): Request {
    const backgrounds: Span[] = []
    const placementSpans = new Map<VideoPlacement, Span>()
    if (frame.samplesPerPixel > 0 && Number.isFinite(frame.samplesPerPixel) && Number.isFinite(frame.timelineStart)) {
      for (const placement of frame.placements) {
        if (placement.clip.videoSegments.length === 0 || placement.length <= 0) continue
        const x = Math.max(0, (placement.startPosition - frame.timelineStart) / frame.samplesPerPixel)
        const end = Math.min(
          frame.cssWidth,
          (placement.startPosition + placement.length - frame.timelineStart) / frame.samplesPerPixel,
        )
        if (end <= x) continue
        const span = { x, width: end - x }
        backgrounds.push(span)
        placementSpans.set(placement, span)
      }
    }
    const tiles: Tile[] = []
    const order = new Map(frame.placements.map((placement, index) => [placement, index]))
    for (const layout of getVideoThumbnailTiles(frame)) {
      let spans: Span[] = [{ x: layout.x, width: layout.width }]
      const index = order.get(layout.target.placement)!
      // Later placements cover earlier footage even where the later placement has a video gap.
      for (let i = index + 1; i < frame.placements.length && spans.length; i++) {
        const cover = placementSpans.get(frame.placements[i])
        if (!cover) continue
        const remaining: Span[] = []
        const coverEnd = cover.x + cover.width
        for (const span of spans) {
          const end = span.x + span.width
          if (end <= cover.x || span.x >= coverEnd) remaining.push(span)
          else {
            if (span.x < cover.x) remaining.push({ x: span.x, width: cover.x - span.x })
            if (end > coverEnd) remaining.push({ x: coverEnd, width: end - coverEnd })
          }
        }
        spans = remaining
      }
      if (!spans.length) continue
      const sourceKey = JSON.stringify([
        frame.projectDirectory,
        layout.target.filename,
        layout.target.segment.trackNumber,
      ])
      const windowKey = `${sourceKey}|${layout.startSeconds}|${layout.endSeconds}|${layout.target.mediaTimeSeconds}`
      tiles.push({ layout, spans, sourceKey, windowKey })
    }
    return { frame, backgrounds, tiles }
  }

  private observeVisibility(): void {
    if (this.observer) return
    const observer = new IntersectionObserver((entries) => {
      if (this.observer !== observer || !this.desired) return
      const entry = entries.find((entry) => entry.target === this.canvas)
      if (entry)
        this.setVisible(entry.isIntersecting && entry.intersectionRect.width > 0 && entry.intersectionRect.height > 0)
    })
    this.observer = observer
    observer.observe(this.canvas)
  }

  private setVisible(visible: boolean): void {
    if (this.destroyed || this.visible === visible) return
    // Hiding only stops the drain loop after its current frame; open sources serve the next reveal quickly.
    this.visible = visible
    if (visible && this.desired) {
      this.paint(this.desired)
      void this.drain()
    }
  }

  private paint(request: Request): void {
    const { frame } = request
    const dpr = frame.dpr > 0 && Number.isFinite(frame.dpr) ? frame.dpr : 1
    const width = Math.max(1, Math.round(frame.cssWidth * dpr))
    const height = Math.max(1, Math.round(frame.cssHeight * dpr))
    if (this.canvas.width !== width) this.canvas.width = width
    if (this.canvas.height !== height) this.canvas.height = height
    const context = this.canvas.getContext('2d')
    if (!context) return
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    context.clearRect(0, 0, width / dpr, height / dpr)
    // Black marks footage gaps inside clips only; the rest of the lane stays transparent.
    context.fillStyle = '#000'
    for (const span of request.backgrounds) context.fillRect(span.x, 0, span.width, frame.cssHeight)
    for (const tile of request.tiles) {
      const timestamp = this.frameChoices.get(tile.windowKey)
      if (timestamp === undefined || timestamp === null) continue
      const image = this.getCached(thumbnailKey(tile.sourceKey, timestamp))?.image
      if (image) this.paintTile(request, tile, image)
    }
  }

  private paintTile(request: Request, tile: Tile, image: Thumbnail): void {
    const context = this.canvas.getContext('2d')
    if (!context) return
    context.save()
    context.beginPath()
    for (const span of tile.spans) context.rect(span.x, 0, span.width, request.frame.cssHeight)
    context.clip()
    context.drawImage(image, tile.layout.imageX, 0, tile.layout.imageWidth, request.frame.cssHeight)
    context.restore()
  }

  private getCached(key: string): CachedThumbnail | undefined {
    const cached = this.cache.get(key)
    if (cached) {
      this.cache.delete(key)
      this.cache.set(key, cached)
    }
    return cached
  }

  private cacheThumbnail(key: string, sourceKey: string, image: Thumbnail | null): void {
    const previous = this.cache.get(key)
    if (previous) this.evict(key, previous)
    this.cache.set(key, { sourceKey, image })
    while (this.cache.size > IMAGE_CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value!
      this.evict(oldest, this.cache.get(oldest)!)
    }
  }

  private evict(key: string, cached: CachedThumbnail): void {
    // Release the backing store now rather than at garbage collection.
    if (cached.image) cached.image.width = 0
    this.cache.delete(key)
  }

  private rememberFrameChoice(windowKey: string, timestamp: number | null): void {
    this.frameChoices.set(windowKey, timestamp)
    if (this.frameChoices.size > FRAME_CHOICE_LIMIT) this.frameChoices.delete(this.frameChoices.keys().next().value!)
  }

  /** Unchosen windows and chosen frames without a cached image, for the first source that has any. */
  private nextWork(request: Request): { sourceKey: string; tiles: Tile[] } | null {
    let sourceKey: string | null = null
    const tiles: Tile[] = []
    for (const tile of request.tiles) {
      if ((sourceKey !== null && tile.sourceKey !== sourceKey) || this.failedSources.has(tile.sourceKey)) continue
      const timestamp = this.frameChoices.get(tile.windowKey)
      if (timestamp === null || (timestamp !== undefined && this.cache.has(thumbnailKey(tile.sourceKey, timestamp))))
        continue
      sourceKey = tile.sourceKey
      tiles.push(tile)
    }
    return sourceKey === null ? null : { sourceKey, tiles }
  }

  private getSource(directory: string, sourceKey: string, tile: VideoThumbnailTile): ThumbnailSource {
    let source = this.sources.get(sourceKey)
    if (!source) {
      source = new ThumbnailSource(sourceKey, directory, tile.target.filename, tile.target.segment.trackNumber)
      this.sources.set(sourceKey, source)
    }
    return source
  }

  private isLive(generation: number, source: ThumbnailSource): boolean {
    return !this.destroyed && this.generation === generation && this.sources.get(source.key) === source
  }

  private async drain(): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      while (this.desired && this.visible && !this.destroyed) {
        const request = this.desired
        const generation = this.generation
        const work = this.nextWork(request)
        if (!work) break
        const source = this.getSource(request.frame.projectDirectory, work.sourceKey, work.tiles[0].layout)
        try {
          const { sink, packets } = await source.ready
          const timestamps = new Set<number>()
          for (const tile of work.tiles) {
            if (!this.frameChoices.has(tile.windowKey)) {
              const timestamp = await chooseFrame(packets, tile.layout)
              if (!this.isLive(generation, source)) break
              this.rememberFrameChoice(tile.windowKey, timestamp)
            }
            const timestamp = this.frameChoices.get(tile.windowKey)
            if (typeof timestamp === 'number' && !this.cache.has(thumbnailKey(work.sourceKey, timestamp)))
              timestamps.add(timestamp)
          }
          if (!this.isLive(generation, source)) continue
          // Windows may resolve to frames another tile already decoded.
          if (this.desired) this.paint(this.desired)
          if (timestamps.size === 0) continue
          await this.decode(
            generation,
            source,
            sink,
            [...timestamps].sort((a, b) => a - b),
          )
        } catch (error) {
          // Disposing an obsolete input rejects pending reads; cancellation is not a source failure.
          if (this.isLive(generation, source) && !this.failedSources.has(work.sourceKey)) {
            this.failedSources.add(work.sourceKey)
            source.dispose()
            this.sources.delete(work.sourceKey)
            const message = error instanceof Error ? error.message : String(error)
            this.onError(
              new Error(`Video thumbnails unavailable for ${work.tiles[0].layout.target.filename}: ${message}`),
            )
          }
        }
      }
    } finally {
      this.busy = false
    }
  }

  private async decode(
    generation: number,
    source: ThumbnailSource,
    sink: CanvasSink,
    timestamps: readonly number[],
  ): Promise<void> {
    const iterator = sink.canvasesAtTimestamps(timestamps)
    try {
      for (let i = 0; i < timestamps.length; i++) {
        const result = await iterator.next()
        if (!this.isLive(generation, source)) return
        if (result.done) throw new Error('The video decoder ended before the requested thumbnail')
        const image = result.value?.canvas ?? null
        this.cacheThumbnail(thumbnailKey(source.key, timestamps[i]), source.key, image)
        const latest = this.desired
        if (!latest || !this.visible) return
        // Paint into the latest geometry: scrolling and zooming do not restart a running batch.
        let remaining = false
        for (const tile of latest.tiles) {
          if (tile.sourceKey !== source.key) continue
          const timestamp = this.frameChoices.get(tile.windowKey)
          if (timestamp === timestamps[i]) {
            if (image) this.paintTile(latest, tile, image)
          } else if (typeof timestamp === 'number' && timestamps.indexOf(timestamp, i + 1) !== -1) remaining = true
        }
        // Once nothing left in this batch is visible, the drain loop re-plans against the latest request.
        if (!remaining) return
      }
    } finally {
      void iterator.return().catch(() => {})
    }
  }
}
