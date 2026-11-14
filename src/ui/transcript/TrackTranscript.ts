import type { ClipView } from '../../project/ClipView'
import { findRemovedAudio, findSeam, type RemovedAudio } from '../../project/TimelineEdit'
import type { Track } from '../../project/Track'
import type { TranscriptGapKind } from '../../project/Transcription'
import { projectVisibleTranscribedRanges } from '../timeline/TranscriptionOverlay'

export interface TrackTranscriptEntry {
  readonly clipView: ClipView
  readonly placementIndex: number
  readonly rangeIndex: number
  readonly text: string
  readonly startSample: number
  readonly endSample: number
  /** The VAD-region onset in clip source samples. */
  readonly speechStartSample?: number
  readonly kind?: TranscriptGapKind
  /**
   * Set on transcript of audio a ripple edit took out after `clipView`. It plays nowhere, so
   * `startSample` and `endSample` are both the seam it was taken out at.
   */
  readonly removed?: RemovedTranscript
}

export interface RemovedTranscript {
  readonly audio: RemovedAudio
  /** The part of the removed clip source this entry covers. */
  readonly sourceStartSample: number
  readonly sourceEndSample: number
}

/**
 * The transcript each placement plays, in timeline order. Across a crossfade each side stops at the
 * seam. `includeRemoved` adds the transcript of audio ripple edits took out, at its seam.
 */
export function getTrackTranscriptEntries(
  track: Pick<Track, 'clipViews'>,
  includeRemoved = false,
): TrackTranscriptEntry[] {
  const entries: TrackTranscriptEntry[] = []
  const clipViews = track.clipViews
  clipViews.forEach((clipView, placementIndex) => {
    if (clipView.length <= 0) return
    const previous = clipViews[placementIndex - 1]
    const next = clipViews[placementIndex + 1]
    const windowStart = previous ? (findSeam(previous, clipView) ?? clipView.startPosition) : clipView.startPosition
    const placementEnd = clipView.getEndPosition()
    const windowEnd = next ? (findSeam(clipView, next) ?? placementEnd) : placementEnd
    const ranges = projectVisibleTranscribedRanges(
      clipView.clip.transcription,
      clipView.offset,
      clipView.offset + clipView.length,
      clipView.startPosition,
      windowStart,
      windowEnd,
    )
    ranges.forEach((range, rangeIndex) => {
      const startSample = Math.max(windowStart, range.startSample)
      const endSample = Math.min(windowEnd, range.endSample)
      if ((range.kind === undefined && range.text.trim().length === 0) || startSample >= endSample) return
      entries.push({
        clipView,
        placementIndex,
        rangeIndex,
        text: range.text,
        startSample,
        endSample,
        speechStartSample:
          range.speechStartSample === undefined
            ? undefined
            : range.speechStartSample - clipView.startPosition + clipView.offset,
        kind: range.kind,
      })
    })
  })

  if (includeRemoved) {
    for (const audio of findRemovedAudio(clipViews)) {
      const clipView = clipViews[audio.index]
      // An identity projection selects the source ranges the removed audio intersects.
      const ranges = projectVisibleTranscribedRanges(
        clipView.clip.transcription,
        audio.sourceStartSample,
        audio.sourceEndSample,
        audio.sourceStartSample,
        audio.sourceStartSample,
        audio.sourceEndSample,
      )
      ranges.forEach((range, rangeIndex) => {
        if (range.kind === undefined && range.text.trim().length === 0) return
        entries.push({
          clipView,
          placementIndex: audio.index,
          rangeIndex,
          text: range.text,
          startSample: audio.seamSample,
          endSample: audio.seamSample,
          speechStartSample: range.speechStartSample,
          kind: range.kind,
          removed: {
            audio,
            sourceStartSample: Math.max(audio.sourceStartSample, range.startSample),
            sourceEndSample: Math.min(audio.sourceEndSample, range.endSample),
          },
        })
      })
    }
  }

  return entries.sort(
    (a, b) =>
      a.startSample - b.startSample ||
      a.endSample - b.endSample ||
      a.placementIndex - b.placementIndex ||
      a.rangeIndex - b.rangeIndex,
  )
}

/**
 * Groups sorted entries into one paragraph per VAD speech region. Silence
 * belongs to no region: it ends the current paragraph, or opens the transcript.
 */
export function splitTranscriptParagraphs(entries: readonly TrackTranscriptEntry[]): TrackTranscriptEntry[][] {
  const paragraphs: TrackTranscriptEntry[][] = []
  let region: TrackTranscriptEntry | null = null
  for (const entry of entries) {
    const paragraph = paragraphs[paragraphs.length - 1]
    if (entry.kind === 'silence') {
      if (paragraph) paragraph.push(entry)
      else paragraphs.push([entry])
      continue
    }
    if (
      !region ||
      entry.speechStartSample !== region.speechStartSample ||
      (entry.speechStartSample !== undefined && !playsOn(region, entry))
    )
      paragraphs.push([entry])
    else paragraph.push(entry)
    region = entry
  }
  return paragraphs
}

/**
 * Whether `entry` plays on from `previous` in the same clip source: within one placement, across a
 * split, or across a seam where a ripple edit skipped ahead.
 */
function playsOn(previous: TrackTranscriptEntry, entry: TrackTranscriptEntry): boolean {
  const before = previous.clipView
  const after = entry.clipView
  if (before.clip !== after.clip) return false
  if (previous.placementIndex === entry.placementIndex) return true
  if (before.startPosition - before.offset === after.startPosition - after.offset) return true
  const seam = findSeam(before, after)
  return seam !== null && before.offset + seam - before.startPosition <= after.offset + seam - after.startPosition
}

export function getTranscriptEntriesInRange(
  entries: readonly TrackTranscriptEntry[],
  startSample: number,
  endSample: number,
): TrackTranscriptEntry[] {
  if (startSample >= endSample) return []
  return entries.filter((entry) => entry.startSample < endSample && entry.endSample > startSample)
}
