import type { TranscribedRange } from '../project/Transcription'
import {
  GRANITE_SAMPLE_RATE,
  GRANITE_VAD_SEGMENTATION_SETTINGS,
  SILERO_VAD_FRAME_SAMPLES,
  type SelectedSourceSampleRange,
  type GraniteSpeechSegment,
  type GraniteTokenSpan,
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

/** Share of the non-blank distribution that a word's prefix pieces need to show the word has begun. */
const PREFIX_ONSET_SHARE = 0.4
/**
 * Prefix evidence must lead the word's spike by this many 80 ms frames to move
 * its start; within two frames it is as often early as the spike is late.
 */
const MIN_PREFIX_ONSET_LEAD_FRAMES = 3
/** The previous word still occupies the frame after its spike or relocated onset. */
const MIN_PREFIX_ONSET_FRAMES_AFTER_PREVIOUS_SPIKE = 2
/**
 * Shorter words sit close to their spike, and their prefix pieces ("Ġo", "Ġa")
 * are too common to mark them.
 */
const MIN_PREFIX_ONSET_LETTERS = 6

/**
 * Granite emits a word once it has heard enough to identify it, so a long
 * single-token word can spike several frames after it begins: "legislation"
 * spikes on "-lation". The non-blank vocabulary distribution shows the word
 * earlier, as its word-initial prefix pieces ("Ġlegisl"; "Ġag" for
 * "agriculture") take over from the previous word's. For each word of at
 * least six letters, returns the first frame, from the second frame after the
 * previous word's spike (or its relocated onset, when later), where its prefix
 * pieces hold at least 40% of the non-blank distribution and more than the
 * previous word's pieces, if that frame leads its spike by at least three
 * frames. Pieces that spell a prefix of both words ("Ġi" for "i issued") count
 * for neither.
 *
 * Granite also emits a segment's first word on the segment's first frame
 * wherever it is spoken: after the VAD pre-roll, a chunk's leading pause, or
 * seconds of music the VAD accepted as speech. The distribution still shows
 * the word where it is heard ("Ġwelcome" after an intro song). For a first
 * word on frame 0, of any length, returns the first frame of the last run
 * before its next token in which its prefix pieces hold at least 40% and more
 * than the next word's pieces. A run that touches the frame-0 spike is the
 * word itself, spoken from the segment start, and moves nothing.
 *
 * `vocabularyLogProbs` holds log P(token | non-blank) for `vocabularySize`
 * token ids per 80 ms frame, for the segment's real frames only.
 */
export function graniteWordOnsetFrames(
  words: readonly RawGraniteWord[],
  tokenSpans: readonly GraniteTokenSpan[],
  vocabularyLogProbs: Float32Array,
  vocabularySize: number,
  prefixTokenIds: (text: string) => readonly number[],
): Array<number | undefined> {
  const frameCount = Math.floor(vocabularyLogProbs.length / vocabularySize)
  const prefixIds = words.map((word) => prefixTokenIds(word.text))
  const showsWord = (frame: number, ownIds: readonly number[], otherIds: readonly number[]): boolean => {
    const row = frame * vocabularySize
    let own = 0
    for (const id of ownIds) {
      own += Math.exp(vocabularyLogProbs[row + id])
    }
    let other = 0
    for (const id of otherIds) {
      other += Math.exp(vocabularyLogProbs[row + id])
    }
    return own >= PREFIX_ONSET_SHARE && own > other
  }
  const onsets = new Array<number | undefined>()
  for (const [index, word] of words.entries()) {
    const spike = tokenSpans[word.firstToken]
    if (index === 0 && spike.startFrame === 0) {
      const nextIds = prefixIds[1] ?? []
      const ownIds = prefixIds[0].filter((id) => !nextIds.includes(id))
      const otherIds = nextIds.filter((id) => !prefixIds[0].includes(id))
      let frame = Math.min(frameCount, tokenSpans[word.firstToken + 1]?.startFrame ?? frameCount) - 1
      while (frame >= spike.endFrame && !showsWord(frame, ownIds, otherIds)) {
        --frame
      }
      while (frame > spike.endFrame && showsWord(frame - 1, ownIds, otherIds)) {
        --frame
      }
      onsets.push(frame > spike.endFrame ? frame : undefined)
      continue
    }
    if (word.text.replace(/[^a-z']/gi, '').length < MIN_PREFIX_ONSET_LETTERS) {
      onsets.push(undefined)
      continue
    }
    const previousIds = index > 0 ? prefixIds[index - 1] : []
    const ownIds = prefixIds[index].filter((id) => !previousIds.includes(id))
    const otherIds = previousIds.filter((id) => !prefixIds[index].includes(id))
    const firstFrame =
      index > 0
        ? Math.max(tokenSpans[words[index - 1].firstToken].startFrame, onsets[index - 1] ?? 0) +
          MIN_PREFIX_ONSET_FRAMES_AFTER_PREVIOUS_SPIKE
        : 0
    let onset: number | undefined
    for (let frame = firstFrame; frame <= spike.startFrame - MIN_PREFIX_ONSET_LEAD_FRAMES; ++frame) {
      if (showsWord(frame, ownIds, otherIds)) {
        onset = frame
        break
      }
    }
    onsets.push(onset)
  }
  return onsets
}

/**
 * Word extents in segment seconds from CTC posterior medians, or the frame
 * path without posteriors. A word with prefix evidence from
 * `graniteWordOnsetFrames` starts at the middle of that frame when earlier.
 */
export function timeGraniteWords(
  words: readonly RawGraniteWord[],
  posteriors: readonly CtcTokenBoundary[] | null,
  onsetFrames: readonly (number | undefined)[],
  durationSeconds: number,
): TimedGraniteWord[] {
  return words.map((word, index) => {
    const posteriorStart = posteriors?.[word.firstToken]?.start.median
    const posteriorEnd = posteriors?.[word.lastToken]?.end.median
    const onsetFrame = onsetFrames[index]
    const startFrames = Math.min(
      posteriorStart ?? word.startFrame,
      onsetFrame === undefined ? Infinity : onsetFrame + 0.5,
    )
    const endFrames = posteriorEnd ?? word.endFrame
    const start = Math.max(0, Math.min(durationSeconds, startFrames * GRANITE_TIMING_FRAME_SECONDS))
    const end = Math.max(start + 0.02, Math.min(durationSeconds, endFrames * GRANITE_TIMING_FRAME_SECONDS))
    return { text: word.text, start, end }
  })
}

/**
 * Segment seconds, at the middle of the frame, where Granite's prefix
 * evidence hears a first word it emitted on frame 0: the onset
 * `graniteWordOnsetFrames` returns after that word's spike.
 */
export function graniteLeadingWordOnset(
  words: readonly RawGraniteWord[],
  onsetFrames: readonly (number | undefined)[],
  durationSeconds: number,
): number | undefined {
  const onsetFrame = onsetFrames[0]
  if (words.length === 0 || onsetFrame === undefined || onsetFrame <= words[0].startFrame) {
    return undefined
  }
  return Math.min(durationSeconds, (onsetFrame + 0.5) * GRANITE_TIMING_FRAME_SECONDS)
}

/** Speech runs shorter than this are treated as clicks, not a word. */
const MIN_RELOCATION_RUN_FRAMES = 2

/**
 * Leading-word speech must reach this fraction of the loudest frame before the
 * next word. Stricter than the 10% used for word extents: inside a long speech
 * region, Silero probability can stay above the speech-mask threshold through
 * pauses, so energy is what separates the pause from the word.
 */
const RELOCATION_ENERGY_RATIO = 0.2

/** Fraction of the loudest nearby frame's amplitude that counts as speech for word extents. */
const ACTIVITY_RATIO = 0.1
/** Seconds on each side of a word's spike searched for its loudest nearby frame. */
const ACTIVITY_PEAK_WINDOW_SECONDS = 0.5
/** A start moves to resumed speech only within this distance of its CTC spike. */
const ONSET_SEARCH_SECONDS = 0.4
/** Shorter quiet stretches after a spike are the word's own weak onset, not a pause. */
const ONSET_MIN_SHIFT_SECONDS = 0.12
/** Kept before resumed speech for a quiet initial consonant such as /f/. */
const WEAK_ONSET_SECONDS = 0.064
/** Quiet frames an end bridges once the word has its expected length (stop closures). */
const SHORT_DIP_FRAMES = 3
/** Quiet frames an end bridges while the word is shorter than expected (the /st/ of "states"). */
const LONG_DIP_FRAMES = 6
const EXPECTED_SECONDS_PER_LETTER = 0.045
const MAX_SECONDS_PER_LETTER = 0.09
const MIN_LONGEST_WORD_SECONDS = 0.3
const MIN_WORD_SECONDS = 0.02
/**
 * Energy places a first word's onset on 32 ms frames, so it is kept within
 * this distance of where Granite's prefix evidence hears the word (the middle
 * of an 80 ms frame). Farther apart, energy settled on other sound: music or
 * noise the VAD accepted as speech before the word.
 */
const LEADING_ONSET_TOLERANCE_SECONDS = 0.2

/**
 * Granite emits a segment's first word on the segment's first frame. When
 * `graniteWordOnsetFrames` finds no later prefix evidence for it, the word can
 * still sit inside the VAD pre-roll or a 20-second chunk's leading pause, up
 * to 750 ms before the speech it transcribes. Bounded refinement cannot reach
 * that far, so a first word that starts within that leading window and is at
 * least 80% unsupported starts at the nearest supported speech run between the
 * segment start and the next word. When the next word's spike already sits
 * where that speech begins, the first word starts at the first supported run
 * before the next word ends.
 */
function relocateLeadingWord(
  anchor: TimedGraniteWord,
  nextStart: number,
  nextEnd: number,
  segmentStartSeconds: number,
  speechMask: Uint8Array,
  frameEnergies: Float32Array,
  frameSeconds: number,
): number | undefined {
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

  let bestStart: number | undefined
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
    if (end - start >= MIN_WORD_SECONDS && distance < bestDistance) {
      bestStart = start
      bestDistance = distance
    }
  }
  if (bestStart !== undefined) {
    return bestStart
  }
  const nextEndFrame = Math.min(speechMask.length, frameEnergies.length, Math.ceil(nextEnd / frameSeconds))
  for (let frame = lastFrame; frame + MIN_RELOCATION_RUN_FRAMES <= nextEndFrame; ++frame) {
    let runFrames = 0
    while (runFrames < MIN_RELOCATION_RUN_FRAMES && active(frame + runFrames)) {
      ++runFrames
    }
    if (runFrames === MIN_RELOCATION_RUN_FRAMES) {
      return frame * frameSeconds
    }
  }
  return undefined
}

/**
 * A spike that sits in a pause starts its word where speech resumes, keeping
 * room for a quiet initial consonant. At a segment start, where Silero is not
 * lagging behind earlier speech, VAD-supported quiet onset frames are kept too.
 */
function speechOnsetStart(
  anchor: TimedGraniteWord,
  searchEndSeconds: number,
  active: (frame: number) => boolean,
  speechMask: Uint8Array,
  frameSeconds: number,
  keepVadOnset: boolean,
): number {
  const anchorFrame = Math.floor(anchor.start / frameSeconds)
  const searchEndFrame = Math.ceil(searchEndSeconds / frameSeconds)
  for (let frame = anchorFrame; frame < searchEndFrame; ++frame) {
    if (!active(frame) || !active(frame + 1)) {
      continue
    }
    if (frame * frameSeconds - anchor.start <= ONSET_MIN_SHIFT_SECONDS) {
      return anchor.start
    }
    let onset = frame
    if (keepVadOnset) {
      let unsupportedFrames = 0
      for (let earlier = frame - 1; earlier >= anchorFrame; --earlier) {
        if ((speechMask[earlier] & 1) !== 0) {
          onset = earlier
          unsupportedFrames = 0
        } else if (++unsupportedFrames >= 2) {
          break
        }
      }
    }
    return Math.max(anchor.start, onset * frameSeconds - WEAK_ONSET_SECONDS)
  }
  return anchor.start
}

/**
 * Word extents for one Granite segment. Granite emits one sharp CTC spike per
 * word, usually near its onset, so a word starts at its spike (or where speech
 * resumes after a spike that sits in a pause) and ends where its speech stops.
 * Ends bridge quiet stretches up to 96 ms (stop closures), or up to 192 ms
 * while the word is shorter than its letters suggest (quiet fricatives), and
 * never pass the next word's start, a letter-based length cap, or the segment.
 *
 * `leadingWordOnset` (from `graniteLeadingWordOnset`, in interval seconds) is
 * where Granite's prefix evidence hears a first word it emitted on frame 0.
 * Energy still places that word's onset unless it lands more than 200 ms away;
 * the word then starts at the evidence, or where speech resumes after it.
 */
export function refineGraniteWords(
  words: readonly TimedGraniteWord[],
  speechMask: Uint8Array,
  frameEnergies: Float32Array,
  frameSeconds: number,
  segmentStartSeconds: number,
  segmentEndSeconds: number,
  leadingWordOnset?: number,
): TimedGraniteWord[] {
  // Frames straddling the segment start belong partly to the previous segment.
  const segmentFirstFrame = Math.ceil(segmentStartSeconds / frameSeconds)
  const segmentLastFrame = Math.min(
    speechMask.length,
    frameEnergies.length,
    Math.ceil(segmentEndSeconds / frameSeconds),
  )
  const activityAround = (seconds: number): ((frame: number) => boolean) => {
    const from = Math.max(segmentFirstFrame, Math.floor((seconds - ACTIVITY_PEAK_WINDOW_SECONDS) / frameSeconds))
    const to = Math.min(segmentLastFrame, Math.ceil((seconds + ACTIVITY_PEAK_WINDOW_SECONDS) / frameSeconds))
    let peak = 0
    for (let frame = from; frame < to; ++frame) {
      peak = Math.max(peak, frameEnergies[frame])
    }
    const threshold = Math.max(1e-5, peak * ACTIVITY_RATIO)
    return (frame) =>
      frame >= segmentFirstFrame &&
      frame < segmentLastFrame &&
      speechMask[frame] !== 0 &&
      frameEnergies[frame] >= threshold
  }

  const anchors = words.slice()
  const starts = new Array<number>(words.length)
  words.forEach((anchor, index) => {
    const nextAnchorStart = words[index + 1]?.start ?? segmentEndSeconds
    const searchEnd = Math.min(nextAnchorStart, Math.max(anchor.end, anchor.start + ONSET_SEARCH_SECONDS))
    const relocated =
      index === 0
        ? relocateLeadingWord(
            anchor,
            nextAnchorStart,
            words[index + 1]?.end ?? segmentEndSeconds,
            segmentStartSeconds,
            speechMask,
            frameEnergies,
            frameSeconds,
          )
        : undefined
    let start =
      relocated ??
      speechOnsetStart(anchor, searchEnd, activityAround(anchor.start), speechMask, frameSeconds, index === 0)
    if (
      index === 0 &&
      leadingWordOnset !== undefined &&
      Math.abs(start - leadingWordOnset) > LEADING_ONSET_TOLERANCE_SECONDS
    ) {
      anchors[0] = { text: anchor.text, start: leadingWordOnset, end: leadingWordOnset }
      start = speechOnsetStart(
        anchors[0],
        Math.min(nextAnchorStart, leadingWordOnset + ONSET_SEARCH_SECONDS),
        activityAround(leadingWordOnset),
        speechMask,
        frameSeconds,
        true,
      )
    }
    starts[index] =
      index > 0 ? Math.max(start, starts[index - 1] + MIN_WORD_SECONDS) : Math.max(start, segmentStartSeconds)
  })

  return anchors.map((anchor, index) => {
    const start = starts[index]
    const nextStart = index + 1 < words.length ? starts[index + 1] : segmentEndSeconds
    const active = activityAround(anchor.start)
    const letters = Math.max(1, anchor.text.replace(/[^a-z']/gi, '').length)
    const expectedSeconds = EXPECTED_SECONDS_PER_LETTER * letters
    const latestEnd = Math.min(
      nextStart,
      segmentEndSeconds,
      start + Math.max(MIN_LONGEST_WORD_SECONDS, MAX_SECONDS_PER_LETTER * letters),
    )
    let end = Math.min(nextStart, Math.max(start + MIN_WORD_SECONDS, anchor.end))
    let quietFrames = 0
    const nextFrame = Math.ceil(nextStart / frameSeconds)
    for (let frame = Math.floor(Math.max(start, end - frameSeconds) / frameSeconds); frame < nextFrame; ++frame) {
      if (active(frame)) {
        quietFrames = 0
        end = Math.max(end, Math.min((frame + 1) * frameSeconds, latestEnd))
      } else if (++quietFrames > (end - start < expectedSeconds ? LONG_DIP_FRAMES : SHORT_DIP_FRAMES)) {
        break
      }
    }
    return { text: anchor.text, start, end: Math.min(end, segmentEndSeconds) }
  })
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

/** Frame energy that counts as sound: a tenth of the loudest frame's amplitude, and at least 0.003. */
function soundEnergyThreshold(energies: Float32Array): number {
  let peakFrameEnergy = 0
  for (const energy of energies) {
    peakFrameEnergy = Math.max(peakFrameEnergy, energy)
  }
  return Math.max(0.003, peakFrameEnergy * 0.1)
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
  const energyThreshold = soundEnergyThreshold(energies)
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

/**
 * Marks frames where Silero is below its speech-end threshold and the energy
 * is below the speech mask's sound threshold, over the whole interval. Energy
 * alone would call quiet speech silence; Silero alone would call loud
 * non-speech silence.
 */
export function buildSilenceMask(
  probabilities: Float32Array,
  energies: Float32Array,
  negativeThreshold: number,
): Uint8Array {
  if (probabilities.length !== energies.length) {
    throw new Error('Silero probabilities and energy frames must have equal lengths.')
  }
  const energyThreshold = soundEnergyThreshold(energies)
  return Uint8Array.from(probabilities, (probability, frame) =>
    probability < negativeThreshold && energies[frame] < energyThreshold ? 1 : 0,
  )
}

/**
 * Unpadded onset, in clip source samples, of the VAD speech region that owns a
 * range. Ranges in padding belong to the nearest speech region, not the
 * previous paragraph merely because their timing precedes Silero's detected
 * onset.
 */
export function speechRegionStartSample(
  startSample: number,
  endSample: number,
  projectSampleRate: number,
  selectedRange: SelectedSourceSampleRange,
  speechRegions: readonly GraniteSpeechSegment[],
): number | undefined {
  if (speechRegions.length === 0) {
    return undefined
  }
  const sampleRatio = projectSampleRate / GRANITE_SAMPLE_RATE
  const midpoint16kSample = ((startSample + endSample) / 2 - selectedRange.startSample) / sampleRatio
  let low = 0
  let high = speechRegions.length - 1
  while (low < high) {
    const middle = (low + high) >> 1
    if (midpoint16kSample >= (speechRegions[middle].endSample + speechRegions[middle + 1].startSample) / 2) {
      low = middle + 1
    } else {
      high = middle
    }
  }
  return selectedRange.startSample + Math.round(speechRegions[low].startSample * sampleRatio)
}

export function timedWordsToTranscribedRanges(
  words: readonly TimedGraniteWord[],
  segmentStart16kSample: number,
  projectSampleRate: number,
  selectedRange: SelectedSourceSampleRange,
  speechRegions: readonly GraniteSpeechSegment[],
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
    const speechStartSample = speechRegionStartSample(
      startSample,
      endSample,
      projectSampleRate,
      selectedRange,
      speechRegions,
    )
    return [{ text: word.text, startSample, endSample, speechStartSample }]
  })
  ranges.sort((left, right) => left.startSample - right.startSample || left.endSample - right.endSample)
  return ranges
}
