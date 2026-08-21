import {} from '../../tests/StubAudio.js'
import { GateProcessor } from './GateProcessor.js'

const defaults = {
  threshold: -40,
  closeThreshold: -46,
  range: -60,
  hold: 10,
  attack: 0.1,
  release: 100,
  lookahead: 0,
}

function process(processor, input, values = {}) {
  const output = input.map((channel) => new Float32Array(channel.length))
  const parameters = Object.fromEntries(
    Object.entries({ ...defaults, ...values }).map(([name, value]) => [name, Float32Array.of(value)]),
  )
  processor.process([input], [output], parameters)
  return output
}

describe('GateProcessor', () => {
  beforeEach(() => {
    global.sampleRate = 1000
  })

  test('attenuates signals below the open threshold by the configured range', () => {
    const processor = new GateProcessor()
    const [output] = process(processor, [Float32Array.of(0.1)], {
      threshold: 0,
      closeThreshold: -6,
      range: -20,
      release: 1,
    })

    expect(output[0]).toBeCloseTo(0.01)
  })

  test('uses lookahead to open before a transient is emitted', () => {
    const processor = new GateProcessor()
    const input = Float32Array.of(1, 0, 0, 0, 0, 0)
    const [output] = process(processor, [input], { lookahead: 5 })

    expect(Array.from(output.slice(0, 5))).toEqual([0, 0, 0, 0, 0])
    expect(output[5]).toBeCloseTo(1)
  })

  test('uses one linked gate gain for every channel', () => {
    const processor = new GateProcessor()
    const left = Float32Array.of(1, 0, 0, 0, 0, 0)
    const right = Float32Array.of(0.25, 0, 0, 0, 0, 0)
    const [leftOutput, rightOutput] = process(processor, [left, right], { lookahead: 5 })

    expect(leftOutput[5]).toBeCloseTo(1)
    expect(rightOutput[5]).toBeCloseTo(0.25)
  })

  test('preserves lookahead and hold state across render quanta', () => {
    const processor = new GateProcessor()

    process(processor, [Float32Array.of(1, 0, 0)], { lookahead: 5, hold: 10 })
    const [output] = process(processor, [Float32Array.of(0, 0, 0)], { lookahead: 5, hold: 10 })

    expect(output[2]).toBeCloseTo(1)
  })
})
