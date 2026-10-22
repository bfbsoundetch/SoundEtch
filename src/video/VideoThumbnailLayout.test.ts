import { expect, test } from 'vitest'
import type { VideoPlacement } from './VideoFrameResolver'
import { getVideoThumbnailTiles, VIDEO_LANE_HEIGHT } from './VideoThumbnailLayout'
import type { VideoThumbnailFrame } from './VideoThumbnailLayout'

const placement: VideoPlacement = {
  offset: 200,
  startPosition: 1000,
  length: 1000,
  clip: {
    filename: '17',
    videoSegments: [
      { index: 3, trackNumber: 2, startSample: 200, length: 1000, mediaStartSeconds: 12.5, mimeType: 'video/mp4' },
    ],
  },
}

function frame(
  placements: readonly VideoPlacement[] = [placement],
  options: Partial<VideoThumbnailFrame> = {},
): VideoThumbnailFrame {
  return {
    projectDirectory: 'project-1',
    sampleRate: 1000,
    timelineStart: 1000,
    samplesPerPixel: 1,
    cssWidth: 256,
    cssHeight: VIDEO_LANE_HEIGHT,
    dpr: 1,
    placements,
    ...options,
  }
}

test('filmstrip samples preserve clip offsets, nonzero presentation origins and the selected video stream', () => {
  const tiles = getVideoThumbnailTiles(frame([{ ...placement, offset: 350, length: 850 }]))
  expect(tiles.map((tile) => [tile.x, tile.width, tile.imageX, tile.imageWidth])).toEqual([
    [0, 128, 0, 128],
    [128, 128, 128, 128],
  ])
  expect(tiles.map((tile) => tile.target.filename)).toEqual(['17_video_3', '17_video_3'])
  expect(tiles[0].target.segment.trackNumber).toBe(2)
  expect(tiles[0].target.mediaTimeSeconds).toBeCloseTo(12.714)
  expect(tiles[1].target.mediaTimeSeconds).toBeCloseTo(12.842)
  // Any frame inside a column's half-open window may stand in for it, e.g. a nearby key frame.
  expect(tiles.map((tile) => [tile.startSeconds, tile.endSeconds])).toEqual([
    [expect.closeTo(12.65), expect.closeTo(12.778)],
    [expect.closeTo(12.778), expect.closeTo(12.906)],
  ])
})

test('panning clips existing image columns rather than changing their frame samples or squeezing the pictures', () => {
  const full = getVideoThumbnailTiles(frame())
  const clipped = getVideoThumbnailTiles(frame([placement], { timelineStart: 1040, cssWidth: 100 }))
  expect(clipped.map((tile) => [tile.x, tile.width, tile.imageX, tile.imageWidth])).toEqual([
    [0, 88, -40, 128],
    [88, 12, 88, 128],
  ])
  expect(clipped.map((tile) => tile.target.mediaTimeSeconds)).toEqual(full.map((tile) => tile.target.mediaTimeSeconds))
})

test('leading, interior and trailing footage gaps have no thumbnails, including exact half-open segment ends', () => {
  const segmented: VideoPlacement = {
    ...placement,
    offset: 0,
    length: 300,
    clip: {
      filename: '25',
      videoSegments: [
        { index: 0, trackNumber: 1, startSample: 20, length: 40, mediaStartSeconds: 5, mimeType: 'video/mp4' },
        { index: 1, trackNumber: 1, startSample: 180, length: 40, mediaStartSeconds: 9, mimeType: 'video/mp4' },
      ],
    },
  }
  const tiles = getVideoThumbnailTiles(frame([segmented]))
  expect(tiles.map((tile) => [tile.x, tile.width, tile.target.filename])).toEqual([
    [20, 40, '25_video_0'],
    [180, 40, '25_video_1'],
  ])
  expect(tiles[0].target.mediaTimeSeconds).toBeCloseTo(5.02)
  expect(tiles[1].target.mediaTimeSeconds).toBeCloseTo(9.02)
  expect(getVideoThumbnailTiles(frame([segmented], { timelineStart: 1060, cssWidth: 120 }))).toEqual([])
})

test('short and trimmed clips sample only their available source interval', () => {
  const trimmed = { ...placement, offset: 400, length: 40 }
  const [tile] = getVideoThumbnailTiles(frame([trimmed]))
  expect([tile.x, tile.width, tile.imageWidth]).toEqual([0, 40, 128])
  expect(tile.target.mediaTimeSeconds).toBeCloseTo(12.72)
  expect([tile.startSeconds, tile.endSeconds]).toEqual([expect.closeTo(12.7), expect.closeTo(12.74)])
  expect(getVideoThumbnailTiles(frame([trimmed], { timelineStart: 1040 }))).toEqual([])
})

test('moving or repeating a linked placement keeps source-time thumbnails independent of its timeline position', () => {
  const moved = { ...placement, startPosition: 4000 }
  const original = getVideoThumbnailTiles(frame())
  const shifted = getVideoThumbnailTiles(frame([moved], { timelineStart: 4000 }))
  expect(shifted.map((tile) => tile.target.mediaTimeSeconds)).toEqual(
    original.map((tile) => tile.target.mediaTimeSeconds),
  )
  const repeated = { ...placement, offset: 500, startPosition: 6000, length: 500 }
  const [first] = getVideoThumbnailTiles(frame([placement, repeated], { timelineStart: 6000 }))
  expect(first.target.mediaTimeSeconds).toBeCloseTo(12.864)
})

test('adjacent source segments change sidecar and timestamp at the cut without bleeding into each other', () => {
  const adjacent = {
    ...placement,
    offset: 0,
    length: 128,
    clip: {
      filename: '33',
      videoSegments: [
        { index: 0, trackNumber: 1, startSample: 0, length: 50, mediaStartSeconds: 3, mimeType: 'video/mp4' },
        { index: 2, trackNumber: 2, startSample: 50, length: 78, mediaStartSeconds: 10, mimeType: 'video/mp4' },
      ],
    },
  }
  const tiles = getVideoThumbnailTiles(frame([adjacent]))
  expect(tiles.map((tile) => [tile.x, tile.width, tile.target.filename])).toEqual([
    [0, 50, '33_video_0'],
    [50, 78, '33_video_2'],
  ])
  expect(tiles[0].target.mediaTimeSeconds).toBeCloseTo(3.025)
  expect(tiles[1].target.mediaTimeSeconds).toBeCloseTo(10.039)
})

test('zoomed long footage is planned only for the viewport, not for the whole source', () => {
  const long = {
    ...placement,
    length: 1_000_000_000,
    clip: { ...placement.clip, videoSegments: [{ ...placement.clip.videoSegments[0], length: 1_000_000_000 }] },
  }
  const tiles = getVideoThumbnailTiles(frame([long], { samplesPerPixel: 0.25, cssWidth: 384 }))
  expect(tiles.map((tile) => [tile.x, tile.width])).toEqual([
    [0, 128],
    [128, 128],
    [256, 128],
  ])
  expect(tiles.map((tile) => tile.target.mediaTimeSeconds)).toEqual([12.516, 12.548, 12.58])
})

test('audio-only clips and offscreen placements never request video frames', () => {
  const audio = { ...placement, clip: { filename: '44', videoSegments: [] } }
  expect(getVideoThumbnailTiles(frame([audio]))).toEqual([])
  expect(getVideoThumbnailTiles(frame([placement], { timelineStart: 2500 }))).toEqual([])
})

test.each([
  { cssWidth: 0 },
  { cssHeight: 0 },
  { samplesPerPixel: 0 },
  { samplesPerPixel: Number.POSITIVE_INFINITY },
  { timelineStart: Number.NaN },
  { sampleRate: Number.POSITIVE_INFINITY },
])('hidden or invalid timeline geometry cannot schedule decoding: %o', (options) => {
  expect(getVideoThumbnailTiles(frame([placement], options))).toEqual([])
})
