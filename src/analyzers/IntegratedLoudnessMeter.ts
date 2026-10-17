import { LufsCalculator } from './LufsCalculator'

const LOUDNESS_OFFSET = -0.691
const ABSOLUTE_GATE_LUFS = -70
const RELATIVE_GATE_LU = -10
const STEPS_PER_BLOCK = 4
const FILTER_STATE_PER_CHANNEL = 8

// Gated integrated loudness (ITU-R BS.1770-4 / EBU R128): K-weighted mean square over 400 ms blocks
// with 75% overlap, an absolute gate at -70 LUFS and a relative gate 10 LU below the abs-gated loudness.
// Every channel has weight 1.0.
export class IntegratedLoudnessMeter {
  private readonly channelCount: number
  private readonly stepFrames: number
  // [b0, b1, b2, a1, a2] of the pre-filter followed by the same for the RLB weighting filter.
  private readonly coefficients: Float64Array
  // Per channel: pre-filter x1, x2, y1, y2, then weighting filter x1, x2, y1, y2.
  private readonly filterState: Float64Array
  private readonly stepEnergies = new Float64Array(STEPS_PER_BLOCK)
  private completedSteps = 0
  private stepEnergy = 0
  private stepFramePosition = 0
  private readonly blockEnergies: number[] = []

  constructor(sampleRate: number, channelCount: number) {
    this.channelCount = channelCount
    this.stepFrames = Math.round(sampleRate / 10)
    const pre = LufsCalculator.preFilterCoefficients(sampleRate)
    const weighting = LufsCalculator.weightingFilterCoefficients(sampleRate)
    this.coefficients = new Float64Array([
      ...pre.numerators,
      pre.denominators[1],
      pre.denominators[2],
      ...weighting.numerators,
      weighting.denominators[1],
      weighting.denominators[2],
    ])
    this.filterState = new Float64Array(channelCount * FILTER_STATE_PER_CHANNEL)
  }

  // samples.length must be a multiple of channelCount.
  addInterleaved(samples: Float32Array): void {
    const channelCount = this.channelCount
    const frameCount = samples.length / channelCount
    const coefficients = this.coefficients
    const pb0 = coefficients[0]
    const pb1 = coefficients[1]
    const pb2 = coefficients[2]
    const pa1 = coefficients[3]
    const pa2 = coefficients[4]
    const wb0 = coefficients[5]
    const wb1 = coefficients[6]
    const wb2 = coefficients[7]
    const wa1 = coefficients[8]
    const wa2 = coefficients[9]
    const state = this.filterState
    let stepEnergy = this.stepEnergy

    for (let frame = 0; frame < frameCount; ++frame) {
      const offset = frame * channelCount
      for (let channel = 0; channel < channelCount; ++channel) {
        const s = channel * FILTER_STATE_PER_CHANNEL
        const x = samples[offset + channel]
        const pre = pb0 * x + pb1 * state[s] + pb2 * state[s + 1] - pa1 * state[s + 2] - pa2 * state[s + 3]
        state[s + 1] = state[s]
        state[s] = x
        state[s + 3] = state[s + 2]
        state[s + 2] = pre
        const weighted = wb0 * pre + wb1 * state[s + 4] + wb2 * state[s + 5] - wa1 * state[s + 6] - wa2 * state[s + 7]
        state[s + 5] = state[s + 4]
        state[s + 4] = pre
        state[s + 7] = state[s + 6]
        state[s + 6] = weighted
        stepEnergy += weighted * weighted
      }

      if (++this.stepFramePosition === this.stepFrames) {
        this.completeStep(stepEnergy)
        stepEnergy = 0
      }
    }

    this.stepEnergy = stepEnergy
  }

  // LUFS; -Infinity when no block passes the gates.
  getIntegratedLoudness(): number {
    const absoluteThreshold = 10 ** ((ABSOLUTE_GATE_LUFS - LOUDNESS_OFFSET) / 10)
    const absoluteGated = this.blockEnergies.filter((energy) => energy > absoluteThreshold)
    if (absoluteGated.length === 0) return -Infinity

    const relativeGateLufs = LOUDNESS_OFFSET + 10 * Math.log10(mean(absoluteGated)) + RELATIVE_GATE_LU
    const relativeThreshold = 10 ** ((relativeGateLufs - LOUDNESS_OFFSET) / 10)
    const relativeGated = absoluteGated.filter((energy) => energy > relativeThreshold)
    return LOUDNESS_OFFSET + 10 * Math.log10(mean(relativeGated))
  }

  private completeStep(stepEnergy: number) {
    this.stepEnergies[this.completedSteps % STEPS_PER_BLOCK] = stepEnergy
    ++this.completedSteps
    this.stepFramePosition = 0
    if (this.completedSteps >= STEPS_PER_BLOCK) {
      let blockEnergy = 0
      for (let step = 0; step < STEPS_PER_BLOCK; ++step) blockEnergy += this.stepEnergies[step]
      this.blockEnergies.push(blockEnergy / (STEPS_PER_BLOCK * this.stepFrames))
    }
  }
}

function mean(values: number[]) {
  let sum = 0
  for (const value of values) sum += value
  return sum / values.length
}
