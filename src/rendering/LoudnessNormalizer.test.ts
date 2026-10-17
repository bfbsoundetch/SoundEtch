import { LoudnessNormalizer } from './LoudnessNormalizer'

function noise(sampleCount: number) {
  const samples = new Float32Array(sampleCount)
  let seed = 12345
  for (let i = 0; i < sampleCount; ++i) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    samples[i] = 0.4 * (seed / 2 ** 31 - 1)
  }
  return samples
}

describe('LoudnessNormalizer', () => {
  test.each([0, 10, 240, 100000])('outputs %i frames sample-aligned with the input', (frameCount) => {
    const channelCount = 2
    const chunkFrames = 4099
    const input = noise(frameCount * channelCount)
    const normalizer = new LoudnessNormalizer(48000, channelCount, 0.5, -1)

    const chunks: Float32Array[] = []
    for (let start = 0; start < input.length; start += chunkFrames * channelCount) {
      chunks.push(normalizer.process(input.subarray(start, start + chunkFrames * channelCount)))
    }
    chunks.push(normalizer.finish())
    const output = new Float32Array(chunks.reduce((total, chunk) => total + chunk.length, 0))
    chunks.reduce((offset, chunk) => (output.set(chunk, offset), offset + chunk.length), 0)

    expect(output.length / channelCount).toBe(frameCount)
    for (let i = 0; i < input.length; ++i) expect(output[i]).toBeCloseTo(input[i] * 0.5, 6)
  })
})
