import type { VideoPlacement, VideoFrameTarget } from './VideoFrameResolver'

export const VIDEO_LANE_HEIGHT = 72
export const VIDEO_THUMBNAIL_WIDTH = 128

export interface VideoThumbnailFrame {
  readonly projectDirectory: string
  readonly sampleRate: number
  readonly timelineStart: number
  readonly samplesPerPixel: number
  readonly cssWidth: number
  readonly cssHeight: number
  readonly dpr: number
  readonly placements: readonly VideoPlacement[]
}

export interface VideoThumbnailTile {
  readonly x: number
  readonly width: number
  readonly imageX: number
  readonly imageWidth: number
  readonly target: VideoFrameTarget
  /** Half-open media-time window of the column's available footage; any frame in it represents the tile. */
  readonly startSeconds: number
  readonly endSeconds: number
}

export function getVideoThumbnailTiles(frame: VideoThumbnailFrame): VideoThumbnailTile[] {
  const { sampleRate, timelineStart, samplesPerPixel, cssWidth, placements } = frame
  if (
    !Number.isFinite(sampleRate) ||
    sampleRate <= 0 ||
    !Number.isFinite(timelineStart) ||
    !Number.isFinite(samplesPerPixel) ||
    samplesPerPixel <= 0 ||
    !Number.isFinite(cssWidth) ||
    cssWidth <= 0 ||
    !Number.isFinite(frame.cssHeight) ||
    frame.cssHeight <= 0
  )
    return []
  const endSample = timelineStart + cssWidth * samplesPerPixel
  const tileSamples = VIDEO_THUMBNAIL_WIDTH * samplesPerPixel
  const tiles: VideoThumbnailTile[] = []
  for (const placement of placements) {
    if (placement.length <= 0) continue
    const placementEnd = placement.startPosition + placement.length
    const visibleStart = Math.max(timelineStart, placement.startPosition)
    const visibleEnd = Math.min(endSample, placementEnd)
    if (visibleEnd <= visibleStart) continue
    for (const segment of placement.clip.videoSegments) {
      const segmentStart = placement.startPosition + segment.startSample - placement.offset
      const segmentEnd = segmentStart + segment.length
      const mediaTime = (timelineSample: number) =>
        segment.mediaStartSeconds + (timelineSample - segmentStart) / sampleRate
      const start = Math.max(visibleStart, segmentStart)
      const end = Math.min(visibleEnd, segmentEnd)
      if (end <= start) continue
      const firstColumn = Math.floor((start - placement.startPosition) / tileSamples)
      const lastColumn = Math.ceil((end - placement.startPosition) / tileSamples)
      for (let column = firstColumn; column < lastColumn; column++) {
        const columnStart = placement.startPosition + column * tileSamples
        const columnEnd = columnStart + tileSamples
        const tileStart = Math.max(start, columnStart)
        const tileEnd = Math.min(end, columnEnd)
        if (tileEnd <= tileStart) continue
        // Anchor sampling to source placement columns, so panning and moving reuse the same frame.
        const sampleStart = Math.max(placement.startPosition, segmentStart, columnStart)
        const sampleEnd = Math.min(placementEnd, segmentEnd, columnEnd)
        const sample = Math.max(sampleStart, Math.min(sampleEnd - 1, Math.floor((sampleStart + sampleEnd) / 2)))
        tiles.push({
          x: (tileStart - timelineStart) / samplesPerPixel,
          width: (tileEnd - tileStart) / samplesPerPixel,
          imageX: (columnStart - timelineStart) / samplesPerPixel,
          imageWidth: VIDEO_THUMBNAIL_WIDTH,
          target: {
            placement,
            segment,
            filename: `${placement.clip.filename}_video_${segment.index}`,
            mediaTimeSeconds: mediaTime(sample),
          },
          startSeconds: mediaTime(sampleStart),
          endSeconds: mediaTime(sampleEnd),
        })
      }
    }
  }
  return tiles
}
