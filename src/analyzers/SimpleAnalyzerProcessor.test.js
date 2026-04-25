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
