import {} from '../tests/StubAudio.js'
import { SimpleAnalyzerProcessor } from './SimpleAnalyzerProcessor.js'

test('tracks peak hold and rms in one pass', () => {
  global.sampleRate = 1000

  const instantaneousPeakOutput = new Float32Array(1)
  const heldPeakOutput = new Float32Array(1)
  const rmsOutput = new Float32Array(1)

  const processor = new SimpleAnalyzerProcessor({
    processorOptions: {
      instantaneousPeakOutput,
      heldPeakOutput,
      rmsOutput,
      updateSampleCount: 2,
      holdSampleCount: 4,
      rmsWindow: 4,
    },
  })

  const input = [new Float32Array([0.5, -0.25])]
  const output = [new Float32Array(2)]
  processor.process([input], [output])

  expect(Array.from(output[0])).toEqual([0.5, -0.25])
  expect(instantaneousPeakOutput[0]).toBeCloseTo(0.5)
  expect(heldPeakOutput[0]).toBeCloseTo(0.5)
  expect(rmsOutput[0]).toBeCloseTo(Math.sqrt((0.25 + 0.0625) / 2))

  input[0].set([0.1, -0.1])
  processor.process([input], [output])

  expect(instantaneousPeakOutput[0]).toBeCloseTo(0.1)
  expect(heldPeakOutput[0]).toBeCloseTo(0.5)
  expect(rmsOutput[0]).toBeCloseTo(Math.sqrt((0.25 + 0.0625 + 0.01 + 0.01) / 4))

  input[0].set([0.2, -0.2])
  processor.process([input], [output])

  expect(instantaneousPeakOutput[0]).toBeCloseTo(0.2)
  expect(heldPeakOutput[0]).toBeCloseTo(0.2)
})

test('tracks stereo channels independently', () => {
  global.sampleRate = 1000

  const instantaneousPeakOutput = new Float32Array(2)
  const heldPeakOutput = new Float32Array(2)
  const rmsOutput = new Float32Array(2)
  const processor = new SimpleAnalyzerProcessor({
    processorOptions: {
      instantaneousPeakOutput,
      heldPeakOutput,
      rmsOutput,
      updateSampleCount: 2,
      holdSampleCount: 2,
      rmsWindow: 2,
    },
  })

  const input = [new Float32Array([0.5, -0.25]), new Float32Array([0.1, -0.2])]
  const output = [new Float32Array(2), new Float32Array(2)]
  processor.process([input], [output])

  expect(Array.from(output[0])).toEqual([0.5, -0.25])
  expect(output[1][0]).toBeCloseTo(0.1)
  expect(output[1][1]).toBeCloseTo(-0.2)
  expect(instantaneousPeakOutput[0]).toBeCloseTo(0.5)
  expect(instantaneousPeakOutput[1]).toBeCloseTo(0.2)
  expect(heldPeakOutput[0]).toBeCloseTo(0.5)
  expect(heldPeakOutput[1]).toBeCloseTo(0.2)
  expect(rmsOutput[0]).toBeCloseTo(Math.sqrt((0.25 + 0.0625) / 2))
  expect(rmsOutput[1]).toBeCloseTo(Math.sqrt((0.01 + 0.04) / 2))
})

test('rms returns to exactly zero after loud input is followed by silence', () => {
  global.sampleRate = 48000

  const instantaneousPeakOutput = new Float32Array(1)
  const heldPeakOutput = new Float32Array(1)
  const rmsOutput = new Float32Array(1)
  const processor = new SimpleAnalyzerProcessor({
    processorOptions: { instantaneousPeakOutput, heldPeakOutput, rmsOutput },
  })

  // Deterministic LCG noise so float rounding behaviour is reproducible.
  let seed = 1
  const input = [new Float32Array(128)]
  const output = [new Float32Array(128)]
  for (let block = 0; block < sampleRate / 128; ++block) {
    for (let i = 0; i < input[0].length; ++i) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      input[0][i] = (seed / 2 ** 32) * 2 - 1
    }
    processor.process([input], [output])
  }
  expect(rmsOutput[0]).toBeGreaterThan(0.5)

  // Mute: two default 400 ms windows of silence.
  input[0].fill(0)
  for (let block = 0; block < (0.8 * sampleRate) / 128; ++block) {
    processor.process([input], [output])
  }
  expect(rmsOutput[0]).toBe(0)
})
