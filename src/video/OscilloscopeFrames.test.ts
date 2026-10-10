import { expect, test } from 'vitest'
import { OscilloscopeFrames } from './OscilloscopeFrames'

test.each([22050, 44100, 48000, 96000])('preserves every signed sample across chunks at %i Hz', async (sampleRate) => {
  const length = Math.floor(sampleRate * 0.137) + 1
  const audio = Float32Array.from({ length }, (_, i) => (i % 101) / 50 - 1)
  const scope = new OscilloscopeFrames(sampleRate, 60, length, 1)
  const frames: Array<Array<number>> = []
  const consume = async (samples: Float32Array, count: number, frame: number) => {
    expect(frame).toBe(frames.length)
    frames.push(Array.from(samples.subarray(0, count)))
  }
  // Neither chunk boundary is aligned with a video frame.
  await scope.addAudio(audio.subarray(0, 113), consume)
  await scope.addAudio(audio.subarray(113, 1031), consume)
  await scope.addAudio(audio.subarray(1031), consume)

  expect(frames.flat()).toEqual(Array.from(audio))
  expect(frames.map((frame) => frame.length)).toEqual(
    Array.from(
      { length: Math.ceil((length * 60) / sampleRate) },
      (_, frame) =>
        Math.min(length, Math.floor(((frame + 1) * sampleRate) / 60)) - Math.floor((frame * sampleRate) / 60),
    ),
  )
})

test('folds stereo down with signed amplitudes and preserves gain, DC, and phase cancellation', async () => {
  const scope = new OscilloscopeFrames(48000, 60, 5, 2)
  const frames: Array<Array<number>> = []
  const consume = async (samples: Float32Array, count: number) => {
    frames.push(Array.from(samples.subarray(0, count)))
  }
  await scope.addAudio(new Float32Array([0.5, 0.5, -0.75, -0.25]), consume)
  await scope.addAudio(new Float32Array([1, -1, 0, 0, 2, 2]), consume)
  expect(frames).toEqual([[0.5, -0.5, 0, 0, 2]])
})

test('emits a one-sample final window without padding or stale data', async () => {
  const scope = new OscilloscopeFrames(48000, 60, 801, 1)
  const audio = new Float32Array(801).fill(0.75)
  audio[800] = -0.25
  const frames: Array<Array<number>> = []
  await scope.addAudio(audio, async (samples, count) => {
    const before = Array.from(samples.subarray(0, count))
    await Promise.resolve()
    expect(Array.from(samples.subarray(0, count))).toEqual(before)
    frames.push(before)
  })
  expect(frames).toEqual([new Array(800).fill(0.75), [-0.25]])
})
