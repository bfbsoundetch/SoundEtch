const LOOKAHEAD_MS = 5
const MAX_CHANNELS = 32

const ProcessorBase = globalThis.AudioWorkletProcessor ?? class {}

// Lookahead brickwall limiter using a monotonic deque for O(1) peak lookup.
export class LimiterProcessor extends ProcessorBase {
  static get parameterDescriptors() {
    return [
      {
        name: 'ceiling',
        defaultValue: -0.3,
        minValue: -20,
        maxValue: 0,
        automationRate: 'a-rate',
      },
      {
        name: 'release',
        defaultValue: 50,
        minValue: 1,
        maxValue: 1000,
        automationRate: 'a-rate',
      },
    ]
  }

  constructor(options = {}) {
    super(options)

    const processorOptions = options.processorOptions ?? {}
    const processorSampleRate = processorOptions.sampleRate ?? globalThis.sampleRate ?? 48000
    this.lookaheadSamples = Math.max(1, Math.round((LOOKAHEAD_MS * processorSampleRate) / 1000))
    this.sampleRate = processorSampleRate

    this.delay = new Float32Array(this.lookaheadSamples * MAX_CHANNELS)
    this.delayPosition = 0
    this.pendingSamples = 0
    this.envelope = 0

    const windowSize = this.lookaheadSamples + 1
    this.peakValues = new Float32Array(windowSize)
    this.peakIndices = new Float64Array(windowSize)
    this.queueHead = 0
    this.queueTail = 0
    this.sampleIndex = 0

    this.lastRelease = -1
    this.releaseCoefficient = 0
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0] ?? []
    const output = outputs[0] ?? []
    const frameCount = output[0]?.length ?? input[0]?.length ?? 0
    const channelCount = Math.min(MAX_CHANNELS, Math.max(input.length, output.length))
    const ceilingValues = parameters.ceiling
    const releaseValues = parameters.release
    const windowSize = this.peakValues.length

    for (let frame = 0; frame < frameCount; ++frame) {
      let peak = 0
      for (let channel = 0; channel < input.length; ++channel) {
        const sample = input[channel][frame]
        const magnitude = sample < 0 ? -sample : sample
        if (magnitude > peak) peak = magnitude
      }

      while (this.queueTail > this.queueHead && this.peakValues[(this.queueTail - 1) % windowSize] <= peak) {
        --this.queueTail
      }
      this.peakValues[this.queueTail % windowSize] = peak
      this.peakIndices[this.queueTail % windowSize] = this.sampleIndex
      ++this.queueTail
      if (this.peakIndices[this.queueHead % windowSize] < this.sampleIndex - this.lookaheadSamples) {
        ++this.queueHead
      }

      const release = releaseValues.length == 1 ? releaseValues[0] : releaseValues[frame]
      if (release != this.lastRelease) {
        this.releaseCoefficient = Math.exp(-1 / (Math.max(1, release) * 0.001 * this.sampleRate))
        this.lastRelease = release
      }
      const windowPeak = this.peakValues[this.queueHead % windowSize]
      this.envelope = this.releaseCoefficient * this.envelope + (1 - this.releaseCoefficient) * windowPeak
      if (windowPeak > this.envelope) this.envelope = windowPeak

      const ceilingDb = ceilingValues.length == 1 ? ceilingValues[0] : ceilingValues[frame]
      const ceiling = 10 ** (ceilingDb / 20)
      const gain = this.envelope > ceiling ? ceiling / this.envelope : 1
      const delayOffset = this.delayPosition * MAX_CHANNELS

      for (let channel = 0; channel < channelCount; ++channel) {
        const sample = input[channel]?.[frame] ?? 0
        if (output[channel]) {
          output[channel][frame] =
            this.pendingSamples < this.lookaheadSamples ? 0 : this.delay[delayOffset + channel] * gain
        }
        this.delay[delayOffset + channel] = sample
      }

      this.delayPosition = (this.delayPosition + 1) % this.lookaheadSamples
      if (this.pendingSamples < this.lookaheadSamples) ++this.pendingSamples
      ++this.sampleIndex
    }

    return true
  }
}

if (typeof globalThis.registerProcessor == 'function') {
  globalThis.registerProcessor('soundetch-limiter', LimiterProcessor)
}
