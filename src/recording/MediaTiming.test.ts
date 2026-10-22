import { describe, expect, test } from 'vitest'
import { getAudioChunkPlacement, getMediaPresentation } from './MediaTiming'

describe('getAudioChunkPlacement', () => {
  test.each([48000, 44100])('preserves a half-second audio delay at %i Hz before resampling', (rate) => {
    expect(getAudioChunkPlacement(7_000_000, 7_000_000, 1024, rate, 0, 0.5)).toEqual({
      gapFrames: rate / 2,
      skipFrames: 0,
    })
  })

  test.each([48000, 44100])('preserves interior timestamp gaps at %i Hz', (rate) => {
    expect(getAudioChunkPlacement(10_750_000, 10_000_000, rate / 10, rate, rate / 4, 0)).toEqual({
      gapFrames: rate / 2,
      skipFrames: 0,
    })
  })

  test.each([48000, 44100])('drops only duplicated overlap frames at %i Hz', (rate) => {
    expect(getAudioChunkPlacement(1_500_000, 1_000_000, rate / 2, rate, (rate * 3) / 4, 0)).toEqual({
      gapFrames: 0,
      skipFrames: rate / 4,
    })
  })

  test('combines a real PTS origin, leading delay, gap and overlap across successive chunks', () => {
    const rate = 48000
    let framesWritten = 0
    const chunks = [
      { timestamp: 30_000_000, frameCount: 4800 },
      { timestamp: 30_200_000, frameCount: 4800 },
      { timestamp: 30_250_000, frameCount: 4800 },
    ]
    const placements = chunks.map(({ timestamp, frameCount }) => {
      const placement = getAudioChunkPlacement(timestamp, chunks[0]!.timestamp, frameCount, rate, framesWritten, 0.5)
      framesWritten += placement.gapFrames + frameCount - placement.skipFrames
      return placement
    })
    expect(placements).toEqual([
      { gapFrames: 24000, skipFrames: 0 },
      { gapFrames: 4800, skipFrames: 0 },
      { gapFrames: 0, skipFrames: 2400 },
    ])
    expect(framesWritten).toBe(40800)
  })

  test('drops a completely duplicated chunk without moving the existing end', () => {
    expect(getAudioChunkPlacement(1_000_000, 1_000_000, 1024, 48000, 4096, 0)).toEqual({
      gapFrames: 0,
      skipFrames: 1024,
    })
  })

  test('rounds timestamp placement once in source-rate frames', () => {
    expect(getAudioChunkPlacement(34, 0, 100, 44100, 0, 0)).toEqual({ gapFrames: 1, skipFrames: 0 })
    expect(getAudioChunkPlacement(35, 0, 100, 44100, 0, 0)).toEqual({ gapFrames: 2, skipFrames: 0 })
  })

  test('discards negative-offset pre-roll across a chunk boundary without inserting a gap', () => {
    const rate = 44100
    let framesWritten = 0
    const placements = [0, 23_220, 46_440].map((timestamp) => {
      const placement = getAudioChunkPlacement(timestamp, 0, 1024, rate, framesWritten, -1500 / rate)
      framesWritten += placement.gapFrames + 1024 - placement.skipFrames
      return placement
    })
    expect(placements).toEqual([
      { gapFrames: 0, skipFrames: 1024 },
      { gapFrames: 0, skipFrames: 476 },
      { gapFrames: 0, skipFrames: 0 },
    ])
    expect(framesWritten).toBe(3 * 1024 - 1500)
  })

  test.each([NaN, Infinity, -Infinity])('rejects nonfinite timestamps: %s', (timestamp) => {
    expect(() => getAudioChunkPlacement(timestamp, 0, 1024, 48000, 0, 0)).toThrow('Invalid media audio timing')
    expect(() => getAudioChunkPlacement(0, timestamp, 1024, 48000, 0, 0)).toThrow('Invalid media audio timing')
    expect(() => getAudioChunkPlacement(0, 0, 1024, 48000, 0, timestamp)).toThrow('Invalid media audio timing')
  })
})

describe('getMediaPresentation', () => {
  test('AAC priming behind an edit list is discarded instead of delaying the picture', () => {
    const presentation = getMediaPresentation(0, 60, -1024 / 44100, 48000)
    expect(presentation).toMatchObject({ videoStartSample: 0, videoLength: 2_880_000, videoMediaStartSeconds: 0 })
    // The first 1024 decoded source frames are priming.
    expect(presentation.leadingAudioOffsetSeconds * 44100).toBeCloseTo(-1024)
  })

  test('a stream-copy cut starts at the edit, not at the earlier key frame both streams carry', () => {
    expect(getMediaPresentation(-1, 7, -1.003084, 48000)).toEqual({
      videoStartSample: 0,
      videoLength: 336_000,
      videoMediaStartSeconds: 0,
      leadingAudioOffsetSeconds: -1.003084,
    })
    expect(getMediaPresentation(-0.5, 2, null, 48000)).toEqual({
      videoStartSample: 0,
      videoLength: 96_000,
      videoMediaStartSeconds: 0,
      leadingAudioOffsetSeconds: 0,
    })
  })

  test('presented leading delays and nonzero origins keep their relative timing', () => {
    expect(getMediaPresentation(1.4, 11.4, 1.38, 48000)).toMatchObject({
      videoStartSample: 960,
      videoMediaStartSeconds: 1.4,
      leadingAudioOffsetSeconds: 0,
    })
    expect(getMediaPresentation(0, 10, 0.5, 48000)).toMatchObject({
      videoStartSample: 0,
      leadingAudioOffsetSeconds: 0.5,
    })
    expect(getMediaPresentation(-0.2, 10, 0.3, 48000)).toMatchObject({
      videoStartSample: 0,
      videoMediaStartSeconds: 0,
      leadingAudioOffsetSeconds: 0.3,
    })
  })

  test('rejects footage that is never presented or has nonfinite timing', () => {
    expect(() => getMediaPresentation(-2, 0, null, 48000)).toThrow('no finite, nonempty presentation interval')
    expect(() => getMediaPresentation(NaN, 5, null, 48000)).toThrow('no finite, nonempty presentation interval')
    expect(() => getMediaPresentation(0, 5, NaN, 48000)).toThrow('Audio stream has no finite presentation timestamp')
  })
})
