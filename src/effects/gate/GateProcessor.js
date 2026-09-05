/*!
 * Adapted from AudioJS Dynamics' gate (MIT):
 * https://github.com/audiojs/dynamics/tree/main/packages/dynamics-gate
 * Copyright (c) Dmitry Iv. See public/THIRD_PARTY_NOTICES.txt.
 */

const MAX_CHANNELS = 32
const MAX_LOOKAHEAD_MS = 50

const ProcessorBase = globalThis.AudioWorkletProcessor ?? class {}

// Noise gate with linked detection, hysteresis, hold, lookahead, and smoothed gain.
export class GateProcessor extends ProcessorBase {
  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: -40, minValue: -80, maxValue: 0, automationRate: 'a-rate' },
      { name: 'closeThreshold', defaultValue: -46, minValue: -90, maxValue: 0, automationRate: 'a-rate' },
      { name: 'range', defaultValue: -60, minValue: -90, maxValue: 0, automationRate: 'a-rate' },
      { name: 'hold', defaultValue: 10, minValue: 0, maxValue: 500, automationRate: 'a-rate' },
      { name: 'attack', defaultValue: 0.1, minValue: 0.01, maxValue: 100, automationRate: 'a-rate' },
      { name: 'release', defaultValue: 100, minValue: 1, maxValue: 1000, automationRate: 'a-rate' },
      { name: 'lookahead', defaultValue: 0, minValue: 0, maxValue: 50, automationRate: 'a-rate' },
    ]
  }

  constructor(options = {}) {
    super(options)

    const processorOptions = options.processorOptions ?? {}
    this.sampleRate = processorOptions.sampleRate ?? globalThis.sampleRate ?? 48000
    this.delayLength = Math.max(1, Math.round((MAX_LOOKAHEAD_MS * this.sampleRate) / 1000) + 1)
    this.delay = new Float32Array(this.delayLength * MAX_CHANNELS)
    this.delayPosition = 0
    this.samplesSeen = 0

    this.triggerEnvelope = 0
    this.triggerAttackCoefficient = timeCoefficient(0.1, this.sampleRate)
    this.triggerReleaseCoefficient = timeCoefficient(5, this.sampleRate)
    this.gain = 10 ** (-60 / 20)
    this.isOpen = false
    this.heldSamples = 0
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0] ?? []
    const output = outputs[0] ?? []
    const frameCount = output[0]?.length ?? input[0]?.length ?? 0
    const channelCount = Math.min(MAX_CHANNELS, Math.max(input.length, output.length))

    for (let frame = 0; frame < frameCount; ++frame) {
      let peak = 0
      for (let channel = 0; channel < Math.min(MAX_CHANNELS, input.length); ++channel) {
        const magnitude = Math.abs(input[channel][frame] ?? 0)
        if (magnitude > peak) peak = magnitude
      }

      const triggerCoefficient =
        peak > this.triggerEnvelope ? this.triggerAttackCoefficient : this.triggerReleaseCoefficient
      this.triggerEnvelope = triggerCoefficient * this.triggerEnvelope + (1 - triggerCoefficient) * peak

      const thresholdDb = parameterValue(parameters.threshold, frame)
      const closeThresholdDb = Math.min(parameterValue(parameters.closeThreshold, frame), thresholdDb)
      const closedGain = 10 ** (parameterValue(parameters.range, frame) / 20)
      const holdSamples = Math.max(0, Math.round((parameterValue(parameters.hold, frame) * this.sampleRate) / 1000))
      const openThreshold = 10 ** (thresholdDb / 20)
      const closeThreshold = 10 ** (closeThresholdDb / 20)

      let targetGain
      if (this.triggerEnvelope > openThreshold) {
        this.isOpen = true
        this.heldSamples = holdSamples
        targetGain = 1
      } else if (this.heldSamples > 0) {
        --this.heldSamples
        targetGain = 1
      } else if (this.isOpen && this.triggerEnvelope > closeThreshold) {
        targetGain = 1
      } else {
        this.isOpen = false
        targetGain = closedGain
      }

      const transitionMs =
        targetGain > this.gain ? parameterValue(parameters.attack, frame) : parameterValue(parameters.release, frame)
      const gainCoefficient = timeCoefficient(transitionMs, this.sampleRate)
      this.gain = gainCoefficient * this.gain + (1 - gainCoefficient) * targetGain

      const lookaheadSamples = Math.min(
        this.delayLength - 1,
        Math.max(0, Math.round((parameterValue(parameters.lookahead, frame) * this.sampleRate) / 1000)),
      )
      const readPosition = (this.delayPosition - lookaheadSamples + this.delayLength) % this.delayLength
      const writeOffset = this.delayPosition * MAX_CHANNELS
      const readOffset = readPosition * MAX_CHANNELS

      for (let channel = 0; channel < channelCount; ++channel) {
        const sample = input[channel]?.[frame] ?? 0
        const delayedSample = lookaheadSamples == 0 ? sample : this.delay[readOffset + channel]
        if (output[channel]) {
          output[channel][frame] = this.samplesSeen < lookaheadSamples ? 0 : delayedSample * this.gain
        }
        this.delay[writeOffset + channel] = sample
      }

      this.delayPosition = (this.delayPosition + 1) % this.delayLength
      ++this.samplesSeen
    }

    return true
  }
}

function parameterValue(values, frame) {
  return values.length == 1 ? values[0] : values[frame]
}

function timeCoefficient(milliseconds, sampleRate) {
  return milliseconds <= 0 ? 0 : Math.exp(-1 / (milliseconds * 0.001 * sampleRate))
}

if (typeof globalThis.registerProcessor == 'function') {
  globalThis.registerProcessor('soundetch-gate', GateProcessor)
}
