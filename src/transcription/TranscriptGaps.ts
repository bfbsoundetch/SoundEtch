import type { TranscribedRange } from '../project/Transcription'
import {
  GRANITE_SAMPLE_RATE,
  SILERO_VAD_FRAME_SAMPLES,
  type GraniteSpeechSegment,
  type SelectedSourceSampleRange,
} from './GraniteCtc'
import { speechRegionStartSample } from './GraniteTiming'

/** Untranscribed sound, and its longest run of VAD-supported frames, must each last this long. */
const MIN_UNTRANSCRIBED_SAMPLES = 0.3 * GRANITE_SAMPLE_RATE
/** Shorter quiet stretches are ordinary pacing between words. */
const MIN_SILENCE_SAMPLES = 0.5 * GRANITE_SAMPLE_RATE
/** Sound this far before a word's start is its onset, not untranscribed speech. */
const WORD_ONSET_COVERAGE_SAMPLES = 0.25 * GRANITE_SAMPLE_RATE
/** Unsupported runs of at most this many frames between speech-mask frames do not split untranscribed sound. */
const MAX_BRIDGED_FRAMES = 2

/** Half-open span in 16 kHz samples of a selected interval. */
export interface IntervalSpan {
  readonly startSample: number
  readonly endSample: number
}

function fillFrames(frames: Uint8Array, span: IntervalSpan): void {
  frames.fill(
    1,
    Math.max(0, Math.floor(span.startSample / SILERO_VAD_FRAME_SAMPLES)),
    Math.min(frames.length, Math.ceil(span.endSample / SILERO_VAD_FRAME_SAMPLES)),
  )
}

/**
 * Sound inside VAD segments that no word explains: hesitations, words Granite
 * dropped, or noise Silero takes for speech. Runs of speech-mask frames,
 * bridged over dropouts of up to two frames and kept clear of the 250 ms
 * before each word, are trimmed to their first and last energy-supported
 * frames, then need 300 ms overall with 300 ms of consecutive VAD support.
 * Silero stays above its threshold for a few hundred milliseconds after speech
 * stops, so without the trim its trailing frames would mark silence.
 */
export function findUntranscribedSpeech(
  words: readonly IntervalSpan[],
  speechMask: Uint8Array,
  audioSampleCount: number,
): IntervalSpan[] {
  const frameCount = speechMask.length
  const supported = speechMask.slice()
  for (let frame = 1; frame < frameCount - 1;) {
    if (supported[frame]) {
      ++frame
      continue
    }
    let endFrame = frame + 1
    while (endFrame < frameCount && !supported[endFrame]) {
      ++endFrame
    }
    if (endFrame - frame <= MAX_BRIDGED_FRAMES && endFrame < frameCount && supported[frame - 1]) {
      supported.fill(1, frame, endFrame)
    }
    frame = endFrame
  }

  const covered = new Uint8Array(frameCount)
  for (const word of words) {
    fillFrames(covered, { startSample: word.startSample - WORD_ONSET_COVERAGE_SAMPLES, endSample: word.endSample })
  }

  const spans = new Array<IntervalSpan>()
  for (let frame = 0; frame < frameCount;) {
    if (!supported[frame] || covered[frame]) {
      ++frame
      continue
    }
    let endFrame = frame + 1
    while (endFrame < frameCount && supported[endFrame] && !covered[endFrame]) {
      ++endFrame
    }
    const runEndFrame = endFrame
    while (frame < endFrame && !(speechMask[frame] & 2)) {
      ++frame
    }
    while (endFrame > frame && !(speechMask[endFrame - 1] & 2)) {
      --endFrame
    }
    let vadFrames = 0
    let longestVadFrames = 0
    for (let runFrame = frame; runFrame < endFrame; ++runFrame) {
      vadFrames = speechMask[runFrame] & 1 ? vadFrames + 1 : 0
      longestVadFrames = Math.max(longestVadFrames, vadFrames)
    }
    const startSample = frame * SILERO_VAD_FRAME_SAMPLES
    const endSample = Math.min(audioSampleCount, endFrame * SILERO_VAD_FRAME_SAMPLES)
    if (
      longestVadFrames * SILERO_VAD_FRAME_SAMPLES >= MIN_UNTRANSCRIBED_SAMPLES &&
      endSample - startSample >= MIN_UNTRANSCRIBED_SAMPLES
    ) {
      spans.push({ startSample, endSample })
    }
    frame = runEndFrame
  }
  return spans
}

/** Runs of at least 500 ms of silence-mask frames that no word or untranscribed span touches. */
export function findSilence(
  occupied: readonly IntervalSpan[],
  silenceMask: Uint8Array,
  audioSampleCount: number,
): IntervalSpan[] {
  const frameCount = silenceMask.length
  const blocked = new Uint8Array(frameCount)
  for (const span of occupied) {
    fillFrames(blocked, span)
  }
  const spans = new Array<IntervalSpan>()
  for (let frame = 0; frame < frameCount;) {
    if (!silenceMask[frame] || blocked[frame]) {
      ++frame
      continue
    }
    let endFrame = frame + 1
    while (endFrame < frameCount && silenceMask[endFrame] && !blocked[endFrame]) {
      ++endFrame
    }
    const startSample = frame * SILERO_VAD_FRAME_SAMPLES
    const endSample = Math.min(audioSampleCount, endFrame * SILERO_VAD_FRAME_SAMPLES)
    if (endSample - startSample >= MIN_SILENCE_SAMPLES) {
      spans.push({ startSample, endSample })
    }
    frame = endFrame
  }
  return spans
}

/**
 * Silence and untranscribed-speech ranges, in clip source samples, around the
 * sorted words Granite recognized in one selected interval. Untranscribed
 * speech joins the paragraph of its nearest VAD region; silence belongs to none.
 */
export function transcriptGapRanges(
  words: readonly TranscribedRange[],
  speechMask: Uint8Array,
  silenceMask: Uint8Array,
  audioSampleCount: number,
  projectSampleRate: number,
  selectedRange: SelectedSourceSampleRange,
  speechRegions: readonly GraniteSpeechSegment[],
): TranscribedRange[] {
  const toInterval16k = (sample: number) =>
    ((sample - selectedRange.startSample) * GRANITE_SAMPLE_RATE) / projectSampleRate
  const toSource = (sample16k: number) =>
    Math.min(
      selectedRange.endSample,
      selectedRange.startSample + Math.round((sample16k / GRANITE_SAMPLE_RATE) * projectSampleRate),
    )
  const wordSpans = words.map((word) => ({
    startSample: toInterval16k(word.startSample),
    endSample: toInterval16k(word.endSample),
  }))
  const untranscribed = findUntranscribedSpeech(wordSpans, speechMask, audioSampleCount)
  const silence = findSilence([...wordSpans, ...untranscribed], silenceMask, audioSampleCount)

  const ranges = new Array<TranscribedRange>()
  for (const span of untranscribed) {
    const startSample = toSource(span.startSample)
    const endSample = toSource(span.endSample)
    if (startSample < endSample) {
      const speechStartSample = speechRegionStartSample(
        startSample,
        endSample,
        projectSampleRate,
        selectedRange,
        speechRegions,
      )
      ranges.push({ text: '', startSample, endSample, speechStartSample, kind: 'untranscribed' })
    }
  }
  for (const span of silence) {
    const startSample = toSource(span.startSample)
    const endSample = toSource(span.endSample)
    if (startSample < endSample) {
      ranges.push({ text: '', startSample, endSample, kind: 'silence' })
    }
  }
  return ranges.sort((left, right) => left.startSample - right.startSample)
}
