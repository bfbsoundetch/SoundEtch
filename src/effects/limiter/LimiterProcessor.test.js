import {} from '../../tests/StubAudio.js'
import { LimiterProcessor } from './LimiterProcessor.js'

function process(processor, input, ceiling = 0, release = 50) {
  const output = input.map((channel) => new Float32Array(channel.length))
  processor.process([input], [output], {
    ceiling: new Float32Array([ceiling]),
    release: new Float32Array([release]),
  })
  return output
}

describe('LimiterProcessor', () => {
  beforeEach(() => {
    global.sampleRate = 1000
  })

  test('delays the signal and prevents peaks from exceeding the ceiling', () => {
    const processor = new LimiterProcessor()
    const input = new Float32Array([0, 2, 0, 0, 0, 0, 0, 0])

    const [output] = process(processor, [input])

    expect(Array.from(output.slice(0, 5))).toEqual([0, 0, 0, 0, 0])
    expect(output[6]).toBeCloseTo(1)
    expect(Math.max(...output.map(Math.abs))).toBeLessThanOrEqual(1)
  })

  test('uses one linked gain envelope for every channel', () => {
    const processor = new LimiterProcessor()
    const left = new Float32Array([2, 0, 0, 0, 0, 0])
    const right = new Float32Array([0.5, 0, 0, 0, 0, 0])

    const [leftOutput, rightOutput] = process(processor, [left, right])

    expect(leftOutput[5]).toBeCloseTo(1)
    expect(rightOutput[5]).toBeCloseTo(0.25)
  })

  test('preserves state across render quanta', () => {
    const processor = new LimiterProcessor()

    process(processor, [new Float32Array([2, 0, 0])])
    const [output] = process(processor, [new Float32Array([0, 0, 0])])

    expect(output[2]).toBeCloseTo(1)
  })

  test('true-peak mode limits inter-sample peaks that sample-peak mode misses', () => {
    // Samples sit at ±0.7071 while the reconstructed waveform peaks at 1.0 between them.
    const input = Float32Array.from({ length: 4800 }, (_, n) => Math.sin((Math.PI / 2) * n + Math.PI / 4))
    const samplePeak = new LimiterProcessor({ processorOptions: { sampleRate: 48000 } })
    const truePeak = new LimiterProcessor({ processorOptions: { sampleRate: 48000, truePeak: true } })

    const [samplePeakOutput] = process(samplePeak, [input], -1)
    const [truePeakOutput] = process(truePeak, [input], -1)

    const steadyStateMax = (output) => Math.max(...output.slice(2400).map(Math.abs))
    expect(steadyStateMax(samplePeakOutput)).toBeCloseTo(Math.SQRT1_2, 4)
    expect(steadyStateMax(truePeakOutput)).toBeCloseTo(Math.SQRT1_2 * 10 ** (-1 / 20), 2)
  })

  test('true-peak mode holds near-Nyquist sines at the ceiling', () => {
    // A 20 kHz sine at 48 kHz meets the 4x grid at 48 distinct phases, so this measures filter accuracy near Nyquist.
    const input = Float32Array.from({ length: 9600 }, (_, n) => Math.sin((2 * Math.PI * 20000 * n) / 48000 + 0.3))
    const processor = new LimiterProcessor({ processorOptions: { sampleRate: 48000, truePeak: true } })

    const [output] = process(processor, [input], -1)

    const steadyStateMax = (samples) => Math.max(...samples.slice(4800).map(Math.abs))
    const gainDb = 20 * Math.log10(steadyStateMax(output) / steadyStateMax(input))
    expect(gainDb).toBeLessThanOrEqual(-0.95)
    expect(gainDb).toBeGreaterThanOrEqual(-1.1)
  })
})
