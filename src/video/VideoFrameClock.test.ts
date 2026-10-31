import { expect, test } from 'vitest'
import { VideoFrameClock } from './VideoFrameClock'

test.each([22050, 44100, 48000, 96000])(
  'keeps picture timestamps aligned across uneven chunks at %i Hz',
  async (sampleRate) => {
    const length = Math.floor(sampleRate * 0.137) + 1
    const start = 12345
    const clock = new VideoFrameClock(sampleRate, 60, length, start)
    const frames: { timestamp: number; duration: number; sample: number }[] = []
    const consume = async (frame: number, timestamp: number, duration: number, sample: number) => {
      expect(frame).toBe(frames.length)
      frames.push({ timestamp, duration, sample })
    }
    await clock.addSamples(113, consume)
    await clock.addSamples(918, consume)
    await clock.addSamples(length - 1031, consume)
    await clock.addSamples(1024, consume)

    expect(frames).toHaveLength(Math.ceil((length * 60) / sampleRate))
    for (let frame = 0; frame < frames.length; ++frame) {
      expect(frames[frame].timestamp).toBe(frame / 60)
      expect(frames[frame].duration).toBeGreaterThan(0)
      expect(frames[frame].sample).toBe(start + (frame * sampleRate) / 60)
      if (frame + 1 < frames.length) {
        expect(frames[frame].timestamp + frames[frame].duration).toBeCloseTo(frames[frame + 1].timestamp, 12)
      }
    }
    const last = frames[frames.length - 1]
    expect(last.timestamp + last.duration).toBeCloseTo(length / sampleRate, 12)
  },
)

test('waits for complete sample windows and includes a one-sample final picture', async () => {
  const clock = new VideoFrameClock(48000, 60, 1601, 96001)
  const samples: number[] = []
  const durations: number[] = []
  const consume = async (_frame: number, _time: number, duration: number, sample: number) => {
    samples.push(sample)
    durations.push(duration)
  }
  await clock.addSamples(799, consume)
  expect(samples).toEqual([])
  await clock.addSamples(1, consume)
  expect(samples).toEqual([96001])
  await clock.addSamples(800, consume)
  expect(samples).toEqual([96001, 96801])
  await clock.addSamples(1, consume)
  expect(samples).toEqual([96001, 96801, 97601])
  expect(durations[2]).toBeCloseTo(1 / 48000, 12)
})

test('finishes exactly on a frame boundary without an extra picture', async () => {
  const clock = new VideoFrameClock(48000, 60, 48000)
  const times: number[] = []
  await clock.addSamples(48000, async (_frame, timestamp) => {
    times.push(timestamp)
    await Promise.resolve()
  })
  expect(times).toEqual(Array.from({ length: 60 }, (_, frame) => frame / 60))
})
