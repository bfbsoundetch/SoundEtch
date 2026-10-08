import type { ClipView } from '../../project/ClipView'
import type { Track } from '../../project/Track'
import { projectVisibleTranscribedRanges } from '../timeline/TranscriptionOverlay'

export interface TrackTranscriptEntry {
  readonly clipView: ClipView
  readonly placementIndex: number
  readonly rangeIndex: number
  readonly text: string
  readonly startSample: number
  readonly endSample: number
}

export function getTrackTranscriptEntries(track: Track): TrackTranscriptEntry[] {
  const entries: TrackTranscriptEntry[] = []
  track.clipViews.forEach((clipView, placementIndex) => {
    if (clipView.length <= 0) return
    const placementEnd = clipView.getEndPosition()
    const ranges = projectVisibleTranscribedRanges(
      clipView.clip.transcription,
      clipView.offset,
      clipView.offset + clipView.length,
      clipView.startPosition,
      clipView.startPosition,
      placementEnd,
    )
    ranges.forEach((range, rangeIndex) => {
      const startSample = Math.max(clipView.startPosition, range.startSample)
      const endSample = Math.min(placementEnd, range.endSample)
      if (range.text.trim().length === 0 || startSample >= endSample) return
      entries.push({ clipView, placementIndex, rangeIndex, text: range.text, startSample, endSample })
    })
  })
  return entries.sort(
    (a, b) =>
      a.startSample - b.startSample ||
      a.endSample - b.endSample ||
      a.placementIndex - b.placementIndex ||
      a.rangeIndex - b.rangeIndex,
  )
}

export function getTranscriptEntriesInRange(
  entries: readonly TrackTranscriptEntry[],
  startSample: number,
  endSample: number,
): TrackTranscriptEntry[] {
  if (startSample >= endSample) return []
  return entries.filter((entry) => entry.startSample < endSample && entry.endSample > startSample)
}
