import { expect, test } from 'vitest'
import type { VideoSegment } from '../project/Video'
import { resolveVideoFrame } from './VideoFrameResolver'
import type { VideoPlacement } from './VideoFrameResolver'

const segments: VideoSegment[] = [
  { index: 0, trackNumber: 2, startSample: 200, length: 400, mediaStartSeconds: 12.5, mimeType: 'video/mp4' },
  { index: 3, trackNumber: 1, startSample: 700, length: 100, mediaStartSeconds: 4, mimeType: 'video/webm' },
]
const placement: VideoPlacement = {
  clip: { filename: '17', videoSegments: segments },
  offset: 100,
  startPosition: 1000,
  length: 800,
}

test('maps source offsets and nonzero timeline/segment origins to exact stored media timestamps', () => {
  const frame = resolveVideoFrame([{ ...placement, offset: 250, length: 300 }], 1025, 100)
  expect(frame).toMatchObject({ filename: '17_video_0', mediaTimeSeconds: 13.25, segment: { trackNumber: 2 } })
})

const boundaryCases: Array<[number, number | null]> = [
  [999, null],
  [1000, null],
  [1099, null],
  [1100, 12.5],
  [1499, 16.49],
  [1500, null],
  [1599, null],
  [1600, 4],
  [1699, 4.99],
  [1700, null],
  [1800, null],
]

test.each(boundaryCases)(
  'resolves half-open placements, segment boundaries and interior gaps at sample %i',
  (sample, time) => {
    const frame = resolveVideoFrame([placement], sample, 100)
    if (time === null) expect(frame).toBeNull()
    else expect(frame?.mediaTimeSeconds).toBeCloseTo(time, 10)
  },
)

test('a trimmed placement ends before the immutable segment ends', () => {
  const trimmed = { ...placement, offset: 250, length: 50 }
  expect(resolveVideoFrame([trimmed], 1000, 100)?.mediaTimeSeconds).toBe(13)
  expect(resolveVideoFrame([trimmed], 1049, 100)?.mediaTimeSeconds).toBeCloseTo(13.49)
  expect(resolveVideoFrame([trimmed], 1050, 100)).toBeNull()
})

test('split and copied placements retain the linked source clock rather than restarting the video', () => {
  const original = { ...placement, offset: 200, length: 400 }
  const left = { ...original, length: 123 }
  const right = { ...original, offset: original.offset + 123, startPosition: original.startPosition + 123, length: 277 }
  for (const sample of [1000, 1122, 1123, 1200, 1399]) {
    expect(resolveVideoFrame([left, right], sample, 100)?.mediaTimeSeconds).toBe(
      resolveVideoFrame([original], sample, 100)?.mediaTimeSeconds,
    )
  }
  const copied = { ...right, startPosition: 3000 }
  expect(resolveVideoFrame([copied], 3000, 100)?.mediaTimeSeconds).toBe(
    resolveVideoFrame([right], 1123, 100)?.mediaTimeSeconds,
  )
  expect(resolveVideoFrame([copied], 3277, 100)).toBeNull()
})

test('adjacent segments select the next sidecar and its exact video-stream ordinal at the boundary', () => {
  const adjacent = {
    ...placement,
    clip: { ...placement.clip, videoSegments: [segments[0], { ...segments[1], startSample: 600 }] },
  }
  expect(resolveVideoFrame([adjacent], 1499, 100)?.filename).toBe('17_video_0')
  expect(resolveVideoFrame([adjacent], 1500, 100)).toMatchObject({
    filename: '17_video_3',
    mediaTimeSeconds: 4,
    segment: { trackNumber: 1 },
  })
})

test('the latest video placement wins overlaps, without filling its source gaps from older footage', () => {
  const earlier = { ...placement, offset: 200, length: 400 }
  const later = { ...placement, startPosition: 1050, length: 200 }
  expect(resolveVideoFrame([earlier, later], 1049, 100)?.placement).toBe(earlier)
  expect(resolveVideoFrame([earlier, later], 1050, 100)).toBeNull()
  expect(resolveVideoFrame([earlier, later], 1150, 100)?.placement).toBe(later)
})

test('audio-only placements do not obscure footage, and an absent track resolves to black', () => {
  const footage = { ...placement, offset: 200 }
  const audio = { ...footage, clip: { filename: '18', videoSegments: [] } }
  expect(resolveVideoFrame([footage, audio], 1000, 100)?.placement).toBe(footage)
  expect(resolveVideoFrame([], 1000, 100)).toBeNull()
})
