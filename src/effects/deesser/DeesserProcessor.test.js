import {} from '../../tests/StubAudio.js'
import { DeesserProcessor } from './DeesserProcessor.js'

const defaults = {
  freq: 6500,
  q: 2,
  threshold: -20,
  ratio: 4,
  knee: 6,
  attack: 1,
  release: 40,
}

function process(processor, input, values = {}) {
  const output = input.map((channel) => new Float32Array(channel.length))
  const parameters = Object.fromEntries(
    Object.entries({ ...defaults, ...values }).map(([name, value]) => [name, Float32Array.of(value)]),
  )
  processor.process([input], [output], parameters)
  return output
}

function sine(frequency, amplitude, length) {
  return Float32Array.from(
    { length },
    (_, frame) => amplitude * Math.sin((2 * Math.PI * frequency * frame) / global.sampleRate),
  )
}

function rms(values, start = 0) {
  let sum = 0
  for (let index = start; index < values.length; ++index) sum += values[index] ** 2
  return Math.sqrt(sum / (values.length - start))
}

describe('DeesserProcessor', () => {
  beforeEach(() => {
    global.sampleRate = 48000
  })

  test('attenuates the configured sibilance band without statically cutting lower frequencies', () => {
    const length = 4800
    const sibilance = sine(6500, 0.8, length)
    const lowFrequency = sine(500, 0.8, length)
    const settings = { threshold: -30, ratio: 20, knee: 0, attack: 0.1 }

    const [sibilanceOutput] = process(new DeesserProcessor(), [sibilance], settings)
    const [lowFrequencyOutput] = process(new DeesserProcessor(), [lowFrequency], settings)
    const settledFrame = 2400

    expect(rms(sibilanceOutput, settledFrame)).toBeLessThan(rms(sibilance, settledFrame) * 0.2)
    expect(rms(lowFrequencyOutput, settledFrame)).toBeGreaterThan(rms(lowFrequency, settledFrame) * 0.95)
  })

  test('links gain reduction across channels to preserve the stereo image', () => {
    const length = 4800
    const sibilance = sine(6500, 0.8, length)
    const lowFrequency = sine(500, 0.2, length)
    const settings = { threshold: -30, ratio: 20, knee: 0, attack: 0.1 }

    const [, linkedOutput] = process(new DeesserProcessor(), [sibilance, lowFrequency], settings)
    const [unlinkedOutput] = process(new DeesserProcessor(), [lowFrequency], settings)

    expect(rms(linkedOutput, 2400)).toBeLessThan(rms(unlinkedOutput, 2400) * 0.2)
  })

  test('preserves filter and envelope state across render quanta', () => {
    const input = sine(6500, 0.8, 4096)
    const settings = { threshold: -30, ratio: 8 }
    const wholeOutput = process(new DeesserProcessor(), [input], settings)[0]
    const chunkedProcessor = new DeesserProcessor()
    const firstOutput = process(chunkedProcessor, [input.subarray(0, 1000)], settings)[0]
    const secondOutput = process(chunkedProcessor, [input.subarray(1000)], settings)[0]
    const chunkedOutput = new Float32Array(input.length)
    chunkedOutput.set(firstOutput)
    chunkedOutput.set(secondOutput, firstOutput.length)

    expect(chunkedOutput).toEqual(wholeOutput)
  })
})
