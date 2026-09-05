/*!
 * Adapted from AudioJS Dynamics' de-esser (MIT):
 * https://github.com/audiojs/dynamics/tree/main/packages/dynamics-deesser
 * Copyright (c) Dmitry Iv. See public/THIRD_PARTY_NOTICES.txt.
 */

const MAX_CHANNELS = 32

const ProcessorBase = globalThis.AudioWorkletProcessor ?? class {}

// Broadband de-esser: a bandpass sidechain drives linked gain reduction on the full signal.
export class DeesserProcessor extends ProcessorBase {
  static get parameterDescriptors() {
    return [
      { name: 'freq', defaultValue: 6500, minValue: 2000, maxValue: 16000, automationRate: 'a-rate' },
      { name: 'q', defaultValue: 2, minValue: 0.3, maxValue: 10, automationRate: 'a-rate' },
      { name: 'threshold', defaultValue: -20, minValue: -60, maxValue: 0, automationRate: 'a-rate' },
      { name: 'ratio', defaultValue: 4, minValue: 1, maxValue: 20, automationRate: 'a-rate' },
      { name: 'knee', defaultValue: 6, minValue: 0, maxValue: 24, automationRate: 'a-rate' },
      { name: 'attack', defaultValue: 1, minValue: 0.1, maxValue: 100, automationRate: 'a-rate' },
      { name: 'release', defaultValue: 40, minValue: 1, maxValue: 1000, automationRate: 'a-rate' },
    ]
  }

  constructor(options = {}) {
    super(options)

    const processorOptions = options.processorOptions ?? {}
    this.sampleRate = processorOptions.sampleRate ?? globalThis.sampleRate ?? 48000
    this.bandpassState = new Float64Array(MAX_CHANNELS * 2)
    this.envelope = 0

    this.lastFrequency = -1
    this.lastQ = -1
    this.b0 = 0
    this.b2 = 0
    this.a1 = 0
    this.a2 = 0

    this.lastAttack = -1
    this.lastRelease = -1
    this.attackCoefficient = 0
    this.releaseCoefficient = 0
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0] ?? []
    const output = outputs[0] ?? []
    const frameCount = output[0]?.length ?? input[0]?.length ?? 0
    const inputChannelCount = Math.min(MAX_CHANNELS, input.length)
    const outputChannelCount = Math.min(MAX_CHANNELS, output.length)

    for (let frame = 0; frame < frameCount; ++frame) {
      this.updateBandpass(parameterValue(parameters.freq, frame), parameterValue(parameters.q, frame))

      let sidechainPeak = 0
      for (let channel = 0; channel < inputChannelCount; ++channel) {
        const sample = input[channel][frame] ?? 0
        const stateOffset = channel * 2
        const sidechain = this.b0 * sample + this.bandpassState[stateOffset]
        this.bandpassState[stateOffset] = -this.a1 * sidechain + this.bandpassState[stateOffset + 1]
        this.bandpassState[stateOffset + 1] = this.b2 * sample - this.a2 * sidechain
        const magnitude = sidechain < 0 ? -sidechain : sidechain
        if (magnitude > sidechainPeak) sidechainPeak = magnitude
      }

      const attack = parameterValue(parameters.attack, frame)
      if (attack != this.lastAttack) {
        this.attackCoefficient = timeCoefficient(attack, this.sampleRate)
        this.lastAttack = attack
      }
      const release = parameterValue(parameters.release, frame)
      if (release != this.lastRelease) {
        this.releaseCoefficient = timeCoefficient(release, this.sampleRate)
        this.lastRelease = release
      }

      const envelopeCoefficient = sidechainPeak > this.envelope ? this.attackCoefficient : this.releaseCoefficient
      this.envelope = envelopeCoefficient * this.envelope + (1 - envelopeCoefficient) * sidechainPeak

      const levelDb = 20 * Math.log10(Math.max(this.envelope, 1e-10))
      const threshold = parameterValue(parameters.threshold, frame)
      const ratio = Math.max(1, parameterValue(parameters.ratio, frame))
      const knee = Math.max(0, parameterValue(parameters.knee, frame))
      const gainDb = compressorGain(levelDb, threshold, ratio, knee)
      const gain = gainDb == 0 ? 1 : 10 ** (gainDb / 20)

      for (let channel = 0; channel < outputChannelCount; ++channel) {
        output[channel][frame] = (input[channel]?.[frame] ?? 0) * gain
      }
    }

    return true
  }

  updateBandpass(frequency, q) {
    const safeFrequency = Math.min(Math.max(1, frequency), this.sampleRate * 0.499)
    const safeQ = Math.max(0.001, q)
    if (safeFrequency == this.lastFrequency && safeQ == this.lastQ) return

    const radians = (2 * Math.PI * safeFrequency) / this.sampleRate
    const cosine = Math.cos(radians)
    const alpha = Math.sin(radians) / (2 * safeQ)
    const a0 = 1 + alpha

    this.b0 = alpha / a0
    this.b2 = -this.b0
    this.a1 = (-2 * cosine) / a0
    this.a2 = (1 - alpha) / a0
    this.lastFrequency = safeFrequency
    this.lastQ = safeQ
  }
}

function parameterValue(values, frame) {
  return values.length == 1 ? values[0] : values[frame]
}

function timeCoefficient(milliseconds, sampleRate) {
  return milliseconds <= 0 ? 0 : Math.exp(-1 / (milliseconds * 0.001 * sampleRate))
}

// Soft-knee downward compressor curve. Returns gain reduction in dB.
function compressorGain(levelDb, threshold, ratio, knee) {
  const distance = levelDb - threshold
  if (distance < -knee / 2) return 0
  if (distance >= knee / 2) return -(distance * (1 - 1 / ratio))
  const kneePosition = distance + knee / 2
  return -((1 - 1 / ratio) * kneePosition * kneePosition) / (2 * knee)
}

if (typeof globalThis.registerProcessor == 'function') {
  globalThis.registerProcessor('soundetch-deesser', DeesserProcessor)
}
