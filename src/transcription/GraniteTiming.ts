import type { TranscribedRange } from '../project/Transcription'
import {
  GRANITE_SAMPLE_RATE,
  GRANITE_VAD_SEGMENTATION_SETTINGS,
  SILERO_VAD_FRAME_SAMPLES,
  type SelectedSourceSampleRange,
} from './GraniteCtc'

export const GRANITE_TIMING_FRAME_SECONDS = 0.08

export interface CtcBoundaryQuantiles {
  readonly low: number
  readonly median: number
  readonly high: number
}

export interface CtcTokenBoundary {
  readonly start: CtcBoundaryQuantiles
  readonly end: CtcBoundaryQuantiles
}

export interface RawGraniteWord {
  readonly text: string
  readonly startFrame: number
  readonly endFrame: number
  readonly firstToken: number
  readonly lastToken: number
}

export interface TimedGraniteWord {
  readonly text: string
  readonly start: number
  readonly end: number
}

function logAdd(first: number, second: number): number {
  if (first === -Infinity) {
    return second
  }
  if (second === -Infinity) {
    return first
  }
  const high = Math.max(first, second)
  return high + Math.log1p(Math.exp(Math.min(first, second) - high))
}

function quantiles(probabilities: Float64Array): CtcBoundaryQuantiles | null {
  let total = 0
  for (const probability of probabilities) {
    total += probability
  }
  if (!(total > 0) || !Number.isFinite(total)) {
    return null
  }

  const values = new Array<number>(3)
  const thresholds = [0.05, 0.5, 0.95]
  let cumulative = 0
  let thresholdIndex = 0
  for (let frame = 0; frame < probabilities.length && thresholdIndex < thresholds.length; ++frame) {
    cumulative += probabilities[frame]
    while (thresholdIndex < thresholds.length && cumulative >= thresholds[thresholdIndex] * total) {
      values[thresholdIndex] = frame
      ++thresholdIndex
    }
  }
  if (thresholdIndex !== thresholds.length) {
    return null
  }
  return { low: values[0], median: values[1], high: values[2] }
}

/**
 * Computes transcript-conditioned CTC entry and exclusive-exit boundaries.
 * Column zero is blank; column i + 1 belongs to transcript token occurrence i.
 */
export function ctcTokenPosteriors(
  scores: Float32Array,
  frameCount: number,
  tokenIds: readonly number[],
): CtcTokenBoundary[] | null {
  const tokenCount = tokenIds.length
  if (tokenCount === 0) {
    return []
  }
  const columns = tokenCount + 1
  if (scores.length !== frameCount * columns) {
    throw new Error('Invalid compact CTC score shape.')
  }

  let minimumFrames = tokenCount
  for (let index = 1; index < tokenCount; ++index) {
    if (tokenIds[index] === tokenIds[index - 1]) {
      ++minimumFrames
    }
  }
  if (frameCount < minimumFrames) {
    return null
  }

  const stateCount = tokenCount * 2 + 1
  const canSkip = new Uint8Array(stateCount)
  const columnAt = new Int32Array(stateCount)
  for (let index = 0; index < tokenCount; ++index) {
    const state = index * 2 + 1
    columnAt[state] = index + 1
    canSkip[state] = index > 0 && tokenIds[index] !== tokenIds[index - 1] ? 1 : 0
  }

  // Common per-frame score offsets cancel in P(path | audio, transcript).
  const offsets = new Float64Array(frameCount)
  for (let frame = 0; frame < frameCount; ++frame) {
    let peak = -Infinity
    for (let column = 0; column < columns; ++column) {
      const score = scores[frame * columns + column]
      if (!Number.isFinite(score)) {
        throw new Error('Non-finite CTC emission score.')
      }
      peak = Math.max(peak, score)
    }
    offsets[frame] = peak
  }
  const emission = (frame: number, state: number): number => scores[frame * columns + columnAt[state]] - offsets[frame]

  const alpha = new Float64Array(frameCount * stateCount).fill(-Infinity)
  const beta = new Float64Array(frameCount * stateCount).fill(-Infinity)
  alpha[0] = emission(0, 0)
  alpha[1] = emission(0, 1)
  for (let frame = 1; frame < frameCount; ++frame) {
    const row = frame * stateCount
    const previous = row - stateCount
    for (let state = 0; state < stateCount; ++state) {
      let sum = alpha[previous + state]
      if (state > 0) {
        sum = logAdd(sum, alpha[previous + state - 1])
      }
      if (canSkip[state] !== 0) {
        sum = logAdd(sum, alpha[previous + state - 2])
      }
      alpha[row + state] = sum + emission(frame, state)
    }
  }

  const last = (frameCount - 1) * stateCount
  const normalizer = logAdd(alpha[last + stateCount - 1], alpha[last + stateCount - 2])
  if (!Number.isFinite(normalizer)) {
    return null
  }
  beta[last + stateCount - 1] = 0
  beta[last + stateCount - 2] = 0
  for (let frame = frameCount - 2; frame >= 0; --frame) {
    const row = frame * stateCount
    const next = row + stateCount
    for (let state = 0; state < stateCount; ++state) {
      let sum = emission(frame + 1, state) + beta[next + state]
      if (state + 1 < stateCount) {
        sum = logAdd(sum, emission(frame + 1, state + 1) + beta[next + state + 1])
      }
      if (state + 2 < stateCount && canSkip[state + 2] !== 0) {
        sum = logAdd(sum, emission(frame + 1, state + 2) + beta[next + state + 2])
      }
      beta[row + state] = sum
    }
  }

  const entry = new Float64Array(frameCount)
  const exit = new Float64Array(frameCount)
  const boundaries = new Array<CtcTokenBoundary>()
  for (let index = 0; index < tokenCount; ++index) {
    const state = index * 2 + 1
    for (let frame = 0; frame < frameCount; ++frame) {
      const row = frame * stateCount
      let incoming = frame > 0 ? alpha[row - stateCount + state - 1] : index > 0 ? -Infinity : 0
      if (frame > 0 && canSkip[state] !== 0) {
        incoming = logAdd(incoming, alpha[row - stateCount + state - 2])
      }
      entry[frame] = Math.exp(incoming + emission(frame, state) + beta[row + state] - normalizer)

      let outgoing: number
      if (frame === frameCount - 1) {
        outgoing = index === tokenCount - 1 ? 0 : -Infinity
      } else {
        outgoing = emission(frame + 1, state + 1) + beta[row + stateCount + state + 1]
        if (state + 2 < stateCount && canSkip[state + 2] !== 0) {
          outgoing = logAdd(outgoing, emission(frame + 1, state + 2) + beta[row + stateCount + state + 2])
        }
      }
      exit[frame] = Math.exp(alpha[row + state] + outgoing - normalizer)
    }

    const start = quantiles(entry)
    const end = quantiles(exit)
    if (!start || !end) {
      return null
    }
    boundaries.push({
      start,
      end: { low: end.low + 1, median: end.median + 1, high: end.high + 1 },
    })
  }
  return boundaries
}

export function timeGraniteWords(
  words: readonly RawGraniteWord[],
  posteriors: readonly CtcTokenBoundary[] | null,
  durationSeconds: number,
): TimedGraniteWord[] {
  return words.map((word) => {
    const posteriorStart = posteriors?.[word.firstToken]?.start.median
    const posteriorEnd = posteriors?.[word.lastToken]?.end.median
    const startFrames = posteriorStart ?? word.startFrame
    const endFrames = posteriorEnd ?? word.endFrame
    const start = Math.max(0, Math.min(durationSeconds, startFrames * GRANITE_TIMING_FRAME_SECONDS))
    const end = Math.max(start + 0.02, Math.min(durationSeconds, endFrames * GRANITE_TIMING_FRAME_SECONDS))
    return { text: word.text, start, end }
  })
}

/** Speech runs shorter than this are treated as clicks, not a word. */
const MIN_RELOCATION_RUN_FRAMES = 2

/**
 * Leading-word speech must reach this fraction of the loudest frame before the
 * next word. Stricter than end refinement's 10%: inside a long speech region,
 * Silero probability can stay above the speech-mask threshold through pauses,
 * so energy is what separates the pause from the word.
 */
const RELOCATION_ENERGY_RATIO = 0.2

/**
 * Granite can emit a segment's first word at the very start of the segment,
 * inside the VAD pre-roll or a 20-second chunk's leading pause, up to 750 ms
 * before the speech it transcribes. Bounded refinement cannot reach that far,
 * so a first word that starts within that leading window and is at least 80%
 * unsupported moves onto the nearest supported speech run between the segment
 * start and the next word.
 */
function relocateLeadingWord(
  anchor: TimedGraniteWord,
  nextStart: number,
  segmentStartSeconds: number,
  speechMask: Uint8Array,
  frameEnergies: Float32Array,
  frameSeconds: number,
): { start: number; end: number } | undefined {
  if (anchor.start >= segmentStartSeconds + GRANITE_VAD_SEGMENTATION_SETTINGS.preSpeechMs / 1_000) {
    return undefined
  }
  // Frames straddling the segment start belong partly to the previous segment.
  const firstFrame = Math.ceil(segmentStartSeconds / frameSeconds)
  const lastFrame = Math.min(speechMask.length, frameEnergies.length, Math.ceil(nextStart / frameSeconds))
  let peak = 0
  for (let frame = firstFrame; frame < lastFrame; ++frame) {
    peak = Math.max(peak, frameEnergies[frame])
  }
  const threshold = Math.max(1e-5, peak * RELOCATION_ENERGY_RATIO)
  const active = (frame: number): boolean => speechMask[frame] !== 0 && frameEnergies[frame] >= threshold

  const anchorFirstFrame = Math.floor(anchor.start / frameSeconds)
  const anchorLastFrame = Math.min(speechMask.length, Math.ceil(anchor.end / frameSeconds))
  let supportedFrames = 0
  for (let frame = anchorFirstFrame; frame < anchorLastFrame; ++frame) {
    if (active(frame)) {
      ++supportedFrames
    }
  }
  if (supportedFrames > (anchorLastFrame - anchorFirstFrame) * 0.2) {
    return undefined
  }

  let best: { start: number; end: number } | undefined
  let bestDistance = Infinity
  for (let frame = firstFrame; frame < lastFrame;) {
    if (!active(frame)) {
      ++frame
      continue
    }
    const runStart = frame
    while (frame < lastFrame && active(frame)) {
      ++frame
    }
    if (frame - runStart < MIN_RELOCATION_RUN_FRAMES) {
      continue
    }
    const start = runStart * frameSeconds
    const end = Math.min(frame * frameSeconds, nextStart)
    const distance = Math.max(start - anchor.end, anchor.start - end, 0)
    if (end - start >= 0.02 && distance < bestDistance) {
      best = { start, end }
      bestDistance = distance
    }
  }
  return best
}

/**
 * Bounded acoustic boundary adjustment for the words of one Granite segment.
 * Preserves VAD-supported quiet onsets and never reaches outside the segment.
 */
export function refineGraniteWords(
  words: readonly TimedGraniteWord[],
  speechMask: Uint8Array,
  frameEnergies: Float32Array,
  frameSeconds: number,
  segmentStartSeconds: number,
  segmentEndSeconds: number,
): TimedGraniteWord[] {
  const refined = words.map((word) => ({ ...word }))
  for (let index = 0; index < refined.length; ++index) {
    const word = refined[index]
    const anchor = words[index]
    const previousEnd = index > 0 ? words[index - 1].end : segmentStartSeconds
    const nextStart = words[index + 1]?.start ?? segmentEndSeconds
    if (index === 0) {
      const relocated = relocateLeadingWord(
        anchor,
        nextStart,
        segmentStartSeconds,
        speechMask,
        frameEnergies,
        frameSeconds,
      )
      if (relocated) {
        word.start = relocated.start
        word.end = relocated.end
        continue
      }
    }
    const from = Math.max(previousEnd, anchor.start - 0.16, 0)
    const to = Math.min(nextStart, anchor.end + 0.32, segmentEndSeconds)
    const firstFrame = Math.max(0, Math.floor(from / frameSeconds))
    const lastFrame = Math.min(frameEnergies.length, Math.ceil(to / frameSeconds))
    let peak = 0
    for (let frame = firstFrame; frame < lastFrame; ++frame) {
      peak = Math.max(peak, frameEnergies[frame])
    }
    const threshold = Math.max(1e-5, peak * 0.1)
    const active = (frame: number): boolean => speechMask[frame] !== 0 && frameEnergies[frame] >= threshold

    let bestRun: { start: number; end: number; startFrame: number } | undefined
    let bestDistance = Infinity
    for (let frame = firstFrame; frame < lastFrame;) {
      if (!active(frame)) {
        ++frame
        continue
      }
      const runStart = frame
      let lastActive = frame
      ++frame
      while (frame < lastFrame) {
        if (active(frame)) {
          lastActive = frame
        } else if (frame - lastActive >= 2) {
          break
        }
        ++frame
      }
      const start = Math.max(from, runStart * frameSeconds)
      const end = Math.min(to, (lastActive + 1) * frameSeconds)
      const distance = Math.max(start - anchor.end, anchor.end - end, 0)
      if (distance < bestDistance && end > start) {
        bestDistance = distance
        bestRun = { start, end, startFrame: runStart }
      }
    }

    if (bestRun && bestDistance <= 0.16) {
      let supportedStartFrame = bestRun.startFrame
      const anchorStartFrame = Math.max(firstFrame, Math.floor(anchor.start / frameSeconds))
      let unsupportedFrames = 0
      for (let frame = supportedStartFrame - 1; frame >= anchorStartFrame; --frame) {
        if ((speechMask[frame] & 1) !== 0) {
          supportedStartFrame = frame
          unsupportedFrames = 0
        } else if (++unsupportedFrames >= 2) {
          break
        }
      }
      const acousticStart = Math.max(anchor.start, (supportedStartFrame - 1) * frameSeconds)
      if (acousticStart - anchor.start >= frameSeconds * 3) {
        word.start = acousticStart
      }
      word.end = Math.min(bestRun.end, anchor.end + 0.24, nextStart)
      if (word.end < word.start + 0.02) {
        word.start = anchor.start
        word.end = anchor.end
      }
    }
    word.start = Math.max(segmentStartSeconds, Math.min(segmentEndSeconds, word.start))
    word.end = Math.max(word.start, Math.min(segmentEndSeconds, word.end))
  }

  for (let index = 0; index + 1 < refined.length; ++index) {
    if (refined[index].end > refined[index + 1].start) {
      refined[index].end = Math.max(refined[index].start, refined[index + 1].start)
    }
  }
  return refined
}

export function computeFrameEnergies(audio: Float32Array, frameSamples: number): Float32Array {
  if (!Number.isInteger(frameSamples) || frameSamples <= 0) {
    throw new Error('Energy frame size must be a positive integer.')
  }
  const energies = new Float32Array(Math.ceil(audio.length / frameSamples))
  for (let frame = 0; frame < energies.length; ++frame) {
    const start = frame * frameSamples
    const end = Math.min(audio.length, start + frameSamples)
    let sum = 0
    for (let sample = start; sample < end; ++sample) {
      sum += audio[sample] * audio[sample]
    }
    energies[frame] = Math.sqrt(sum / (end - start))
  }
  return energies
}

export function buildSpeechSupportMask(
  probabilities: Float32Array,
  segments: readonly { startSample: number; endSample: number }[],
  energies: Float32Array,
  negativeThreshold: number,
): Uint8Array {
  if (probabilities.length !== energies.length) {
    throw new Error('Silero probabilities and energy frames must have equal lengths.')
  }
  let peakFrameEnergy = 0
  for (const energy of energies) {
    peakFrameEnergy = Math.max(peakFrameEnergy, energy)
  }
  const energyThreshold = Math.max(0.003, peakFrameEnergy * 0.1)
  const mask = new Uint8Array(energies.length)
  for (const segment of segments) {
    const firstFrame = Math.max(0, Math.floor(segment.startSample / SILERO_VAD_FRAME_SAMPLES))
    const lastFrame = Math.min(mask.length, Math.ceil(segment.endSample / SILERO_VAD_FRAME_SAMPLES))
    for (let frame = firstFrame; frame < lastFrame; ++frame) {
      const vadSupported = probabilities[frame] >= negativeThreshold * 0.25
      const energySupported = energies[frame] >= energyThreshold
      mask[frame] = (vadSupported ? 1 : 0) | (energySupported ? 2 : 0)
    }
  }
  return mask
}

export function timedWordsToTranscribedRanges(
  words: readonly TimedGraniteWord[],
  segmentStart16kSample: number,
  projectSampleRate: number,
  selectedRange: SelectedSourceSampleRange,
): TranscribedRange[] {
  const segmentOffsetSeconds = segmentStart16kSample / GRANITE_SAMPLE_RATE
  const ranges = words.flatMap((word) => {
    const startSeconds = segmentOffsetSeconds + word.start
    const endSeconds = segmentOffsetSeconds + word.end
    const startSample = Math.max(
      selectedRange.startSample,
      Math.min(selectedRange.endSample, selectedRange.startSample + Math.round(startSeconds * projectSampleRate)),
    )
    const endSample = Math.max(
      selectedRange.startSample,
      Math.min(selectedRange.endSample, selectedRange.startSample + Math.round(endSeconds * projectSampleRate)),
    )
    if (word.text.length === 0 || startSample >= endSample) {
      return []
    }
    return [{ text: word.text, startSample, endSample }]
  })
  return ranges.sort((left, right) => left.startSample - right.startSample || left.endSample - right.endSample)
}
