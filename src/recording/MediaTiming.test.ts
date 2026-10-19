import { describe, expect, test } from 'vitest'
import { getAudioChunkPlacement } from './MediaTiming'

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

  test.each([NaN, Infinity, -Infinity])('rejects nonfinite timestamps: %s', (timestamp) => {
    expect(() => getAudioChunkPlacement(timestamp, 0, 1024, 48000, 0, 0)).toThrow('Invalid media audio timing')
    expect(() => getAudioChunkPlacement(0, timestamp, 1024, 48000, 0, 0)).toThrow('Invalid media audio timing')
    expect(() => getAudioChunkPlacement(0, 0, 1024, 48000, 0, timestamp)).toThrow('Invalid media audio timing')
  })
})
