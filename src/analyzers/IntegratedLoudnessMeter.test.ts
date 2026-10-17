import { IntegratedLoudnessMeter } from './IntegratedLoudnessMeter'

const SAMPLE_RATE = 48000

// Interleaved 1 kHz sine; each segment is [seconds, dBFS].
function sine(channelCount: number, segments: [number, number][]) {
  const frameCount = segments.reduce((total, [seconds]) => total + seconds * SAMPLE_RATE, 0)
  const samples = new Float32Array(frameCount * channelCount)
  let frame = 0
  for (const [seconds, dbfs] of segments) {
    const amplitude = 10 ** (dbfs / 20)
    for (const end = frame + seconds * SAMPLE_RATE; frame < end; ++frame) {
      const value = amplitude * Math.sin((2 * Math.PI * 1000 * frame) / SAMPLE_RATE)
      for (let channel = 0; channel < channelCount; ++channel) samples[frame * channelCount + channel] = value
    }
  }
  return samples
}

function measure(channelCount: number, samples: Float32Array) {
  const meter = new IntegratedLoudnessMeter(SAMPLE_RATE, channelCount)
  meter.addInterleaved(samples)
  return meter.getIntegratedLoudness()
}

describe('IntegratedLoudnessMeter', () => {
  test('measures a stereo -23 dBFS 1 kHz sine as -23 LUFS (EBU Tech 3341 case 1)', () => {
    expect(measure(2, sine(2, [[20, -23]]))).toBeCloseTo(-23, 1)
  })

  test('relative gate excludes quiet passages more than 10 LU below the program', () => {
    const samples = sine(2, [
      [10, -36],
      [60, -23],
      [10, -36],
    ])
    expect(measure(2, samples)).toBeCloseTo(-23, 1)
  })

  test('measures mono as a single channel', () => {
    expect(measure(1, sine(1, [[20, -23]]))).toBeCloseTo(-26, 1)
  })

  test('returns -Infinity when no block passes the absolute gate', () => {
    expect(measure(2, new Float32Array(SAMPLE_RATE * 2 * 5))).toBe(-Infinity)
  })

  test('chunk boundaries do not change the result', () => {
    const samples = sine(2, [[20, -23]])
    const expected = measure(2, samples)
    for (const chunkFrames of [1, 4799, 100003]) {
      const meter = new IntegratedLoudnessMeter(SAMPLE_RATE, 2)
      for (let start = 0; start < samples.length; start += chunkFrames * 2) {
        meter.addInterleaved(samples.subarray(start, start + chunkFrames * 2))
      }
      expect(Math.abs(meter.getIntegratedLoudness() - expected)).toBeLessThan(1e-9)
    }
  })
})
