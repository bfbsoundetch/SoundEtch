/*!
 * Adapted from AudioJS Dynamics' limiter (MIT):
 * https://github.com/audiojs/dynamics/tree/main/packages/dynamics-limiter
 * Copyright (c) Dmitry Iv. See public/THIRD_PARTY_NOTICES.txt.
 */

const LOOKAHEAD_MS = 5
const MAX_CHANNELS = 32
// True-peak interpolation: a Kaiser-windowed sinc with this many taps per polyphase branch. Phase 0 is the
// input delayed by TRUE_PEAK_TAPS_PER_PHASE / 2 frames.
const TRUE_PEAK_TAPS_PER_PHASE = 36
const TRUE_PEAK_KAISER_BETA = 8

// Zeroth-order modified Bessel function of the first kind, for the Kaiser window.
function besselI0(x) {
  let sum = 1
  let term = 1
  for (let k = 1; k < 50; ++k) {
    term *= (x / (2 * k)) ** 2
    sum += term
  }
  return sum
}

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

    // Opt-in true-peak detection: the deque tracks the peak of the oversampled signal instead of the
    // sample peak. Detection is delayed by TRUE_PEAK_TAPS_PER_PHASE / 2 frames, which must stay inside the
    // lookahead window; below about 3.7 kHz it would not, so those rates fall back to sample-peak detection.
    const rate = processorSampleRate
    const oversampling = rate < 96000 ? 4 : rate < 192000 ? 2 : 1
    this.oversampling =
      processorOptions.truePeak === true && this.lookaheadSamples > TRUE_PEAK_TAPS_PER_PHASE / 2 ? oversampling : 1
    if (this.oversampling > 1) {
      const taps = TRUE_PEAK_TAPS_PER_PHASE * this.oversampling + 1 // 145 at 4x, 73 at 2x
      this.phaseLength = Math.ceil(taps / this.oversampling) // 37
      this.interpolationFilter = new Float64Array(this.oversampling * this.phaseLength)
      const windowNormalization = besselI0(TRUE_PEAK_KAISER_BETA)
      for (let j = 0; j < taps; ++j) {
        const m = (j - (taps - 1) / 2) / this.oversampling
        const sinc = m == 0 ? 1 : Math.sin(Math.PI * m) / (Math.PI * m)
        const x = (2 * j) / (taps - 1) - 1
        const kaiser = besselI0(TRUE_PEAK_KAISER_BETA * Math.sqrt(Math.max(0, 1 - x * x))) / windowNormalization
        this.interpolationFilter[(j % this.oversampling) * this.phaseLength + Math.floor(j / this.oversampling)] =
          sinc * kaiser
      }
      // Doubled ring per channel so the filter loop reads a contiguous window without modulo.
      this.interpolationHistory = new Float64Array(MAX_CHANNELS * 2 * this.phaseLength)
      this.historyPosition = 0
    }
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
      if (this.oversampling > 1) {
        peak = this.measureTruePeak(input, frame)
      } else {
        for (let channel = 0; channel < input.length; ++channel) {
          const sample = input[channel][frame]
          const magnitude = sample < 0 ? -sample : sample
          if (magnitude > peak) peak = magnitude
        }
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

  measureTruePeak(input, frame) {
    const phaseLength = this.phaseLength
    const filter = this.interpolationFilter
    const history = this.interpolationHistory
    const position = this.historyPosition
    let peak = 0
    for (let channel = 0; channel < input.length; ++channel) {
      const base = channel * 2 * phaseLength
      const sample = input[channel][frame]
      history[base + position] = sample
      history[base + position + phaseLength] = sample
      const newest = base + position + phaseLength
      for (let phase = 0; phase < this.oversampling; ++phase) {
        const taps = phase * phaseLength
        let y = 0
        for (let k = 0; k < phaseLength; ++k) y += filter[taps + k] * history[newest - k]
        const magnitude = y < 0 ? -y : y
        if (magnitude > peak) peak = magnitude
      }
    }
    this.historyPosition = (position + 1) % phaseLength
    return peak
  }
}

if (typeof globalThis.registerProcessor == 'function') {
  globalThis.registerProcessor('soundetch-limiter', LimiterProcessor)
}
