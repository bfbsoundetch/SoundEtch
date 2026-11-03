import type { OutputCaptionCue, OutputCaptionSettings, OutputCaptionWord } from '../project/OutputCaptions'
import type { Project } from '../project/Project'
import type { Track } from '../project/Track'
import { formatTranscriptParagraph } from '../ui/transcript/TranscriptFormatting'
import { getTrackTranscriptEntries, splitTranscriptParagraphs } from '../ui/transcript/TrackTranscript'

const MAX_WORDS = 7
const MAX_CHARACTERS = 42
const MAX_PAUSE_SECONDS = 0.6
const ENDS_FRAGMENT = /[.,!?;:]["'’”)\]]*$/u

/** Copies played transcript text and timing; later edits cannot change this snapshot. */
export function buildOutputCaptionCues(track: Pick<Track, 'clipViews'>, sampleRate: number): OutputCaptionCue[] {
  const cues: OutputCaptionCue[] = []
  const entries = getTrackTranscriptEntries(track)

  const addFragments = (words: OutputCaptionWord[]) => {
    words.sort((a, b) => a.startSample - b.startSample || a.endSample - b.endSample)
    let fragment: OutputCaptionWord[] = []
    let characters = 0
    let endSample = -Infinity
    const flush = () => {
      if (fragment.length === 0) return
      const snapshot = Object.freeze(fragment)
      prepareLookup(snapshot)
      cues.push(Object.freeze({ startSample: snapshot[0].startSample, endSample, words: snapshot }))
      fragment = []
      characters = 0
      endSample = -Infinity
    }
    for (const word of words) {
      if (
        fragment.length > 0 &&
        (fragment.length >= MAX_WORDS ||
          characters + 1 + word.text.length > MAX_CHARACTERS ||
          word.startSample - endSample > sampleRate * MAX_PAUSE_SECONDS)
      ) flush()
      characters += (fragment.length > 0 ? 1 : 0) + word.text.length
      fragment.push(word)
      endSample = Math.max(endSample, word.endSample)
      if (ENDS_FRAGMENT.test(word.text)) flush()
    }
    flush()
  }

  for (const paragraph of splitTranscriptParagraphs(entries)) {
    const recognized = paragraph.filter((entry) => entry.kind === undefined)
    const formatted = formatTranscriptParagraph(recognized, sampleRate)
    let recognizedIndex = 0
    let words: OutputCaptionWord[] = []
    for (const entry of paragraph) {
      if (entry.kind === 'untranscribed') {
        addFragments(words)
        words = []
      } else if (entry.kind === undefined) {
        const display = formatted[recognizedIndex++]
        const tokens = (display.text + display.punctuation).trim().split(/\s+/u)
        // A text edit can replace one timed atom with several words. It has no finer
        // alignment, so share its played interval equally without extending it.
        const duration = entry.endSample - entry.startSample
        tokens.forEach((text, index) => words.push(Object.freeze({
          text,
          startSample: entry.startSample + duration * index / tokens.length,
          endSample: entry.startSample + duration * (index + 1) / tokens.length,
        })))
      }
    }
    addFragments(words)
  }
  cues.sort((a, b) => a.startSample - b.startSample || a.endSample - b.endSample)
  prepareLookup(cues)
  return cues
}

/** Latest-starting active cue wins overlaps; equal starts use the last sorted occurrence. */
export function findOutputCaptionCue(cues: readonly OutputCaptionCue[], sample: number): OutputCaptionCue | null {
  const index = findActiveInterval(cues, sample)
  return index < 0 ? null : cues[index]
}

/** Half-open word intervals leave short pauses visible without a highlighted word. */
export function findOutputCaptionWord(cue: OutputCaptionCue, sample: number): number {
  if (sample < cue.startSample || sample >= cue.endSample) return -1
  return findActiveInterval(cue.words, sample)
}

export function resolveOutputCaptionTrack(project: Project, settings: Readonly<OutputCaptionSettings>): Track | null {
  for (const track of project.getTracks()) {
    if (settings.track === null ? !project.isTrackAudible(track) : settings.track !== track) continue
    if (getTrackTranscriptEntries(track).some((entry) =>
      entry.kind === undefined && entry.endSample > Math.max(0, entry.startSample),
    )) return track
  }
  return null
}

interface TimedInterval {
  readonly startSample: number
  readonly endSample: number
}

interface IntervalLookup {
  /** Only overlapping snapshots need an interval tree; the normal case is just binary search. */
  readonly ends: Float64Array | null
  readonly leafCount: number
}

const lookups = new WeakMap<readonly TimedInterval[], IntervalLookup>()

function prepareLookup(intervals: readonly TimedInterval[]): IntervalLookup {
  const cached = lookups.get(intervals)
  if (cached) return cached
  let previousEnd = -Infinity
  let overlaps = false
  for (const interval of intervals) {
    if (interval.startSample < previousEnd) overlaps = true
    previousEnd = Math.max(previousEnd, interval.endSample)
  }
  let leafCount = 1
  let ends: Float64Array | null = null
  if (overlaps) {
    while (leafCount < intervals.length) leafCount *= 2
    ends = new Float64Array(leafCount * 2).fill(-Infinity)
    intervals.forEach((interval, index) => { ends![leafCount + index] = interval.endSample })
    for (let index = leafCount - 1; index > 0; index--) ends[index] = Math.max(ends[index * 2], ends[index * 2 + 1])
  }
  const lookup = { ends, leafCount }
  lookups.set(intervals, lookup)
  return lookup
}

function findActiveInterval(intervals: readonly TimedInterval[], sample: number): number {
  if (!Number.isFinite(sample)) return -1
  let low = 0
  let high = intervals.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (intervals[middle].startSample <= sample) low = middle + 1
    else high = middle
  }
  if (low === 0) return -1
  const candidate = low - 1
  if (sample < intervals[candidate].endSample) return candidate
  const { ends, leafCount } = prepareLookup(intervals)
  return ends ? findLastEndingAfter(ends, 1, 0, leafCount, low, sample) : -1
}

/** Right-first max-end search finds an earlier still-playing overlap in O(log n). */
function findLastEndingAfter(
  ends: Float64Array,
  node: number,
  left: number,
  right: number,
  limit: number,
  sample: number,
): number {
  if (left >= limit || ends[node] <= sample) return -1
  if (right - left === 1) return left
  const middle = (left + right) >>> 1
  const later = findLastEndingAfter(ends, node * 2 + 1, middle, right, limit, sample)
  return later >= 0 ? later : findLastEndingAfter(ends, node * 2, left, middle, limit, sample)
}
