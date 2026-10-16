import { expect, test } from 'vitest'
import type { TranscribedRange } from '../project/Transcription'
import { SILERO_VAD_FRAME_SAMPLES as F } from './GraniteCtc'
import { buildSilenceMask } from './GraniteTiming'
import { findSilence, findUntranscribedSpeech, transcriptGapRanges } from './TranscriptGaps'

/** Frame mask with `value` on frames [start, end) of each run. */
function mask(frameCount: number, ...runs: Array<[start: number, end: number, value: number]>): Uint8Array {
  const result = new Uint8Array(frameCount)
  for (const [start, end, value] of runs) result.fill(value, start, end)
  return result
}

const span = (startFrame: number, endFrame: number) => ({ startSample: startFrame * F, endSample: endFrame * F })

test('silence covers quiet audio around words; untranscribed sound keeps its VAD region', () => {
  // A VAD segment on frames 20–90: two words with a 640 ms pause, unrecognized loud speech (66–80),
  // then Silero lagging over quiet frames (80–90) after speech stops.
  const speechMask = mask(100, [20, 36, 3], [56, 80, 3], [80, 90, 1])
  const silenceMask = mask(100, [0, 20, 1], [36, 56, 1], [84, 100, 1])
  const selectedRange = { startSample: 1_000, endSample: 1_000 + 100 * F * 3 }
  const toSource = (frame: number) => 1_000 + frame * F * 3
  const words = [
    { text: 'first', startSample: toSource(25), endSample: toSource(36) },
    { text: 'second', startSample: toSource(56), endSample: toSource(66) },
  ]

  expect(transcriptGapRanges(words, speechMask, silenceMask, 100 * F, 48_000, selectedRange, [span(20, 80)])).toEqual([
    // Frames 20–25 are loud, but within the first word's 250 ms onset.
    { text: '', startSample: toSource(0), endSample: toSource(20), kind: 'silence' },
    { text: '', startSample: toSource(36), endSample: toSource(56), kind: 'silence' },
    {
      text: '',
      startSample: toSource(66),
      endSample: toSource(80),
      speechStartSample: toSource(20),
      kind: 'untranscribed',
    },
    { text: '', startSample: toSource(84), endSample: toSource(100), kind: 'silence' },
  ])
})

test('gaps converted to a non-integer source rate stay clear of mid-frame word boundaries', () => {
  const speechMask = mask(80, [30, 50, 3])
  const silenceMask = mask(80, [0, 30, 1], [50, 80, 1])
  const selectedRange = { startSample: 7, endSample: 7 + Math.round((80 * F * 44_100) / 16_000) }
  const words: TranscribedRange[] = [{ text: 'word', startSample: 41_011, endSample: 60_013 }]
  const ranges = [
    ...words,
    ...transcriptGapRanges(words, speechMask, silenceMask, 80 * F, 44_100, selectedRange, []),
  ].sort((left, right) => left.startSample - right.startSample)

  expect(ranges.map((range) => range.kind ?? 'word')).toEqual(['silence', 'word', 'silence'])
  for (let index = 1; index < ranges.length; ++index) {
    expect(ranges[index].startSample).toBeGreaterThanOrEqual(ranges[index - 1].endSample)
  }
  expect(ranges[ranges.length - 1].endSample).toBe(selectedRange.endSample)
})

test('silence needs a quiet Silero and quiet audio', () => {
  const probabilities = Float32Array.of(0.2, 0.5, 0.2, 0.9)
  // The loudest frame puts the sound threshold at 0.01.
  const energies = Float32Array.of(0.05, 0.005, 0.005, 0.1)
  expect(buildSilenceMask(probabilities, energies, 0.35)).toEqual(Uint8Array.of(0, 0, 1, 0))
})

test('silence starts at 500 ms and is clipped to the audio length', () => {
  expect(findSilence([], mask(40, [10, 25, 1]), 40 * F)).toEqual([])
  expect(findSilence([], mask(40, [10, 26, 1]), 40 * F)).toEqual([span(10, 26)])
  expect(findSilence([], mask(40, [24, 40, 1]), 40 * F - 100)).toEqual([
    { startSample: 24 * F, endSample: 40 * F - 100 },
  ])
})

test('untranscribed sound needs 300 ms of consecutive VAD support', () => {
  expect(findUntranscribedSpeech([], mask(40, [10, 19, 3]), 40 * F)).toEqual([])
  expect(findUntranscribedSpeech([], mask(40, [10, 20, 3]), 40 * F)).toEqual([span(10, 20)])
  expect(findUntranscribedSpeech([], mask(40, [10, 30, 2]), 40 * F)).toEqual([])
})

test('Silero support over quiet audio joins untranscribed sound but never starts or ends it', () => {
  expect(findUntranscribedSpeech([], mask(40, [10, 30, 1]), 40 * F)).toEqual([])
  expect(findUntranscribedSpeech([], mask(40, [5, 10, 1], [10, 20, 3], [20, 30, 1]), 40 * F)).toEqual([span(10, 20)])
  // Quiet gaps between syllables keep one span.
  expect(findUntranscribedSpeech([], mask(40, [10, 15, 3], [15, 20, 1], [20, 25, 3]), 40 * F)).toEqual([span(10, 25)])
})

test('unsupported dropouts of up to two frames join untranscribed sound', () => {
  expect(findUntranscribedSpeech([], mask(40, [10, 15, 3], [17, 27, 3]), 40 * F)).toEqual([span(10, 27)])
  expect(findUntranscribedSpeech([], mask(40, [10, 15, 3], [18, 27, 3]), 40 * F)).toEqual([])
  expect(findUntranscribedSpeech([], mask(40, [10, 15, 3], [18, 28, 3]), 40 * F)).toEqual([span(18, 28)])
})

test('the 250 ms before a word belongs to its onset, not to untranscribed sound', () => {
  const words = [span(30, 40)]
  expect(findUntranscribedSpeech(words, mask(50, [10, 45, 3]), 50 * F)).toEqual([span(10, 22)])
  expect(findUntranscribedSpeech(words, mask(50, [15, 45, 3]), 50 * F)).toEqual([])
})
