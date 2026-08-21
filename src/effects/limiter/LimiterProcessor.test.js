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
})
